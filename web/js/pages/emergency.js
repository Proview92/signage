// Emergency / priority messages that take over screens immediately.
import { sb, state, h, icon, q, toast, modal, field, select, timeAgo, clientTitle } from '../core.js';
import { loadSites } from './sites-ui.js';

export const OVERRIDE_STYLES = {
  red: ['Red (emergency)', '#b91c1c', '#ffffff'],
  orange: ['Orange (warning)', '#ea580c', '#ffffff'],
  blue: ['Blue (information)', '#1d4ed8', '#ffffff'],
  green: ['Green (all clear)', '#15803d', '#ffffff'],
  black: ['Black', '#000000', '#ffffff'],
};

export async function activeOverrides() {
  const now = new Date().toISOString();
  const rows = await q(sb.from('overrides').select('*').eq('active', true).lte('starts_at', now).order('created_at', { ascending: false }));
  return rows.filter((o) => !o.ends_at || o.ends_at > now);
}

export function scopeText(o, clients = [], sites = []) {
  if (o.scope === 'all') return 'All screens, all clients';
  const c = clients.find((x) => x.id === o.client_id);
  if (o.scope === 'client') return `All screens · ${c ? clientTitle(c) : 'client'}`;
  return `${sites.find((x) => x.id === o.site_id)?.name || 'One site'}${c ? ' · ' + clientTitle(c) : ''}`;
}

/** Dialog to send a message. Admin can target all clients. */
export async function emergencyDialog({ onDone } = {}) {
  const isAdmin = state.me.is_admin;
  const sites = state.clientId ? await loadSites(state.clientId).catch(() => []) : [];
  const msg = h('input', { type: 'text', placeholder: 'e.g. Please evacuate the building', maxLength: 120 });
  const sub = h('input', { type: 'text', placeholder: 'Optional second line, e.g. Use the nearest fire exit', maxLength: 200 });
  let style = 'red', scope = state.clientId ? 'client' : 'all', site = sites[0]?.id || '', dur = '0';
  const scopes = [
    ...(state.clientId ? [['client', `All screens for ${clientTitle(state.me.clients.find((c) => c.id === state.clientId))}`]] : []),
    ...(state.clientId && sites.length ? [['site', 'One site…']] : []),
    ...(isAdmin ? [['all', 'Every screen, all clients']] : []),
  ];
  const siteWrap = h('div', { class: scope === 'site' ? '' : 'hidden' }, sites.length ? field('Site', select(sites.map((s) => [s.id, s.name]), site, (v) => (site = v))) : null);
  const preview = h('div', { style: { borderRadius: '10px', padding: '22px', textAlign: 'center' } });
  const paint = () => {
    const [, bg, fg] = OVERRIDE_STYLES[style];
    Object.assign(preview.style, { background: bg, color: fg });
    preview.replaceChildren(h('div', { style: { fontSize: '22px', fontWeight: 800 } }, msg.value || 'Your message'), sub.value ? h('div', { style: { marginTop: '6px' } }, sub.value) : '');
  };
  msg.addEventListener('input', paint); sub.addEventListener('input', paint); paint();

  modal({ title: 'Emergency message', body: [
    h('div', { class: 'notice' }, 'This replaces what the TVs are showing straight away, until you end it.'),
    field('Message', msg), field('Second line', sub),
    h('div', { class: 'grid2' },
      field('Colour', select(Object.fromEntries(Object.entries(OVERRIDE_STYLES).map(([k, v]) => [k, v[0]])), style, (v) => { style = v; paint(); })),
      field('Show for', select([['0', 'Until I end it'], ['15', '15 minutes'], ['60', '1 hour'], ['240', '4 hours'], ['eod', 'Until midnight']], dur, (v) => (dur = v)))),
    field('Send to', select(scopes, scope, (v) => { scope = v; siteWrap.classList.toggle('hidden', v !== 'site'); })),
    siteWrap, h('div', { class: 'tiny' }, 'Preview'), preview],
  actions: [{ label: 'Cancel' }, { label: 'Show on screens now', class: 'danger', onClick: async () => {
    if (!msg.value.trim()) throw new Error('Type the message');
    let ends = null;
    if (dur === 'eod') { const d = new Date(); d.setHours(23, 59, 59, 0); ends = d.toISOString(); }
    else if (dur !== '0') ends = new Date(Date.now() + Number(dur) * 60000).toISOString();
    await q(sb.from('overrides').insert({
      scope, message: msg.value.trim(), subtitle: sub.value.trim() || null, style, ends_at: ends,
      client_id: scope === 'all' ? null : state.clientId, site_id: scope === 'site' ? site : null,
    }));
    toast('Message is showing on the screens');
    onDone?.();
  } }] });
}

/** Banner listing active messages with an End button (or null). */
export async function overridesBanner(onChange) {
  let list = [];
  try { list = await activeOverrides(); } catch { return null; }
  if (state.clientId && !state.me.is_admin) list = list.filter((o) => o.scope === 'all' || o.client_id === state.clientId);
  if (!list.length) return null;
  const sites = state.clientId ? await loadSites(state.clientId).catch(() => []) : [];
  return h('div', { class: 'stack', style: { gap: '8px', marginBottom: '16px' } }, list.map((o) => {
    const [, bg, fg] = OVERRIDE_STYLES[o.style] || OVERRIDE_STYLES.red;
    const canEnd = state.me.is_admin || o.scope !== 'all';
    return h('div', { class: 'row', style: { background: bg, color: fg, borderRadius: '12px', padding: '12px 16px', flexWrap: 'nowrap' } },
      h('span', { class: 'live', style: { background: 'rgba(0,0,0,.25)', padding: '3px 8px', borderRadius: '5px', fontSize: '11px', fontWeight: 800 } }, 'ON AIR'),
      h('div', { class: 'grow' }, h('div', { style: { fontWeight: 750 } }, o.message),
        h('div', { style: { fontSize: '12px', opacity: '.85' } }, `${scopeText(o, state.me.clients, sites)} · started ${timeAgo(o.created_at)}${o.ends_at ? ' · ends ' + new Date(o.ends_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}`)),
      canEnd ? h('button', { class: 'btn sm', onclick: async () => { await q(sb.from('overrides').update({ active: false }).eq('id', o.id)); toast('Message ended'); onChange?.(); } }, 'End now') : null);
  }));
}
