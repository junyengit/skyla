// ============================================================
// Sky LA — In-person POS (Stripe Terminal)
// Walk-up ticket sales + café orders, charged on a BBPOS WisePOS E / S700.
// Reuses the same Supabase auth + booking pipeline as the rest of the site.
// ============================================================

// ── AUTH GATE ──
const useCloudAuth = () => (typeof SkylaData !== 'undefined' && SkylaData.cloudEnabled && SkylaData.cloudEnabled());

async function checkAuth() {
  if (useCloudAuth()) {
    const session = await SkylaData.getSession();
    return !!session;
  }
  return false;
}
async function authenticate(email, pwd) {
  if (useCloudAuth()) { await SkylaData.signIn(email, pwd); return true; }
  return false;
}

// ── STATE ──
let terminal = null;
let connectedReader = null;
const cart = {};   // key → { id, name, price, qty, kind, packageKey }

const fmt = (cents) => `$${(cents / 100).toFixed(2)}`;
const dollarsToCents = (d) => Math.round(d * 100);
const parseMoney = (value) => {
  const cleaned = String(value || "").replace(/[^0-9.]/g, "");
  if (!cleaned) return 0;
  return dollarsToCents(parseFloat(cleaned));
};

function qrUrl(ref) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=240x240&qzone=1&data=${encodeURIComponent(ref)}`;
}
function generateRef() {
  const d = new Date();
  const stamp = `${d.getFullYear().toString().slice(-2)}${(d.getMonth() + 1).toString().padStart(2, '0')}${d.getDate().toString().padStart(2, '0')}`;
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `SKY-${stamp}-${rand}`;
}

// Package inclusions shown as vouchers on walk-up tickets
const PACKAGE_VOUCHERS = {
  general: [],
  drink: [{ label: 'Coffee or Matcha (your choice)', emoji: '☕', perGuest: true }],
};

// ── CATALOG ──
function ticketPackages() {
  const pk = (typeof SkylaData !== 'undefined' && SkylaData.getPackages()) || {
    general: { name: 'General Admission', price: 29 },
    drink:   { name: 'Deck + Drink', price: 37 },
  };
  // Only the two real, bookable packages (skip premium "coming soon")
  return ['general', 'drink']
    .filter(k => pk[k])
    .map(k => ({ key: k, name: pk[k].name, price: pk[k].price }));
}

function cafeItems() {
  const menu = (typeof SkylaData !== 'undefined' && SkylaData.getCafeMenu()) || {};
  const out = [];
  ['matcha', 'coffee', 'bites'].forEach(cat => {
    (menu[cat] || []).forEach(it => {
      if (it.active !== false) out.push({ id: it.id, name: it.name, price: it.price, emoji: it.emoji || (cat === 'matcha' ? '🍵' : cat === 'coffee' ? '☕' : '🥐') });
    });
  });
  return out;
}

function renderCatalog() {
  const tg = document.getElementById('grid-tickets');
  tg.innerHTML = ticketPackages().map(p => `
    <button class="pos-item pos-item--ticket" data-kind="ticket" data-key="${p.key}" data-name="${p.name}" data-price="${p.price}" type="button">
      <span class="pos-item__name">${p.name}</span>
      <span class="pos-item__price">$${p.price}</span>
    </button>`).join('');

  const cg = document.getElementById('grid-cafe');
  cg.innerHTML = cafeItems().map(it => `
    <button class="pos-item" data-kind="cafe" data-key="${it.id}" data-name="${it.name}" data-price="${it.price}" type="button">
      <span class="pos-item__emoji">${it.emoji}</span>
      <span class="pos-item__name">${it.name}</span>
      <span class="pos-item__price">$${it.price}</span>
    </button>`).join('');

  document.querySelectorAll('.pos-item').forEach(btn => {
    btn.addEventListener('click', () => addToCart(btn.dataset));
  });
}

// ── CART ──
function addToCart(d) {
  const key = `${d.kind}:${d.key}`;
  if (!cart[key]) {
    cart[key] = { id: d.key, name: d.name, price: parseFloat(d.price), qty: 0, kind: d.kind, packageKey: d.kind === 'ticket' ? d.key : null };
  }
  cart[key].qty++;
  renderCart();
}
function addCustomCharge(e) {
  e.preventDefault();
  const nameEl = document.getElementById('custom-charge-name');
  const amountEl = document.getElementById('custom-charge-amount');
  const errEl = document.getElementById('custom-charge-error');
  const amountCents = parseMoney(amountEl.value);
  const name = nameEl.value.trim() || 'Custom charge';

  errEl.textContent = '';
  if (amountCents < 50) {
    errEl.textContent = 'Enter at least $0.50.';
    return;
  }

  const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  cart[`custom:${id}`] = {
    id,
    name,
    price: amountCents / 100,
    qty: 1,
    kind: 'custom',
    packageKey: null,
  };
  nameEl.value = '';
  amountEl.value = '';
  renderCart();
  amountEl.focus();
}
function changeQty(key, delta) {
  if (!cart[key]) return;
  cart[key].qty += delta;
  if (cart[key].qty <= 0) delete cart[key];
  renderCart();
}
function clearCart() { for (const k in cart) delete cart[k]; renderCart(); }

function cartTotalCents() {
  let c = 0;
  for (const k in cart) c += dollarsToCents(cart[k].price) * cart[k].qty;
  return c;
}
function cartHasTickets() { return Object.values(cart).some(l => l.kind === 'ticket'); }

function renderCart() {
  const lines = document.getElementById('cart-lines');
  const empty = document.getElementById('cart-empty');
  const keys = Object.keys(cart);
  if (!keys.length) {
    lines.innerHTML = '<p class="pos-cart__empty" id="cart-empty">Tap items to add them.</p>';
  } else {
    lines.innerHTML = keys.map(k => {
      const l = cart[k];
      return `
        <div class="pos-line">
          <div class="pos-line__info">
            <span class="pos-line__name">${l.name}</span>
            <span class="pos-line__price">${fmt(dollarsToCents(l.price) * l.qty)}</span>
          </div>
          <div class="pos-line__qty">
            <button type="button" data-k="${k}" data-d="-1">−</button>
            <span>${l.qty}</span>
            <button type="button" data-k="${k}" data-d="1">+</button>
          </div>
        </div>`;
    }).join('');
    lines.querySelectorAll('.pos-line__qty button').forEach(b =>
      b.addEventListener('click', () => changeQty(b.dataset.k, parseInt(b.dataset.d))));
  }
  const total = cartTotalCents();
  document.getElementById('cart-subtotal').textContent = fmt(total);
  document.getElementById('cart-total').textContent = fmt(total);
  document.getElementById('charge-amt').textContent = total ? fmt(total) : '';
  const chargeBtn = document.getElementById('cart-charge');
  chargeBtn.disabled = total < 50;
}

// ── STRIPE TERMINAL ──
// Optional: scope readers to a venue. Set in the console with
// localStorage.setItem('skyla_pos_location', 'tml_xxx')
let _posLocation = (typeof localStorage !== 'undefined' && localStorage.getItem('skyla_pos_location')) || null;

function allowSimulatedReader() {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '';
}

function lockProductionReaderMode() {
  const sim = document.getElementById('reader-sim');
  if (!sim) return;
  if (!allowSimulatedReader()) {
    sim.checked = false;
    sim.disabled = true;
    sim.closest('label')?.classList.add('is-disabled');
  }
}

async function hydrateTerminalLocation() {
  if (_posLocation || typeof SkylaData === 'undefined') return;
  try {
    const data = await SkylaData.invokeFunction('stripe-terminal', { action: 'list-locations' });
    const locations = data?.locations || [];
    const skyla = locations.find(l => (l.display_name || '').toLowerCase() === 'skyla los angeles') || locations[0];
    if (skyla?.id) {
      _posLocation = skyla.id;
      localStorage.setItem('skyla_pos_location', _posLocation);
    }
  } catch (e) {
    console.warn('Could not load Stripe Terminal location:', e.message || e);
  }
}

async function fetchConnectionToken() {
  const body = { action: 'connection-token' };
  if (_posLocation) body.location = _posLocation;
  const data = await SkylaData.invokeFunction('stripe-terminal', body);
  if (!data || !data.secret) throw new Error(data?.error || 'No connection token');
  return data.secret;
}
function initTerminal() {
  if (terminal) return terminal;
  terminal = StripeTerminal.create({
    onFetchConnectionToken: fetchConnectionToken,
    onUnexpectedReaderDisconnect: () => setReaderStatus(false),
  });
  return terminal;
}
function setReaderStatus(connected, label) {
  if (!connected) connectedReader = null;
  document.getElementById('reader-dot').classList.toggle('is-on', !!connected);
  document.getElementById('reader-label').textContent = connected
    ? `Reader: ${label || 'connected'}`
    : 'Reader: not connected';
  document.getElementById('reader-connect').textContent = connected ? 'Reconnect' : 'Connect reader';
}

// Discover readers and let the operator pick (you run two — café + door)
async function connectReader() {
  initTerminal();
  openPicker('Searching for readers on this network…');
  try {
    const simulated = allowSimulatedReader() && document.getElementById('reader-sim').checked;
    if (!simulated) await hydrateTerminalLocation();
    const config = { simulated };
    if (!simulated && _posLocation) config.location = _posLocation;
    const discover = await terminal.discoverReaders(config);
    if (discover.error) throw new Error(discover.error.message);
    const readers = discover.discoveredReaders || [];
    if (!readers.length) {
      setPickerMsg('No readers found. Make sure the reader is powered on, online, and registered to this venue.');
      return;
    }
    renderReaderList(readers);
  } catch (e) {
    setPickerMsg('Error: ' + (e.message || e));
  }
}
function renderReaderList(readers) {
  setPickerMsg(`${readers.length} reader${readers.length > 1 ? 's' : ''} found — tap one to connect:`);
  const list = document.getElementById('reader-list');
  list.innerHTML = readers.map((r, i) => `
    <button class="reader-row" data-i="${i}" type="button">
      <strong>${r.label || r.id}</strong>
      <span>${r.serial_number || r.device_type || ''}${r.status ? ' · ' + r.status : ''}</span>
    </button>`).join('');
  list.querySelectorAll('.reader-row').forEach(b =>
    b.addEventListener('click', () => doConnect(readers[parseInt(b.dataset.i)])));
}
async function doConnect(reader) {
  setPickerMsg('Connecting…');
  document.getElementById('reader-list').innerHTML = '';
  try {
    const conn = await terminal.connectReader(reader, { fail_if_in_use: true });
    if (conn.error) throw new Error(conn.error.message);
    connectedReader = conn.reader;
    setReaderStatus(true, conn.reader.label || conn.reader.id);
    closePicker();
  } catch (e) {
    setPickerMsg('Could not connect: ' + (e.message || e));
  }
}
function openPicker(msg) { setPickerMsg(msg); document.getElementById('reader-list').innerHTML = ''; document.getElementById('reader-picker').classList.add('visible'); }
function closePicker() { document.getElementById('reader-picker').classList.remove('visible'); }
function setPickerMsg(m) { document.getElementById('picker-msg').textContent = m; }

function openReaderSetup(msg) {
  document.getElementById('setup-msg').textContent = msg || 'Enter the pairing code shown on the reader.';
  document.getElementById('reader-setup-panel').classList.add('visible');
  setTimeout(() => document.getElementById('reader-code')?.focus(), 50);
}
function closeReaderSetup() { document.getElementById('reader-setup-panel').classList.remove('visible'); }
async function setupReader(e) {
  e.preventDefault();
  const codeEl = document.getElementById('reader-code');
  const nameEl = document.getElementById('reader-name');
  const registrationCode = codeEl.value.trim();
  const label = nameEl.value.trim() || 'Skyla reader';
  if (!registrationCode) {
    document.getElementById('setup-msg').textContent = 'Enter the pairing code shown on the reader.';
    return;
  }

  document.getElementById('setup-msg').textContent = 'Registering reader with Stripe…';
  try {
    const data = await SkylaData.invokeFunction('stripe-terminal', {
      action: 'setup-reader',
      registrationCode,
      label,
    });
    if (!data?.reader?.id || !data?.location?.id) throw new Error(data?.error || 'Could not register reader');
    _posLocation = data.location.id;
    localStorage.setItem('skyla_pos_location', _posLocation);
    codeEl.value = '';
    nameEl.value = '';
    document.getElementById('reader-sim').checked = false;
    closeReaderSetup();
    openPicker(`${data.reader.label || 'Reader'} is registered. Searching so you can connect it…`);
    await connectReader();
  } catch (err) {
    document.getElementById('setup-msg').textContent = 'Could not register reader: ' + (err.message || err);
  }
}

// ── CHARGE ──
let _lastSale = null;
let _charge = null;   // { clientSecret } — kept so a retry reuses the SAME PaymentIntent (no double charge)

async function charge() {
  if (!connectedReader) { alert('Connect a reader first (top right).'); return; }
  const total = cartTotalCents();
  if (total < 50) return;

  openPay('Starting…', 'Preparing the reader.');
  try {
    const receiptEmail = document.getElementById('cart-email')?.value?.trim() || '';
    const data = await SkylaData.invokeFunction('stripe-terminal', {
      action: 'create-intent',
      amountCents: total,
      description: 'Sky LA — in-person sale',
      receiptEmail: receiptEmail || undefined,
      metadata: { source: 'pos', has_tickets: cartHasTickets() ? '1' : '0' },
    });
    if (!data || !data.clientSecret) throw new Error(data?.error || 'Could not start payment');
    _charge = { clientSecret: data.clientSecret };
    await runCharge();
  } catch (e) {
    payError(e.message || 'Payment failed.');
  }
}

// Collect + process on the current PaymentIntent. Safe to call again on retry —
// it reuses the same clientSecret, so the customer is never double-charged.
async function runCharge() {
  if (!_charge) return;
  openPay('Present card on the reader…', 'Ask the customer to tap, insert, or swipe.');
  try {
    const collect = await terminal.collectPaymentMethod(_charge.clientSecret);
    if (collect.error) return payError(collect.error.message, true);

    payUpdate('Processing…', 'Hold on — confirming the payment.');
    const result = await terminal.processPayment(collect.paymentIntent);
    if (result.error) return payError(result.error.message, true);

    if (result.paymentIntent && result.paymentIntent.status === 'succeeded') {
      finalizeSale(result.paymentIntent.id);
    } else {
      payError('Payment was not completed.', true);
    }
  } catch (e) {
    payError(e.message || 'Payment failed.', true);
  }
}

function finalizeSale(paymentId) {
  const now = new Date();
  const time = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const dateStr = now.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  const email = document.getElementById('cart-email')?.value?.trim() || '';
  const tickets = [];

  // Each walk-up ticket line becomes a real booking (so it checks in like online)
  Object.values(cart).forEach(line => {
    if (line.kind !== 'ticket') return;
    const ref = generateRef();
    const booking = {
      bookingRef: ref,
      packageKey: line.packageKey,
      packageName: line.name,
      adults: line.qty, children: 0, infants: 0,
      date: dateStr, visitDate: dateStr, time,
      addons: {},
      subtotal: line.price * line.qty, fee: 0, total: line.price * line.qty,
      firstName: 'Walk-up', lastName: 'Guest', email,
      paid: true, status: 'confirmed',
      paymentMethod: 'card_present', stripePaymentId: paymentId,
      source: 'pos',
    };
    if (typeof SkylaData !== 'undefined') SkylaData.addBooking(booking);
    const vouchers = (PACKAGE_VOUCHERS[line.packageKey] || [])
      .map(v => `${v.emoji} ${v.label}${v.perGuest && line.qty > 1 ? ` ×${line.qty}` : ''}`);
    tickets.push({ ref, name: line.name, qty: line.qty, vouchers });
  });

  const items = Object.values(cart).map(l => ({ name: l.name, qty: l.qty, total: dollarsToCents(l.price) * l.qty }));
  _lastSale = { items, total: cartTotalCents(), tickets, time, dateStr };
  paySuccess(_lastSale);
  clearCart();
}

// ── PAYMENT OVERLAY ──
function openPay(title, msg) {
  document.getElementById('pay-spin').style.display = 'block';
  document.getElementById('pay-icon').style.display = 'none';
  document.getElementById('pay-actions').style.display = 'none';
  document.getElementById('pay-retry-actions').style.display = 'none';
  document.getElementById('pay-cancel').style.display = 'block';
  document.getElementById('pay-title').textContent = title;
  document.getElementById('pay-msg').textContent = msg;
  document.getElementById('pos-pay').classList.add('visible');
}
function payUpdate(title, msg) {
  document.getElementById('pay-title').textContent = title;
  document.getElementById('pay-msg').textContent = msg;
}
function payError(msg, canRetry) {
  document.getElementById('pay-spin').style.display = 'none';
  const icon = document.getElementById('pay-icon');
  icon.style.display = 'flex'; icon.textContent = '✕'; icon.className = 'pos-pay__icon is-err';
  document.getElementById('pay-title').textContent = 'Payment failed';
  document.getElementById('pay-msg').textContent = msg;
  document.getElementById('pay-actions').style.display = 'none';
  // Offer a retry that reuses the same PaymentIntent (no re-keying, no double charge)
  document.getElementById('pay-retry-actions').style.display = (canRetry && _charge) ? 'flex' : 'none';
  document.getElementById('pay-cancel').style.display = (canRetry && _charge) ? 'none' : 'block';
}
function paySuccess(sale) {
  document.getElementById('pay-spin').style.display = 'none';
  const icon = document.getElementById('pay-icon');
  icon.style.display = 'flex'; icon.textContent = '✓'; icon.className = 'pos-pay__icon is-ok';
  document.getElementById('pay-title').textContent = 'Paid ' + fmt(sale.total);
  const lines = sale.items.map(i => `${i.qty}× ${i.name}`).join(' · ');
  let html = `<div class="pos-receipt-items">${lines}</div>`;
  if (sale.tickets.length) {
    html += sale.tickets.map(t => `
      <div class="pos-ticket">
        <img src="${qrUrl(t.ref)}" alt="QR ${t.ref}" />
        <div class="pos-ticket__meta">
          <strong>${t.name}${t.qty > 1 ? ` ×${t.qty}` : ''}</strong>
          <span>${t.ref}</span>
          ${t.vouchers.map(v => `<span class="pos-ticket__v">${v}</span>`).join('')}
        </div>
      </div>`).join('');
  } else {
    html += `<p class="pos-receipt-note">Café order — no ticket needed.</p>`;
  }
  document.getElementById('pay-msg').innerHTML = html;
  document.getElementById('pay-actions').style.display = 'flex';
  document.getElementById('pay-retry-actions').style.display = 'none';
  document.getElementById('pay-cancel').style.display = 'none';
  _charge = null;   // sale complete — don't let a stray retry re-run
}
function closePay() {
  document.getElementById('pos-pay').classList.remove('visible');
  // Cancel any in-progress collection so the reader returns to idle
  if (_charge && terminal) { try { terminal.cancelCollectPaymentMethod(); } catch (e) {} }
  _charge = null;
}

// ── INIT ──
document.addEventListener('DOMContentLoaded', () => {
  if (typeof SkylaData !== 'undefined' && SkylaData.ensureCloud) SkylaData.ensureCloud();

  const gate = document.getElementById('gate');
  const app = document.getElementById('pos-app');

  checkAuth().then(ok => {
    if (ok) { gate.style.display = 'none'; app.style.display = 'flex'; boot(); }
  });

  document.getElementById('gate-form').addEventListener('submit', async e => {
    e.preventDefault();
    const email = document.getElementById('gate-email').value.trim();
    const pwd = document.getElementById('gate-input').value;
    const errEl = document.getElementById('gate-error');
    errEl.textContent = '';
    try {
      const ok = await authenticate(email, pwd);
      if (ok) { gate.style.display = 'none'; app.style.display = 'flex'; boot(); }
      else errEl.textContent = 'Cloud auth not available.';
    } catch (err) {
      errEl.textContent = 'Wrong email or password.';
    }
  });
});

function boot() {
  renderCatalog();
  renderCart();
  lockProductionReaderMode();
  hydrateTerminalLocation();

  document.querySelectorAll('.pos-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.pos-tab').forEach(t => t.classList.remove('is-active'));
      tab.classList.add('is-active');
      const which = tab.dataset.tab;
      document.getElementById('grid-tickets').style.display = which === 'tickets' ? '' : 'none';
      document.getElementById('grid-cafe').style.display = which === 'cafe' ? '' : 'none';
      document.getElementById('grid-custom').style.display = which === 'custom' ? '' : 'none';
    });
  });

  document.getElementById('reader-connect').addEventListener('click', connectReader);
  document.getElementById('custom-charge-form').addEventListener('submit', addCustomCharge);
  document.getElementById('reader-setup').addEventListener('click', () => openReaderSetup());
  document.getElementById('reader-setup-form').addEventListener('submit', setupReader);
  document.getElementById('setup-cancel').addEventListener('click', closeReaderSetup);
  document.getElementById('cart-charge').addEventListener('click', charge);
  document.getElementById('cart-clear').addEventListener('click', clearCart);
  document.getElementById('pay-cancel').addEventListener('click', closePay);
  document.getElementById('pay-cancel-retry').addEventListener('click', closePay);
  document.getElementById('pay-retry').addEventListener('click', runCharge);
  document.getElementById('pay-done').addEventListener('click', closePay);
  document.getElementById('pay-print').addEventListener('click', () => window.print());
  document.getElementById('picker-cancel').addEventListener('click', closePicker);

  // Refresh prices if config arrives from cloud
  window.addEventListener('skyla:config', renderCatalog);
}
