// Ready-made playlist templates, personalised with the business name.
import { sb, state, h, q, toast, modal, field, mediaUrl } from '../core.js';
import { newSlide, renderStill, newItem, createStage, layoutWithTicker } from '../renderer.js';
import { widgetDefaults } from '../widgets.js';

const T = (title, subtitle, extra = {}) => newSlide({ type: 'text', transition: 'none', duration: 8, ...extra,
  text: { title, subtitle, position: 'center', color: '#ffffff', size: 'l', box: false, anim: 'fade-up', ...(extra.text || {}) } });
const W = (type, over = {}) => { const d = widgetDefaults(type); return newSlide({ type, transition: 'none', effect: 'none', duration: d.duration || 10, ...d, ...over,
  widget: { ...d.widget, ...(over.widget || {}) }, text: { ...newSlide().text, title: '', subtitle: '', ...(d.text || {}), ...(over.text || {}) } }); };

const Z = (zone, slide) => ({ ...slide, zone, fit: 'stretch' });
const withItems = (slide, ...items) => ({ ...slide, items });
const item = (type, x, y, w, hh, over = {}) => ({ ...newItem(type, widgetDefaults), x, y, w, h: hh, ...over });
const tick = (text, extra = {}) => ({ ticker_on: true, ticker: { text, speed: 'normal', bg: '#3f6fd0', color: '#ffffff', position: 'bottom', size: 'normal', dir: 'rtl', ...extra } });

const GRAD = {
  sunset: 'linear-gradient(135deg,#f97316,#db2777)', indigo: 'linear-gradient(135deg,#1e3a8a,#7c3aed)', ocean: 'linear-gradient(135deg,#0d9488,#2563eb)',
  forest: 'linear-gradient(135deg,#14532d,#65a30d)', graphite: 'linear-gradient(180deg,#111827,#374151)', coffee: 'linear-gradient(180deg,#1c1917,#44403c)',
};

