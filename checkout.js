// ── STATE ──
const PACKAGES_RAW = (typeof SkylaData !== 'undefined')
  ? SkylaData.getPackages()
  : {
      general: { name: 'General Admission', price: 29 },
      drink:   { name: 'Deck + Drink',      price: 37 },
    };

let PACKAGES = PACKAGES_RAW;

const ADDONS_RAW = (typeof SkylaData !== 'undefined')
  ? SkylaData.getAddons()
  : [
      { id: 'matcha',   name: 'Ceremonial Matcha Latte',   price: 8 },
      { id: 'pourover', name: 'Single-Origin Pour Over',   price: 8 },
      { id: 'hojicha',  name: 'Iced Matcha Hojicha Latte', price: 8 },
      { id: 'coldbrew', name: 'Iced Mocha Cold Brew',      price: 8 },
    ];

// Build addon map keyed by id
let ADDON_MAP = {};
ADDONS_RAW.forEach(a => { ADDON_MAP[a.id] = a; });

// When fresh prices arrive from the cloud, re-read packages/add-ons and re-render
window.addEventListener('skyla:config', () => {
  if (typeof SkylaData === 'undefined') return;
  PACKAGES = SkylaData.getPackages();
  ADDON_MAP = {};
  (SkylaData.getAddons() || []).forEach(a => { ADDON_MAP[a.id] = a; });
  if (state.packageKey && PACKAGES[state.packageKey]) {
    state.packagePrice = PACKAGES[state.packageKey].price || 0;
    if (PACKAGES[state.packageKey].roomFee != null) state.roomFee = PACKAGES[state.packageKey].roomFee;
  }
  updateDisplayedPrices();
  updateSummary();
});

const BOOKING_FEE_RATE  = 0.05;
const CHILD_DISCOUNT    = 0.5;

// ── EMAIL CONFIRMATIONS (EmailJS — no backend required) ──────────────────────
// Emails the buyer their booking confirmation + check-in QR code.
//
// ONE-TIME SETUP (~5 min, free tier is plenty):
//   1. Create an account at https://www.emailjs.com
//   2. Add an Email Service (Gmail / Outlook / etc.)  → copy the Service ID
//   3. Create an Email Template whose "To Email" field is {{to_email}} and that
//      uses any of these variables in the body:
//        {{to_name}} {{booking_ref}} {{package_name}} {{visit_date}}
//        {{entry_time}} {{guests}} {{total}} {{qr_url}} {{location}}
//   4. Paste your Public Key, Service ID, and Template ID below and flip
//      `enabled` to true. That's it — confirmations will send for real.
//
// Until enabled, checkout runs in demo mode: the booking + printable ticket are
// generated and the guest is told to print/save it (no email is sent).
const EMAIL_CONFIG = {
  enabled:    true,                       // ← LIVE
  publicKey:  'CoPVDC_Ie65NuqZUi',        // ← Account → General
  serviceId:  'service_76qlj9w',          // ← Brevo service (authenticated skydeckla.com)
  templateId: 'template_ejqsq1p',         // ← Contact Us template
};

