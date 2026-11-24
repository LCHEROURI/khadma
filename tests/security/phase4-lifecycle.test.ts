import { describe, expect, it } from 'vitest';
import {
  handleManageEmployerListing,
  type AuditRecordInput,
  type IdempotencyRecord,
  type ListingStore,
  type StoredEmployerProfile,
  type StoredGig,
  type StoredModerationSettings
} from '../../functions/src/listingHandler';
import { ADMIN_EMAIL, handleAdminManageMarketplace, type AdminStore } from '../../functions/src/adminHandler';
import { runExpireStaleGigs, type ExpirationStore } from '../../functions/src/expirationHandler';
import {
  LEGACY_EMPLOYER_MAX_ACTIVE_GIGS,
  LISTING_LIFESPAN_MS,
  LISTING_RENEWAL_WINDOW_MS,
  NEW_EMPLOYER_MAX_ACTIVE_GIGS
} from '../../functions/src/types';
import {
  initMarketplaceSettings,
  migrateLegacyEmployers
} from '../../scripts/migrate-legacy-employers.mjs';

interface MemDb {
  employers: Map<string, StoredEmployerProfile>;
  gigs: Map<string, StoredGig>;
  contacts: Map<string, Record<string, unknown>>;
  settings: StoredModerationSettings | Record<string, unknown> | null;
  idempotency: Map<string, IdempotencyRecord>;
  auditLogs: AuditRecordInput[];
  seq: number;
}

function createInMemoryMarketplace(
  initialSettings: StoredModerationSettings | Record<string, unknown> | null = {
    requirePreApproval: false,
    remoderateMaterialEdits: true
  }
): {
  db: MemDb;
  listingStore: ListingStore;
  adminStore: AdminStore;
  expirationStore: ExpirationStore;
} {
  const db: MemDb = {
    employers: new Map(),
    gigs: new Map(),
    contacts: new Map(),
    settings: initialSettings ? { ...initialSettings } : null,
    idempotency: new Map(),
    auditLogs: [],
    seq: 0
  };

  // Serialize transactions to mirror Firestore optimistic/atomic transaction semantics
  let txChain = Promise.resolve();
  function runAtomic<T>(fn: () => Promise<T>): Promise<T> {
    const next = txChain.then(fn, fn);
    txChain = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  const makeTx = () => ({
    async getEmployer(uid: string) {
      const e = db.employers.get(uid);
      return e ? { ...e } : null;
    },
    setEmployer(uid: string, data: StoredEmployerProfile) {
      db.employers.set(uid, { ...data });
    },
    async getModerationSettings() {
      return db.settings ? ({ ...db.settings } as StoredModerationSettings) : null;
    },
    setModerationSettings(data: StoredModerationSettings) {
      db.settings = { ...data };
    },
    async getGig(gigId: string) {
      const g = db.gigs.get(gigId);
      return g ? { ...g } : null;
    },
    async listEmployerGigs(uid: string) {
      return Array.from(db.gigs.values())
        .filter((g) => g.posterUid === uid)
        .map((g) => ({ ...g }));
    },
    createGig(data: Omit<StoredGig, 'id'>) {
      db.seq += 1;
      const id = `gig_${db.seq}`;
      db.gigs.set(id, { id, ...data });
      return id;
    },
    updateGig(gigId: string, patch: Partial<Omit<StoredGig, 'id'>>) {
      const cur = db.gigs.get(gigId);
      if (cur) db.gigs.set(gigId, { ...cur, ...patch });
    },
    setGigContact(gigId: string, data: Record<string, unknown>) {
      db.contacts.set(gigId, { ...data });
    },
    async getIdempotency(key: string) {
      return db.idempotency.get(key) ?? null;
    },
    setIdempotency(key: string, record: IdempotencyRecord) {
      db.idempotency.set(key, { ...record });
    },
    writeAuditLog(entry: AuditRecordInput) {
      db.auditLogs.push({ ...entry });
    }
  });

  return {
    db,
    listingStore: {
      runTransaction: (fn) => runAtomic(() => fn(makeTx()))
    },
    adminStore: {
      runTransaction: (fn) => runAtomic(() => fn(makeTx()))
    },
    expirationStore: {
      async findStaleActiveGigIds(nowMs, batchSize, afterId) {
        const all = Array.from(db.gigs.values())
          .filter(
            (g) =>
              g.status === 'active' &&
              typeof g.expiresAt === 'number' &&
              g.expiresAt <= nowMs
          )
          .sort((a, b) => (a.expiresAt! - b.expiresAt!) || a.id.localeCompare(b.id));
        const startIdx = afterId ? all.findIndex((g) => g.id === afterId) + 1 : 0;
        return all.slice(startIdx, startIdx + batchSize).map((g) => g.id);
      },
      runTransaction: (fn) => runAtomic(() => fn(makeTx()))
    }
  };
}

const NOW = 1_760_000_000_000;

function validCreatePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    action: 'create',
    title: 'Électricien bâtiment — Es Sénia',
    description: 'Chantier résidentiel à Es Sénia, paiement hebdomadaire.',
    category: 'construction',
    listingType: 'job',
    payMin: 3500,
    payMax: 4500,
    neighborhood: 'Es Sénia',
    city: 'oran',
    wilayaCode: '31',
    contactMethods: ['whatsapp', 'email'],
    contactPhone: '0550 12 34 56',
    whatsappConsent: true,
    contactEmail: 'recrutement@oran-elec.dz',
    emailConsent: true,
    ...overrides
  };
}

