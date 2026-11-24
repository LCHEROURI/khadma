import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkInMemorySlotBurst,
  ContactHandlerError,
  evaluateListingBurstBucket,
  evaluateRateBucket,
  extractTrustedClientIp,
  getInMemoryBurstGuardSize,
  handleGetGigContactLink,
  IN_MEMORY_BURST_WINDOW_MS,
  MAX_CONTACTS_PER_GIG_PER_HOUR,
  MAX_CONTACTS_PER_IP_PER_HOUR,
  MAX_IN_MEMORY_BURST_ENTRIES,
  MAX_REPEATS_PER_SLOT_IN_MEMORY,
  MAX_TOTAL_REQUESTS_PER_IP_PER_HOUR,
  MAX_UNKNOWN_IP_CONTACTS_PER_HOUR,
  RATE_WINDOW_MS,
  resetInMemoryBurstGuard,
  type ContactStore,
  type GigRecord,
  type ListingBurstBucket,
  type PrivateContactRecord,
  type RateBucket
} from '../../functions/src/contactHandler';

const mockSignInAnonymously = vi.fn();
const mockCallableInvoke = vi.fn();
const mockHttpsCallable = vi.fn(() => mockCallableInvoke);

vi.mock('firebase/auth', () => ({
  signInAnonymously: (...args: unknown[]) => mockSignInAnonymously(...args),
  getAuth: () => ({ currentUser: null })
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: (...args: unknown[]) => mockHttpsCallable(...args),
  getFunctions: () => ({})
}));

vi.mock('../../src/firebase', () => ({
  auth: { currentUser: null },
  db: {},
  functions: {}
}));

function createMemoryStore(
  gigs: Record<string, GigRecord>,
  contacts: Record<string, PrivateContactRecord>
): ContactStore & { gigReads: number; ipWrites: number; listingWrites: number } {
  const ipBuckets = new Map<string, RateBucket>();
  const listingBuckets = new Map<string, ListingBurstBucket>();
  const store = {
    gigReads: 0,
    ipWrites: 0,
    listingWrites: 0,
    async getGig(gigId: string) {
      store.gigReads += 1;
      return gigs[gigId] ?? null;
    },
    async getContactRecord(gigId: string) {
      return contacts[gigId] ?? null;
    },
    async checkAndConsumeIpRateLimit(
      bucketKey: string,
      slotKey: string,
      maxUniquePerWindow: number,
      maxTotalPerWindow: number,
      windowMs: number,
      nowMs: number
    ) {
      const { allowed, alreadyCounted, nextBucket } = evaluateRateBucket(
        ipBuckets.get(bucketKey) ?? null,
        slotKey,
        maxUniquePerWindow,
        windowMs,
        nowMs,
        maxTotalPerWindow
      );
      if (allowed) {
        ipBuckets.set(bucketKey, nextBucket);
        store.ipWrites += 1;
      }
      return { allowed, alreadyCounted };
    },
    async checkAndConsumeListingRateLimit(
      gigId: string,
      maxPerWindow: number,
      windowMs: number,
      nowMs: number
    ) {
      const { allowed, nextBucket } = evaluateListingBurstBucket(
        listingBuckets.get(gigId) ?? null,
        maxPerWindow,
        windowMs,
        nowMs
      );
      if (allowed) {
        listingBuckets.set(gigId, nextBucket);
        store.listingWrites += 1;
      }
      return allowed;
    }
  };
  return store;
}

const NOW = 1_750_000_000_000;
const FUTURE_EXPIRY = { seconds: Math.floor((NOW + 10 * 24 * 60 * 60 * 1000) / 1000) };
const PAST_EXPIRY = { seconds: Math.floor((NOW - 60_000) / 1000) };

