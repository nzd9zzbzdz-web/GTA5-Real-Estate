# Greyhaven Real Estate App

A player-run real estate map for the Greyhaven GTA5 FiveM server. Pure
static web app — no build step. Just open `index.html` in a browser
(double-click it), or host it anywhere static (e.g. Vercel).

## Two modes (picked automatically from `js/config.js`)

**LOCAL (default)** — config left empty. Data lives in your browser's
localStorage only. Share via EXPORT/IMPORT JSON files.

**SHARED** — config filled in. The app reads/writes Firestore collections
in a Firebase project, so everyone with the app sees the same map. Anyone
can view; editing requires an approved editor account (see below).

## Turning on shared mode (one-time, ~5 minutes)

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
   → **Add project** (any name; Google Analytics can stay off).
2. **Build → Firestore Database → Create database** → production mode →
   pick a region near you.
3. Firestore → **Rules** tab → replace everything with the contents of
   `firestore.rules` → **Publish**.
4. **Build → Authentication → Get started** → Sign-in method →
   **Email/Password** → Enable → Save. (Accounts are usernames in the app;
   the email format is only used internally — nothing is ever sent.)
5. Project settings (gear icon) → **General** → Your apps → Web (`</>`) →
   register the app → copy the `firebaseConfig` object into
   `js/config.js` as `FIREBASE_CONFIG`.
6. Open the app — the top-right badge should read **SHARED DB — CONNECTED**.

Notes on shared mode:
- Changes from other players appear on REFRESH and auto-refresh (every 60s).
- localStorage still acts as an offline cache; if the database is unreachable
  the badge turns red and you see your last synced copy.

## Editor roles (viewers vs editors)

Anyone with the URL can view, search and interact. Editing works like this
— no emails anywhere:

- Anyone can hit **EDITOR LOGIN → REQUEST ACCESS** and pick a username +
  password. Their account starts **PENDING** (view-only).
- An admin opens the **ADMIN** button in the top bar and APPROVEs,
  REJECTs, or later REVOKEs accounts. Approval kicks in on the editor's
  next refresh (or within the 60s auto-refresh).
- Editing buttons (add / edit / draw / import) only appear for approved
  editors — and Firestore's rules enforce it server-side regardless.

**Bootstrap the first admin (yourself, one time):** request access in the
app, then in the Firebase console → **Firestore Database → re_editors** →
your document → set `approved` = true and `admin` = true. All later
approvals happen in the app.

Keep occasional EXPORTs as backups anyway — any approved editor can still
IMPORT/replace the whole map.

## Features

- **Property pins** on the GTA5 map — pin **color = status** (For Sale, For
  Rent, Sold, Owned, Rented, Off Market), pin **icon = type** (House,
  Apartment, Mansion, Business, Warehouse, Garage, Office, Hotel, Land).
- Price, owner/tenant, garage spaces, interior notes and up to **6 photos**
  per property (screenshots are auto-compressed to ~100 KB each; the first
  is the cover, click it in a popup to flip through the gallery).
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
├── firestore.rules         # paste into Firebase console → Firestore → Rules
├── css/style.css           # dark terminal theme, gold accent
├── js/config.js            # paste your Firebase web config here (or leave null)
├── js/store.js             # data layer: Firestore or localStorage
├── js/map.js               # Leaflet map (CRS.Simple), pins, zones
├── js/app.js               # tabs, stats, listings table, auto-refresh
└── img/gta5-map.jpg        # the GTA5 satellite map
```

Internet is needed for the Leaflet + Firebase CDNs, and for the database in
shared mode.
