import { clientLabel, clientTitle } from '../core.js';
import { sb, state, h, icon, q, rpc, toast, modal, field, select, timeAgo, isOnline, canManage, mediaUrl, needsPublish, currentClient } from '../core.js';
import { renderStill, resolveSchedule, isSlideActive } from '../renderer.js';
import { licenseBadge } from './license-ui.js';
import { loadSites, manageSitesDialog, siteSelect } from './sites-ui.js';
import { ruleForm } from './rule-form.js';
import { licenseState } from '../license.js';

export async function loadClientData(clientId) {
  const [screens, playlists, rules, sites] = await Promise.all([
    q(sb.from('screens').select('*').eq('client_id', clientId).order('name')),
    q(sb.from('playlists').select('id,name,updated_at,slides,settings').eq('client_id', clientId).order('name')),
    q(sb.from('schedule_items').select('*').eq('client_id', clientId).order('priority', { ascending: false })),
    loadSites(clientId),
  ]);
  return { screens, playlists, rules, sites, byId: Object.fromEntries(playlists.map((p) => [p.id, p])) };
}

export function screenThumb(screen, contentOverride) {
  const box = h('div', { class: 'thumb' });
  const content = contentOverride ?? screen.content;
  const { playlistId } = resolveSchedule(content);
  const pl = playlistId && content.playlists[playlistId];
  const slide = pl?.slides?.find((s) => isSlideActive(s)) || pl?.slides?.[0];
  if (!slide) {
    box.append(h('div', { class: 'blank' }, screen.content ? 'Nothing scheduled right now' : 'Nothing published yet'));
    return box;
  }
  (async () => {
    const url = slide.path ? await mediaUrl(slide.path).catch(() => null) : null;
    renderStill(box, slide, url, pl.settings?.orientation);
  })();
  return box;
}

export function statusBadges(screen, rules, byId) {
  const out = [];
  out.push(isOnline(screen) ? h('span', { class: 'badge ok' }, 'Online') : h('span', { class: 'badge bad' }, screen.last_seen ? `Offline · ${timeAgo(screen.last_seen)}` : 'Offline'));
  if (needsPublish(screen, rules.filter((r) => r.screen_id === screen.id), byId)) out.push(h('span', { class: 'badge warn' }, 'Unpublished changes'));
  out.push(licenseBadge(screen));
  return out;
}

export async function pairDialog({ fixedClient, clients, onDone, siteId = '' }) {
  const code = h('input', { type: 'text', class: 'code-input', maxLength: 6, placeholder: 'ABC123', autocomplete: 'off', autocapitalize: 'characters' });
  const name = h('input', { type: 'text', placeholder: 'e.g. Reception TV' });
  const loc = h('input', { type: 'text', placeholder: 'e.g. Counter, Window (optional)' });
  let clientId = fixedClient || '';
  let site = siteId;
  const siteWrap = h('div');
  const paintSites = async () => {
    site = clientId === fixedClient ? site : '';
    if (!clientId) return siteWrap.replaceChildren();
    const sites = await loadSites(clientId).catch(() => []);
    siteWrap.replaceChildren(sites.length ? field('Site', siteSelect(sites, site, (v) => (site = v), { noneLabel: '— Choose later —' })) : h('div', { class: 'tiny' }, 'This client has no sites yet. You can add them under Sites.'));
  };
  const pick = clients ? select([['', '— Assign later —'], ...clients.map((c) => [c.id, clientLabel(c)])], clientId, (v) => { clientId = v; paintSites(); }) : null;
  paintSites();
  modal({
    title: 'Add a TV',
    body: [
      h('div', { class: 'notice info' }, 'Open the PROVIEW SIGNAGE app on the TV. It shows a 6-character code — type it below.'),
      field('Pairing code', code),
      field('Screen name', name),
      pick ? field('Client', pick, 'Which client will manage this TV?') : null,
      siteWrap,
      field('Position at the site', loc),
    ],
    actions: [
      { label: 'Cancel' },
      { label: 'Pair TV', class: 'primary', onClick: async () => {
        if (code.value.trim().length < 6) throw new Error('Enter the 6-character code shown on the TV');
        const s = await rpc('claim_screen', { p_code: code.value, p_name: name.value || null, p_client: clientId || null });
        const extra = {};
        if (loc.value.trim()) extra.location = loc.value.trim();
        if (site && clientId) extra.site_id = site;
        if (Object.keys(extra).length) await q(sb.from('screens').update(extra).eq('id', s.id));
        if (s.license_type === 'trial7') toast(`${s.name} paired — 7-day trial started`);
        else if (s.license_type) toast(`${s.name} paired`);
        else toast(`${s.name} paired, but no free trial: ${s.trial_blocked_reason || 'this device needs a licence'}`, true);
        onDone?.(s);
      } },
    ],
  });
}

