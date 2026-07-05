// ============================================================
// map.js — Interactive real estate map (Leaflet, CRS.Simple).
// Drop pins for properties, draw shaded neighborhood zones.
// Pin COLOR = listing status, pin GLYPH = property type.
// ============================================================

const MAP_IMAGE = 'img/gta5-map.jpg';

const STATUSES = [
  { key: 'For Sale',   color: '#2ecc71' },
  { key: 'For Rent',   color: '#f1c40f' },
  { key: 'Sold',       color: '#e74c3c' },
  { key: 'Owned',      color: '#3498db' },
  { key: 'Rented',     color: '#9b59b6' },
  { key: 'Off Market', color: '#7f8c8d' }
];

const TYPES = [
  { key: 'House',     glyph: '\u{1F3E0}' },
  { key: 'Apartment', glyph: '\u{1F3E2}' },
  { key: 'Mansion',   glyph: '\u{1F3F0}' },
  { key: 'Business',  glyph: '\u{1F3EA}' },
  { key: 'Warehouse', glyph: '\u{1F3ED}' },
  { key: 'Garage',    glyph: '\u{1F697}' },
  { key: 'Office',    glyph: '\u{1F4BC}' },
  { key: 'Hotel',     glyph: '\u{1F3E8}' },
  { key: 'Land',      glyph: '\u{1F332}' },
  { key: 'Other',     glyph: '\u{1F4CD}' }
];

function statusColor(s) { const x = STATUSES.find(o => o.key === s); return x ? x.color : '#7f8c8d'; }
function typeGlyph(t)   { const x = TYPES.find(o => o.key === t);    return x ? x.glyph : '\u{1F4CD}'; }

// Auto colors for neighborhood zones.
const ZONE_PALETTE = ['#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#1abc9c', '#3498db', '#9b59b6', '#e84393', '#fd79a8', '#00cec9', '#6c5ce7', '#d35400'];

let _map = null;
let _pinLayer = null;
let _zoneLayer = null;
let _placeMode = false;
let _hiddenStatuses = new Set();
let _hiddenTypes = new Set();
let _searchText = '';
let _imgBounds = null;
let _drawMode = false;
let _drawPts = [];
let _drawPreview = null;
let _drawEditId = null;
let _propMarkers = {};   // property id -> Leaflet marker (for fly-to)
let _zoneShapes = {};    // zone id -> Leaflet polygon
let _photos = [];        // working photo list (data URLs) in the open modal

const MAX_PHOTOS = 6;    // ~100 KB each; Firestore docs cap at 1 MB

// A property's photo list — old rows have a single `photo` field.
function propPhotos(p) {
  if (Array.isArray(p.photos) && p.photos.length) return p.photos.filter(Boolean);
  return p.photo ? [p.photo] : [];
}

// ---------- init ----------
// Bounds come from the image's natural size, so a swapped-in
// map image still lines up with existing pins.
function renderMap() {
  const canvas = document.getElementById('map-canvas');
  if (typeof L === 'undefined') {
    canvas.innerHTML = '<div class="empty" style="padding:2rem;">MAP LIBRARY FAILED TO LOAD — CHECK INTERNET CONNECTION</div>';
    return;
  }
  if (_map) { _map.invalidateSize(); paintAll(); return; }
  const img = new Image();
  img.onload = () => {
    const bounds = [[0, 0], [img.naturalHeight, img.naturalWidth]];
    _imgBounds = bounds;
    _map = L.map('map-canvas', { crs: L.CRS.Simple, minZoom: -3, maxZoom: 2, attributionControl: false });
    L.imageOverlay(MAP_IMAGE, bounds).addTo(_map);
    _map.setMaxBounds(bounds);
    _map.fitBounds(bounds);
    _zoneLayer = L.layerGroup().addTo(_map);   // under the pins
    _pinLayer = L.layerGroup().addTo(_map);
    _drawPreview = L.layerGroup().addTo(_map);
    _map.on('click', onMapClick);
    paintAll();
  };
  img.onerror = () => { canvas.innerHTML = '<div class="empty" style="padding:2rem;">MAP IMAGE NOT FOUND AT ' + MAP_IMAGE + '</div>'; };
  img.src = MAP_IMAGE;
}

