// Proof-of-play: what played, where and when.
import { sb, state, h, q, currentClient, clientTitle, fmtDuration } from '../core.js';
import { loadSites } from './sites-ui.js';

const isoDate = (d) => d.toISOString().slice(0, 10);

export async function reportsPage({ main }) {
  const client = currentClient();
  const today = new Date();
  let from = isoDate(new Date(today.getTime() - 6 * 86400000)), to = isoDate(today);
  let site = '', screenId = '', group = 'slide';
  const [sites, screens] = await Promise.all([
    loadSites(state.clientId).catch(() => []),
    q(sb.from('screens').select('id,name,site_id').eq('client_id', state.clientId).order('name')),
  ]);
  const out = h('div', { class: 'stack' });

  async function run() {
    out.replaceChildren(h('div', { class: 'row muted' }, h('div', { class: 'spinner' }), 'Loading…'));
    let qry = sb.from('play_stats').select('*').eq('client_id', state.clientId)
      .gte('hour', new Date(from + 'T00:00:00').toISOString()).lt('hour', new Date(new Date(to + 'T00:00:00').getTime() + 86400000).toISOString())
      .order('hour', { ascending: true }).limit(20000);
    if (site) qry = qry.eq('site_id', site);
    if (screenId) qry = qry.eq('screen_id', screenId);
    const rows = await q(qry);
    const sname = Object.fromEntries(screens.map((s) => [s.id, s.name]));
    const siteName = Object.fromEntries(sites.map((s) => [s.id, s.name]));

    const keyOf = { slide: (r) => r.slide_id, screen: (r) => r.screen_id, day: (r) => r.hour.slice(0, 10), playlist: (r) => r.playlist_id || '—' }[group];
    const labelOf = { slide: (r) => r.slide_name || r.slide_type, screen: (r) => sname[r.screen_id] || 'Removed TV', day: (r) => new Date(r.hour).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }), playlist: (r) => r.playlist_name || '—' }[group];
    const agg = new Map();
    for (const r of rows) {
      const k = keyOf(r);
      const a = agg.get(k) || { label: labelOf(r), sub: group === 'slide' ? r.playlist_name : group === 'screen' ? siteName[r.site_id] : '', plays: 0, seconds: 0, screens: new Set() };
      a.plays += r.plays; a.seconds += r.seconds; a.screens.add(r.screen_id);
      agg.set(k, a);
    }
    const list = [...agg.values()].sort((a, b) => (group === 'day' ? 0 : b.plays - a.plays));
    const totalPlays = rows.reduce((t, r) => t + r.plays, 0), totalSec = rows.reduce((t, r) => t + r.seconds, 0);

    const csv = () => {
      const lines = [['Hour', 'TV', 'Site', 'Playlist', 'Slide', 'Type', 'Plays', 'Seconds']];
      for (const r of rows) lines.push([r.hour, sname[r.screen_id] || '', siteName[r.site_id] || '', r.playlist_name || '', r.slide_name || '', r.slide_type || '', r.plays, r.seconds]);
      const blob = new Blob([lines.map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n')], { type: 'text/csv' });
      const a = h('a', { href: URL.createObjectURL(blob), download: `proof-of-play_${clientTitle(client)}_${from}_${to}.csv` });
      document.body.append(a); a.click(); a.remove();
    };

    out.replaceChildren(
      h('div', { class: 'cards', style: { gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))' } },
        [['Plays', totalPlays.toLocaleString()], ['Time on screen', fmtDuration(totalSec)], ['TVs reporting', new Set(rows.map((r) => r.screen_id)).size], ['Different slides', new Set(rows.map((r) => r.slide_id)).size]]
          .map(([l, v]) => h('div', { class: 'card pad' }, h('div', { class: 'tiny' }, l), h('div', { style: { fontSize: '26px', fontWeight: 800 } }, v)))),
      h('div', { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', {}, { slide: 'By slide', screen: 'By TV', day: 'By day', playlist: 'By playlist' }[group]),
          h('button', { class: 'btn sm', onclick: csv, disabled: !rows.length }, 'Download CSV')),
        list.length ? h('div', { class: 'list' }, list.map((a) => h('div', { class: 'list-row' },
          h('div', { class: 'grow' }, h('div', { style: { fontWeight: 600 } }, a.label), a.sub ? h('div', { class: 'tiny' }, a.sub) : null),
          h('div', { class: 'tiny', style: { width: '110px', textAlign: 'right' } }, `${a.screens.size} TV${a.screens.size === 1 ? '' : 's'}`),
          h('div', { style: { width: '90px', textAlign: 'right', fontWeight: 700 } }, a.plays.toLocaleString()),
          h('div', { class: 'tiny', style: { width: '90px', textAlign: 'right' } }, fmtDuration(a.seconds)))))
          : h('div', { class: 'empty' }, h('p', {}, 'No plays recorded for this period yet. TVs send their counts every 10 minutes.'))));
  }

  const input = (v, set) => h('input', { type: 'date', value: v, style: { width: 'auto' }, onchange: (e) => { set(e.target.value); run(); } });
  const sel = (opts, v, set) => { const s = h('select', { style: { width: 'auto' }, onchange: (e) => { set(e.target.value); run(); } }); opts.forEach(([k, l]) => s.append(h('option', { value: k, selected: k === v }, l))); return s; };
  main.replaceChildren(
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Reports'), h('p', { class: 'muted' }, 'Proof of play: what was shown, where and for how long.'))),
    h('div', { class: 'card pad row', style: { marginBottom: '16px' } },
      'From', input(from, (v) => (from = v)), 'to', input(to, (v) => (to = v)),
      sites.length ? sel([['', 'All sites'], ...sites.map((s) => [s.id, s.name])], site, (v) => (site = v)) : null,
      sel([['', 'All TVs'], ...screens.map((s) => [s.id, s.name])], screenId, (v) => (screenId = v)),
      sel([['slide', 'Group by slide'], ['screen', 'Group by TV'], ['playlist', 'Group by playlist'], ['day', 'Group by day']], group, (v) => (group = v))),
    out);
  run();
}