/** Apply a default playlist and/or schedule rule to every TV at a site, then publish. */
export function siteScheduleDialog({ site, tvs, playlists, onDone, go }) {
  if (!playlists.length) { toast('Create a playlist first', true); return go?.('playlists'); }
  let def = 'keep', mode = 'none', publish = true;
  const form = ruleForm(playlists);
  const ruleWrap = h('div', { class: 'stack hidden', style: { borderLeft: '3px solid var(--accent)', paddingLeft: '14px' } }, form.body);
  const expired = tvs.filter((t) => licenseState(t).state === 'expired' || licenseState(t).state === 'none');
  const modeSel = select([
    ['none', 'Don’t change schedule rules'],
    ['add', 'Add a rule to every TV'],
    ['replace', 'Replace every TV’s rules with one rule'],
    ['clear', 'Remove all schedule rules'],
  ], mode, (v) => { mode = v; ruleWrap.classList.toggle('hidden', !['add', 'replace'].includes(v)); });

  modal({
    title: `Site schedule — ${site.name}`,
    body: [
      h('p', { class: 'muted small', style: { margin: 0 } }, `Applies to all ${tvs.length} TV${tvs.length === 1 ? '' : 's'} at this site: ${tvs.map((t) => t.name).join(', ')}.`),
      field('Default playlist', select([['keep', '— Keep each TV’s own —'], ['', 'Nothing (blank screen)'], ...playlists.map((p) => [p.id, p.name])], def, (v) => (def = v)),
        'Plays whenever no schedule rule applies.'),
      field('Schedule rules', modeSel),
      ruleWrap,
      h('label', { class: 'row small', style: { fontWeight: 600 } }, h('input', { type: 'checkbox', checked: publish, onchange: (e) => (publish = e.target.checked) }), 'Publish to the TVs now'),
      expired.length ? h('div', { class: 'notice' }, `${expired.length} TV${expired.length === 1 ? ' has' : 's have'} no valid licence and won't be published to: ${expired.map((t) => t.name).join(', ')}.`) : null,
    ],
    actions: [
      { label: 'Cancel' },
      { label: 'Apply to site', class: 'primary', onClick: async () => {
        const rule = ['add', 'replace'].includes(mode) ? form.read() : null;
        if (def === 'keep' && mode === 'none' && !publish) return;
        const ids = tvs.map((t) => t.id);
        if (def !== 'keep') await q(sb.from('screens').update({ default_playlist_id: def || null }).in('id', ids));
        if (mode === 'replace' || mode === 'clear') await q(sb.from('schedule_items').delete().in('screen_id', ids));
        if (rule) await q(sb.from('schedule_items').insert(ids.map((sid) => ({ ...rule, screen_id: sid, client_id: state.clientId }))));
        let ok = 0; const failed = [];
        if (publish) {
          for (const t of tvs) {
            try { await rpc('publish_screen', { p_screen: t.id }); ok++; } catch { failed.push(t.name); }
          }
        }
        toast(publish ? `Applied and published to ${ok} TV${ok === 1 ? '' : 's'}${failed.length ? ` (not published: ${failed.join(', ')})` : ''}` : 'Applied. Publish when ready.', failed.length > 0);
        onDone?.();
      } },
    ],
  });
}

