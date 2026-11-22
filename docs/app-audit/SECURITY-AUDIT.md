# Stage 05 — Tenant & Application Security Audit (Updated After High-Priority Repairs)

## High-Priority Security Fix (`SEC-001`) & Rules Verification (`SEC-003`)

1. **Privacy-Safe Phone Contact Architecture (`SEC-001`):**
   - Removed `posterPhone` and `counterId` from all new public `gigs/{gigId}` writes (`src/lib/db.ts`, `firestore.rules`).
   - Added private collection `gigContacts/{gigId}` (`allow read: if isAdmin();`) written atomically in the same transaction as `postGig()`.
   - Added 2nd Gen Cloud Function `contactGig` (`functions/src/index.ts`, region `europe-west1`) wired to `/api/contact/:gigId?lang=...` in `firebase.json`. It validates `status === 'active' && !isSample`, reads `gigContacts/{gigId}` (with fallback to legacy `gigs/{gigId}.posterPhone` until an approved migration runs), and returns `302` to `wa.me` with `Cache-Control: no-store` and `Referrer-Policy: no-referrer`.
   - Added dry-run-by-default migration helper `scripts/migrate-gig-contacts.mjs` (not executed against live data).
2. **Automated Positive & Negative Security Rules Verification (`SEC-003`):**
   - Executed `npm run test:rules` (`firebase emulators:exec --only firestore --project demo-khadma "vitest run tests/rules"`): **4/4 suites PASS (exit code 0)**:
     - Public read of `active` gig: **ALLOW**; `hidden`/`removed` gig & `gigContacts`: **DENY**
     - Transactional `+1` counter post: **ALLOW**; counter-skip bypass, 6th gig (`count=6`), and `posterPhone` on public `gigs`: **DENY**
     - Deterministic `reports/{gigId}_{uid}` 1st/2nd/3rd auto-hide: **ALLOW**; duplicate report by same UID and flag update without report doc: **DENY**
     - Unverified `cherouri@gmail.com`: **DENY**; verified `cherouri@gmail.com`: **ALLOW**
   - `firebase deploy --only firestore:rules --dry-run`: **PASS**.

## Remaining Medium/Low Security Items (Deferred)

- `SEC-002` (Medium): Anonymous Auth Sybil risk on 3-report auto-hide.
- `SEC-004` (Low): Firebase App Check not enabled.
