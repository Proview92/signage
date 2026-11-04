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
  let allDay = !!rule && !r.start_time && !r.end_time && !(r.day_times && Object.keys(r.day_times).length);
  let perDay = !!(r.day_times && Object.keys(r.day_times).length);
  let refreshDays = () => {};   // set once the per-day rows exist

  const label = h('input', { type: 'text', value: r.label || '', placeholder: 'e.g. Breakfast menu' });
  const pl = select(playlists.map((p) => [p.id, p.name]), r.playlist_id, (v) => (r.playlist_id = v));
  const chips = h('div', { class: 'chips' });
  const paintChips = () => chips.replaceChildren(
    ...[1, 2, 3, 4, 5, 6, 0].map((d) => h('button', { type: 'button', class: 'chip' + (r.days.includes(d) ? ' on' : ''), onclick: () => { r.days = r.days.includes(d) ? r.days.filter((x) => x !== d) : [...r.days, d]; paintChips(); refreshDays(); } }, DAY_NAMES[d])),
    h('span', { style: { width: '8px' } }),
    ...[['Weekdays', [1, 2, 3, 4, 5]], ['Weekends', [0, 6]], ['Every day', [0, 1, 2, 3, 4, 5, 6]]].map(([l, ds]) =>
      h('button', { type: 'button', class: 'btn sm ghost', onclick: () => { r.days = ds; paintChips(); refreshDays(); } }, l)));
  paintChips();

  const st = h('input', { type: 'time', value: r.start_time?.slice(0, 5) || '09:00' });
  const et = h('input', { type: 'time', value: r.end_time?.slice(0, 5) || '17:00' });
  const sameTimes = h('div', { class: 'grid2' }, field('From', st), field('Until', et, 'Can run past midnight, e.g. 22:00–02:00'));
  // Different times on each day
  const dayTimes = { ...(r.day_times || {}) };
  const perDayBox = h('div', { class: 'stack', style: { gap: '8px' } });
  const paintPerDay = () => perDayBox.replaceChildren(
    ...[1, 2, 3, 4, 5, 6, 0].filter((d) => r.days.includes(d)).map((d) => {
      const t = dayTimes[d] ||= { from: st.value || '09:00', to: et.value || '17:00' };
      return h('div', { class: 'day-times' }, h('b', {}, DAY_NAMES[d]),
        h('input', { type: 'time', value: t.from, 'aria-label': `${DAY_NAMES[d]} from`, onchange: (e) => (t.from = e.target.value) }),
        h('span', { class: 'tiny' }, 'to'),
        h('input', { type: 'time', value: t.to, 'aria-label': `${DAY_NAMES[d]} until`, onchange: (e) => (t.to = e.target.value) }));
    }),
    h('div', { class: 'tiny' }, 'An end time earlier than the start (e.g. 22:00 to 02:00) runs past midnight.'));
  const pd = h('input', { type: 'checkbox', checked: perDay, onchange: (e) => { perDay = e.target.checked; paintTimes(); } });
  const perDayToggle = h('label', { class: 'row small', style: { fontWeight: 600 } }, pd, 'Different times on each day');
  const times = h('div', { class: 'stack', style: { gap: '10px' } }, perDayToggle, sameTimes, perDayBox);
  function paintTimes() {
    sameTimes.classList.toggle('hidden', perDay);
    perDayBox.classList.toggle('hidden', !perDay);
    if (perDay) paintPerDay();
  }
  paintTimes();
  refreshDays = () => { if (perDay) paintPerDay(); };
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
    h('div', { class: 'grid2' }, field('Start date (optional)', sd), field('End date (optional)', ed)),
    field('Priority', prio, 'When rules overlap, the higher priority plays. Use “Override” for one-off events.'),
  ];

  const read = () => {
    if (!r.playlist_id) throw new Error('Choose a playlist');
    if (!r.days.length) throw new Error('Pick at least one day');
    if (sd.value && ed.value && ed.value < sd.value) throw new Error('End date is before start date');
    if (!allDay && !perDay && st.value === et.value) throw new Error('Start and end time are the same');
    let dt = null;
    if (!allDay && perDay) {
      dt = {};
      for (const d of r.days) {
        const t = dayTimes[d] || { from: st.value, to: et.value };
        if (!t.from || !t.to) throw new Error(`Set both times for ${DAY_NAMES[d]}`);
        if (t.from === t.to) throw new Error(`${DAY_NAMES[d]}: start and end time are the same`);
        dt[d] = { from: t.from, to: t.to };
      }
    }
    return {
      playlist_id: r.playlist_id,
      label: label.value.trim() || null,
      days: r.days.length === 7 ? null : [...r.days].sort(),
      start_time: allDay ? null : st.value, end_time: allDay ? null : et.value,
      day_times: dt,
      start_date: sd.value || null, end_date: ed.value || null,
      priority: r.priority, enabled: r.enabled ?? true,
    };
  };
  return { body, read };
}
