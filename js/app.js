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
  renderStats();
  renderListings();
  if (_map) paintAll();
  else if (document.getElementById('page-map').classList.contains('active')) renderMap();
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
      <td class="name-col">${typeGlyph(p.type)} ${esc(p.name)}</td>
      <td>${esc(p.type)}</td>
      <td><span class="status-badge" style="border-color:${statusColor(p.status)};color:${statusColor(p.status)};">${esc(String(p.status || 'UNKNOWN').toUpperCase())}</span></td>
      <td style="color:var(--cyan);">${fmtMoney(p.price)}</td>
      <td>${esc(p.owner || '—')}</td>
      <td style="font-size:11px;">${fmtDate(p.updated_at)}</td>
      <td style="white-space:nowrap;text-align:right;">
        <button class="btn btn-sm" onclick="goToProperty(${p.id})">&#128205; MAP</button>
        <button class="btn btn-sm btn-warn" onclick="openPropertyModal(${p.id})">EDIT</button>
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
    : `<div class="empty">${state.properties.length ? 'NO LISTINGS MATCH THAT SEARCH' : 'NO PROPERTIES YET — GO TO THE MAP AND HIT + ADD PROPERTY'}</div>`;
}

// ---------- boot ----------
// Close modals when clicking the dark overlay background.
document.querySelectorAll('.modal-overlay').forEach(el => {
  el.addEventListener('click', e => { if (e.target === el) el.classList.remove('open'); });
});

(async () => {
  await loadState();          // cache paints instantly, then DB (if configured)
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
