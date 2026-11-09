// "All sites" (Proview master, the landing page and the top of the client picker):
// every client and each of its sites, with TV counts and licences. Open one to see it as its team does.
import { sb, state, h, icon, isOnline, setClient, clientTitle, refreshMe, toast, errMsg, promptBox, modal, timeAgo } from '../core.js';
import { licenseState, businessTrial, businessTrialText } from '../license.js';
import { integrationsCards } from './integrations.js';
import { takePendingPair } from './qr-scan.js';
import { pairDialog } from './screens.js';

const LIC_PORTAL = 'https://license.proviewcrm.co.uk';
const NEEDS = ['none', 'expiring', 'grace', 'expired'];

export async function clientsPage({ main, go, rerender }) {
  if (!state.me?.is_admin) return go('screens');
  const clients = state.me.clients.slice().sort((a, b) => clientTitle(a).localeCompare(clientTitle(b)));
  // Screens and sites across the platform (the master can read all of them). Sites are optional:
  // if that query fails the list still shows each client, just without the per-site rows.
  const [scr, st] = await Promise.all([
    sb.from('screens').select('id, name, client_id, site_id, last_seen, license_type, license_expires_at'),
    sb.from('sites').select('id, client_id, name'),
  ]);
  if (scr.error) throw scr.error;
  const screens = scr.data || [];
  const sites = (st.data || []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const needs = (list) => list.filter((s) => NEEDS.includes(licenseState(s).state)).length;

  const open = (cid, siteId) => {
    setClient(cid);
    try { localStorage.setItem('signage.siteFilter.' + cid, siteId || 'all'); } catch {}
    go('screens');
  };
  const refresh = async () => { try { await refreshMe(); } catch {} rerender(); };
  const addClient = async () => {
    const name = await promptBox('Add business', 'Business name', { okLabel: 'Add business' });
    if (!name || !name.trim()) return;
    try {
      const { data, error } = await sb.from('clients').insert({ name: name.trim() }).select('id').single();
      if (error) throw error;
      await refreshMe();
      toast('Business added. Add its locations from Screens, and licences in the licence portal.');
      open(data.id);
    } catch (e) { toast(errMsg(e), true); }
  };

  const online = screens.filter(isOnline);
  const ids = new Set(clients.map((c) => c.id));
  const loose = screens.filter((s) => !s.client_id || !ids.has(s.client_id));
  const attention = screens.filter((s) => NEEDS.includes(licenseState(s).state));
  const bizName = (cid) => { const c = clients.find((x) => x.id === cid); return c ? clientTitle(c) : 'Not in a business'; };
  const siteName = (sid) => sites.find((x) => x.id === sid)?.name || '';
  const dot = (tone) => h('span', { class: 'ov-dot ' + tone });
  const chev = () => h('span', { class: 'ov-chev', 'aria-hidden': 'true' }, '›');
  const openTv = (s) => { setClient(s.client_id); document.querySelector('.modal-back')?._close?.(); go('screen/' + s.id); };
  const licText = (s) => { const L = licenseState(s); return { none: 'No licence', expiring: `Ends in ${L.daysLeft} day${L.daysLeft === 1 ? '' : 's'}`, grace: 'Expired, in grace period', expired: 'Expired', lifetime: 'Lifetime', active: 'Active' }[L.state]; };

  // Online sign-ups on their 3-day trial: "Trial – ends <date>" / "Trial expired" (gone once a TV licence is bought).
  const status = (c, list) => {
    const t = businessTrial(c);
    if (t) return h('span', { class: 'badge ' + (t.state === 'expired' ? 'bad' : 'warn'), title: t.ends ? new Date(t.ends).toLocaleString() : 'Signed up online' }, businessTrialText(t));
    if (!list.length) return h('span', { class: 'badge' }, 'No TVs yet');
    const bad = needs(list);
    if (bad) return h('span', { class: 'badge bad' }, `${bad} licence${bad === 1 ? '' : 's'} need${bad === 1 ? 's' : ''} attention`);
    if (!list.every(isOnline)) return h('span', { class: 'badge warn' }, `${list.filter((x) => !isOnline(x)).length} offline`);
    return h('span', { class: 'badge ok' }, 'All good');
  };
  const tvLine = (tvs) => tvs.length ? `${tvs.filter(isOnline).length} of ${tvs.length} TV${tvs.length === 1 ? '' : 's'} online` : 'No TVs';
  const tvTone = (tvs) => !tvs.length ? 'none' : tvs.every(isOnline) ? 'ok' : tvs.some(isOnline) ? 'warn' : 'bad';

  // ---- one card per business; its locations inside (click one = open the business on that location)
  const cards = clients.map((c) => {
    const list = screens.filter((s) => s.client_id === c.id);
    const mine = sites.filter((s) => s.client_id === c.id);
    const locRow = (label, tvs, siteId) => h('button', { type: 'button', class: 'ov-loc', onclick: () => open(c.id, siteId), title: 'Open on this location' },
      dot(tvTone(tvs)), h('span', { class: 'grow' }, label), h('span', { class: 'muted small' }, tvLine(tvs)), chev());
    const rows = mine.map((s) => locRow(s.name, list.filter((x) => x.site_id === s.id), s.id));
    const none = list.filter((x) => !x.site_id || !mine.some((s) => s.id === x.site_id));
    if (mine.length && none.length) rows.push(locRow(h('span', { class: 'muted' }, 'No location'), none, 'none'));
    if (!mine.length) rows.push(h('div', { class: 'ov-loc muted' }, 'No locations yet. Open the business to add one.'));
    // Only one location (and no TVs outside it): the card already says it all, so no location list
    const single = mine.length === 1 && rows.length === 1;
    if (single) rows.length = 0;
    const lic = list.length && list.every((s) => licenseState(s).state === 'lifetime') ? 'Licences: lifetime'
      : businessTrial(c) ? 'Free trial · signed up online' : list.length ? `${list.length} licence${list.length === 1 ? '' : 's'}` : 'Pair a TV to get started';
    const el = h('article', { class: 'card ov-biz' },
      h('div', { class: 'ov-bh' },
        h('div', { class: 'grow' }, h('h3', {}, clientTitle(c)),
          h('div', { class: 'muted small' }, single
            ? [mine[0].name !== clientTitle(c) && mine[0].name, tvLine(list)].filter(Boolean).join(' · ')
            : `${mine.length} location${mine.length === 1 ? '' : 's'} · ${list.length ? list.length + ' TV' + (list.length === 1 ? '' : 's') : 'no TVs yet'}`)),
        status(c, list)),
      ...rows,
      h('div', { class: 'ov-bf' }, h('span', { class: 'muted small' }, lic), h('button', { class: 'btn sm primary', onclick: () => open(c.id, single ? mine[0].id : undefined) }, 'Open business')));
    const text = [clientTitle(c), c.name, c.contact_email, businessTrialText(businessTrial(c)), ...mine.map((s) => s.name)].filter(Boolean).join(' ').toLowerCase();
    return { el, text };
  });

  // ---- the summary boxes: each opens the list behind its number
  const listModal = (title, items, empty) => modal({ title, wide: true, body: items.length
    ? h('div', { class: 'list ov-list' }, items)
    : h('p', { class: 'muted' }, empty) });
  const tvItem = (s, extra) => {
    const inBiz = s.client_id && ids.has(s.client_id);
    return h(inBiz ? 'button' : 'div', { type: inBiz ? 'button' : undefined, class: 'ov-li', onclick: inBiz ? () => openTv(s) : undefined },
      dot(isOnline(s) ? 'ok' : 'bad'),
      h('span', { class: 'grow' }, h('b', {}, s.name || 'Unnamed TV'), h('span', { class: 'tiny', style: { display: 'block' } }, [bizName(s.client_id), siteName(s.site_id), !isOnline(s) && (s.last_seen ? 'last seen ' + timeAgo(s.last_seen) : 'never connected')].filter(Boolean).join(' · '))),
      extra || h('span', { class: 'muted small' }, isOnline(s) ? 'Online' : 'Offline'),
      inBiz ? chev() : h('a', { class: 'btn sm', href: LIC_PORTAL, target: '_blank', rel: 'noopener', onclick: (e) => e.stopPropagation() }, 'Licence portal ↗'));
  };
  const byName = (a, b) => (bizName(a.client_id) + (a.name || '')).localeCompare(bizName(b.client_id) + (b.name || ''));
  const showBusinesses = () => listModal('Businesses', clients.map((c) => {
    const list = screens.filter((s) => s.client_id === c.id);
    return h('button', { type: 'button', class: 'ov-li', onclick: () => { document.querySelector('.modal-back')?._close?.(); open(c.id); } },
      dot(tvTone(list)), h('span', { class: 'grow' }, h('b', {}, clientTitle(c)), h('span', { class: 'tiny', style: { display: 'block' } }, `${sites.filter((s) => s.client_id === c.id).length} location(s) · ${tvLine(list)}`)),
      status(c, list), chev());
  }), 'No businesses yet.');
  const showLocations = () => listModal('Locations', sites.filter((s) => ids.has(s.client_id)).sort((a, b) => (bizName(a.client_id) + a.name).localeCompare(bizName(b.client_id) + b.name)).map((s) => {
    const tvs = screens.filter((x) => x.site_id === s.id);
    return h('button', { type: 'button', class: 'ov-li', onclick: () => { document.querySelector('.modal-back')?._close?.(); open(s.client_id, s.id); } },
      dot(tvTone(tvs)), h('span', { class: 'grow' }, h('b', {}, s.name), h('span', { class: 'tiny', style: { display: 'block' } }, bizName(s.client_id))),
      h('span', { class: 'muted small' }, tvLine(tvs)), chev());
  }), 'No locations yet.');
  const showTvs = (title, list, empty, extra) => listModal(title, list.slice().sort(byName).map((s) => tvItem(s, extra?.(s))), empty);

  const offline = screens.filter((s) => !isOnline(s));
  const stat = (k, v, onclick, tone) => h('button', { type: 'button', class: 'card ov-stat' + (tone ? ' ' + tone : ''), onclick, title: 'Show the list' },
    h('div', { class: 'tiny' }, k), h('div', { class: 'ov-v' }, String(v)));
  const stats = h('div', { class: 'ov-stats' },
    stat('Businesses', clients.length, showBusinesses),
    stat('Locations', sites.filter((s) => ids.has(s.client_id)).length, showLocations),
    stat('Screens', screens.length, () => showTvs('Screens', screens, 'No TVs yet.')),
    stat('Online', online.length, () => showTvs('Online now', online, 'No TVs are online right now.'), online.length ? 'ok' : ''),
    stat('Offline', offline.length, () => showTvs('Offline', offline, 'Every TV is online.'), offline.length ? 'warn' : ''),
    stat('Licences need attention', attention.length, () => showTvs('Licences needing attention', attention, 'Every licence is fine.',
      (s) => h('span', { class: 'badge ' + (licenseState(s).state === 'expiring' ? 'warn' : 'bad') }, licText(s))), attention.length ? 'bad' : ''));

  // TVs paired but not given to a business yet: one clear warning instead of a table row
  const looseBox = loose.length ? h('div', { class: 'card ov-warnbox' },
    h('span', { class: 'ov-warnicon', 'aria-hidden': 'true' }, '!'),
    h('div', { class: 'grow', style: { minWidth: '200px' } }, h('b', {}, `${loose.length} TV${loose.length === 1 ? '' : 's'} ${loose.length === 1 ? "isn't" : "aren't"} in a business yet`),
      h('div', { class: 'muted small' }, `Paired but not handed over${loose.some(isOnline) ? `, ${loose.filter(isOnline).length} of them online` : ''}. Give them to a business in the licence portal.`)),
    h('button', { class: 'btn sm', onclick: () => showTvs('TVs not in a business', loose, '') }, 'See them'),
    h('a', { class: 'btn sm', href: LIC_PORTAL, target: '_blank', rel: 'noopener' }, 'Sort them ↗')) : null;

  const grid = h('div', { class: 'ov-grid' });
  const search = h('input', { type: 'search', placeholder: 'Search businesses or locations', 'aria-label': 'Search businesses or locations', class: 'ov-search', oninput: () => paint() });
  const emptyState = () => h('div', { class: 'card', style: { gridColumn: '1 / -1' } },
    h('div', { class: 'stack', style: { alignItems: 'center', textAlign: 'center', padding: '28px 12px', gap: '10px' } },
      h('h3', { style: { margin: 0 } }, 'No businesses yet'),
      h('p', { class: 'muted', style: { margin: 0 } }, 'Add a business here, or add businesses, locations and licences in the Proview licence portal.'),
      h('div', { class: 'row', style: { justifyContent: 'center', gap: '8px', flexWrap: 'wrap' } },
        h('button', { class: 'btn primary', onclick: addClient }, icon('plus'), 'Add business'),
        h('a', { class: 'btn', href: LIC_PORTAL, target: '_blank', rel: 'noopener' }, 'Open licence portal ↗'),
        h('button', { class: 'btn', onclick: refresh }, icon('refresh'), 'Refresh'))));
  function paint() {
    const t = search.value.trim().toLowerCase();
    const shown = cards.filter((b) => !t || b.text.includes(t));
    if (!clients.length) grid.replaceChildren(emptyState());
    else if (!shown.length) grid.replaceChildren(h('p', { class: 'muted', style: { gridColumn: '1 / -1' } }, `No businesses or locations match “${search.value.trim()}”.`));
    else grid.replaceChildren(...shown.map((b) => b.el));
  }
  paint();

  // A TV's QR code was scanned and no business is open: pick the business in Add a TV.
  const pendingCode = takePendingPair();
  if (pendingCode) setTimeout(() => pairDialog({ clients, code: pendingCode, onDone: (s) => { if (s?.client_id) { setClient(s.client_id); go('screen/' + s.id); } else refresh(); } }), 50);

  main.replaceChildren(
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Businesses'), h('p', { class: 'muted' }, 'Every business on the platform with its locations. Open one to see it as its team does.')),
      h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
        h('button', { class: 'btn', onclick: refresh, title: 'Refresh' }, icon('refresh'), 'Refresh'),
        h('a', { class: 'btn', href: LIC_PORTAL, target: '_blank', rel: 'noopener' }, 'Licences ↗'),
        h('button', { class: 'btn primary', onclick: addClient }, icon('plus'), 'Add business'))),
    stats,
    ...[looseBox, clients.length > 3 ? h('div', { class: 'ov-tools' }, search) : null].filter(Boolean),
    grid,
    // Alerts & email (Resend key, offline alerts) - master only; it lived on the old Clients & TVs page
    h('h2', { style: { margin: '24px 0 10px' } }, 'Platform settings'),
    await integrationsCards(rerender).catch(() => h('div', { class: 'notice' }, 'Could not load alerts & email settings.')));
}
