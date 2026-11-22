# Stage 08 — End-to-End & Automated Testing Results (Updated After High-Priority Repairs)

## Executed Test Suites (Local APFS `/tmp/khadma-verify`, Zero Production Writes)

| Suite | Command | Passed / Total | Duration | Status |
|---|---|---|---|---|
| Unit tests (`tests/unit/phone.test.ts`, `tests/unit/format.test.ts`) | `npm run test:unit` | `8 / 8` | `192ms` | **PASS** |
| Firestore Security Rules (`tests/rules/firestore.rules.test.ts`) | `npm run test:rules` | `4 / 4` | `1.05s` | **PASS** |
| Playwright Mobile E2E (`tests/e2e/khadma.spec.ts`, Pixel 5 Chromium) | `npm run test:e2e` | `5 / 5` | `3.2s` | **PASS** |

## Playwright Journeys Verified (`5 / 5 PASS`)

1. Browse screen renders safety banner, Oran-only neighborhoods (`Bir El Djir`, `Es Sénia`, zero Algiers/Alger), and bottom navigation.
2. Settings switches language to Arabic (`العربية`), sets `<html dir="rtl">`, localizes header brand to `خدامة`, and persists across reload.
3. `/post` renders safety banner and rejects invalid Oran landline (`041123456`) with `.form-error`.
4. `/saved` renders offline-first empty state without login.
5. `/admin` renders email/password login gate when unauthenticated.

## Explicitly Marked `NOT VERIFIED`

- Live SMS OTP delivery on Algerian carriers (Mobilis, Djezzy, Ooredoo) — requires real handset test.
- Live Cloud Function `/api/contact/:gigId` 302 redirect on deployed `khadma-oran` — requires approved deployment of `functions` + `hosting`.
