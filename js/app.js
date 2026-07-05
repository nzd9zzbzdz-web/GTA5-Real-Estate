// ============================================================
// app.js — Page navigation, stats and the listings table.
// ============================================================

let _sortKey = 'updated_at';
let _sortDir = -1;

function showPage(p) {
  document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(el => el.classList.remove('active'));
  document.getElementById('page-' + p).classList.add('active');
  document.getElementById('tab-' + p).classList.add('active');
  history.replaceState(null, '', '#' + p);   // tab survives a refresh
  if (p === 'map') renderMap();
  if (p === 'listings') renderListings();
}

// Repaint everything after any data change (save/delete/import).
function refreshAll() {
  updateAuthUI();
  renderStats();
  renderListings();
  if (_map) paintAll();
  else if (document.getElementById('page-map').classList.contains('active')) renderMap();
}

// ---------- auth UI ----------
// Shows/hides everything only editors may use. The database also
// rejects writes from non-editors, so this is convenience, not
// the actual security boundary.
function updateAuthUI() {
  if (!backendOn()) return;   // local mode: no accounts, keep classic behavior
  const on = isEditor();
  document.getElementById('auth-btn').style.display = 'inline-block';
  document.getElementById('auth-btn').textContent = _session ? 'LOG OUT' : 'EDITOR LOGIN';
  document.getElementById('admin-btn').style.display = isAdmin() ? 'inline-block' : 'none';
  const badge = document.getElementById('auth-user');
  if (_session && _session.approved) {
    badge.style.display = 'inline';
    badge.style.color = 'var(--greentxt)';
    badge.textContent = (_session.admin ? 'ADMIN: ' : 'EDITOR: ') + _session.username.toUpperCase();
  } else if (_session) {
    badge.style.display = 'inline';
    badge.style.color = '#e8c15a';
    badge.textContent = _session.username.toUpperCase() + ' — PENDING APPROVAL';
  } else {
    badge.style.display = 'none';
  }
  document.getElementById('map-place-btn').style.display = on ? '' : 'none';
  document.getElementById('map-draw-btn').style.display = on ? '' : 'none';
  document.getElementById('import-btn').style.display = on ? '' : 'none';
}

function authButton() {
  if (_session) {
    logout();
    updateAuthUI();
    refreshAll();     // strip EDIT buttons from table + popups
    return;
  }
  document.getElementById('lg-err').style.display = 'none';
  document.getElementById('lg-password').value = '';
  openModal('modal-login');
  document.getElementById('lg-username').focus();
}

async function doLogin() {
  const err = document.getElementById('lg-err');
  const btn = document.getElementById('lg-submit');
  err.style.display = 'none';
  btn.disabled = true; btn.textContent = 'LOGGING IN...';
  try {
    await login(v('lg-username'), document.getElementById('lg-password').value);
  } catch (e) {
    err.textContent = 'LOGIN FAILED — ' + e.message.toUpperCase();
    err.style.display = 'block';
    return;
  } finally {
    btn.disabled = false; btn.textContent = 'LOG IN';
  }
  closeModal('modal-login');
  updateAuthUI();
  refreshAll();
}

function openSignupModal() {
  closeModal('modal-login');
  document.getElementById('sg-err').style.display = 'none';
  document.getElementById('sg-username').value = '';
  document.getElementById('sg-password').value = '';
  document.getElementById('sg-password2').value = '';
  openModal('modal-signup');
  document.getElementById('sg-username').focus();
}

async function doSignup() {
  const err = document.getElementById('sg-err');
  const btn = document.getElementById('sg-submit');
  const showErr = m => { err.textContent = m; err.style.display = 'block'; };
  err.style.display = 'none';
  const username = v('sg-username');
  const pw = document.getElementById('sg-password').value;
  if (!validUsername(username)) { showErr('USERNAME MUST BE 3–20 CHARACTERS: LETTERS, NUMBERS, _ OR -'); return; }
  if (pw.length < 6) { showErr('PASSWORD MUST BE AT LEAST 6 CHARACTERS'); return; }
  if (pw !== document.getElementById('sg-password2').value) { showErr('PASSWORDS DO NOT MATCH'); return; }
  btn.disabled = true; btn.textContent = 'SENDING...';
  try {
    await signupEditor(username, pw);
  } catch (e) {
    showErr('REQUEST FAILED — ' + e.message.toUpperCase());
    return;
  } finally {
    btn.disabled = false; btn.textContent = 'SEND REQUEST';
  }
  closeModal('modal-signup');
  updateAuthUI();
  alert('REQUEST SENT!\nAn admin has to approve your account before you can edit.\nYou are logged in and can browse the map meanwhile.');
}