// Real, scannable QR encoding the booking reference (used on the ticket + email)
function qrUrl(ref) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=240x240&qzone=1&data=${encodeURIComponent(ref)}`;
}

// What each package includes at the venue. Keep in sync with admin.js PACKAGE_VOUCHERS.
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

// Package inclusions + purchased add-ons → flat voucher list
function buildVoucherList(pkgKey, addons, adults, children) {
  const guests = (adults || 0) + (children || 0) || 1;
  const list = [];
  (PACKAGE_VOUCHERS[pkgKey] || []).forEach(v => {
    list.push({ label: v.label, emoji: v.emoji || '🎟', qty: v.perGuest ? guests : (v.qty || 1) });
  });
  Object.entries(addons || {}).forEach(([id, qty]) => {
    if (qty > 0) {
      const def = ADDON_MAP[id];
      list.push({ label: def?.name || id, emoji: def?.emoji || '🥤', qty });
    }
  });
  return list;
}

// Voucher chips for the printable on-screen ticket
function vouchersToTicketHTML(list) {
  if (!list.length) return '';
  return `
    <div class="ticket__vouchers">
      <div class="ticket__vouchers-label">Included Vouchers</div>
      <div class="ticket__vouchers-list">
        ${list.map(v =>
          `<span class="ticket__voucher">${v.emoji} ${v.label}${v.qty > 1 ? ` <b>×${v.qty}</b>` : ''}</span>`
        ).join('')}
      </div>
    </div>`;
}

// HTML list for the email body (use {{{vouchers_html}}} in the EmailJS template)
function vouchersToEmailHTML(list) {
  if (!list.length) return '<p style="color:#888;font-size:14px;margin:0">General admission — no add-on vouchers.</p>';
  return '<ul style="list-style:none;padding:0;margin:0">' +
    list.map(v =>
      `<li style="padding:7px 0;border-bottom:1px solid #eee;font-size:14px">` +
      `${v.emoji} ${v.label}${v.qty > 1 ? ` <strong>×${v.qty}</strong>` : ''}</li>`
    ).join('') +
    '</ul>';
}

// Returns 'sent' | 'failed' | 'demo'
async function sendConfirmationEmail(data) {
  if (!EMAIL_CONFIG.enabled || typeof emailjs === 'undefined') return 'demo';

  const params = {
    to_email:     data.email,
    to_name:      `${data.firstName} ${data.lastName}`.trim(),
    booking_ref:  data.bookingRef,
    package_name: data.packageName,
    visit_date:   data.date,
    entry_time:   data.time,
    guests:       `${data.adults} adult${data.adults !== 1 ? 's' : ''}` +
                  (data.children > 0 ? `, ${data.children} child${data.children !== 1 ? 'ren' : ''}` : ''),
    total:        `$${data.total.toFixed(2)}`,
    qr_url:       qrUrl(data.bookingRef),
    vouchers_html: vouchersToEmailHTML(
      buildVoucherList(data.packageKey, data.addons, data.adults, data.children)
    ),
    location:     'Skyla Los Angeles · 6100 Wilshire Blvd, Top Floor',
    reply_to:     'reservations@skydeckla.com',
  };

  try {
    emailjs.init({ publicKey: EMAIL_CONFIG.publicKey });
    await emailjs.send(EMAIL_CONFIG.serviceId, EMAIL_CONFIG.templateId, params);
    return 'sent';
  } catch (err) {
    console.error('EmailJS send failed:', err);
    return 'failed';
  }
}

const state = {
  package:      null,
  packagePrice: 0,
  packageKey:   null,
  roomFee:      0,
  adults:       2,
  children:     0,
  infants:      0,
  date:         '',
  visitDate:    '',
  time:         '',
  addons:       {},   // { [id]: qty }
};

// Initialise addon quantities to 0
ADDONS_RAW.forEach(a => { state.addons[a.id] = 0; });

// ── INIT ──
document.addEventListener('DOMContentLoaded', () => {
  // Warm up the cloud client so the booking saves instantly on confirm (no-op if disabled)
  if (typeof SkylaData !== 'undefined' && SkylaData.ensureCloud) SkylaData.ensureCloud();

  // If we're returning from Stripe, finalize / reset the booking
  if (STRIPE_ENABLED) {
    applyStripeUI();
    handleStripeReturn();
  }

  // Live prices from SkylaData — update the display cards on this page
  updateDisplayedPrices();

  // Pre-select from URL param
  const params = new URLSearchParams(window.location.search);
  const pkgParam = params.get('package');
  if (pkgParam && PACKAGES[pkgParam]) selectPackage(pkgParam);

  // Date input
  const dateInput = document.getElementById('visit-date');
  const today = new Date().toISOString().split('T')[0];
  dateInput.min = today;
  dateInput.value = today;
  state.visitDate  = today;
  state.date       = formatDate(today);
  dateInput.addEventListener('change', e => {
    state.visitDate = e.target.value;
    state.date      = formatDate(e.target.value);
    updateSummary();
  });

  // Regular package card clicks
  document.querySelectorAll('.pkg-card').forEach(card => {
    card.addEventListener('click', () => selectPackage(card.dataset.package, 0));
  });

  // Premium experience card clicks
  document.querySelectorAll('.exp-pkg-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (card.dataset.soon) { e.preventDefault(); return; }   // Coming Soon — not bookable yet
      selectPackage(card.dataset.package, parseFloat(card.dataset.roomFee || 0));
    });
  });

  // Time slot clicks
  document.querySelectorAll('.time-slot').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.time-slot').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      state.time = btn.dataset.time;
      updateSummary();
    });
  });

  // Guest qty
  document.querySelectorAll('.qty-btn[data-type]').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.type;
      const action = btn.dataset.action;
      if (action === 'plus') {
        state[type] = Math.min(state[type] + 1, 20);
      } else {
        state[type] = Math.max(state[type] - 1, type === 'adults' ? 1 : 0);
      }
      document.getElementById(`${type}-count`).textContent = state[type];
      updateSummary();
    });
  });

  // Addon qty
  document.querySelectorAll('.qty-btn[data-addon]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id     = btn.dataset.addon;
      const action = btn.dataset.action;
      const max    = state.adults + state.children || 10;
      if (action === 'plus') {
        state.addons[id] = Math.min((state.addons[id] || 0) + 1, max);
      } else {
        state.addons[id] = Math.max((state.addons[id] || 0) - 1, 0);
      }
      const el = document.getElementById(`addon-${id}`);
      if (el) el.textContent = state.addons[id];
      updateSummary();
    });
  });

  updateSummary();
});

// Patch displayed prices on the package cards to reflect any admin overrides
function updateDisplayedPrices() {
  document.querySelectorAll('.pkg-card[data-package]').forEach(card => {
    const key = card.dataset.package;
    const pkg = PACKAGES[key];
    if (!pkg) return;
    card.dataset.price = pkg.price;
    const priceEl = card.querySelector('.pkg-card__price');
    if (priceEl) priceEl.innerHTML = `$${pkg.price}<span>/person</span>`;
  });
}

function selectPackage(pkgKey, roomFeeOverride = 0) {
  if (!PACKAGES[pkgKey]) return;
  state.package      = pkgKey;
  state.packageKey   = pkgKey;
  state.packagePrice = PACKAGES[pkgKey].price || 0;
  state.roomFee      = PACKAGES[pkgKey].roomFee ?? roomFeeOverride;

  // Deselect all card types
  document.querySelectorAll('.pkg-card, .exp-pkg-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.package === pkgKey);
    const radio = c.querySelector('input[type="radio"]');
    if (radio) radio.checked = c.dataset.package === pkgKey;
  });

  updateSummary();
}

function calcSubtotal() {
  const adultCost = state.adults   * state.packagePrice;
  const childCost = state.children * Math.ceil(state.packagePrice * CHILD_DISCOUNT);
  let addonCost = 0;
  Object.entries(state.addons).forEach(([id, qty]) => {
    addonCost += qty * (ADDON_MAP[id]?.price || 0);
  });
  return adultCost + childCost + addonCost + (state.roomFee || 0);
}

function updateSummary() {
  const subtotal = calcSubtotal();
  const fee      = Math.round(subtotal * BOOKING_FEE_RATE * 100) / 100;
  const total    = subtotal + fee;
  const guests   = state.adults + state.children;

  // Package line
  const pkgName = state.package
    ? `${PACKAGES[state.package].name} × ${guests} guest${guests !== 1 ? 's' : ''}`
    : '— Select a package';
  const pkgCost = state.package
    ? state.adults * state.packagePrice + state.children * Math.ceil(state.packagePrice * CHILD_DISCOUNT)
    : 0;

  const el = id => document.getElementById(id);

  el('summary-pkg-name').textContent  = pkgName;
  el('summary-pkg-price').textContent = state.package ? `$${pkgCost.toFixed(2)}` : '$0.00';

  // Addons block
  const addonsBlock = el('summary-addons-block');
  addonsBlock.innerHTML = '';
  Object.entries(state.addons).forEach(([id, qty]) => {
    if (qty > 0) {
      const a    = ADDON_MAP[id];
      const line = document.createElement('div');
      line.className = 'summary-addon-line';
      line.innerHTML = `<span>${a?.name || id} ×${qty}</span><span>$${(qty * (a?.price || 0)).toFixed(2)}</span>`;
      addonsBlock.appendChild(line);
    }
  });

  // Room fee line
  if (state.roomFee > 0) {
    const rfl = document.createElement('div');
    rfl.className = 'summary-addon-line';
    rfl.innerHTML = `<span>Room Fee</span><span>$${state.roomFee.toFixed(2)}</span>`;
    addonsBlock.appendChild(rfl);
  }

  el('summary-subtotal').textContent = `$${subtotal.toFixed(2)}`;
  el('summary-fees').textContent     = `$${fee.toFixed(2)}`;
  el('summary-total').textContent    = `$${total.toFixed(2)}`;
  el('final-total').textContent      = `$${total.toFixed(2)}`;
}

// ── STEP NAV ──
function goToStep(num) {
  if (num > 1 && !state.package) {
    flashError('step-1', 'Please select a package before continuing.');
    return;
  }
  if (num > 1) {
    const email = document.getElementById('booking-email')?.value?.trim() || '';
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      const emailInput = document.getElementById('booking-email');
      if (emailInput) {
        emailInput.focus();
        emailInput.style.borderColor = '#e05a5a';
        setTimeout(() => emailInput.style.borderColor = '', 2500);
      }
      flashError('step-1', 'Please enter a valid email address to receive your tickets.');
      return;
    }
  }
  if (num > 2 && !state.time) {
    flashError('step-2', 'Please select an entry time before continuing.');
    return;
  }

  document.querySelectorAll('.form-step').forEach(s => s.classList.remove('active'));
  document.getElementById(`step-${num}`)?.classList.add('active');

  document.querySelectorAll('.checkout-step').forEach(s => {
    const n = parseInt(s.dataset.step);
    s.classList.remove('active', 'completed');
    if (n === num) s.classList.add('active');
    if (n < num)  s.classList.add('completed');
  });

  if (num === 4) buildReview();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function flashError(stepId, msg) {
  const step = document.getElementById(stepId);
  let err = step.querySelector('.step-error');
  if (!err) {
    err = document.createElement('p');
    err.className = 'step-error';
    err.style.cssText = 'color:#e05a5a;font-size:0.85rem;margin-top:12px;';
    step.querySelector('.btn--step').before(err);
  }
  err.textContent = msg;
  setTimeout(() => err.remove(), 3000);
}

function buildReview() {
  const subtotal = calcSubtotal();
  const fee      = Math.round(subtotal * BOOKING_FEE_RATE * 100) / 100;
  const total    = subtotal + fee;

  const addonLines = Object.entries(state.addons)
    .filter(([, qty]) => qty > 0)
    .map(([id, qty]) => {
      const a = ADDON_MAP[id];
      return `<div class="review-line"><strong>${a?.name || id} ×${qty}</strong><span>$${(qty*(a?.price||0)).toFixed(2)}</span></div>`;
    }).join('');

  document.getElementById('review-box').innerHTML = `
    <div class="review-line"><strong>Package</strong><span>${PACKAGES[state.package]?.name || '—'}</span></div>
    <div class="review-line"><strong>Date</strong><span>${state.date || '—'}</span></div>
    <div class="review-line"><strong>Time</strong><span>${state.time || '—'}</span></div>
    <div class="review-line"><strong>Adults</strong><span>${state.adults} × $${state.packagePrice}</span></div>
    ${state.children > 0 ? `<div class="review-line"><strong>Children</strong><span>${state.children} × $${Math.ceil(state.packagePrice * CHILD_DISCOUNT)}</span></div>` : ''}
    ${addonLines}
    <div class="review-line" style="border-top:1px solid rgba(255,255,255,0.1);padding-top:16px;margin-top:8px;">
      <strong>Booking Fee (5%)</strong><span>$${fee.toFixed(2)}</span>
    </div>
    <div class="review-line" style="font-size:1.1rem;font-weight:700;color:#fff;">
      <strong>Total</strong><span style="color:var(--gold)">$${total.toFixed(2)}</span>
    </div>`;
}

// ── PAYMENTS (Stripe) ────────────────────────────────────────────────────────
// Once the Supabase `stripe-checkout` function is deployed + secret is set,
// flip this to true. While false, checkout creates the booking directly (demo,
// no real charge) so the site keeps working.
const STRIPE_ENABLED = true;

function setBtnBusy(label) {
  const btn = document.querySelector('.btn--confirm');
  if (btn) { btn.disabled = true; btn.dataset.prevHtml = btn.dataset.prevHtml || btn.innerHTML; btn.innerHTML = label; }
  return btn;
}
function clearBtnBusy() {
  const btn = document.querySelector('.btn--confirm');
  if (btn) { btn.disabled = false; if (btn.dataset.prevHtml) btn.innerHTML = btn.dataset.prevHtml; }
}

// Build the booking record + ticket data from the current cart state
function buildBookingPayload() {
  const email     = document.getElementById('booking-email')?.value?.trim() || '';
  const firstName = document.getElementById('pay-first')?.value?.trim() || '';
  const lastName  = document.getElementById('pay-last')?.value?.trim() || '';

  const subtotal   = calcSubtotal();
  const fee        = Math.round(subtotal * BOOKING_FEE_RATE * 100) / 100;
  const total      = subtotal + fee;
  const bookingRef = generateBookingRef();

  const booking = {
    bookingRef,
    packageKey:  state.packageKey,
    packageName: PACKAGES[state.packageKey]?.name,
    adults: state.adults, children: state.children, infants: state.infants,
    visitDate: state.visitDate, date: state.date, time: state.time,
    addons: { ...state.addons },
    subtotal, fee, total,
    firstName, lastName, email,
  };
  const ticketData = {
    bookingRef, email, firstName, lastName,
    packageKey:  state.packageKey,
    packageName: PACKAGES[state.packageKey]?.name || '',
    addons: { ...state.addons },
    date: state.date, time: state.time,
    adults: state.adults, children: state.children, total,
  };
  return { booking, ticketData };
}

async function confirmOrder() {
  // Name is required (Stripe collects the card itself)
  for (const id of ['pay-first', 'pay-last']) {
    const el = document.getElementById(id);
    if (!el || !el.value.trim()) {
      if (el) { el.focus(); el.style.borderColor = '#e05a5a'; setTimeout(() => el.style.borderColor = '', 2500); }
      return;
    }
  }

  const { booking, ticketData } = buildBookingPayload();

  if (STRIPE_ENABLED) {
    return startStripeCheckout(booking, ticketData);
  }

  // Demo mode — no real payment, create the booking directly
  setBtnBusy('Processing…');
  if (typeof SkylaData !== 'undefined') SkylaData.addBooking(booking);
  const emailStatus = await sendConfirmationEmail(ticketData);
  clearBtnBusy();
  showTicket({ ...ticketData, emailStatus });
}

// When Stripe is live, reflect it in the payment step UI
function applyStripeUI() {
  const notice = document.getElementById('pay-notice');
  if (notice) {
    notice.innerHTML =
      `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>` +
      ` You'll be sent to <strong>Stripe</strong>'s secure page to pay. We never see or store your card details.`;
  }
  const btn = document.querySelector('.btn--confirm');
  if (btn) btn.innerHTML = `🔒 Pay Securely — <span id="final-total">${document.getElementById('final-total')?.textContent || '$0.00'}</span>`;
}

// Redirect the customer to Stripe's hosted, PCI-compliant payment page
async function startStripeCheckout(booking, ticketData) {
  setBtnBusy('Redirecting to secure checkout…');
  try {
    // Stash so we can finalize the booking when Stripe sends them back
    sessionStorage.setItem('skyla_pending_booking', JSON.stringify(booking));
    sessionStorage.setItem('skyla_pending_ticket',  JSON.stringify(ticketData));

    const base = window.location.origin + window.location.pathname;
    const data = await SkylaData.invokeFunction('stripe-checkout', {
      action:      'create',
      amountCents: Math.round(booking.total * 100),
      currency:    'usd',
      description: `Skyla — ${booking.packageName || 'Booking'} (${booking.bookingRef})`,
      bookingRef:  booking.bookingRef,
      email:       booking.email,
      successUrl:  `${base}?stripe=success&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl:   `${base}?stripe=cancel`,
    });
    if (!data || !data.url) throw new Error(data?.error || 'No checkout URL returned');
    window.location.href = data.url;     // → Stripe-hosted payment page
  } catch (err) {
    console.error('Stripe checkout failed:', err);
    clearBtnBusy();
    flashError('step-4', 'Payment could not be started. Please try again.');
  }
}

