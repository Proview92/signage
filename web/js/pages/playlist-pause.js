// Play / Pause / Stop for one playlist (migration 028: playlist_pauses + set_playlist_pause).
// While a playlist is paused or stopped, its TVs skip it and play whatever else is scheduled.
import { sb, state, h, icon, q, toast, modal, field } from '../core.js';

/** Paused/stopped playlists for the current account: { playlist_id: until (ISO or 'infinity') }. */
export async function loadPauses() {
  try {
    const rows = await q(sb.from('playlist_pauses').select('playlist_id,until').eq('client_id', state.clientId));
    return Object.fromEntries(rows.map((r) => [r.playlist_id, r.until]));
  } catch { return {}; }   // table not there yet (migration 028 not run): everything plays
}

const isStop = (until) => until === 'infinity' || until === 'Infinity' || (until && new Date(until).getFullYear() > 9000);

/** 'playing' | 'paused' | 'stopped', with a short label. */
export function pauseState(until) {
  if (!until) return { state: 'playing', label: 'Playing' };
  if (isStop(until)) return { state: 'stopped', label: 'Stopped' };
  const t = new Date(until);
  if (!(t > new Date())) return { state: 'playing', label: 'Playing' };
  const sameDay = t.toDateString() === new Date().toDateString();
  const time = t.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return { state: 'paused', label: `Paused until ${sameDay ? time : t.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) + ' ' + time}` };
}

export function pauseBadge(until) {
  const st = pauseState(until);
  if (st.state === 'playing') return null;
  return h('span', { class: 'badge ' + (st.state === 'stopped' ? 'bad' : 'warn') }, st.label);
}

async function setPause(p, until, done) {
  const { error } = await sb.rpc('set_playlist_pause', { p_playlist: p.id, p_until: until });
  if (error) {
    toast(/function|schema cache/i.test(error.message) ? 'Pausing needs a quick database update first (migration 028).' : error.message, true);
    return false;
  }
  toast(until == null ? `“${p.name}” is playing again` : until === 'infinity' ? `“${p.name}” stopped` : `“${p.name}” paused`);
  done?.();
  return true;
}

function pauseDialog(p, done) {
  const at = (d) => d.toISOString();
  const now = new Date();
  const endOfDay = new Date(now); endOfDay.setHours(23, 59, 0, 0);
  const tomorrow = new Date(now); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(6, 0, 0, 0);
  const choices = [
    ['30', '30 minutes', () => new Date(Date.now() + 30 * 60000)],
    ['60', '1 hour', () => new Date(Date.now() + 3600000)],
    ['120', '2 hours', () => new Date(Date.now() + 7200000)],
    ['eod', 'Until the end of today', () => endOfDay],
    ['tmr', 'Until tomorrow, 06:00', () => tomorrow],
    ['custom', 'Until a date and time…', null],
  ];
  const pad = (n) => String(n).padStart(2, '0');
  const local = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const custom = h('input', { type: 'datetime-local', value: local(new Date(Date.now() + 86400000)), min: local(now), style: { marginTop: '6px' } });
  let pick = '60';
  const radios = choices.map(([k, label]) => h('label', { class: 'sleep-opt', style: { alignItems: 'center' } },
    h('input', { type: 'radio', name: 'pause-for', value: k, checked: k === pick, onchange: () => { pick = k; custom.disabled = k !== 'custom'; } }), h('span', {}, label)));
  custom.disabled = true;
  modal({
    title: `Pause “${p.name}”`,
    body: [
      h('p', { class: 'muted', style: { margin: '0 0 6px' } }, 'TVs skip this playlist and play whatever else is scheduled, then go back to it by themselves.'),
      h('div', { class: 'stack small' }, ...radios, custom),
    ],
    actions: [{ label: 'Cancel' }, { label: 'Pause', class: 'primary', onClick: async () => {
      let until;
      if (pick === 'custom') { until = custom.value ? new Date(custom.value) : null; if (!until || !(until > new Date())) { toast('Choose a time in the future', true); return false; } }
      else until = choices.find((c) => c[0] === pick)[2]();
      return (await setPause(p, at(until), done)) ? undefined : false;
    } }],
  });
}

/** Buttons for a playlist card: Pause + Stop while playing, Play while paused/stopped. */
export function pauseControls(p, until, done, { small = true } = {}) {
  const st = pauseState(until);
  const cls = 'btn' + (small ? ' sm' : '');
  if (st.state === 'playing') {
    return [
      h('button', { class: cls, title: 'Take it off the TVs for a while, then it comes back by itself', onclick: () => pauseDialog(p, done) }, icon('pause'), 'Pause'),
      h('button', { class: cls, title: 'Take it off the TVs until you press Play', onclick: () => setPause(p, 'infinity', done) }, icon('stop'), 'Stop'),
    ];
  }
  return [h('button', { class: cls + ' primary', title: 'Put it back on the TVs now', onclick: () => setPause(p, null, done) }, icon('play'), 'Play')];
}
