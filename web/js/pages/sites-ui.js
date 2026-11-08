// Sites: a client's locations. TVs belong to a site; playlists and media are shared unless given sites.
import { sb, h, icon, q, toast, modal, field, confirmBox, sortSites, errMsg, mySiteIds, canEditContent } from '../core.js';

export async function loadSites(clientId) {
  return sortSites(await q(sb.from('sites').select('*').eq('client_id', clientId)));
}

/** Add / rename / delete a client's sites. */
export async function manageSitesDialog(clientId, clientName, onDone) {
  let sites = await loadSites(clientId);
  const { data: tvs } = await sb.from('screens').select('id,site_id').eq('client_id', clientId);
  const tvCount = (id) => (tvs || []).filter((t) => t.site_id === id).length;
  const list = h('div', { class: 'stack', style: { gap: '8px' } });
  const add = h('input', { type: 'text', placeholder: 'New site name, e.g. High Street' });
  let changed = false;

  const paint = () => list.replaceChildren(...(sites.length ? sites.map((s) => {
    const inp = h('input', { type: 'text', value: s.name });
    const save = async () => {
      const v = inp.value.trim();
      if (!v || v === s.name) return;
      try { await q(sb.from('sites').update({ name: v }).eq('id', s.id)); s.name = v; changed = true; toast('Site renamed'); }
      catch (e) { toast(errMsg(e), true); }
    };
    inp.addEventListener('change', save);
    return h('div', { class: 'row', style: { flexWrap: 'nowrap' } },
      h('div', { class: 'grow' }, inp),
      h('span', { class: 'tiny', style: { width: '56px', textAlign: 'right' } }, `${tvCount(s.id)} TV${tvCount(s.id) === 1 ? '' : 's'}`),
      h('button', { class: 'btn sm ghost icon danger', title: 'Delete site', onclick: async () => {
        const n = tvCount(s.id);
        if (!(await confirmBox(`Delete “${s.name}”?`, n ? `Its ${n} TV${n === 1 ? '' : 's'} will keep playing, but won't be in a site until you choose one.` : 'This site has no TVs.'))) return;
        try { await q(sb.from('sites').delete().eq('id', s.id)); sites = sites.filter((x) => x !== s); changed = true; paint(); }
        catch (e) { toast(errMsg(e), true); }
      } }, icon('trash')));
  }) : [h('div', { class: 'muted small' }, 'No sites yet. Add the client’s locations below.')]));
  paint();

  const addSite = async () => {
    const v = add.value.trim();
    if (!v) return;
    if (sites.some((s) => s.name.toLowerCase() === v.toLowerCase())) return toast('That site already exists', true);
    try {
      const s = await q(sb.from('sites').insert({ client_id: clientId, name: v }).select().single());
      sites = sortSites([...sites, s]); add.value = ''; changed = true; paint(); add.focus();
    } catch (e) { toast(errMsg(e), true); }
  };
  add.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addSite(); } });

  modal({
    title: `Sites — ${clientName}`,
    body: [
      h('p', { class: 'muted small', style: { margin: 0 } }, 'Each TV belongs to one site. Media and playlists are shared by all sites unless you choose sites for them.'),
      list,
      h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, h('div', { class: 'grow' }, add), h('button', { class: 'btn primary', type: 'button', onclick: addSite }, icon('plus'), 'Add site')),
    ],
    onClose: () => changed && onDone?.(),
    actions: [{ label: 'Done', class: 'primary' }],
  });
}

/** Short text for a playlist / media site list (null = shared with all sites). */
export function contentSitesLabel(siteIds, sites) {
  if (siteIds == null) return 'All sites';
  const names = siteIds.map((id) => sites.find((s) => s.id === id)?.name).filter(Boolean);
  return names.length ? names.join(', ') : 'No sites';
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
    return { el: field('Sites', h('div', { class: 'small' }, contentSitesLabel(cur, sites),
      h('div', { class: 'tiny' }, 'Only an owner or admin can change this.'))), value: () => cur, readOnly: true };
  }
  let shared = !mine && cur == null;
  const chosen = new Set((cur || []).filter((id) => avail.some((s) => s.id === id)));
  const box = h('div', {});
  const row = (type, checked, label, onchange, extra = {}) => h('label', { class: 'row small', style: { gap: '8px', alignItems: 'center', padding: '3px 0', cursor: 'pointer' } },
    h('input', { type, name: type === 'radio' ? 'content-sites' : undefined, checked, onchange: (e) => onchange(e.target.checked), ...extra }), h('span', {}, label));
  const paint = () => box.replaceChildren(
    mine ? null : row('radio', shared, 'Shared with all sites', (v) => { if (v) { shared = true; paint(); } }),
    mine ? null : row('radio', !shared, 'Only these sites', (v) => { if (v) { shared = false; paint(); } }),
    h('div', { style: { paddingLeft: mine ? 0 : '22px', opacity: shared ? 0.5 : 1 } },
      avail.map((s) => row('checkbox', !shared && chosen.has(s.id), s.name, (v) => { v ? chosen.add(s.id) : chosen.delete(s.id); }, { disabled: shared }))));
  paint();
  const value = () => {
    if (shared) return null;
    if (!chosen.size) throw new Error(mine ? 'Pick at least one of your sites' : 'Pick at least one site, or choose Shared with all sites');
    return [...chosen];
  };
  return { el: field('Sites', box, mine ? 'Only people at these sites (and owners/admins) see it.' : 'Who can see and use it. People limited to other sites won’t see it.'), value };
}

/** <select> of sites. value '' = no site. */
export function siteSelect(sites, value, onchange, { noneLabel = '— No site —' } = {}) {
  const s = h('select', { onchange: (e) => onchange(e.target.value) });
  s.append(h('option', { value: '' }, noneLabel));
  for (const x of sites) s.append(h('option', { value: x.id, selected: x.id === value }, x.name));
  return s;
}
