// ============================================================
// config.js — shared database connection (optional).
//
// To share the map with other players, fill in BOTH values from
// your Supabase dashboard:
//   Settings → API → Project URL          → SB_URL
//   Settings → API → "anon public" key    → SB_ANON_KEY
// ...and run supabase_re_setup.sql once in the SQL Editor first.
//
// The anon public key is DESIGNED to be visible in a browser app —
// it is NOT the service_role secret. Never put the service_role
// key here.
//
// Leave both empty ('') and the app runs in local-only mode
// (data stays in this browser's localStorage).
// ============================================================

const SB_URL = '';
const SB_ANON_KEY = '';
