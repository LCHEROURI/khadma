# Centralized Findings Register

- **Repository:** `https://github.com/LCHEROURI/khadma.git`
- **Base Commit:** `main` @ `8a01a9de0ec37830ef0a7ef00d0fed1a86ced1d1`
- **Repair Branch:** `audit/high-priority-repairs-20261122`
- **Verified Commit:** `eaeadcbf95250914f5ddba98e5fab339f45307e9`
- **GitHub Actions CI Run:** [45080643114](https://github.com/LCHEROURI/khadma/actions/runs/45080643114) (`conclusion: success`)
- **Reconciliation Summary:** **26 original findings** — **23 Closed & CI-Verified** (100% of code-level findings), **3 Open / Pending Live Environment & Migration** (`SEC-001`, `BUG-001`, `SEC-004`).

## Open Findings (3 — Pending Live Firebase Console Configuration, Deployment & Migration)

| ID | Stage | Severity | Certainty | Affected Files | Status & Evidence |
|---|---|---|---|---|---|
| `SEC-001` | 05 | High | CONFIRMED | `firestore.rules`, `functions/src/*`, `firebase.json`, `src/firebase.ts`, `src/components/WhatsAppButton.tsx`, `scripts/migrate-gig-contacts.mjs` | **OPEN (OPTION A IMPLEMENTED — PENDING LIVE VERIFICATION & MIGRATION).** Public GET redirect removed; `getGigContactLink` (`onCall`, `enforceAppCheck: true`, Auth + dual per-UID/IP rate limits) CI-verified (`7/7` contact security tests, `4/4` rules tests in run `45080643114`). Remains open until live App Check activation, ordered rollout, and safe legacy `gigs` migration (`PRODUCTION-READINESS.md` pre-migration script safety gap documented). |
| `BUG-001` | 03 | High | CONFIRMED | `firestore.rules:50-54`, `src/hooks/useAuth.ts:29`, `src/pages/Admin.tsx` | **PENDING LIVE ADMIN EMAIL VERIFICATION.** Live `cherouri@gmail.com` confirmed `emailVerified: False` via `firebase auth:export`; localized verification UI implemented without weakening auth (`test:rules` PASS in run `45080643114`). |
| `SEC-004` | 05 | Low | CONFIRMED | `src/firebase.ts`, Firebase Console | **OPEN (CODE IMPLEMENTED — PENDING APP CHECK CONSOLE ACTIVATION).** Client `ReCaptchaV3Provider` and server `enforceAppCheck: true` implemented; pending Firebase Console reCAPTCHA v3 registration and `VITE_RECAPTCHA_SITE_KEY` build env var. |

## Closed & CI-Verified Findings (23 — All High, Medium & Low Code Findings)

| ID | Stage | Severity | Status | Verification Evidence (`eaeadcb` / CI Run `45080643114`) |
|---|---|---|---|---|
| `QUAL-001` | 02 | High | FIXED & VERIFIED | `npm run typecheck` & `npm run build` PASS in CI `45080643114` |
| `E2E-001` | 08 | High | FIXED & VERIFIED | CI `45080643114`: `test:unit` 11/11, `test:security` 11/11, `test:rules` 4/4, `test:e2e` 5/5 PASS |
| `OPS-001` | 09 | High | FIXED & VERIFIED | `.github/workflows/ci.yml` executed & passed in CI `45080643114` |
| `BUG-002` | 03 | Medium | FIXED & VERIFIED | `src/lib/phoneAuth.ts` clears/resets `RecaptchaVerifier` on send/error/resend/`changeNumber`/unmount |
| `BUG-003` | 03 | Medium | FIXED & VERIFIED | `AlreadyReportedError` + `functions/already-exists` handled cleanly in `ReportSheet.tsx` |
| `DB-001` | 04 | Medium | FIXED & VERIFIED | Explicit `orderBy('flags', 'asc'), orderBy('createdAt', 'desc')` verified in Firestore Emulator (`test:rules` PASS) |
| `DB-002` | 04 | Medium | FIXED & VERIFIED | Chunked `writeBatch(db)` (`BATCH_LIMIT = 400`) in `seedSamples()` & `removeAllSamples()` |
| `SEC-002` | 05 | Medium | FIXED & VERIFIED | `reportGigListing` (`onCall`, `enforceAppCheck: true`, Auth + per-(gigId, ipHash) dedup + 10/hr IP cap); `4/4` report security + `4/4` rules tests PASS in CI `45080643114` (pending live deploy) |
| `SEC-003` | 05 | Medium | FIXED & VERIFIED | Negative & positive Firestore Rules Emulator suite (`tests/rules/firestore.rules.test.ts`) PASS in CI `45080643114` |
| `UX-001` | 06 | Medium | FIXED & VERIFIED | Localized `common.currency` (`DZD` / `دج`) wired across app & verified in `format.test.ts` |
| `UX-002` | 06 | Medium | FIXED & VERIFIED | `ReportSheet` `aria-labelledby`/focus/Escape; `BottomNav` & `Admin` refresh `aria-label` |
| `PERF-001` | 07 | Medium | FIXED & VERIFIED | `React.lazy` routes + split Firebase chunks cut app entry JS `-47.5%` and eliminated `> 500 kB` chunk warning |
| `PERF-002` | 07 | Medium | FIXED & VERIFIED | Post-edit bundle metrics measured & verified (`npm run build` PASS) |
| `ARCH-001` | 01 | Medium | FIXED & VERIFIED | Route-level `React.lazy` + `Suspense` in `src/App.tsx` verified in build & Playwright E2E |
| `ARCH-002` | 01 | Medium | FIXED & VERIFIED | `PhoneVerificationAdapter` isolated in `src/lib/phoneAuth.ts` |
| `QUAL-002` | 02 | Medium | FIXED & VERIFIED | ESLint 9 flat config (`eslint.config.js`) + `npm run lint` PASS (`0` errors, `0` warnings) in CI `45080643114` |
| `OPS-002` | 09 | Medium | FIXED & VERIFIED | All repairs committed & pushed on dedicated branch `audit/high-priority-repairs-20261122`, never on `main` |
| `OPS-003` | 09 | Low | FIXED & VERIFIED | Firebase Emulator config added to `firebase.json` & exercised in CI `45080643114` |
| `BUG-004` | 03 | Low | FIXED & VERIFIED | `window.clearTimeout(timer)` cleanup added to `justPosted` effect in `src/pages/GigDetail.tsx` |
| `DB-003` | 04 | Low | FIXED & VERIFIED | Localized `browse.filterPartial` (`role="status"`) shown when filters are active while more pages remain (`lastDoc !== null`) |
| `UX-003` | 06 | Low | FIXED & VERIFIED | Semantic `<form onSubmit>` in `Admin.tsx` and `PostGig.tsx`; Enter-key submit verified in Playwright E2E (`45080643114`) |
| `ARCH-003` | 01 | Low | FIXED & VERIFIED | `validateFirebaseConfig()` in `src/lib/firebaseConfig.ts` wired into `src/firebase.ts` (warns by key name only); unit-tested in `storage.test.ts` |
| `QUAL-003` | 02 | Low | FIXED & VERIFIED | Consolidated `readStringList`/`writeStringList` in `src/lib/storage.ts`; `BROWSE_PAGE_SIZE = 50` & `ADMIN_QUEUE_LIMIT = 150`; unit-tested in `storage.test.ts` |

## Unverified External / Live-Environment Dependencies

- **Real Algerian SMS OTP delivery (Mobilis, Djezzy, Ooredoo):** Explicitly `NOT VERIFIED` until tested on real Algerian handsets (`AGENTS.md` stop-and-pivot gate applies).
- **Live Cloud Functions + App Check enforcement + legacy migration:** Explicitly `NOT VERIFIED` until deployed to `khadma-oran` (see `PRODUCTION-READINESS.md` for compatibility gaps and safety gates).
