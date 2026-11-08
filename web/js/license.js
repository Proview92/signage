// Per-TV licence helpers, shared by the dashboard and the TV player.
// Keep GRACE_DAYS in sync with public.license_grace() in the database.
// Free trials ('trial7', now 3 days long) get no grace: they stop when they end.
export const GRACE_DAYS = 7;
const DAY = 86400000;

export const LICENSE_TYPES = [
  ['trial7', '3-day trial'],
  ['m1', '1 month'],
  ['m3', '3 months'],
  ['m6', '6 months'],
  ['m12', '12 months'],
  ['m24', '24 months'],
  ['m36', '36 months'],
  ['lifetime', 'Lifetime'],
  ['custom', 'Custom end date'],
];
export const licenseLabel = (t) => (LICENSE_TYPES.find(([k]) => k === t) || [null, 'No licence'])[1];

const MONTHS = { m1: 1, m3: 3, m6: 6, m12: 12, m24: 24, m36: 36 };
/** Expiry the database will compute for a preset (for previews). */
export function previewExpiry(type, { extend = false, current = null, custom = null } = {}) {
  if (type === 'lifetime') return null;
  if (type === 'custom') return custom ? new Date(custom) : undefined;
  const now = new Date();
  const base = extend && current && new Date(current) > now ? new Date(current) : now;
  const d = new Date(base);
  if (type === 'trial7') d.setDate(d.getDate() + 3);
  else {
    const day = d.getDate();
    d.setDate(1); d.setMonth(d.getMonth() + MONTHS[type]);
    d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  }
  return d;
}

/**
 * state: 'none' | 'lifetime' | 'active' | 'expiring' (≤14 days) | 'grace' | 'expired'
 * daysLeft: days until expiry (negative once past), graceLeft: days of grace remaining
 */
export function licenseState(screen, now = Date.now()) {
  const type = screen?.license_type;
  if (!type) return { state: 'none', type };
  if (type === 'lifetime' || !screen.license_expires_at) return { state: 'lifetime', type };
  const exp = new Date(screen.license_expires_at).getTime();
  const daysLeft = Math.ceil((exp - now) / DAY);
  if (now < exp) return { state: daysLeft <= 14 ? 'expiring' : 'active', type, daysLeft, expires: exp };
  const graceEnd = exp + (type === 'trial7' ? 0 : GRACE_DAYS) * DAY;
  if (now < graceEnd) return { state: 'grace', type, daysLeft, graceLeft: Math.ceil((graceEnd - now) / DAY), expires: exp };
  return { state: 'expired', type, daysLeft, expires: exp };
}

export const fmtDate = (t) => new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Short text + tone for badges. tone: ok | warn | bad | plain */
export function licenseSummary(screen) {
  const L = licenseState(screen);
  const trial = L.type === 'trial7';
  switch (L.state) {
    case 'none': return { text: 'No licence', tone: 'bad', L };
    case 'lifetime': return { text: 'Lifetime licence', tone: 'ok', L };
    case 'active': return { text: `${trial ? 'Trial' : 'Licensed'} · until ${fmtDate(L.expires)}`, tone: trial ? 'warn' : 'ok', L };
    case 'expiring': return { text: `${trial ? 'Trial' : 'Licence'} ends in ${plural(L.daysLeft, 'day')}`, tone: 'warn', L };
    case 'grace': return { text: `Expired · ${plural(L.graceLeft, 'day')} grace left`, tone: 'bad', L };
    default: return { text: 'Licence expired', tone: 'bad', L };
  }
}

/**
 * Business-level free trial (online sign-ups, migration 032). c = a client from whoami.
 * null = not on a trial (added by Proview, or has bought a TV licence).
 * state: 'active' | 'expired' | 'unknown' (older server without trial_ends_at).
 */
export function businessTrial(c, now = Date.now()) {
  if (!c?.trial_only) return null;
  if (!c.trial_ends_at) return c.self_signup ? { state: 'unknown' } : null;
  const ends = new Date(c.trial_ends_at).getTime();
  return { state: now < ends ? 'active' : 'expired', ends };
}
export function businessTrialText(t) {
  if (!t) return '';
  if (t.state === 'unknown') return 'Free trial';
  return t.state === 'active' ? `Trial – ends ${fmtDate(t.ends)}` : 'Trial expired';
}