export const TEMPLATES = [
  { id: 'cafe', name: 'Café / restaurant', desc: 'Menu board, today’s special, opening hours and a clock.',
    build: (n) => [
      W('menu', { widget: { title: `${n} — Drinks` }, bg: GRAD.coffee }),
      T('Today’s special', 'Soup of the day with fresh bread — £6.50', { bg: GRAD.sunset, text: { size: 'xl', anim: 'pop' } }),
      W('menu', { bg: GRAD.forest, duration: 12, widget: { title: 'Opening hours', columns: 1, items: [
        { name: 'Monday – Friday', price: '7:00 – 18:00' }, { name: 'Saturday', price: '8:00 – 18:00' }, { name: 'Sunday', price: '9:00 – 16:00' }] } }),
      W('clock'),
    ] },
  { id: 'retail', name: 'Shop promotions', desc: 'Sale headline, offers, loyalty QR code and opening times.',
    build: (n) => [
      T('SALE', 'Up to 50% off selected lines', { bg: GRAD.sunset, text: { size: 'xl', anim: 'pop' } }),
      T('New season arrivals', `Now in store at ${n}`, { bg: GRAD.indigo, transition: 'slide-left', text: { position: 'bottom-left' } }),
      W('qr', { text: { title: 'Join our rewards', subtitle: 'Scan to sign up — 10% off today', color: '#111111' }, widget: { url: 'https://example.com/rewards', caption: 'Scan me' } }),
      W('menu', { bg: GRAD.graphite, widget: { title: 'Opening hours', columns: 1, items: [
        { name: 'Monday – Saturday', price: '9:00 – 18:00' }, { name: 'Sunday', price: '10:00 – 16:00' }] } }),
    ] },
  { id: 'reception', name: 'Reception / welcome', desc: 'Welcome message, clock, weather and Wi-Fi QR code.',
    build: (n) => [
      T(`Welcome to ${n}`, 'Please sign in at reception', { bg: GRAD.indigo, duration: 10, text: { size: 'xl' } }),
      W('clock'),
      W('weather'),
      W('qr', { text: { title: 'Guest Wi-Fi', subtitle: 'Network: GUEST · Scan to connect', color: '#111111' }, widget: { url: 'WIFI:T:WPA;S:GUEST;P:password;;', caption: 'Scan to join' } }),
    ] },
  { id: 'gym', name: 'Gym / leisure', desc: 'Class timetable, motivation, membership offer and clock.',
    build: (n) => [
      W('menu', { bg: GRAD.graphite, widget: { title: 'Today’s classes', columns: 2, items: [
        { name: 'Spin', price: '07:00', desc: 'Studio 1' }, { name: 'HIIT', price: '12:30', desc: 'Studio 2' },
        { name: 'Yoga', price: '18:00', desc: 'Studio 1' }, { name: 'Boxfit', price: '19:15', desc: 'Studio 2' }] } }),
      T('Train hard. Recover harder.', `${n}`, { bg: GRAD.sunset, text: { size: 'l', anim: 'slide-in', position: 'left' } }),
      T('Bring a friend', 'Free day pass for every member referral', { bg: GRAD.ocean, transition: 'zoom-in' }),
      W('clock', { bg: '#000000' }),
    ] },
  { id: 'office', name: 'Office / staff info', desc: 'Announcements, KPIs as a list, weather and clock.',
    build: (n) => [
      T('Team announcement', 'Fire drill on Thursday at 11:00', { bg: GRAD.indigo, text: { position: 'top-left', size: 'l' } }),
      W('menu', { bg: GRAD.graphite, widget: { title: 'This week', columns: 1, items: [
        { name: 'New customers', price: '24' }, { name: 'Tickets closed', price: '312' }, { name: 'Customer rating', price: '4.8 ★' }] } }),
      W('weather'),
      W('clock'),
    ] },
  // ---------- split screens, portrait and widgets on slides ----------
  { id: 'menu-split', tags: ['Split screen', 'Ticker'], name: 'Menu + promotions (split)', desc: 'Menu on the left, rotating offers on the right, ticker along the bottom.',
    settings: { layout: 'split-v', layout_split: { a: 0.5 }, ...tick('Order at the counter     •     Free Wi-Fi: GUEST     •     Ask about today’s specials') },
    build: (n) => [
      Z(0, W('menu', { widget: { title: 'Menu', columns: 1, items: [
        { name: 'Flat white', price: '£3.20' }, { name: 'Cappuccino', price: '£3.40' }, { name: 'Latte', price: '£3.40' },
        { name: 'Bacon roll', price: '£4.50' }, { name: 'Croissant', price: '£2.50' }, { name: 'Soup & bread', price: '£6.50' }] }, bg: GRAD.coffee, duration: 30 })),
      Z(1, T('Meal deal', 'Any sandwich + drink £6.99', { bg: GRAD.sunset, text: { size: 'xl', anim: 'pop' } })),
      Z(1, T('Fresh every morning', `Baked here at ${n}`, { bg: GRAD.forest, text: { anim: 'slide-up' } })),
    ] },
  { id: 'lshape', tags: ['Split screen', 'Ticker'], name: 'Main screen + side panel', desc: 'Big promotions with a side panel for the clock and weather, plus a ticker.',
    settings: { layout: 'side', layout_split: { a: 0.27 }, ...tick(`Welcome to ${'{{n}}'}     •     Open 7 days a week`) },
    build: (n) => [
      Z(0, T(`Welcome to ${n}`, 'Great food, great coffee', { bg: GRAD.indigo, text: { size: 'xl' } })),
      Z(0, T('Happy hour 4 – 6pm', '2-for-1 on all cold drinks', { bg: GRAD.berry, text: { size: 'xl', anim: 'bounce-in' } })),
      Z(1, W('clock', { bg: GRAD.navy, duration: 20 })),
      Z(1, W('weather', { bg: GRAD.ocean, duration: 20 })),
    ] },
  { id: 'reception3', tags: ['Split screen'], name: 'Reception (3 areas)', desc: 'Welcome slides in the large area, clock and weather in the two small ones.',
    settings: { layout: 'main-two', layout_split: { a: 0.68, b: 0.5 } },
    build: (n) => [
      Z(0, T(`Welcome to ${n}`, 'Please sign in at reception', { bg: GRAD.indigo, duration: 12, text: { size: 'xl' } })),
      Z(0, T('Visitor Wi-Fi', 'Network: GUEST · Ask for the password', { bg: GRAD.ocean, duration: 12 })),
      Z(1, W('clock', { bg: GRAD.graphite, duration: 60 })),
      Z(2, W('weather', { bg: GRAD.navy, duration: 60, widget: { days: 0 } })),
    ] },
  { id: 'quad', tags: ['Split screen'], name: 'Four offers (2×2)', desc: 'Four promotions on screen at once, each in its own square.',
    settings: { layout: 'quad' },
    build: () => [
      Z(0, T('SALE', 'Up to 50% off', { bg: GRAD.sunset, text: { size: 'xl', anim: 'flash' } })),
      Z(1, T('New in', 'Spring collection', { bg: GRAD.indigo })),
      Z(2, T('Buy 2 get 1 free', 'On selected lines', { bg: GRAD.forest })),
      Z(3, T('Gift cards', 'Available at the till', { bg: GRAD.gold })),
    ] },
  { id: 'portrait-menu', tags: ['Portrait', 'Split screen'], name: 'Portrait menu tower', desc: 'Tall screen: offer on top, full menu underneath.',
    settings: { orientation: 'portrait', layout: 'split-h', layout_split: { a: 0.38 } },
    build: () => [
      Z(0, T('Today’s special', 'Chicken shawarma wrap £7.50', { bg: GRAD.sunset, text: { size: 'xl', anim: 'pop' } })),
      Z(1, W('menu', { widget: { title: 'Menu', columns: 1, items: [
        { name: 'Wraps', price: 'from £6.50' }, { name: 'Burgers', price: 'from £7.95' }, { name: 'Salads', price: 'from £5.50' },
        { name: 'Sides', price: 'from £2.50' }, { name: 'Soft drinks', price: '£1.80' }] }, bg: GRAD.coffee, duration: 30 })),
    ] },
  { id: 'portrait-poster', tags: ['Portrait', 'Ticker'], name: 'Portrait posters + ticker', desc: 'Tall poster slideshow with a scrolling message at the bottom.',
    settings: { orientation: 'portrait', layout: 'full', ...tick('Open today 9am – 6pm     •     Ask in store about our offers') },
    build: (n) => [
      T(n, 'Welcome in', { bg: GRAD.indigo, text: { size: 'xl', anim: 'drop' } }),
      T('New arrivals', 'This week only', { bg: GRAD.berry, text: { size: 'xl', anim: 'zoom-in' } }),
      T('Follow us', '@yourbusiness', { bg: GRAD.ocean, text: { size: 'l' } }),
    ] },
  { id: 'overlay-promo', tags: ['Widgets on slides'], name: 'Promo with clock & QR', desc: 'Full-screen promotion with a clock in the corner and a QR code you can drag anywhere.',
    settings: { layout: 'full' },
    build: (n) => [
      withItems(T('Big weekend sale', `Everything in store at ${n}`, { bg: GRAD.sunset, duration: 12, text: { size: 'xl', position: 'left', anim: 'slide-in' } }),
        item('clock', 0.66, 0.05, 0.3, 0.15), item('qr', 0.8, 0.58, 0.16, 0.36, { widget: { url: 'https://example.com', caption: 'Scan for deals' }, panel: false })),
    ] },
  { id: 'info-ticker', tags: ['Ticker'], name: 'Notice board + news ticker', desc: 'Announcements with tickers top and bottom.',
    settings: { layout: 'full', ...tick('Fire drill Thursday 11:00', { position: 'both', size: 'small' }), },
    build: () => [
      T('Team announcement', 'Monthly meeting — Friday 2pm, Room 3', { bg: GRAD.navy, text: { position: 'left', size: 'l' } }),
      T('Well done!', 'Record month for customer reviews', { bg: GRAD.forest, text: { size: 'l', anim: 'bounce-in' } }),
    ] },
  { id: 'blank-info', name: 'Simple info screen', desc: 'Three editable text slides to get started fast.',
    build: (n) => [
      T(n, 'Welcome', { bg: GRAD.indigo, text: { size: 'xl' } }),
      T('Your message here', 'Add a line of detail', { bg: GRAD.ocean }),
      T('Another message', 'Edit me in the playlist editor', { bg: GRAD.forest }),
    ] },
];

