// One dialog to put a playlist on TVs: pick TVs/sites, choose "all the time"
// or "only at certain times", and it goes live straight away.
import { sb, state, h, q, toast, modal, field, select, publishOrRequest, isOnline } from '../core.js';
import { loadSites } from './sites-ui.js';
import { ruleForm } from './rule-form.js';
import { licenseState } from '../license.js';

/** Publish a list of screens; returns { ok, pending, failed[] }. */
export async function publishScreens(screens) {
  let ok = 0, pending = 0; const failed = [];
  for (const s of screens) {
    try { const r = await publishOrRequest('screen', s.id, s.name); r.pending ? pending++ : ok++; }
    catch { failed.push(s.name); }
  }
  return { ok, pending, failed };
}

export function publishSummary({ ok, pending, failed }) {
  const parts = [];
  if (ok) parts.push(`Live on ${ok} TV${ok === 1 ? '' : 's'}`);
  if (pending) parts.push(`${pending} sent to your manager for approval`);
  if (failed.length) parts.push(`not updated: ${failed.join(', ')} (licence)`);
  return parts.join(' · ') || 'Nothing to update';
}

export async function showOnTvsDialog(playlist, { onDone } = {}) {
  const [screens, sites, rules, playlists] = await Promise.all([
    q(sb.from('screens').select('id,name,site_id,location,default_playlist_id,last_seen,license_type,license_expires_at').eq('client_id', state.clientId).order('name')),
    loadSites(state.clientId).catch(() => []),
    q(sb.from('schedule_items').select('screen_id,playlist_id').eq('client_id', state.clientId)),
    q(sb.from('playlists').select('id,name').eq('client_id', state.clientId)),
  ]);
  if (!screens.length) { toast('Add a TV first: Screens → Add a TV', true); return; }
  const plName = Object.fromEntries(playlists.map((p) => [p.id, p.name]));
  const usesIt = (s) => s.default_playlist_id === playlist.id || rules.some((r) => r.screen_id === s.id && r.playlist_id === playlist.id);
  const chosen = new Set(screens.filter(usesIt).map((s) => s.id));
  let mode = 'always';

  const list = h('div', { class: 'stack', style: { gap: '4px', maxHeight: '42vh', overflow: 'auto' } });
  const groups = [...sites.map((x) => ({ id: x.id, name: x.name })), { id: null, name: sites.length ? 'No site' : null }];
  const paint = () => list.replaceChildren(...groups.map((g) => {
    const tvs = screens.filter((s) => (s.site_id || null) === g.id);
    if (!tvs.length) return null;
    const all = tvs.every((s) => chosen.has(s.id));
    return h('div', { class: 'stack', style: { gap: '2px', marginBottom: '8px' } },
      g.name ? h('label', { class: 'row', style: { fontWeight: 750, fontSize: '13px', textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--ink-3)' } },
        h('input', { type: 'checkbox', checked: all, onchange: (e) => { tvs.forEach((s) => (e.target.checked ? chosen.add(s.id) : chosen.delete(s.id))); paint(); } }), g.name) : null,
      ...tvs.map((s) => {
        const L = licenseState(s);
        const blocked = L.state === 'expired' || L.state === 'none';
        return h('label', { class: 'row', style: { padding: '8px 10px', borderRadius: '8px', background: chosen.has(s.id) ? 'var(--accent-soft)' : '#faf9f6', flexWrap: 'nowrap', opacity: blocked ? '.55' : '1' } },
          h('input', { type: 'checkbox', checked: chosen.has(s.id), disabled: blocked, onchange: (e) => { e.target.checked ? chosen.add(s.id) : chosen.delete(s.id); paint(); } }),
          h('div', { class: 'grow' }, h('div', { style: { fontWeight: 600 } }, s.name),
            h('div', { class: 'tiny' }, blocked ? 'Licence needed' : s.default_playlist_id ? `Now: ${plName[s.default_playlist_id] || '—'}` : 'Nothing playing yet')),
          h('span', { class: 'badge ' + (isOnline(s) ? 'ok' : 'bad') }, isOnline(s) ? 'Online' : 'Offline'));
      }));
  }).filter(Boolean));
  paint();

  const form = ruleForm([playlist].map((p) => ({ id: p.id, name: p.name })), { playlist_id: playlist.id, label: playlist.name, days: [1, 2, 3, 4, 5], start_time: '09:00', end_time: '17:00', priority: 10, enabled: true });
  const ruleWrap = h('div', { class: 'stack hidden', style: { borderLeft: '3px solid var(--accent)', paddingLeft: '14px' } }, form.body.slice(1));

  modal({
    title: `Show “${playlist.name}” on TVs`,
    wide: true,
    body: [
      h('div', { class: 'row between' }, h('div', { class: 'tiny' }, 'Tick the TVs (or a whole site). It goes live straight away.'),
        h('div', { class: 'row', style: { gap: '6px' } },
          h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { screens.forEach((s) => { const L = licenseState(s); if (L.state !== 'expired' && L.state !== 'none') chosen.add(s.id); }); paint(); } }, 'Select all'),
          h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { chosen.clear(); paint(); } }, 'Clear'))),
      list,
      field('When should it play?', select([['always', 'All the time (replaces what these TVs play now)'], ['times', 'Only at certain times (e.g. breakfast, weekends)']], mode, (v) => { mode = v; ruleWrap.classList.toggle('hidden', v !== 'times'); })),
      ruleWrap,
    ],
    actions: [{ label: 'Cancel' }, { label: 'Show on TVs now', class: 'primary', onClick: async () => {
      const ids = [...chosen];
      if (!ids.length) throw new Error('Tick at least one TV');
      const rule = mode === 'times' ? form.read() : null;
      if (mode === 'always') await q(sb.from('screens').update({ default_playlist_id: playlist.id }).in('id', ids));
      else await q(sb.from('schedule_items').insert(ids.map((sid) => ({ ...rule, playlist_id: playlist.id, screen_id: sid, client_id: state.clientId }))));
      const res = await publishScreens(screens.filter((s) => chosen.has(s.id)));
      toast(publishSummary(res), res.failed.length > 0);
      onDone?.();
    } }],
  });
}