export async function screensPage({ main, go }) {
  const client = currentClient();
  let data = await loadClientData(state.clientId);

  let filter = localStorage.getItem('signage.siteFilter.' + state.clientId) || 'all';

  const card = (s, rules, byId) => {
    const { playlistId, rule } = resolveSchedule(s.content);
    const now = playlistId ? s.content.playlists[playlistId]?.name : null;
    return h('a', { class: 'card screen-card', href: '#/screen/' + s.id },
      screenThumb(s),
      h('div', { class: 'screen-meta' },
        h('div', { class: 'row between' }, h('h3', {}, s.name), h('span', { class: 'tiny' }, s.location || '')),
        h('div', { class: 'small muted' }, now ? `Playing: ${now}${rule?.label ? ` · ${rule.label}` : ''}` : 'Idle'),
        h('div', { class: 'row', style: { gap: '6px' } }, statusBadges(s, rules, byId))));
  };

  const paint = () => {
    const { screens, rules, byId, sites } = data;
    if (filter !== 'all' && filter !== 'none' && !sites.some((x) => x.id === filter)) filter = 'all';
    const addTv = (siteId = '') => pairDialog({ fixedClient: state.clientId, siteId, onDone: (s) => go('screen/' + s.id) });

    const filterSel = sites.length ? h('select', { style: { width: 'auto' }, onchange: (e) => { filter = e.target.value; localStorage.setItem('signage.siteFilter.' + state.clientId, filter); paint(); } },
      h('option', { value: 'all', selected: filter === 'all' }, `All sites · ${screens.length} TV${screens.length === 1 ? '' : 's'}`),
      sites.map((x) => h('option', { value: x.id, selected: filter === x.id }, `${x.name} · ${screens.filter((s) => s.site_id === x.id).length} TV${screens.filter((s) => s.site_id === x.id).length === 1 ? '' : 's'}`)),
      screens.some((s) => !s.site_id) ? h('option', { value: 'none', selected: filter === 'none' }, `No site · ${screens.filter((s) => !s.site_id).length}`) : null) : null;

    const head = h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Screens'),
        h('p', { class: 'muted' }, `${screens.length} TV${screens.length === 1 ? '' : 's'}${sites.length ? ` across ${sites.length} site${sites.length === 1 ? '' : 's'}` : ''} for ${clientTitle(client)}`)),
      h('div', { class: 'row' }, filterSel,
        canManage() ? h('button', { class: 'btn', onclick: () => manageSitesDialog(state.clientId, clientTitle(client), refresh) }, 'Sites') : null,
        canManage() ? h('button', { class: 'btn primary', onclick: () => addTv(filter !== 'all' && filter !== 'none' ? filter : '') }, icon('plus'), 'Add a TV') : null));

    if (!screens.length) {
      return main.replaceChildren(head, h('div', { class: 'card empty' },
        h('h2', {}, 'No TVs yet'),
        h('p', {}, canManage() ? `Install the PROVIEW SIGNAGE app on your Android TV or Fire TV stick, open it, and pair it with the code it shows.${sites.length ? '' : ' Add your sites first so you can put each TV in the right place.'}` : 'Your manager hasn’t added any TVs to this account yet.'),
        canManage() ? h('div', { class: 'row', style: { justifyContent: 'center' } },
          sites.length ? null : h('button', { class: 'btn', onclick: () => manageSitesDialog(state.clientId, clientTitle(client), refresh) }, 'Add sites'),
          h('button', { class: 'btn primary', onclick: () => addTv() }, icon('plus'), 'Add a TV')) : null));
    }

    // Groups: one per site (alphabetical), then TVs with no site.
    let groups = sites.map((x) => ({ id: x.id, title: x.name, items: screens.filter((s) => s.site_id === x.id) }));
    const noSite = screens.filter((s) => !s.site_id);
    if (noSite.length) groups.push({ id: 'none', title: sites.length ? 'No site' : null, items: noSite });
    if (filter !== 'all') groups = groups.filter((g) => g.id === filter);

    main.replaceChildren(head, ...groups.map((g) => h('section', { style: { marginBottom: '26px' } },
      g.title ? h('div', { class: 'row between', style: { marginBottom: '10px' } },
        h('h2', {}, g.title, h('span', { class: 'tiny', style: { marginLeft: '8px', fontWeight: 500 } }, `${g.items.length} TV${g.items.length === 1 ? '' : 's'} · ${g.items.filter(isOnline).length} online`)),
        h('div', { class: 'row', style: { gap: '4px' } },
          g.id !== 'none' && g.items.length ? h('button', { class: 'btn sm', onclick: () => siteScheduleDialog({ site: sites.find((x) => x.id === g.id), tvs: g.items, playlists: data.playlists, onDone: refresh, go }) }, icon('calendar'), 'Site schedule') : null,
          canManage() && g.id !== 'none' ? h('button', { class: 'btn sm ghost', onclick: () => addTv(g.id) }, icon('plus'), 'Add TV here') : null)) : null,
      g.items.length ? h('div', { class: 'cards' }, g.items.map((s) => card(s, data.rules, data.byId)))
        : h('div', { class: 'card pad muted small' }, 'No TVs at this site yet.'))));
  };
  const refresh = async () => { data = await loadClientData(state.clientId); paint(); };
  paint();

  const t = setInterval(async () => { try { data = await loadClientData(state.clientId); paint(); } catch {} }, 30000);
  return () => clearInterval(t);
}
