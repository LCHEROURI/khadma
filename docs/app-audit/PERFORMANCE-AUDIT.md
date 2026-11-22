# Stage 07 — Performance Audit

- **Mode:** Read-only measurement & analysis

## Measured Baseline Bundle Sizes (Last Built `dist/`, Oct 31 — Pre-Edit)

| Asset | Uncompressed Size | Notes |
|---|---|---|
| `dist/assets/firebase-CZPjta4p.js` | `569 KB` | Bundles `firebase/app`, `firebase/auth`, `firebase/firestore` together (`vite.config.ts:38`) |
| `dist/assets/react-DKStUEh6.js` | `161 KB` | `react`, `react-dom`, `react-router-dom` |
| `dist/assets/index-B92px6h4.js` | `55 KB` | All 6 routes eagerly loaded |
| `dist/assets/index-DD5zj4uD.css` | `12 KB` | Single hand-rolled stylesheet (compact) |
| `dist/assets/workbox-window.prod.es5-X279BU3z.js` | `5.6 KB` | PWA registration |
| **Total JS + CSS** | **~802.6 KB** | Post-change build `NOT VERIFIED` (`PERF-002`) |

## Findings

| ID | Severity | Certainty | Affected Files | Bottleneck & Recommended Fix |
|---|---|---|---|---|
| `PERF-001` | Medium | CONFIRMED | `vite.config.ts:37-40`, `src/App.tsx:6-11` | **Heavy initial Firebase chunk (`569 KB`) loaded eagerly on `/`.** First-time Oran visitors browsing `/` download `firebase/auth` (Phone Auth + reCAPTCHA + Email/Password) even though browsing is unauthenticated. **Fix:** Split `firebase/auth` into its own manual chunk and lazy-load `/post`, `/admin`, `/settings`, and `/saved` routes. |
| `PERF-002` | Medium | NOT VERIFIED | `dist/` | **Post-edit bundle & Lighthouse metrics not yet measured.** `dist/` reflects the Oct 31 build prior to the 22 uncommitted files; `npm run build` stalled on local iCloud Drive `node_modules/` I/O. Re-measure after running `npm run build` on local disk or CI. |

## Previously Fixed in Uncommitted Working Tree (Preserved)

- `firebase.json:8-21` cache headers fixed: `/assets/**` and icons now use `public, max-age=31536000, immutable`; `/index.html`, `/sw.js`, and `/manifest.webmanifest` use `no-cache`.
- `getGigsByIds` converted from sequential `for-await` (up to 60 serial round-trips) to parallel `Promise.all` (`src/lib/db.ts:66-71`).
- `Browse.tsx` pagination no longer renders a redundant "Load more" button when fewer than 50 gigs exist (`src/lib/db.ts:53-57`).
