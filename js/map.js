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
let _photoData = null;   // working photo (data URL) in the open modal

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

function pinIcon(p) {
  const c = statusColor(p.status);
  return L.divIcon({
    className: 'map-pin',
    html: `<div style="width:26px;height:26px;border-radius:50%;background:${c};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;font-size:13px;line-height:1;">${typeGlyph(p.type)}</div>`,
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
  return `<div style="min-width:190px;max-width:240px;">
    <div style="color:${c};font-size:10px;letter-spacing:2px;margin-bottom:3px;">&#9632; ${esc(String(p.status || 'UNKNOWN').toUpperCase())}</div>
    <div style="font-weight:bold;font-size:14px;margin-bottom:2px;">${typeGlyph(p.type)} ${esc(p.name)}</div>
    <div style="font-size:11px;color:#666;margin-bottom:4px;">${esc(String(p.type || 'OTHER').toUpperCase())}${p.garage ? ' &middot; GARAGE: ' + esc(p.garage) : ''}</div>
    <div style="font-size:16px;font-weight:bold;color:#8a6d1a;margin-bottom:4px;">${fmtMoney(p.price)}${p.status === 'For Rent' || p.status === 'Rented' ? ' <span style="font-size:10px;font-weight:normal;">/ week</span>' : ''}</div>
    ${p.owner ? `<div style="font-size:11px;margin-bottom:4px;">OWNER: <b>${esc(p.owner)}</b></div>` : ''}
    ${p.description ? `<div style="font-size:11px;line-height:1.5;margin-bottom:4px;">${esc(p.description)}</div>` : ''}
    ${p.photo ? `<img src="${p.photo}" style="width:100%;max-height:120px;object-fit:cover;cursor:zoom-in;border:1px solid #ccc;margin-bottom:4px;" onclick="zoomPhoto(${p.id})">` : ''}
    <div style="margin-top:6px;"><button class="btn btn-sm btn-warn" onclick="openPropertyModal(${p.id})">EDIT</button></div>
  </div>`;
}

function zoomPhoto(id) {
  const p = state.properties.find(x => x.id === id);
  if (!p || !p.photo) return;
  document.getElementById('zoom-img').src = p.photo;
  document.getElementById('zoom-overlay').classList.add('open');
}

// ---------- neighborhood zones ----------
function paintZones() {
  if (!_zoneLayer) return;
  _zoneLayer.clearLayers();
  _zoneShapes = {};
  state.zones
    .filter(z => Array.isArray(z.coordinates) && z.coordinates.length >= 3 &&
      z.coordinates.every(c => Array.isArray(c) && isFinite(c[0]) && isFinite(c[1])))
    .forEach(z => {
      const col = z.color || ZONE_PALETTE[0];
      // Click-through while placing/drawing so the click reaches the map.
      const poly = L.polygon(z.coordinates, { color: col, weight: 2, fillColor: col, fillOpacity: 0.15, interactive: !(_placeMode || _drawMode) });
      poly.on('mouseover', () => poly.setStyle({ fillOpacity: 0.3 }));
      poly.on('mouseout', () => poly.setStyle({ fillOpacity: 0.15 }));
      poly.addTo(_zoneLayer).bindPopup(zonePopupHtml(z));
      if (z.name) poly.bindTooltip(z.name.toUpperCase(), { permanent: true, direction: 'center', className: 'territory-label' });
      _zoneShapes[z.id] = poly;
    });
}

function zonePopupHtml(z) {
  const col = z.color || ZONE_PALETTE[0];
  return `<div style="min-width:160px;">
    <div style="color:${col};font-size:10px;letter-spacing:2px;margin-bottom:3px;">&#9632; NEIGHBORHOOD</div>
    <div style="font-weight:bold;font-size:13px;">${esc(z.name)}</div>
    ${z.note ? `<div style="font-size:11px;margin-top:3px;line-height:1.5;">${esc(z.note)}</div>` : ''}
    <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;">
      <button class="btn btn-sm btn-warn" onclick="editZoneInfo(${z.id})">EDIT</button>
      <button class="btn btn-sm" onclick="redrawZone(${z.id})">REDRAW</button>
      <button class="btn btn-sm btn-danger" onclick="deleteZone(${z.id})">DELETE</button>
    </div>
  </div>`;
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
  else if (!state.properties.length) hint.textContent = 'NO PROPERTIES YET — HIT + ADD PROPERTY TO DROP YOUR FIRST PIN';
  else hint.textContent = '';
}

// ---------- zone drawing ----------
function toggleDrawMode() {
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
  if (!confirm('DELETE THIS ZONE?')) return;
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

// ---------- property modal ----------
function openPropertyModal(id, x, y) {
  _photoData = null;
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
    document.getElementById('pr-name').value = p.name || '';
    document.getElementById('pr-type').value = p.type || 'House';
    document.getElementById('pr-status').value = p.status || 'For Sale';
    document.getElementById('pr-price').value = p.price ? p.price.toLocaleString('en-US') : '';
    document.getElementById('pr-owner').value = p.owner || '';
    document.getElementById('pr-garage').value = p.garage || '';
    document.getElementById('pr-desc').value = p.description || '';
    _photoData = p.photo || null;
  } else {
    document.getElementById('property-modal-title').textContent = 'NEW PROPERTY';
    document.getElementById('pr-save-btn').textContent = 'CREATE LISTING';
    document.getElementById('pr-delete-btn').style.display = 'none';
    document.getElementById('pr-edit-id').value = '';
    document.getElementById('pr-x').value = x;
    document.getElementById('pr-y').value = y;
    document.getElementById('pr-name').value = '';
    document.getElementById('pr-type').value = 'House';
    document.getElementById('pr-status').value = 'For Sale';
    document.getElementById('pr-price').value = '';
    document.getElementById('pr-owner').value = '';
    document.getElementById('pr-garage').value = '';
    document.getElementById('pr-desc').value = '';
  }
  if (_map) _map.closePopup();
  renderPhotoPreview();
  openModal('modal-property');
}

function onPhotoPicked(input) {
  const file = input.files[0]; if (!file) return;
  compressImage(file, dataUrl => { _photoData = dataUrl; renderPhotoPreview(); });
}

function removePhoto() {
  _photoData = null;
  document.getElementById('pr-photo-file').value = '';
  renderPhotoPreview();
}

function renderPhotoPreview() {
  const wrap = document.getElementById('pr-photo-preview');
  wrap.innerHTML = _photoData
    ? `<img src="${_photoData}" style="width:140px;height:90px;object-fit:cover;border:1px solid var(--border2);">
       <button class="btn btn-sm btn-danger" type="button" onclick="removePhoto()">REMOVE PHOTO</button>`
    : '<span style="color:var(--text3);font-size:11px;">NO PHOTO</span>';
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
    description: v('pr-desc'),
    photo: _photoData,
    x: Number(document.getElementById('pr-x').value),
    y: Number(document.getElementById('pr-y').value),
    updated_at: new Date().toISOString()
  };
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