// On returning from Stripe, finalize (success) or reset (cancel)
async function handleStripeReturn() {
  const params  = new URLSearchParams(window.location.search);
  const status  = params.get('stripe');
  if (!status) return;
  const cleanUrl = window.location.origin + window.location.pathname;

  if (status === 'cancel') {
    window.history.replaceState({}, '', cleanUrl);
    goToStep(4);
    flashError('step-4', 'Payment canceled — you have not been charged.');
    return;
  }

  if (status === 'success') {
    const sessionId = params.get('session_id');
    const booking = JSON.parse(sessionStorage.getItem('skyla_pending_booking') || 'null');
    const ticket  = JSON.parse(sessionStorage.getItem('skyla_pending_ticket')  || 'null');
    window.history.replaceState({}, '', cleanUrl);
    if (!booking || !ticket) return;

    try {
      const v = await SkylaData.invokeFunction('stripe-checkout', { action: 'verify', sessionId });
      if (!v || !v.paid) { goToStep(4); flashError('step-4', 'Payment was not completed.'); return; }
    } catch (e) {
      console.error('verify failed', e);
      goToStep(4); flashError('step-4', 'Could not verify payment — contact us if you were charged.');
      return;
    }

    booking.paid = true;
    booking.stripeSessionId = sessionId;
    if (typeof SkylaData !== 'undefined') SkylaData.addBooking(booking);
    const emailStatus = await sendConfirmationEmail(ticket);
    sessionStorage.removeItem('skyla_pending_booking');
    sessionStorage.removeItem('skyla_pending_ticket');
    showTicket({ ...ticket, emailStatus });
  }
}