// ---------- admin panel ----------
function openAdminPanel() {
  openModal('modal-admin');
  renderAdminPanel();
}

async function renderAdminPanel() {
  const wrap = document.getElementById('admin-list');
  wrap.innerHTML = '<div class="empty">LOADING...</div>';
  let rows;
  try {
    const snap = await _db.collection('re_editors').orderBy('requested_at').get();
    rows = snap.docs.map(d => Object.assign({ user_id: d.id }, d.data()));
  } catch (e) {
    wrap.innerHTML = `<div class="empty" style="color:var(--redtxt);">FAILED TO LOAD — ${esc(e.message)}</div>`;
    return;
  }
  if (!rows.length) { wrap.innerHTML = '<div class="empty">NO EDITOR ACCOUNTS YET</div>'; return; }
  wrap.innerHTML = rows.map(r => {
    const me = r.user_id === _session.user_id;
    const status = r.approved
      ? `<span class="tag" style="color:var(--greentxt);border-color:var(--greentxt);">${r.admin ? 'ADMIN' : 'EDITOR'}</span>`
      : '<span class="tag" style="color:#e8c15a;border-color:#e8c15a;">PENDING</span>';
    const actions = me
      ? '<span style="color:var(--text3);font-size:10px;">(YOU)</span>'
      : r.approved
        ? `<button class="btn btn-sm btn-danger" onclick="adminSetApproved('${r.user_id}', false)">REVOKE</button>`
        : `<button class="btn btn-sm btn-success" onclick="adminSetApproved('${r.user_id}', true)">APPROVE</button>
           <button class="btn btn-sm btn-danger" onclick="adminRemove('${r.user_id}')">REJECT</button>`;
    return `<div style="display:flex;align-items:center;gap:8px;padding:7px 0;border-bottom:1px solid var(--border2);">
      <b style="flex:1;">${esc(r.username.toUpperCase())}</b>${status}${actions}
    </div>`;
  }).join('');
}

async function adminSetApproved(userId, approved) {
  try { await _db.collection('re_editors').doc(userId).update({ approved }); }
  catch (e) { alert('FAILED — ' + e.message); }
  renderAdminPanel();
}

async function adminRemove(userId) {
  if (!confirm('REJECT AND REMOVE THIS REQUEST?')) return;
  try { await _db.collection('re_editors').doc(userId).delete(); }
  catch (e) { alert('FAILED — ' + e.message); }
  renderAdminPanel();
}

// ---------- stats ----------
function renderStats() {
  const props = state.properties;
  const forSale = props.filter(p => p.status === 'For Sale');
  const forRent = props.filter(p => p.status === 'For Rent');
  const marketValue = forSale.reduce((s, p) => s + (Number(p.price) || 0), 0);
  document.getElementById('stats-row').innerHTML = `
    <div class="stat-card" onclick="showPage('map')"><div class="stat-num">${props.length}</div><div class="stat-lbl">PROPERTIES ON MAP</div></div>
    <div class="stat-card" onclick="filterListings('For Sale')"><div class="stat-num" style="color:#2ecc71;">${forSale.length}</div><div class="stat-lbl">FOR SALE</div></div>
    <div class="stat-card" onclick="filterListings('For Rent')"><div class="stat-num" style="color:#f1c40f;">${forRent.length}</div><div class="stat-lbl">FOR RENT</div></div>
    <div class="stat-card"><div class="stat-num" style="font-size:20px;line-height:1.7;">${fmtMoney(marketValue)}</div><div class="stat-lbl">ON THE MARKET</div></div>`;
}

function filterListings(status) {
  showPage('listings');
  document.getElementById('list-search-input').value = status;
  renderListings();
}

// ---------- listings table ----------
function sortListings(key) {
  if (_sortKey === key) _sortDir = -_sortDir;
  else { _sortKey = key; _sortDir = key === 'name' || key === 'type' || key === 'status' ? 1 : -1; }
  renderListings();
}

