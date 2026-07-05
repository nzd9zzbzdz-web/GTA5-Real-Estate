// ============================================================
// store.js — Data layer with two modes, picked automatically
// from js/config.js:
//
//   SHARED — SB_URL/SB_ANON_KEY are set: reads/writes the
//            re_properties / re_zones tables in a Supabase
//            project, so every player sees the same map.
//   LOCAL  — config left empty: this browser's localStorage only.
//
// In shared mode localStorage doubles as an offline cache, and
// EXPORT/IMPORT still work as backup/restore.
// ============================================================

const LS_KEY = 'greyhave_realestate_v1';

let state = { properties: [], zones: [] };

function backendOn() { return typeof SB_URL !== 'undefined' && !!SB_URL && !!SB_ANON_KEY; }

// Columns that exist in the database — imports are trimmed to these
// so a hand-edited JSON with extra keys doesn't fail the insert.
const PROP_COLS = ['id', 'name', 'type', 'status', 'price', 'owner', 'garage', 'description', 'photo', 'x', 'y', 'created_at', 'updated_at'];
const ZONE_COLS = ['id', 'name', 'note', 'color', 'coordinates'];
function pick(o, cols) { const r = {}; cols.forEach(k => { if (o[k] !== undefined) r[k] = o[k]; }); return r; }

// ---------- auth (editor accounts) ----------
// Editors sign up in the app with a USERNAME + password — no email.
// Supabase auth requires an email format internally, so the username
// becomes username@editors.greyhaven.local behind the scenes; nothing
// is ever sent anywhere. New accounts start PENDING (view-only) until
// an admin approves them in the ADMIN panel (re_editors table).
// The session lives in localStorage so editors stay logged in.
const AUTH_KEY = 'greyhave_realestate_auth_v1';
const AUTH_DOMAIN = 'editors.greyhaven.local';
let _session = null;

function authEmail(username) { return username.toLowerCase() + '@' + AUTH_DOMAIN; }
function validUsername(u) { return /^[a-zA-Z0-9_-]{3,20}$/.test(u); }

function loadSession() {
  try { _session = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); } catch (e) { _session = null; }
}

function saveSession(s) {
  _session = s;
  if (s) localStorage.setItem(AUTH_KEY, JSON.stringify(s));
  else localStorage.removeItem(AUTH_KEY);
}

// Local mode has no accounts — everyone edits their own browser data.
function isEditor() { return !backendOn() || !!(_session && _session.approved); }
function isAdmin()  { return backendOn() && !!(_session && _session.approved && _session.admin); }

