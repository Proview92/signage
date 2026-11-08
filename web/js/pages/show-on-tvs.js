// One dialog to put a playlist on TVs: pick TVs/sites, choose "all the time"
// or "only at certain times", and it goes live straight away.
import { sb, state, h, q, toast, modal, field, select, publishOrRequest, isOnline, confirmBox } from '../core.js';
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

/** Ask whether to replace or add on. Resolves 'replace' | 'add' | null. */
function replaceOrAdd(playlist, conflicts, plName) {
  return new Promise((resolve) => {
    let done = false;
    modal({
      title: 'These TVs already have a playlist',
      body: [
        h('p', { class: 'muted small', style: { margin: 0 } }, `${conflicts.length} of the TVs you picked already show something. What should happen to it?`),
        h('div', { class: 'list card', style: { maxHeight: '30vh', overflow: 'auto' } }, conflicts.map((s) => h('div', { class: 'list-row' },
          h('div', { class: 'grow' }, h('div', { style: { fontWeight: 600 } }, s.name),
            h('div', { class: 'tiny' }, 'Now playing: ' + [s.default_playlist_id, ...(s.also_playlist_ids || [])].map((i) => plName[i]).filter(Boolean).join(' + ')))))),
        h('div', { class: 'grid2' },
          h('div', { class: 'card pad' }, h('h3', {}, 'Replace'), h('div', { class: 'tiny', style: { marginTop: '4px' } }, `Stop the current playlist and play only “${playlist.name}”.`)),
          h('div', { class: 'card pad' }, h('h3', {}, 'Add on'), h('div', { class: 'tiny', style: { marginTop: '4px' } }, `Keep the current playlist and play “${playlist.name}” after it, in a loop.`))),
      ],
      onClose: () => { if (!done) resolve(null); },
      actions: [
        { label: 'Cancel', onClick: () => { done = true; resolve(null); } },
        { label: 'Add on', onClick: () => { done = true; resolve('add'); } },
        { label: 'Replace', class: 'primary', onClick: () => { done = true; resolve('replace'); } },
      ],
    });
  });
}

