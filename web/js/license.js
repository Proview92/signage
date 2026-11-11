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
 * Business-level free trial (online sign-ups before migration 042; there are no new trials). c = a client from whoami.
 * null = not on a trial (added by Proview, set up after 042, or has bought a TV licence).
 * state: 'active' | 'expired'.
 */
export function businessTrial(c, now = Date.now()) {
  if (!c?.trial_only || !c.trial_ends_at) return null;
  const ends = new Date(c.trial_ends_at).getTime();
  return { state: now < ends ? 'active' : 'expired', ends };
}
export function businessTrialText(t) {
  if (!t) return '';
  return t.state === 'active' ? `Trial – ends ${fmtDate(t.ends)}` : 'Trial expired';
}

/**
 * Never licensed: no TV of this business has ever had a licence (and it isn't on a pre-042 trial).
 * Uses whoami's has_licence (042) when there, else the business's TVs if given.
 */
export function neverLicensed(c, screens = null) {
  if (!c || businessTrial(c)) return false;
  if (c.trial_ends_at && Date.now() < new Date(c.trial_ends_at).getTime()) return false;   // 3-day trial from the master's Add business (044)
  if (typeof c.has_licence === 'boolean') return !c.has_licence;
  return Array.isArray(screens) ? !screens.some((s) => s.license_type) : false;
}
export const NO_LICENCE_TEXT = 'No licence yet: buy a licence to start using Proview Signage';

/*
 * Location licences (migration 045, owner 11 Nov 2026: "per location + per TV"). A location (a sites row) has the same
 * licence fields as a TV, so licenseState / licenseSummary read it directly. Each TV also carries a copy of its
 * location's licence (screens.site_license_type / site_license_expires_at): a TV plays only if both are valid.
 */
export const LOCATION_NO_LICENCE_TEXT = 'This location needs a licence before its TVs can play';
/** The licence of a TV's location, from the TV's own row; null before migration 045 (then only the TV licence counts). */
export function tvLocationLicence(screen) {
  if (!screen || !('site_license_type' in screen)) return null;
  return { license_type: screen.site_license_type, license_expires_at: screen.site_license_expires_at };
}
const BLOCKED = ['expired', 'none'];
/** The TV can't play because of its location's licence (its own licence may be fine). */
export function locationBlocks(screen) {
  const l = tvLocationLicence(screen);
  return !!l && BLOCKED.includes(licenseState(l).state);
}
/** The TV plays: its own licence and its location's licence are both valid (grace counts as valid). */
export const tvCanPlay = (screen) => !BLOCKED.includes(licenseState(screen).state) && !locationBlocks(screen);
/** Short text + tone for a location's licence badge (a sites row). */
export function locationSummary(site) {
  const s = licenseSummary(site);
  if (s.L.state === 'none') return { ...s, text: 'Location: no licence yet' };
  if (s.L.state === 'lifetime') return { ...s, text: 'Location: lifetime licence' };
  return { ...s, text: 'Location: ' + s.text.charAt(0).toLowerCase() + s.text.slice(1) };
}
