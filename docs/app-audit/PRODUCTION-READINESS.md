# Stage 09 — Production Readiness Audit

- **Mode:** Read-only (no deployments executed)

## Readiness Checklist

| Area | Status | Evidence / Notes |
|---|---|---|
| Secrets & `.gitignore` | PASS | `.env` and `.env.*` gitignored; `.env.example` documents `VITE_FIREBASE_API_KEY` |
| Firestore Rules Compilation | PASS | `firebase deploy --only firestore:rules --dry-run` exited `0` |
| PWA Assets & Manifest | PASS | `index.html:9` now points to `/apple-touch-icon-180x180.png`; `manifest.webmanifest` icons exist in `public/` |
| Hosting Cache Headers | PASS | `firebase.json:8-21` sets `immutable` on `/assets/**` and `no-cache` on `index.html`/`sw.js`/`manifest.webmanifest` |
| Error Boundary | PASS | `src/components/ErrorBoundary.tsx` wraps `<Routes>` in `src/App.tsx:30` |
| Production Build (`npm run build`) | NOT VERIFIED | Stalled on local iCloud Drive `node_modules/` I/O (`QUAL-001`) |
| CI/CD Pipeline | FAIL | No `.github/workflows/` present (`OPS-001`) |
| Admin Email Verification Prerequisite | NOT VERIFIED | Must verify `cherouri@gmail.com` has `emailVerified: true` in Firebase Auth before deploying rules (`BUG-001`) |
| Git Working Tree Cleanliness | FAIL | 22 uncommitted files on `main` (`OPS-002`) |

## Findings

| ID | Severity | Certainty | Affected Files | Issue & Recommended Fix |
|---|---|---|---|---|
| `OPS-001` | High | CONFIRMED | *(missing `.github/workflows/`)* | **No CI/CD workflow.** Add a GitHub Actions workflow running `npm ci`, `npm run build`, and rules unit tests on every push/PR to `main`. |
| `OPS-002` | Medium | CONFIRMED | `git status` (22 files) | **Uncommitted local changes on `main`.** Move changes to a dedicated working branch, verify `npm run build`, and commit/push per `AGENTS.md` before deploying. |
| `OPS-003` | Low | CONFIRMED | `firebase.json` | **No Firebase Emulator config.** Add `emulators` (`auth`, `firestore`, `hosting`) to `firebase.json` so local testing never touches production `khadma-oran`. |

## Deployment & Rollback Runbook (Manual — Requires Explicit Authorization)

1. **Pre-deploy prerequisites:**
   - Confirm `cherouri@gmail.com` has `emailVerified: true` in Firebase Console → Authentication → Users.
   - Verify `npm run build` exits `0` cleanly.
   - Verify SMS region restriction in Firebase Console (allowlist Algeria `+213`) to prevent SMS pumping on Blaze.
2. **Deploy (when authorized):**
   ```bash
   npm run build
   firebase deploy --only hosting,firestore:rules,firestore:indexes
   ```
3. **Rollback:**
   - Hosting: Firebase Console → Hosting → Release history → **Rollback** to previous release.
   - Firestore Rules: Firebase Console → Firestore → Rules → Version history → restore previous ruleset (or `git checkout 8a01a9d -- firestore.rules && firebase deploy --only firestore:rules`).