describe('KHADMA V1.4 Phase 4 — Employer Lifecycle, Quotas, Expiration & Admin Moderation', () => {
  it('provisions verified email employer (quota 3), blocks unverified/new-phone accounts, enforces Oran-only and field allowlist', async () => {
    const { db, listingStore } = createInMemoryMarketplace();

    // Unverified email -> rejected
    await expect(
      handleManageEmployerListing(listingStore, {
        authUid: 'u_unver',
        authEmail: 'u@oran.dz',
        authEmailVerified: false,
        authPhone: null,
        hasAppCheck: true,
        payload: validCreatePayload(),
        nowMs: NOW
      })
    ).rejects.toMatchObject({ code: 'permission-denied' });

    // Brand-new phone-only account (NOT grandfathered in employers/{uid}) -> rejected!
    await expect(
      handleManageEmployerListing(listingStore, {
        authUid: 'u_new_phone',
        authEmail: null,
        authEmailVerified: false,
        authPhone: '+213555099999',
        hasAppCheck: true,
        payload: validCreatePayload(),
        nowMs: NOW
      })
    ).rejects.toMatchObject({ code: 'permission-denied' });

    // Client spoofing unknown/privileged fields (status, maxActiveGigs, legacyGrandfathered) -> rejected!
    await expect(
      handleManageEmployerListing(listingStore, {
        authUid: 'u_emp1',
        authEmail: 'emp1@oran.dz',
        authEmailVerified: true,
        authPhone: null,
        hasAppCheck: true,
        payload: validCreatePayload({ maxActiveGigs: 99 }),
        nowMs: NOW
      })
    ).rejects.toMatchObject({ code: 'invalid-argument' });

    // Non-Oran city -> rejected!
    await expect(
      handleManageEmployerListing(listingStore, {
        authUid: 'u_emp1',
        authEmail: 'emp1@oran.dz',
        authEmailVerified: true,
        authPhone: null,
        hasAppCheck: true,
        payload: validCreatePayload({ city: 'algiers', wilayaCode: '16' }),
        nowMs: NOW
      })
    ).rejects.toMatchObject({ code: 'invalid-argument' });

    // Verified email employer -> provisions employers/{uid} with quota 3, publishes immediately (moderation OFF by default)
    const created = await handleManageEmployerListing(listingStore, {
      authUid: 'u_emp1',
      authEmail: 'emp1@oran.dz',
      authEmailVerified: true,
      authPhone: null,
      hasAppCheck: true,
      payload: validCreatePayload({ idempotencyKey: 'create_req_001' }),
      nowMs: NOW
    });

    expect(created.status).toBe('active');
    expect(created.quotaMax).toBe(NEW_EMPLOYER_MAX_ACTIVE_GIGS);
    expect(created.quotaUsed).toBe(1);
    expect(created.expiresAtMs).toBe(NOW + LISTING_LIFESPAN_MS);

    // Public gig has NO raw phone/email; private gigContacts stores normalized phone & email
    const pubGig = db.gigs.get(created.gigId)!;
    expect(pubGig.city).toBe('oran');
    expect(pubGig.wilayaCode).toBe('31');
    expect(pubGig.contactMethods).toEqual(['whatsapp', 'email']);
    expect(JSON.stringify(pubGig)).not.toContain('213550123456');
    expect(JSON.stringify(pubGig)).not.toContain('recrutement@oran-elec.dz');
    expect(db.contacts.get(created.gigId)).toMatchObject({
      contactPhone: '+213550123456',
      contactEmail: 'recrutement@oran-elec.dz',
      whatsappConsent: true,
      emailConsent: true
    });

    // Duplicate submission with same idempotencyKey replays without creating a 2nd ad or consuming quota
    const replay = await handleManageEmployerListing(listingStore, {
      authUid: 'u_emp1',
      authEmail: 'emp1@oran.dz',
      authEmailVerified: true,
      authPhone: null,
      hasAppCheck: true,
      payload: validCreatePayload({ idempotencyKey: 'create_req_001' }),
      nowMs: NOW + 500
    });
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.gigId).toBe(created.gigId);
    expect(db.gigs.size).toBe(1);
    expect(db.employers.get('u_emp1')?.activeCount).toBe(1);
  });

  it('enforces 3-ad quota under concurrent creation at boundary and preserves 5-ad grandfathered legacy quota', async () => {
    const { db, listingStore } = createInMemoryMarketplace();

    // Create 2 ads for new employer u_race (1 slot remaining out of 3)
    for (let i = 0; i < 2; i++) {
      await handleManageEmployerListing(listingStore, {
        authUid: 'u_race',
        authEmail: 'race@oran.dz',
        authEmailVerified: true,
        authPhone: null,
        hasAppCheck: true,
        payload: validCreatePayload({ title: `Poste ${i + 1} Oran` }),
        nowMs: NOW + i
      });
    }

    // Fire 5 concurrent creates for the 1 remaining slot -> strictly 1 succeeds, 4 fail
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, idx) =>
        handleManageEmployerListing(listingStore, {
          authUid: 'u_race',
          authEmail: 'race@oran.dz',
          authEmailVerified: true,
          authPhone: null,
          hasAppCheck: true,
          payload: validCreatePayload({ title: `Concurrent ${idx}` }),
          nowMs: NOW + 100 + idx
        })
      )
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(4);
    expect(db.employers.get('u_race')?.activeCount).toBe(3);

    // Explicitly grandfathered legacy phone UID (provisioned via migration) gets 5 slots
    db.employers.set('u_legacy', {
      uid: 'u_legacy',
      email: null,
      legacyPhone: '+213555011111',
      legacyGrandfathered: true,
      legacyCutoffVerified: true,
      maxActiveGigs: LEGACY_EMPLOYER_MAX_ACTIVE_GIGS,
      activeCount: 0,
      trustLevel: 'new',
      suspended: false
    });
    for (let i = 0; i < 5; i++) {
      const res = await handleManageEmployerListing(listingStore, {
        authUid: 'u_legacy',
        authEmail: null,
        authEmailVerified: false,
        authPhone: '+213555011111',
        hasAppCheck: true,
        payload: validCreatePayload({ title: `Legacy Ad ${i + 1}` }),
        nowMs: NOW + i
      });
      expect(res.quotaMax).toBe(5);
    }
    await expect(
      handleManageEmployerListing(listingStore, {
        authUid: 'u_legacy',
        authEmail: null,
        authEmailVerified: false,
        authPhone: '+213555011111',
        hasAppCheck: true,
        payload: validCreatePayload({ title: 'Legacy Ad 6' }),
        nowMs: NOW + 50
      })
    ).rejects.toMatchObject({ code: 'resource-exhausted' });
  });

  it('enforces final-7-day renewal, prevents stacked/concurrent renewals, runs idempotent scheduled expiration, and reconciles drift', async () => {
    const { db, listingStore, expirationStore } = createInMemoryMarketplace();

    const created = await handleManageEmployerListing(listingStore, {
      authUid: 'u_exp',
      authEmail: 'exp@oran.dz',
      authEmailVerified: true,
      authPhone: null,
      hasAppCheck: true,
      payload: validCreatePayload(),
      nowMs: NOW
    });
    const initialExpiry = created.expiresAtMs!;

    // Premature renewal (day 10 — outside final 7 days) -> rejected
    await expect(
      handleManageEmployerListing(listingStore, {
        authUid: 'u_exp',
        authEmail: 'exp@oran.dz',
        authEmailVerified: true,
        authPhone: null,
        hasAppCheck: true,
        payload: { action: 'renew', gigId: created.gigId },
        nowMs: NOW + 10 * 24 * 60 * 60 * 1000
      })
    ).rejects.toMatchObject({ code: 'failed-precondition' });

    // Renewal inside final 7 days (day 26) -> extends by 30 days from EXISTING expiresAt
    const day26 = initialExpiry - LISTING_RENEWAL_WINDOW_MS + 1000;
    const renewed = await handleManageEmployerListing(listingStore, {
      authUid: 'u_exp',
      authEmail: 'exp@oran.dz',
      authEmailVerified: true,
      authPhone: null,
      hasAppCheck: true,
      payload: { action: 'renew', gigId: created.gigId },
      nowMs: day26
    });
    expect(renewed.expiresAtMs).toBe(initialExpiry + LISTING_LIFESPAN_MS);

    // Immediate second renewal attempt -> rejected (no stacking!)
    await expect(
      handleManageEmployerListing(listingStore, {
        authUid: 'u_exp',
        authEmail: 'exp@oran.dz',
        authEmailVerified: true,
        authPhone: null,
        hasAppCheck: true,
        payload: { action: 'renew', gigId: created.gigId },
        nowMs: day26 + 500
      })
    ).rejects.toMatchObject({ code: 'failed-precondition' });

    // Simulate counter drift + past expiration, then run scheduled expireStaleGigs twice (idempotent)
    db.employers.get('u_exp')!.activeCount = 4; // artificial drift
    const afterExpiry = renewed.expiresAtMs! + 1000;
    const run1 = await runExpireStaleGigs(expirationStore, afterExpiry);
    expect(run1.expiredCount).toBe(1);
    expect(run1.driftReconciledCount).toBe(1);
    expect(db.gigs.get(created.gigId)?.status).toBe('expired');
    expect(db.employers.get('u_exp')?.activeCount).toBe(0);
    expect(db.auditLogs.some((l) => l.action === 'counter_reconciled')).toBe(true);

    // Second scheduler run is a no-op
    const run2 = await runExpireStaleGigs(expirationStore, afterExpiry + 60_000);
    expect(run2.expiredCount).toBe(0);

    // Republishing expired ad succeeds with fresh 30-day expiration
    const repub = await handleManageEmployerListing(listingStore, {
      authUid: 'u_exp',
      authEmail: 'exp@oran.dz',
      authEmailVerified: true,
      authPhone: null,
      hasAppCheck: true,
      payload: { action: 'republish', gigId: created.gigId },
      nowMs: afterExpiry + 120_000
    });
    expect(repub.status).toBe('active');
    expect(repub.expiresAtMs).toBe(afterExpiry + 120_000 + LISTING_LIFESPAN_MS);
    expect(repub.quotaUsed).toBe(1);
  });

  it('enforces runtime moderation toggle (non-retroactive), material edits, admin actions, suspension, consent revocation, and non-PII audit logs', async () => {
    const { db, listingStore, adminStore } = createInMemoryMarketplace();

    // 1. Moderation OFF at launch -> ad #1 publishes immediately as active
    const ad1 = await handleManageEmployerListing(listingStore, {
      authUid: 'u_mod',
      authEmail: 'mod@oran.dz',
      authEmailVerified: true,
      authPhone: null,
      hasAppCheck: true,
      payload: validCreatePayload({ title: 'Annonce Initiale Active' }),
      nowMs: NOW
    });
    expect(ad1.status).toBe('active');

    // Non-admin attempting adminManageMarketplace -> DENIED
    await expect(
      handleAdminManageMarketplace(adminStore, {
        authUid: 'u_mod',
        authEmail: 'mod@oran.dz',
        authEmailVerified: true,
        hasAppCheck: true,
        payload: { action: 'updateModerationSettings', requirePreApproval: true },
        nowMs: NOW
      })
    ).rejects.toMatchObject({ code: 'permission-denied' });

    // 2. Admin enables mandatory pre-approval at runtime -> ad #1 remains active (non-retroactive!)
    await handleAdminManageMarketplace(adminStore, {
      authUid: 'admin_1',
      authEmail: ADMIN_EMAIL,
      authEmailVerified: true,
      hasAppCheck: true,
      payload: { action: 'updateModerationSettings', requirePreApproval: true, remoderateMaterialEdits: true },
      nowMs: NOW + 1000
    });
    expect(db.gigs.get(ad1.gigId)?.status).toBe('active');

    // 3. New ad #2 enters pending with expiresAt = null until approved
    const ad2 = await handleManageEmployerListing(listingStore, {
      authUid: 'u_mod',
      authEmail: 'mod@oran.dz',
      authEmailVerified: true,
      authPhone: null,
      hasAppCheck: true,
      payload: validCreatePayload({ title: 'Annonce En Attente' }),
      nowMs: NOW + 2000
    });
    expect(ad2.status).toBe('pending');
    expect(ad2.expiresAtMs).toBeNull();

    // 4. Contact-only update on ad #1 keeps it active & revokes email consent
    const contactUpdated = await handleManageEmployerListing(listingStore, {
      authUid: 'u_mod',
      authEmail: 'mod@oran.dz',
      authEmailVerified: true,
      authPhone: null,
      hasAppCheck: true,
      payload: {
        action: 'updateContact',
        gigId: ad1.gigId,
        contactMethods: ['whatsapp'],
        contactPhone: '+213550123456',
        whatsappConsent: true
      },
      nowMs: NOW + 3000
    });
    expect(contactUpdated.status).toBe('active');
    expect(db.contacts.get(ad1.gigId)).toMatchObject({ emailConsent: false, contactEmail: null });

    // 5. Material edit on ad #1 while pre-approval is ON moves it to pending
    const edited = await handleManageEmployerListing(listingStore, {
      authUid: 'u_mod',
      authEmail: 'mod@oran.dz',
      authEmailVerified: true,
      authPhone: null,
      hasAppCheck: true,
      payload: {
        action: 'edit',
        gigId: ad1.gigId,
        title: 'Titre Modifié Matériellement',
        description: 'Description modifiée.',
        category: 'construction',
        listingType: 'job',
        payMin: 4000,
        payMax: 5000,
        neighborhood: 'Es Sénia'
      },
      nowMs: NOW + 4000
    });
    expect(edited.status).toBe('pending');

    // Cross-employer edit attempt -> DENIED
    await expect(
      handleManageEmployerListing(listingStore, {
        authUid: 'u_attacker',
        authEmail: 'atk@oran.dz',
        authEmailVerified: true,
        authPhone: null,
        hasAppCheck: true,
        payload: { action: 'archive', gigId: ad1.gigId },
        nowMs: NOW + 4500
      })
    ).rejects.toMatchObject({ code: 'permission-denied' });

    // 6. Admin approves ad #2 -> activates with 30-day expiration from approval time
    const approveTime = NOW + 5000;
    await handleAdminManageMarketplace(adminStore, {
      authUid: 'admin_1',
      authEmail: ADMIN_EMAIL,
      authEmailVerified: true,
      hasAppCheck: true,
      payload: { action: 'approveGig', gigId: ad2.gigId },
      nowMs: approveTime
    });
    expect(db.gigs.get(ad2.gigId)?.status).toBe('active');
    expect(db.gigs.get(ad2.gigId)?.expiresAt).toBe(approveTime + LISTING_LIFESPAN_MS);

    // 7. Admin suspends employer -> atomically hides active/pending ads, zeroes activeCount, blocks further actions
    const susp = await handleAdminManageMarketplace(adminStore, {
      authUid: 'admin_1',
      authEmail: ADMIN_EMAIL,
      authEmailVerified: true,
      hasAppCheck: true,
      payload: { action: 'suspendEmployer', employerUid: 'u_mod', reason: 'Repeated scam reports' },
      nowMs: NOW + 6000
    });
    expect(susp.hiddenActiveCount).toBe(2);
    expect(db.gigs.get(ad1.gigId)?.status).toBe('hidden');
    expect(db.gigs.get(ad2.gigId)?.status).toBe('hidden');
    expect(db.employers.get('u_mod')?.activeCount).toBe(0);

    await expect(
      handleManageEmployerListing(listingStore, {
        authUid: 'u_mod',
        authEmail: 'mod@oran.dz',
        authEmailVerified: true,
        authPhone: null,
        hasAppCheck: true,
        payload: { action: 'republish', gigId: ad2.gigId },
        nowMs: NOW + 7000
      })
    ).rejects.toMatchObject({ code: 'permission-denied' });

    // 8. Audit log privacy check: ZERO private phone numbers or contact emails leaked in auditLogs
    const auditBlob = JSON.stringify(db.auditLogs);
    expect(auditBlob).not.toContain('213550123456');
    expect(auditBlob).not.toContain('recrutement@oran-elec.dz');
  });

  it('runs legacy employer migration deterministically (dry-run vs apply, pre-cutoff only, idempotent)', async () => {
    const cutoffMs = Date.parse('2026-11-24T00:00:00Z');
    const employers = new Map<string, Record<string, unknown>>();
    const store = {
      async getEmployer(uid: string) {
        return employers.get(uid) ?? null;
      },
      async setEmployer(uid: string, data: Record<string, unknown>) {
        employers.set(uid, data);
      },
      async listEmployerGigs(uid: string) {
        return uid === 'legacy_uid' ? [{ status: 'active' }, { status: 'archived' }] : [];
      }
    };
    const authUsers = [
      { uid: 'legacy_uid', phoneNumber: '+213555010000', email: null, metadata: { creationTime: '2026-11-20T10:00:00Z' } },
      { uid: 'new_phone_uid', phoneNumber: '+213555099999', email: null, metadata: { creationTime: '2026-11-25T10:00:00Z' } }
    ];

    // Dry-run performs 0 writes
    const dry = await migrateLegacyEmployers({ authUsers, store, cutoffMs, apply: false });
    expect(dry.eligibleLegacy).toBe(1);
    expect(dry.skippedPostCutoff).toBe(1);
    expect(employers.size).toBe(0);

    // Apply migrates ONLY pre-cutoff UID with quota 5 and reconciled activeCount = 1
    const applied = await migrateLegacyEmployers({ authUsers, store, cutoffMs, apply: true });
    expect(applied.created).toBe(1);
    expect(employers.get('legacy_uid')).toMatchObject({
      legacyGrandfathered: true,
      legacyCutoffVerified: true,
      maxActiveGigs: 5,
      activeCount: 1
    });
    expect(employers.has('new_phone_uid')).toBe(false);

    // Idempotent rerun -> unchanged = 1
    const rerun = await migrateLegacyEmployers({ authUsers, store, cutoffMs, apply: true });
    expect(rerun.unchanged).toBe(1);
    expect(rerun.created).toBe(0);
  });

  it('fails safely to pending moderation when settings/marketplace is missing or malformed, and blocks trusted-employer bypass', async () => {
    // 1. Missing settings/marketplace (null) -> fails safely to pending
    const missingCtx = createInMemoryMarketplace(null);
    const missingAd = await handleManageEmployerListing(missingCtx.listingStore, {
      authUid: 'u_missing_cfg',
      authEmail: 'missing@oran.dz',
      authEmailVerified: true,
      authPhone: null,
      hasAppCheck: true,
      payload: validCreatePayload({ title: 'Missing Settings Ad' }),
      nowMs: NOW
    });
    expect(missingAd.status).toBe('pending');
    expect(missingAd.expiresAtMs).toBeNull();

    // 2. Malformed settings/marketplace (requirePreApproval is string instead of boolean) -> fails safely to pending
    const malformedCtx = createInMemoryMarketplace({
      requirePreApproval: 'false',
      remoderateMaterialEdits: 'no'
    });
    const malformedAd = await handleManageEmployerListing(malformedCtx.listingStore, {
      authUid: 'u_malformed_cfg',
      authEmail: 'malformed@oran.dz',
      authEmailVerified: true,
      authPhone: null,
      hasAppCheck: true,
      payload: validCreatePayload({ title: 'Malformed Settings Ad' }),
      nowMs: NOW
    });
    expect(malformedAd.status).toBe('pending');
    expect(malformedAd.expiresAtMs).toBeNull();

    // 3. Trusted employer CANNOT bypass mandatory pre-approval when requirePreApproval === true
    const onCtx = createInMemoryMarketplace({
      requirePreApproval: true,
      remoderateMaterialEdits: true
    });
    onCtx.db.employers.set('u_trusted', {
      uid: 'u_trusted',
      email: 'trusted@oran.dz',
      legacyPhone: null,
      legacyGrandfathered: false,
      legacyCutoffVerified: false,
      maxActiveGigs: 3,
      activeCount: 0,
      trustLevel: 'trusted',
      suspended: false
    });
    const trustedAd = await handleManageEmployerListing(onCtx.listingStore, {
      authUid: 'u_trusted',
      authEmail: 'trusted@oran.dz',
      authEmailVerified: true,
      authPhone: null,
      hasAppCheck: true,
      payload: validCreatePayload({ title: 'Trusted Employer Ad' }),
      nowMs: NOW
    });
    expect(trustedAd.status).toBe('pending');
    expect(trustedAd.expiresAtMs).toBeNull();
  });

  it('rejects idempotencyKey reuse with a different payload and isolates keys by employer and action', async () => {
    const { db, listingStore } = createInMemoryMarketplace();

    const first = await handleManageEmployerListing(listingStore, {
      authUid: 'u_idem_a',
      authEmail: 'idema@oran.dz',
      authEmailVerified: true,
      authPhone: null,
      hasAppCheck: true,
      payload: validCreatePayload({ idempotencyKey: 'shared_key_001', title: 'Annonce Originale' }),
      nowMs: NOW
    });
    expect(first.idempotentReplay).toBeFalsy();

    // Same employer + same action + same idempotencyKey + DIFFERENT payload -> rejected!
    await expect(
      handleManageEmployerListing(listingStore, {
        authUid: 'u_idem_a',
        authEmail: 'idema@oran.dz',
        authEmailVerified: true,
        authPhone: null,
        hasAppCheck: true,
        payload: validCreatePayload({ idempotencyKey: 'shared_key_001', title: 'Annonce Modifiée' }),
        nowMs: NOW + 100
      })
    ).rejects.toMatchObject({ code: 'failed-precondition' });

    // Different employer using the same idempotencyKey -> isolated, succeeds independently
    const otherEmp = await handleManageEmployerListing(listingStore, {
      authUid: 'u_idem_b',
      authEmail: 'idemb@oran.dz',
      authEmailVerified: true,
      authPhone: null,
      hasAppCheck: true,
      payload: validCreatePayload({ idempotencyKey: 'shared_key_001', title: 'Annonce Autre Employeur' }),
      nowMs: NOW + 200
    });
    expect(otherEmp.idempotentReplay).toBeFalsy();
    expect(otherEmp.gigId).not.toBe(first.gigId);

    // Same employer + DIFFERENT action ('archive') using same idempotencyKey -> isolated, succeeds
    const archived = await handleManageEmployerListing(listingStore, {
      authUid: 'u_idem_a',
      authEmail: 'idema@oran.dz',
      authEmailVerified: true,
      authPhone: null,
      hasAppCheck: true,
      payload: { action: 'archive', gigId: first.gigId, idempotencyKey: 'shared_key_001' },
      nowMs: NOW + 300
    });
    expect(archived.status).toBe('archived');
    expect(db.gigs.get(first.gigId)?.status).toBe('archived');
  });

  it('enforces quota boundary on admin restoreGig and preserves existing ads when lowering quota below activeCount', async () => {
    const { db, listingStore, adminStore } = createInMemoryMarketplace();

    // Employer creates 3 active ads (at maxActiveGigs = 3)
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await handleManageEmployerListing(listingStore, {
        authUid: 'u_quota_edge',
        authEmail: 'quota@oran.dz',
        authEmailVerified: true,
        authPhone: null,
        hasAppCheck: true,
        payload: validCreatePayload({ title: `Quota Ad ${i + 1}` }),
        nowMs: NOW + i
      });
      ids.push(res.gigId);
    }

    // Admin removes ad #1, employer creates ad #4 (now 3 active + 1 removed)
    await handleAdminManageMarketplace(adminStore, {
      authUid: 'admin_1',
      authEmail: ADMIN_EMAIL,
      authEmailVerified: true,
      hasAppCheck: true,
      payload: { action: 'removeGig', gigId: ids[0], reason: 'Temp removal' },
      nowMs: NOW + 10
    });
    await handleManageEmployerListing(listingStore, {
      authUid: 'u_quota_edge',
      authEmail: 'quota@oran.dz',
      authEmailVerified: true,
      authPhone: null,
      hasAppCheck: true,
      payload: validCreatePayload({ title: 'Quota Ad 4' }),
      nowMs: NOW + 20
    });
    expect(db.employers.get('u_quota_edge')?.activeCount).toBe(3);

    // Admin attempting to restore removed ad #1 while employer is already at 3/3 -> REJECTED!
    await expect(
      handleAdminManageMarketplace(adminStore, {
        authUid: 'admin_1',
        authEmail: ADMIN_EMAIL,
        authEmailVerified: true,
        hasAppCheck: true,
        payload: { action: 'restoreGig', gigId: ids[0] },
        nowMs: NOW + 30
      })
    ).rejects.toMatchObject({ code: 'resource-exhausted' });
    expect(db.gigs.get(ids[0])?.status).toBe('removed');

    // Admin lowers employer quota from 3 -> 1: existing 3 active ads stay active, new creates/republishes are blocked
    await handleAdminManageMarketplace(adminStore, {
      authUid: 'admin_1',
      authEmail: ADMIN_EMAIL,
      authEmailVerified: true,
      hasAppCheck: true,
      payload: {
        action: 'setEmployerQuota',
        employerUid: 'u_quota_edge',
        maxActiveGigs: 1,
        reason: 'Policy review quota reduction'
      },
      nowMs: NOW + 40
    });
    expect(db.employers.get('u_quota_edge')?.maxActiveGigs).toBe(1);
    expect(db.gigs.get(ids[1])?.status).toBe('active');
    expect(db.gigs.get(ids[2])?.status).toBe('active');

    await expect(
      handleManageEmployerListing(listingStore, {
        authUid: 'u_quota_edge',
        authEmail: 'quota@oran.dz',
        authEmailVerified: true,
        authPhone: null,
        hasAppCheck: true,
        payload: validCreatePayload({ title: 'Blocked Over Lowered Quota' }),
        nowMs: NOW + 50
      })
    ).rejects.toMatchObject({ code: 'resource-exhausted' });
  });

  it('detects expiration backlog exceeding batch capacity and drains cleanly on subsequent run', async () => {
    const { db, expirationStore } = createInMemoryMarketplace();

    // Seed 5 stale active gigs and run with batchSize=2, maxBatches=2 (capacity = 4)
    db.employers.set('u_stale', {
      uid: 'u_stale',
      email: 'stale@oran.dz',
      legacyPhone: null,
      legacyGrandfathered: false,
      legacyCutoffVerified: false,
      maxActiveGigs: 10,
      activeCount: 5,
      trustLevel: 'new',
      suspended: false
    });
    for (let i = 0; i < 5; i++) {
      db.gigs.set(`stale_${i}`, {
        id: `stale_${i}`,
        title: `Stale ${i}`,
        description: 'Expired listing',
        category: 'delivery',
        listingType: 'job',
        city: 'oran',
        wilayaCode: '31',
        contactMethods: ['whatsapp'],
        payMin: 2000,
        payMax: 3000,
        neighborhood: 'Gambetta',
        posterUid: 'u_stale',
        flags: 0,
        status: 'active',
        verified: false,
        isSample: false,
        createdAt: NOW - LISTING_LIFESPAN_MS - 10_000,
        updatedAt: NOW - LISTING_LIFESPAN_MS - 10_000,
        expiresAt: NOW - 5_000 + i * 100
      });
    }

    const run1 = await runExpireStaleGigs(expirationStore, NOW, 2, 2);
    expect(run1.expiredCount).toBe(4);
    expect(run1.hasBacklog).toBe(true);
    expect(db.employers.get('u_stale')?.activeCount).toBe(1);

    const run2 = await runExpireStaleGigs(expirationStore, NOW + 1000, 2, 2);
    expect(run2.expiredCount).toBe(1);
    expect(run2.hasBacklog).toBe(false);
    expect(db.employers.get('u_stale')?.activeCount).toBe(0);
  });

  it('initializes settings/marketplace explicitly via migration (dry-run, apply, idempotent rerun)', async () => {
    let stored: Record<string, unknown> | null = null;
    const store = {
      async getModerationSettings() {
        return stored;
      },
      async setModerationSettings(data: Record<string, unknown>) {
        stored = data;
      }
    };

    const dry = await initMarketplaceSettings({ store, apply: false, nowMs: NOW });
    expect(dry).toEqual({ initialized: true, alreadyExists: false, apply: false });
    expect(stored).toBeNull();

    const applied = await initMarketplaceSettings({ store, apply: true, nowMs: NOW });
    expect(applied).toEqual({ initialized: true, alreadyExists: false, apply: true });
    expect(stored).toMatchObject({
      requirePreApproval: false,
      remoderateMaterialEdits: true
    });

    const rerun = await initMarketplaceSettings({ store, apply: true, nowMs: NOW + 1000 });
    expect(rerun).toEqual({ initialized: false, alreadyExists: true, apply: true });
  });
});
