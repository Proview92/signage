// Sleep hours on the dashboard: the card on a TV's page, the edit dialog, and the "Sleeping" badge.
import { sb, state, h, icon, q, toast, modal, field, canManage } from '../core.js';
import { sleepState, describeSleep, hhmm, DEFAULT_SLEEP, DAY_SHORT } from '../sleep.js';

const tzOf = (screen) => screen.device_info?.tz || undefined;
const stateOf = (screen) => sleepState(screen.sleep, screen.sleep_override, new Date(), tzOf(screen));

/** Badge for the Screens list / TV page while a TV is in its sleep hours. */
export function sleepBadge(screen) {
  const st = stateOf(screen);
  if (!st.asleep) return null;
  return h('span', { class: 'badge sleep', title: describeSleep(screen.sleep) }, st.until && st.until.getFullYear() < 2090 ? `Sleeping until ${hhmm(st.until, tzOf(screen))}` : 'Sleeping');
}

/** True while the TV is meant to be asleep (so "Offline" is expected, not a fault). */
export const isAsleep = (screen) => stateOf(screen).asleep;

/** Card on the TV page: current state, the hours, and Sleep now / Wake now. */
export function sleepCard(screen, { onChange }) {
  const st = stateOf(screen), tz = tzOf(screen), s = screen.sleep;
  const when = (d) => (d && d.getFullYear() < 2090 ? hhmm(d, tz) : null);
  const status = st.asleep
    ? `Asleep${when(st.until) ? ` until ${when(st.until)}` : ''}${st.manual ? ' (Sleep now)' : ''}`
    : st.manual ? `Awake until ${when(st.until)} (Wake now)` : s?.on && st.until ? `Awake · sleeps at ${when(st.until)}` : 'Awake';
  const offNote = s?.on && s.off && screen.device_info?.can_turn_off === false
    ? h('div', { class: 'notice warn small', style: { marginTop: '8px' } }, 'This TV hasn’t allowed the app to switch it off yet, so it shows a black screen instead. On the TV: press Menu → ', h('b', {}, 'Allow switching the TV off'), '.')
    : null;

  async function override(stateName) {
    let until;
    const sched = sleepState(screen.sleep, null, new Date(), tz);   // what the hours alone say
    if (stateName === 'wake') until = sched.asleep && sched.until ? sched.until : new Date(Date.now() + 3600000);
    else until = sched.asleep ? sched.until : (sched.until && screen.sleep?.on ? nextWake(screen) : new Date('2099-01-01'));
    await q(sb.from('screens').update({ sleep_override: { state: stateName, until: until.toISOString() } }).eq('id', screen.id));
    toast(stateName === 'sleep' ? 'Sleep sent to the TV' : 'Wake sent to the TV');
    onChange?.();
  }
  async function clearOverride() {
    await q(sb.from('screens').update({ sleep_override: null }).eq('id', screen.id));
    toast('Back to the normal sleep hours'); onChange?.();
  }

  return h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('div', {}, h('h2', {}, 'Sleep hours'), h('div', { class: 'tiny' }, 'Switch the TV off out of hours and back on again.')),
      canManage() ? h('button', { class: 'btn sm', onclick: () => sleepDialog({ screen, onDone: onChange }) }, icon('edit'), 'Edit') : null),
    h('div', { class: 'card-body stack small' },
      h('div', { class: 'row between' }, h('span', { class: 'muted' }, 'Hours'), describeSleep(s)),
      h('div', { class: 'row between' }, h('span', { class: 'muted' }, 'Now'), h('b', {}, status)),
      offNote,
      canManage() ? h('div', { class: 'row', style: { gap: '8px', marginTop: '6px', flexWrap: 'wrap' } },
        st.asleep ? h('button', { class: 'btn sm primary', onclick: () => override('wake') }, 'Wake now')
          : h('button', { class: 'btn sm', onclick: () => override('sleep') }, 'Sleep now'),
        st.manual ? h('button', { class: 'btn sm ghost', onclick: clearOverride }, 'Back to normal hours') : null) : null,
      st.asleep && s?.off ? h('div', { class: 'tiny' }, 'A TV that is switched off can’t hear “Wake now” until it wakes at its set time. Press OK on its remote to wake it straight away.') : null));
}

function nextWake(screen) {
  // Sleep now while awake: stay asleep until the next scheduled wake-up after the next sleep starts.
  const tz = tzOf(screen); const st = sleepState(screen.sleep, null, new Date(), tz);
  if (!st.until) return new Date('2099-01-01');
  const after = sleepState(screen.sleep, null, new Date(st.until.getTime() + 60000), tz);
  return after.asleep && after.until ? after.until : new Date('2099-01-01');
}

