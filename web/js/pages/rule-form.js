// Schedule-rule form, shared by a TV's schedule and the site-wide schedule.
import { h, field, select } from '../core.js';
import { DAY_NAMES } from '../renderer.js';

/**
 * @returns {{ body: Node[], read: () => object }} read() validates and returns
 *   { playlist_id, label, days, start_time, end_time, start_date, end_date, priority, enabled }
 */
export function ruleForm(playlists, rule = null) {
  const r = rule ? { ...rule } : { playlist_id: playlists[0]?.id, label: '', days: [1, 2, 3, 4, 5], start_time: '09:00', end_time: '17:00', start_date: null, end_date: null, priority: 10, enabled: true };
  r.days = r.days?.length ? [...r.days] : [0, 1, 2, 3, 4, 5, 6];
  let allDay = !!rule && !r.start_time && !r.end_time;

  const label = h('input', { type: 'text', value: r.label || '', placeholder: 'e.g. Breakfast menu' });
  const pl = select(playlists.map((p) => [p.id, p.name]), r.playlist_id, (v) => (r.playlist_id = v));
  const chips = h('div', { class: 'chips' });
  const paintChips = () => chips.replaceChildren(
    ...[1, 2, 3, 4, 5, 6, 0].map((d) => h('button', { type: 'button', class: 'chip' + (r.days.includes(d) ? ' on' : ''), onclick: () => { r.days = r.days.includes(d) ? r.days.filter((x) => x !== d) : [...r.days, d]; paintChips(); } }, DAY_NAMES[d])),
    h('span', { style: { width: '8px' } }),
    ...[['Weekdays', [1, 2, 3, 4, 5]], ['Weekends', [0, 6]], ['Every day', [0, 1, 2, 3, 4, 5, 6]]].map(([l, ds]) =>
      h('button', { type: 'button', class: 'btn sm ghost', onclick: () => { r.days = ds; paintChips(); } }, l)));
  paintChips();

  const st = h('input', { type: 'time', value: r.start_time?.slice(0, 5) || '09:00' });
  const et = h('input', { type: 'time', value: r.end_time?.slice(0, 5) || '17:00' });
  const times = h('div', { class: 'grid2' }, field('From', st), field('Until', et, 'Can run past midnight, e.g. 22:00–02:00'));
  const ad = h('input', { type: 'checkbox', checked: allDay, onchange: (e) => { allDay = e.target.checked; times.classList.toggle('hidden', allDay); } });
  times.classList.toggle('hidden', allDay);
  const sd = h('input', { type: 'date', value: r.start_date || '' });
  const ed = h('input', { type: 'date', value: r.end_date || '' });
  const prio = select([['0', 'Normal'], ['10', 'High'], ['100', 'Override everything']], String(r.priority >= 100 ? 100 : r.priority >= 10 ? 10 : 0), (v) => (r.priority = Number(v)));

  const body = [
    field('Play this playlist', pl),
    field('Label', label),
    field('On these days', chips),
    h('label', { class: 'row small', style: { fontWeight: 600 } }, ad, 'All day'),
    times,
    h('div', { class: 'grid2' }, field('Starting on (optional)', sd), field('Ending on (optional)', ed)),
    field('Priority', prio, 'When rules overlap, the higher priority plays. Use “Override” for one-off events.'),
  ];

  const read = () => {
    if (!r.playlist_id) throw new Error('Choose a playlist');
    if (!r.days.length) throw new Error('Pick at least one day');
    if (sd.value && ed.value && ed.value < sd.value) throw new Error('End date is before start date');
    if (!allDay && st.value === et.value) throw new Error('Start and end time are the same');
    return {
      playlist_id: r.playlist_id,
      label: label.value.trim() || null,
      days: r.days.length === 7 ? null : [...r.days].sort(),
      start_time: allDay ? null : st.value, end_time: allDay ? null : et.value,
      start_date: sd.value || null, end_date: ed.value || null,
      priority: r.priority, enabled: r.enabled ?? true,
    };
  };
  return { body, read };
}
