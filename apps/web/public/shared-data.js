/* ============================================================
   SKYLA — Shared Data Layer
   All editable site data lives in localStorage via this module.
   Loaded on checkout.html, index.html, cafe.html, admin.html.
   ============================================================ */

const SkylaData = (() => {

  const KEYS = {
    packages:     'skyla_packages',
    addons:       'skyla_addons',
    cafeMenu:     'skyla_cafe_menu',
    bookings:     'skyla_bookings',
    hours:        'skyla_hours',
    announcement: 'skyla_announcement',
    password:     'skyla_admin_pwd',
  };

  const DEFAULTS = {
    packages: {
      general:          { name: 'General Admission',        price: 29,  description: '360° Observation Deck, Indoor Lounge, Timed Entry — Skip the Line' },
      drink:            { name: 'Deck + Drink',             price: 37,  description: 'All General features + 1 handcrafted drink — your choice of coffee or ceremonial matcha, claimed at the café' },
      'date-night':     { name: 'Date Night Experience',    price: 98,  description: 'Reserved window seats · Champagne for two · Charcuterie & dessert · Keepsake photo · Entry included', entryIncluded: true, minAdults: 2 },
      'champagne-room': { name: 'Champagne Room',           price: 0,   description: 'Private room · Full champagne bottle service · Caviar & small bites · Personal host · Entry included', entryIncluded: true, roomFee: 350 },
      'family-suite':   { name: 'Family Suite',             price: 0,   description: 'Private room · Dedicated waitress · Family & kids menu · Up to 12 guests', entryIncluded: false, roomFee: 250 },
    },
    addons: [
      { id: 'matcha',   name: 'Ceremonial Matcha Latte',  emoji: '🍵', price: 8, active: true },
      { id: 'pourover', name: 'Single-Origin Pour Over',  emoji: '☕', price: 8, active: true },
      { id: 'hojicha',  name: 'Iced Matcha Hojicha Latte',emoji: '🧋', price: 8, active: true },
      { id: 'coldbrew', name: 'Iced Mocha Cold Brew',     emoji: '🍫', price: 8, active: true },
    ],
    cafeMenu: {
      matcha: [
        { id: 'm1', name: 'Ceremonial Matcha Latte',  price: 8, desc: 'Stone-ground ceremonial grade matcha with oat or whole milk. Hot or iced.', tags: 'Hot · Iced, Oat · Whole Milk, Vegan Option', active: true },
        { id: 'm2', name: 'Matcha Tasting Flight',    price: 18, desc: 'Three preparations side by side: traditional usucha, house latte, and hojicha.', tags: '3 Servings, Usucha · Latte · Hojicha', active: true },
        { id: 'm3', name: 'Iced Hojicha Latte',       price: 8, desc: 'Roasted Japanese green tea with house-made brown sugar syrup and oat milk.', tags: 'Iced Only, Low Caffeine', active: true },
        { id: 'm4', name: 'Matcha Affogato',          price: 14, desc: 'A shot of ceremonial matcha over vanilla soft-serve. Bitter, grassy, and creamy.', tags: 'Dessert, Seasonal', active: true },
      ],
      coffee: [
        { id: 'c1',  name: 'Single-Origin Pour Over',  price: 8, desc: 'Brewed to order through a Hario V60. Rotating small-batch roasters weekly.', tags: 'Hot · Iced, Rotating Weekly', active: true },
        { id: 'c2',  name: 'Iced Mocha Cold Brew',     price: 8, desc: '24-hour cold-steeped concentrate with Valrhona dark chocolate and oat milk.', tags: 'Iced Only, Vegan', active: true },
        { id: 'c3',  name: 'Cortado',                  price: 8,  desc: 'Double shot espresso cut with equal parts steamed whole milk.', tags: 'Hot, Double Shot', active: true },
        { id: 'c4',  name: 'Oat Milk Latte',           price: 9,  desc: 'Double shot espresso with silky steamed Oatly and a whisper of vanilla.', tags: 'Hot · Iced, Vegan', active: true },
        { id: 'c5',  name: 'Espresso',                 price: 6,  desc: 'Single shot of our house espresso blend.', tags: 'Hot', active: true },
        { id: 'c6',  name: 'Double Espresso',          price: 8,  desc: 'Double shot of our house espresso blend.', tags: 'Hot', active: true },
        { id: 'c7',  name: 'Cappuccino',               price: 9,  desc: 'Double shot with foamed whole milk.', tags: 'Hot', active: true },
        { id: 'c8',  name: 'Flat White',               price: 9,  desc: 'Ristretto shots with micro-foamed whole milk.', tags: 'Hot', active: true },
        { id: 'c9',  name: 'Americano',                price: 7,  desc: 'Double shot espresso with hot water.', tags: 'Hot · Iced', active: true },
        { id: 'c10', name: 'Iced Espresso Tonic',      price: 10, desc: 'Double shot over tonic water with lemon.', tags: 'Iced', active: true },
      ],
      bites: [
        { id: 'b1', name: 'Butter Croissant',      emoji: '🥐', price: 6,  desc: 'Classic French laminated dough, baked golden every morning.', active: true },
        { id: 'b2', name: 'Matcha Financier',      emoji: '🍵', price: 7,  desc: 'Almond flour tea cake with ceremonial matcha and lightly charred edges.', active: true },
        { id: 'b3', name: 'Dark Chocolate Brownie',emoji: '🍫', price: 6,  desc: 'Valrhona 70% chocolate, fudge-dense. Served at room temperature.', active: true },
        { id: 'b4', name: 'Seasonal Fruit Tart',   emoji: '🌸', price: 9,  desc: 'Buttery shortcrust, vanilla custard, peak-season fruit from the farmer\'s market.', active: true },
        { id: 'b5', name: 'Lemon Olive Oil Cake',  emoji: '🍋', price: 8,  desc: 'Light and moist, fragrant with California citrus.', active: true },
        { id: 'b6', name: 'Hojicha Shortbread',    emoji: '🍪', price: 5,  desc: 'House-made buttery shortbread with roasted hojicha and fleur de sel.', active: true },
        { id: 'b7', name: 'Overnight Oat Parfait', emoji: '🥣', price: 10, desc: 'House oats, seasonal compote, granola, and coconut cream.', active: true },
        { id: 'b8', name: 'Avocado Toast',         emoji: '🥑', price: 12, desc: 'Sourdough, smashed avocado, chili flake, microgreens, lemon.', active: true },
      ],
    },
    hours: {
      Monday:    { open: '09:00', close: '00:00', closed: false },
      Tuesday:   { open: '09:00', close: '00:00', closed: false },
      Wednesday: { open: '09:00', close: '00:00', closed: false },
      Thursday:  { open: '09:00', close: '00:00', closed: false },
      Friday:    { open: '09:00', close: '00:00', closed: false },
      Saturday:  { open: '09:00', close: '00:00', closed: false },
      Sunday:    { open: '09:00', close: '00:00', closed: false },
    },
    announcement: { active: false, text: '', type: 'info' },
    bookings: [],
  };

  function load(key) {
    try {
      const raw = localStorage.getItem(KEYS[key]);
      return raw ? JSON.parse(raw) : structuredClone(DEFAULTS[key] ?? null);
    } catch { return structuredClone(DEFAULTS[key] ?? null); }
  }

  function save(key, value) {
    try { localStorage.setItem(KEYS[key], JSON.stringify(value)); } catch {}
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /* ============================================================
     CLOUD SYNC (Supabase) — shared source of truth across devices
     ------------------------------------------------------------
     Until configured, everything runs on localStorage exactly as
     before. Once enabled, bookings / members / inquiries are
     mirrored to Supabase so a booking made on a guest's phone is
     visible to the front desk on any other device.

     SETUP (see the chat instructions): create a free Supabase
     project, run the provided SQL, then paste your Project URL +
     anon key below and set enabled:true.
     ============================================================ */
  const CLOUD = {
    enabled:  true,                      // ← LIVE
    url:      'https://sjjtxzantrvipakliczb.supabase.co',
    anonKey:  'sb_publishable_8CzSzu-9_iox_Q6FlBXhsw_R-Pf2n5m',  // publishable key (safe in browser)
  };

  // localStorage key ↔ Supabase table mapping for the synced collections
  const CLOUD_TABLES = {
    bookings:  'skyla_bookings',
    members:   'skyla_members',
    inquiries: 'skyla_inquiries',
  };

  let _client = null;

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  async function ensureClient() {
    if (!CLOUD.enabled) return null;
    if (_client) return _client;
    if (!window.supabase || !window.supabase.createClient) {
      await loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2');
    }
    _client = window.supabase.createClient(CLOUD.url, CLOUD.anonKey);
    return _client;
  }

  // Pull a whole table from the cloud into the localStorage cache (sync getters read this)
  async function cloudPull(table) {
    if (!CLOUD.enabled) return;
    const c = await ensureClient();
    if (!c) return;
    const { data, error } = await c.from(table).select('data, created_at')
      .order('created_at', { ascending: false });
    if (error) throw error;
    const arr = (data || []).map(r => r.data).filter(Boolean);
    localStorage.setItem(CLOUD_TABLES[table], JSON.stringify(arr));
    return arr;
  }

  // Insert a brand-new record (allowed for the public anon role)
  async function cloudInsert(table, obj) {
    if (!CLOUD.enabled) return;
    try {
      const c = await ensureClient();
      if (!c) return;
      const { error } = await c.from(table).insert({ id: obj.id, data: obj });
      if (error) throw error;
    } catch (e) { console.error(`[cloud] insert into ${table} failed:`, e.message || e); }
  }

  // Update an existing record (admin-only under RLS)
  async function cloudUpdate(table, obj) {
    if (!CLOUD.enabled) return;
    try {
      const c = await ensureClient();
      if (!c) return;
      const { error } = await c.from(table).update({ data: obj }).eq('id', obj.id);
      if (error) throw error;
    } catch (e) { console.error(`[cloud] update ${table} failed:`, e.message || e); }
  }

  async function cloudRemove(table, id) {
    if (!CLOUD.enabled) return;
    try {
      const c = await ensureClient();
      if (!c) return;
      const { error } = await c.from(table).delete().eq('id', id);
      if (error) throw error;
    } catch (e) { console.error(`[cloud] delete from ${table} failed:`, e.message || e); }
  }

  // ── CONFIG SYNC (prices, addons, menu, hours, announcement) ──
  // Public info, so anon may READ; only the admin may write.
  async function cloudPushConfig(key, data) {
    if (!CLOUD.enabled) return;
    try {
      const c = await ensureClient();
      if (!c) return;
      const { error } = await c.from('config').upsert({ key, data });
      if (error) throw error;
    } catch (e) { console.error(`[cloud] config push (${key}) failed:`, e.message || e); }
  }

  async function cloudPullConfig() {
    if (!CLOUD.enabled) return;
    const c = await ensureClient();
    if (!c) return;
    const { data, error } = await c.from('config').select('key, data');
    if (error) throw error;
    (data || []).forEach(row => {
      if (row.key && KEYS[row.key] && row.data != null) {
        localStorage.setItem(KEYS[row.key], JSON.stringify(row.data));
      }
    });
  }

  async function cloudClear(table) {
    if (!CLOUD.enabled) return;
    try {
      const c = await ensureClient();
      if (!c) return;
      const { error } = await c.from(table).delete().neq('id', '___none___');
      if (error) throw error;
    } catch (e) { console.error(`[cloud] clear ${table} failed:`, e.message || e); }
  }

  return {
    /* ── PACKAGES ── */
    getPackages()        { return load('packages'); },
    savePackages(v)      { save('packages', v); cloudPushConfig('packages', v); },

    /* ── ADD-ONS ── */
    getAddons()          { return load('addons'); },
    saveAddons(v)        { save('addons', v); cloudPushConfig('addons', v); },

    /* ── CAFÉ MENU ── */
    getCafeMenu()        { return load('cafeMenu'); },
    saveCafeMenu(v)      { save('cafeMenu', v); cloudPushConfig('cafeMenu', v); },

    /* ── BOOKINGS ── */
    getBookings()        { return load('bookings') || []; },
    addBooking(b) {
      const bookings = this.getBookings();
      b.id        = uid();
      b.createdAt = new Date().toISOString();
      b.status    = b.status || 'confirmed';   // allow 'pending_payment' for crypto
      bookings.unshift(b);
      save('bookings', bookings);
      cloudInsert('bookings', b);          // public insert (no-op if disabled)
      return b;
    },
    updateBooking(id, updates) {
      const bookings = this.getBookings();
      const idx = bookings.findIndex(b => b.id === id);
      if (idx !== -1) {
        bookings[idx] = { ...bookings[idx], ...updates };
        save('bookings', bookings);
        cloudUpdate('bookings', bookings[idx]);   // admin-only update
      }
    },
    deleteBooking(id) {
      const bookings = this.getBookings().filter(b => b.id !== id);
      save('bookings', bookings);
      cloudRemove('bookings', id);
    },
    clearBookings() { save('bookings', []); cloudClear('bookings'); },

    /* ── HOURS ── */
    getHours()           { return load('hours'); },
    saveHours(v)         { save('hours', v); cloudPushConfig('hours', v); },

    /* ── ANNOUNCEMENT ── */
    getAnnouncement()    { return load('announcement'); },
    saveAnnouncement(v)  { save('announcement', v); cloudPushConfig('announcement', v); },

    /* ── PASSWORD ── */
    getPassword()        { return localStorage.getItem(KEYS.password) || 'skyla2026'; },
    savePassword(v)      { localStorage.setItem(KEYS.password, v); },

    /* ── MEMBERS (membership applications) ── */
    getMembers() {
      try { return JSON.parse(localStorage.getItem('skyla_members') || '[]'); }
      catch { return []; }
    },
    addMember(m) {
      const members = this.getMembers();
      m.id        = m.id || uid();
      m.createdAt = m.createdAt || new Date().toISOString();
      m.status    = m.status || 'pending';
      members.unshift(m);
      localStorage.setItem('skyla_members', JSON.stringify(members));
      cloudInsert('members', m);           // public insert
      return m;
    },
    updateMember(id, updates) {
      const members = this.getMembers();
      const idx = members.findIndex(x => x.id === id);
      if (idx !== -1) {
        members[idx] = { ...members[idx], ...updates };
        localStorage.setItem('skyla_members', JSON.stringify(members));
        cloudUpdate('members', members[idx]);    // admin-only update
      }
    },
    deleteMember(id) {
      const members = this.getMembers().filter(x => x.id !== id);
      localStorage.setItem('skyla_members', JSON.stringify(members));
      cloudRemove('members', id);
    },

    /* ── INQUIRIES (experience reservation requests) ── */
    getInquiries() {
      try { return JSON.parse(localStorage.getItem('skyla_inquiries') || '[]'); }
      catch { return []; }
    },
    addInquiry(q) {
      const list = this.getInquiries();
      q.id        = q.id || uid();
      q.createdAt = q.createdAt || new Date().toISOString();
      list.unshift(q);
      localStorage.setItem('skyla_inquiries', JSON.stringify(list));
      cloudInsert('inquiries', q);         // public insert
      return q;
    },

    /* ── CLOUD CONTROL ── */
    cloudEnabled() { return CLOUD.enabled; },
    ensureCloud()  { return ensureClient(); },

    /* ── ADMIN AUTH (Supabase) ── */
    async signIn(email, password) {
      const c = await ensureClient();
      if (!c) throw new Error('Cloud not configured');
      const { data, error } = await c.auth.signInWithPassword({ email, password });
      if (error) throw error;
      return data;
    },
    async signOut() {
      const c = await ensureClient();
      if (c) await c.auth.signOut();
    },
    async getSession() {
      const c = await ensureClient();
      if (!c) return null;
      const { data } = await c.auth.getSession();
      return data?.session || null;
    },
    async updatePassword(newPassword) {
      const c = await ensureClient();
      if (!c) throw new Error('Cloud not configured');
      const { error } = await c.auth.updateUser({ password: newPassword });
      if (error) throw error;
    },
    // Call a Supabase Edge Function (e.g. the Stripe checkout function)
    async invokeFunction(name, body) {
      const c = await ensureClient();
      if (!c) throw new Error('Cloud not configured');
      const { data, error } = await c.functions.invoke(name, { body });
      if (error) throw error;
      return data;
    },
    // Pull the latest from the cloud into the local cache. Call before
    // rendering admin views / front-desk lookups so other devices' data shows.
    async init() {
      if (!CLOUD.enabled) return;
      try {
        await Promise.all([cloudPull('bookings'), cloudPull('members'), cloudPull('inquiries')]);
      } catch (e) { console.error('[cloud] init failed — using local cache:', e.message || e); }
    },
    async refreshBookings() {
      try { await cloudPull('bookings'); } catch (e) { console.error('[cloud] refresh bookings:', e.message || e); }
    },
    async refreshMembers() {
      try { await cloudPull('members'); } catch (e) { console.error('[cloud] refresh members:', e.message || e); }
    },
    // Pull editable config (prices/menu/hours/announcement) from the cloud into the local cache
    async loadConfig() {
      if (!CLOUD.enabled) return;
      try { await cloudPullConfig(); } catch (e) { console.error('[cloud] loadConfig:', e.message || e); }
    },

    /* ── RESET ── */
    resetAll() {
      Object.values(KEYS).forEach(k => localStorage.removeItem(k));
    },
  };
})();

/* ── ANNOUNCEMENT BANNER ── */
function mountAnnouncement() {
  if (window.location.pathname.includes('admin')) return;
  document.querySelectorAll('.site-announcement').forEach(b => b.remove());
  const ann = SkylaData.getAnnouncement();
  if (!ann || !ann.active || !ann.text) return;
  const banner = document.createElement('div');
  banner.className = `site-announcement site-announcement--${ann.type || 'info'}`;
  banner.innerHTML = `<span>${ann.text}</span><button onclick="this.parentElement.remove()" aria-label="Dismiss">✕</button>`;
  document.body.prepend(banner);
}

/* ── BOOTSTRAP: show local config instantly, then refresh from the cloud ── */
mountAnnouncement();
if (SkylaData.cloudEnabled()) {
  SkylaData.loadConfig().then(() => {
    mountAnnouncement();
    // Tell pages (checkout prices, homepage tickets) to re-render with fresh config
    window.dispatchEvent(new CustomEvent('skyla:config'));
  });
}
