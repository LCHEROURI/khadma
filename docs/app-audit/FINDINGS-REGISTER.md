# Centralized Findings Register

- **Repository:** `https://github.com/LCHEROURI/khadma.git`
- **Base Commit:** `main` @ `8a01a9de0ec37830ef0a7ef00d0fed1a86ced1d1`
- **Repair Branch:** `audit/high-priority-repairs-20261122` (last pushed commit `c29aba7`; medium-priority repairs uncommitted pending review)
- **Last Updated:** 2026-11-22 (Medium-Priority Repair Phase complete)

## Open High-Priority Findings (Pending Live Firebase Console / Deployment Actions)

| ID | Stage | Severity | Certainty | Affected Files | Status & Evidence |
|---|---|---|---|---|---|
| `SEC-001` | 05 | High | CONFIRMED | `firestore.rules`, `functions/src/index.ts`, `functions/src/contactHandler.ts`, `firebase.json`, `src/firebase.ts`, `src/components/WhatsAppButton.tsx` | **OPEN (OPTION A IMPLEMENTED — PENDING LIVE VERIFICATION & MIGRATION).** Public GET redirect removed; `getGigContactLink` (`onCall`, `enforceAppCheck: true`, Auth + dual per-UID/IP rate limits) verified via `7/7` security tests & `4/4` rules tests; WhatsAppButton mobile/desktop navigation hardened. Stays open until live App Check activation, deployment, and approved legacy doc migration. |
| `BUG-001` | 03 | High | CONFIRMED | `firestore.rules:50-54`, `src/hooks/useAuth.ts:29`, `src/pages/Admin.tsx` | **CODE FIXED & VERIFIED — PENDING LIVE EMAIL VERIFICATION.** Live `cherouri@gmail.com` confirmed `emailVerified: False`; localized verification UI added without weakening auth. |

## Repaired & Verified Findings (High + Medium)

| ID | Stage | Severity | Status | Verification Evidence |
|---|---|---|---|---|
| `QUAL-001` | 02 | High | FIXED & VERIFIED | Local `/tmp` + CI run `45078964237` `typecheck` & `build` PASS |
| `E2E-001` | 08 | High | FIXED & VERIFIED | `test:unit` 7/7, `test:security` 11/11, `test:rules` 4/4, `test:e2e` 5/5 PASS |
| `OPS-001` | 09 | High | FIXED & VERIFIED | GitHub Actions CI run `45078964237` `success` (lint step added for next push) |
| `BUG-002` | 03 | Medium | FIXED & VERIFIED | `src/lib/phoneAuth.ts` clears/resets `RecaptchaVerifier` on send, error, resend, `changeNumber`, and unmount; `typecheck` + `build` + `e2e` PASS |
| `BUG-003` | 03 | Medium | FIXED & VERIFIED | `AlreadyReportedError` + `functions/already-exists` handled in `ReportSheet.tsx`, syncing `khadma-reported` and displaying `report.alreadyReported` |
| `DB-001` | 04 | Medium | FIXED & VERIFIED | Explicit `orderBy('flags', 'asc'), orderBy('createdAt', 'desc')` added to `getAdminQueue()`; verified against real Firestore Emulator in `tests/rules/firestore.rules.test.ts` (PASS) |
| `DB-002` | 04 | Medium | FIXED & VERIFIED | `seedSamples()` & `removeAllSamples()` converted to chunked `writeBatch(db)` (`BATCH_LIMIT = 400`) in `src/lib/db.ts` |
| `SEC-002` | 05 | Medium | FIXED & VERIFIED | `reportGigListing` (`onCall`, `enforceAppCheck: true`, Auth + per-(gigId, ipHash) dedup + 10/hr IP cap); direct client flag/report writes denied in `firestore.rules`; `4/4` report security tests + `4/4` rules tests PASS (pending live deploy) |
| `UX-001` | 06 | Medium | FIXED & VERIFIED | Localized `common.currency` (`DZD` / `دج`) wired across `formatPay`, `GigCard`, `GigDetail`, `Admin`, `PostGig`; unit tests PASS |
| `UX-002` | 06 | Medium | FIXED & VERIFIED | `ReportSheet` `aria-labelledby` + focus + Escape close; `BottomNav` `aria-label`; `Admin` refresh button `aria-label` |
| `PERF-001` | 07 | Medium | FIXED & VERIFIED | `React.lazy` routes + split Firebase chunks cut app entry JS `-47.5%` (`85.64 kB` → `44.97 kB`) and eliminated `> 500 kB` chunk warning (`596.60 kB` → `455.21 kB`) |
| `ARCH-001` | 01 | Medium | FIXED & VERIFIED | Route-level `React.lazy` + `Suspense` in `src/App.tsx`; verified in `npm run build` & `test:e2e` |
| `ARCH-002` | 01 | Medium | FIXED & VERIFIED | SMS OTP isolated behind `PhoneVerificationAdapter` (`src/lib/phoneAuth.ts`) without changing auth behavior |
| `QUAL-002` | 02 | Medium | FIXED & VERIFIED | ESLint 9 flat config (`eslint.config.js`) + `npm run lint` added to `package.json` and `.github/workflows/ci.yml` (`0` errors) |
| `OPS-002` | 09 | Medium | FIXED & VERIFIED (branching) | High-priority changes committed & pushed on dedicated branch `audit/high-priority-repairs-20261122` (`c29aba7`), never on `main`; medium-priority changes await review before commit |

## Remaining Open Low-Priority Findings (Deferred)

| ID | Stage | Severity | Certainty | Affected Files | Root Cause Summary | Status |
|---|---|---|---|---|---|---|
| `SEC-004` | 05 | Low | CONFIRMED | `src/firebase.ts`, Firebase Console | App Check client/server code implemented, **but** live Firebase Console reCAPTCHA v3 registration & `VITE_RECAPTCHA_SITE_KEY` deployment remain pending | OPEN (CODE IMPLEMENTED — PENDING CONSOLE ACTIVATION) |
| `BUG-004` | 03 | Low | CONFIRMED | `src/pages/GigDetail.tsx:35-41` | `justPosted` `setTimeout` not cleared on unmount | OPEN |
| `DB-003` | 04 | Low | CONFIRMED | `src/pages/Browse.tsx:10,73-75` | Client-side filters apply only to currently loaded 50-doc page | OPEN |
| `UX-003` | 06 | Low | CONFIRMED | `src/pages/Admin.tsx`, `src/pages/PostGig.tsx` | Forms use `<div>` instead of `<form onSubmit>` (no Enter-key submit) | OPEN |
| `ARCH-003` | 01 | Low | CONFIRMED | `src/firebase.ts:7-14` | No startup guard when `VITE_FIREBASE_API_KEY` is missing | OPEN |
| `QUAL-003` | 02 | Low | CONFIRMED | `ReportSheet.tsx`, `src/lib/db.ts` | Duplicated `localStorage` JSON array parser; `BROWSE_LIMIT` naming drift | OPEN |
