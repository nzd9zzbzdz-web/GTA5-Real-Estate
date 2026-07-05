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

// ---------- Supabase REST (PostgREST) ----------
async function sbReq(path, opts = {}) {
  const method = opts.method || 'GET';
  // New-style keys (sb_publishable_...) go in apikey only; the old
  // JWT-style anon keys also need the Authorization header.
  const headers = { apikey: SB_ANON_KEY };
  if (!SB_ANON_KEY.startsWith('sb_')) headers.Authorization = 'Bearer ' + SB_ANON_KEY;
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
