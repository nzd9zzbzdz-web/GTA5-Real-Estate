// ============================================================
// store.js — Data layer with two modes, picked automatically
// from js/config.js:
//
//   SHARED — FIREBASE_CONFIG is set: reads/writes the Firestore
//            collections re_properties / re_zones, so every
//            player sees the same map. Editor accounts live in
//            Firebase Auth + the re_editors collection.
//   LOCAL  — config left null: this browser's localStorage only.
//
// In shared mode localStorage doubles as an offline cache, and
// EXPORT/IMPORT still work as backup/restore.
// ============================================================

const LS_KEY = 'greyhave_realestate_v1';

let state = { properties: [], zones: [] };

let _db = null;       // Firestore handle (null = local mode)
let _auth = null;
let _user = null;     // Firebase auth user (or null)
let _session = null;  // { user_id, username, approved, admin } for the UI

function backendOn() { return !!_db; }

function initFirebase() {
  if (typeof FIREBASE_CONFIG === 'undefined' || !FIREBASE_CONFIG) return;
  if (typeof firebase === 'undefined') return;   // CDN failed — stay local
  firebase.initializeApp(FIREBASE_CONFIG);
  _auth = firebase.auth();
  _db = firebase.firestore();
}

// Columns that belong in the database — imports are trimmed to these
// so a hand-edited JSON with extra keys doesn't pollute the docs.
const PROP_COLS = ['id', 'name', 'type', 'status', 'price', 'owner', 'garage', 'coords', 'description', 'photo', 'photos', 'pin_color', 'pin_icon', 'x', 'y', 'zone_id', 'created_at', 'updated_at'];
const ZONE_COLS = ['id', 'name', 'note', 'color', 'coordinates'];
function pick(o, cols) { const r = {}; cols.forEach(k => { if (o[k] !== undefined) r[k] = o[k]; }); return r; }

// ---------- auth (editor accounts) ----------
// Editors sign up in the app with a USERNAME + password — no email.
// Firebase auth requires an email format internally, so the username
// becomes username@editors.greyhaven.local behind the scenes; nothing
// is ever sent anywhere. New accounts start PENDING (view-only) until
// an admin approves them in the ADMIN panel (re_editors collection).
const AUTH_DOMAIN = 'editors.greyhaven.local';

function authEmail(username) { return username.toLowerCase() + '@' + AUTH_DOMAIN; }
function validUsername(u) { return /^[a-zA-Z0-9_-]{3,20}$/.test(u); }

// Local mode has no accounts — everyone edits their own browser data.
function isEditor() { return !backendOn() || !!(_session && _session.approved); }
function isAdmin()  { return backendOn() && !!(_session && _session.approved && _session.admin); }

// Firebase restores logins by itself (its own localStorage entry);
// this resolves once the initial auth state is known so boot can wait.
function initAuthState() {
  if (!backendOn()) return Promise.resolve();
  return new Promise(resolve => {
    const unsub = _auth.onAuthStateChanged(async u => {
      unsub();
      _user = u;
      await fetchEditorStatus();
      resolve();
    });
  });
}

function friendlyAuthError(e) {
  const code = (e && e.code) || '';
  if (/user-not-found|wrong-password|invalid-credential|invalid-login/.test(code)) return new Error('WRONG USERNAME OR PASSWORD');
  if (/email-already-in-use/.test(code)) return new Error('THAT USERNAME IS TAKEN');
  if (/weak-password/.test(code)) return new Error('PASSWORD TOO WEAK — USE AT LEAST 6 CHARACTERS');
  if (/too-many-requests/.test(code)) return new Error('TOO MANY ATTEMPTS — WAIT A MINUTE AND TRY AGAIN');
  if (/network-request-failed/.test(code)) return new Error('NETWORK ERROR — CHECK YOUR CONNECTION');
  return new Error(String((e && e.message) || 'AUTH ERROR').replace(/^Firebase:\s*/i, '').replace(/\s*\(auth.*\)\.?$/, ''));
}

async function login(username, password) {
  try {
    const cred = await _auth.signInWithEmailAndPassword(authEmail(username), password);
    _user = cred.user;
  } catch (e) { throw friendlyAuthError(e); }
  await fetchEditorStatus();
}

async function signupEditor(username, password) {
  try {
    const cred = await _auth.createUserWithEmailAndPassword(authEmail(username), password);
    _user = cred.user;
  } catch (e) { throw friendlyAuthError(e); }
  // File the access request — starts unapproved; an admin flips it.
  await _db.collection('re_editors').doc(_user.uid).set({
    username: username.toLowerCase(),
    approved: false,
    admin: false,
    requested_at: firebase.firestore.FieldValue.serverTimestamp()
  });
  await fetchEditorStatus();
}

function logout() {
  _user = null; _session = null;
  if (_auth) _auth.signOut().catch(() => {});
}