/** Edit sleep hours for a TV, optionally copying them to the other TVs at its site or the whole account. */
export async function sleepDialog({ screen, onDone }) {
  const s = { ...DEFAULT_SLEEP, ...(screen.sleep || {}) };
  if (!screen.sleep) s.on = true;   // opening the editor for the first time: start with it switched on
  const days = new Set(s.days);
  const on = h('input', { type: 'checkbox', checked: s.on });
  const from = h('input', { type: 'time', value: s.from, required: true });
  const to = h('input', { type: 'time', value: s.to, required: true });
  const dayBtns = [1, 2, 3, 4, 5, 6, 0].map((d) => {
    const b = h('button', { type: 'button', class: 'chip-day' + (days.has(d) ? ' on' : ''), onclick: () => { days.has(d) ? days.delete(d) : days.add(d); b.classList.toggle('on', days.has(d)); } }, DAY_SHORT[d]);
    return b;
  });
  const modeOff = h('input', { type: 'radio', name: 'sleep-mode', checked: !!s.off });
  const modeBlack = h('input', { type: 'radio', name: 'sleep-mode', checked: !s.off });
  const all = await q(sb.from('screens').select('id,name,site_id').eq('client_id', state.clientId).order('name')).catch(() => [screen]);
  const siteTvs = screen.site_id ? all.filter((x) => x.site_id === screen.site_id) : [];
  const scope = h('select', {},
    h('option', { value: 'one' }, `Just this TV (${screen.name})`),
    siteTvs.length > 1 ? h('option', { value: 'site' }, `All ${siteTvs.length} TVs at this site`) : null,
    all.length > 1 ? h('option', { value: 'all' }, `All ${all.length} TVs`) : null);
  const settings = h('div', { class: 'stack' },
    h('div', { class: 'row', style: { gap: '12px' } }, field('Switch off at', from), field('Switch on at', to)),
    field('On these nights', h('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap' } }, ...dayBtns)),
    h('div', { class: 'tiny', style: { marginTop: '-6px' } }, 'The day it switches off. e.g. 22:00 → 07:00 on Fri means Friday night until Saturday morning.'),
    h('div', {},
      h('div', { class: 'sleep-how-title' }, 'How'),
      h('div', { class: 'stack small' },
        h('label', { class: 'sleep-opt' }, modeOff, h('span', {}, h('b', {}, 'Switch the TV off'), h('br'), h('span', { class: 'muted' }, 'The TV stick sleeps and most TVs switch off with it, then both wake at the set time. Needs a one-off “Allow” on each TV (Menu → Allow switching the TV off). Until then it shows a black screen.'))),
        h('label', { class: 'sleep-opt' }, modeBlack, h('span', {}, h('b', {}, 'Black screen only'), h('br'), h('span', { class: 'muted' }, 'The TV stays on but shows nothing. Works on every TV.'))))));
  const paintOn = () => { settings.style.opacity = on.checked ? '1' : '.45'; settings.style.pointerEvents = on.checked ? '' : 'none'; };
  on.addEventListener('change', paintOn); paintOn();

  modal({
    title: 'Sleep hours',
    body: [
      h('label', { class: 'row', style: { gap: '8px', marginBottom: '10px' } }, on, h('b', {}, 'Switch this TV off out of hours')),
      settings,
      field('Apply to', scope),
      h('div', { class: 'tiny' }, 'Times are the TV’s own local time.'),
    ],
    actions: [{ label: 'Cancel' }, { label: 'Save', class: 'primary', onClick: async () => {
      if (on.checked && (!from.value || !to.value || from.value === to.value)) { toast('Choose different switch-off and switch-on times', true); return false; }
      if (on.checked && !days.size) { toast('Choose at least one night', true); return false; }
      const sleep = { on: on.checked, days: [...days].sort(), from: from.value, to: to.value, off: modeOff.checked };
      const ids = scope.value === 'all' ? all.map((x) => x.id) : scope.value === 'site' ? siteTvs.map((x) => x.id) : [screen.id];
      await q(sb.from('screens').update({ sleep, sleep_override: null }).in('id', ids));
      toast(`Sleep hours saved for ${ids.length} TV${ids.length === 1 ? '' : 's'}`);
      onDone?.();
    } }],
  });
}
