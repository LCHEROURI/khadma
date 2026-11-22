# Stage 06 — UI & UX Audit (Updated After Medium-Priority Repairs)

## Repaired Findings

- **`UX-001` (`FIXED & VERIFIED`):** Added `common.currency` (`DZD` in `dar`/`fr`, `دج` in `ar`) in `src/lib/strings.ts` and wired it through `formatPay()` (`src/lib/format.ts`), `GigCard.tsx`, `GigDetail.tsx`, `Admin.tsx`, and `PostGig.tsx`. Verified via unit tests (`tests/unit/format.test.ts`).
- **`UX-002` (`FIXED & VERIFIED`):**
  - `ReportSheet.tsx`: Added `aria-labelledby="report-sheet-title"`, `id="report-sheet-title"`, `tabIndex={-1}` auto-focus on open, and Escape-key dismissal.
  - `BottomNav.tsx`: Added localized `aria-label={t('nav.label')}`.
  - `Admin.tsx`: Added localized `aria-label={t('common.refresh')}` to the icon-only refresh button.
- **`WhatsAppButton` Mobile/Desktop Navigation (`FIXED & VERIFIED`):** Uses `window.location.assign(waUrl)` directly on coarse-pointer mobile devices (opening WhatsApp via App Links / Universal Links without popup blocking) and opens a blank tab synchronously on desktop (`popup.opener = null`, then `popup.location.replace(waUrl)`) to avoid desktop Safari double-navigation.

- **`UX-003` (`FIXED & VERIFIED`):** Converted `Admin` login and all three `PostGig` steps (`verify`, `code`, `form`) to semantic `<form onSubmit>` containers with `type="submit"` primary buttons and explicit `type="button"` secondary controls; Enter-key submission verified in Playwright E2E (`tests/e2e/khadma.spec.ts`).

## Remaining Open UI Findings
- None.