// Re-reads approved/admin flags so an approval takes effect on the
// next refresh without the editor logging out and back in.
async function fetchEditorStatus() {
  if (!_user) { _session = null; return; }
  const fallback = (_user.email || '').split('@')[0];
  try {
    const doc = await _db.collection('re_editors').doc(_user.uid).get();
    const d = doc.exists ? doc.data() : {};
    _session = {
      user_id: _user.uid,
      username: d.username || fallback,
      approved: !!d.approved,
      admin: !!d.admin
    };
  } catch (e) {
    // offline — keep last known status if we had one
    if (!_session) _session = { user_id: _user.uid, username: fallback, approved: false, admin: false };
  }
}

// ---------- Firestore reads/writes ----------
// Firestore can't store nested arrays, so zone polygon coordinates
// ([[y,x], ...]) travel as a JSON string and are parsed on load.
function encodeRow(coll, row) {
  if (coll === 're_zones' && Array.isArray(row.coordinates)) {
    return Object.assign({}, row, { coordinates: JSON.stringify(row.coordinates) });
  }
  return row;
}

function decodeRow(coll, d) {
  if (coll === 're_zones' && typeof d.coordinates === 'string') {
    try { return Object.assign({}, d, { coordinates: JSON.parse(d.coordinates) }); } catch (e) { }
  }
  return d;
}

// No-ops in local mode so map.js has a single code path.
async function dbInsert(coll, row)     { if (backendOn()) await _db.collection(coll).doc(String(row.id)).set(encodeRow(coll, row)); }
async function dbPatch(coll, id, data) { if (backendOn()) await _db.collection(coll).doc(String(id)).update(encodeRow(coll, data)); }
async function dbDelete(coll, id)      { if (backendOn()) await _db.collection(coll).doc(String(id)).delete(); }

// Firestore batches cap at 500 ops — chunk bulk work.
async function batchWrite(ops) {
  for (let i = 0; i < ops.length; i += 400) {
    const b = _db.batch();
    ops.slice(i, i + 400).forEach(fn => fn(b));
    await b.commit();
  }
}

async function clearCollection(coll) {
  const snap = await _db.collection(coll).get();
  await batchWrite(snap.docs.map(d => b => b.delete(d.ref)));
}

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
  if (_user) await fetchEditorStatus();         // pick up approvals/revokes
  await startRealtimeSync();
}

// ---------- live sync ----------
// One onSnapshot listener per collection, attached once: Firestore
// pushes every remote change the moment it happens — no polling, and
// only changed documents count as reads after the initial load.
// Boot waits for the first snapshot, with a timeout so an offline
// start still paints from the local cache instead of hanging.
let _unsubs = [];
let _live = false;
let _pendingPaint = false;

function startRealtimeSync() {
  if (_unsubs.length) return Promise.resolve();   // already listening
  const listen = (coll, key) => new Promise(resolve => {
    let initial = true;
    _unsubs.push(_db.collection(coll).onSnapshot(snap => {
      state[key] = snap.docs.map(d => decodeRow(coll, d.data()));
      saveLocalCache();
      _live = true;
      setSyncBadge('SHARED DB — LIVE', 'var(--greentxt)');
      if (initial) { initial = false; resolve(); }
      else safeRepaint();
    }, e => {
      console.error('Live sync failed', e);
      setSyncBadge('DB UNREACHABLE — SHOWING LOCAL COPY', 'var(--redtxt)');
      if (initial) { initial = false; resolve(); }
    }));
  });
  return Promise.race([
    Promise.all([listen('re_properties', 'properties'), listen('re_zones', 'zones')]),
    new Promise(res => setTimeout(res, 6000))     // offline boot: continue on cache
  ]).then(() => {
    if (!_live) setSyncBadge('CONNECTING — SHOWING LOCAL COPY', 'var(--ambertxt)');
  });
}

// Repaint a pushed change — but never under the user's feet. While a
// modal, map popup, placement or drawing is active the repaint is held
// (state itself is already fresh) and flushed when the modal closes.
function safeRepaint() {
  const busy =
    (typeof _placeMode !== 'undefined' && (_placeMode || _drawMode)) ||
    document.querySelector('.modal-overlay.open') ||
    document.querySelector('.leaflet-popup');
  if (busy) { _pendingPaint = true; return; }
  _pendingPaint = false;
  if (typeof refreshAll === 'function') refreshAll();
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
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  if (_pendingPaint) safeRepaint();   // apply live updates held during the modal
}

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
        await clearCollection('re_properties');
        await clearCollection('re_zones');
        await batchWrite(props.map(p => b => b.set(_db.collection('re_properties').doc(String(p.id)), encodeRow('re_properties', p))));
        await batchWrite(zones.map(z => b => b.set(_db.collection('re_zones').doc(String(z.id)), encodeRow('re_zones', z))));
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