function renderListings() {
  renderStats();
  const q = v('list-search-input').toLowerCase();
  let rows = state.properties.filter(p =>
    !q || [p.name, p.owner, p.type, p.status, p.description].some(f => String(f || '').toLowerCase().includes(q)));
  rows.sort((a, b) => {
    let x = a[_sortKey], y = b[_sortKey];
    if (_sortKey === 'price') { x = Number(x) || 0; y = Number(y) || 0; }
    else { x = String(x || '').toLowerCase(); y = String(y || '').toLowerCase(); }
    return (x < y ? -1 : x > y ? 1 : 0) * _sortDir;
  });
  const arrow = k => _sortKey === k ? (_sortDir === 1 ? ' ▲' : ' ▼') : '';
  const body = rows.map(p => `<tr>
      <td class="name-col">${esc(pinGlyphOf(p))} ${esc(p.name)}</td>
      <td>${esc(p.type)}</td>
      <td><span class="status-badge" style="border-color:${statusColor(p.status)};color:${statusColor(p.status)};">${esc(String(p.status || 'UNKNOWN').toUpperCase())}</span></td>
      <td style="color:var(--cyan);">${fmtMoney(p.price)}</td>
      <td>${esc(p.owner || '—')}</td>
      <td style="font-size:11px;">${fmtDate(p.updated_at)}</td>
      <td style="white-space:nowrap;text-align:right;">
        <button class="btn btn-sm" onclick="goToProperty(${p.id})">&#128205; MAP</button>
        ${isEditor() ? `<button class="btn btn-sm btn-warn" onclick="openPropertyModal(${p.id})">EDIT</button>` : ''}
      </td>
    </tr>`).join('');
  document.getElementById('listings-table-wrap').innerHTML = rows.length
    ? `<div class="card" style="padding:0;"><table>
        <thead><tr>
          <th style="cursor:pointer;" onclick="sortListings('name')">PROPERTY${arrow('name')}</th>
          <th style="cursor:pointer;" onclick="sortListings('type')">TYPE${arrow('type')}</th>
          <th style="cursor:pointer;" onclick="sortListings('status')">STATUS${arrow('status')}</th>
          <th style="cursor:pointer;" onclick="sortListings('price')">PRICE${arrow('price')}</th>
          <th>OWNER</th>
          <th style="cursor:pointer;" onclick="sortListings('updated_at')">UPDATED${arrow('updated_at')}</th>
          <th></th>
        </tr></thead><tbody>${body}</tbody></table></div>`
    : `<div class="empty">${state.properties.length ? 'NO LISTINGS MATCH THAT SEARCH' : (isEditor() ? 'NO PROPERTIES YET — GO TO THE MAP AND HIT + ADD PROPERTY' : 'NO PROPERTIES LISTED YET')}</div>`;
}

// ---------- UI polish ----------
// Material-style ripple radiating from the click point.
document.addEventListener('pointerdown', e => {
  const el = e.target.closest('.btn, .nav-tab, .stat-card, .modal-close');
  if (!el || el.disabled) return;
  const rect = el.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height) * 2.2;
  const r = document.createElement('span');
  r.className = 'ripple';
  r.style.width = r.style.height = size + 'px';
  r.style.left = (e.clientX - rect.left - size / 2) + 'px';
  r.style.top = (e.clientY - rect.top - size / 2) + 'px';
  el.appendChild(r);
  setTimeout(() => r.remove(), 650);
});

// ---------- boot ----------
// Close modals when clicking the dark overlay background.
document.querySelectorAll('.modal-overlay').forEach(el => {
  el.addEventListener('click', e => { if (e.target === el) el.classList.remove('open'); });
});

(async () => {
  initFirebase();
  await initAuthState();      // restore editor login (if any)
  updateAuthUI();
  await loadState();          // cache paints instantly, then DB (if configured)
  updateAuthUI();             // approval flags may have changed server-side
  renderStats();
  renderListings();
  showPage(location.hash === '#listings' ? 'listings' : 'map');
})();

// Shared mode: pull other players' changes every 60s — but never
// while the user is placing, drawing, or has a modal/popup open.
setInterval(async () => {
  if (!backendOn() || document.hidden || _placeMode || _drawMode) return;
  if (document.querySelector('.modal-overlay.open') || document.querySelector('.leaflet-popup')) return;
  await loadState();
  refreshAll();
}, 60000);
