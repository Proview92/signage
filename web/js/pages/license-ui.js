import { state, h } from '../core.js';
import { licenseLabel, licenseState, licenseSummary, fmtDate, GRACE_DAYS, tvLocationLicence, locationBlocks, locationSummary } from '../license.js';

export function licenseBadge(screen) {
  const { text, tone } = licenseSummary(screen);
  return h('span', { class: `badge ${tone}`, title: licenseLabel(screen.license_type) }, text);
}

/** Badge for a TV whose own licence is fine but whose location isn't licensed (it can't play). Else null. */
export function locationBlockBadge(screen) {
  if (!locationBlocks(screen)) return null;
  const none = licenseState(tvLocationLicence(screen)).state === 'none';
  return h('span', { class: 'badge bad', title: 'Each business needs its own licence, as well as each TV' }, none ? 'Business needs a licence' : 'Business licence expired');
}

/** Badge for a location's licence (a sites row). */
export function locationBadge(site) {
  const { text, tone } = locationSummary(site);
  return h('span', { class: `badge ${tone}`, title: licenseLabel(site.license_type) }, text);
}

/** Banner for the screen page when the licence needs attention (shown to everyone). */
export function licenseBanner(screen) {
  const L = licenseState(screen);
  const who = state.me?.is_admin ? 'Renew it in the licence portal (license.proviewcrm.co.uk).' : 'Press “Renew online” or “Buy licence online” below, or call Proview on 020 8935 5495.';
  if (L.state === 'grace') return h('div', { class: 'notice' }, `This TV's licence expired on ${fmtDate(L.expires)}. It will keep playing for ${L.graceLeft} more day${L.graceLeft === 1 ? '' : 's'}, then show “Licence expired”. ${who}`);
  if (L.state === 'expired') return h('div', { class: 'notice' }, `This TV's licence expired on ${fmtDate(L.expires)} and the ${GRACE_DAYS}-day grace period is over. The TV is showing “Licence expired” and can't be published to. ${who}`);
  if (L.state === 'expiring') return h('div', { class: 'notice info' }, `${L.type === 'trial7' ? 'Trial' : 'Licence'} ends ${fmtDate(L.expires)} (${L.daysLeft} day${L.daysLeft === 1 ? '' : 's'}). ${who}`);
  if (L.state === 'none') return h('div', { class: 'notice' }, `This TV has no licence${screen.trial_blocked_reason ? ` (${screen.trial_blocked_reason})` : ''} and isn't playing. ${who}`);
  if (locationBlocks(screen)) {
    const LL = licenseState(tvLocationLicence(screen));
    const whoLoc = state.me?.is_admin ? 'Set it in the licence portal (license.proviewcrm.co.uk).' : 'Buy the business licence on the TVs page (Business licence), or call Proview on 020 8935 5495.';
    return h('div', { class: 'notice' }, LL.state === 'none'
      ? `This TV's business needs a licence before its TVs can play. The TV is showing “Business licence required”. ${whoLoc}`
      : `This TV's business licence expired on ${fmtDate(LL.expires)}. The TV is showing “Business licence expired”. ${whoLoc}`);
  }
  return null;
}

export const LICENCE_PORTAL = 'https://license.proviewcrm.co.uk';

/** Licences are managed in the Proview licence portal, not in this app. */
export function licensePortalButton(label = 'Manage in licence portal') {
  return h('a', { class: 'btn sm primary', href: LICENCE_PORTAL, target: '_blank', rel: 'noopener' }, label + ' ↗');
}