// ── PAYMENTS (Kaskade — crypto, experimental) ────────────────────────────────
// Alternative provider to Stripe (pay in BTC, etc.). Like Stripe, nothing
// sensitive lives here: the secret key (ks_live_...) is stored in the Supabase
// `kaskade-payment` Edge Function and never reaches the browser. Off by default
// while we trial it alongside Stripe — flip to true once the function is
// deployed and the KASKADE_SECRET_KEY secret is set in Supabase.
const KASKADE_ENABLED = false;

// Creates a crypto payment and returns { id, payAddress, payAmount, ... }.
// The customer then sends that exact amount of crypto to payAddress.
async function createKaskadePayment(booking, payCurrency = 'btc') {
  const data = await SkylaData.invokeFunction('kaskade-payment', {
    priceUsd:         Math.round(booking.total),
    payCurrency,
    orderId:          booking.bookingRef,
    orderDescription: `Sky LA — ${booking.packageName || 'Booking'}`,
  });
  if (!data || data.error) throw new Error(data?.error || 'Kaskade payment failed');
  return data.payment;
}

// ── TICKET GENERATION ──
function generateBookingRef() {
  const d    = new Date();
  const yr   = d.getFullYear().toString().slice(-2);
  const mo   = (d.getMonth() + 1).toString().padStart(2, '0');
  const rand = Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6).padEnd(6, 'X');
  return `SKY${yr}${mo}-${rand}`;
}

