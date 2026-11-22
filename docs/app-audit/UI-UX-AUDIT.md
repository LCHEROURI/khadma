# Stage 06 — UI & UX Audit

- **Mode:** Read-only audit (no application files modified)

## Route & Screen Inventory

| Route | Component | Loading State | Empty / Error State | RTL / i18n |
|---|---|---|---|---|
| `/` | `Browse.tsx` | Yes (`common.loading`) | Yes (`empty`, `emptyNoGigs`, `error`) | Localized categories & neighborhoods |
| `/gig/:id` | `GigDetail.tsx` | Yes | Yes (`missing` + back button) | Localized; RTL back arrow flipped |
| `/post` | `PostGig.tsx` | Yes (`authLoading`) | Validation + rate-limit errors | Localized; hardcoded `DZD` suffix (`UX-001`) |
| `/saved` | `Saved.tsx` | Yes | Yes (`saved.empty`) | Localized |
| `/settings` | `Settings.tsx` | N/A | Install confirmation fixed | Localized |
| `/admin` | `Admin.tsx` | Yes (`authLoading`) | Yes (`notAdmin`, `empty`, `notice`) | Localized |

## Open Findings

| ID | Severity | Certainty | Affected Files | Issue & Recommended Fix |
|---|---|---|---|---|
| `UX-001` | Medium | CONFIRMED | `src/lib/format.ts:7-8`, `src/pages/PostGig.tsx:257`, `src/lib/strings.ts:386` | **Hardcoded currency `DZD` in Arabic mode.** `post.payLabel` uses `دج` in Arabic (`strings.ts:386`), but `formatPay()` and the pay input suffix hardcode `DZD`. **Fix:** Add a `common.currency` key (`DZD` in `dar`/`fr`, `دج` in `ar`) and pass it into `formatPay` and `PostGig`. |
| `UX-002` | Medium | CONFIRMED | `src/components/ReportSheet.tsx:44`, `src/components/BottomNav.tsx:15`, `src/pages/Admin.tsx:172` | **Accessibility gaps.** `ReportSheet` dialog lacks `aria-labelledby`, Escape-key dismissal, and focus restoration; `BottomNav` `<nav>` lacks `aria-label`; `Admin` refresh icon-only button lacks `aria-label`. |
| `UX-003` | Low | CONFIRMED | `src/pages/Admin.tsx:73-97`, `src/pages/PostGig.tsx:167-285` | **Non-`<form>` submission containers.** `Admin` login and `PostGig` steps use `<div>` + button `onClick` instead of `<form onSubmit>`, preventing mobile keyboard "Go"/"Done" or desktop Enter-key submission. |

## Previously Fixed in Uncommitted Working Tree (Preserved)

- Added missing CSS definitions in `src/styles.css` for `PostGig` (`.panel`, `.btn-block`, `.verified-banner`, `.small`, `.field-row`, `.pay-inputs`, `.pay-suffix`, `.field-hint`, `.recap`) and `[dir='rtl'] .back-link svg`.
- Replaced hardcoded `KHADMA` in `Header.tsx`, hardcoded `cherouri@gmail.com` in `Admin.tsx`, raw neighborhood names across `Browse`/`GigCard`/`GigDetail`/`PostGig`/`Admin`, and `♥` mismatch in `saved.empty`.
