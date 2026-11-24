# AGENTS.md

## Stack policy

For building apps, use the Google ecosystem by default unless instructed
otherwise — prefer Firebase / Google Cloud services for backend, database,
authentication, hosting, and other platform needs; ask before using a
non-Google service.

## Project: KHADMA (Khadma-app)

French-first (`fr` LTR) and Modern Standard Arabic (`ar` RTL), completely free
jobs and services marketplace for Oran, Algeria.
Mobile-first installable PWA. Firebase: Authentication, Firestore, Cloud
Functions (2nd Gen, `europe-west1`), App Check, Hosting.

### Non-negotiables (V1.4 Approved Architecture)

- All user-facing copy lives in `src/lib/strings.ts` (`fr` default LTR, `ar`
  RTL). No hardcoded user-facing strings in components.
- Launch city is **ORAN ONLY** during V1.4. Content and filters use only these
  eight canonical Oran neighborhoods: Bir El Djir, Es Sénia, Canastel, Maraval,
  Gambetta, El Hamri, Ain El Turk, Wahran El Jadida. Schema includes
  future-ready `city: 'oran'` and `wilayaCode: '31'` (locked to Oran in V1.4).
- Seven canonical Firestore category IDs remain unchanged: `construction`,
  `delivery`, `cleaning`, `tutoring`, `restaurant`, `events`, `digital`.
- Authentication & employer identity:
  - **Email-first authentication** (Firebase Email/Password + mandatory
    `emailVerified` before publishing) for all new employer accounts. New
    SMS-based employer registrations are disabled to avoid \$0.17/SMS Algeria
    charges.
  - Existing phone-authenticated accounts, UIDs, and listing ownership are
    preserved; in-app email linking (`linkWithCredential`) is supported without
    deleting existing providers or accounts.
- Account-free job seekers & external contact:
  - Job seekers browse, search, filter, and contact employers without creating
    an account.
  - Contact uses ordinary **WhatsApp Click-to-Chat (`wa.me`)** and native
    **`mailto:`** links only. No paid WhatsApp Business API and no internal
    messaging/chat.
  - Raw phone numbers and private emails are never stored on public `gigs/{id}`
    documents or rendered in public UI; private contacts live in
    `gigContacts/{gigId}` and are served on demand via the App-Check-protected,
    rate-limited `getGigContactLink` Cloud Function.
- Trust, quotas, expiration & moderation:
  - "Never pay to get a job" banner on the post screen AND every gig detail.
  - Advertisement quotas (enforced atomically server-side via `employers/{uid}`):
    maximum **3** active/pending advertisements for new employers; existing
    legacy phone employers retain maximum **5**. Archived and expired
    advertisements do not count. Administrators may adjust employer quotas.
  - Advertisements expire **30 days** after publication (`expiresAt`); free
    renewal is available during the **final 7 days** before expiration,
    extending for another 30 days. Expired advertisements may be republished
    subject to quota and moderation.
  - Mandatory pre-publication approval (`settings/marketplace.requirePreApproval`)
    is **OFF by default** at initial launch so eligible verified employers
    publish immediately. Administrators can toggle it ON/OFF at runtime without
    redeployment; enabling it never retroactively hides active listings.
  - Automated validation, quotas, 3-report IP-Sybil-resistant auto-hide,
    administrator removal, and employer suspension remain active regardless of
    the moderation toggle.
- Admin is `cherouri@gmail.com` (verified email/password auth), gated in rules
  and server-side Cloud Functions.
- Only commit/push/deploy when explicitly authorized for the current task.

### Commands

- `npm run dev` — local dev
- `npm run lint` — ESLint across `src`, `functions/src`, `tests`
- `npm run typecheck` — TypeScript check
- `npm run build` — typecheck + production PWA build
- `npm run test:unit` / `npm run test:security` / `npm run test:rules` / `npm run test:e2e`
- `npm run generate:pwa-assets` — regenerate PWA icons from `public/favicon.svg`

### Data model (Firestore)

- `gigs/{id}` — public when `status == 'active'` and not expired; title,
  description, category, listingType (`job` | `service`), city (`oran`),
  wilayaCode (`31`), contactMethods (`['whatsapp' | 'email']`), payMin, payMax,
  neighborhood, posterUid, flags, status (`pending` | `active` | `archived` |
  `expired` | `hidden` | `removed`), verified, isSample, createdAt, updatedAt,
  expiresAt, moderationReason (NO PII)
- `gigContacts/{id}` — private PII (admin-read-only; Cloud Functions Admin SDK)
- `employers/{uid}` — UID-based quotas (`maxActiveGigs`, `activeCount`),
  `trustLevel`, `suspended`, legacy phone link, default contact preferences
  (owner/admin read; Admin SDK write only)
- `settings/marketplace` — runtime moderation configuration
  (`requirePreApproval`, `remoderateMaterialEditsWhenEnabled`; admin read;
  Admin SDK write only)
- `auditLogs/{id}` — server-written moderation/lifecycle audit trail (admin
  read only)
- `phoneCounters/{e164}` — legacy phone quota counters preserved for backward
  compatibility during migration
- `reports/{gigId}_{uid}`, `contactRateLimits/{id}`, `reportRateLimits/{id}` —
  server-managed abuse and rate-limit collections
- Saved gigs — `localStorage` (`khadma-saved`), offline-first, no account required
