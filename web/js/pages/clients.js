// "All clients" (Proview admins, from the client picker): every client's screens and licences at a glance.
import { sb, state, h, isOnline, setClient, clientTitle } from '../core.js';
import { licenseState } from '../license.js';

const LIC_PORTAL = 'https://license.proviewcrm.co.uk';
const NEEDS = ['none', 'expiring', 'grace', 'expired'];

export async function clientsPage({ main, go }) {
  if (!state.me?.is_admin) return go('screens');
  const clients = state.me.clients.slice().sort((a, b) => clientTitle(a).localeCompare(clientTitle(b)));
  const { data, error } = await sb.from('screens').select('id, client_id, last_seen, license_type, license_expires_at');
  if (error) throw error;
  const screens = data || [];
  const of = (id) => screens.filter((s) => s.client_id === id);
  const needs = (list) => list.filter((s) => NEEDS.includes(licenseState(s).state)).length;

  const stat = (k, v) => h('div', { class: 'card ov-stat' }, h('div', { class: 'tiny' }, k), h('div', { class: 'ov-v' }, String(v)));
  const open = (id) => { setClient(id); go('screens'); };
  const rows = clients.map((c) => {
    const list = of(c.id), on = list.filter(isOnline).length, bad = needs(list);
    return h('tr', {},
      h('td', {}, h('b', {}, clientTitle(c))),
      h('td', {}, String(list.length)),
      h('td', {}, list.length ? h('span', { class: 'badge ' + (on === list.length ? 'ok' : on ? 'warn' : 'bad') }, `${on} of ${list.length}`) : '—'),
      h('td', {}, bad ? h('span', { class: 'badge bad' }, `${bad} need${bad === 1 ? 's' : ''} attention`) : list.length ? h('span', { class: 'badge ok' }, 'All OK') : '—'),
      h('td', { style: { textAlign: 'right' } }, h('button', { class: 'btn sm primary', onclick: () => open(c.id) }, 'Open')));
  });

  // TVs that aren't assigned to any client (e.g. paired but not handed over yet), so the totals add up
  const ids = new Set(clients.map((c) => c.id));
  const loose = screens.filter((s) => !s.client_id || !ids.has(s.client_id));
  if (loose.length) {
    const on = loose.filter(isOnline).length, bad = needs(loose);
    rows.push(h('tr', { class: 'ov-loose' },
      h('td', {}, h('b', {}, 'Not assigned to a client'), h('div', { class: 'tiny' }, 'TVs paired but not given to a client yet. Move them to a client in the licence portal.')),
      h('td', {}, String(loose.length)),
      h('td', {}, h('span', { class: 'badge ' + (on === loose.length ? 'ok' : on ? 'warn' : 'bad') }, `${on} of ${loose.length}`)),
      h('td', {}, bad ? h('span', { class: 'badge bad' }, `${bad} need${bad === 1 ? 's' : ''} attention`) : h('span', { class: 'badge ok' }, 'All OK')),
      h('td', {})));
  }

  main.replaceChildren(
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'All clients'), h('p', { class: 'muted' }, 'Screens and licences across every client. Open one to see it as its team does.')),
      h('a', { class: 'btn', href: LIC_PORTAL, target: '_blank', rel: 'noopener' }, 'Licences ↗')),
    h('div', { class: 'ov-stats' },
      stat('Clients', clients.length), stat('Screens', screens.length),
      stat('Online now', screens.filter(isOnline).length), stat('Licences needing attention', needs(screens))),
    h('div', { class: 'card ov-card' }, clients.length
      ? h('table', { class: 'ov-table' },
          h('thead', {}, h('tr', {}, ...['Client', 'Screens', 'Online', 'Licences', ''].map((t) => h('th', {}, t)))),
          h('tbody', {}, ...rows))
      : h('p', { class: 'muted', style: { padding: '18px' } }, 'No clients yet. Add them in the licence portal.')));
}
