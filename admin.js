/* ============================================================
   SKYLA — Admin Panel Logic
   ============================================================ */

const BOOKING_FEE = 0.05;
const CHILD_DISCOUNT = 0.5;

// ── AUTH ──────────────────────────────────────────────────────
// When the cloud is configured, the admin uses real Supabase Auth
// (email + password). Without it, falls back to the legacy local password.
const SESSION_KEY = '_skyla_auth';
const useCloudAuth = () => (typeof SkylaData !== 'undefined' && SkylaData.cloudEnabled && SkylaData.cloudEnabled());

// Returns true if there is a valid admin session
async function checkAuth() {
  if (useCloudAuth()) {
    const session = await SkylaData.getSession();
    return !!session;
  }
  return sessionStorage.getItem(SESSION_KEY) === '1';
}

// Returns true on success; throws/returns false on bad credentials
async function authenticate(email, pwd) {
  if (useCloudAuth()) {
    await SkylaData.signIn(email, pwd);   // throws if wrong
    return true;
  }
  if (pwd === SkylaData.getPassword()) {
    sessionStorage.setItem(SESSION_KEY, '1');
    return true;
  }
  return false;
}

async function logout() {
  if (useCloudAuth()) { try { await SkylaData.signOut(); } catch (e) {} }
  sessionStorage.removeItem(SESSION_KEY);
  document.getElementById('admin-shell').style.display = 'none';
  document.getElementById('gate').style.display = 'flex';
  document.getElementById('gate-input').value = '';
  const emailEl = document.getElementById('gate-email');
  if (emailEl) emailEl.value = '';
  document.getElementById('gate-error').textContent = '';
}

// ── TOAST ─────────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast toast--${type} visible`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('visible'), 3000);
}

// ── CONFIRM DIALOG ────────────────────────────────────────────
function confirm(title, msg) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-box">
        <h4>${title}</h4>
        <p>${msg}</p>
        <div class="confirm-box__btns">
          <button class="admin-btn admin-btn--ghost" id="confirm-no">Cancel</button>
          <button class="admin-btn admin-btn--danger" id="confirm-yes">Confirm</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector('#confirm-yes').onclick = () => { overlay.remove(); resolve(true); };
    overlay.querySelector('#confirm-no').onclick  = () => { overlay.remove(); resolve(false); };
  });
}

// ── FORMAT HELPERS ────────────────────────────────────────────
function fmt$(n)   { return '$' + (Number(n) || 0).toFixed(2); }
function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
}
function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// ── NAV ───────────────────────────────────────────────────────
function goSection(name) {
  // Always release the camera when switching sections
  if (qrScanning) stopCamera();

  document.querySelectorAll('.admin-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.sidebar__link').forEach(l => l.classList.remove('active'));
  document.getElementById(`section-${name}`)?.classList.add('active');
  document.querySelector(`.sidebar__link[data-section="${name}"]`)?.classList.add('active');

  if (name === 'dashboard') renderDashboard();
  if (name === 'bookings')  renderBookings();
  if (name === 'checkin')   renderCheckin();
  if (name === 'pricing')   renderPricing();
  if (name === 'cafe')      renderCafeMenu();
  if (name === 'hours')     renderHours();
  if (name === 'settings')  renderSettings();
  if (name === 'members')   renderMembers();
}

// ── DASHBOARD ─────────────────────────────────────────────────
function renderDashboard() {
  const bookings = SkylaData.getBookings();
  const today = new Date().toDateString();

  const todayCount   = bookings.filter(b => new Date(b.visitDate || b.createdAt).toDateString() === today).length;
  const totalRevenue = bookings.reduce((s, b) => s + (b.total || 0), 0);
  const avgTicket    = bookings.length ? totalRevenue / bookings.length : 0;

  const cards = [
    { label: 'Total Bookings', value: bookings.length, sub: 'all time', cls: '' },
    { label: 'Total Revenue',  value: fmt$(totalRevenue), sub: 'before fees', cls: 'gold' },
    { label: "Today's Visits", value: todayCount, sub: new Date().toLocaleDateString('en-US', { weekday: 'long' }), cls: 'green' },
    { label: 'Avg Ticket',     value: fmt$(avgTicket), sub: 'per booking', cls: '' },
  ];

  document.getElementById('dash-date').textContent =
    new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  document.getElementById('stat-cards').innerHTML = cards.map(c => `
    <div class="stat-card stat-card--${c.cls}">
      <div class="stat-card__label">${c.label}</div>
      <div class="stat-card__value">${c.value}</div>
      <div class="stat-card__sub">${c.sub}</div>
    </div>`).join('');

  // Recent bookings
  const recent = bookings.slice(0, 6);
  document.getElementById('dash-recent').innerHTML = recent.length ? `
    <table class="mini-table">
      <thead><tr><th>Guest</th><th>Package</th><th>Visit</th><th>Total</th></tr></thead>
      <tbody>${recent.map(b => `
        <tr>
          <td>${b.firstName || '—'} ${b.lastName || ''}</td>
          <td>${pkgLabel(b.packageKey)}</td>
          <td>${b.visitDate || '—'}</td>
          <td class="amount">${fmt$(b.total)}</td>
        </tr>`).join('')}
      </tbody>
    </table>` : '<p style="color:var(--gray);font-size:.82rem;padding:8px 0;">No bookings yet.</p>';

  // Package breakdown — counts every package that actually has bookings
  const counts = {};
  bookings.forEach(b => {
    const k = b.packageKey || '—';
    counts[k] = (counts[k] || 0) + 1;
  });
  const total = bookings.length || 1;

  document.getElementById('dash-breakdown').innerHTML = `
    <div class="bar-chart">
      ${Object.entries(counts).map(([key, n]) => `
        <div class="bar-row">
          <div class="bar-row__label">${pkgLabel(key)}<span>${n} (${Math.round(n/total*100)}%)</span></div>
          <div class="bar-track"><div class="bar-fill bar-fill--${key}" style="width:${Math.round(n/total*100)}%"></div></div>
        </div>`).join('')}
    </div>`;
}

