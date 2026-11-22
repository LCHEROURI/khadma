# Stage 04 — Database Integrity Audit

- **Mode:** Read-only (zero production data touched)
- **Database:** Cloud Firestore (`khadma-oran`), offline persistence via `persistentLocalCache({ tabManager: persistentMultipleTabManager() })` (`src/firebase.ts:19-21`)

## Collections & Query/Index Alignment

| Collection | Primary Queries (`src/lib/db.ts`) | Matching Index (`firestore.indexes.json`) | Status |
|---|---|---|---|
| `gigs` | `where('status', '==', 'active')`, `orderBy('createdAt', 'desc')`, `limit(50)` | `(status ASC, createdAt DESC)` | ALIGNED |
| `gigs` | `where('flags', '>', 0)`, `orderBy('createdAt', 'desc')`, `limit(150)` | `(flags ASC, createdAt DESC)` | NEEDS RUNTIME CHECK (`DB-001`) |
| `gigs` | `where('isSample', '==', true)`, `limit(1 \| 150)` | Single-field auto index | ALIGNED |
| `phoneCounters` | Point `getDoc` / transactional `tx.get` by E.164 ID | Document ID lookup | ALIGNED |
| `reports` | Transactional `tx.set` at deterministic ID `${gigId}_${uid}` | Document ID write | ALIGNED |

## Findings

| ID | Severity | Certainty | Affected Files | Root Cause & Recommended Fix |
|---|---|---|---|---|
| `DB-001` | Medium | SUSPECTED | `src/lib/db.ts:154-159`, `firestore.indexes.json:11-18` | **Admin `flaggedQ` inequality + different-field `orderBy` index verification.** `where('flags', '>', 0)` combined with `orderBy('createdAt', 'desc')` (without `orderBy('flags')` first) requires Firestore to resolve the `(flags ASC, createdAt DESC)` index or may throw `failed-precondition` depending on query plan. **Fix:** Verify against live/emulator Firestore; if needed, add `orderBy('flags', 'desc'), orderBy('createdAt', 'desc')` and update `firestore.indexes.json`. |
| `DB-002` | Medium | CONFIRMED | `src/lib/db.ts:207-239` | **Non-atomic sequential writes in `seedSamples()` and `removeAllSamples()`.** Loops 10–150 times awaiting individual `setDoc`/`updateDoc` calls. A mid-loop mobile drop leaves partially seeded or partially removed sample sets. **Fix:** Use `writeBatch(db)` (up to 500 ops per batch) for atomic execution and faster round-trips. |
| `DB-003` | Low | CONFIRMED | `src/pages/Browse.tsx:10,73-75` | **Client-side filter operates only on the fetched 50-doc page.** When >50 active gigs exist, selecting a category or neighborhood only filters the first 50 results; older matching gigs on page 2 are invisible until the user taps "Load more". Acceptable for early Oran pilot, but document as a known scale threshold. |

## Previously Fixed in Uncommitted Working Tree (Preserved)

- `adminRemove` now frees `phoneCounters` for both `active` and `hidden` gigs (`src/lib/db.ts:190-203`).
- `adminApprove` now re-claims a `phoneCounters` slot when restoring a `removed` gig (`src/lib/db.ts:171-185`).
- `getGigsByIds` now fetches saved gigs in parallel via `Promise.all` (`src/lib/db.ts:66-71`).
- `persistentMultipleTabManager()` enabled (`src/firebase.ts:19-21`).