function paintAll() {
  paintZones();
  paintPins();
  renderFilterChips();
  renderLegend();
  updateMapHint();
}

// ---------- pins ----------
function visibleProps() {
  const q = _searchText.toLowerCase();
  return state.properties.filter(p =>
    isFinite(p.x) && isFinite(p.y) &&        // a bad row must not kill the map
    !_hiddenStatuses.has(p.status) &&
    !_hiddenTypes.has(p.type) &&
    (!q || [p.name, p.owner, p.description, p.type, p.status].some(f => String(f || '').toLowerCase().includes(q))));
}

// Per-property overrides beat the automatic scheme.
function pinColorOf(p) { return p.pin_color || statusColor(p.status); }
function pinGlyphOf(p) { return p.pin_icon || typeGlyph(p.type); }

function pinIcon(p) {
  return L.divIcon({
    className: 'map-pin',
    html: `<div style="width:26px;height:26px;border-radius:50%;background:${pinColorOf(p)};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;font-size:13px;line-height:1;">${esc(pinGlyphOf(p))}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -14]
  });
}

function paintPins() {
  if (!_pinLayer) return;
  _pinLayer.clearLayers();
  _propMarkers = {};
  visibleProps().forEach(p => {
    const mk = L.marker([p.y, p.x], { icon: pinIcon(p) }).addTo(_pinLayer).bindPopup(propPopupHtml(p));
    _propMarkers[p.id] = mk;
  });
}

function propPopupHtml(p) {
  const c = statusColor(p.status);
  const photos = propPhotos(p);
  return `<div style="min-width:190px;max-width:240px;">
    <div style="color:${c};font-size:10px;letter-spacing:2px;margin-bottom:3px;">&#9632; ${esc(String(p.status || 'UNKNOWN').toUpperCase())}</div>
    <div style="font-weight:bold;font-size:14px;margin-bottom:2px;">${esc(pinGlyphOf(p))} ${esc(p.name)}</div>
    <div style="font-size:11px;color:#666;margin-bottom:4px;">${esc(String(p.type || 'OTHER').toUpperCase())}${p.garage ? ' &middot; GARAGE: ' + esc(p.garage) : ''}</div>
    <div style="font-size:16px;font-weight:bold;color:#8a6d1a;margin-bottom:4px;">${fmtMoney(p.price)}${p.status === 'For Rent' || p.status === 'Rented' ? ' <span style="font-size:10px;font-weight:normal;">/ week</span>' : ''}</div>
    ${p.owner ? `<div style="font-size:11px;margin-bottom:4px;">OWNER: <b>${esc(p.owner)}</b></div>` : ''}
    ${p.coords ? `<div style="font-size:11px;margin-bottom:4px;display:flex;align-items:center;gap:6px;">
      <span style="color:#666;">COORDS:</span> <b>${esc(p.coords)}</b>
      <button class="btn btn-sm" style="padding:2px 8px;font-size:9px;" onclick="copyCoords(${p.id}, this)">COPY</button>
    </div>` : ''}
    ${p.description ? `<div style="font-size:11px;line-height:1.5;margin-bottom:4px;">${esc(p.description)}</div>` : ''}
    ${photos.length ? `<div style="position:relative;margin-bottom:4px;">
      <img src="${photos[0]}" style="width:100%;max-height:120px;object-fit:cover;cursor:zoom-in;border:1px solid #ccc;display:block;" onclick="zoomPhoto(${p.id})">
      ${photos.length > 1 ? `<span style="position:absolute;right:4px;bottom:4px;background:rgba(0,0,0,.7);color:#fff;font-size:10px;padding:2px 6px;letter-spacing:1px;pointer-events:none;">${photos.length} PHOTOS</span>` : ''}
    </div>` : ''}
    ${isEditor() ? `<div style="margin-top:6px;"><button class="btn btn-sm btn-warn" onclick="openPropertyModal(${p.id})">EDIT</button></div>` : ''}
  </div>`;
}

// ---------- photo zoom gallery ----------
let _zoomList = [];
let _zoomIdx = 0;

function zoomPhoto(id) {
  const p = state.properties.find(x => x.id === id);
  _zoomList = p ? propPhotos(p) : [];
  if (!_zoomList.length) return;
  _zoomIdx = 0;
  renderZoom();
  document.getElementById('zoom-overlay').classList.add('open');
}

function renderZoom() {
  document.getElementById('zoom-img').src = _zoomList[_zoomIdx];
  const multi = _zoomList.length > 1;
  document.getElementById('zoom-prev').style.display = multi ? 'block' : 'none';
  document.getElementById('zoom-next').style.display = multi ? 'block' : 'none';
  document.getElementById('zoom-counter').textContent = multi ? (_zoomIdx + 1) + ' / ' + _zoomList.length : '';
}

// Clicking the image also advances; with a single photo it closes.
function zoomNav(d) {
  if (_zoomList.length < 2) { closeZoom(); return; }
  _zoomIdx = (_zoomIdx + d + _zoomList.length) % _zoomList.length;
  renderZoom();
}

function closeZoom() { document.getElementById('zoom-overlay').classList.remove('open'); }

document.addEventListener('keydown', e => {
  if (!document.getElementById('zoom-overlay').classList.contains('open')) return;
  if (e.key === 'ArrowRight') zoomNav(1);
  else if (e.key === 'ArrowLeft') zoomNav(-1);
  else if (e.key === 'Escape') closeZoom();
});

// ---------- neighborhood zones ----------
function paintZones() {
  if (!_zoneLayer) return;
  _zoneLayer.clearLayers();
  _zoneShapes = {};
  state.zones
    .filter(z => Array.isArray(z.coordinates) && z.coordinates.length >= 3 &&
      z.coordinates.every(c => Array.isArray(c) && isFinite(c[0]) && isFinite(c[1])))
    .forEach(z => {
      // A zone with a linked listing wears the listing's status color.
      const linked = zoneListing(z.id);
      const col = linked ? statusColor(linked.status) : (z.color || ZONE_PALETTE[0]);
      const baseFill = linked ? 0.25 : 0.15;
      // Click-through while placing/drawing so the click reaches the map.
      const poly = L.polygon(z.coordinates, { color: col, weight: 2, fillColor: col, fillOpacity: baseFill, interactive: !(_placeMode || _drawMode) });
      poly.on('mouseover', () => poly.setStyle({ fillOpacity: baseFill + 0.15 }));
      poly.on('mouseout', () => poly.setStyle({ fillOpacity: baseFill }));
      poly.addTo(_zoneLayer).bindPopup(zonePopupHtml(z));
      if (z.name) poly.bindTooltip(z.name.toUpperCase(), { permanent: true, direction: 'center', className: 'territory-label' });
      _zoneShapes[z.id] = poly;
    });
}

// The property listed on a zone, if any (link lives on the property).
function zoneListing(zoneId) {
  return state.properties.find(p => p.zone_id === zoneId);
}

function zonePopupHtml(z) {
  const linked = zoneListing(z.id);
  const col = linked ? statusColor(linked.status) : (z.color || ZONE_PALETTE[0]);
  return `<div style="min-width:170px;">
    <div style="color:${col};font-size:10px;letter-spacing:2px;margin-bottom:3px;">&#9632; ${linked ? 'LISTED ZONE' : 'NEIGHBORHOOD'}</div>
    <div style="font-weight:bold;font-size:13px;">${esc(z.name)}</div>
    ${z.note ? `<div style="font-size:11px;margin-top:3px;line-height:1.5;">${esc(z.note)}</div>` : ''}
    ${linked ? `<div style="font-size:11px;margin-top:5px;">
      <span style="color:${statusColor(linked.status)};">&#9632; ${esc(String(linked.status || 'UNKNOWN').toUpperCase())}</span>
      &middot; <b>${fmtMoney(linked.price)}</b>${linked.owner ? ' &middot; ' + esc(linked.owner) : ''}
    </div>
    <div style="margin-top:8px;"><button class="btn btn-sm" onclick="goToProperty(${linked.id})">VIEW LISTING</button></div>` : ''}
    ${isEditor() ? `<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;">
      ${!linked ? `<button class="btn btn-sm btn-success" onclick="listZoneAsProperty(${z.id})">LIST AS PROPERTY</button>` : ''}
      <button class="btn btn-sm btn-warn" onclick="editZoneInfo(${z.id})">EDIT</button>
      <button class="btn btn-sm" onclick="redrawZone(${z.id})">REDRAW</button>
      <button class="btn btn-sm btn-danger" onclick="deleteZone(${z.id})">DELETE</button>
    </div>` : ''}
  </div>`;
}

// "LIST AS PROPERTY" on a zone: open the property form at the zone's
// center, pre-filled from the zone and linked to it via zone_id.
function listZoneAsProperty(zoneId) {
  const z = state.zones.find(x => x.id === zoneId); if (!z) return;
  const pts = Array.isArray(z.coordinates) ? z.coordinates : [];
  if (pts.length < 3) return;
  const cy = pts.reduce((s, c) => s + c[0], 0) / pts.length;
  const cx = pts.reduce((s, c) => s + c[1], 0) / pts.length;
  openPropertyModal(null, cx, cy, zoneId);
  document.getElementById('pr-name').value = z.name || '';
  document.getElementById('pr-type').value = 'Land';
}

// ---------- filter chips + legend ----------
function renderFilterChips() {
  const sBar = document.getElementById('status-filters');
  sBar.innerHTML = STATUSES.map(s => {
    const off = _hiddenStatuses.has(s.key);
    return `<span onclick="toggleStatusFilter('${s.key}')" class="tag" style="cursor:pointer;border-color:${s.color};color:${off ? 'var(--text3)' : s.color};opacity:${off ? .45 : 1};">&#9632; ${esc(s.key.toUpperCase())}</span>`;
  }).join('');
  const tBar = document.getElementById('type-filters');
  const usedTypes = [...new Set(state.properties.map(p => p.type).filter(Boolean))];
  tBar.innerHTML = usedTypes.map(t => {
    const off = _hiddenTypes.has(t);
    return `<span onclick="toggleTypeFilter('${esc(t)}')" class="tag" style="cursor:pointer;opacity:${off ? .45 : 1};color:${off ? 'var(--text3)' : 'var(--text)'};">${typeGlyph(t)} ${esc(t.toUpperCase())}</span>`;
  }).join('');
}