function pkgLabel(key) {
  if (!key) return '—';
  try {
    const pkgs = SkylaData.getPackages();
    if (pkgs && pkgs[key] && pkgs[key].name) return pkgs[key].name;
  } catch (e) { /* fall through */ }
  const map = { general: 'General', drink: 'Deck + Drink', coffee: 'Deck + Coffee', matcha: 'Deck + Matcha' };
  return map[key] || key;
}

// ── BOOKINGS ──────────────────────────────────────────────────
let allBookings = [];

function renderBookings() {
  allBookings = SkylaData.getBookings();
  applyBookingFilters();
}

function applyBookingFilters() {
  const q      = document.getElementById('search-input').value.toLowerCase();
  const date   = document.getElementById('date-filter').value;
  const pkg    = document.getElementById('pkg-filter').value;
  const status = document.getElementById('status-filter').value;

  let filtered = allBookings.filter(b => {
    if (q && !`${b.firstName} ${b.lastName} ${b.email}`.toLowerCase().includes(q)) return false;
    if (date && b.visitDate !== date) return false;
    if (pkg  && b.packageKey !== pkg) return false;
    if (status && b.status !== status) return false;
    return true;
  });

  const tbody = document.getElementById('bookings-tbody');
  const empty = document.getElementById('bookings-empty');
  const meta  = document.getElementById('bookings-meta');

  if (!filtered.length) {
    tbody.innerHTML = '';
    empty.classList.add('visible');
    meta.textContent = '';
    return;
  }

  empty.classList.remove('visible');
  meta.textContent = `Showing ${filtered.length} of ${allBookings.length} booking${allBookings.length !== 1 ? 's' : ''}`;

  tbody.innerHTML = filtered.map(b => `
    <tr id="brow-${b.id}">
      <td>${fmtDate(b.createdAt)}<br/><span style="color:var(--gray);font-size:.72rem">${fmtTime(b.createdAt)}</span></td>
      <td>
        ${b.firstName || '—'} ${b.lastName || ''}
        <br/><span style="color:var(--gray);font-size:.72rem">${b.email || ''}</span>
        ${b.bookingRef ? `<br/><span style="font-family:monospace;font-size:.68rem;color:var(--gold);opacity:0.7">${b.bookingRef}</span>` : ''}
      </td>
      <td>${b.visitDate || '—'}</td>
      <td>${b.time || '—'}</td>
      <td>${pkgLabel(b.packageKey)}</td>
      <td>${b.adults || 0}A ${b.children > 0 ? `+ ${b.children}C` : ''}</td>
      <td>${voucherBadge(b)}</td>
      <td style="color:var(--gold);font-weight:600">${fmt$(b.total)}</td>
      <td><span class="status-badge status-badge--${b.status || 'confirmed'}">${b.status || 'confirmed'}</span></td>
      <td>
        <div class="row-actions">
          <button class="row-btn row-btn--check-in${b.status === 'checked-in' ? ' active' : ''}" onclick="toggleCheckIn('${b.id}')">${b.status === 'checked-in' ? '✓ In' : 'Check In'}</button>
          <button class="row-btn row-btn--cancel" onclick="cancelBooking('${b.id}')">Cancel</button>
          <button class="row-btn row-btn--delete" onclick="deleteBooking('${b.id}')">✕</button>
        </div>
      </td>
    </tr>`).join('');
}

function toggleCheckIn(id) {
  const b = SkylaData.getBookings().find(x => x.id === id);
  if (!b) return;
  const newStatus = b.status === 'checked-in' ? 'confirmed' : 'checked-in';
  SkylaData.updateBooking(id, {
    status: newStatus,
    checkedInAt: newStatus === 'checked-in' ? new Date().toISOString() : null,
  });
  allBookings = SkylaData.getBookings();
  applyBookingFilters();
  showToast(newStatus === 'checked-in' ? 'Guest checked in ✓' : 'Check-in reversed');
}

async function cancelBooking(id) {
  if (!await confirm('Cancel booking?', 'This will mark the booking as cancelled.')) return;
  SkylaData.updateBooking(id, { status: 'cancelled' });
  allBookings = SkylaData.getBookings();
  applyBookingFilters();
  showToast('Booking cancelled', 'error');
}

async function deleteBooking(id) {
  if (!await confirm('Delete booking?', 'This permanently removes the booking record.')) return;
  SkylaData.deleteBooking(id);
  allBookings = SkylaData.getBookings();
  applyBookingFilters();
  showToast('Booking deleted');
}

