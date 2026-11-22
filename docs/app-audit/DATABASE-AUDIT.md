# Stage 04 — Database Integrity Audit (Updated After Medium-Priority Repairs)

## Repaired Findings

- **`DB-001` (`FIXED & VERIFIED`):** Updated `getAdminQueue()` in `src/lib/db.ts` to explicitly specify `where('flags', '>', 0), orderBy('flags', 'asc'), orderBy('createdAt', 'desc')` matching `firestore.indexes.json` (`flags ASC, createdAt DESC`). Verified directly against the live Firestore Emulator in `tests/rules/firestore.rules.test.ts` (`PASS`).
- **`DB-002` (`FIXED & VERIFIED`):** Replaced sequential `setDoc`/`updateDoc` loops in `seedSamples()` and `removeAllSamples()` with chunked atomic `writeBatch(db)` capped at `BATCH_LIMIT = 400` operations per batch.

- **`DB-003` (`FIXED & VERIFIED`):** Added localized `browse.filterPartial` status notice (`role="status"`) in `src/pages/Browse.tsx` whenever category/neighborhood filters are active and `lastDoc !== null`, clearly informing users that filters cover the currently loaded listings and prompting "Load more" for older gigs.

## Remaining Open Database Findings
- None.