function toggleStatusFilter(s) {
  if (_hiddenStatuses.has(s)) _hiddenStatuses.delete(s); else _hiddenStatuses.add(s);
  paintAll();
}

function toggleTypeFilter(t) {
  if (_hiddenTypes.has(t)) _hiddenTypes.delete(t); else _hiddenTypes.add(t);
  paintAll();
}

function renderLegend() {
  const el = document.getElementById('map-legend'); if (!el) return;
  const used = new Set(state.properties.map(p => p.status));
  el.innerHTML = STATUSES.filter(s => used.has(s.key)).map(s =>
    `<span class="legend-item"><span class="legend-dot" style="background:${s.color};"></span>${esc(s.key)}</span>`).join('')
    + (state.zones.length ? '<span class="legend-item"><span class="legend-swatch"></span>NEIGHBORHOOD</span>' : '');
}

// ---------- search ----------
function mapSearchInput() {
  _searchText = v('map-search-input');
  document.getElementById('map-search-clear').style.display = _searchText ? 'inline-block' : 'none';
  paintPins();
  renderLegend();
  const shown = visibleProps();
  if (_searchText && shown.length && _map) {
    _map.fitBounds(shown.map(p => [p.y, p.x]), { padding: [60, 60], maxZoom: 0 });
  }
}

