# KHADMA V1.4 — Final Launch Report

**Status:** **LAUNCH READY — LIVE IN PRODUCTION**  
**Date:** 2026-11-24  
**Branch / Commit:** `main` (`3264bf5`)  
**Production URL:** https://khadma-oran.web.app (`khadma-oran`)  
**Staging URL:** https://khadma-oran-staging.web.app (`khadma-oran-staging`)

---

## 1. Executive Summary

KHADMA V1.4 (French-first LTR / Modern Standard Arabic RTL, 100% free jobs and services PWA for Oran, Algeria) has completed a full browser functional QA audit, remediation of all **8** discovered defects, migration of remaining admin write operations server-side, promotion of **100% server-authoritative Firestore Security Rules**, legacy employer migration, Cloud Functions v2 deployment, Firestore TTL activation, and live production smoke verification across Desktop (`1440×900`) and Mobile (`390×844`).

All automated quality, security, rules, integration, and end-to-end Playwright test suites pass with **zero open defects** and **zero console or uncaught page errors** on live production.

---

## 2. Release & Commit Lineage

| Commit | Summary |
|---|---|
| `6568800` | `fix(v1.4): resolve all browser QA audit defects and add desktop + regression E2E coverage` (`DEF-001`–`DEF-008`, Desktop Playwright project, full-stack regression spec) |
| `d1315c2` | `Merge feat/v1.4-low-cost-marketplace: KHADMA V1.4 production release` into `main` |
| `3264bf5` | `chore(v1.4): complete final launch hardening (server-side sample actions + 100% server-authoritative firestore.rules)` |

---

## 3. Defects Resolved During Launch Audit (`8 / 8 Fixed & Verified`)

| ID | Severity | Component / File | Fix Summary |
|---|---|---|---|
| **DEF-001** | High | `src/pages/AuthAction.tsx` | Replaced `executedKeyRef` + `active` race with a bounded promise cache keyed by `${mode}:${oobCode}` so `verifyEmail`, `resetPassword`, and invalid `oobCode` paths never hang under React 18 `<StrictMode>` or skip distinct codes. |
| **DEF-002** | Medium | `src/lib/db.ts` | Updated `hasSamples()` to exclude `status === 'removed'` so Admin's `"Retirer tous les exemples"` cleanly resets to `"Ajouter 10 annonces d’exemple"`. |
| **DEF-003** | Medium | `src/pages/Settings.tsx` | Displayed signed-in account identity and Sign Out control for all non-anonymous users (email-first employers, admins, and legacy phone accounts). |
| **DEF-004** | Medium | `src/pages/PostGig.tsx` | Blocked rendering the edit `<form>` on non-existent or unowned `/employer/edit/:id`, showing an accessible error state with a return link to `/employer`. |
| **DEF-005** | Medium | `src/components/ContactButtons.tsx` | Moved keyboard focus into `.contact-sheet` (`role="dialog"`) on open and restored focus to the triggering button on close/Escape. |
| **DEF-006** | Low | `src/components/BottomNav.tsx` | Matched `p.startsWith('/employer') \|\| p === '/post'` so `/employer/auth` and `/employer/edit/:id` highlight the Employer tab. |
| **DEF-007** | Low | `src/components/ReportSheet.tsx`, `src/lib/strings.ts`, `src/pages/Admin.tsx` | Added `common.close` (`"Fermer"` / `"إغلاق"`) for post-submit report dismissal, added `type="button"` / `aria-pressed` on report reasons, and added `role="tablist"` / `role="tab"` / `aria-selected` on Admin tabs. |
| **DEF-008** | Medium | `src/pages/Admin.tsx` | Updated unauthenticated guard to `if (!user \|\| user.isAnonymous)` so anonymous sessions (e.g. after submitting a listing report) see the Admin login form instead of `"Réservé à l’administrateur."`. |

Additional launch hardening:
- **`src/pages/GigDetail.tsx`:** Resets `gig`/`missing` state and cancels stale async reads when route `:id` changes.
- **Server-Side Admin Sample Actions (`functions/src/adminHandler.ts`, `functions/src/index.ts`, `src/lib/db.ts`):** Migrated `seedSamples` and `removeAllSamples` into the App-Check-protected `adminManageMarketplace` callable with V1.4 fields (`city: 'oran'`, `wilayaCode: '31'`, `listingType`, `expiresAt`) and `auditLogs` entries.
- **100% Server-Authoritative `firestore.rules`:** Promoted hardened cutover rules denying all direct client writes across every collection (`gigs`, `gigContacts`, `employers`, `settings`, `auditLogs`, `phoneCounters`, `reports`, `contactRateLimits`, `reportRateLimits`, `listingIdempotency`) plus explicit root default-deny fallback.

---

## 4. Automated Verification Matrix