describe('KHADMA V1.4 Phase 3 — Account-Free Contact Security & Regression Suite', () => {
  beforeEach(() => {
    resetInMemoryBurstGuard();
    mockSignInAnonymously.mockReset();
    mockCallableInvoke.mockReset();
    mockHttpsCallable.mockClear();
  });

  // --- Restored V1.1/V1.2/V1.3 Architecture Regression Assertions ---

  it('removes the old public GET /api/contact/** Hosting rewrite from firebase.json', () => {
    const firebaseJson = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'firebase.json'), 'utf8')
    ) as { hosting?: { rewrites?: Array<{ source?: string; function?: unknown }> } };
    const rewrites = firebaseJson.hosting?.rewrites ?? [];
    expect(rewrites.some((r) => String(r.source ?? '').includes('/api/contact'))).toBe(false);
    expect(rewrites.some((r) => Boolean(r.function))).toBe(false);
  });

  it('configures getGigContactLink and reportGigListing as onCall functions with enforceAppCheck: true, bounded instances, and timeout', () => {
    const fnSrc = fs.readFileSync(path.resolve(process.cwd(), 'functions/src/index.ts'), 'utf8');
    expect(fnSrc).toContain("region: 'europe-west1'");
    expect(fnSrc).toContain('enforceAppCheck: true');
    expect(fnSrc).toContain('maxInstances: 20');
    expect(fnSrc).toContain('timeoutSeconds: 15');
    expect(fnSrc).toContain('export const getGigContactLink = onCall(CONTACT_FUNCTION_OPTIONS');
    expect(fnSrc).toContain('export const reportGigListing = onCall(CONTACT_FUNCTION_OPTIONS');
  });

  it('initializes Firebase App Check with ReCaptchaEnterpriseProvider (not deprecated ReCaptchaV3Provider)', () => {
    const clientSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/firebase.ts'), 'utf8');
    expect(clientSrc).toContain('ReCaptchaEnterpriseProvider');
    expect(clientSrc).toContain('initializeAppCheck');
    expect(clientSrc).not.toContain('ReCaptchaV3Provider');
  });

  // --- Behavioral Account-Free Client Verification (replaces source-text grep) ---

  it('behaviorally calls getGigContactLink without invoking signInAnonymously (truly account-free)', async () => {
    mockCallableInvoke.mockResolvedValueOnce({
      data: { url: 'https://wa.me/213550123456?text=Bonjour', channel: 'whatsapp' }
    });
    const { requestGigContactLink } = await import('../../src/lib/db');

    const url = await requestGigContactLink('g_active', 'fr', 'whatsapp');
    expect(url).toBe('https://wa.me/213550123456?text=Bonjour');
    expect(mockSignInAnonymously).not.toHaveBeenCalled();
    expect(mockHttpsCallable).toHaveBeenCalledWith(expect.anything(), 'getGigContactLink');
    expect(mockCallableInvoke).toHaveBeenCalledWith({
      gigId: 'g_active',
      channel: 'whatsapp',
      lang: 'fr'
    });
  });

  // --- Core Account-Free WhatsApp & Email Contact Security ---

  it('allows genuinely unauthenticated WhatsApp & email contact with valid App Check and rejects missing App Check', async () => {
    const store = createMemoryStore(
      {
        g1: {
          title: 'Électricien bâtiment — Es Sénia',
          status: 'active',
          isSample: false,
          contactMethods: ['whatsapp', 'email'],
          expiresAt: FUTURE_EXPIRY
        }
      },
      {
        g1: {
          contactPhone: '0550 12 34 56',
          contactEmail: 'contact@oran-elec.dz',
          whatsappConsent: true,
          emailConsent: true
        }
      }
    );

    await expect(
      handleGetGigContactLink(store, {
        authUid: null,
        hasAppCheck: false,
        clientIp: '41.100.1.1',
        gigId: 'g1',
        channel: 'whatsapp',
        lang: 'fr',
        nowMs: NOW
      })
    ).rejects.toMatchObject({ code: 'failed-precondition' });

    const waRes = await handleGetGigContactLink(store, {
      authUid: null,
      hasAppCheck: true,
      clientIp: '41.100.1.1',
      gigId: 'g1',
      channel: 'whatsapp',
      lang: 'fr',
      nowMs: NOW
    });
    expect(waRes.channel).toBe('whatsapp');
    expect(waRes.url).toMatch(/^https:\/\/wa\.me\/213550123456\?text=/);
    expect(Object.keys(waRes).sort()).toEqual(['channel', 'url', 'waUrl']);

    const mailRes = await handleGetGigContactLink(store, {
      authUid: null,
      hasAppCheck: true,
      clientIp: '41.100.1.1',
      gigId: 'g1',
      channel: 'email',
      lang: 'ar',
      nowMs: NOW
    });
    expect(mailRes.channel).toBe('email');
    expect(mailRes.url).toMatch(/^mailto:contact@oran-elec\.dz\?subject=/);
    expect(decodeURIComponent(mailRes.url)).toContain('تقديم عبر خدامة - Électricien bâtiment — Es Sénia');
    expect(Object.keys(mailRes).sort()).toEqual(['channel', 'mailtoUrl', 'url']);
  });

  it('enforces WhatsApp-only, Email-only, disabled channels, missing records, and prevents V1.4 consent bypass via legacy posterPhone', async () => {
    const store = createMemoryStore(
      {
        g_wa_only: { status: 'active', isSample: false, contactMethods: ['whatsapp'], expiresAt: FUTURE_EXPIRY },
        g_email_only: { title: 'Livreur', status: 'active', isSample: false, contactMethods: ['email'], expiresAt: FUTURE_EXPIRY },
        g_no_consent: { title: 'Plombier', status: 'active', isSample: false, contactMethods: ['whatsapp', 'email'], expiresAt: FUTURE_EXPIRY },
        g_v14_legacy_phone_no_consent: { status: 'active', isSample: false, contactMethods: ['whatsapp'], expiresAt: FUTURE_EXPIRY },
        g_missing_contact: { status: 'active', isSample: false, contactMethods: ['whatsapp', 'email'], expiresAt: FUTURE_EXPIRY }
      },
      {
        g_wa_only: { contactPhone: '+213661234567', contactEmail: 'a@oran.dz', whatsappConsent: true, emailConsent: true },
        g_email_only: { contactPhone: '+213661234567', contactEmail: 'b@oran.dz', whatsappConsent: true, emailConsent: true },
        g_no_consent: { contactPhone: '+213661234567', contactEmail: 'c@oran.dz', whatsappConsent: false, emailConsent: false },
        // V1.4 listing having legacy posterPhone WITHOUT explicit whatsappConsent: true MUST NOT bypass consent
        g_v14_legacy_phone_no_consent: { posterPhone: '+213661234567' }
      }
    );

    const waOnly = await handleGetGigContactLink(store, {
      hasAppCheck: true,
      clientIp: '41.100.1.2',
      gigId: 'g_wa_only',
      channel: 'whatsapp',
      lang: 'fr',
      nowMs: NOW
    });
    expect(waOnly.url).toMatch(/^https:\/\/wa\.me\/213661234567/);

    await expect(
      handleGetGigContactLink(store, {
        hasAppCheck: true,
        clientIp: '41.100.1.2',
        gigId: 'g_wa_only',
        channel: 'email',
        lang: 'fr',
        nowMs: NOW
      })
    ).rejects.toMatchObject({ code: 'not-found' });

    const emailOnly = await handleGetGigContactLink(store, {
      hasAppCheck: true,
      clientIp: '41.100.1.2',
      gigId: 'g_email_only',
      channel: 'email',
      lang: 'fr',
      nowMs: NOW
    });
    expect(emailOnly.url).toMatch(/^mailto:b@oran\.dz\?subject=/);

    await expect(
      handleGetGigContactLink(store, {
        hasAppCheck: true,
        clientIp: '41.100.1.2',
        gigId: 'g_v14_legacy_phone_no_consent',
        channel: 'whatsapp',
        lang: 'fr',
        nowMs: NOW
      })
    ).rejects.toMatchObject({ code: 'not-found' });

    for (const gigId of ['g_no_consent', 'g_missing_contact']) {
      for (const channel of ['whatsapp', 'email'] as const) {
        await expect(
          handleGetGigContactLink(store, {
            hasAppCheck: true,
            clientIp: '41.100.1.2',
            gigId,
            channel,
            lang: 'fr',
            nowMs: NOW
          })
        ).rejects.toMatchObject({ code: 'not-found' });
      }
    }
  });

  it('rejects expired ads still marked active, pending/hidden/archived/removed/sample ads, and preserves V1.3 legacy compatibility', async () => {
    const store = createMemoryStore(
      {
        g_expired_active: { status: 'active', isSample: false, contactMethods: ['whatsapp'], expiresAt: PAST_EXPIRY },
        g_pending: { status: 'pending', isSample: false, contactMethods: ['whatsapp'] },
        g_hidden: { status: 'hidden', isSample: false, contactMethods: ['whatsapp'] },
        g_archived: { status: 'archived', isSample: false, contactMethods: ['whatsapp'] },
        g_removed: { status: 'removed', isSample: false, contactMethods: ['whatsapp'] },
        g_sample: { status: 'active', isSample: true, contactMethods: ['whatsapp'] },
        g_v13_legacy: { status: 'active', isSample: false }
      },
      {
        g_expired_active: { contactPhone: '+213770123456', whatsappConsent: true },
        g_pending: { contactPhone: '+213770123456', whatsappConsent: true },
        g_hidden: { contactPhone: '+213770123456', whatsappConsent: true },
        g_archived: { contactPhone: '+213770123456', whatsappConsent: true },
        g_removed: { contactPhone: '+213770123456', whatsappConsent: true },
        g_sample: { contactPhone: '+213770123456', whatsappConsent: true },
        g_v13_legacy: { posterPhone: '+213770123456' }
      }
    );

    for (const badId of ['g_expired_active', 'g_pending', 'g_hidden', 'g_archived', 'g_removed', 'g_sample', 'nonexistent']) {
      await expect(
        handleGetGigContactLink(store, {
          hasAppCheck: true,
          clientIp: '41.100.1.3',
          gigId: badId,
          channel: 'whatsapp',
          lang: 'fr',
          nowMs: NOW
        })
      ).rejects.toMatchObject({ code: 'not-found' });
    }

    const legacyRes = await handleGetGigContactLink(store, {
      hasAppCheck: true,
      clientIp: '41.100.1.3',
      gigId: 'g_v13_legacy',
      lang: 'fr',
      nowMs: NOW
    });
    expect(legacyRes.channel).toBe('whatsapp');
    expect(legacyRes.waUrl).toMatch(/^https:\/\/wa\.me\/213770123456\?text=/);

    await expect(
      handleGetGigContactLink(store, {
        hasAppCheck: true,
        clientIp: '41.100.1.3',
        gigId: 'g_v13_legacy',
        channel: 'email',
        lang: 'fr',
        nowMs: NOW
      })
    ).rejects.toMatchObject({ code: 'not-found' });
  });

  it('rejects malformed IDs, malformed channels, invalid phones/emails, and header/URL injection attempts', async () => {
    const store = createMemoryStore(
      {
        g_bad_phone: { status: 'active', isSample: false, contactMethods: ['whatsapp'] },
        g_bad_email: { status: 'active', isSample: false, contactMethods: ['email'] },
        g_inject_email: { status: 'active', isSample: false, contactMethods: ['email'] },
        g_inject_title: {
          title: 'Offre\r\nBcc:attacker@evil.com\nX-Test:1',
          status: 'active',
          isSample: false,
          contactMethods: ['email']
        }
      },
      {
        g_bad_phone: { contactPhone: '+33612345678', whatsappConsent: true },
        g_bad_email: { contactEmail: 'javascript:alert(1)', emailConsent: true },
        g_inject_email: { contactEmail: 'hr@oran.dz\r\nBcc:evil@x.com', emailConsent: true },
        g_inject_title: { contactEmail: 'hr@oran.dz', emailConsent: true }
      }
    );

    await expect(
      handleGetGigContactLink(store, { hasAppCheck: true, clientIp: '41.1.1.1', gigId: '../etc/passwd', lang: 'fr' })
    ).rejects.toThrow(ContactHandlerError);

    await expect(
      handleGetGigContactLink(store, { hasAppCheck: true, clientIp: '41.1.1.1', gigId: 'g_bad_phone', channel: 'sms', lang: 'fr' })
    ).rejects.toMatchObject({ code: 'invalid-argument' });

    for (const [gigId, channel] of [
      ['g_bad_phone', 'whatsapp'],
      ['g_bad_email', 'email'],
      ['g_inject_email', 'email']
    ] as const) {
      await expect(
        handleGetGigContactLink(store, { hasAppCheck: true, clientIp: '41.1.1.1', gigId, channel, lang: 'fr', nowMs: NOW })
      ).rejects.toMatchObject({ code: 'not-found' });
    }

    const safeTitleRes = await handleGetGigContactLink(store, {
      hasAppCheck: true,
      clientIp: '41.1.1.1',
      gigId: 'g_inject_title',
      channel: 'email',
      lang: 'fr',
      nowMs: NOW
    });
    expect(safeTitleRes.url).not.toMatch(/[\r\n]/);
    expect(safeTitleRes.url).not.toContain('%0D');
    expect(safeTitleRes.url).not.toContain('%0A');
  });

  it('closes repetitive single-target abuse via in-memory shedder (0 Firestore ops) and cross-instance total-request cap', async () => {
    const store = createMemoryStore(
      { g_rep: { status: 'active', isSample: false, contactMethods: ['whatsapp'] } },
      { g_rep: { contactPhone: '+213555010101', whatsappConsent: true } }
    );

    // 1. In-memory burst shedder allows up to MAX_REPEATS_PER_SLOT_IN_MEMORY (6) legitimate retries,
    // then sheds 7th+ repeat BEFORE touching Firestore (0 extra gigReads).
    for (let i = 0; i < MAX_REPEATS_PER_SLOT_IN_MEMORY; i++) {
      await handleGetGigContactLink(store, {
        hasAppCheck: true,
        clientIp: '41.200.5.5',
        gigId: 'g_rep',
        channel: 'whatsapp',
        lang: 'fr',
        nowMs: NOW + i * 100
      });
    }
    const readsBeforeShed = store.gigReads;
    await expect(
      handleGetGigContactLink(store, {
        hasAppCheck: true,
        clientIp: '41.200.5.5',
        gigId: 'g_rep',
        channel: 'whatsapp',
        lang: 'fr',
        nowMs: NOW + 1000
      })
    ).rejects.toMatchObject({ code: 'resource-exhausted' });
    expect(store.gigReads).toBe(readsBeforeShed); // 0 Firestore reads consumed!

    // 2. Cross-instance total-request cap (simulated via bypassInMemoryGuard: true) still hard-bounds
    // repetitive requests at MAX_TOTAL_REQUESTS_PER_IP_PER_HOUR (60) per IP/hr.
    const crossStore = createMemoryStore(
      { g_rep: { status: 'active', isSample: false, contactMethods: ['whatsapp'] } },
      { g_rep: { contactPhone: '+213555010101', whatsappConsent: true } }
    );
    for (let i = 0; i < MAX_TOTAL_REQUESTS_PER_IP_PER_HOUR; i++) {
      await handleGetGigContactLink(crossStore, {
        hasAppCheck: true,
        clientIp: '41.200.6.6',
        gigId: 'g_rep',
        channel: 'whatsapp',
        lang: 'fr',
        nowMs: NOW + i * 10,
        bypassInMemoryGuard: true
      });
    }
    await expect(
      handleGetGigContactLink(crossStore, {
        hasAppCheck: true,
        clientIp: '41.200.6.6',
        gigId: 'g_rep',
        channel: 'whatsapp',
        lang: 'fr',
        nowMs: NOW + 5000,
        bypassInMemoryGuard: true
      })
    ).rejects.toMatchObject({ code: 'resource-exhausted' });
    // Listing burst counter was incremented only ONCE despite 60 repeated calls from the same IP
    expect(crossStore.listingWrites).toBe(1);
  });

  it('supports shared Algerian CGNAT IPs, popular listings, concurrent bursts, spoofed headers, and missing/malformed IP fallback', async () => {
    const gigs: Record<string, GigRecord> = {};
    const contacts: Record<string, PrivateContactRecord> = {};
    for (let i = 0; i <= MAX_CONTACTS_PER_IP_PER_HOUR + 2; i++) {
      gigs[`g_${i}`] = { status: 'active', isSample: false, contactMethods: ['whatsapp'] };
      contacts[`g_${i}`] = { contactPhone: '+213555010101', whatsappConsent: true };
    }
    const store = createMemoryStore(gigs, contacts);

    // 1. Shared Algerian carrier CGNAT IP: 10 legitimate users × 3 unique listings = 30 succeed, 31st blocked
    for (let i = 0; i < MAX_CONTACTS_PER_IP_PER_HOUR; i++) {
      await handleGetGigContactLink(store, {
        hasAppCheck: true,
        clientIp: '41.200.0.1',
        gigId: `g_${i}`,
        channel: 'whatsapp',
        lang: 'fr',
        nowMs: NOW + i * 10
      });
    }
    await expect(
      handleGetGigContactLink(store, {
        hasAppCheck: true,
        clientIp: '41.200.0.1',
        gigId: `g_${MAX_CONTACTS_PER_IP_PER_HOUR}`,
        channel: 'whatsapp',
        lang: 'fr',
        nowMs: NOW + 5000
      })
    ).rejects.toMatchObject({ code: 'resource-exhausted' });

    // 2. Popular listing receiving concurrent traffic from 65 distinct IPs: 60 succeed, 5 throttled, resets after 1h
    const burstStore = createMemoryStore(
      { g_hot: { status: 'active', isSample: false, contactMethods: ['whatsapp'] } },
      { g_hot: { contactPhone: '+213555010101', whatsappConsent: true } }
    );
    const concurrentCalls = Array.from({ length: MAX_CONTACTS_PER_GIG_PER_HOUR + 5 }, (_, idx) =>
      handleGetGigContactLink(burstStore, {
        hasAppCheck: true,
        clientIp: `41.201.0.${idx + 1}`,
        gigId: 'g_hot',
        channel: 'whatsapp',
        lang: 'fr',
        nowMs: NOW
      })
    );
    const settled = await Promise.allSettled(concurrentCalls);
    expect(settled.filter((r) => r.status === 'fulfilled')).toHaveLength(MAX_CONTACTS_PER_GIG_PER_HOUR);
    expect(settled.filter((r) => r.status === 'rejected')).toHaveLength(5);

    await expect(
      handleGetGigContactLink(burstStore, {
        hasAppCheck: true,
        clientIp: '41.201.1.1',
        gigId: 'g_hot',
        channel: 'whatsapp',
        lang: 'fr',
        nowMs: NOW + RATE_WINDOW_MS + 1
      })
    ).resolves.toMatchObject({ channel: 'whatsapp' });

    // 3. Trusted IP extraction: ignores spoofed leftmost IP, skips private/loopback proxy hops, rejects malformed
    expect(
      extractTrustedClientIp({
        ip: '127.0.0.1',
        headers: { 'x-forwarded-for': '1.2.3.4, 41.105.22.9, 10.0.0.5' }
      })
    ).toBe('41.105.22.9');
    expect(
      extractTrustedClientIp({
        ip: '::1',
        headers: { 'x-forwarded-for': 'not-an-ip, 192.168.1.1' }
      })
    ).toBeNull();

    // 4. Missing or malformed IP does NOT bypass rate limiting — bounded by shared ip_unknown bucket (20/hr)
    const unknownStore = createMemoryStore(gigs, contacts);
    for (let i = 0; i < MAX_UNKNOWN_IP_CONTACTS_PER_HOUR; i++) {
      await handleGetGigContactLink(unknownStore, {
        hasAppCheck: true,
        clientIp: i % 2 === 0 ? null : 'malformed-ip',
        gigId: `g_${i}`,
        channel: 'whatsapp',
        lang: 'fr',
        nowMs: NOW + i * 10
      });
    }
    await expect(
      handleGetGigContactLink(unknownStore, {
        hasAppCheck: true,
        clientIp: null,
        gigId: `g_${MAX_UNKNOWN_IP_CONTACTS_PER_HOUR}`,
        channel: 'whatsapp',
        lang: 'fr',
        nowMs: NOW + 1000
      })
    ).rejects.toMatchObject({ code: 'resource-exhausted' });
  });

  it('bounds in-memory burst guard memory under high-cardinality flood and sweeps stale entries', () => {
    resetInMemoryBurstGuard();
    // Flood 2,500 unique active keys inside one 10-minute window -> hard-capped at MAX_IN_MEMORY_BURST_ENTRIES
    for (let i = 0; i < MAX_IN_MEMORY_BURST_ENTRIES + 500; i++) {
      expect(checkInMemorySlotBurst(`ip_${i}:gig_1:whatsapp`, NOW + i)).toBe(true);
    }
    expect(getInMemoryBurstGuardSize()).toBeLessThanOrEqual(MAX_IN_MEMORY_BURST_ENTRIES);

    // Advance past IN_MEMORY_BURST_WINDOW_MS and trigger cleanup -> all stale entries swept
    const afterWindow = NOW + IN_MEMORY_BURST_WINDOW_MS + 10_000;
    expect(checkInMemorySlotBurst('fresh_key', afterWindow)).toBe(true);
    expect(getInMemoryBurstGuardSize()).toBe(1);
  });

  it('enforces production App Check isolation and blocks emulator wiring in production builds', () => {
    const functionsIndexSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'functions/src/index.ts'),
      'utf8'
    );
    const webFirebaseSrc = fs.readFileSync(
      path.resolve(process.cwd(), 'src/firebase.ts'),
      'utf8'
    );

    // 1. Production frontend build can NEVER connect to emulators (`!import.meta.env.PROD`)
    expect(webFirebaseSrc).toContain('!import.meta.env.PROD && import.meta.env.VITE_USE_EMULATORS === \'true\'');

    // 2. Backend emulator accommodation requires FUNCTIONS_EMULATOR=true + demo-* project + FIRESTORE_EMULATOR_HOST
    expect(functionsIndexSrc).toContain("env.FUNCTIONS_EMULATOR === 'true'");
    expect(functionsIndexSrc).toContain("env.GCLOUD_PROJECT.startsWith('demo-')");
    expect(functionsIndexSrc).toContain('Boolean(env.FIRESTORE_EMULATOR_HOST)');
    expect(functionsIndexSrc).toContain('enforceAppCheck: !IS_DEMO_EMULATOR');

    // 3. Replicate predicate behavior across production, Cloud Run, and demo emulator environments
    const isDemo = (env: Record<string, string | undefined>) =>
      env.FUNCTIONS_EMULATOR === 'true' &&
      typeof env.GCLOUD_PROJECT === 'string' &&
      env.GCLOUD_PROJECT.startsWith('demo-') &&
      Boolean(env.FIRESTORE_EMULATOR_HOST);

    // Production khadma-oran -> NEVER bypasses App Check
    expect(isDemo({ GCLOUD_PROJECT: 'khadma-oran' })).toBe(false);
    expect(
      isDemo({
        FUNCTIONS_EMULATOR: 'true',
        GCLOUD_PROJECT: 'khadma-oran',
        FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080'
      })
    ).toBe(false);
    // Missing FIRESTORE_EMULATOR_HOST -> NEVER bypasses App Check
    expect(isDemo({ FUNCTIONS_EMULATOR: 'true', GCLOUD_PROJECT: 'demo-khadma' })).toBe(false);
    // Only isolated local demo emulator -> allowed
    expect(
      isDemo({
        FUNCTIONS_EMULATOR: 'true',
        GCLOUD_PROJECT: 'demo-khadma',
        FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080'
      })
    ).toBe(true);
  });

  it('fails closed on malformed expiresAt in contact retrieval while preserving legacy missing expiresAt', async () => {
    const store = createMemoryStore(
      {
        g_malformed_str: {
          status: 'active',
          isSample: false,
          contactMethods: ['whatsapp'],
          expiresAt: 'corrupted-date'
        },
        g_malformed_neg: {
          status: 'active',
          isSample: false,
          contactMethods: ['whatsapp'],
          expiresAt: -1
        },
        g_legacy_null: {
          status: 'active',
          isSample: false,
          contactMethods: ['whatsapp'],
          expiresAt: null
        }
      },
      {
        g_malformed_str: { contactPhone: '+213550123456', whatsappConsent: true },
        g_malformed_neg: { contactPhone: '+213550123456', whatsappConsent: true },
        g_legacy_null: { contactPhone: '+213550123456', whatsappConsent: true }
      }
    );

    await expect(
      handleGetGigContactLink(store, {
        hasAppCheck: true,
        clientIp: '41.100.1.9',
        gigId: 'g_malformed_str',
        channel: 'whatsapp',
        lang: 'fr',
        nowMs: NOW
      })
    ).rejects.toMatchObject({ code: 'not-found' });

    await expect(
      handleGetGigContactLink(store, {
        hasAppCheck: true,
        clientIp: '41.100.1.9',
        gigId: 'g_malformed_neg',
        channel: 'whatsapp',
        lang: 'fr',
        nowMs: NOW
      })
    ).rejects.toMatchObject({ code: 'not-found' });

    await expect(
      handleGetGigContactLink(store, {
        hasAppCheck: true,
        clientIp: '41.100.1.9',
        gigId: 'g_legacy_null',
        channel: 'whatsapp',
        lang: 'fr',
        nowMs: NOW
      })
    ).resolves.toMatchObject({ channel: 'whatsapp' });
  });
});