function clearMapSearch() {
  document.getElementById('map-search-input').value = '';
  mapSearchInput();
  if (_map && _imgBounds) _map.fitBounds(_imgBounds);
}

// Jump from the listings table to a pin on the map.
function goToProperty(id) {
  showPage('map');
  const open = () => {
    const p = state.properties.find(x => x.id === id);
    if (!p || !_map || !isFinite(p.x) || !isFinite(p.y)) return;
    _map.setView([p.y, p.x], Math.max(_map.getZoom(), 0));
    const mk = _propMarkers[id];
    if (mk) mk.openPopup();
  };
  // renderMap() may need a tick to build the map on first visit.
  if (_map) open(); else setTimeout(open, 350);
}

// ---------- placement ----------
function toggleAddProperty() {
  if (!isEditor()) return;
  _placeMode = !_placeMode;
  const btn = document.getElementById('map-place-btn');
  if (_placeMode) {
    if (_drawMode) endDraw();
    btn.textContent = 'CANCEL PLACEMENT';
    if (_map) _map.getContainer().style.cursor = 'crosshair';
  } else {
    btn.textContent = '+ ADD PROPERTY';
    if (_map) _map.getContainer().style.cursor = '';
  }
  paintZones();          // zones become click-through while placing
  updateMapHint();
}

