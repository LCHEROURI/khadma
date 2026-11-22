# Stage 09 — Production Readiness & Deployment Safety Review

- **Branch:** `audit/high-priority-repairs-20261122` @ `eaeadcbf95250914f5ddba98e5fab339f45307e9`
- **CI Evidence:** GitHub Actions run [45080643114](https://github.com/LCHEROURI/khadma/actions/runs/45080643114) (`conclusion: success`)
- **Review Policy:** Zero downtime is **not** assumed. Every transition boundary, cache edge case, migration retry risk, and rollback constraint is explicitly verified below.

---

## 1. Ten-Point Production Safety Verification Matrix

| # | Safety Check | Verdict | Evidence & Identified Compatibility / Safety Gaps |
|---|---|---|---|
| 1 | **Cloud Functions deploy without breaking existing frontend** | **SAFE** | Existing live frontend (`main` @ `8a01a9d`) does not call `getGigContactLink` or `reportGigListing`. Deploying `functions` first is strictly additive and non-breaking. |
| 2 | **Updated frontend during transition to new Firestore rules** | **MITIGATED — BRIEF CUTOVER WINDOW** | Old `firestore.rules` require `posterPhone`/`counterId` on `gigs` create and default-deny `gigContacts`. New frontend omits `posterPhone`/`counterId` and writes `gigContacts`. Deploying Hosting before Rules breaks `postGig` until Rules deploy; deploying Rules before Hosting breaks old clients' `postGig` and `reportGig`. Browsing (`gigs` read) and WhatsApp contact (`getGigContactLink` legacy fallback) remain compatible throughout. **Concrete Testable Mitigation:** (1) Deploy `functions` first (non-breaking); (2) smoke-test the new bundle on `firebase hosting:channel:deploy preprod`; (3) cut over `hosting` + `firestore:rules,firestore:indexes` together in one command during low-traffic Oran hours (02:00–04:00 CET); (4) verify live `postGig`, `getGigContactLink`, and `reportGigListing` immediately after cutover. |
| 3 | **Existing browser sessions & cached PWA versions** | **MITIGATED — STALE OPEN TAB WINDOW** | Already-deployed `8a01a9d` tabs lack `ErrorBoundary` and `onNeedRefresh` reload, so an open tab kept alive across cutover that opens a *newly posted* gig (no `posterPhone`) will throw `TypeError` on `waLink(undefined)` until reloaded; old tabs posting/reporting get `permission-denied` (handled as error text). Because no new code can retroactively patch an already-running `8a01a9d` tab in memory, **Concrete Testable Mitigation:** (1) cut over during 02:00–04:00 CET low-traffic window; (2) rely on `Cache-Control: no-cache` on `/index.html`, `/sw.js`, and `/manifest.webmanifest` (`firebase.json`) + `registerType: 'autoUpdate'` so any reload/reopen immediately activates the new PWA (testable via DevTools Application → Service Workers); (3) for future releases beyond this cutover, optionally add an `onNeedRefresh` prompt/reload handler (deferred, requires approval). |
| 4 | **Legacy public gig documents with phone numbers** | **SAFE (TRANSITIONAL)** | `getGigContactLink` (`functions/src/contactHandler.ts:146-149`) and `adminApprove`/`adminRemove` (`src/lib/db.ts:199-239`) both fall back cleanly to legacy `gigs/{id}.posterPhone` / `counterId` until migration runs. Legacy active docs remain publicly readable with `posterPhone` until migrated. |
| 5 | **Migration script retry safety & no-overwrite guarantee** | **HARDENED & TESTED** | `scripts/migrate-gig-contacts.mjs` now checks existing `gigContacts/{id}` first (never overwrites a valid E.164 `posterPhone`), validates phone format before writing, verifies `gigContacts/{id}` exists and is valid **before** stripping legacy `gigs/{id}` fields, isolates per-doc errors without aborting healthy docs, and uses `getGigContactLink` references. Verified by `4/4` unit tests in `tests/unit/migrate-gig-contacts.test.ts` (dry-run, missing contact + idempotent rerun, existing contact preserved, partial write/verify failure). |
| 6 | **Pre-migration production data backup** | **READY (MANUAL STEP)** | `khadma-oran` is on Blaze (`README.md:62`), supporting `gcloud firestore export gs://<backup-bucket>/khadma-pre-migration-YYYYMMDD --project=khadma-oran`. Must complete and verify `DONE` before running `--apply`. |
| 7 | **Dry-run vs. post-migration reconciliation** | **READY (2-PASS CHECK)** | Run `node scripts/migrate-gig-contacts.mjs --project khadma-oran` before `--apply` to record exact `legacyCount` and doc IDs; run `--dry-run` again immediately after `--apply` and require `Legacy docs found: 0` (confirming zero residual `posterPhone`/`counterId` fields on `gigs`). |
| 8 | **Rollback does not reintroduce public contact exposure** | **SPLIT-PHASE CONSTRAINT** | **Phase A (Pre-Migration):** Rolling back Hosting + Rules together is safe (legacy `gigs` still have `posterPhone`). **Phase B (Post-Migration):** Rolling back Hosting to `8a01a9d` **breaks** the UI (`posterPhone` deleted from `gigs`), and rolling back `firestore.rules` to `8a01a9d` re-opens `allow read: if true` on `hidden`/`removed` gigs and rate-limit bypasses (though migrated `gigContacts` remain default-denied). Post-migration rollback MUST be **fix-forward**, or full Firestore restore from the pre-migration export before rolling back Hosting. |
| 9 | **Firebase App Check activation & enforcement sequencing** | **CRITICAL GATE** | `getGigContactLink` and `reportGigListing` enforce `enforceAppCheck: true` (`functions/src/index.ts:66`). If `VITE_RECAPTCHA_SITE_KEY` is missing at `npm run build` time, `src/firebase.ts` skips `initializeAppCheck()` and **100% of WhatsApp contact and report calls will fail**. **Required sequence:** Create Fraud Defense (reCAPTCHA Enterprise Website / Score-based) key in GCP/Firebase Console → link in App Check → add `VITE_RECAPTCHA_SITE_KEY` to `.env` → build & verify `exchangeRecaptchaEnterpriseToken` (`200 OK`) in a Hosting preview channel (`firebase hosting:channel:deploy preprod`) BEFORE promoting to live. |
| 10 | **Real Algerian SMS OTP delivery** | **NOT VERIFIED** | Live SMS OTP delivery on **Mobilis, Djezzy, and Ooredoo** has NOT been verified. Per `AGENTS.md`, test on real Algerian handsets immediately after pilot launch; if SMS delivery fails, swap `src/lib/phoneAuth.ts` (`PhoneVerificationAdapter`) to WhatsApp verification before expanding. |

---

## 2. Pre-Deployment Prerequisites (Must Complete Before Rollout)

1. ~~**Verify `cherouri@gmail.com` (`BUG-001`):**~~ **COMPLETE** — confirmed `emailVerified: true`, UID `V7owt5deJ9MZhzZH57jaBAsHiMq2` unchanged, `disabled: false` via read-only Firebase Admin SDK check.
2. **Activate Firebase App Check (`SEC-001` / `SEC-004`):** Enable `recaptchaenterprise.googleapis.com` and create a Website / Score-based Fraud Defense (reCAPTCHA Enterprise) key for `khadma-oran.web.app` and `khadma-oran.firebaseapp.com`; link it in Firebase Console → App Check → Apps; set `VITE_RECAPTCHA_SITE_KEY` in `.env` and GitHub Actions secrets.
3. **Set SMS Region Policy:** Allowlist Algeria (`+213`) in Firebase Console → Authentication → Settings → SMS region policy.
4. **Take Firestore Backup:** Run `gcloud firestore export` to a GCS bucket before any live migration.

---

## 3. Safe Ordered Rollout Procedure (Manual — Requires Explicit Authorization)

1. Merge `audit/high-priority-repairs-20261122` into `main` after review.
2. Deploy Cloud Functions first (non-breaking): `firebase deploy --only functions`.
3. Build PWA with `VITE_RECAPTCHA_SITE_KEY` set and verify on a preview channel (`firebase hosting:channel:deploy preprod`): test App Check token exchange, `getGigContactLink`, `reportGigListing`, and `/admin` login.
4. During a low-traffic Oran window (02:00–04:00 CET), cut over Hosting + Rules + Indexes together:
   ```bash
   firebase deploy --only hosting,firestore:rules,firestore:indexes
   ```
5. Export Firestore backup (`gcloud firestore export ...`), run `migrate-gig-contacts.mjs` dry-run, apply (`--apply`), then re-run dry-run and confirm `Legacy docs found: 0`.
6. Execute live smoke tests (admin login, WhatsApp contact, gig report + Sybil check, unauthenticated Firestore read returns zero `posterPhone`/`counterId`, and real Mobilis/Djezzy/Ooredoo SMS OTP check).
