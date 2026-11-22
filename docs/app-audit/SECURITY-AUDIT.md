# Stage 05 — Tenant & Application Security Audit (Option A Implemented)

## `SEC-001` Status: **OPEN (OPTION A IMPLEMENTED — PENDING LIVE APP CHECK & DEPLOY VERIFICATION)**

### Implemented Controls (Option A — Approved)
1. **Public GET Redirect Removed:**
   - Deleted `/api/contact/**` Hosting rewrite from `firebase.json`.
   - Replaced unauthenticated `onRequest` `contactGig` with 2nd Gen Callable Function `getGigContactLink` (`functions/src/index.ts`, `functions/src/contactHandler.ts`) using `onCall({ region: 'europe-west1', enforceAppCheck: true, maxInstances: 20 })`.
2. **Firebase App Check + Firebase Auth + Dual Sliding-Window Rate Limiting:**
   - **App Check:** Client initializes `ReCaptchaV3Provider` when `VITE_RECAPTCHA_SITE_KEY` is configured (`src/firebase.ts`); server enforces `enforceAppCheck: true` and checks `Boolean(request.app)`.
   - **Authentication:** Client silently signs in via Firebase Anonymous Auth if unauthenticated (`src/lib/db.ts:requestGigContactLink`); server rejects missing `request.auth?.uid` with `unauthenticated`.
   - **Server-Side Rate Limiting:** Atomic Firestore transactions in server-only `contactRateLimits/{key}` (explicit `allow read, write: if false;` in `firestore.rules`) enforce:
     - **Per-UID cap:** max `8` unique gig contact reveals per rolling 60-minute window (idempotent re-taps on the same gig do not consume extra slots).
     - **Per-IP cap:** max `15` unique gig contact reveals per SHA-256 IP hash per rolling 60-minute window (blocks anonymous UID-cycling Sybil scraping from a single IP).
3. **1-Tap WhatsApp UX Preserved:**
   - `WhatsAppButton.tsx` invokes `requestGigContactLink(gigId, lang)` on tap and opens `waUrl` via `window.open(..., '_blank', 'noopener,noreferrer')` with mobile `window.location.assign(waUrl)` fallback.

### Remaining Residual Phone-Number Exposure Risk (Why `SEC-001` Stays Open Until Live Verification)
- **Live enforcement not yet active:** App Check (`VITE_RECAPTCHA_SITE_KEY` + Firebase Console reCAPTCHA v3 registration) and `getGigContactLink` are not yet deployed to `khadma-oran`.
- **Inherent residual risk of direct `wa.me` handoff:** Because WhatsApp chat opens on the applicant's device via `https://wa.me/{e164}`, a legitimate user — or a sophisticated distributed residential-proxy botnet that passes reCAPTCHA v3 and stays below the per-IP/UID rate limits — will still receive the target poster's E.164 phone number upon tapping Contact. Eliminating even this residual exposure would require a server-relayed WhatsApp Business Cloud API (Option B, paid per-conversation).
- **Pre-migration legacy documents:** Existing live `gigs/{id}` documents in `khadma-oran` still retain legacy `posterPhone`/`counterId` fields until `scripts/migrate-gig-contacts.mjs --apply` is explicitly approved and run.

## Automated Security & Rules Verification

| Suite | Command | Result | Verified Scenarios |
|---|---|---|---|
| Contact Security Tests | `npm run test:security` | **PASS** (`7 / 7`) | Old `/api/contact` rewrite removed; `enforceAppCheck: true` & `onCall` verified; App Check bypass blocked (`failed-precondition`); Auth bypass blocked (`unauthenticated`); hidden/removed/sample/missing gig blocked (`not-found`); per-UID rate limit (`8/hr`) + idempotent re-tap + post-window reset; per-IP anonymous-UID-cycling Sybil bypass (`15/hr`) blocked (`resource-exhausted`) |
| Firestore Security Rules | `npm run test:rules` | **PASS** (`4 / 4`) | Active vs. hidden/removed reads; `gigContacts` admin-only; `contactRateLimits` denied to all clients including admin; strict `+1` counter cap (`<= 5`); `posterPhone` blocked on public `gigs`; deterministic 1-report-per-UID + 3-report auto-hide; unverified vs. verified admin email |
| Rules Dry-Run Compile | `firebase deploy --only firestore:rules --dry-run` | **PASS** | Compiled cleanly against `khadma-oran` |

## Medium-Priority Security Repair (`SEC-002` — FIXED & VERIFIED LOCALLY, PENDING DEPLOY)

- **Mitigation:** Replaced direct client Firestore gig flagging / report creation with 2nd Gen Callable Function `reportGigListing` (`functions/src/index.ts`, `functions/src/reportHandler.ts`) enforcing `enforceAppCheck: true`, Firebase Auth (`request.auth.uid`), per-UID dedup (`reports/{gigId}_{uid}`), **per-`(gigId, ipHash)` dedup** (blocks 3 fresh anonymous UIDs from the same IP from auto-hiding a listing), and a **10/hour per-IP** report cap in server-only `reportRateLimits`.
- **Rules Hardening:** `/gigs/{gigId}` `update` restricted to `isAdmin()` only; `/reports/{reportId}` `create` set to `if false;` (server Admin SDK only); `/reportRateLimits/{limitId}` set to `allow read, write: if false;`.
- **Evidence:** `npm run test:security` (`4/4` report Sybil tests PASS + `7/7` contact security tests PASS); `npm run test:rules` (`4/4` PASS); `firebase deploy --only firestore:rules --dry-run` PASS.

## Remaining Low-Priority Security Item

- **`SEC-004` (`OPEN — CODE IMPLEMENTED, PENDING CONSOLE ACTIVATION`):** Firebase App Check client (`ReCaptchaV3Provider` in `src/firebase.ts`) and server (`enforceAppCheck: true` on `getGigContactLink` & `reportGigListing`) are implemented, but cannot be marked closed until reCAPTCHA v3 is registered in Firebase Console and `VITE_RECAPTCHA_SITE_KEY` is configured for production builds.