function onMapClick(e) {
  if (_drawMode) { _drawPts.push([e.latlng.lat, e.latlng.lng]); renderDrawPreview(); return; }
  if (!_placeMode) return;
  toggleAddProperty();
  openPropertyModal(null, e.latlng.lng, e.latlng.lat);
}

function updateMapHint() {
  const hint = document.getElementById('map-hint');
  if (_placeMode) hint.textContent = 'CLICK THE MAP WHERE THE PROPERTY IS';
  else if (_drawMode) hint.textContent = 'CLICK TO ADD CORNERS — THEN FINISH (MIN 3)';
  else if (!state.properties.length) hint.textContent = isEditor() ? 'NO PROPERTIES YET — HIT + ADD PROPERTY TO DROP YOUR FIRST PIN' : 'NO PROPERTIES ON THE MAP YET';
  else hint.textContent = '';
}

// ---------- zone drawing ----------
function toggleDrawMode() {
  if (!isEditor()) return;
  if (_drawMode) { endDraw(); return; }
  if (_placeMode) toggleAddProperty();     // can't place + draw at once
  _drawMode = true; _drawPts = [];
  document.getElementById('map-draw-btn').textContent = 'CANCEL DRAW';
  document.getElementById('map-draw-actions').style.display = 'inline-flex';
  if (_map) _map.getContainer().style.cursor = 'crosshair';
  paintZones();
  updateMapHint();
  renderDrawPreview();
}

function renderDrawPreview() {
  if (!_drawPreview) return;
  _drawPreview.clearLayers();
  if (_drawPts.length >= 2) {
    L.polygon(_drawPts, { color: '#e8c15a', weight: 2, dashArray: '5', fillColor: '#e8c15a', fillOpacity: 0.08 }).addTo(_drawPreview);
  }
  _drawPts.forEach(p => L.circleMarker(p, { radius: 4, color: '#fff', weight: 1, fillColor: '#e8c15a', fillOpacity: 1 }).addTo(_drawPreview));
}

function finishDraw() {
  if (_drawPts.length < 3) { alert('A zone needs at least 3 points.'); return; }
  const pts = _drawPts.slice();
  const editId = _drawEditId;
  endDraw();
  openZoneModal(editId, pts);
}

function endDraw() {
  _drawMode = false; _drawPts = []; _drawEditId = null;
  if (_drawPreview) _drawPreview.clearLayers();
  document.getElementById('map-draw-btn').textContent = '+ DRAW ZONE';
  document.getElementById('map-draw-actions').style.display = 'none';
  if (_map) _map.getContainer().style.cursor = '';
  paintZones();
  updateMapHint();
}

// ---------- zone modal ----------
function openZoneModal(id, coords) {
  if (_map) _map.closePopup();
  document.getElementById('zn-err').style.display = 'none';
  document.getElementById('zn-edit-id').value = id || '';
  document.getElementById('zn-coords').value = JSON.stringify(coords || []);
  const delBtn = document.getElementById('zn-delete-btn');
  if (id) {
    const z = state.zones.find(x => x.id === id);
    document.getElementById('zn-name').value = z ? z.name : '';
    document.getElementById('zn-note').value = z ? (z.note || '') : '';
    document.getElementById('zn-color').value = z ? (z.color || ZONE_PALETTE[0]) : ZONE_PALETTE[0];
    delBtn.style.display = 'inline-block';
    document.getElementById('zone-modal-title').textContent = 'EDIT ZONE';
  } else {
    document.getElementById('zn-name').value = '';
    document.getElementById('zn-note').value = '';
    document.getElementById('zn-color').value = ZONE_PALETTE[0];
    delBtn.style.display = 'none';
    document.getElementById('zone-modal-title').textContent = 'NEW NEIGHBORHOOD ZONE';
  }
  renderZoneColorPicker();
  openModal('modal-zone');
}

