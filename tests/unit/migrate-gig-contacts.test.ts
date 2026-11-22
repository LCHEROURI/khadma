import { describe, expect, it } from 'vitest';
import { migrateLegacyGigContacts } from '../../scripts/migrate-gig-contacts.mjs';

interface GigDoc {
  status?: string;
  isSample?: boolean;
  posterPhone?: string;
  counterId?: string;
  posterUid?: string;
  createdAt?: unknown;
}

interface ContactDoc {
  posterPhone: string;
  counterId: string;
  posterUid: string;
  createdAt: unknown;
}

function createMemoryMigrationStore(
  initialGigs: Record<string, GigDoc>,
  initialContacts: Record<string, ContactDoc> = {},
  options: { failCreateFor?: Set<string>; failVerifyFor?: Set<string> } = {}
) {
  const gigs = new Map<string, GigDoc>(
    Object.entries(initialGigs).map(([k, v]) => [k, { ...v }])
  );
  const contacts = new Map<string, ContactDoc>(
    Object.entries(initialContacts).map(([k, v]) => [k, { ...v }])
  );
  const createCalls: string[] = [];
  const stripCalls: string[] = [];

  const store = {
    async listGigs() {
      return [...gigs.entries()].map(([id, data]) => ({ id, data: { ...data } }));
    },
    async getContact(gigId: string) {
      if (options.failVerifyFor?.has(gigId) && createCalls.includes(gigId)) {
        return null;
      }
      const c = contacts.get(gigId);
      return c ? { ...c } : null;
    },
    async createContact(gigId: string, payload: ContactDoc) {
      createCalls.push(gigId);
      if (options.failCreateFor?.has(gigId)) {
        throw new Error('Simulated Firestore write failure');
      }
      contacts.set(gigId, { ...payload });
    },
    async stripLegacyGigFields(gigId: string, posterUid: string) {
      stripCalls.push(gigId);
      const cur = gigs.get(gigId);
      if (!cur) return;
      const next = { ...cur, posterUid };
      delete next.posterPhone;
      delete next.counterId;
      gigs.set(gigId, next);
    }
  };

  return { store, gigs, contacts, createCalls, stripCalls };
}

describe('SEC-001 migrateLegacyGigContacts safety invariants', () => {
  it('dry-run counts legacy docs without performing any writes', async () => {
    const { store, createCalls, stripCalls } = createMemoryMigrationStore({
      g1: { status: 'active', isSample: false, posterPhone: '+213555010001', counterId: '+213555010001' },
      g_clean: { status: 'active', isSample: false, posterUid: 'u2' }
    });

    const stats = await migrateLegacyGigContacts(store, { apply: false, log: () => {} });
    expect(stats.totalScanned).toBe(2);
    expect(stats.legacyFound).toBe(1);
    expect(stats.contactsCreated).toBe(0);
    expect(stats.publicFieldsStripped).toBe(0);
    expect(createCalls).toEqual([]);
    expect(stripCalls).toEqual([]);
  });

  it('migrates missing contacts, cleans samples, and is idempotent on rerun', async () => {
    const { store, gigs, contacts } = createMemoryMigrationStore({
      g_real: { status: 'active', isSample: false, posterPhone: '+213555010001', counterId: '+213555010001' },
      g_sample: { status: 'active', isSample: true, posterPhone: 'sample', counterId: 'sample' }
    });

    const first = await migrateLegacyGigContacts(store, { apply: true, log: () => {} });
    expect(first.legacyFound).toBe(2);
    expect(first.contactsCreated).toBe(1);
    expect(first.samplesCleaned).toBe(1);
    expect(first.publicFieldsStripped).toBe(2);
    expect(first.failed).toBe(0);

    expect(contacts.get('g_real')?.posterPhone).toBe('+213555010001');
    expect(contacts.has('g_sample')).toBe(false);
    expect(gigs.get('g_real')?.posterPhone).toBeUndefined();
    expect(gigs.get('g_real')?.counterId).toBeUndefined();
    expect(gigs.get('g_sample')?.posterPhone).toBeUndefined();
    expect(gigs.get('g_sample')?.posterUid).toBe('sample');

    // Second run MUST be a clean no-op
    const second = await migrateLegacyGigContacts(store, { apply: true, log: () => {} });
    expect(second.legacyFound).toBe(0);
    expect(second.contactsCreated).toBe(0);
    expect(second.publicFieldsStripped).toBe(0);
  });

  it('never overwrites an existing valid private contact record', async () => {
    const { store, gigs, contacts, createCalls } = createMemoryMigrationStore(
      {
        g_hybrid: {
          status: 'active',
          isSample: false,
          posterPhone: '+213555010099',
          counterId: '+213555010099'
        }
      },
      {
        g_hybrid: {
          posterPhone: '+213661234567',
          counterId: '+213661234567',
          posterUid: 'uid-real',
          createdAt: 'ts'
        }
      }
    );

    const stats = await migrateLegacyGigContacts(store, { apply: true, log: () => {} });
    expect(stats.contactsPreserved).toBe(1);
    expect(stats.contactsCreated).toBe(0);
    expect(stats.publicFieldsStripped).toBe(1);
    expect(createCalls).toEqual([]);
    // Existing private contact MUST remain untouched
    expect(contacts.get('g_hybrid')?.posterPhone).toBe('+213661234567');
    expect(gigs.get('g_hybrid')?.posterPhone).toBeUndefined();
  });

  it('preserves public legacy fields on partial write or verification failure while continuing other docs', async () => {
    const { store, gigs, contacts } = createMemoryMigrationStore(
      {
        g_fail_write: { status: 'active', isSample: false, posterPhone: '+213555010010', counterId: '+213555010010' },
        g_fail_verify: { status: 'active', isSample: false, posterPhone: '+213555010011', counterId: '+213555010011' },
        g_invalid: { status: 'active', isSample: false, posterPhone: 'bad-phone', counterId: 'bad-phone' },
        g_ok: { status: 'active', isSample: false, posterPhone: '+213555010012', counterId: '+213555010012' }
      },
      {},
      {
        failCreateFor: new Set(['g_fail_write']),
        failVerifyFor: new Set(['g_fail_verify'])
      }
    );

    const stats = await migrateLegacyGigContacts(store, { apply: true, log: () => {} });
    expect(stats.failed).toBe(2);
    expect(stats.failedIds).toEqual(['g_fail_write', 'g_fail_verify']);
    expect(stats.skippedInvalid).toBe(1);
    expect(stats.publicFieldsStripped).toBe(1);

    // Failed and invalid docs MUST retain their legacy posterPhone (zero data loss)
    expect(gigs.get('g_fail_write')?.posterPhone).toBe('+213555010010');
    expect(gigs.get('g_fail_verify')?.posterPhone).toBe('+213555010011');
    expect(gigs.get('g_invalid')?.posterPhone).toBe('bad-phone');

    // Healthy doc migrated cleanly
    expect(contacts.get('g_ok')?.posterPhone).toBe('+213555010012');
    expect(gigs.get('g_ok')?.posterPhone).toBeUndefined();
  });
});
