// Ready-made playlist templates, personalised with the business name.
import { sb, state, h, q, toast, modal, field, mediaUrl } from '../core.js';
import { newSlide, renderStill } from '../renderer.js';
import { widgetDefaults } from '../widgets.js';

const T = (title, subtitle, extra = {}) => newSlide({ type: 'text', transition: 'none', duration: 8, ...extra,
  text: { title, subtitle, position: 'center', color: '#ffffff', size: 'l', box: false, anim: 'fade-up', ...(extra.text || {}) } });
const W = (type, over = {}) => { const d = widgetDefaults(type); return newSlide({ type, transition: 'none', effect: 'none', duration: d.duration || 10, ...d, ...over,
  widget: { ...d.widget, ...(over.widget || {}) }, text: { ...newSlide().text, title: '', subtitle: '', ...(d.text || {}), ...(over.text || {}) } }); };

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
  { id: 'blank-info', name: 'Simple info screen', desc: 'Three editable text slides to get started fast.',
    build: (n) => [
      T(n, 'Welcome', { bg: GRAD.indigo, text: { size: 'xl' } }),
      T('Your message here', 'Add a line of detail', { bg: GRAD.ocean }),
      T('Another message', 'Edit me in the playlist editor', { bg: GRAD.forest }),
    ] },
];

export function templateGallery(go) {
  const name = h('input', { type: 'text', placeholder: 'Business name, e.g. Bella Pizza', value: state.me?.clients?.find((c) => c.id === state.clientId)?.name || '' });
  const plName = h('input', { type: 'text', value: '', placeholder: 'e.g. Lunch menu', autocomplete: 'off', oninput: () => plName.classList.remove('invalid') });
  let pick = TEMPLATES[0].id;
  const grid = h('div', { class: 'cards', style: { gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: '12px' } });
  const paint = () => grid.replaceChildren(...TEMPLATES.map((t) => {
    const thumb = h('div', { class: 'thumb' });
    renderStill(thumb, t.build(name.value.trim() || 'Your business')[0], null);
    return h('div', { class: 'card screen-card media-item' + (t.id === pick ? ' selected' : ''), style: { cursor: 'pointer' }, onclick: () => { pick = t.id; paint(); } },
      thumb, h('div', { class: 'check' }, '✓'),
      h('div', { class: 'screen-meta' }, h('h3', {}, t.name), h('div', { class: 'tiny' }, t.desc)));
  }));
  name.addEventListener('change', paint);
  paint();
  modal({ title: 'Start from a template', wide: true, body: [h('div', { class: 'grid2' }, field('Playlist name (required)', plName), field('Business name (used in the slides)', name)), grid,
    h('div', { class: 'tiny' }, 'Everything is editable afterwards: text, prices, colours, pictures and timings.')],
  actions: [{ label: 'Cancel' }, { label: 'Create playlist', class: 'primary', onClick: async () => {
    const t = TEMPLATES.find((x) => x.id === pick);
    const pn = plName.value.trim();
    if (!pn) { plName.classList.add('invalid'); plName.focus(); throw new Error('Please give the playlist a name'); }
    const n = name.value.trim() || 'Your business';
    const p = await q(sb.from('playlists').insert({ client_id: state.clientId, name: pn, slides: t.build(n), settings: { orientation: 'landscape' } }).select().single());
    toast('Playlist created from template');
    go('playlist/' + p.id);
  } }] });
}