function exportCSV() {
  const bookings = SkylaData.getBookings();
  if (!bookings.length) { showToast('No bookings to export', 'error'); return; }
  const headers = ['Booking Ref','ID','Created','First Name','Last Name','Email','Visit Date','Time','Package','Adults','Children','Addons','Subtotal','Fee','Total','Status'];
  const rows = bookings.map(b => [
    b.bookingRef || '', b.id, b.createdAt, b.firstName, b.lastName, b.email,
    b.visitDate, b.time, pkgLabel(b.packageKey),
    b.adults, b.children,
    JSON.stringify(b.addons || {}),
    b.subtotal, b.fee, b.total, b.status,
  ].map(v => `"${(v ?? '').toString().replace(/"/g, '""')}"`).join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = `skyla-bookings-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  showToast('CSV exported ↓');
}

// ── FRONT DESK CHECK-IN ───────────────────────────────────────
// What each package entitles the guest to at the venue (operational, not pricing).
// perGuest:true → one per head; otherwise a fixed qty per booking.
const PACKAGE_VOUCHERS = {
  general: [],
  drink: [
    { label: 'Coffee or Matcha (your choice)', emoji: '☕', perGuest: true },
  ],
  'date-night': [
    { label: 'Champagne for Two',     emoji: '🥂', qty: 1 },
    { label: 'Charcuterie & Dessert', emoji: '🧀', qty: 1 },
    { label: 'Reserved Window Seats', emoji: '🪑', qty: 1 },
    { label: 'Keepsake Photo',        emoji: '📸', qty: 1 },
  ],
  'champagne-room': [
    { label: 'Champagne Bottle Service', emoji: '🍾', qty: 1 },
    { label: 'Caviar & Small Bites',     emoji: '🐟', qty: 1 },
    { label: 'Personal Host',            emoji: '🛎', qty: 1 },
  ],
  'family-suite': [
    { label: 'Private Suite',      emoji: '🛋', qty: 1 },
    { label: 'Dedicated Waitress', emoji: '🛎', qty: 1 },
    { label: 'Family & Kids Menu', emoji: '🍽', qty: 1 },
  ],
};

// Flatten a booking into redeemable vouchers: package inclusions + purchased add-ons.
function buildVouchers(b) {
  const guests = (b.adults || 0) + (b.children || 0) || 1;
  const list = [];

  (PACKAGE_VOUCHERS[b.packageKey] || []).forEach((v, i) => {
    list.push({
      id:    `pkg-${i}`,
      label: v.label,
      emoji: v.emoji || '🎟',
      qty:   v.perGuest ? guests : (v.qty || 1),
    });
  });

  const addonDefs = {};
  (SkylaData.getAddons() || []).forEach(a => { addonDefs[a.id] = a; });
  Object.entries(b.addons || {}).forEach(([id, qty]) => {
    if (qty > 0) {
      const def = addonDefs[id];
      list.push({
        id:    `addon-${id}`,
        label: def?.name || id,
        emoji: def?.emoji || '🥤',
        qty,
      });
    }
  });

  return list;
}

// Totals across a booking's vouchers: how many redeemed vs how many total
function voucherSummary(b) {
  const list = buildVouchers(b);
  const red  = b.redemptions || {};
  const total    = list.reduce((s, v) => s + v.qty, 0);
  const redeemed = list.reduce((s, v) => s + Math.min(red[v.id] || 0, v.qty), 0);
  return { total, redeemed };
}

// Compact badge for the bookings table
function voucherBadge(b) {
  const { total, redeemed } = voucherSummary(b);
  if (!total) return '<span style="color:var(--gray);font-size:.78rem">—</span>';
  const cls = redeemed === 0 ? 'vbadge--none'
            : redeemed >= total ? 'vbadge--done'
            : 'vbadge--partial';
  return `<span class="vbadge ${cls}">🎟 ${redeemed}/${total}</span>`;
}

function renderVouchers(b) {
  const vouchers = buildVouchers(b);
  if (!vouchers.length) {
    return `<div class="checkin-vouchers">
      <div class="checkin-vouchers__title">Vouchers</div>
      <p class="checkin-vouchers__empty">General admission — no add-on vouchers to redeem.</p>
    </div>`;
  }
  const red = b.redemptions || {};
  const rows = vouchers.map(v => {
    const r    = Math.min(red[v.id] || 0, v.qty);
    const done = r >= v.qty;
    return `<div class="voucher-row${done ? ' voucher-row--done' : ''}">
      <span class="voucher-emoji">${v.emoji}</span>
      <span class="voucher-label">${esc(v.label)}${v.qty > 1 ? ` <em>×${v.qty}</em>` : ''}</span>
      <span class="voucher-count">${r}/${v.qty}</span>
      <span class="voucher-actions">
        ${r > 0 ? `<button class="row-btn voucher-undo" onclick="unredeemVoucher('${b.id}','${v.id}')">−</button>` : ''}
        ${done
          ? `<span class="voucher-done">✓ Redeemed</span>`
          : `<button class="row-btn row-btn--check-in" onclick="redeemVoucher('${b.id}','${v.id}',${v.qty})">Redeem</button>`}
      </span>
    </div>`;
  }).join('');
  return `<div class="checkin-vouchers">
    <div class="checkin-vouchers__title">Vouchers &amp; Inclusions</div>
    ${rows}
  </div>`;
}

function redeemVoucher(bookingId, voucherId, max) {
  const b = SkylaData.getBookings().find(x => x.id === bookingId);
  if (!b) return;
  const red = { ...(b.redemptions || {}) };
  if ((red[voucherId] || 0) >= max) return;
  red[voucherId] = (red[voucherId] || 0) + 1;
  SkylaData.updateBooking(bookingId, { redemptions: red });
  const updated = SkylaData.getBookings().find(x => x.id === bookingId);
  renderCheckinResult(updated, updated?.bookingRef || '');
  showToast('Voucher redeemed ✓');
  focusScanInput();
}

function unredeemVoucher(bookingId, voucherId) {
  const b = SkylaData.getBookings().find(x => x.id === bookingId);
  if (!b) return;
  const red = { ...(b.redemptions || {}) };
  red[voucherId] = Math.max(0, (red[voucherId] || 0) - 1);
  SkylaData.updateBooking(bookingId, { redemptions: red });
  const updated = SkylaData.getBookings().find(x => x.id === bookingId);
  renderCheckinResult(updated, updated?.bookingRef || '');
  showToast('Redemption reversed');
  focusScanInput();
}

async function renderCheckin() {
  document.getElementById('checkin-date').textContent =
    new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  document.getElementById('checkin-result').innerHTML = '';
  renderCheckinStats();
  setTimeout(() => document.getElementById('checkin-input')?.focus(), 60);
  // Pull the latest bookings (e.g. just made on a guest's phone), then refresh stats
  await SkylaData.refreshBookings();
  renderCheckinStats();
}

// Keep the scanner input focused + selected so the next scan overwrites cleanly
function focusScanInput() {
  const i = document.getElementById('checkin-input');
  if (i) { i.focus(); i.select(); }
}

// ── CAMERA QR SCANNER ─────────────────────────────────────────
let qrScanner  = null;
let qrScanning = false;

async function toggleCamera() {
  if (qrScanning) { await stopCamera(); return; }

  if (typeof Html5Qrcode === 'undefined') {
    showToast('Camera scanner library not loaded', 'error');
    return;
  }

  const box = document.getElementById('checkin-camera');
  const btn = document.getElementById('checkin-camera-btn');
  box.style.display = 'block';
  qrScanner = new Html5Qrcode('checkin-camera');

  try {
    await qrScanner.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: 220 },
      (decoded) => {
        const input = document.getElementById('checkin-input');
        if (input) input.value = decoded;
        stopCamera();
        lookupCheckin();
      },
      () => { /* ignore per-frame decode errors */ }
    );
    qrScanning = true;
    if (btn) btn.textContent = '✕ Stop Camera';
  } catch (err) {
    console.error('Camera start failed:', err);
    showToast('Could not access camera — check permissions', 'error');
    box.style.display = 'none';
  }
}

async function stopCamera() {
  if (qrScanner && qrScanning) {
    try { await qrScanner.stop(); } catch (e) { /* ignore */ }
    try { qrScanner.clear(); }    catch (e) { /* ignore */ }
  }
  qrScanning = false;
  qrScanner  = null;
  const box = document.getElementById('checkin-camera');
  if (box) { box.style.display = 'none'; box.innerHTML = ''; }
  const btn = document.getElementById('checkin-camera-btn');
  if (btn) btn.textContent = '📷 Scan with Camera';
}

async function lookupCheckin(e) {
  if (e) e.preventDefault();
  const input = document.getElementById('checkin-input');
  const raw = (input.value || '').trim();
  if (!raw) return;

  // Make sure we're searching the freshest data (guest may have just booked elsewhere)
  await SkylaData.refreshBookings();

  // Scanners may append whitespace/newlines or wrap the code; pull out the ref if present
  const refMatch = raw.match(/SKY\d{4}-[A-Z0-9]{6}/i);
  const ref = (refMatch ? refMatch[0] : raw).toUpperCase();
  const lc  = raw.toLowerCase();
  const bookings = SkylaData.getBookings();

  let b = bookings.find(x => (x.bookingRef || '').toUpperCase() === ref);
  if (!b) b = bookings.find(x => (x.email || '').toLowerCase() === lc);
  if (!b) b = bookings.find(x => `${x.firstName || ''} ${x.lastName || ''}`.trim().toLowerCase() === lc);

  renderCheckinResult(b, raw);
  input.select();
}

function renderCheckinResult(b, query) {
  const el = document.getElementById('checkin-result');

  if (!b) {
    el.innerHTML = `
      <div class="checkin-card checkin-card--bad">
        <div class="checkin-card__icon">✕</div>
        <div class="checkin-card__body">
          <h3>No booking found</h3>
          <p>Nothing matches “<strong>${esc(query)}</strong>”. Double-check the reference or try the guest's name or email.</p>
        </div>
      </div>`;
    return;
  }

  const guests = `${b.adults || 0} Adult${b.adults !== 1 ? 's' : ''}` +
    (b.children > 0 ? ` · ${b.children} Child${b.children !== 1 ? 'ren' : ''}` : '');

  const today      = new Date().toISOString().slice(0, 10);
  const todayVisit = b.visitDate === today;
  const isCancel   = b.status === 'cancelled';
  const isIn       = b.status === 'checked-in';

  let cls = 'ok', icon = '✓', banner = 'Valid — ready to admit';
  if (isCancel)  { cls = 'bad';  icon = '✕'; banner = 'Booking cancelled — do not admit'; }
  else if (isIn) { cls = 'warn'; icon = '!'; banner = `Already checked in${b.checkedInAt ? ` at ${fmtTime(b.checkedInAt)}` : ''}`; }

  el.innerHTML = `
    <div class="checkin-card checkin-card--${cls}">
      <div class="checkin-card__icon">${icon}</div>
      <div class="checkin-card__body">
        <div class="checkin-card__banner">${banner}</div>
        <h3>${esc(b.firstName || '')} ${esc(b.lastName || '')}</h3>
        <div class="checkin-card__ref">${esc(b.bookingRef || '—')}</div>
        <div class="checkin-card__grid">
          <div><span>Package</span>${esc(b.packageName || pkgLabel(b.packageKey))}</div>
          <div><span>Date</span>${esc(b.date || b.visitDate || '—')}${todayVisit ? ' <em class="checkin-today">Today</em>' : ''}</div>
          <div><span>Entry</span>${esc(b.time || '—')}</div>
          <div><span>Guests</span>${guests}</div>
          <div><span>Email</span>${esc(b.email || '—')}</div>
          <div><span>Paid</span>${fmt$(b.total)}</div>
        </div>
        ${!todayVisit && !isCancel ? `<p class="checkin-warnnote">⚠ This booking is for <strong>${esc(b.date || b.visitDate)}</strong>, not today.</p>` : ''}
        ${!isCancel ? renderVouchers(b) : ''}
        <div class="checkin-card__actions">
          ${isCancel ? ''
            : isIn
              ? `<button class="admin-btn admin-btn--ghost" onclick="undoCheckin('${b.id}')">Undo Check-In</button>`
              : `<button class="admin-btn checkin-confirm-btn" onclick="doCheckin('${b.id}')">✓ Check In Guest</button>`}
        </div>
      </div>
    </div>`;
}

function doCheckin(id) {
  SkylaData.updateBooking(id, { status: 'checked-in', checkedInAt: new Date().toISOString() });
  const b = SkylaData.getBookings().find(x => x.id === id);
  showToast(`${b?.firstName || 'Guest'} checked in ✓`);
  renderCheckinResult(b, b?.bookingRef || '');
  renderCheckinStats();
  focusScanInput();
}

function undoCheckin(id) {
  SkylaData.updateBooking(id, { status: 'confirmed', checkedInAt: null });
  const b = SkylaData.getBookings().find(x => x.id === id);
  showToast('Check-in undone');
  renderCheckinResult(b, b?.bookingRef || '');
  renderCheckinStats();
  focusScanInput();
}

function renderCheckinStats() {
  const today    = new Date().toISOString().slice(0, 10);
  const todayStr = new Date().toDateString();
  const bookings = SkylaData.getBookings();

  const expected  = bookings.filter(b => b.visitDate === today && b.status !== 'cancelled');
  const inToday   = bookings.filter(b => b.status === 'checked-in' && b.checkedInAt && new Date(b.checkedInAt).toDateString() === todayStr);
  const remaining = expected.filter(b => b.status !== 'checked-in').length;

  document.getElementById('checkin-stats').innerHTML = `
    <div class="checkin-chip checkin-chip--green"><div class="checkin-chip__num">${inToday.length}</div><div class="checkin-chip__lbl">Checked in today</div></div>
    <div class="checkin-chip"><div class="checkin-chip__num">${expected.length}</div><div class="checkin-chip__lbl">Expected today</div></div>
    <div class="checkin-chip checkin-chip--amber"><div class="checkin-chip__num">${remaining}</div><div class="checkin-chip__lbl">Still to arrive</div></div>`;

  const recent = bookings
    .filter(b => b.checkedInAt)
    .sort((a, b) => new Date(b.checkedInAt) - new Date(a.checkedInAt))
    .slice(0, 8);

  document.getElementById('checkin-recent').innerHTML = recent.length ? `
    <table class="mini-table">
      <thead><tr><th>Time</th><th>Guest</th><th>Ref</th><th>Package</th></tr></thead>
      <tbody>${recent.map(b => `
        <tr>
          <td>${fmtTime(b.checkedInAt)}</td>
          <td>${esc(b.firstName || '')} ${esc(b.lastName || '')}</td>
          <td style="font-family:monospace;color:var(--gold);font-size:.74rem">${esc(b.bookingRef || '—')}</td>
          <td>${esc(pkgLabel(b.packageKey))}</td>
        </tr>`).join('')}
      </tbody>
    </table>` : '<p style="color:var(--gray);font-size:.82rem;padding:10px 0;">No check-ins yet today.</p>';
}

// ── PRICING ───────────────────────────────────────────────────
function renderPricing() {
  const packages = SkylaData.getPackages();
  const container = document.getElementById('pricing-cards');

  container.innerHTML = Object.entries(packages).map(([key, pkg]) => `
    <div class="pricing-card">
      <div class="pricing-card__head">
        <span class="pricing-card__key">${key}</span>
      </div>
      <div class="pricing-card__body">
        <div class="field-group">
          <label>Package Name</label>
          <input type="text" id="pkg-name-${key}" value="${pkg.name}" />
        </div>
        <div class="field-group">
          <label>Price (USD)</label>
          <div class="price-input-wrap">
            <span class="price-prefix">$</span>
            <input type="number" id="pkg-price-${key}" value="${pkg.price}" min="0" step="1" />
          </div>
        </div>
        <div class="field-group">
          <label>Description</label>
          <textarea id="pkg-desc-${key}">${pkg.description}</textarea>
        </div>
      </div>
    </div>`).join('');

  document.getElementById('child-discount').value = 50;
  document.getElementById('booking-fee').value    = 5;
}

function savePricing() {
  const packages = SkylaData.getPackages();
  Object.keys(packages).forEach(key => {
    packages[key].name        = document.getElementById(`pkg-name-${key}`)?.value || packages[key].name;
    packages[key].price       = parseFloat(document.getElementById(`pkg-price-${key}`)?.value) || packages[key].price;
    packages[key].description = document.getElementById(`pkg-desc-${key}`)?.value || packages[key].description;
  });
  SkylaData.savePackages(packages);
  showToast('Pricing saved — live on checkout ✓');
}

// ── CAFÉ MENU ─────────────────────────────────────────────────
let localCafeMenu = null;
let localAddons   = null;

function renderCafeMenu() {
  localCafeMenu = JSON.parse(JSON.stringify(SkylaData.getCafeMenu()));
  localAddons   = JSON.parse(JSON.stringify(SkylaData.getAddons()));
  renderMenuTab('matcha');
  renderMenuTab('coffee');
  renderMenuTab('bites');
  renderAddonsTab();
}

function renderMenuTab(tab) {
  const items   = localCafeMenu[tab] || [];
  const editor  = document.getElementById(`editor-${tab}`);
  const isBites = tab === 'bites';

  editor.innerHTML = items.map((item, i) => `
    <div class="menu-item-row ${isBites ? 'menu-item-row--bites' : ''}" data-tab="${tab}" data-id="${item.id}">
      <span class="menu-item-num">${i + 1}</span>
      ${isBites ? `<input class="emoji-input" type="text" value="${item.emoji || '🍽'}" data-field="emoji" maxlength="2" title="Emoji" />` : ''}
      <input type="text"   value="${esc(item.name)}"  data-field="name"  placeholder="Item name" />
      <textarea            data-field="desc"  placeholder="Description">${esc(item.desc)}</textarea>
      <div class="price-cell"><input type="number" value="${item.price}" data-field="price" min="0" step="0.5" /></div>
      <div class="item-active-wrap">
        <label class="toggle-label" title="Active on menu">
          <input type="checkbox" ${item.active ? 'checked' : ''} data-field="active" />
          <span class="toggle-switch"></span>
        </label>
        <span>Active</span>
      </div>
      <button class="item-delete-btn" title="Delete item" onclick="deleteMenuItem('${tab}','${item.id}')">✕</button>
    </div>`).join('');

  // Live-sync inputs → localCafeMenu
  editor.querySelectorAll('[data-field]').forEach(el => {
    el.addEventListener('input', () => syncMenuItem(tab, el));
    el.addEventListener('change', () => syncMenuItem(tab, el));
  });
}

function syncMenuItem(tab, el) {
  const row   = el.closest('.menu-item-row');
  const id    = row.dataset.id;
  const field = el.dataset.field;
  const items = localCafeMenu[tab];
  const item  = items.find(x => x.id === id);
  if (!item) return;
  if (field === 'price')  item.price  = parseFloat(el.value) || 0;
  else if (field === 'active') item.active = el.checked;
  else item[field] = el.value;
}

function deleteMenuItem(tab, id) {
  localCafeMenu[tab] = (localCafeMenu[tab] || []).filter(x => x.id !== id);
  renderMenuTab(tab);
  showToast('Item removed — save to apply');
}

function addMenuItem(tab) {
  const isBites = tab === 'bites';
  const newItem = isBites
    ? { id: `${tab}-${Date.now()}`, name: '', emoji: '🍽', price: 0, desc: '', active: true }
    : { id: `${tab}-${Date.now()}`, name: '', price: 0, desc: '', tags: '', active: true };
  if (!localCafeMenu[tab]) localCafeMenu[tab] = [];
  localCafeMenu[tab].push(newItem);
  renderMenuTab(tab);
  // Focus the name field of the new row
  const rows = document.querySelectorAll(`#editor-${tab} .menu-item-row`);
  const last = rows[rows.length - 1];
  last?.querySelector('input[data-field="name"]')?.focus();
}

function renderAddonsTab() {
  const editor = document.getElementById('editor-addons');
  editor.innerHTML = localAddons.map((a, i) => `
    <div class="menu-item-row" data-addon-id="${a.id}">
      <span class="menu-item-num">${i + 1}</span>
      <input class="emoji-input" type="text" value="${a.emoji || '☕'}" data-addon-field="emoji" maxlength="2" />
      <input type="text"   value="${esc(a.name)}"  data-addon-field="name"  placeholder="Add-on name" />
      <textarea            data-addon-field="desc"  placeholder="Short description (optional)">${esc(a.desc || '')}</textarea>
      <div class="price-cell"><input type="number" value="${a.price}" data-addon-field="price" min="0" step="0.5" /></div>
      <div class="item-active-wrap">
        <label class="toggle-label">
          <input type="checkbox" ${a.active !== false ? 'checked' : ''} data-addon-field="active" />
          <span class="toggle-switch"></span>
        </label>
        <span>Active</span>
      </div>
      <span></span>
    </div>`).join('');

  editor.querySelectorAll('[data-addon-field]').forEach(el => {
    el.addEventListener('input', () => syncAddon(el));
    el.addEventListener('change', () => syncAddon(el));
  });
}

function syncAddon(el) {
  const row   = el.closest('.menu-item-row');
  const id    = row.dataset.addonId;
  const field = el.dataset.addonField;
  const addon = localAddons.find(a => a.id === id);
  if (!addon) return;
  if (field === 'price')  addon.price  = parseFloat(el.value) || 0;
  else if (field === 'active') addon.active = el.checked;
  else addon[field] = el.value;
}

function saveCafeMenu() {
  SkylaData.saveCafeMenu(localCafeMenu);
  SkylaData.saveAddons(localAddons);
  showToast('Café menu saved ✓');
}

// ── HOURS ─────────────────────────────────────────────────────
function renderHours() {
  const hours = SkylaData.getHours();
  const editor = document.getElementById('hours-editor');
  editor.innerHTML = Object.entries(hours).map(([day, h]) => `
    <div class="hours-row" data-day="${day}">
      <div class="hours-day">${day}</div>
      <div class="field-group">
        <label>Opens</label>
        <input type="time" class="hours-input" data-day="${day}" data-field="open"  value="${h.open}"  ${h.closed ? 'disabled' : ''} />
      </div>
      <div class="field-group">
        <label>Closes</label>
        <input type="time" class="hours-input" data-day="${day}" data-field="close" value="${h.close}" ${h.closed ? 'disabled' : ''} />
      </div>
      <label class="toggle-label">
        <input type="checkbox" ${h.closed ? 'checked' : ''} data-day="${day}" data-field="closed" />
        <span class="toggle-switch"></span>
        Closed
      </label>
    </div>`).join('');

  editor.querySelectorAll('[data-day]').forEach(el => {
    el.addEventListener('change', () => {
      const day   = el.dataset.day;
      const field = el.dataset.field;
      if (field === 'closed') {
        const row = editor.querySelector(`.hours-row[data-day="${day}"]`);
        row.querySelectorAll('.hours-input').forEach(i => i.disabled = el.checked);
      }
    });
  });
}

function saveHours() {
  const hours  = SkylaData.getHours();
  const editor = document.getElementById('hours-editor');
  Object.keys(hours).forEach(day => {
    const openEl   = editor.querySelector(`input[data-day="${day}"][data-field="open"]`);
    const closeEl  = editor.querySelector(`input[data-day="${day}"][data-field="close"]`);
    const closedEl = editor.querySelector(`input[data-day="${day}"][data-field="closed"]`);
    if (openEl)   hours[day].open   = openEl.value;
    if (closeEl)  hours[day].close  = closeEl.value;
    if (closedEl) hours[day].closed = closedEl.checked;
  });
  SkylaData.saveHours(hours);
  showToast('Hours saved ✓');
}

// ── SETTINGS ──────────────────────────────────────────────────
function renderSettings() {
  const ann = SkylaData.getAnnouncement();
  document.getElementById('ann-active').checked = ann.active || false;
  document.getElementById('ann-text').value     = ann.text  || '';
  document.getElementById('ann-type').value     = ann.type  || 'info';
  document.getElementById('pwd-current').value  = '';
  document.getElementById('pwd-new').value      = '';
  document.getElementById('pwd-confirm').value  = '';
  document.getElementById('pwd-error').textContent = '';
}

function saveAnnouncement() {
  SkylaData.saveAnnouncement({
    active: document.getElementById('ann-active').checked,
    text:   document.getElementById('ann-text').value.trim(),
    type:   document.getElementById('ann-type').value,
  });
  showToast('Announcement saved ✓');
}

async function savePassword() {
  const current  = document.getElementById('pwd-current').value;
  const newPwd   = document.getElementById('pwd-new').value;
  const confirm2 = document.getElementById('pwd-confirm').value;
  const errEl    = document.getElementById('pwd-error');

  if (newPwd.length < 6)     { errEl.textContent = 'New password must be at least 6 characters.'; return; }
  if (newPwd !== confirm2)   { errEl.textContent = 'Passwords do not match.'; return; }

  if (useCloudAuth()) {
    // You're already authenticated; Supabase updates the logged-in admin's password
    try {
      await SkylaData.updatePassword(newPwd);
    } catch (e) {
      errEl.textContent = 'Could not update password: ' + (e.message || e);
      return;
    }
  } else {
    if (current !== SkylaData.getPassword()) { errEl.textContent = 'Current password is incorrect.'; return; }
    SkylaData.savePassword(newPwd);
  }

  errEl.textContent = '';
  showToast('Password updated ✓');
  document.getElementById('pwd-current').value = '';
  document.getElementById('pwd-new').value     = '';
  document.getElementById('pwd-confirm').value = '';
}

// ── MEMBERS ───────────────────────────────────────────────────
let allMembers = [];

function getMembers() {
  return SkylaData.getMembers();
}

function tierLabel(tier) {
  return { obsidian: 'Obsidian', gold: 'Gold', black: 'Black Card' }[tier] || tier || '—';
}

function tierGem(tier) {
  return { obsidian: '◆', gold: '◈', black: '⬛' }[tier] || '○';
}

function tierColor(tier) {
  return { obsidian: '#7a8fa6', gold: 'var(--gold)', black: '#aaa' }[tier] || 'var(--gray)';
}

function memStatusColor(status) {
  return { pending: 'amber', approved: 'green', rejected: 'red', waitlisted: 'blue' }[status] || 'gray';
}

async function renderMembers() {
  allMembers = getMembers();
  renderMemberStats();
  applyMemberFilters();
  // Pull anything submitted from other devices, then re-render
  await SkylaData.refreshMembers();
  allMembers = getMembers();
  renderMemberStats();
  applyMemberFilters();
}

function renderMemberStats() {
  const total      = allMembers.length;
  const pending    = allMembers.filter(m => m.status === 'pending').length;
  const approved   = allMembers.filter(m => m.status === 'approved').length;
  const rejected   = allMembers.filter(m => m.status === 'rejected').length;

  document.getElementById('mem-stat-cards').innerHTML = [
    { label: 'Total Applications', value: total,    sub: 'all time',    cls: '' },
    { label: 'Pending Review',     value: pending,  sub: 'awaiting',    cls: 'amber' },
    { label: 'Approved',           value: approved, sub: 'active members', cls: 'green' },
    { label: 'Rejected',           value: rejected, sub: 'declined',    cls: 'red' },
  ].map(c => `
    <div class="stat-card stat-card--${c.cls}">
      <div class="stat-card__label">${c.label}</div>
      <div class="stat-card__value">${c.value}</div>
      <div class="stat-card__sub">${c.sub}</div>
    </div>`).join('');
}

function applyMemberFilters() {
  const q      = (document.getElementById('mem-search-input')?.value || '').toLowerCase();
  const tier   = document.getElementById('mem-tier-filter')?.value  || '';
  const status = document.getElementById('mem-status-filter')?.value || '';

  let filtered = allMembers.filter(m => {
    if (q      && !`${m.firstName} ${m.lastName} ${m.email}`.toLowerCase().includes(q)) return false;
    if (tier   && m.tier !== tier)     return false;
    if (status && m.status !== status) return false;
    return true;
  });

  const tbody = document.getElementById('members-tbody');
  const empty = document.getElementById('members-empty');
  const meta  = document.getElementById('mem-meta');

  if (!filtered.length) {
    tbody.innerHTML = '';
    empty.classList.add('visible');
    meta.textContent = '';
    return;
  }

  empty.classList.remove('visible');
  meta.textContent = `Showing ${filtered.length} of ${allMembers.length} application${allMembers.length !== 1 ? 's' : ''}`;

  tbody.innerHTML = filtered.map(m => `
    <tr id="mrow-${m.id}">
      <td>${fmtDate(m.createdAt)}<br/><span style="color:var(--gray);font-size:.72rem">${fmtTime(m.createdAt)}</span></td>
      <td>
        ${esc(m.firstName || '')} ${esc(m.lastName || '')}
        <br/><span style="color:var(--gray);font-size:.72rem">${esc(m.email || '')}</span>
      </td>
      <td style="font-size:.82rem">${esc(m.phone || '—')}</td>
      <td>
        <span style="color:${tierColor(m.tier)};font-weight:600">${tierGem(m.tier)}</span>
        <span style="font-size:.8rem;margin-left:4px">${tierLabel(m.tier)}</span>
      </td>
      <td style="font-size:.8rem;color:var(--gray-lt)">${esc(m.source || '—')}</td>
      <td><span class="status-badge status-badge--${memStatusColor(m.status)}">${m.status || 'pending'}</span></td>
      <td>
        <div class="row-actions">
          <button class="row-btn row-btn--check-in" onclick="viewMemberBio('${m.id}')">View</button>
          ${m.status !== 'approved'   ? `<button class="row-btn row-btn--check-in" onclick="updateMemberStatus('${m.id}','approved')">Approve</button>` : ''}
          ${m.status !== 'waitlisted' ? `<button class="row-btn"                   onclick="updateMemberStatus('${m.id}','waitlisted')">Waitlist</button>` : ''}
          ${m.status !== 'rejected'   ? `<button class="row-btn row-btn--cancel"   onclick="updateMemberStatus('${m.id}','rejected')">Reject</button>` : ''}
          <button class="row-btn row-btn--delete" onclick="deleteMember('${m.id}')">✕</button>
        </div>
      </td>
    </tr>`).join('');
}

function updateMemberStatus(id, newStatus) {
  SkylaData.updateMember(id, { status: newStatus });
  allMembers = getMembers();
  renderMemberStats();
  applyMemberFilters();
  showToast(`Application ${newStatus} ✓`);
}

async function deleteMember(id) {
  if (!await confirm('Delete application?', 'This permanently removes the member application.')) return;
  SkylaData.deleteMember(id);
  allMembers = getMembers();
  renderMemberStats();
  applyMemberFilters();
  showToast('Application deleted');
}

function viewMemberBio(id) {
  const m = allMembers.find(x => x.id === id);
  if (!m) return;

  document.getElementById('mem-bio-name').textContent = `${m.firstName || ''} ${m.lastName || ''}`.trim() || 'Applicant';

  document.getElementById('mem-bio-meta').innerHTML = `
    <div class="mem-bio-row"><span>Email</span><a href="mailto:${esc(m.email)}">${esc(m.email || '—')}</a></div>
    <div class="mem-bio-row"><span>Phone</span>${esc(m.phone || '—')}</div>
    <div class="mem-bio-row"><span>Tier</span><strong style="color:${tierColor(m.tier)}">${tierGem(m.tier)} ${tierLabel(m.tier)}</strong></div>
    <div class="mem-bio-row"><span>Source</span>${esc(m.source || '—')}</div>
    <div class="mem-bio-row"><span>Applied</span>${fmtDate(m.createdAt)} at ${fmtTime(m.createdAt)}</div>
    <div class="mem-bio-row"><span>Status</span><span class="status-badge status-badge--${memStatusColor(m.status)}">${m.status || 'pending'}</span></div>`;

  document.getElementById('mem-bio-body').innerHTML = m.bio
    ? `<p class="mem-bio-label">About / Why Skyla</p><blockquote class="mem-bio-quote">${esc(m.bio)}</blockquote>`
    : `<p style="color:var(--gray);font-style:italic">No bio provided.</p>`;

  document.getElementById('mem-bio-actions').innerHTML = `
    ${m.status !== 'approved'   ? `<button class="admin-btn" onclick="updateMemberStatus('${m.id}','approved');closeMemberBio()">Approve</button>` : ''}
    ${m.status !== 'waitlisted' ? `<button class="admin-btn admin-btn--ghost" onclick="updateMemberStatus('${m.id}','waitlisted');closeMemberBio()">Waitlist</button>` : ''}
    ${m.status !== 'rejected'   ? `<button class="admin-btn admin-btn--danger" onclick="updateMemberStatus('${m.id}','rejected');closeMemberBio()">Reject</button>` : ''}`;

  document.getElementById('mem-bio-overlay').style.display = 'flex';
}

function closeMemberBio() {
  document.getElementById('mem-bio-overlay').style.display = 'none';
}

function exportMembersCSV() {
  const members = getMembers();
  if (!members.length) { showToast('No applications to export', 'error'); return; }
  const headers = ['ID','Date Applied','First Name','Last Name','Email','Phone','Tier','Source','Status','Bio'];
  const rows = members.map(m => [
    m.id, m.createdAt, m.firstName, m.lastName, m.email,
    m.phone, tierLabel(m.tier), m.source, m.status, m.bio,
  ].map(v => `"${(v ?? '').toString().replace(/"/g, '""')}"`).join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = `skyla-members-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  showToast('Members CSV exported ↓');
}

// ── ESCAPE ────────────────────────────────────────────────────
function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── TAB SWITCH ────────────────────────────────────────────────
function initTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(`tab-${tab}`)?.classList.add('active');
    });
  });
}

// ── BOOT ──────────────────────────────────────────────────────
// Show local data instantly, then pull the latest from the cloud and re-render
function enterAdmin() {
  renderDashboard();
  SkylaData.init().then(() => renderDashboard());
}

document.addEventListener('DOMContentLoaded', () => {

  // Password gate
  const gate  = document.getElementById('gate');
  const shell = document.getElementById('admin-shell');

  // Restore an existing session (async — Supabase)
  checkAuth().then(ok => {
    if (ok) {
      gate.style.display  = 'none';
      shell.style.display = 'flex';
      enterAdmin();
    }
  });

  document.getElementById('gate-form').addEventListener('submit', async e => {
    e.preventDefault();
    const email = document.getElementById('gate-email')?.value.trim() || '';
    const pwd   = document.getElementById('gate-input').value;
    const errEl = document.getElementById('gate-error');
    const btn   = e.target.querySelector('.gate__btn');
    errEl.textContent = '';
    if (btn) { btn.disabled = true; btn.textContent = 'Signing in…'; }
    try {
      const ok = await authenticate(email, pwd);
      if (ok) {
        gate.style.display  = 'none';
        shell.style.display = 'flex';
        enterAdmin();
      } else {
        errEl.textContent = 'Incorrect password. Try again.';
      }
    } catch (err) {
      errEl.textContent = 'Incorrect email or password.';
      console.error('Login failed:', err.message || err);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Unlock Admin →'; }
      document.getElementById('gate-input').value = '';
    }
  });

  document.getElementById('logout-btn').addEventListener('click', logout);

  // Section nav
  document.querySelectorAll('.sidebar__link').forEach(link => {
    link.addEventListener('click', () => goSection(link.dataset.section));
  });

  // Pricing save
  document.getElementById('save-pricing-btn').addEventListener('click', savePricing);

  // Café save
  document.getElementById('save-cafe-btn').addEventListener('click', saveCafeMenu);

  // Add item buttons
  document.querySelectorAll('.add-item-btn').forEach(btn => {
    btn.addEventListener('click', () => addMenuItem(btn.dataset.tab));
  });

  // Hours save
  document.getElementById('save-hours-btn').addEventListener('click', saveHours);

  // Settings
  document.getElementById('save-ann-btn').addEventListener('click', saveAnnouncement);
  document.getElementById('save-pwd-btn').addEventListener('click', savePassword);

  // Booking actions
  document.getElementById('export-csv-btn').addEventListener('click', exportCSV);

  document.getElementById('clear-bookings-btn').addEventListener('click', async () => {
    if (!await confirm('Clear all bookings?', 'This permanently deletes every booking record and cannot be undone.')) return;
    SkylaData.clearBookings();
    renderBookings();
    showToast('All bookings cleared');
  });

  // Filter inputs
  ['search-input','date-filter','pkg-filter','status-filter'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', applyBookingFilters);
    document.getElementById(id)?.addEventListener('change', applyBookingFilters);
  });

  // Danger zone
  document.getElementById('danger-clear-bookings').addEventListener('click', async () => {
    if (!await confirm('Clear all bookings?', 'Permanently deletes every booking record.')) return;
    SkylaData.clearBookings();
    showToast('All bookings cleared');
  });

  document.getElementById('danger-reset-all').addEventListener('click', async () => {
    if (!await confirm('Reset everything?', 'This restores all prices, menu items, and hours to the original defaults. Your bookings will NOT be deleted.')) return;
    const bookings = SkylaData.getBookings();
    SkylaData.resetAll();
    // Restore bookings since user chose not to delete them
    SkylaData.getBookings(); // re-init
    localStorage.setItem('skyla_bookings', JSON.stringify(bookings));
    renderDashboard();
    showToast('Settings reset to defaults ✓');
  });

  // Members filters
  ['mem-search-input','mem-tier-filter','mem-status-filter'].forEach(id => {
    document.getElementById(id)?.addEventListener('input',  applyMemberFilters);
    document.getElementById(id)?.addEventListener('change', applyMemberFilters);
  });

  document.getElementById('mem-clear-filters-btn')?.addEventListener('click', () => {
    document.getElementById('mem-search-input').value   = '';
    document.getElementById('mem-tier-filter').value    = '';
    document.getElementById('mem-status-filter').value  = '';
    applyMemberFilters();
  });

  document.getElementById('export-members-csv-btn')?.addEventListener('click', exportMembersCSV);

  // Front desk check-in (Enter or button both submit the form)
  document.getElementById('checkin-form')?.addEventListener('submit', lookupCheckin);
  document.getElementById('checkin-camera-btn')?.addEventListener('click', toggleCamera);

  // Close bio modal on overlay click
  document.getElementById('mem-bio-overlay')?.addEventListener('click', e => {
    if (e.target === document.getElementById('mem-bio-overlay')) closeMemberBio();
  });

  initTabs();
});
