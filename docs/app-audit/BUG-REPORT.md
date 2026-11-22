# Stage 03 — Bug Investigator Report (Updated After High-Priority Repairs)

## High-Priority Bug Resolved (`BUG-001`)

- **Diagnostic Evidence:** Executed read-only Firebase Auth check (`firebase auth:export` parsed for `emailVerified` only, temp file deleted immediately, zero secrets printed):
  - `FOUND: 1 emailVerified: False disabled: None` for `cherouri@gmail.com`.
- **Root Cause:** Manually created Firebase Console Email/Password accounts default to `emailVerified: false`, while hardened `firestore.rules` and `useAuth.ts` enforce `emailVerified === true`.
- **Fix Applied (Without Weakening Auth):**
  - Kept `request.auth.token.email_verified == true` in `firestore.rules` and `user?.emailVerified` in `src/hooks/useAuth.ts`.
  - Added localized verification UI in `src/pages/Admin.tsx` + `src/lib/strings.ts` (`dar`/`fr`/`ar`) when `user.email === ADMIN_EMAIL && !user.emailVerified`, allowing the admin to trigger `sendEmailVerification(user)` and refresh their ID token (`user.reload()` + `user.getIdToken(true)`).
- **Regression Verification:**
  - `npm run typecheck` + `npm run build`: **PASS**
  - `tests/rules/firestore.rules.test.ts`: **PASS** (explicitly verifies unverified `cherouri@gmail.com` is `DENY` and verified `cherouri@gmail.com` is `ALLOW`).

## Remaining Medium/Low Bugs (Deferred Until High-Priority Review)

- `BUG-002` (Medium): Stale `RecaptchaVerifier` on resend / `changeNumber` (`src/pages/PostGig.tsx`).
- `BUG-003` (Medium): Generic error on duplicate report (`src/components/ReportSheet.tsx`).
- `BUG-004` (Low): Uncleaned `setTimeout` on unmount (`src/pages/GigDetail.tsx`).
