// Sites: a client's locations. TVs belong to a site; content is shared.
import { sb, h, icon, q, toast, modal, field, confirmBox, sortSites, errMsg } from '../core.js';

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
      h('p', { class: 'muted small', style: { margin: 0 } }, 'Media and playlists are shared by all sites. Each TV belongs to one site.'),
      list,
      h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, h('div', { class: 'grow' }, add), h('button', { class: 'btn primary', type: 'button', onclick: addSite }, icon('plus'), 'Add site')),
    ],
    onClose: () => changed && onDone?.(),
    actions: [{ label: 'Done', class: 'primary' }],
  });
}

/** <select> of sites. value '' = no site. */
export function siteSelect(sites, value, onchange, { noneLabel = '— No site —' } = {}) {
  const s = h('select', { onchange: (e) => onchange(e.target.value) });
  s.append(h('option', { value: '' }, noneLabel));
  for (const x of sites) s.append(h('option', { value: x.id, selected: x.id === value }, x.name));
  return s;
}
