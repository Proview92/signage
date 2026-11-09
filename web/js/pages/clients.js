// "All sites" (Proview master, the landing page and the top of the client picker):
// every client and each of its sites, with TV counts and licences. Open one to see it as its team does.
import { sb, state, h, icon, isOnline, setClient, clientTitle, refreshMe, toast, errMsg, promptBox } from '../core.js';
import { licenseState, businessTrial, businessTrialText } from '../license.js';

const LIC_PORTAL = 'https://license.proviewcrm.co.uk';
const NEEDS = ['none', 'expiring', 'grace', 'expired'];

export async function clientsPage({ main, go, rerender }) {
  if (!state.me?.is_admin) return go('screens');
  const clients = state.me.clients.slice().sort((a, b) => clientTitle(a).localeCompare(clientTitle(b)));
  // Screens and sites across the platform (the master can read all of them). Sites are optional:
  // if that query fails the list still shows each client, just without the per-site rows.
  const [scr, st] = await Promise.all([
    sb.from('screens').select('id, client_id, site_id, last_seen, license_type, license_expires_at'),
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

  const tvCell = (list) => list.length ? h('span', { class: 'badge ' + (list.every(isOnline) ? 'ok' : list.some(isOnline) ? 'warn' : 'bad') }, `${list.filter(isOnline).length} of ${list.length} online`) : h('span', { class: 'muted' }, '0');
  const licCell = (list) => { const bad = needs(list); return bad ? h('span', { class: 'badge bad' }, `${bad} need${bad === 1 ? 's' : ''} attention`) : list.length ? h('span', { class: 'badge ok' }, 'All OK') : '—'; };

  // Online sign-ups on their 3-day trial: "Trial – ends <date>" / "Trial expired" (gone once a TV licence is bought).
  const trialBadge = (c) => {
    const t = businessTrial(c);
    return t ? h('span', { class: 'badge ' + (t.state === 'expired' ? 'bad' : 'warn'), style: { marginLeft: '8px' },
      title: t.ends ? new Date(t.ends).toLocaleString() : 'Signed up online' }, businessTrialText(t)) : null;
  };

  // One block of rows per client: the client itself, then each site, then TVs with no site.
  const blocks = clients.map((c) => {
    const list = screens.filter((s) => s.client_id === c.id);
    const mine = sites.filter((s) => s.client_id === c.id);
    const rows = [h('tr', { class: 'ov-client' },
      h('td', {}, h('b', {}, clientTitle(c)), trialBadge(c)),
      h('td', { class: 'muted' }, mine.length ? `${mine.length} location${mine.length === 1 ? '' : 's'}` : 'No locations yet'),
      h('td', {}, tvCell(list)), h('td', {}, licCell(list)),
      h('td', { style: { textAlign: 'right' } }, h('button', { class: 'btn sm primary', onclick: () => open(c.id) }, 'Open')))];
    const siteRow = (label, tvs, siteId) => h('tr', { class: 'ov-site' },
      h('td', {}), h('td', {}, label), h('td', {}, tvCell(tvs)), h('td', {}, licCell(tvs)),
      h('td', { style: { textAlign: 'right' } }, h('button', { class: 'btn sm', onclick: () => open(c.id, siteId) }, 'Open')));
    if (mine.length) {
      for (const s of mine) rows.push(siteRow(s.name, list.filter((x) => x.site_id === s.id), s.id));
      const none = list.filter((x) => !x.site_id || !mine.some((s) => s.id === x.site_id));
      if (none.length) rows.push(siteRow(h('span', { class: 'muted' }, 'No location'), none, 'none'));
    }
    const text = [clientTitle(c), c.name, c.contact_email, businessTrialText(businessTrial(c)), ...mine.map((s) => s.name)].filter(Boolean).join(' ').toLowerCase();
    return { rows, text };
  });

  // TVs that aren't assigned to any client (e.g. paired but not handed over yet), so the totals add up
  const ids = new Set(clients.map((c) => c.id));
  const loose = screens.filter((s) => !s.client_id || !ids.has(s.client_id));
  const looseRow = loose.length ? h('tr', { class: 'ov-loose' },
    h('td', {}, h('b', {}, 'Not assigned to a business'), h('div', { class: 'tiny' }, 'TVs paired but not given to a business yet. Move them to a business in the licence portal.')),
    h('td', {}), h('td', {}, tvCell(loose)), h('td', {}, licCell(loose)), h('td', {})) : null;

  const tbody = h('tbody');
  const search = h('input', { type: 'search', placeholder: 'Search businesses and locations', 'aria-label': 'Search businesses and locations', style: { maxWidth: '320px' }, oninput: () => paint() });
  const emptyState = () => h('tr', {}, h('td', { colspan: 5 },
    h('div', { class: 'stack', style: { alignItems: 'center', textAlign: 'center', padding: '28px 12px', gap: '10px' } },
      h('h3', { style: { margin: 0 } }, 'No businesses yet'),
      h('p', { class: 'muted', style: { margin: 0 } }, 'Add a business here, or add businesses, locations and licences in the Proview licence portal.'),
      h('div', { class: 'row', style: { justifyContent: 'center', gap: '8px', flexWrap: 'wrap' } },
        h('button', { class: 'btn primary', onclick: addClient }, icon('plus'), 'Add business'),
        h('a', { class: 'btn', href: LIC_PORTAL, target: '_blank', rel: 'noopener' }, 'Open licence portal ↗'),
        h('button', { class: 'btn', onclick: refresh }, icon('refresh'), 'Refresh')))));
  function paint() {
    const t = search.value.trim().toLowerCase();
    const shown = blocks.filter((b) => !t || b.text.includes(t));
    if (!clients.length) tbody.replaceChildren(emptyState(), ...(looseRow ? [looseRow] : []));
    else if (!shown.length) tbody.replaceChildren(h('tr', {}, h('td', { colspan: 5, class: 'muted', style: { padding: '18px' } }, `No clients or locations match “${search.value.trim()}”.`)));
    else tbody.replaceChildren(...shown.flatMap((b) => b.rows), ...(looseRow && !t ? [looseRow] : []));
  }
  paint();

  const stat = (k, v) => h('div', { class: 'card ov-stat' }, h('div', { class: 'tiny' }, k), h('div', { class: 'ov-v' }, String(v)));
  main.replaceChildren(
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Locations'), h('p', { class: 'muted' }, 'Every business and location on the platform, with their TVs and licences. Open one to see it as its team does.')),
      h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
        h('button', { class: 'btn', onclick: refresh, title: 'Refresh' }, icon('refresh'), 'Refresh'),
        h('a', { class: 'btn', href: LIC_PORTAL, target: '_blank', rel: 'noopener' }, 'Licences ↗'),
        h('button', { class: 'btn primary', onclick: addClient }, icon('plus'), 'Add business'))),
    h('div', { class: 'ov-stats' },
      stat('Clients', clients.length), stat('Locations', sites.length), stat('Screens', screens.length),
      stat('Online now', screens.filter(isOnline).length), stat('Licences needing attention', needs(screens))),
    h('div', { style: { marginBottom: '12px', display: clients.length > 5 ? '' : 'none' } }, search),
    h('div', { class: 'card ov-card' },
      h('table', { class: 'ov-table' },
        h('thead', {}, h('tr', {}, ...['Business', 'Location', 'TVs', 'Licences', ''].map((t) => h('th', {}, t)))),
        tbody)));
}
