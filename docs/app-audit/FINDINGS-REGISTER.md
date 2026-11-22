# Centralized Findings Register

- **Repository:** `https://github.com/LCHEROURI/khadma.git`
- **Base Commit:** `main` @ `8a01a9de0ec37830ef0a7ef00d0fed1a86ced1d1`
- **Repair Branch:** `audit/high-priority-repairs-20261122` (last pushed `d8c2ecb`; final 5 low-priority repairs uncommitted pending review)
- **Last Updated:** 2026-11-22 (All Code Repairs Complete — High, Medium, and Low)

## Open Findings (Pending Live Firebase Console Configuration, Deployment & Verification Only)

| ID | Stage | Severity | Certainty | Affected Files | Status & Evidence |
|---|---|---|---|---|---|
| `SEC-001` | 05 | High | CONFIRMED | `firestore.rules`, `functions/src/*`, `firebase.json`, `src/firebase.ts`, `src/components/WhatsAppButton.tsx` | **OPEN (OPTION A IMPLEMENTED — PENDING LIVE VERIFICATION & MIGRATION).** Public GET redirect removed; `getGigContactLink` (`onCall`, `enforceAppCheck: true`, Auth + dual per-UID/IP rate limits) verified locally & in CI (`7/7` security tests, `4/4` rules tests). Pending live App Check registration, ordered deploy, and approved legacy doc migration. |
| `BUG-001` | 03 | High | CONFIRMED | `firestore.rules:50-54`, `src/hooks/useAuth.ts:29`, `src/pages/Admin.tsx` | **CODE FIXED & VERIFIED — PENDING LIVE ADMIN EMAIL VERIFICATION.** Live `cherouri@gmail.com` confirmed `emailVerified: False`; localized verification UI implemented without weakening auth. |
| `SEC-004` | 05 | Low | CONFIRMED | `src/firebase.ts`, Firebase Console | **OPEN (CODE IMPLEMENTED — PENDING CONSOLE ACTIVATION).** App Check client (`ReCaptchaV3Provider`) & server (`enforceAppCheck: true`) implemented; pending Firebase Console reCAPTCHA v3 setup & `VITE_RECAPTCHA_SITE_KEY`. |

## All Repaired & Verified Code Findings (20 Closed Across High, Medium, and Low)

| ID | Stage | Severity | Status | Verification Evidence |
|---|---|---|---|---|
| `QUAL-001` | 02 | High | FIXED & VERIFIED | Local `/tmp` + CI run `45079940646` `typecheck` & `build` PASS |
| `E2E-001` | 08 | High | FIXED & VERIFIED | `test:unit` 11/11, `test:security` 11/11, `test:rules` 4/4, `test:e2e` 5/5 PASS |
| `OPS-001` | 09 | High | FIXED & VERIFIED | GitHub Actions CI run `45079940646` `success` |
| `BUG-002` | 03 | Medium | FIXED & VERIFIED | `src/lib/phoneAuth.ts` clears/resets `RecaptchaVerifier` on send/error/resend/`changeNumber`/unmount |
| `BUG-003` | 03 | Medium | FIXED & VERIFIED | `AlreadyReportedError` + `functions/already-exists` handled in `ReportSheet.tsx` |
| `DB-001` | 04 | Medium | FIXED & VERIFIED | Explicit `orderBy('flags', 'asc'), orderBy('createdAt', 'desc')` verified in Firestore Emulator |
| `DB-002` | 04 | Medium | FIXED & VERIFIED | Chunked `writeBatch(db)` (`BATCH_LIMIT = 400`) in `seedSamples()` & `removeAllSamples()` |
| `SEC-002` | 05 | Medium | FIXED & VERIFIED | `reportGigListing` (`onCall`, `enforceAppCheck: true`, Auth + per-(gigId, ipHash) dedup + 10/hr cap); `4/4` report security + `4/4` rules tests PASS (pending live deploy) |
| `UX-001` | 06 | Medium | FIXED & VERIFIED | Localized `common.currency` (`DZD` / `دج`) wired across app & verified in unit tests |
| `UX-002` | 06 | Medium | FIXED & VERIFIED | `ReportSheet` `aria-labelledby`/focus/Escape; `BottomNav` & `Admin` refresh `aria-label` |
| `PERF-001` | 07 | Medium | FIXED & VERIFIED | `React.lazy` + split Firebase chunks cut app entry JS `-47.5%` and eliminated `> 500 kB` chunk warning |
| `ARCH-001` | 01 | Medium | FIXED & VERIFIED | Route-level `React.lazy` + `Suspense` in `src/App.tsx` |
| `ARCH-002` | 01 | Medium | FIXED & VERIFIED | `PhoneVerificationAdapter` isolated in `src/lib/phoneAuth.ts` |
| `QUAL-002` | 02 | Medium | FIXED & VERIFIED | ESLint 9 flat config (`eslint.config.js`) + `npm run lint` (`0` errors, `0` warnings) |
| `OPS-002` | 09 | Medium | FIXED & VERIFIED | Dedicated branch `audit/high-priority-repairs-20261122`, never committing directly to `main` |
| `BUG-004` | 03 | Low | FIXED & VERIFIED | `window.clearTimeout(timer)` cleanup added to `justPosted` effect in `src/pages/GigDetail.tsx` |
| `DB-003` | 04 | Low | FIXED & VERIFIED | Localized `browse.filterPartial` status notice shown when filters are active while more pages remain (`lastDoc !== null`) in `src/pages/Browse.tsx` |
| `UX-003` | 06 | Low | FIXED & VERIFIED | Semantic `<form onSubmit>` + `type="submit"` / `type="button"` in `Admin.tsx` and `PostGig.tsx`; Enter-key submission verified in Playwright E2E |
| `ARCH-003` | 01 | Low | FIXED & VERIFIED | Pure `validateFirebaseConfig()` in `src/lib/firebaseConfig.ts` wired into `src/firebase.ts` (warns by key name only, never prints credentials); unit-tested |
| `QUAL-003` | 02 | Low | FIXED & VERIFIED | Consolidated `readStringList`/`writeStringList` in `src/lib/storage.ts`; renamed `BROWSE_LIMIT` → `BROWSE_PAGE_SIZE` (50) & `ADMIN_QUEUE_LIMIT` (150); unit-tested |
