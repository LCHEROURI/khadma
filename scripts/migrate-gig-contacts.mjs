#!/usr/bin/env node
/**
 * One-time migration helper for SEC-001:
 * Moves legacy posterPhone / counterId fields from public gigs/{id} docs
 * into private gigContacts/{id} docs and strips them from gigs/{id}.
 *
 * Safety invariants:
 * - Defaults to --dry-run (read-only). Pass --apply ONLY after explicit approval
 *   and after deploying the getGigContactLink Cloud Function + updated PWA Hosting.
 * - Never overwrites an existing valid private gigContacts/{id} record.
 * - Verifies gigContacts/{id} contains a valid E.164 posterPhone BEFORE stripping
 *   legacy public fields from gigs/{id}.
 * - Safe to rerun (idempotent) and resilient to per-document partial failures.
 *
 * Usage:
 *   node scripts/migrate-gig-contacts.mjs --project khadma-oran          # dry run
 *   node scripts/migrate-gig-contacts.mjs --project khadma-oran --apply  # live write
 */

import { pathToFileURL } from 'node:url';

const E164_DZ_RE = /^\+213[567]\d{8}$/;

export function isValidDzPhone(value) {
  return typeof value === 'string' && E164_DZ_RE.test(value);
}

/**
 * Core migration runner (dependency-injected for deterministic unit testing).
 * @param {object} store
 * @param {{ apply?: boolean, log?: (msg: string) => void }} options
 */
export async function migrateLegacyGigContacts(store, options = {}) {
  const apply = Boolean(options.apply);
  const log = options.log ?? ((msg) => console.log(msg));

  const stats = {
    totalScanned: 0,
    legacyFound: 0,
    samplesCleaned: 0,
    contactsCreated: 0,
    contactsPreserved: 0,
    publicFieldsStripped: 0,
    skippedInvalid: 0,
    failed: 0,
    failedIds: []
  };

  const gigs = await store.listGigs();
  stats.totalScanned = gigs.length;

  for (const gig of gigs) {
    const data = gig.data ?? {};
    const hasLegacyPhone = typeof data.posterPhone === 'string';
    const hasLegacyCounter = typeof data.counterId === 'string';
    if (!hasLegacyPhone && !hasLegacyCounter) continue;

    stats.legacyFound += 1;
    const isSample = data.isSample === true || data.posterPhone === 'sample';
    log(`  [${gig.id}] status=${String(data.status ?? 'unknown')} isSample=${isSample}`);

    if (!apply) continue;

    try {
      if (isSample) {
        await store.stripLegacyGigFields(gig.id, typeof data.posterUid === 'string' ? data.posterUid : 'sample');
        stats.samplesCleaned += 1;
        stats.publicFieldsStripped += 1;
        continue;
      }

      const existingContact = await store.getContact(gig.id);
      const hasValidExisting = isValidDzPhone(existingContact?.posterPhone);

      if (hasValidExisting) {
        // Never overwrite an existing valid private contact record.
        stats.contactsPreserved += 1;
      } else {
        if (!isValidDzPhone(data.posterPhone)) {
          log(`  [SKIP] ${gig.id}: legacy posterPhone is missing or invalid; public doc left untouched.`);
          stats.skippedInvalid += 1;
          continue;
        }
        await store.createContact(gig.id, {
          posterPhone: data.posterPhone,
          counterId: isValidDzPhone(data.counterId) ? data.counterId : data.posterPhone,
          posterUid: typeof data.posterUid === 'string' ? data.posterUid : 'legacy',
          createdAt: data.createdAt ?? null
        });
        stats.contactsCreated += 1;
      }

      // Mandatory verify-before-strip: confirm private contact exists and is valid
      // before deleting legacy public fields from gigs/{id}.
      const verifiedContact = await store.getContact(gig.id);
      if (!isValidDzPhone(verifiedContact?.posterPhone)) {
        throw new Error(`Post-write verification failed for gigContacts/${gig.id}`);
      }

      await store.stripLegacyGigFields(gig.id, typeof data.posterUid === 'string' ? data.posterUid : 'legacy');
      stats.publicFieldsStripped += 1;
    } catch (err) {
      stats.failed += 1;
      stats.failedIds.push(gig.id);
      log(`  [ERROR] ${gig.id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return stats;
}

async function runCli() {
  const { initializeApp, applicationDefault } = await import('firebase-admin/app');
  const { FieldValue, getFirestore } = await import('firebase-admin/firestore');

  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const projectIdx = args.indexOf('--project');
  const projectId = projectIdx >= 0 ? args[projectIdx + 1] : 'khadma-oran';

  initializeApp({ credential: applicationDefault(), projectId });
  const db = getFirestore();

  console.log(`SEC-001 migration (${apply ? 'APPLY' : 'DRY-RUN'}) on project: ${projectId}`);

  const store = {
    async listGigs() {
      const snap = await db.collection('gigs').get();
      return snap.docs.map((d) => ({ id: d.id, data: d.data() }));
    },
    async getContact(gigId) {
      const snap = await db.collection('gigContacts').doc(gigId).get();
      return snap.exists ? snap.data() : null;
    },
    async createContact(gigId, payload) {
      await db.collection('gigContacts').doc(gigId).create({
        posterPhone: payload.posterPhone,
        counterId: payload.counterId,
        posterUid: payload.posterUid,
        createdAt: payload.createdAt ?? FieldValue.serverTimestamp()
      });
    },
    async stripLegacyGigFields(gigId, posterUid) {
      await db.collection('gigs').doc(gigId).update({
        posterPhone: FieldValue.delete(),
        counterId: FieldValue.delete(),
        posterUid
      });
    }
  };

  const stats = await migrateLegacyGigContacts(store, { apply });
  console.log('Migration summary:', JSON.stringify(stats, null, 2));
  if (stats.failed > 0) {
    process.exitCode = 1;
  }
}

const isDirectExecution =
  typeof process !== 'undefined' &&
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  runCli().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