| Suite / Check | Command | Result |
|---|---|---|
| **ESLint** | `npm run lint` | **PASS** (`0` errors, `0` warnings) |
| **Functions TypeScript** | `cd functions && ./node_modules/.bin/tsc` | **PASS** (`0` errors) |
| **Unit Tests** | `npm run test:unit` | **PASS** (`14/14` files, `63/63` tests) |
| **Security Tests** | `npm run test:security` | **PASS** (`3/3` files, `27/27` tests) |
| **Firestore Rules Tests** | `npm run test:rules` | **PASS** (`11/11` tests against final hardened rules) |
| **Auth Emulator Tests** | `npm run test:auth` | **PASS** |
| **Integration Tests** | `npm run test:integration` | **PASS** (`2/2` files, `8/8` tests) |
| **Playwright Static E2E (Mobile + Desktop)** | `npx playwright test --reporter=list` | **PASS** (`12/12` — 6 Mobile + 6 Desktop) |
| **Playwright Full-Stack Emulator E2E** | `npm run test:e2e:emulator` | **PASS** (`4/4` — Auth + Firestore + Functions, including `DEF-001`–`DEF-008` regressions & server-side sample actions) |
| **Production PWA Build** | `VITE_FIREBASE_ENV=production VITE_FIREBASE_PROJECT_ID=khadma-oran ./node_modules/.bin/vite build --mode production` | **PASS** (`927ms`, 36 precache entries) |

---

## 5. Production Infrastructure & Cutover Evidence (`khadma-oran`)

- **Deploy Guard:** `scripts/verify-deploy-target.mjs --target=production --project=khadma-oran` — **PASSED**
- **Firestore Composite Indexes:** Deployed `firestore.indexes.json` to `(default)` database.
- **Firestore Security Rules:** Deployed 100% server-authoritative `firestore.rules` to `khadma-oran` (and synced to `khadma-oran-staging`).
- **Legacy Employer Migration & Settings Init (`scripts/migrate-legacy-employers.mjs`):**
  - Scanned `4` Firebase Auth accounts; grandfathered `1` legacy phone employer (`maxActiveGigs: 5`); skipped `3` non-phone accounts.
  - Initialized `settings/marketplace` (`requirePreApproval: false`, `remoderateMaterialEdits: true`).
- **Cloud Functions v2 (`europe-west1`, `nodejs22`):** All 5 functions deployed and active:
  - `manageEmployerListing` (callable)
  - `adminManageMarketplace` (callable)
  - `expireStaleGigs` (scheduled via Cloud Scheduler)
  - `getGigContactLink` (callable)
  - `reportGigListing` (callable)
- **Firestore TTL Policies (`gcloud firestore fields ttls list --project=khadma-oran`):**
  - `contactRateLimits.expireAt` — **`ACTIVE`**
  - `reportRateLimits.expireAt` — **`ACTIVE`**
  - `listingIdempotency.expireAt` — **`ACTIVE`**
- **Staging Parity (`khadma-oran-staging`):** Synced with identical `firestore.rules`, `adminManageMarketplace`, and `--mode staging` Hosting build.

---

## 6. Live Production Browser Smoke Audit (`https://khadma-oran.web.app`)

Executed read-only headless Chromium verification across **Desktop (`1440×900`)** and **Mobile (`390×844`)** covering `/`, `/jobs`, `/services`, `/listings`, `/saved`, `/settings`, `/employer/auth`, `/admin`, and `/auth/action?mode=unknown`:

- **Layout & RTL:** Zero horizontal overflow (`overflowFr: false`, `overflowAr: false`, `dir="rtl"` verified on Arabic toggle) on both Desktop and Mobile.
- **Navigation:** Bottom navigation active highlight verified on `/employer/auth` (`activeBottomNav: 1`).
- **PWA Assets:** `/manifest.webmanifest` (`200`), `/sw.js` (`200`, `cache-control: no-cache`), `/favicon.svg` (`200`), `/pwa-192x192.png` (`200`).
- **Runtime Stability:** **`0` console errors** and **`0` uncaught `pageerror` exceptions**.

---

## 7. Rollback & Post-Launch Monitoring

- **Pre-V1.4 Recovery Baseline:** V1.3 commit `ec8347052c726100c0185dcb94fe872f41d8756c` | Hosting version `3ee08b82d74bdf36` (follow Section 3 of `docs/release/V1.4-RELEASE-RUNBOOK.md` — never restore insecure direct-client write rules).
- **Operator Console Checks:** Confirm Email/Password provider + authorized domain (`khadma-oran.web.app`), production App Check reCAPTCHA Enterprise metrics, and Cloud Billing budget alerts (\$5 / \$15 / \$30) via the Admin Monitoring tab (`/admin`).
