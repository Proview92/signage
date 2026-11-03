// Per-TV licence helpers, shared by the dashboard and the TV player.
// Keep GRACE_DAYS in sync with public.license_grace() in the database.
export const GRACE_DAYS = 7;
const DAY = 86400000;

export const LICENSE_TYPES = [
  ['trial7', '7-day trial'],
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
  if (type === 'trial7') d.setDate(d.getDate() + 7);
  else d.setMonth(d.getMonth() + MONTHS[type]);
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
  const graceEnd = exp + GRACE_DAYS * DAY;
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