export async function showOnTvsDialog(playlist, { onDone } = {}) {
  const [screens, sites, rules, playlists] = await Promise.all([
    q(sb.from('screens').select('id,name,site_id,location,default_playlist_id,also_playlist_ids,last_seen,license_type,license_expires_at').eq('client_id', state.clientId).order('name')),
    loadSites(state.clientId).catch(() => []),
    q(sb.from('schedule_items').select('screen_id,playlist_id').eq('client_id', state.clientId)),
    q(sb.from('playlists').select('id,name').eq('client_id', state.clientId)),
  ]);
  if (!screens.length) { toast('Add a TV first: Screens → Add a TV', true); return; }
  const plName = Object.fromEntries(playlists.map((p) => [p.id, p.name]));
  const usesIt = (s) => s.default_playlist_id === playlist.id || (s.also_playlist_ids || []).includes(playlist.id) || rules.some((r) => r.screen_id === s.id && r.playlist_id === playlist.id);
  // TVs already showing this playlist: ticked to start with. Publishing just updates them to the latest version.
  const had = new Set(screens.filter(usesIt).map((s) => s.id));
  const chosen = new Set(had);
  let mode = 'always';

  const list = h('div', { class: 'stack', style: { gap: '4px', maxHeight: '42vh', overflow: 'auto' } });
  const groups = [...sites.map((x) => ({ id: x.id, name: x.name })), { id: null, name: sites.length ? 'No location' : null }];
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
          h('div', { class: 'grow' }, h('div', { style: { fontWeight: 600 } }, s.name, had.has(s.id) ? h('span', { class: 'badge plain', style: { marginLeft: '8px', fontSize: '11px' } }, chosen.has(s.id) ? 'Showing this' : 'Will stop showing') : null),
            h('div', { class: 'tiny' }, blocked ? 'Licence needed' : s.default_playlist_id ? `Now: ${[s.default_playlist_id, ...(s.also_playlist_ids || [])].map((i) => plName[i]).filter(Boolean).join(' + ') || '—'}` : 'Nothing playing yet')),
          h('span', { class: 'badge ' + (isOnline(s) ? 'ok' : 'bad') }, isOnline(s) ? 'Online' : 'Offline'));
      }));
  }).filter(Boolean));
  paint();

  const form = ruleForm([playlist].map((p) => ({ id: p.id, name: p.name })), { playlist_id: playlist.id, label: playlist.name, days: [1, 2, 3, 4, 5], start_time: '09:00', end_time: '17:00', priority: 10, enabled: true });
  const ruleWrap = h('div', { class: 'stack hidden', style: { borderLeft: '3px solid var(--accent)', paddingLeft: '14px' } }, form.body.slice(1));

  modal({
    title: `Publish “${playlist.name}”`,
    wide: true,
    body: [
      h('div', { class: 'row between' }, h('div', { class: 'tiny' }, 'Tick the TVs (or a whole location). It goes live straight away.'),
        h('div', { class: 'row', style: { gap: '6px' } },
          h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { screens.forEach((s) => { const L = licenseState(s); if (L.state !== 'expired' && L.state !== 'none') chosen.add(s.id); }); paint(); } }, 'Select all'),
          h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { chosen.clear(); paint(); } }, 'Clear'))),
      list,
      had.size ? h('div', { class: 'notice info small' }, `Already on ${had.size} TV${had.size === 1 ? '' : 's'} (ticked). Publishing updates them to this version — nothing is added twice. Untick a TV to take it off; tick another TV to add it.`) : null,
      field(had.size ? 'For newly ticked TVs: when should it play?' : 'When should it play?', select([['always', 'All the time (replaces what these TVs play now)'], ['times', 'Only at certain times (e.g. breakfast, weekends)']], mode, (v) => { mode = v; ruleWrap.classList.toggle('hidden', v !== 'times'); })),
      ruleWrap,
    ],
    actions: [{ label: 'Cancel' }, { label: 'Publish', class: 'primary', onClick: async () => {
      const removed = screens.filter((s) => had.has(s.id) && !chosen.has(s.id));
      const ids = [...chosen].filter((id) => !had.has(id));          // newly added TVs only
      if (!chosen.size && !removed.length) throw new Error('Tick at least one TV');
      if (removed.length && !(await confirmBox('Take it off these TVs?', `“${playlist.name}” will stop showing on ${removed.map((s) => s.name).join(', ')}.`, 'Take it off', true))) return false;
      // 1) take it off unticked TVs
      for (const s of removed) {
        const also = (s.also_playlist_ids || []).filter((x) => x !== playlist.id);
        const patch = { also_playlist_ids: also };
        if (s.default_playlist_id === playlist.id) { patch.default_playlist_id = also[0] || null; patch.also_playlist_ids = also.slice(1); }
        await q(sb.from('screens').update(patch).eq('id', s.id));
        await q(sb.from('schedule_items').delete().eq('screen_id', s.id).eq('playlist_id', playlist.id));
      }
      // 2) put it on newly ticked TVs
      const rule = ids.length && mode === 'times' ? form.read() : null;
      if (!ids.length) { /* only updating / removing */ }
      else if (mode === 'always') {
        const picked = screens.filter((s) => ids.includes(s.id));
        const conflicts = picked.filter((s) => s.default_playlist_id && s.default_playlist_id !== playlist.id);
        let how = 'replace';
        if (conflicts.length) { how = await replaceOrAdd(playlist, conflicts, plName); if (!how) return false; }
        if (how === 'replace') {
          await q(sb.from('screens').update({ default_playlist_id: playlist.id, also_playlist_ids: [] }).in('id', ids));
        } else {
          const empty = picked.filter((s) => !s.default_playlist_id).map((s) => s.id);
          if (empty.length) await q(sb.from('screens').update({ default_playlist_id: playlist.id }).in('id', empty));
          for (const s of conflicts) if (!(s.also_playlist_ids || []).includes(playlist.id)) await q(sb.from('screens').update({ also_playlist_ids: [...(s.also_playlist_ids || []), playlist.id] }).eq('id', s.id));
        }
      } else if (rule) await q(sb.from('schedule_items').insert(ids.map((sid) => ({ ...rule, playlist_id: playlist.id, screen_id: sid, client_id: state.clientId }))));
      // 3) send the latest version to every affected TV (existing, new and removed)
      const res = await publishScreens(screens.filter((s) => chosen.has(s.id) || removed.includes(s)));
      toast(publishSummary(res), res.failed.length > 0);
      onDone?.();
    } }],
  });
}
