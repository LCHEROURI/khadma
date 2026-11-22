#!/usr/bin/env node
/**
 * One-time migration helper for SEC-001:
 * Moves legacy posterPhone / counterId fields from public gigs/{id} docs
 * into private gigContacts/{id} docs and strips them from gigs/{id}.
 *
 * Defaults to --dry-run (read-only). Pass --apply ONLY after explicit approval
 * and after deploying the contactGig Cloud Function + updated Hosting rewrites.
 *
 * Usage:
 *   node scripts/migrate-gig-contacts.mjs --project khadma-oran          # dry run
 *   node scripts/migrate-gig-contacts.mjs --project khadma-oran --apply  # live write
 */

import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const projectIdx = args.indexOf('--project');
const projectId = projectIdx >= 0 ? args[projectIdx + 1] : 'khadma-oran';

initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore();

async function main() {
  console.log(`SEC-001 migration (${apply ? 'APPLY' : 'DRY-RUN'}) on project: ${projectId}`);
  const snap = await db.collection('gigs').get();
  let legacyCount = 0;
  let migrated = 0;

  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    const hasLegacyPhone = typeof data.posterPhone === 'string';
    const hasLegacyCounter = typeof data.counterId === 'string';
    if (!hasLegacyPhone && !hasLegacyCounter) continue;

    legacyCount += 1;
    const isSample = data.isSample === true || data.posterPhone === 'sample';
    console.log(`  [${docSnap.id}] status=${data.status} isSample=${isSample}`);

    if (!apply) continue;

    const batch = db.batch();
    if (!isSample && typeof data.posterPhone === 'string') {
      batch.set(
        db.collection('gigContacts').doc(docSnap.id),
        {
          posterPhone: data.posterPhone,
          counterId: typeof data.counterId === 'string' ? data.counterId : data.posterPhone,
          posterUid: typeof data.posterUid === 'string' ? data.posterUid : 'legacy',
          createdAt: data.createdAt ?? FieldValue.serverTimestamp()
        },
        { merge: true }
      );
    }
    batch.update(docSnap.ref, {
      posterPhone: FieldValue.delete(),
      counterId: FieldValue.delete(),
      posterUid: typeof data.posterUid === 'string' ? data.posterUid : isSample ? 'sample' : 'legacy'
    });
    await batch.commit();
    migrated += 1;
  }

  console.log(`Done. Legacy docs found: ${legacyCount}. Migrated: ${migrated}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
