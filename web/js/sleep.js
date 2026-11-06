// Sleep hours: when a TV switches off (or goes black) and wakes up again.
// Shared by the TV player and the dashboard.
//
// screens.sleep          = { on, days: [0-6 = Sun-Sat, the day the sleep STARTS], from: 'HH:MM', to: 'HH:MM', off }
//                          off: true = switch the TV off (needs a one-off permission on the TV); false = black screen only
// screens.sleep_override = { state: 'sleep' | 'wake', until: ISO time }  ("Sleep now" / "Wake now" from the dashboard)

export const DEFAULT_SLEEP = { on: false, days: [0, 1, 2, 3, 4, 5, 6], from: '22:00', to: '07:00', off: true };
export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const toMin = (t) => { const [h, m] = String(t || '0:0').split(':').map(Number); return ((h || 0) * 60 + (m || 0)) % 1440; };

/** Day of week and minute of day for a moment, in a time zone (the TV's), or this device's own clock. */
function localParts(date, tz) {
  if (!tz) return { day: date.getDay(), min: date.getHours() * 60 + date.getMinutes(), sec: date.getSeconds() };
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(date).map((x) => [x.type, x.value]));
    return { day: DAY_SHORT.indexOf(p.weekday), min: (+p.hour % 24) * 60 + +p.minute, sec: +p.second };
  } catch { return localParts(date); }
}

/** Minutes from now until the given minute of the day (1..1440). */
const minutesUntil = (nowMin, target) => ((target - nowMin + 1440) % 1440) || 1440;

/**
 * Is the TV meant to be asleep right now?
 * Returns { asleep, until: Date | null, manual }. `until` = when that changes (wake time, or next sleep time).
 */
export function sleepState(sleep, override, now = new Date(), tz) {
  if (override?.until && new Date(override.until) > now && (override.state === 'sleep' || override.state === 'wake')) {
    return { asleep: override.state === 'sleep', until: new Date(override.until), manual: true };
  }
  if (!sleep?.on) return { asleep: false, until: null, manual: false };
  const f = toMin(sleep.from), t = toMin(sleep.to);
  if (f === t) return { asleep: false, until: null, manual: false };
  const days = new Set(Array.isArray(sleep.days) ? sleep.days : DEFAULT_SLEEP.days);
  const { day, min, sec } = localParts(now, tz);
  const at = (mins) => new Date(now.getTime() + mins * 60000 - sec * 1000);
  const yesterday = (day + 6) % 7;
  const asleep = f < t
    ? days.has(day) && min >= f && min < t
    : (days.has(day) && min >= f) || (days.has(yesterday) && min < t);
  if (asleep) return { asleep: true, until: at(minutesUntil(min, t)), manual: false };
  // Next time it goes to sleep (within the coming week).
  for (let d = 0; d < 8; d++) {
    const wd = (day + d) % 7;
    if (!days.has(wd)) continue;
    const mins = d * 1440 + f - min;
    if (mins > 0) return { asleep: false, until: at(mins), manual: false };
  }
  return { asleep: false, until: null, manual: false };
}

export const hhmm = (d, tz) => {
  try { return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', ...(tz ? { timeZone: tz } : {}) }); } catch { return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }); }
};

/** "Mon–Fri", "Every day", "Sat, Sun" … for the days a sleep starts. */
export function describeDays(days) {
  const s = [...new Set(days || [])].sort();
  if (s.length === 7) return 'every day';
  if (s.join() === '1,2,3,4,5') return 'Mon–Fri';
  if (s.join() === '0,6') return 'Sat & Sun';
  if (!s.length) return 'no days';
  return [1, 2, 3, 4, 5, 6, 0].filter((d) => s.includes(d)).map((d) => DAY_SHORT[d]).join(', ');
}

/** One-line summary of the sleep hours, e.g. "22:00 → 07:00, every day · switches the TV off". */
export function describeSleep(sleep) {
  if (!sleep?.on) return 'Off — the TV stays on all the time';
  return `${sleep.from} → ${sleep.to}, ${describeDays(sleep.days)} · ${sleep.off ? 'switches the TV off' : 'black screen'}`;
}
