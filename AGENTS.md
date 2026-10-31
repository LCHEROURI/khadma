# AGENTS.md

## Stack policy

For building apps, use the Google ecosystem by default unless instructed
otherwise — prefer Firebase / Google Cloud services for backend, database,
authentication, hosting, and other platform needs; ask before using a
non-Google service.

## Project: KHADMA (Khadma-app)

Darija-first, completely free gig board for youth in Oran, Algeria.
Mobile-first installable PWA. Firebase: Phone Auth (SMS OTP), Firestore, Hosting.

### Non-negotiables

- All user-facing copy lives in `src/lib/strings.ts` (Darija default, `fr` + `ar`
  variants). No hardcoded strings in components.
- Pilot city is ORAN ONLY. Content and filters use only these neighborhoods:
  Bir El Djir, Es Sénia, Canastel, Maraval, Gambetta, El Hamri, Ain El Turk,
  Wahran El Jadida. Nothing from Algiers.
- Trust & safety:
  - "Never pay to get a job" banner on the post screen AND every gig detail.
  - Max 5 active gigs per verified phone number (enforced in Firestore rules via
    monotonic `phoneCounters/{e164}` documents).
  - Minimum data collection: phone number, listings, reports. Nothing else.
  - Raw phone numbers are never rendered in the UI; contact goes through a
    wa.me button only. (The wa.me URL necessarily contains the number.)
  - Firebase SMS OTP is the poster verification path. If SMS delivery fails on
    Algerian carriers (Mobilis, Djezzy, Ooredoo), STOP and switch to
    WhatsApp-based verification before building further.
- Admin is `cherouri@gmail.com` (email/password auth), gate in rules + client.
- After each piece of work: `git commit` + `git push` so GitHub matches this machine.

### Commands

- `npm run dev` — local dev
- `npm run build` — typecheck + production build
- `npm run generate:pwa-assets` — regenerate PWA icons from `public/favicon.svg`
- `firebase deploy --only hosting,firestore:rules` — deploy PWA + rules

### Data model (Firestore)

- `gigs/{id}` — title, description, category, payMin, payMax, neighborhood,
  posterPhone (E.164, never rendered), counterId, flags, status
  (`active` | `hidden` | `removed`), verified, isSample, createdAt
- `phoneCounters/{e164}` — `{ count }`, monotonic +1 per post; only admin can decrement
- `reports/{id}` — gigId, reason, reporterId, createdAt
- Saved gigs — `localStorage` (`khadma-saved`), offline-first, no account required

Browsing is client-side filtered (Oran pilot scale): fetch latest active gigs,
filter by category/neighborhood in memory. Auto-hide: 3 reports -> status `hidden`,
admin reviews in queue (approve/remove).