async function authReq(path, body) {
  const res = await fetch(SB_URL.replace(/\/+$/, '') + '/auth/v1/' + path, {
    method: 'POST',
    headers: { apikey: SB_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.msg || data.message || ('AUTH ERROR ' + res.status));
  return data;
}

function sessionFrom(data) {
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    // refresh 60s early so a token never expires mid-request
    expires_at: Date.now() + Math.max((data.expires_in || 3600) - 60, 60) * 1000,
    user_id: (data.user && data.user.id) || (_session && _session.user_id) || null,
    username: (_session && _session.username) || '',
    approved: !!(_session && _session.approved),
    admin: !!(_session && _session.admin)
  };
}

async function login(username, password) {
  const data = await authReq('token?grant_type=password', { email: authEmail(username), password });
  _session = null;                         // fresh session, no stale flags
  const s = sessionFrom(data);
  s.username = username.toLowerCase();
  saveSession(s);
  await fetchEditorStatus();
}

async function signupEditor(username, password) {
  let data;
  try {
    data = await authReq('signup', { email: authEmail(username), password });
  } catch (e) {
    if (/already/i.test(e.message)) throw new Error('THAT USERNAME IS TAKEN');
    throw e;
  }
  if (!data.access_token) throw new Error('SIGNUP INCOMPLETE — "CONFIRM EMAIL" MUST BE TURNED OFF IN SUPABASE');
  _session = null;
  const s = sessionFrom(data);
  s.username = username.toLowerCase();
  saveSession(s);
  // File the access request — starts unapproved; an admin flips it.
  await sbReq('re_editors', { method: 'POST', body: { user_id: s.user_id, username: s.username } });
}

// Re-reads approved/admin flags so an approval takes effect on the
// next refresh without the editor logging out and back in.
async function fetchEditorStatus() {
  if (!_session || !_session.user_id) return;
  try {
    const rows = await sbReq('re_editors?user_id=eq.' + _session.user_id + '&select=username,approved,admin');
    if (rows && rows[0]) {
      _session.username = rows[0].username;
      _session.approved = !!rows[0].approved;
      _session.admin = !!rows[0].admin;
    } else {
      _session.approved = false; _session.admin = false;   // removed by an admin
    }
    saveSession(_session);
  } catch (e) { /* offline — keep last known status */ }
}

async function logout() {
  const token = _session && _session.access_token;
  saveSession(null);
  if (token) {
    // best-effort server-side revoke; local session is already gone
    fetch(SB_URL.replace(/\/+$/, '') + '/auth/v1/logout', {
      method: 'POST',
      headers: { apikey: SB_ANON_KEY, Authorization: 'Bearer ' + token }
    }).catch(() => {});
  }
}

// Returns a valid access token, refreshing if stale; null = not logged in.
async function currentAccessToken() {
  if (!_session) return null;
  if (Date.now() < _session.expires_at) return _session.access_token;
  try {
    const data = await authReq('token?grant_type=refresh_token', { refresh_token: _session.refresh_token });
    saveSession(sessionFrom(data));
    return _session.access_token;
  } catch (e) {
    saveSession(null);
    if (typeof updateAuthUI === 'function') updateAuthUI();
    throw new Error('SESSION EXPIRED — LOG IN AGAIN');
  }
}

// ---------- Supabase REST (PostgREST) ----------
async function sbReq(path, opts = {}) {
  const method = opts.method || 'GET';
  const headers = { apikey: SB_ANON_KEY };
  // Logged-in editor: their token carries write rights. Otherwise
  // old JWT-style anon keys also go in the Authorization header
  // (new sb_publishable_* keys must NOT).
  const token = await currentAccessToken();
  if (token) headers.Authorization = 'Bearer ' + token;
  else if (!SB_ANON_KEY.startsWith('sb_')) headers.Authorization = 'Bearer ' + SB_ANON_KEY;
  if (method !== 'GET') { headers['Content-Type'] = 'application/json'; headers.Prefer = 'return=minimal'; }
  const res = await fetch(SB_URL.replace(/\/+$/, '') + '/rest/v1/' + path, {
    method, headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 200);
    throw new Error('DATABASE ERROR ' + res.status + (detail ? ' — ' + detail : ''));
  }
  return method === 'GET' ? res.json() : null;
}

// No-ops in local mode so map.js has a single code path.
async function dbInsert(table, row)     { if (backendOn()) await sbReq(table, { method: 'POST', body: row }); }
async function dbPatch(table, id, data) { if (backendOn()) await sbReq(table + '?id=eq.' + id, { method: 'PATCH', body: data }); }
async function dbDelete(table, id)      { if (backendOn()) await sbReq(table + '?id=eq.' + id, { method: 'DELETE' }); }

// ---------- load / cache ----------
function loadLocalCache() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      state.properties = Array.isArray(parsed.properties) ? parsed.properties : [];
      state.zones = Array.isArray(parsed.zones) ? parsed.zones : [];
    }
  } catch (e) { console.error('Failed to load cached data', e); }
}

function saveLocalCache() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); return true; }
  catch (e) {
    // In shared mode the cache is best-effort — the database has the data.
    if (!backendOn()) {
      alert('SAVE FAILED — STORAGE IS FULL.\nPhotos take the most space: remove some property photos, or export your data as a backup first.');
      return false;
    }
    return true;
  }
}

