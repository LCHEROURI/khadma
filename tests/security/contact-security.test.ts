import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ContactHandlerError,
  evaluateRateBucket,
  handleGetGigContactLink,
  MAX_CONTACTS_PER_IP_PER_HOUR,
  MAX_CONTACTS_PER_UID_PER_HOUR,
  RATE_WINDOW_MS,
  type ContactStore,
  type GigRecord,
  type RateBucket
} from '../../functions/src/contactHandler';

function createMemoryStore(
  gigs: Record<string, GigRecord>,
  contacts: Record<string, string>
): ContactStore {
  const buckets = new Map<string, RateBucket>();
  return {
    async getGig(gigId) {
      return gigs[gigId] ?? null;
    },
    async getContactPhone(gigId) {
      return contacts[gigId] ?? null;
    },
    async checkAndConsumeRateLimit(bucketKey, gigId, maxPerWindow, windowMs, nowMs) {
      const existing = buckets.get(bucketKey) ?? null;
      const { allowed, nextBucket } = evaluateRateBucket(existing, gigId, maxPerWindow, windowMs, nowMs);
      if (allowed) buckets.set(bucketKey, nextBucket);
      return allowed;
    }
  };
}

describe('SEC-001 deployment & transport hardening', () => {
  it('removes the old public GET /api/contact/** Hosting rewrite from firebase.json', () => {
    const firebaseJson = JSON.parse(
      fs.readFileSync(path.resolve(process.cwd(), 'firebase.json'), 'utf8')
    ) as { hosting?: { rewrites?: Array<{ source?: string; function?: unknown }> } };
    const rewrites = firebaseJson.hosting?.rewrites ?? [];
    const hasPublicContactRewrite = rewrites.some(
      (r) => typeof r.source === 'string' && r.source.includes('/api/contact')
    );
    expect(hasPublicContactRewrite).toBe(false);
  });

  it('configures getGigContactLink and reportGigListing as onCall functions with enforceAppCheck: true', () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), 'functions/src/index.ts'), 'utf8');
    expect(src).toContain('enforceAppCheck: true');
    expect(src).toContain('export const getGigContactLink = onCall(CONTACT_FUNCTION_OPTIONS');
    expect(src).toContain('export const reportGigListing = onCall(CONTACT_FUNCTION_OPTIONS');
    expect(src).not.toContain('onRequest(');
  });

  it('initializes Firebase App Check with ReCaptchaEnterpriseProvider (not deprecated ReCaptchaV3Provider)', () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), 'src/firebase.ts'), 'utf8');
    expect(src).toContain('ReCaptchaEnterpriseProvider');
    expect(src).toContain('initializeAppCheck');
    expect(src).not.toContain('ReCaptchaV3Provider');
  });
});