// A still preview of the whole template: every area with its first slide, plus the ticker.
function templateThumb(t, n) {
  const st = { orientation: 'landscape', layout: 'full', ...(t.settings || {}) };
  const portrait = st.orientation === 'portrait';
  const box = h('div', { class: 'thumb' + (portrait ? ' tall' : '') });
  const slides = t.build(n);
  if (st.layout === 'full' && !st.ticker_on) { renderStill(box, slides[0], null, st.orientation); return box; }
  requestAnimationFrame(() => {
    const host = createStage(box, st.orientation);
    const W = portrait ? 1080 : 1920, H = portrait ? 1920 : 1080;
    const plan = layoutWithTicker(st.layout, W, H, st.ticker_on ? st.ticker : null, st.layout_split);
    plan.zones.forEach(([x, y, w, hh], i) => {
      const s = slides.find((sl) => (sl.zone || 0) === i);
      const z = h('div', { style: { position: 'absolute', left: x + 'px', top: y + 'px', width: w + 'px', height: hh + 'px', overflow: 'hidden', background: '#000' } });
      host.stage.appendChild(z);
      if (s) { const k = 1080 / Math.max(1, Math.min(w, hh)); renderStill(z, s, null, 'landscape', { w: Math.round(w * k), h: Math.round(hh * k) }); }
    });
    plan.tickers.forEach((tk) => {
      const [x, y, w, hh] = tk.rect;
      host.stage.appendChild(h('div', { style: { position: 'absolute', left: x + 'px', top: y + 'px', width: w + 'px', height: hh + 'px', background: st.ticker.bg, color: st.ticker.color,
        display: 'flex', alignItems: 'center', padding: '0 30px', boxSizing: 'border-box', font: `700 ${Math.round(hh * 0.5)}px Inter, system-ui, sans-serif`, whiteSpace: 'nowrap', overflow: 'hidden' } },
        String(st.ticker.text).replace('{{n}}', n)));
    });
  });
  return box;
}