async function loadState() {
  loadLocalCache();                             // instant paint from cache
  if (!backendOn()) { setSyncBadge('LOCAL DATA — NO SERVER', ''); return; }
  if (_session) await fetchEditorStatus();      // pick up approvals/revokes
  try {
    const [props, zones] = await Promise.all([
      sbReq('re_properties?select=*'),
      sbReq('re_zones?select=*')
    ]);
    state.properties = props || [];
    state.zones = zones || [];
    saveLocalCache();
    setSyncBadge('SHARED DB — CONNECTED', 'var(--greentxt)');
  } catch (e) {
    console.error('DB load failed', e);
    setSyncBadge('DB UNREACHABLE — SHOWING LOCAL COPY', 'var(--redtxt)');
  }
}

function setSyncBadge(text, color) {
  const el = document.getElementById('sync-badge');
  if (el) { el.textContent = text; el.style.color = color; }
}

async function manualRefresh() {
  await loadState();
  refreshAll();
}

function uid() { return Date.now() + Math.floor(Math.random() * 1000); }

// ---------- utilities ----------
function v(id) { return document.getElementById(id).value.trim(); }

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function parseMoney(s) {
  const n = Number(String(s).replace(/[^0-9.]/g, ''));
  return isFinite(n) ? Math.round(n) : 0;
}

function fmtMoney(n) {
  n = Number(n) || 0;
  return '$' + n.toLocaleString('en-US');
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d) ? '—' : d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

// ---------- export / import ----------
function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'greyhave-realestate-' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

function importData(input) {
  const file = input.files[0];
  input.value = '';                       // allow re-importing the same file
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async e => {
    let data;
    try { data = JSON.parse(e.target.result); } catch (err) { alert('IMPORT FAILED — NOT A VALID JSON FILE.'); return; }
    if (!data || !Array.isArray(data.properties)) { alert('IMPORT FAILED — FILE IS NOT A REAL ESTATE EXPORT.'); return; }
    const props = data.properties.map(p => Object.assign({ id: uid() }, pick(p, PROP_COLS)));
    const zones = (Array.isArray(data.zones) ? data.zones : []).map(z => Object.assign({ id: uid() }, pick(z, ZONE_COLS)));
    const scope = backendOn()
      ? `This REPLACES the SHARED map for EVERYONE (${state.properties.length} → ${props.length} properties).`
      : `This REPLACES your current data (${state.properties.length} → ${props.length} properties).`;
    if (!confirm(`Import from "${file.name}"?\n${scope}\nTip: use EXPORT first if you want a backup.`)) return;
    try {
      if (backendOn()) {
        await sbReq('re_properties?id=gt.0', { method: 'DELETE' });
        await sbReq('re_zones?id=gt.0', { method: 'DELETE' });
        if (props.length) await sbReq('re_properties', { method: 'POST', body: props });
        if (zones.length) await sbReq('re_zones', { method: 'POST', body: zones });
      }
    } catch (err) { alert('IMPORT FAILED — ' + err.message + '\nRe-check the database, then try again.'); return; }
    state.properties = props;
    state.zones = zones;
    saveLocalCache();
    refreshAll();
  };
  reader.readAsText(file);
}

// Shrink an uploaded photo so the database and cache stay small.
// Max 800px on the long edge, JPEG quality .72 → ~60-120 KB each.
function compressImage(file, cb) {
  const img = new Image();
  img.onload = () => {
    const MAX = 800;
    let w = img.naturalWidth, h = img.naturalHeight;
    if (Math.max(w, h) > MAX) {
      const k = MAX / Math.max(w, h);
      w = Math.round(w * k); h = Math.round(h * k);
    }
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    cv.getContext('2d').drawImage(img, 0, 0, w, h);
    cb(cv.toDataURL('image/jpeg', 0.72));
    URL.revokeObjectURL(img.src);
  };
  img.onerror = () => { alert('COULD NOT READ THAT IMAGE FILE.'); URL.revokeObjectURL(img.src); };
  img.src = URL.createObjectURL(file);
}