describe('SEC-001 contact handler security enforcement', () => {
  const baseGigs: Record<string, GigRecord> = {
    gig_active: { status: 'active', isSample: false },
    gig_hidden: { status: 'hidden', isSample: false },
    gig_removed: { status: 'removed', isSample: false },
    gig_sample: { status: 'active', isSample: true }
  };
  const baseContacts: Record<string, string> = {
    gig_active: '+213555010000',
    gig_hidden: '+213555010001',
    gig_removed: '+213555010002'
  };

  it('blocks App Check bypass attempts (missing App Check token)', async () => {
    const store = createMemoryStore(baseGigs, baseContacts);
    await expect(
      handleGetGigContactLink(store, {
        authUid: 'anon-1',
        hasAppCheck: false,
        clientIp: '197.200.1.1',
        gigId: 'gig_active',
        lang: 'dar'
      })
    ).rejects.toMatchObject<Partial<ContactHandlerError>>({ code: 'failed-precondition' });
  });

  it('blocks unauthenticated bypass attempts (missing Firebase Auth UID)', async () => {
    const store = createMemoryStore(baseGigs, baseContacts);
    await expect(
      handleGetGigContactLink(store, {
        authUid: null,
        hasAppCheck: true,
        clientIp: '197.200.1.1',
        gigId: 'gig_active',
        lang: 'dar'
      })
    ).rejects.toMatchObject<Partial<ContactHandlerError>>({ code: 'unauthenticated' });
  });

  it('blocks contact lookup on hidden, removed, sample, or missing gigs', async () => {
    const store = createMemoryStore(baseGigs, baseContacts);
    for (const gigId of ['gig_hidden', 'gig_removed', 'gig_sample', 'gig_missing']) {
      await expect(
        handleGetGigContactLink(store, {
          authUid: 'anon-1',
          hasAppCheck: true,
          clientIp: '197.200.1.1',
          gigId,
          lang: 'fr'
        })
      ).rejects.toMatchObject<Partial<ContactHandlerError>>({ code: 'not-found' });
    }
  });

  it('enforces per-UID hourly rate limit while allowing idempotent re-taps and post-window reset', async () => {
    const gigs: Record<string, GigRecord> = {};
    const contacts: Record<string, string> = {};
    for (let i = 1; i <= MAX_CONTACTS_PER_UID_PER_HOUR + 2; i += 1) {
      gigs[`gig_${i}`] = { status: 'active', isSample: false };
      contacts[`gig_${i}`] = `+2135550100${String(i).padStart(2, '0')}`;
    }
    const store = createMemoryStore(gigs, contacts);
    const t0 = 1_700_000_000_000;

    // First MAX_CONTACTS_PER_UID_PER_HOUR unique gigs succeed
    for (let i = 1; i <= MAX_CONTACTS_PER_UID_PER_HOUR; i += 1) {
      const res = await handleGetGigContactLink(store, {
        authUid: 'uid-scraper',
        hasAppCheck: true,
        clientIp: '197.200.1.10',
        gigId: `gig_${i}`,
        lang: 'dar',
        nowMs: t0
      });
      expect(res.waUrl).toContain(`https://wa.me/2135550100${String(i).padStart(2, '0')}`);
    }

    // Re-tapping an already revealed gig does NOT consume another slot
    await expect(
      handleGetGigContactLink(store, {
        authUid: 'uid-scraper',
        hasAppCheck: true,
        clientIp: '197.200.1.10',
        gigId: 'gig_1',
        lang: 'ar',
        nowMs: t0 + 1000
      })
    ).resolves.toMatchObject({ waUrl: expect.stringContaining('https://wa.me/213555010001') });

    // Next unique gig within the same hour MUST be rejected
    await expect(
      handleGetGigContactLink(store, {
        authUid: 'uid-scraper',
        hasAppCheck: true,
        clientIp: '197.200.1.10',
        gigId: `gig_${MAX_CONTACTS_PER_UID_PER_HOUR + 1}`,
        lang: 'dar',
        nowMs: t0 + 5000
      })
    ).rejects.toMatchObject<Partial<ContactHandlerError>>({ code: 'resource-exhausted' });

    // After the 1-hour window expires, requests are allowed again
    await expect(
      handleGetGigContactLink(store, {
        authUid: 'uid-scraper',
        hasAppCheck: true,
        clientIp: '197.200.1.10',
        gigId: `gig_${MAX_CONTACTS_PER_UID_PER_HOUR + 1}`,
        lang: 'dar',
        nowMs: t0 + RATE_WINDOW_MS + 1
      })
    ).resolves.toMatchObject({ waUrl: expect.stringContaining('https://wa.me/2135550100') });
  });

  it('blocks anonymous UID-cycling Sybil harvesting from the same IP', async () => {
    const gigs: Record<string, GigRecord> = {};
    const contacts: Record<string, string> = {};
    for (let i = 1; i <= MAX_CONTACTS_PER_IP_PER_HOUR + 2; i += 1) {
      gigs[`gig_${i}`] = { status: 'active', isSample: false };
      contacts[`gig_${i}`] = `+2136610100${String(i).padStart(2, '0')}`;
    }
    const store = createMemoryStore(gigs, contacts);
    const t0 = 1_700_000_000_000;

    // Attacker mints a brand-new anonymous UID for every single request from one IP
    for (let i = 1; i <= MAX_CONTACTS_PER_IP_PER_HOUR; i += 1) {
      await expect(
        handleGetGigContactLink(store, {
          authUid: `sybil-uid-${i}`,
          hasAppCheck: true,
          clientIp: '197.200.9.9',
          gigId: `gig_${i}`,
          lang: 'fr',
          nowMs: t0 + i * 100
        })
      ).resolves.toHaveProperty('waUrl');
    }

    // Request #16 from a fresh anonymous UID on the same IP MUST be blocked
    await expect(
      handleGetGigContactLink(store, {
        authUid: 'sybil-uid-overflow',
        hasAppCheck: true,
        clientIp: '197.200.9.9',
        gigId: `gig_${MAX_CONTACTS_PER_IP_PER_HOUR + 1}`,
        lang: 'fr',
        nowMs: t0 + 5000
      })
    ).rejects.toMatchObject<Partial<ContactHandlerError>>({ code: 'resource-exhausted' });
  });
});
