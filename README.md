# Greyhaven Real Estate App

A player-run real estate map for the Greyhaven GTA5 FiveM server. Pure
static web app — no build step, no login system. Just open `index.html` in a
browser (double-click it).

## Two modes (picked automatically from `js/config.js`)

**LOCAL (default)** — config left empty. Data lives in your browser's
localStorage only. Share via EXPORT/IMPORT JSON files.

**SHARED** — config filled in. The app reads/writes two tables in a Supabase
project, so everyone with a copy of the app sees and edits the same map. It
can safely share a Supabase project with other apps — it only ever touches
its own two tables.

## Turning on shared mode (one-time, ~5 minutes)

1. Open your Supabase dashboard → your project → **SQL Editor** → paste the
   contents of `supabase_re_setup.sql` → Run.
   (It only adds `re_properties` and `re_zones`; nothing else in the project
   is touched.)
2. **Settings → API** → copy the **Project URL** and the **anon public** key
   (NOT the service_role secret).
3. Open `js/config.js` and paste them into `SB_URL` and `SB_ANON_KEY`.
4. Open `index.html` — the top-right badge should read **SHARED DB — CONNECTED**.
5. Zip this folder and send it to your friends. They just open `index.html`
   — same map, live.

Notes on shared mode:
- Changes from other players appear on REFRESH and auto-refresh (every 60s).
- localStorage still acts as an offline cache; if the database is unreachable
  the badge turns red and you see your last synced copy.

## Editor roles (viewers vs editors)

Out of the box, shared mode lets **anyone** with the app edit the map. To
restrict editing to approved people (everyone else can still view, search
and interact), turn on editor roles:

1. **SQL Editor** → paste the contents of `supabase_auth_setup.sql` → Run.
   From now on the database rejects writes from anyone who isn't an
   approved editor.
2. **Authentication → Sign In / Providers**: keep "Allow new users to sign
   up" **ON**, and under the Email provider turn "Confirm email" **OFF**
   (accounts are username-based — there is no real inbox to confirm).
3. **Bootstrap the first admin (yourself):** in the app, EDITOR LOGIN →
   REQUEST ACCESS → pick a username + password. Then in the dashboard,
   **Table Editor → re_editors** → your row → set `approved` and `admin`
   to true.

How it works from then on — no emails anywhere:

- Anyone can hit **EDITOR LOGIN → REQUEST ACCESS** and pick a username +
  password. Their account starts **PENDING** (view-only).
- An admin opens the **ADMIN** button in the top bar and APPROVEs,
  REJECTs, or later REVOKEs accounts. Approval kicks in on the editor's
  next refresh (or within the 60s auto-refresh).
- Editing buttons (add / edit / draw / import) only appear for approved
  editors — and the database enforces it server-side regardless.

Keep occasional EXPORTs as backups anyway — any approved editor can still
IMPORT/replace the whole map.

## Features

- **Property pins** on the GTA5 map — pin **color = status** (For Sale, For
  Rent, Sold, Owned, Rented, Off Market), pin **icon = type** (House,
  Apartment, Mansion, Business, Warehouse, Garage, Office, Hotel, Land).
- Price, owner/tenant, garage spaces, interior notes and a **photo**
  (screenshots are auto-compressed to ~100 KB).
- **Neighborhood zones** — draw shaded, named areas on the map
  (e.g. "Vinewood Hills — $2M and up").
- **Filters** by status and type, plus live text search.
- **Listings page** — sortable table (click column headers), stats row with
  total market value, and a MAP button that flies to the pin.
- **EXPORT / IMPORT** — JSON backup/restore in both modes. In shared mode,
  IMPORT replaces the shared map for everyone (it warns you first).

## Files

```
├── index.html              # the whole app — open this
├── supabase_re_setup.sql   # run once in your Supabase SQL editor (shared mode)
├── supabase_auth_setup.sql # optional: lock editing to editor accounts
├── css/style.css           # dark terminal theme, gold accent
├── js/config.js            # paste Supabase URL + anon key here (or leave empty)
├── js/store.js             # data layer: Supabase REST or localStorage
├── js/map.js               # Leaflet map (CRS.Simple), pins, zones
├── js/app.js               # tabs, stats, listings table, auto-refresh
└── img/gta5-map.jpg        # the GTA5 satellite map
```

Internet is needed for the Leaflet CDN, and for the database in shared mode.