function showTicket(data) {
  const guestLine = `${data.adults} Adult${data.adults !== 1 ? 's' : ''}` +
    (data.children > 0 ? ` · ${data.children} Child${data.children !== 1 ? 'ren' : ''}` : '');

  // Confirmation status message reflects whether the email actually went out
  const statusEl = document.getElementById('confirm-status');
  if (statusEl) {
    if (data.emailStatus === 'sent') {
      statusEl.innerHTML = `Confirmation emailed to <strong>${data.email}</strong> — show the QR below at the front desk.` +
        `<span class="confirm-note">Don't see it? Check your spam or junk folder.</span>`;
    } else if (data.emailStatus === 'failed') {
      statusEl.innerHTML = `We couldn't email <strong>${data.email}</strong> just now — please print or screenshot your ticket below to check in.`;
    } else {
      statusEl.innerHTML = `Save or print your ticket below and present the QR at the front desk. <span class="confirm-note">(Email delivery isn't configured yet.)</span>`;
    }
  }

  document.getElementById('ticket-wrap').innerHTML = `
    <div class="ticket" id="printable-ticket">
      <div class="ticket__top">
        <div class="ticket__brand">
          <div class="ticket__logo">SKYLA</div>
          <div class="ticket__subloc">Los Angeles · Observation Deck</div>
          <div class="ticket__addr">6100 Wilshire Blvd, Top Floor</div>
        </div>
        <div class="ticket__qr">${buildQR(data.bookingRef)}</div>
      </div>

      <div class="ticket__fields">
        <div class="ticket__field ticket__field--wide">
          <div class="ticket__field-label">BOOKING REFERENCE</div>
          <div class="ticket__field-value ticket__field-value--ref">${data.bookingRef}</div>
        </div>
        <div class="ticket__field">
          <div class="ticket__field-label">GUEST</div>
          <div class="ticket__field-value">${data.firstName} ${data.lastName}</div>
        </div>
        <div class="ticket__field">
          <div class="ticket__field-label">PACKAGE</div>
          <div class="ticket__field-value">${data.packageName}</div>
        </div>
      </div>

      <div class="ticket__fields ticket__fields--row3">
        <div class="ticket__field">
          <div class="ticket__field-label">DATE</div>
          <div class="ticket__field-value">${data.date}</div>
        </div>
        <div class="ticket__field">
          <div class="ticket__field-label">ENTRY TIME</div>
          <div class="ticket__field-value">${data.time}</div>
        </div>
        <div class="ticket__field">
          <div class="ticket__field-label">GUESTS</div>
          <div class="ticket__field-value">${guestLine}</div>
        </div>
      </div>

      ${vouchersToTicketHTML(buildVoucherList(data.packageKey, data.addons, data.adults, data.children))}

      <div class="ticket__instructions">
        Show this QR code at the front desk to check in — on your phone or printed. Arrive within 30 min of your entry window.
      </div>

      <div class="ticket__tear">
        <div class="ticket__tear-circle ticket__tear-circle--left"></div>
        <div class="ticket__tear-line"></div>
        <div class="ticket__tear-circle ticket__tear-circle--right"></div>
      </div>

      <div class="ticket__stub">
        <div class="ticket__barcode-wrap">
          ${buildBarcodeSVG(data.bookingRef)}
          <div class="ticket__barcode-ref">${data.bookingRef}</div>
        </div>
        <div class="ticket__stub-total">
          <div class="ticket__stub-label">TOTAL PAID</div>
          <div class="ticket__stub-amount">$${data.total.toFixed(2)}</div>
        </div>
      </div>
    </div>
  `;

  document.getElementById('ticket-modal').classList.add('visible');
}

