# KHADMA — Khdma f Oran

Darija-first, completely free gig board for youth in **Oran, Algeria** (pilot city).
Mobile-first installable PWA that works on low-end Android and tolerates offline
reading (Firestore local cache + precached shell).

**Live:** https://khadma-oran.web.app · **Repo:** https://github.com/LCHEROURI/khadma

## Features (V1)

1. **Browse gigs** — filter by category + Oran neighborhood, newest first.
2. **Post a gig** — poster verifies by **SMS OTP** (Firebase Phone Auth) before the
   post goes live. Fields: title, category, description, pay (DZD, range OK),
   neighborhood, WhatsApp number (auto-filled from the verified number).
3. **Gig detail** — full description, pay, **verified badge**, one big WhatsApp
   (wa.me) contact button. Raw phone numbers are **never rendered**.
4. **Report a listing** — reason picker; **auto-hide after 3 reports**, pending
   admin review.
5. **Saved gigs** — bookmark, stored in `localStorage` (offline-first, no account).
6. **Admin moderation queue** — newest + flagged posts, approve/remove, seed/remove
   sample gigs in one tap. Protected by email login: **cherouri@gmail.com**.

## Stack (Google ecosystem)

- **Firebase Hosting** (PWA), **Firestore** (data + rules), **Firebase Auth**
  (Phone OTP for posters, email/password for the admin).
- Vite + React + TypeScript, `vite-plugin-pwa` (Workbox), no UI library — hand-rolled
  design system in `src/styles.css`.

## Language

Darija (Latin script) is the default; French and Modern Standard Arabic (RTL)
are a toggle in Settings. **Every user-facing string lives in
`src/lib/strings.ts`** — no hardcoded copy in components.

## Trust & safety (enforced in Firestore rules + client)

- "Never pay to get a job" banner on the post screen and every gig detail.
- **Max 5 active gigs per verified phone number** — enforced by a monotonic
  `phoneCounters/{e164}` document that only the phone's owner can create (+1)
  and only admin can decrement. The 6th post is rejected by security rules.
- Minimum data collection: phone number, listings, reports. Nothing else.
  No analytics, no tracking.
- Contact number = verified number (can't post someone else's WhatsApp).
- Samples are clearly marked and removable in one tap from the admin queue.

## Data model (Firestore)

| Collection | Fields |
|---|---|
| `gigs/{id}` | title, description, category, payMin, payMax, neighborhood, posterPhone (E.164, never rendered), counterId, flags, status (`active`\|`hidden`\|`removed`), verified, isSample, createdAt |
| `phoneCounters/{e164}` | `{ count }` — monotonic +1 per post; only admin can decrement |
| `reports/{id}` | gigId, reason, reporterId, createdAt |

Auto-hide: the 3rd report flips the gig to `hidden`; admin reviews (approve/remove)
in the queue. Removal frees the poster's rate-limit slot.

## Firebase setup (one-time, manual — CLI can't do these)

The project `khadma-oran` already exists, Firestore is created (europe-west3),
and Hosting/rules/indexes are deployed. Still needed in the
[Firebase console](https://console.firebase.google.com/project/khadma-oran):

1. **Upgrade to Blaze (pay-as-you-go)** — Phone Auth verification requires it
   (Spark doesn't allow Phone Auth at all). With no other usage it stays free;
   each real Algerian SMS costs a few cents (US/CA/IN test numbers are free).
2. **Authentication → Sign-in method → Phone**: enable it.
3. **Authentication → Sign-in method → Email/Password**: enable it (admin login).
4. **Authentication → Users → Add user**: create `cherouri@gmail.com` with a
   password (this is the admin).
5. **Authentication → Sign-in method → Phone → Phone numbers for testing**:
   add a test number + code (e.g. `+1 555 555 5555` / `123456`) to run the
   walkthrough without a real SIM.

## Local dev

```bash
npm install
npm run dev
```

OTP flow needs the reCAPTCHA to load; use Chrome. Test numbers work against the
real project once added in the console (step 5 above).

## Deploy

```bash
npm run build
firebase deploy --only hosting,firestore:rules,firestore:indexes
```

PWA icons: edit `public/favicon.svg`, then `npm run generate:pwa-assets`.

## Project layout

```
src/
  lib/strings.ts    — ALL user-facing copy (dar/fr/ar)
  lib/constants.ts  — categories, Oran neighborhoods, limits, admin email
  lib/db.ts         — Firestore queries + transactional post/report/admin ops
  lib/phone.ts      — Algerian E.164 normalization + wa.me links
  lib/samples.ts    — 10 Darija sample gigs (admin-seeded)
  pages/            — Browse, GigDetail, PostGig, Saved, Settings, Admin
  components/       — GigCard, Banner, ReportSheet, WhatsAppButton, …
firestore.rules     — trust & safety enforcement (rate limit, OTP, auto-hide)
firestore.indexes.json — composite indexes for browse/admin queries
```

## Report → auto-hide → review flow

1. A gig gets 3 reports (any signed-in user; anonymous accounts are created
   automatically for reporters).
2. The 3rd report sets `status: hidden` — it disappears from browsing.
3. Admin queue → "Flagged" tab → **Réapprouver** (back to active, flags reset)
   or **Retirer** (removed; frees the poster's counter slot).

## Walkthrough (post → verify → view → report)

1. Open the site on a phone (Chrome) → "Ajouter à l'écran d'accueil" to install.
2. **Post**: bottom nav "Zid i3lan" → enter the test phone number → get the code
   (test numbers: use the code you configured in the console) → confirm → fill
   the form → "Necher el i3lan".
3. **View**: the gig detail opens — banner, verified badge, WhatsApp button.
4. **Report**: open the same gig from a second browser/incognito window (or clear
   site data) and report it; repeat 3× → it auto-hides from the board.
5. **Admin**: Settings → Admin → login as `cherouri@gmail.com` → the gig shows in
   "Mballghin" → approve or remove. Use "Zid 10 i3lanat exemples" to seed the
   board or "7ayed kol les exemples" to remove samples in one tap.
