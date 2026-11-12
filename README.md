# AMAN OS — app

Next.js 16 + TypeScript + Tailwind 4, exported as a static, installable PWA that talks
directly to Supabase. Every query is protected by Row Level Security in the database
(see the `aman-os` database package); only the publishable key ships to the browser.

## Modules
Today (command centre) · AOR (judgment register, CSV import, spaced repetition, study
timer, revision calendar, mock tests, recall questions, notes) · HYROX (countdown to
18 Jan 2027, division standards, periodised plan, session logger with 1 km splits and
station results, station trackers & PBs, race checklist & result) · Nutrition (log,
food library, water, estimated vs verified, safety note) · Fitness & Garmin (daily
metrics, workouts, mileage, pace, PBs, calendar, FIT/TCX/CSV import, Garmin status:
Pending Connection) · Weight & waist · Diary (daily + weekly review, cross-device
conflict detection, search) · Analytics · Settings (targets, export, delete account).

## Configure
`.env.local`
```
NEXT_PUBLIC_SUPABASE_URL=https://<project-id>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```
Never put the service-role / secret key in this app.

## Build
```
npm install
npm run build        # outputs ./out (static site)
```
Deploy `./out` to any static host (Netlify Drop, Vercel, Cloudflare Pages).
Then in Supabase → Authentication → URL Configuration, set the Site URL to your
deployed address and add `<address>/**` to Redirect URLs.

## Tests
`NODE_PATH=<playwright modules> node tests/e2e.cjs` — builds must exist in ./out.
Runs 56 checks at iPhone (390×844) and Mac (1440×900) sizes against an in-memory
stand-in for Supabase: auth redirect, every module's create/read/update flows,
imports, overflow, keyboard shortcuts, PWA metadata and a secret-key scan.