export function templateGallery(go) {
  const name = h('input', { type: 'text', placeholder: 'Business name, e.g. Bella Pizza', value: state.me?.clients?.find((c) => c.id === state.clientId)?.name || '' });
  const plName = h('input', { type: 'text', value: '', placeholder: 'e.g. Lunch menu', autocomplete: 'off', oninput: () => plName.classList.remove('invalid') });
  let pick = null;   // nothing chosen until you click a template (click again to unselect)
  let filter = 'All';
  const FILTERS = ['All', 'Full screen', 'Split screen', 'Portrait', 'Ticker', 'Widgets on slides'];
  const isFull = (t) => !t.settings || (t.settings.layout || 'full') === 'full';
  const shown = () => TEMPLATES.filter((t) => filter === 'All' || (filter === 'Full screen' ? isFull(t) && (t.settings?.orientation || 'landscape') === 'landscape' : (t.tags || []).includes(filter)));
  const tabs = h('div', { class: 'seg', style: { flexWrap: 'wrap' } });
  const grid = h('div', { class: 'cards tpl-grid' });
  const paint = () => {
    const n = name.value.trim() || 'Your business';
    tabs.replaceChildren(...FILTERS.map((f) => h('button', { type: 'button', class: f === filter ? 'on' : '', onclick: () => { filter = f; paint(); } }, f)));
    const list = shown();
    grid.replaceChildren(...list.map((t) => h('div', { class: 'card screen-card media-item' + (t.id === pick ? ' selected' : ''), style: { cursor: 'pointer' }, onclick: () => { pick = pick === t.id ? null : t.id; paint(); } },
      templateThumb(t, n), h('div', { class: 'check' }, '✓'),
      h('div', { class: 'screen-meta' }, h('h3', {}, t.name), h('div', { class: 'tiny' }, t.desc),
        (t.tags || []).length ? h('div', { class: 'row', style: { gap: '4px', marginTop: '4px' } }, ...t.tags.map((g) => h('span', { class: 'badge plain' }, g))) : ''))));
  };
  name.addEventListener('change', paint);
  paint();
  modal({ title: 'Start from a template', wide: true, body: [h('div', { class: 'grid2' }, field('Playlist name (required)', plName), field('Business name (used in the slides)', name)), tabs, grid,
    h('div', { class: 'tiny' }, 'Everything is editable afterwards: text, prices, colours, pictures, layout and timings.')],
  actions: [{ label: 'Cancel' }, { label: 'Create playlist', class: 'primary', onClick: async () => {
    const t = TEMPLATES.find((x) => x.id === pick);
    if (!t) throw new Error('Choose a template first');
    const pn = plName.value.trim();
    if (!pn) { plName.classList.add('invalid'); plName.focus(); throw new Error('Please give the playlist a name'); }
    const n = name.value.trim() || 'Your business';
    const settings = { orientation: 'landscape', ...JSON.parse(JSON.stringify(t.settings || {}).replaceAll('{{n}}', n.replace(/["\\]/g, ''))) };
    const p = await q(sb.from('playlists').insert({ client_id: state.clientId, name: pn, slides: t.build(n), settings }).select().single());
    toast('Playlist created from template');
    go('playlist/' + p.id);
  } }] });
}