function renderZoneColorPicker() {
  const wrap = document.getElementById('zn-color-picker');
  const cur = document.getElementById('zn-color').value;
  wrap.innerHTML = ZONE_PALETTE.map(c =>
    `<div class="pin-swatch${cur === c ? ' on' : ''}" onclick="selectZoneColor('${c}')"><div class="pin-swatch-dot" style="background:${c};"></div></div>`).join('');
}

function selectZoneColor(c) { document.getElementById('zn-color').value = c; renderZoneColorPicker(); }

async function saveZone() {
  const name = v('zn-name');
  const err = document.getElementById('zn-err');
  if (!name) { err.textContent = 'ZONE NAME IS REQUIRED'; err.style.display = 'block'; return; }
  let coords; try { coords = JSON.parse(document.getElementById('zn-coords').value || '[]'); } catch (e) { coords = []; }
  if (!Array.isArray(coords) || coords.length < 3) { err.textContent = 'ZONE SHAPE IS INCOMPLETE — DRAW IT ON THE MAP'; err.style.display = 'block'; return; }
  const editId = Number(document.getElementById('zn-edit-id').value);
  const data = { name, note: v('zn-note'), color: document.getElementById('zn-color').value, coordinates: coords };
  try {
    if (editId) {
      await dbPatch('re_zones', editId, data);
      const z = state.zones.find(x => x.id === editId);
      if (z) Object.assign(z, data);
    } else {
      const row = Object.assign({ id: uid() }, data);
      await dbInsert('re_zones', row);
      state.zones.push(row);
    }
  } catch (e) { err.textContent = 'SAVE FAILED — ' + e.message; err.style.display = 'block'; return; }
  saveLocalCache();
  closeModal('modal-zone');
  paintAll();
}

function editZoneInfo(id) {
  const z = state.zones.find(x => x.id === id); if (!z) return;
  openZoneModal(id, z.coordinates || []);
}

function redrawZone(id) {
  if (_map) _map.closePopup();
  if (_drawMode) endDraw();
  toggleDrawMode();
  _drawEditId = id;      // set after toggle (endDraw clears it)
}

async function deleteZone(id) {
  if (_map) _map.closePopup();
  const linked = zoneListing(id);
  if (!confirm(linked
    ? 'THIS ZONE IS LISTED AS A PROPERTY.\nThe listing itself stays (as a pin) — only the drawn zone is deleted.\nDELETE THE ZONE?'
    : 'DELETE THIS ZONE?')) return;
  try { await dbDelete('re_zones', id); }
  catch (e) { alert('DELETE FAILED — ' + e.message); return; }
  state.zones = state.zones.filter(z => z.id !== id);
  saveLocalCache();
  paintAll();
}

function deleteZoneFromModal() {
  const id = Number(document.getElementById('zn-edit-id').value);
  closeModal('modal-zone');
  if (id) deleteZone(id);
}

// ---------- coords copy ----------
function copyCoords(id, btn) {
  const p = state.properties.find(x => x.id === id);
  if (!p || !p.coords) return;
  const done = () => { if (btn) { btn.textContent = 'COPIED!'; setTimeout(() => { btn.textContent = 'COPY'; }, 1200); } };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(p.coords).then(done).catch(() => fallbackCopy(p.coords, done));
  } else fallbackCopy(p.coords, done);
}

function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch (e) { }
  document.body.removeChild(ta);
  done();
}

// ---------- pin style pickers ----------
const PIN_ICONS = ['\u{1F3E0}', '\u{1F3E2}', '\u{1F3F0}', '\u{1F3EA}', '\u{1F3ED}', '\u{1F697}', '\u{1F4BC}', '\u{1F3E8}', '\u{1F332}', '⭐', '\u{1F48E}', '\u{1F525}', '\u{1F451}', '⚓'];

