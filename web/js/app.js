import { configured } from './sb.js';
import { startHub, statusDot } from './hub-app.js';
import { sb, state, h, icon, brandMark, wordmark, clientLabel, clientTitle, toast, errMsg, field, refreshMe, setClient, rpc, role, promptBox, passwordToggle } from './core.js';
import { screensPage } from './pages/screens.js';
import { clientsPage } from './pages/clients.js';
import { screenPage } from './pages/screen.js';
import { playlistsPage } from './pages/playlists.js';
import { editorPage } from './pages/editor.js';
import { mediaPage } from './pages/media.js';
import { teamPage } from './pages/team.js';
import { activityPage } from './pages/activity.js';
import { reportsPage } from './pages/reports.js';
import { helpPage } from './pages/help.js';
import { q, timeAgo, modal } from './core.js';

const root = document.getElementById('root');
const APP = window.SIGNAGE_CONFIG?.APP_NAME || 'PROVIEW SIGNAGE';
document.title = 'Proview Signage';

// ------------------------------------------------------------ routing
const routes = [
  [/^screens$/, screensPage, 'screens'],
  [/^screen\/([\w-]+)$/, screenPage, 'screens'],
  [/^playlists$/, playlistsPage, 'playlists'],
  [/^playlist\/([\w-]+)$/, editorPage, 'playlists'],
  [/^media$/, mediaPage, 'media'],
  [/^team$/, teamPage, 'team'],
  [/^activity(\?.*)?$/, activityPage, 'activity'],
  [/^reports$/, reportsPage, 'reports'],
  [/^help$/, helpPage, 'help'],
  [/^clients$/, clientsPage, 'clients'],
];

let cleanup = null, renderSeq = 0;
export function go(path) { location.hash = '#/' + path; }

