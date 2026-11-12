// Sites: a client's locations. TVs belong to a site; playlists and media are shared unless given sites.
import { sb, h, icon, q, toast, modal, field, confirmBox, sortSites, errMsg, mySiteIds, canEditContent } from '../core.js';

export async function loadSites(clientId) {
  return sortSites(await q(sb.from('sites').select('*').eq('client_id', clientId)));
}

/** Short text for a playlist / media site list (null = shared with all sites). */
export function contentSitesLabel(siteIds, sites) {
  if (siteIds == null) return 'All locations';
  const names = siteIds.map((id) => sites.find((s) => s.id === id)?.name).filter(Boolean);
  return names.length ? names.join(', ') : 'No locations';
}

/**
 * "Sites" picker for a playlist or media item: Shared with all sites / only some sites.
 * Owners/Admins pick from every site; people limited to some sites only see (and can only pick) theirs,
 * and can't share with every site. Returns { el, value() } — value() is null (shared) or an array of
 * site ids, and throws if no site is ticked. Returns null when the business has no sites.
 */
export function contentSitesPicker(item, sites) {
  if (!sites.length) return null;
  const mine = mySiteIds();
  const avail = mine ? sites.filter((s) => mine.includes(s.id)) : sites;
  const cur = item?.site_ids;
  if (!canEditContent(item)) {
    return { el: field('Locations', h('div', { class: 'small' }, contentSitesLabel(cur, sites),
      h('div', { class: 'tiny' }, 'Only an owner or admin can change this.'))), value: () => cur, readOnly: true };
  }
  let shared = !mine && cur == null;
  const chosen = new Set((cur || []).filter((id) => avail.some((s) => s.id === id)));
  const box = h('div', {});
  const row = (type, checked, label, onchange, extra = {}) => h('label', { class: 'row small', style: { gap: '8px', alignItems: 'center', padding: '3px 0', cursor: 'pointer' } },
    h('input', { type, name: type === 'radio' ? 'content-sites' : undefined, checked, onchange: (e) => onchange(e.target.checked), ...extra }), h('span', {}, label));
  const paint = () => box.replaceChildren(
    mine ? null : row('radio', shared, 'Shared with all locations', (v) => { if (v) { shared = true; paint(); } }),
    mine ? null : row('radio', !shared, 'Only these locations', (v) => { if (v) { shared = false; paint(); } }),
    h('div', { style: { paddingLeft: mine ? 0 : '22px', opacity: shared ? 0.5 : 1 } },
      avail.map((s) => row('checkbox', !shared && chosen.has(s.id), s.name, (v) => { v ? chosen.add(s.id) : chosen.delete(s.id); }, { disabled: shared }))));
  paint();
  const value = () => {
    if (shared) return null;
    if (!chosen.size) throw new Error(mine ? 'Pick at least one of your locations' : 'Pick at least one location, or choose Shared with all locations');
    return [...chosen];
  };
  return { el: field('Locations', box, mine ? 'Only people at these locations (and owners/admins) see it.' : 'Who can see and use it. People limited to other locations won’t see it.'), value };
}

/** <select> of sites. value '' = no site. */
export function siteSelect(sites, value, onchange, { noneLabel = '— No location —' } = {}) {
  const s = h('select', { onchange: (e) => onchange(e.target.value) });
  s.append(h('option', { value: '' }, noneLabel));
  for (const x of sites) s.append(h('option', { value: x.id, selected: x.id === value }, x.name));
  return s;
}