function renderPinColorPicker() {
  const wrap = document.getElementById('pr-pin-colors');
  const cur = document.getElementById('pr-pin-color').value;
  wrap.innerHTML =
    `<div class="pin-swatch${!cur ? ' on' : ''}" title="Auto — color follows status" onclick="selectPinColor('')"><div class="pin-swatch-dot" style="background:conic-gradient(#2ecc71 0 25%, #f1c40f 0 50%, #e74c3c 0 75%, #3498db 0);"></div></div>`
    + ZONE_PALETTE.map(c =>
      `<div class="pin-swatch${cur === c ? ' on' : ''}" onclick="selectPinColor('${c}')"><div class="pin-swatch-dot" style="background:${c};"></div></div>`).join('');
}

function selectPinColor(c) {
  document.getElementById('pr-pin-color').value = c;
  renderPinColorPicker();
}

function renderPinIconPicker() {
  document.getElementById('pr-pin-icons').innerHTML =
    `<button type="button" class="btn btn-sm" style="padding:3px 8px;font-size:10px;" onclick="setPinIcon('')">AUTO</button>`
    + PIN_ICONS.map(i =>
      `<button type="button" class="btn btn-sm" style="padding:3px 8px;" onclick="setPinIcon('${i}')">${i}</button>`).join('');
}

function setPinIcon(i) { document.getElementById('pr-pin-icon').value = i; }

// ---------- property modal ----------
function openPropertyModal(id, x, y, zoneId) {
  _photos = [];
  document.getElementById('pr-err').style.display = 'none';
  document.getElementById('pr-photo-file').value = '';
  if (id) {
    const p = state.properties.find(pp => pp.id === id); if (!p) return;
    document.getElementById('property-modal-title').textContent = 'EDIT PROPERTY';
    document.getElementById('pr-save-btn').textContent = 'SAVE CHANGES';
    document.getElementById('pr-delete-btn').style.display = 'inline-block';
    document.getElementById('pr-edit-id').value = id;
    document.getElementById('pr-x').value = p.x;
    document.getElementById('pr-y').value = p.y;
    document.getElementById('pr-zone-id').value = p.zone_id || '';
    document.getElementById('pr-name').value = p.name || '';
    document.getElementById('pr-type').value = p.type || 'House';
    document.getElementById('pr-status').value = p.status || 'For Sale';
    document.getElementById('pr-price').value = p.price ? p.price.toLocaleString('en-US') : '';
    document.getElementById('pr-owner').value = p.owner || '';
    document.getElementById('pr-garage').value = p.garage || '';
    document.getElementById('pr-coords').value = p.coords || '';
    document.getElementById('pr-desc').value = p.description || '';
    document.getElementById('pr-pin-color').value = p.pin_color || '';
    document.getElementById('pr-pin-icon').value = p.pin_icon || '';
    _photos = propPhotos(p).slice();
  } else {
    document.getElementById('property-modal-title').textContent = 'NEW PROPERTY';
    document.getElementById('pr-save-btn').textContent = 'CREATE LISTING';
    document.getElementById('pr-delete-btn').style.display = 'none';
    document.getElementById('pr-edit-id').value = '';
    document.getElementById('pr-x').value = x;
    document.getElementById('pr-y').value = y;
    document.getElementById('pr-zone-id').value = zoneId || '';
    document.getElementById('pr-name').value = '';
    document.getElementById('pr-type').value = 'House';
    document.getElementById('pr-status').value = 'For Sale';
    document.getElementById('pr-price').value = '';
    document.getElementById('pr-owner').value = '';
    document.getElementById('pr-garage').value = '';
    document.getElementById('pr-coords').value = '';
    document.getElementById('pr-desc').value = '';
    document.getElementById('pr-pin-color').value = '';
    document.getElementById('pr-pin-icon').value = '';
  }
  if (_map) _map.closePopup();
  renderPinColorPicker();
  renderPinIconPicker();
  renderPhotoPreview();
  openModal('modal-property');
}