async function render() {
  const my = ++renderSeq;
  cleanup?.(); cleanup = null;
  const path = location.hash.replace(/^#\/?/, '');

  if (!configured) return root.replaceChildren(setupNeeded());

  const join = path.match(/^join\/(\w+)$/);
  if (join) localStorage.setItem('signage.invite', join[1]);
  const qInvite = new URLSearchParams(location.search).get('invite');
  if (qInvite && /^\w+$/.test(qInvite)) localStorage.setItem('signage.invite', qInvite);

  if (!state.session) return root.replaceChildren(await authPage(join?.[1], path === 'signup'));
  // Password was reset by an admin to a temporary one: choose a new password before anything else.
  if (state.session.user?.app_metadata?.must_change_password) return root.replaceChildren(changePasswordPage());

  // Pending invite (from link or after email confirmation)
  const pending = localStorage.getItem('signage.invite');
  if (pending) {
    try {
      const cid = await rpc('accept_invite', { p_token: pending });
      localStorage.removeItem('signage.invite');
      await refreshMe();
      setClient(cid);
      toast('Invite accepted — welcome!');
      if (join) return go('screens');
    } catch (e) {
      localStorage.removeItem('signage.invite');
      toast(errMsg(e), true);
      if (join) return go('screens');
    }
  }

  if (!state.me) {
    try { await refreshMe(); } catch (e) { return root.replaceChildren(errorPage(e)); }
  }
  // Signed out (or a newer render started) while we were waiting: let that one finish instead.
  if (!state.me || !state.session || my !== renderSeq) return;
  if (!state.me.is_admin && !state.me.clients.length) return root.replaceChildren(setupBusiness());
  // Proview admin: clients and licences are managed at license.proviewcrm.co.uk; with none yet, point there.
  if (state.me.is_admin && !state.me.clients.length) return root.replaceChildren(noClientsYet());
  // Always have a valid business selected (never "none" for someone who belongs to one).
  if (!state.me.clients.some((c) => c.id === state.clientId)) setClient(state.me.clients[0].id);

  let match = null, page = null, section = null;
  for (const [re, fn, sec] of routes) { const m = path.match(re); if (m) { match = m; page = fn; section = sec; break; } }
  if (!page) return go('screens');

  const main = h('main', { class: 'main' });
  root.replaceChildren(shell(section, main));
  main.append(h('div', { class: 'row', style: { gap: '10px', color: '#888' } }, h('div', { class: 'spinner' }), 'Loading…'));
  try {
    const out = await page({ main, params: match.slice(1), go, rerender: render });
    // Navigated away while this page was loading: tidy it up straight away.
    if (my !== renderSeq) { if (typeof out === 'function') out(); return; }
    if (typeof out === 'function') cleanup = out;
  } catch (e) {
    console.error(e);
    main.replaceChildren(errorPage(e));
  }
}
window.addEventListener('hashchange', () => { document.querySelectorAll('.modal-back').forEach((m) => (m._close ? m._close() : m.remove())); render(); });

// ------------------------------------------------------------ shell
function nav(section) {
  const r = role();
  const items = [
    ['screens', 'Screens', 'screens'],
    ['playlists', 'Playlists', 'playlists'],
    ['media', 'Media', 'media'],
    ['reports', 'Reports', 'chart'],
    ['activity', 'Activity', 'activity'],
    ['team', 'Team', 'team'],
  ];
  return { items: state.clientId ? items : [], admin: state.me.is_admin, r, section };
}

function clientPicker() {
  const cs = state.me.clients;
  if (!cs.length) return null;
  if (cs.length === 1 && !state.me.is_admin) return h('div', { class: 'tiny', style: { color: '#9a9aa4', padding: '0 10px 14px' } }, clientTitle(cs[0]));
  const onAll = /^#\/?clients/.test(location.hash);
  const s = h('select', {
    'aria-label': 'Client',
    onchange: (e) => {
      // Proview admins: "All clients" opens the overview of every client
      if (e.target.value === '__all') return go('clients');
      setClient(e.target.value); const p = location.hash.replace(/^#\/?/, '').split('/')[0]; const to = '#/' + (['screen', 'playlist'].includes(p) ? p + 's' : (p && p !== 'clients' ? p : 'screens')); if (location.hash === to) render(); else location.hash = to;
    },
  });
  if (state.me.is_admin) s.append(h('option', { value: '__all', selected: onAll }, `All sites (${cs.length})`));
  for (const c of cs) s.append(h('option', { value: c.id, selected: !onAll && c.id === state.clientId, title: clientLabel(c) }, clientLabel(c)));
  return s;
}

// sidebar footer (same as Proview Employee and Bookings): who's signed in, then COLLAPSE and SIGN OUT
const sideCollapsed = () => localStorage.getItem('signage.sideCollapsed') === '1';
function toggleSide() {
  const on = !sideCollapsed();
  localStorage.setItem('signage.sideCollapsed', on ? '1' : '0');
  document.querySelector('.app')?.classList.toggle('collapsed', on);
}
function sideMe(r) {
  const email = state.me.email || '';
  const name = email.split('@')[0].split(/[._-]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') || state.me.full_name || state.me.name || 'Me';
  const initials = name.replace(/[^\p{L}\p{N}\s._-]/gu,' ').split(/[\s._-]+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?';
  const sub = (state.me.is_admin ? 'Proview admin' : r === 'manager' ? 'Manager' : r === 'admin' ? 'Administrator' : 'Editor') + (state.clientId && state.me.clients.length ? ' · ' + clientTitle(state.me.clients.find((c) => c.id === state.clientId)) : '');
  const canTeam = state.clientId && (state.me.is_admin || r === 'admin' || r === 'manager');
  return h(canTeam ? 'a' : 'div', { class: 'side-me', href: canTeam ? '#/team' : undefined, title: email },
    h('span', { class: 'side-av' }, initials),
    h('span', { class: 'side-me-t' }, h('b', {}, name), h('span', {}, sub)),
    canTeam ? icon('right') : null);
}

const PAGE_TITLES = { clients: 'All clients', screens: 'Screens', playlists: 'Playlists', media: 'Media', reports: 'Reports', activity: 'Activity', team: 'Team', help: 'Help' };
function shell(section, main) {
  const n = nav(section);
  const link = (key, label, ic) => h('a', { href: '#/' + key, class: section === key ? 'active' : '' }, icon(ic), h('span', {}, label));

  const meEl = sideMe(n.r);
  const side = h('aside', { class: 'side' },
    h('div', { class: 'brand' }, brandMark(), wordmark(APP)),
    h('div', { class: 'client-pick' }, (() => { const p = clientPicker(); return p && p.tagName === 'SELECT' ? [h('label', { class: 'pv-viewing' }, /^#\/?clients/.test(location.hash) ? 'Master view' : 'Viewing site'), p] : p; })()),
    h('nav', { class: 'nav' },
      // group headers, same style as Proview Bookings (Service / Grow / Team / Manage)
      n.items.length ? h('div', { class: 'nav-sep' }, 'Content') : null,
      n.items.filter(([k]) => ['screens', 'playlists', 'media'].includes(k)).map(([k, l, i]) => link(k, l, i)),
      n.items.length ? h('div', { class: 'nav-sep' }, 'Insights') : null,
      n.items.filter(([k]) => ['reports', 'activity'].includes(k)).map(([k, l, i]) => link(k, l, i)),
      n.items.some(([k]) => k === 'team') ? h('div', { class: 'nav-sep' }, 'Manage') : null,
      n.items.filter(([k]) => ['team'].includes(k)).map(([k, l, i]) => link(k, l, i))),
    meEl,
    h('div', { class: 'side-foot' },
      h('button', { class: 'sf-link', title: 'Collapse menu', 'aria-label': 'Collapse menu', onclick: toggleSide }, icon('left'), h('span', { class: 'lbl' }, 'COLLAPSE')),
      h('button', { class: 'sf-link', title: 'Sign out', 'aria-label': 'Sign out', style: { marginLeft: 'auto' }, onclick: signOut }, icon('logout'), h('span', { class: 'lbl' }, 'SIGN OUT'))));

  // header bar (same as Proview Bookings and Employee): menu button on phones, page title, notifications, help
  const toggleNav = () => document.querySelector('.app')?.classList.toggle('navopen');
  const avTxt = meEl.querySelector('.side-av')?.textContent || '?';
  const meTitle = [meEl.querySelector('.side-me-t b')?.textContent, meEl.querySelector('.side-me-t span')?.textContent].filter(Boolean).join(' · ');
  const topMe = h('div', { class: 'top-me' },
    h('button', { class: 'top-av', title: meTitle, 'aria-label': 'My account', onclick: () => meEl.click() }, avTxt),
    h('button', { class: 'icon-btn top-out', title: 'Sign out', 'aria-label': 'Sign out', onclick: signOut }, icon('logout')));
  const top = h('header', { class: 'top' },
    h('button', { class: 'icon-btn menu-btn', 'aria-label': 'Open menu', title: 'Menu', onclick: toggleNav }, icon('menu')),
    h('h2', {}, PAGE_TITLES[section] || ''),
    h('div', { class: 'sp' }),
    h('span', { class: 'top-pick' }, clientPicker()),
    window.PVHub ? window.PVHub.tray({ dot: statusDot(), bell: bell('icon') }) : bell('icon'),
    // back to dashboard.proviewcrm.co.uk: managers and admins only (editors don't get it)
    (window.PVHub && window.PVHub.dashLink && window.PVHub.dashLink(['admin', 'manager'].includes(role()))) || null,
    topMe);
  startHub(go);
  const scrim = h('div', { class: 'nav-scrim', onclick: toggleNav });
  return h('div', { class: 'app' + (sideCollapsed() ? ' collapsed' : '') }, side, h('div', { class: 'main-col' }, top, main), scrim);
}

// ------------------------------------------------------------ notifications bell
// Notifications: one shared loader feeds the sidebar row and the mobile top-bar button.
const bellViews = new Set();
let bellItems = [];
function bellKey() { return 'signage.notif.read.' + state.me.user_id; }
function paintBells() {
  const last = localStorage.getItem(bellKey()) || '';
  const unread = bellItems.filter((n) => n.created_at > last).length;
  for (const dot of bellViews) {
    dot.textContent = unread > 9 ? '9+' : String(unread);
    dot.classList.toggle('hidden', !unread);
  }
}
async function loadBells() {
  try {
    let qry = sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(60);
    if (!state.me.is_admin && state.clientId) qry = qry.eq('client_id', state.clientId);
    bellItems = await q(qry);
    paintBells();
  } catch {}
}
function openNotifications() {
  localStorage.setItem(bellKey(), new Date().toISOString());
  paintBells();
  const names = Object.fromEntries(state.me.clients.map((c) => [c.id, c.name]));
  const ico = { offline: '🔴', online: '🟢', licence_14d: '🟡', licence_3d: '🟠', licence_expired: '⛔', payment: '💳' };
  modal({ title: 'Notifications', body: [bellItems.length ? h('div', { class: 'list' }, bellItems.map((n) => h('div', { class: 'list-row', style: { cursor: n.screen_id ? 'pointer' : 'default' },
    onclick: () => { if (n.screen_id && n.client_id) { setClient(n.client_id); document.querySelector('.modal-back')?.remove(); go('screen/' + n.screen_id); } } },
    h('div', { style: { width: '22px' } }, ico[n.kind] || '•'),
    h('div', { class: 'grow' }, h('div', { style: { fontWeight: 600 } }, n.title), h('div', { class: 'tiny' }, [n.body, state.me.is_admin && names[n.client_id]].filter(Boolean).join(' · '))),
    h('span', { class: 'tiny' }, timeAgo(n.created_at)))))
    : h('p', { class: 'muted' }, 'No notifications yet. You’ll see offline TVs, licence reminders and payments here.')] });
}
/** variant 'row' = sidebar menu row, 'icon' = mobile top-bar button */
function bell(variant = 'row') {
  const dot = h('span', { class: 'bell-dot hidden' });
  if (variant === 'row') for (const d of bellViews) if (!d.isConnected) bellViews.delete(d);   // new page: drop old badges
  bellViews.add(dot);
  const el = variant === 'row'
    ? h('a', { href: 'javascript:void 0', class: 'bell-row', onclick: (e) => { e.preventDefault(); openNotifications(); } }, icon('bell'), h('span', {}, 'Notifications'), dot)
    : h('button', { class: 'btn ghost icon bell', title: 'Notifications', 'aria-label': 'Notifications', onclick: openNotifications }, icon('bell'), dot);
  if (variant === 'row' || !window.__bellTimer) { loadBells(); clearInterval(window.__bellTimer); window.__bellTimer = setInterval(loadBells, 60000); }
  else { for (const d of bellViews) if (!d.isConnected && d !== dot) bellViews.delete(d); paintBells(); }
  return el;
}

async function signOut() {
  await sb.auth.signOut();
  state.me = null;
  location.hash = '';
}

// ------------------------------------------------------------ auth
// Where the "confirm your email" link sends people (keeps the invite, even on another device).
function confirmUrl() {
  const inv = localStorage.getItem('signage.invite');
  return location.origin + location.pathname + (inv ? `?invite=${inv}` : '');
}

// Sign-in left panel art: the shop screen designs from the website (pizza, takeaway, barber, clothing)
function signageArt() {
  const d = document.createElement('div');
  d.style.display = 'contents';
  d.innerHTML = `<div class="pva pva-shop" aria-hidden="true"><div class="col"><div class="dv land"><div class="scr"><div class="pz">
  <div class="hd"><b>Tonight's deals</b><span>PIZZA · GRILL · WRAPS</span></div>
  <div class="cards">
    <div class="cd"><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="46" fill="#e7a54a"/><circle cx="50" cy="50" r="38" fill="#d9472b"/><circle cx="50" cy="50" r="36" fill="#f6d36b" opacity=".85"/><g fill="#b3261e"><circle cx="36" cy="34" r="7"/><circle cx="64" cy="38" r="7"/><circle cx="46" cy="62" r="7"/><circle cx="68" cy="64" r="6"/><circle cx="30" cy="56" r="5"/></g><g stroke="#3b7d2f" stroke-width="3" stroke-linecap="round"><path d="M54 24l4 3M24 44l3 4M58 78l4-2"/></g></svg><h6>Any large pizza</h6><p>Plus 2 sides of your choice</p><div class="pr">£14.99</div></div>
    <div class="cd hot"><svg viewBox="0 0 100 100" aria-hidden="true"><path d="M14 40h72v44H14z" fill="#c98a4b"/><path d="M14 40l12-16h48l12 16z" fill="#e0a466"/><rect x="34" y="52" width="32" height="16" rx="3" fill="#c1272d"/><path d="M14 40h72" stroke="#8a5a2c" stroke-width="2"/></svg><h6>Family box</h6><p>2 large pizzas, wings, fries &amp; 1.5L drink</p><div class="pr">£24.99</div></div>
    <div class="cd"><svg viewBox="0 0 100 100" aria-hidden="true"><path d="M30 86 58 14l22 10-26 70z" fill="#f2d79b"/><path d="M58 14l22 10-6 14-22-10z" fill="#7cc142"/><path d="M52 28l22 10-4 9-22-10z" fill="#d9472b"/><path d="M30 86l24 8 6-16-24-8z" fill="#fff" opacity=".9"/></svg><h6>Wrap meal</h6><p>Chicken or falafel wrap, fries &amp; can</p><div class="pr">£7.49</div></div>
  </div>
  <div class="tk"><div class="tr"><span>Free delivery over £20</span><span>Collection in 15 minutes</span><span>Order online for collection</span><span>Free delivery over £20</span><span>Collection in 15 minutes</span><span>Order online for collection</span></div></div>
</div></div></div><div class="dv land"><div class="scr"><div class="tw">
  <div class="promo">
    <div class="cyc"><div class="tag">Meal deal</div><div class="h">Smash burger, fries &amp; drink</div><div class="d">Double patty, cheese, house sauce</div><div class="burst"><div><small>ONLY</small>£6.99</div></div><svg class="art" viewBox="0 0 200 170" aria-hidden="true"><path d="M20 72c0-38 36-60 80-60s80 22 80 60z" fill="#e9a24a"/><g fill="#fff3d6"><ellipse cx="70" cy="38" rx="4" ry="2.4"/><ellipse cx="100" cy="28" rx="4" ry="2.4"/><ellipse cx="130" cy="40" rx="4" ry="2.4"/><ellipse cx="88" cy="50" rx="4" ry="2.4"/><ellipse cx="118" cy="56" rx="4" ry="2.4"/></g><path d="M14 80q14 14 28 0t28 0 28 0 28 0 28 0 28 0 28 0v8H14z" fill="#7cc142"/><path d="M28 86h144l-20 26-26-18-24 22-26-22-26 18z" fill="#ffc93c"/><rect x="16" y="90" width="168" height="26" rx="13" fill="#5a2e1b"/><path d="M22 124h156a0 0 0 0 1 0 0c0 18-22 30-78 30S22 142 22 124z" fill="#d98c3a"/></svg></div>
    <div class="cyc"><div class="tag">Every Friday</div><div class="h">Loaded fries</div><div class="d">Cheese, jalapeños &amp; crispy onions</div><div class="burst"><div><small>NOW</small>£3.49</div></div><svg class="art" viewBox="0 0 200 170" aria-hidden="true"><g fill="#ffd34d"><rect x="58" y="20" width="12" height="80" rx="3" transform="rotate(-10 64 60)"/><rect x="76" y="10" width="12" height="90" rx="3" transform="rotate(-4 82 55)"/><rect x="94" y="6" width="12" height="94" rx="3"/><rect x="112" y="10" width="12" height="90" rx="3" transform="rotate(5 118 55)"/><rect x="130" y="20" width="12" height="80" rx="3" transform="rotate(11 136 60)"/></g><path d="M44 70h112l-14 92H58z" fill="#d7261e"/><path d="M44 70q56 26 112 0" fill="#b51c15"/><circle cx="100" cy="120" r="16" fill="#ffcc29"/></svg></div>
    <div class="cyc"><div class="tag">New in</div><div class="h">Thick shakes</div><div class="d">Strawberry, Oreo-style cookie or vanilla</div><div class="burst"><div><small>FROM</small>£3.99</div></div><svg class="art" viewBox="0 0 200 170" aria-hidden="true"><rect x="110" y="0" width="9" height="60" rx="4" fill="#ff5a7a" transform="rotate(14 114 30)"/><path d="M62 40c0-20 76-20 76 0v8H62z" fill="#fff"/><circle cx="100" cy="24" r="9" fill="#d7261e"/><path d="M58 50h84l-12 112H70z" fill="#f6a5c0"/><path d="M58 50h84l-2 18H60z" fill="#fff" opacity=".6"/><rect x="66" y="98" width="68" height="16" fill="#fff" opacity=".85"/></svg></div>
  </div>
  <div class="menu">
    <h5>Burgers <em>HALAL</em></h5>
    <div class="mi"><span>Classic smash</span><b>£5.49</b></div>
    <div class="mi"><span>Double cheese</span><b>£6.99</b></div>
    <div class="mi"><span>Spicy chicken</span><b>£5.99</b></div>
    <div class="mi"><span>Veggie stack</span><b>£5.49</b></div>
    <h5>Sides</h5>
    <div class="mi"><span>Fries · regular</span><b>£2.49</b></div>
    <div class="mi"><span>6 hot wings</span><b>£3.99</b></div>
    <h5>Drinks</h5>
    <div class="mi"><span>Cans · 330ml</span><b>£1.20</b></div>
    <div class="mi"><span>Thick shake</span><b>£3.99</b></div>
  </div>
  <div class="tk" style="grid-column:1/-1"><div class="tr"><span>Order at the counter</span><span>Open till 2am, Fri &amp; Sat</span><span>Delivery available</span><span>Student deals with valid ID</span><span>Order at the counter</span><span>Open till 2am, Fri &amp; Sat</span><span>Delivery available</span><span>Student deals with valid ID</span></div></div>
</div></div></div></div><div class="dv port"><div class="scr"><div class="bb">
  <div class="top"><div class="pole" aria-hidden="true"></div><div class="name">The Cut Club<small>Barbers · est. 2014</small></div><div class="clk js-clock">10:24</div></div>
  <div class="list">
    <div class="row"><span>Skin fade</span><i></i><b>£18</b></div>
    <div class="row"><span>Classic cut</span><i></i><b>£15</b></div>
    <div class="row"><span>Scissor cut</span><i></i><b>£20</b></div>
    <div class="row"><span>Beard trim<small>Line-up &amp; shape</small></span><i></i><b>£8</b></div>
    <div class="row"><span>Hot towel shave</span><i></i><b>£20</b></div>
    <div class="row"><span>Kids · under 12</span><i></i><b>£12</b></div>
  </div>
  <div class="card">
    <div class="cyc c1"><div><div class="big">Walk-ins welcome</div><div class="sm">Average wait today: 15 min</div></div></div>
    <div class="cyc c2"><div class="qr" aria-hidden="true"><i></i><i></i><i></i><i class="o"></i><i></i><i></i><i></i><i></i><i class="o"></i><i></i><i class="o"></i><i></i><i class="o"></i><i></i><i></i><i></i><i></i><i class="o"></i><i></i><i></i><i></i><i class="o"></i><i></i><i class="o"></i><i></i><i class="o"></i><i></i><i class="o"></i><i></i><i></i><i class="o"></i><i></i><i></i><i class="o"></i><i></i><i class="o"></i><i></i><i></i><i class="o"></i><i></i><i></i><i class="o"></i><i></i><i class="o"></i><i></i><i></i><i class="o"></i><i></i><i></i></div><div><div class="big">Book online</div><div class="sm">Scan to skip the queue</div></div></div>
  </div>
</div></div></div><div class="dv port cl-dv"><div class="scr"><div class="cl">
  <div class="cyc s1"><div class="brand">Northline</div><div><div class="h">Autumn edit</div><div class="p" style="margin-top:3cqw">New season, now in store</div></div><svg class="hanger" viewBox="0 0 200 120" aria-hidden="true" fill="none" stroke="#2b2118" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="M100 44v-8c0-6 10-8 10-18a10 10 0 0 0-20 0"/><path d="M100 44 12 96h176z"/><path d="M38 96v20h124V96" stroke="#c2410c"/></svg><div class="p"><b>Knitwear from £29</b></div></div>
  <div class="cyc s2"><div class="brand">Northline</div><div class="h">Up to 50% off</div><div class="tagw"><div class="pricetag">Denim</div></div><div class="p">Selected jeans &amp; jackets, this week only</div></div>
  <div class="cyc s3"><div class="brand">Northline</div><div class="h">Members get 10% off</div><div class="p">Join free at the till and save today</div></div>
  <div class="tk"><div class="tr"><span>Free alterations</span><span>Click &amp; collect</span><span>Returns within 28 days</span><span>Free alterations</span><span>Click &amp; collect</span><span>Returns within 28 days</span></div></div>
</div></div></div></div>`;
  return d;
}

// "Sign in with Proview account" (managers and admins; one login across Proview apps)
const PV_ACCOUNT = 'https://dashboard.proviewcrm.co.uk/';
let pvErr = '';
async function pvSso(token) {
  const cfg = window.SIGNAGE_CONFIG || {};
  const r = await fetch(cfg.SUPABASE_URL + '/functions/v1/sso-login', { method: 'POST', headers: { 'content-type': 'application/json', apikey: cfg.SUPABASE_ANON_KEY }, body: JSON.stringify({ assertion: token }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.token_hash) throw new Error(j.error || 'Sign-in with your Proview account failed. Please try again.');
  const cur = (await sb.auth.getSession()).data.session?.user;
  if (cur && String(cur.email || '').toLowerCase() !== j.email) await sb.auth.signOut();
  const { error } = await sb.auth.verifyOtp({ token_hash: j.token_hash, type: 'magiclink' });
  if (error) throw error;
}

const AUTH_LOOK = 'classic';   // original design; 'glow' | 'wall' | 'hero' also available
async function authPage(inviteToken, startSignup = false) {
  let invite = null;
  if (inviteToken) { try { invite = (await sb.rpc('invite_info', { p_token: inviteToken })).data; } catch {} }
  let mode = (invite && !invite.used) || startSignup ? 'signup' : 'signin';
  // Coming back from the "confirm your email" link?
  const qs = new URLSearchParams(location.search);
  const cameBack = qs.has('code') || qs.has('invite') || qs.has('error_description');
  const linkError = qs.get('error_description');
  if (cameBack) { history.replaceState(null, '', location.pathname + location.hash); if (!linkError) mode = 'signin'; }
  const rememberedEmail = localStorage.getItem('signage.signupEmail') || '';

  const email = h('input', { type: 'email', required: true, autocomplete: 'email', value: invite?.email || (cameBack ? rememberedEmail : '') || '', placeholder: 'you@company.com' });
  const pass = h('input', { type: 'password', required: true, minLength: 8, autocomplete: 'current-password', placeholder: '••••••••' });
  const pass2 = h('input', { type: 'password', minLength: 8, autocomplete: 'new-password', placeholder: 'Type it again' });
  const matchMsg = h('div', { class: 'pw-match' });
  const checkMatch = () => {
    if (!pass2.value) { matchMsg.textContent = ''; return; }
    const ok = pass.value === pass2.value;
    matchMsg.textContent = ok ? '✓ Passwords match' : 'Passwords don’t match yet';
    matchMsg.className = 'pw-match ' + (ok ? 'ok' : 'bad');
  };
  pass.addEventListener('input', checkMatch); pass2.addEventListener('input', checkMatch);
  const passField = field('Password', passwordToggle(pass), '');
  const pass2Field = field('Confirm password', h('div', {}, passwordToggle(pass2), matchMsg));
  const msg = h('div');
  const submit = h('button', { class: 'btn primary', type: 'submit' });
  const title = h('h1');
  const sub = h('p', { class: 'muted', style: { margin: 0 } });
  const swap = h('button', { class: 'btn ghost sm', type: 'button' });
  const pvRow = h('div', { class: 'stack', style: { gap: '12px' } },
    h('div', { style: { display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--muted)', fontSize: '13px' } },
      h('span', { style: { flex: 1, height: '1px', background: 'var(--line)' } }), 'or', h('span', { style: { flex: 1, height: '1px', background: 'var(--line)' } })),
    h('button', { class: 'btn', type: 'button', onclick: () => { location.href = PV_ACCOUNT + '?app=signage&return=' + encodeURIComponent(location.origin + location.pathname); } }, 'Sign in with Proview account'));
  const forgot = h('button', { class: 'btn ghost sm', type: 'button', onclick: async () => {
    if (!email.value) return toast('Enter your email first', true);
    const { error } = await sb.auth.resetPasswordForEmail(email.value, { redirectTo: location.origin + location.pathname });
    error ? toast(errMsg(error), true) : toast('Password reset email sent');
  } }, 'Forgot password?');

  const paint = () => {
    title.textContent = mode === 'signup' ? 'Create your account' : 'Sign in';
    sub.textContent = invite && !invite.used
      ? `You've been invited to manage screens for ${invite.client} as ${invite.role === 'manager' ? 'a manager' : 'an editor'}.`
      : mode === 'signup' ? 'Start your free 3-day trial on 1 screen. No card needed. Invited by someone? Use the email address your invite was sent to.' : 'Manage your screens, media and schedules.';
    submit.textContent = mode === 'signup' ? 'Create account' : 'Sign in';
    swap.textContent = mode === 'signup' ? 'I already have an account' : 'Create an account';
    pass.autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
    pass.placeholder = mode === 'signup' ? 'At least 8 characters' : '••••••••';
    pass.minLength = mode === 'signup' ? 8 : 1; // older accounts may have shorter passwords
    pass2Field.classList.toggle('hidden', mode !== 'signup');
    pass2.required = mode === 'signup';
    pass2.value = ''; checkMatch();
    forgot.classList.toggle('hidden', mode === 'signup');
    pvRow.classList.toggle('hidden', mode === 'signup');
    msg.replaceChildren();
  };
  // After sign-up: a clear "check your email" panel with the next steps.
  const showCheckEmail = (addr) => {
    const resend = h('button', { class: 'btn sm', type: 'button', onclick: async () => {
      resend.disabled = true;
      const { error } = await sb.auth.resend({ type: 'signup', email: addr, options: { emailRedirectTo: confirmUrl() } });
      error ? toast(errMsg(error), true) : toast('Confirmation email sent again');
      setTimeout(() => (resend.disabled = false), 30000);
    } }, 'Send the email again');
    msg.replaceChildren(h('div', { class: 'notice ok stack', style: { gap: '8px' } },
      h('div', { style: { fontWeight: 700 } }, '✓ Account created — check your email'),
      h('div', {}, `We've sent a confirmation link to ${addr}. Click it and you'll come straight back here, signed in. If you open it on another device, just sign in below with your password.`),
      h('div', { class: 'row', style: { gap: '8px' } }, resend)));
  };
  swap.onclick = () => { mode = mode === 'signup' ? 'signin' : 'signup'; paint(); };
  paint();
  if (cameBack && linkError) msg.replaceChildren(h('div', { class: 'notice bad' }, `That link didn't work: ${linkError}. Sign in below, or use “Forgot password?”.`));
  else if (cameBack) msg.replaceChildren(h('div', { class: 'notice ok' }, '✓ Email confirmed. Sign in with your password to continue.'));
  if (pvErr) { msg.replaceChildren(h('div', { class: 'notice' }, pvErr)); pvErr = ''; }

  // Unknown email on the sign-in form: offer to create an account instead of failing silently.
  let prompting = false, lastChecked = '';
  function noAccountPrompt(addr) {
    if (prompting) return; prompting = true;
    modal({
      title: 'This email doesn’t exist',
      compact: true,
      body: [h('p', {}, 'We couldn’t find an account for', h('br'), h('b', { class: 'nm-email' }, addr.toLowerCase())),
        h('p', {}, 'Would you like to create a new account?'),
        h('p', { class: 'nm-note' }, 'Includes a free 3-day trial on 1 screen.')],
      onClose: () => { prompting = false; },
      actions: [
        { label: 'No, go back', onClick: () => { pass.value = ''; msg.replaceChildren(h('div', { class: 'notice' }, 'Check the email address and try again.')); setTimeout(() => email.focus(), 50); } },
        { label: 'Yes, create a new account', class: 'primary', onClick: () => {
          const typed = pass.value;
          mode = 'signup'; paint();
          email.value = addr; pass.value = typed; pass2.value = '';
          msg.replaceChildren(h('div', { class: 'notice info' }, typed.length >= 8 ? 'Type your password again to confirm it, then press Create account.' : 'Choose a password (at least 8 characters), then press Create account.'));
          setTimeout(() => (typed.length >= 8 ? pass2 : pass).focus(), 50);
        } },
      ],
    });
  }

  email.addEventListener('change', async () => {
    const addr = email.value.trim();
    if (mode !== 'signin' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr) || addr.toLowerCase() === lastChecked) return;
    lastChecked = addr.toLowerCase();
    try {
      const { data: exists, error } = await sb.rpc('email_has_account', { p_email: addr });
      if (!error && exists === false && mode === 'signin' && email.value.trim().toLowerCase() === lastChecked) noAccountPrompt(addr);
    } catch {}
  });

  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      submit.disabled = true;
      msg.replaceChildren();
      try {
        if (mode === 'signup') {
          if (pass.value.length < 8) throw new Error('Use at least 8 characters for your password.');
          if (pass.value !== pass2.value) { pass2.focus(); throw new Error('The two passwords don’t match. Please type them again.'); }
          const addr = email.value.trim();
          const { data, error } = await sb.auth.signUp({ email: addr, password: pass.value, options: { emailRedirectTo: confirmUrl() } });
          if (error) throw error;
          if (!data.session) {
            localStorage.setItem('signage.signupEmail', addr);
            mode = 'signin'; paint(); showCheckEmail(addr);
            submit.disabled = false; return;
          }
        } else {
          const addr = email.value.trim();
          const { error } = await sb.auth.signInWithPassword({ email: addr, password: pass.value });
          if (error) {
            // Supabase gives the same answer for "no such account" and "wrong password": ask which it is.
            if (/invalid login credentials/i.test(error.message || '')) {
              const { data: exists, error: e2 } = await sb.rpc('email_has_account', { p_email: addr });
              if (!e2 && exists === false) { submit.disabled = false; return noAccountPrompt(addr); }
              if (!e2 && exists === true) throw new Error('That password isn’t right. Try again, or press “Forgot password?” to reset it.');
            }
            throw error;
          }
        }
      } catch (err) {
        msg.replaceChildren(h('div', { class: 'notice' }, errMsg(err)));
      }
      submit.disabled = false;
    },
  }, h('div', { class: 'auth-brand' }, h('img', { class: 'auth-logo', src: 'logo.png', alt: '' }), wordmark(APP)),
    title, sub, msg, field('Email', email), passField, pass2Field, submit, pvRow,
    h('div', { class: 'row between' }, swap, forgot));

  // Sign-in page design: 'glow' | 'wall' | 'hero' (?look=… to preview another)
  const look = new URLSearchParams(location.search).get('look') || AUTH_LOOK;
  return h('div', { class: 'auth look-' + look },
    h('div', { class: 'auth-bg', 'aria-hidden': 'true' }, ...Array.from({ length: 10 }, (_, i) => h('i', { class: 't' + i }))),
    h('div', { class: 'auth-art' },
      h('img', { class: 'auth-art-logo', src: 'logo.png', alt: '' }),
      h('div', { class: 'brand', style: { padding: 0 } }, brandMark(), wordmark(APP)),
      h('h2', {}, 'Every screen, every offer — changed in seconds.'),
      signageArt(),
      h('div', { class: 'muted', style: { color: '#9a9aa4' } }, 'Upload, build slides, schedule and publish to your TVs.')),
    h('div', { class: 'auth-form' }, form));
}

function changePasswordPage() {
  const until = state.session.user.app_metadata.temp_password_until;
  if (until && new Date(until) < new Date()) {
    sb.auth.signOut();
    toast('That temporary password has expired. Ask your administrator to reset it again.', true);
    return h('div');
  }
  const pass = h('input', { type: 'password', required: true, minLength: 8, autocomplete: 'new-password', placeholder: 'At least 8 characters' });
  const pass2 = h('input', { type: 'password', required: true, minLength: 8, autocomplete: 'new-password', placeholder: 'Type it again' });
  const msg = h('div');
  const submit = h('button', { class: 'btn primary', type: 'submit', style: { width: '100%' } }, 'Save new password');
  const form = h('form', { class: 'stack', style: { maxWidth: '400px', width: '100%' }, onsubmit: async (e) => {
    e.preventDefault();
    msg.replaceChildren();
    if (pass.value !== pass2.value) return msg.replaceChildren(h('div', { class: 'notice bad' }, 'The two passwords don’t match.'));
    if (pass.value === '123456') return msg.replaceChildren(h('div', { class: 'notice bad' }, 'Choose a password of your own, not the temporary one.'));
    submit.disabled = true;
    try {
      const { error } = await sb.auth.updateUser({ password: pass.value });
      if (error) throw error;
      const { data } = await sb.auth.refreshSession();   // fresh login token without the "must change" flag
      if (data?.session) state.session = data.session;
      if (state.session?.user?.app_metadata) delete state.session.user.app_metadata.must_change_password;
      toast('Password saved. Welcome back!');
      render();
    } catch (err) { msg.replaceChildren(h('div', { class: 'notice bad' }, errMsg(err))); submit.disabled = false; }
  } },
    h('img', { src: 'logo.png', alt: 'PROVIEW', style: { height: '56px', alignSelf: 'center' } }),
    h('h1', { style: { textAlign: 'center', margin: '6px 0 0' } }, 'Choose a new password'),
    h('p', { class: 'muted', style: { textAlign: 'center', margin: 0 } }, `Your password was reset by an administrator. Set a new one for ${state.session.user.email} to continue.`),
    field('New password', passwordToggle(pass)),
    field('Confirm new password', passwordToggle(pass2)),
    msg, submit,
    h('button', { class: 'btn ghost', type: 'button', onclick: signOut }, 'Sign out'));
  return h('div', { class: 'auth-form', style: { minHeight: '100vh' } }, form);
}

// New sign-up with no business yet: create one and start the free trial.
function setupBusiness() {
  const name = h('input', { type: 'text', required: true, maxLength: 80, autocomplete: 'organization', placeholder: 'e.g. Station Road Café' });
  const phone = h('input', { type: 'tel', maxLength: 30, autocomplete: 'tel', placeholder: 'Optional, so we can help you get set up' });
  const msg = h('div');
  const submit = h('button', { class: 'btn primary', type: 'submit', style: { width: '100%' } }, 'Start my free trial');
  const form = h('form', { class: 'stack', style: { maxWidth: '440px', width: '100%' }, onsubmit: async (e) => {
    e.preventDefault(); msg.replaceChildren(); submit.disabled = true;
    try {
      await rpc('create_my_business', { p_name: name.value, p_phone: phone.value || null });
      await refreshMe();
      toast('Welcome! Now pair your TV to start your 3-day trial.');
      location.hash = '#/screens'; render();
    } catch (err) { msg.replaceChildren(h('div', { class: 'notice bad' }, errMsg(err))); submit.disabled = false; }
  } },
    h('img', { src: 'logo.png', alt: 'PROVIEW', style: { height: '56px', alignSelf: 'center' } }),
    h('h1', { style: { textAlign: 'center', margin: '6px 0 0' } }, 'Set up your business'),
    h('p', { class: 'muted', style: { textAlign: 'center', margin: 0 } }, `Signed in as ${state.me.email}. Your free trial includes 1 screen for 3 days, with every feature.`),
    msg, field('Business name', name), field('Phone number', phone), submit,
    h('p', { class: 'tiny', style: { textAlign: 'center', margin: 0 } }, 'Were you invited to someone else’s account? Open the invite link from your email instead.'),
    h('div', { style: { textAlign: 'center' } }, h('button', { class: 'btn ghost sm', type: 'button', onclick: signOut }, 'Sign out')));
  setTimeout(() => name.focus(), 50);
  return h('div', { class: 'auth-form', style: { minHeight: '100vh' } }, form);
}

function noClientsYet() {
  return h('div', { class: 'auth-form', style: { minHeight: '100vh' } },
    h('div', { class: 'stack', style: { maxWidth: '440px', textAlign: 'center' } },
      h('h1', {}, 'No clients yet'),
      h('p', { class: 'muted' }, 'Add clients, sites and licences in the Proview licence portal, then come back here.'),
      h('div', { class: 'row', style: { justifyContent: 'center', gap: '8px' } },
        h('a', { class: 'btn primary', href: 'https://license.proviewcrm.co.uk', target: '_blank', rel: 'noopener' }, 'Open licence portal ↗'),
        h('button', { class: 'btn', onclick: () => render() }, 'Check again'),
        h('button', { class: 'btn', onclick: signOut }, 'Sign out'))));
}

function noAccess() {
  return h('div', { class: 'auth-form', style: { minHeight: '100vh' } },
    h('div', { class: 'stack', style: { maxWidth: '420px', textAlign: 'center' } },
      h('h1', {}, 'No screens yet'),
      h('p', { class: 'muted' }, `You're signed in as ${state.me.email}, but this account hasn't been added to a client yet. Ask your provider for an invite link, then open it while signed in.`),
      h('div', {}, h('button', { class: 'btn', onclick: signOut }, 'Sign out'))));
}

function setupNeeded() {
  return h('div', { class: 'auth-form', style: { minHeight: '100vh' } },
    h('div', { class: 'stack', style: { maxWidth: '520px' } },
      h('h1', {}, 'Almost there'),
      h('p', { class: 'muted' }, 'Add your Supabase project URL and anon key to web/config.js, then reload. See README.md for the full setup.')));
}

function errorPage(e) {
  return h('div', { class: 'card pad stack' }, h('h2', {}, 'Something went wrong'), h('div', { class: 'notice' }, errMsg(e)),
    h('div', {}, h('button', { class: 'btn', onclick: () => render() }, 'Try again')));
}

// ------------------------------------------------------------ boot
(async () => {
  if (!configured) return render();
  const pv = location.hash.match(/[#&]pv_sso=([^&]+)/);
  if (pv) {
    history.replaceState(null, '', location.pathname + location.search);
    try { await pvSso(pv[1]); } catch (e) { pvErr = errMsg(e); }
  }
  const { data } = await sb.auth.getSession();
  state.session = data.session;
  sb.auth.onAuthStateChange((event, session) => {
    const had = !!state.session;
    state.session = session;
    if (event === 'PASSWORD_RECOVERY') {
      promptBox('Choose a new password', 'New password (8+ characters)', { type: 'password', okLabel: 'Save password', minLength: 8 })
        .then((p) => p && sb.auth.updateUser({ password: p }).then(({ error }) => toast(error ? errMsg(error) : 'Password updated', !!error)));
    }
    if (had !== !!session) { state.me = null; render(); }
  });
  render();
})();