// Real, scannable QR (encodes the booking reference). Falls back to the
// decorative SVG if the QR image service can't be reached.
function buildQR(ref) {
  return `<img class="ticket__qr-img" src="${qrUrl(ref)}" width="120" height="120" ` +
         `alt="Check-in QR ${ref}" loading="eager" ` +
         `onerror="this.outerHTML = window.__qrFallback('${ref}')" />`;
}
window.__qrFallback = function (ref) { return buildQRSVG(ref); };

function buildQRSVG(seed) {
  const size = 25, cs = 7, total = size * cs;

  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;

  let cells = '';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if ((r < 8 && c < 8) || (r < 8 && c >= size - 8) || (r >= size - 8 && c < 8)) continue;
      const idx = r * size + c;
      const bit = ((h >>> (idx % 30)) ^ (idx * 0x9e3779b9 >>> 27)) & 1;
      if (bit) cells += `<rect x="${c*cs}" y="${r*cs}" width="${cs}" height="${cs}" fill="white"/>`;
    }
  }

  const finder = (x, y) => {
    const p = cs;
    return `<rect x="${x}" y="${y}" width="${7*p}" height="${7*p}" fill="white"/>` +
           `<rect x="${x+p}" y="${y+p}" width="${5*p}" height="${5*p}" fill="black"/>` +
           `<rect x="${x+2*p}" y="${y+2*p}" width="${3*p}" height="${3*p}" fill="white"/>`;
  };

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="120" height="120">` +
    `<rect width="${total}" height="${total}" fill="black"/>` +
    cells + finder(0,0) + finder((size-7)*cs,0) + finder(0,(size-7)*cs) +
    `</svg>`;
}

function buildBarcodeSVG(seed) {
  const W = 260, H = 52;
  const data = seed.replace(/-/g, '');
  let bars = '', x = 6;

  const bar = (w, full) => {
    bars += `<rect x="${x}" y="${full ? 0 : 4}" width="${w}" height="${full ? H : H-8}" fill="white"/>`;
    x += w;
  };
  const gap = w => { x += w; };

  bar(3, true); gap(2); bar(1, true); gap(2); bar(3, true); gap(3);

  for (const ch of data) {
    const code = ch.charCodeAt(0);
    for (let b = 6; b >= 0; b--) {
      const w = ((code >> b) & 1) ? 3 : 1;
      bar(w, false);
      gap(((code >> ((b+2) % 7)) & 1) ? 3 : 2);
    }
  }

  bar(1, true); gap(2); bar(3, true); gap(2); bar(1, true);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="max-width:100%">` +
    `<rect width="${W}" height="${H}" fill="black"/>` + bars + `</svg>`;
}

function printTicket() {
  const ticket = document.getElementById('printable-ticket');
  if (!ticket) return;
  const w = window.open('', '_blank', 'width=700,height=600');
  w.document.write(`<!DOCTYPE html><html><head><title>Skyla Ticket</title>
    <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700&family=Inter:wght@400;500;600&display=swap" rel="stylesheet"/>
    <link rel="stylesheet" href="checkout.css"/>
    <style>body{background:#0a0a0a;display:flex;justify-content:center;padding:40px;} @media print{body{padding:0;}}</style>
    </head><body>${ticket.outerHTML}<script>window.onload=()=>window.print()<\/script></body></html>`);
  w.document.close();
}

function formatDate(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}
