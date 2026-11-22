# Centralized Findings Register

- **Repository:** `https://github.com/LCHEROURI/khadma.git`
- **Base Commit:** `main` @ `8a01a9de0ec37830ef0a7ef00d0fed1a86ced1d1`
- **Repair Branch:** `audit/high-priority-repairs-20261122` (all 22 pre-existing uncommitted files preserved)
- **Last Updated:** 2026-11-22 (High-Priority Repair Phase complete)

## High-Priority Findings (Repaired & Verified)

| ID | Stage | Severity | Certainty | Affected Files | Root Cause Summary | Status | Verification Evidence |
|---|---|---|---|---|---|---|---|
| `BUG-001` | 03 | High | CONFIRMED | `firestore.rules:50-54`, `src/hooks/useAuth.ts:29`, `src/pages/Admin.tsx`, `src/lib/strings.ts` | Verified via `firebase auth:export` that `cherouri@gmail.com` currently has `emailVerified: False`. Auth was NOT weakened; added localized verification UI (`sendEmailVerification` + reload) in `Admin.tsx` and flagged Firebase Auth verification as a mandatory pre-deploy step. | FIXED & VERIFIED (pending live email verification) | `firebase auth:export` diagnostic; `test:rules` unverified/verified admin test PASS; `npm run build` PASS |
| `SEC-001` | 05 | High | CONFIRMED | `firestore.rules`, `functions/src/index.ts`, `functions/src/contactHandler.ts`, `firebase.json`, `src/firebase.ts`, `src/lib/db.ts`, `src/components/WhatsAppButton.tsx` | Option A implemented: removed public GET `/api/contact/**` redirect; replaced with `onCall` `getGigContactLink` enforcing Firebase App Check (`enforceAppCheck: true`), Firebase Auth, and dual per-UID (`8/hr`) + per-IP (`15/hr`) rate limits in server-only `contactRateLimits`. Kept OPEN pending live App Check console setup, deployment, and legacy doc migration; inherent residual `wa.me` exposure documented in `SECURITY-AUDIT.md`. | OPEN (OPTION A IMPLEMENTED — PENDING LIVE VERIFICATION) | `test:security` 7/7 PASS; `test:rules` 4/4 PASS (including `contactRateLimits` deny-all); `functions` build PASS |
| `QUAL-001` | 02 | High | CONFIRMED | `package.json`, `tsconfig.json` | Root cause of local build stall isolated to macOS Documents/iCloud Drive I/O on `node_modules/`. Verified clean build locally and on GitHub Actions CI. | FIXED & VERIFIED | Local `/tmp` build PASS; GitHub Actions CI run `45077805211` PASS |
| `E2E-001` | 08 | High | CONFIRMED | `package.json`, `vitest.config.ts`, `playwright.config.ts`, `firebase.json`, `tests/unit/*`, `tests/rules/*`, `tests/e2e/*` | Added Vitest unit tests (8), Firestore Emulator Security Rules suite (4), and Playwright mobile Chromium E2E suite (5). | FIXED & VERIFIED | Local & GitHub Actions CI run `45077805211`: all unit, rules, and E2E steps PASS |
| `OPS-001` | 09 | High | CONFIRMED | `.github/workflows/ci.yml`, `package-lock.json`, `functions/package-lock.json` | Added GitHub Actions CI workflow running web + functions typecheck/build, unit tests, Firestore Emulator rules tests, and Playwright E2E tests on push & PR. | FIXED & VERIFIED | GitHub Actions CI run `45077805211` (`conclusion: success`) |

## Remaining Open Findings (Medium & Low — Deferred Until High-Priority Review)

| ID | Stage | Severity | Certainty | Affected Files | Root Cause Summary | Status |
|---|---|---|---|---|---|---|
| `BUG-002` | 03 | Medium | CONFIRMED | `src/pages/PostGig.tsx:46-58,146-153` | `RecaptchaVerifier` not cleared/reset on resend or `changeNumber` | OPEN |
| `BUG-003` | 03 | Medium | CONFIRMED | `src/components/ReportSheet.tsx:27-40` | Duplicate report rule denial surfaces generic error instead of `report.alreadyReported` | OPEN |
| `DB-001` | 04 | Medium | SUSPECTED | `src/lib/db.ts:154-159`, `firestore.indexes.json:11-18` | Admin `flaggedQ` (`where('flags', '>', 0)` + `orderBy('createdAt', 'desc')`) needs runtime index check | OPEN |
| `DB-002` | 04 | Medium | CONFIRMED | `src/lib/db.ts:207-239` | `seedSamples` / `removeAllSamples` execute sequential writes instead of `writeBatch(db)` | OPEN |
| `SEC-002` | 05 | Medium | CONFIRMED | `firestore.rules:100-112` | Anonymous Auth Sybil risk: 3 fresh anon UIDs can still auto-hide any active gig | OPEN |
| `UX-001` | 06 | Medium | CONFIRMED | `src/lib/format.ts:7-8`, `src/pages/PostGig.tsx:257` | Hardcoded `DZD` in Arabic mode instead of localized `دج` | OPEN |
| `UX-002` | 06 | Medium | CONFIRMED | `ReportSheet.tsx:44`, `BottomNav.tsx:15`, `Admin.tsx:172` | Missing dialog `aria-labelledby`/Escape handler and missing nav/icon-button `aria-label` | OPEN |
| `PERF-001` | 07 | Medium | CONFIRMED | `vite.config.ts:37-40`, `src/App.tsx:6-11` | `firebase/auth` (`596 KB` Firebase chunk) and all 6 routes eagerly loaded on `/` | OPEN |
| `ARCH-001` | 01 | Medium | CONFIRMED | `src/App.tsx:6-11` | No `React.lazy` route splitting | OPEN |
| `ARCH-002` | 01 | Medium | CONFIRMED | `src/pages/PostGig.tsx:41-106` | SMS OTP tightly coupled to `PostGig.tsx` instead of swappable verification adapter | OPEN |
| `QUAL-002` | 02 | Medium | CONFIRMED | `package.json:6-11` | No ESLint/Biome linter configured | OPEN |
| `OPS-002` | 09 | Medium | CONFIRMED | `git status` | Changes on `audit/high-priority-repairs-20261122` not yet committed/pushed (awaiting review) | OPEN |
| `BUG-004` | 03 | Low | CONFIRMED | `src/pages/GigDetail.tsx:35-41` | `justPosted` `setTimeout` not cleared on unmount | OPEN |
| `DB-003` | 04 | Low | CONFIRMED | `src/pages/Browse.tsx:10,73-75` | Client-side filters apply only to currently loaded 50-doc page | OPEN |
| `SEC-004` | 05 | Low | CONFIRMED | `src/firebase.ts` | Firebase App Check not enabled | OPEN |
| `UX-003` | 06 | Low | CONFIRMED | `src/pages/Admin.tsx:73-97`, `src/pages/PostGig.tsx:167-285` | Forms use `<div>` instead of `<form onSubmit>` | OPEN |
| `ARCH-003` | 01 | Low | CONFIRMED | `src/firebase.ts:7-14` | No startup guard when `VITE_FIREBASE_API_KEY` is missing | OPEN |
| `QUAL-003` | 02 | Low | CONFIRMED | `ReportSheet.tsx:9-16`, `db.ts:242-251` | Duplicated `localStorage` JSON array parser; `BROWSE_LIMIT` naming drift | OPEN |

*(Note: `SEC-003`, `PERF-002`, and `OPS-003` were also resolved during High-Priority repairs via `tests/rules/firestore.rules.test.ts`, fresh `npm run build` measurement, and `firebase.json` emulators config.)*