function onPhotoPicked(input) {
  const files = Array.from(input.files || []);
  input.value = '';                       // allow re-picking the same file
  if (!files.length) return;
  const room = MAX_PHOTOS - _photos.length;
  if (room <= 0) { alert('MAX ' + MAX_PHOTOS + ' PHOTOS PER PROPERTY — REMOVE ONE FIRST.'); return; }
  if (files.length > room) alert('ONLY ADDING THE FIRST ' + room + ' — MAX ' + MAX_PHOTOS + ' PHOTOS PER PROPERTY.');
  files.slice(0, room).forEach(f =>
    compressImage(f, dataUrl => { _photos.push(dataUrl); renderPhotoPreview(); }));
}

function removePhotoAt(i) {
  _photos.splice(i, 1);
  renderPhotoPreview();
}

function makeCover(i) {
  if (i <= 0) return;
  _photos.unshift(_photos.splice(i, 1)[0]);
  renderPhotoPreview();
}

function renderPhotoPreview() {
  const wrap = document.getElementById('pr-photo-preview');
  if (!_photos.length) {
    wrap.innerHTML = '<span style="color:var(--text3);font-size:11px;">NO PHOTOS</span>';
    return;
  }
  wrap.innerHTML = _photos.map((ph, i) => `
    <div class="photo-thumb${i === 0 ? ' cover' : ''}" title="${i === 0 ? 'Cover photo' : 'Click to make this the cover'}" onclick="makeCover(${i})">
      <img src="${ph}" alt="">
      ${i === 0 ? '<span class="thumb-tag">COVER</span>' : ''}
      <button type="button" class="thumb-x" title="Remove" onclick="event.stopPropagation();removePhotoAt(${i})">&#10005;</button>
    </div>`).join('')
    + `<span style="color:var(--text3);font-size:10px;">${_photos.length}/${MAX_PHOTOS}</span>`;
}

async function saveProperty() {
  const name = v('pr-name');
  const err = document.getElementById('pr-err');
  if (!name) { err.textContent = 'PROPERTY NAME IS REQUIRED'; err.style.display = 'block'; return; }
  const editId = Number(document.getElementById('pr-edit-id').value);
  const data = {
    name,
    type: document.getElementById('pr-type').value,
    status: document.getElementById('pr-status').value,
    price: parseMoney(document.getElementById('pr-price').value),
    owner: v('pr-owner'),
    garage: v('pr-garage'),
    coords: v('pr-coords'),
    description: v('pr-desc'),
    pin_color: document.getElementById('pr-pin-color').value || null,
    pin_icon: v('pr-pin-icon') || null,
    photos: _photos.slice(),
    photo: null,                 // legacy single-photo field, superseded
    x: Number(document.getElementById('pr-x').value),
    y: Number(document.getElementById('pr-y').value),
    zone_id: Number(document.getElementById('pr-zone-id').value) || null,
    updated_at: new Date().toISOString()
  };
  // Firestore documents cap at 1 MB — leave headroom for the text fields.
  const photoBytes = data.photos.reduce((s, ph) => s + ph.length, 0);
  if (photoBytes > 900000) {
    err.textContent = 'PHOTOS TOO LARGE FOR ONE LISTING — REMOVE ONE OR TWO';
    err.style.display = 'block';
    return;
  }
  try {
    if (editId) {
      await dbPatch('re_properties', editId, data);
      const p = state.properties.find(pp => pp.id === editId);
      if (p) Object.assign(p, data);
    } else {
      const row = Object.assign({ id: uid(), created_at: new Date().toISOString() }, data);
      await dbInsert('re_properties', row);
      state.properties.push(row);
    }
  } catch (e) { err.textContent = 'SAVE FAILED — ' + e.message; err.style.display = 'block'; return; }
  if (!saveLocalCache()) return;   // local mode + storage full — keep modal open
  closeModal('modal-property');
  refreshAll();
}

async function deletePropertyFromModal() {
  const id = Number(document.getElementById('pr-edit-id').value); if (!id) return;
  if (!confirm('DELETE THIS PROPERTY?')) return;
  try { await dbDelete('re_properties', id); }
  catch (e) { alert('DELETE FAILED — ' + e.message); return; }
  state.properties = state.properties.filter(p => p.id !== id);
  saveLocalCache();
  closeModal('modal-property');
  refreshAll();
}
