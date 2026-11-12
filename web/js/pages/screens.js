import { clientTitle } from '../core.js';
import { publishOrRequest, renameDialog } from '../core.js';
import { headChips, pairedLine } from '../core.js';
import { sb, state, h, icon, q, rpc, toast, modal, field, select, timeAgo, isOnline, canManage, hasFeature, mediaUrl, needsPublish, currentClient } from '../core.js';
import { renderStill, resolveSchedule, onAirPlaylist, isSlideActive, pausedSet } from '../renderer.js';
import { licenseBadge, locationBlockBadge, locationBadge, LICENCE_PORTAL } from './license-ui.js';
import { loadSites, siteSelect } from './sites-ui.js';
import { ruleForm } from './rule-form.js';
import { licenseState, businessTrial, neverLicensed, NO_LICENCE_TEXT, LOCATION_NO_LICENCE_TEXT, fmtDate } from '../license.js';
import { publishSummary } from './show-on-tvs.js';
import { renewOnlineDialog, buyLocationDialog } from './integrations.js';
import { wallsOf, wallDiagram, wallDialog } from './video-wall.js';
import { validWall } from '../renderer.js';
import { latestApp, appBehind, installedApp, newestFor } from '../app-version.js';
import { sleepBadge, isAsleep } from './sleep-ui.js';
import { scanDialog, takePendingPair } from './qr-scan.js';

export async function loadClientData(clientId) {
  const [screens, playlists, rules, sites, groups] = await Promise.all([
    q(sb.from('screens').select('*').eq('client_id', clientId).order('name')),
    q(sb.from('playlists').select('id,name,updated_at,slides,settings').eq('client_id', clientId).order('name')),
    q(sb.from('schedule_items').select('*').eq('client_id', clientId).order('priority', { ascending: false })),
    loadSites(clientId),
    // Sub-categories (migration 049). If the table isn't there yet, the page simply shows no sub-categories.
    sb.from('screen_groups').select('id,name,sort_order').eq('client_id', clientId).order('sort_order').order('name').then((r) => r.error ? [] : (r.data || [])),
  ]);
  // The order set with "Sort TVs" first; TVs with no order yet follow, by name.
  screens.sort((a, b) => (a.sort_order ?? 1e9) - (b.sort_order ?? 1e9) || String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true }));
  return { screens, playlists, rules, sites, groups, byId: Object.fromEntries(playlists.map((p) => [p.id, p])) };
}

/** Owner / Admin and master: make, rename, order and delete TV sub-categories, and choose each TV's sub-category. */
function subCategoriesDialog(clientId, groups, screens, onDone) {
  let list = groups.map((g) => ({ key: g.id, id: g.id, name: g.name }));
  const removed = [];
  let n = 0;
  const pick = Object.fromEntries(screens.map((s) => [s.id, s.group_id || '']));
  const listBox = h('div', { class: 'sort-list', style: { maxHeight: '32vh' } });
  const tvBox = h('div', { class: 'sort-list', style: { maxHeight: '34vh' } });
  const addInput = h('input', { class: 'input', placeholder: 'e.g. E10, Gym, Cafe', maxlength: '60',
    onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } } });
  const add = () => {
    const name = addInput.value.trim().replace(/\s+/g, ' ');
    if (!name) return addInput.focus();
    if (list.some((g) => g.name.toLowerCase() === name.toLowerCase())) return toast(`There is already a sub-category called “${name}”.`, true);
    list.push({ key: 'new' + (++n), id: null, name }); addInput.value = ''; paint(); addInput.focus();
  };
  const move = (i, to) => { if (to < 0 || to >= list.length) return; const [x] = list.splice(i, 1); list.splice(to, 0, x); paint(); };
  const paint = () => {
    listBox.replaceChildren(...(list.length ? list.map((g, i) => h('div', { class: 'sort-row', style: { cursor: 'default' } },
      h('span', { class: 'sort-num' }, String(i + 1)),
      h('input', { class: 'input grow', value: g.name, maxlength: '60', 'aria-label': 'Sub-category name', style: { minWidth: 0 },
        oninput: (e) => { g.name = e.target.value; } }),
      h('span', { class: 'tiny', style: { whiteSpace: 'nowrap' } }, (() => { const c = Object.values(pick).filter((v) => v === g.key).length; return `${c} TV${c === 1 ? '' : 's'}`; })()),
      h('button', { class: 'btn sm icon', type: 'button', disabled: i === 0, 'aria-label': 'Move up', title: 'Move up', onclick: () => move(i, i - 1) }, '↑'),
      h('button', { class: 'btn sm icon', type: 'button', disabled: i === list.length - 1, 'aria-label': 'Move down', title: 'Move down', onclick: () => move(i, i + 1) }, '↓'),
      h('button', { class: 'btn sm icon', type: 'button', 'aria-label': `Delete ${g.name}`, title: 'Delete (its TVs move to Other TVs)',
        onclick: () => { list.splice(i, 1); if (g.id) removed.push(g.id); for (const k in pick) if (pick[k] === g.key) pick[k] = ''; paint(); } }, icon('x'))))
      : [h('div', { class: 'muted small', style: { padding: '6px 2px' } }, 'No sub-categories yet. Add one below.')]));
    tvBox.replaceChildren(...screens.map((s) => h('label', { class: 'sort-row', style: { cursor: 'default' } },
      h('span', { class: 'grow', style: { fontWeight: 600, minWidth: 0 } }, s.name || 'Unnamed TV'),
      h('select', { class: 'input', style: { width: 'auto', maxWidth: '55%' }, 'aria-label': `Sub-category for ${s.name || 'TV'}`,
        onchange: (e) => { pick[s.id] = e.target.value; paint(); } },
        h('option', { value: '', selected: !pick[s.id] }, '— Other TVs —'),
        ...list.map((g) => h('option', { value: g.key, selected: pick[s.id] === g.key }, g.name.trim() || 'Untitled'))))));
  };
  paint();
  modal({ title: 'Sub-categories', wide: true, body: [
    h('p', { class: 'muted small', style: { margin: 0 } }, 'Group this business’s TVs under headings on the Screens page, for example by floor, area or room. Everyone in the business sees them.'),
    listBox,
    h('div', { class: 'row', style: { gap: '8px' } }, addInput, h('button', { class: 'btn', type: 'button', onclick: add }, icon('plus'), 'Add sub-category')),
    h('h3', { style: { margin: '10px 0 0' } }, 'Which TVs go where'),
    tvBox],
    actions: [
      { label: 'Cancel' },
      { label: 'Save', class: 'primary', onClick: async () => {
        for (const g of list) { g.name = g.name.trim().replace(/\s+/g, ' '); if (!g.name) { toast('Every sub-category needs a name.', true); return false; } }
        try {
          for (const id of removed) await rpc('delete_screen_group', { p_client: clientId, p_id: id });
          const idOf = {};
          for (const g of list) {
            const old = groups.find((x) => x.id === g.id);
            idOf[g.key] = (!g.id || old?.name !== g.name) ? await rpc('save_screen_group', { p_client: clientId, p_id: g.id, p_name: g.name }) : g.id;
          }
          if (list.length) await rpc('set_screen_group_order', { p_client: clientId, p_ids: list.map((g) => idOf[g.key]) });
          const byTarget = {};
          for (const s of screens) {
            const want = pick[s.id] ? idOf[pick[s.id]] : null;
            if ((want || null) !== (s.group_id || null) || (s.group_id && removed.includes(s.group_id))) (byTarget[want || ''] ||= []).push(s.id);
          }
          for (const [gid, ids] of Object.entries(byTarget)) await rpc('set_screens_group', { p_client: clientId, p_screen_ids: ids, p_group: gid || null });
        } catch (e) { toast(e.message || String(e), true); onDone?.(); return false; }
        toast('Sub-categories saved'); onDone?.();
      } }] });
}

/** Owner / Admin and master: put the business's TVs in their own order (arrows, or drag a row). */
function sortTvsDialog(screens, onDone) {
  let list = [...screens];
  const box = h('div', { class: 'sort-list' });
  let dragId = null;
  const move = (i, to) => { if (to < 0 || to >= list.length) return; const [x] = list.splice(i, 1); list.splice(to, 0, x); paint(to); };
  const paint = (focus) => {
    box.replaceChildren(...list.map((s, i) => h('div', { class: 'sort-row', draggable: 'true', 'data-id': s.id,
      ondragstart: (e) => { dragId = s.id; e.dataTransfer.effectAllowed = 'move'; e.currentTarget.classList.add('dragging'); },
      ondragend: (e) => { dragId = null; e.currentTarget.classList.remove('dragging'); },
      ondragover: (e) => { e.preventDefault(); },
      ondrop: (e) => { e.preventDefault(); const from = list.findIndex((x) => x.id === dragId); if (from >= 0 && from !== i) move(from, i); } },
      h('span', { class: 'sort-grip', 'aria-hidden': 'true' }, '⋮⋮'),
      h('span', { class: 'sort-num' }, String(i + 1)),
      h('span', { class: 'grow', style: { fontWeight: 600, minWidth: 0 } }, s.name || 'Unnamed TV', h('span', { class: 'tiny', style: { display: 'block', fontWeight: 500 } }, isOnline(s) ? 'Online' : 'Offline')),
      h('button', { class: 'btn sm icon', type: 'button', disabled: i === 0, 'aria-label': 'Move up', title: 'Move up', onclick: () => move(i, i - 1) }, '↑'),
      h('button', { class: 'btn sm icon', type: 'button', disabled: i === list.length - 1, 'aria-label': 'Move down', title: 'Move down', onclick: () => move(i, i + 1) }, '↓'))));
    if (focus != null) box.children[focus]?.scrollIntoView({ block: 'nearest' });
  };
  paint();
  modal({ title: 'Sort TVs', body: [h('p', { class: 'muted small', style: { margin: 0 } }, 'Use the arrows or drag a TV to move it. Everyone in the business sees this order.'), box],
    actions: [
      { label: 'A to Z', onClick: () => { list.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true })); paint(); return false; } },
      { label: 'Cancel' },
      { label: 'Save order', class: 'primary', onClick: async () => {
        try { await rpc('set_screen_order', { p_client: list[0].client_id, p_ids: list.map((s) => s.id) }); }
        catch (e) { toast(e.message || String(e), true); return false; }
        toast('TV order saved'); onDone?.();
      } }] });
}

export function screenThumb(screen, contentOverride) {
  const box = h('div', { class: 'thumb' });
  const content = contentOverride ?? screen.content;
  const { pl } = onAirPlaylist(content, new Date(), pausedSet(screen.paused_playlists));
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
  const zz = sleepBadge(screen);
  // A TV switched off for its sleep hours is expected to be offline: show "Sleeping" instead.
  if (zz && !isOnline(screen)) out.push(zz);
  else { out.push(isOnline(screen) ? h('span', { class: 'badge ok' }, 'Online') : h('span', { class: 'badge bad' }, screen.last_seen ? `Offline · ${timeAgo(screen.last_seen)}` : 'Offline')); if (zz) out.push(zz); }
  if (needsPublish(screen, rules.filter((r) => r.screen_id === screen.id), byId)) out.push(h('span', { class: 'badge warn' }, 'Unpublished changes'));
  out.push(licenseBadge(screen));
  const lb = locationBlockBadge(screen); if (lb) out.push(lb);
  if (screen.device_info?.held && isOnline(screen)) out.push(h('span', { class: 'badge warn', title: 'Someone pressed “Skip to next content” on the TV menu. Choose “Reactivate schedule” on the TV menu to go back to normal.' }, 'Schedule paused on TV'));
  if (validWall(screen.wall)) out.push(h('span', { class: 'badge', title: 'Part of a video wall' }, `Wall: ${screen.wall.name} · row ${screen.wall.y + 1}, screen ${screen.wall.x + 1}`));
  return out;
}

export async function pairDialog({ fixedClient, onDone, siteId = '', code: initialCode = '' }) {
  const code = h('input', { type: 'text', class: 'code-input', maxLength: 6, placeholder: 'ABC123', autocomplete: 'off', autocapitalize: 'characters', value: initialCode });
  const scanBtn = h('button', { type: 'button', class: 'btn', title: 'Scan the QR code on the TV', onclick: () => scanDialog((c) => { code.value = c; name.focus(); }) }, icon('qr'), 'Scan QR');
  const name = h('input', { type: 'text', placeholder: 'e.g. Reception TV' });
  const loc = h('input', { type: 'text', placeholder: 'e.g. Counter, Window (optional)' });
  let clientId = fixedClient || '';
  let site = siteId;
  const siteWrap = h('div');
  const paintSites = async () => {
    site = clientId === fixedClient ? site : '';
    if (!clientId) return siteWrap.replaceChildren();
    // One location per business, named after it: the TV goes there automatically (no picker).
    const sites = await loadSites(clientId).catch(() => []);
    site = sites[0]?.id || '';
    siteWrap.replaceChildren(sites.length > 1 ? field('Location', siteSelect(sites, site, (v) => (site = v))) : null);
  };
  paintSites();
  modal({
    title: 'Add a TV',
    body: [
      h('div', { class: 'notice info' }, initialCode ? `Code ${initialCode} from the TV’s QR code. Give the screen a name and press Pair TV.` : 'Open the PROVIEW SIGNAGE app on the TV. It shows a 6-character code: type it below, or scan the QR code next to it.'),
      field('Pairing code', h('div', { class: 'row', style: { gap: '8px', flexWrap: 'nowrap' } }, code, scanBtn)),
      field('Screen name', name),
      siteWrap,
      field('Position at the location', loc),
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
        if (s.license_type === 'trial7') toast(`${s.name} paired — 3-day trial started`);
        else if (s.license_type) toast(`${s.name} paired`);
        else toast(`${s.name} paired. It needs a licence before it plays: press “Buy licence online” under Licence.${s.trial_blocked_reason ? ` (${s.trial_blocked_reason})` : ''}`);
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
    title: `Location schedule — ${site.name}`,
    body: [
      h('p', { class: 'muted small', style: { margin: 0 } }, `Applies to all ${tvs.length} TV${tvs.length === 1 ? '' : 's'} at this location: ${tvs.map((t) => t.name).join(', ')}.`),
      field('Default playlist', select([['keep', '— Keep each TV’s own —'], ['', 'Nothing (blank screen)'], ...playlists.map((p) => [p.id, p.name])], def, (v) => (def = v)),
        'Plays whenever no schedule rule applies.'),
      field('Schedule rules', modeSel),
      ruleWrap,
      h('label', { class: 'row small', style: { fontWeight: 600 } }, h('input', { type: 'checkbox', checked: publish, onchange: (e) => (publish = e.target.checked) }), 'Publish to the TVs now'),
      expired.length ? h('div', { class: 'notice' }, `${expired.length} TV${expired.length === 1 ? ' has' : 's have'} no valid licence and won't be published to: ${expired.map((t) => t.name).join(', ')}.`) : null,
    ],
    actions: [
      { label: 'Cancel' },
      { label: 'Apply to location', class: 'primary', onClick: async () => {
        const rule = ['add', 'replace'].includes(mode) ? form.read() : null;
        if (def === 'keep' && mode === 'none' && !publish) return;
        const ids = tvs.map((t) => t.id);
        if (def !== 'keep') await q(sb.from('screens').update({ default_playlist_id: def || null }).in('id', ids));
        if (mode === 'replace' || mode === 'clear') await q(sb.from('schedule_items').delete().in('screen_id', ids));
        if (rule) await q(sb.from('schedule_items').insert(ids.map((sid) => ({ ...rule, screen_id: sid, client_id: state.clientId }))));
        let ok = 0, pending = 0; const failed = [];
        if (publish) {
          for (const t of tvs) {
            try { const r = await publishOrRequest('screen', t.id, t.name); if (r.pending) pending++; else ok++; } catch { failed.push(t.name); }
          }
        }
        toast(!publish ? 'Applied. Publish when ready.' : pending ? `Applied. ${pending} TV${pending === 1 ? '' : 's'} sent to your manager for approval.`
          : `Applied and published to ${ok} TV${ok === 1 ? '' : 's'}${failed.length ? ` (not published: ${failed.join(', ')})` : ''}`, failed.length > 0);
        onDone?.();
      } },
    ],
  });
}

export async function screensPage({ main, go }) {
  const client = currentClient();
  let data = await loadClientData(state.clientId);

  // The whole business, grouped by location (the header lists businesses only: MULTI_BUSINESS_PICKER_STANDARD 07:47).
  let filter = 'all';

  // "Playing: [playlist ▾]" on each TV card: switch and go live in one click.
  const quickPlaylist = (s, now, rule) => {
    const sel = h('select', { class: 'quick-pl', title: 'Change what this TV plays', onclick: (e) => { e.preventDefault(); e.stopPropagation(); },
      onchange: async (e) => {
        const v = e.target.value;
        if (v === '__new') { go('playlists'); return; }
        sel.disabled = true;
        try {
          // A TV in a video wall switches the whole wall, so they stay together.
          const group = validWall(s.wall) ? data.screens.filter((x) => x.wall?.id === s.wall.id) : [s];
          await q(sb.from('screens').update({ default_playlist_id: v || null }).in('id', group.map((x) => x.id)));
          let r = { pending: false };
          for (const x of group) { const rr = await publishOrRequest('screen', x.id, x.name); if (rr.pending) r = rr; }
          toast(r.pending ? publishSummary({ ok: 0, pending: 1, failed: [] }) : `${s.name}: now showing ${data.byId[v]?.name || 'nothing'}`);
          await refresh();
        } catch (err) { toast(err.message, true); sel.disabled = false; }
      } },
      h('option', { value: '' }, '— Nothing —'),
      data.playlists.map((p) => h('option', { value: p.id, selected: p.id === s.default_playlist_id }, p.name)),
      h('option', { value: '__new' }, '+ Create a playlist…'));
    return h('div', { class: 'small muted row', style: { gap: '6px', flexWrap: 'nowrap' }, onclick: (e) => { e.preventDefault(); e.stopPropagation(); } },
      h('span', {}, 'Playing'), sel,
      (s.also_playlist_ids || []).length ? h('span', { class: 'tiny', title: (s.also_playlist_ids || []).map((i) => data.byId[i]?.name).filter(Boolean).join(', ') }, `+${s.also_playlist_ids.length}`) : null,
      rule?.label && now ? h('span', { class: 'tiny', title: 'A schedule rule is on air right now' }, `⏱ ${rule.label}`) : null);
  };

  const card = (s, rules, byId) => {
    const { playlistId, rule } = resolveSchedule(s.content);
    const now = playlistId ? s.content.playlists[playlistId]?.name : null;
    return h('a', { class: 'card screen-card', href: '#/screen/' + s.id },
      screenThumb(s),
      h('div', { class: 'screen-meta' },
        h('div', { class: 'row between' }, h('div', { class: 'row name-edit', style: { gap: '4px', flexWrap: 'nowrap', minWidth: 0 } }, h('h3', {}, s.name),
          canManage() ? h('button', { class: 'btn ghost icon sm', title: 'Rename', 'aria-label': 'Rename TV', onclick: (e) => { e.preventDefault(); e.stopPropagation(); renameDialog('Rename TV', s.name, async (v) => {
            await q(sb.from('screens').update({ name: v }).eq('id', s.id)); toast('Renamed'); await refresh();
          }); } }, icon('edit')) : null), h('span', { class: 'tiny' }, s.location || '')),
        quickPlaylist(s, now, rule),
        pairedLine(s) ? h('div', { class: 'tiny muted', title: 'Use this to tell TVs apart' }, pairedLine(s)) : null,
        h('div', { class: 'row', style: { gap: '6px' } }, statusBadges(s, rules, byId))));
  };

  // Newest TV app version, for the "Update TVs" button (repaint once it's known).
  let latest = null;
  latestApp().then((v) => { if (v && v !== latest) { latest = v; try { paint(); } catch {} } });

  // Reload every TV shown (same as Reload TV on each TV's page): each restarts its app within about a minute.
  function reloadAllDialog(tvs) {
    if (!tvs.length) return toast('No TVs here to reload', true);
    const off = tvs.filter((s) => !isOnline(s)).length;
    modal({
      title: `Reload ${tvs.length} TV${tvs.length === 1 ? '' : 's'}`,
      body: [
        h('p', {}, 'Each TV restarts the PROVIEW SIGNAGE app and loads its content again. The screen goes blank for a few seconds.'),
        off ? h('p', { class: 'muted small' }, `${off} of them ${off === 1 ? 'is' : 'are'} offline and will reload when ${off === 1 ? 'it comes' : 'they come'} back online.`) : null,
        h('div', { class: 'list', style: { marginTop: '10px' } }, tvs.map((s) => h('div', { class: 'row between', style: { padding: '8px 0', borderBottom: '1px solid var(--line)' } },
          h('b', {}, s.name), h('span', { class: 'tiny' }, isOnline(s) ? 'Online' : 'Offline')))),
      ],
      actions: [{ label: 'Cancel' }, { label: `Reload ${tvs.length} TV${tvs.length === 1 ? '' : 's'}`, class: 'primary', onClick: async () => {
        await q(sb.from('screens').update({ reload_at: new Date().toISOString() }).in('id', tvs.map((s) => s.id)));
        toast(`Reload sent to ${tvs.length} TV${tvs.length === 1 ? '' : 's'}`);
      } }],
    });
  }

  function bulkUpdateDialog(screens) {
    const androidTvs = screens.filter((s) => installedApp(s));
    const behind = androidTvs.filter((s) => appBehind(s, latest));
    const list = behind.length ? behind : androidTvs;
    if (!androidTvs.length) return toast('None of these TVs run the PROVIEW SIGNAGE Android app yet', true);
    modal({
      title: behind.length ? `Update ${behind.length} TV${behind.length === 1 ? '' : 's'}` : 'All TVs are up to date',
      body: [
        h('p', {}, behind.length
          ? `These TVs will download and install the newest app${latest ? ` (${latest})` : ''}. Some TVs ask you to press OK on the remote to finish installing.`
          : `Every TV already runs the newest app${latest ? ` (${latest})` : ''}. You can still ask them all to check again.`),
        h('div', { class: 'list', style: { marginTop: '10px' } }, list.map((s) => h('div', { class: 'row between', style: { padding: '8px 0', borderBottom: '1px solid var(--line)' } },
          h('span', {}, h('b', {}, s.name), isOnline(s) ? '' : h('span', { class: 'tiny', style: { marginLeft: '8px' } }, 'offline: updates when it next starts')),
          h('span', { class: 'tiny' }, installedApp(s) + (appBehind(s, latest) ? ` → ${newestFor(s, latest)}` : ' ✓'))))),
      ],
      actions: [{ label: 'Cancel' }, { label: behind.length ? `Update ${behind.length} TV${behind.length === 1 ? '' : 's'}` : 'Check all again', class: 'primary', onClick: async () => {
        await q(sb.from('screens').update({ update_requested_at: new Date().toISOString() }).in('id', list.map((s) => s.id)));
        toast(`Update sent to ${list.length} TV${list.length === 1 ? '' : 's'}. Each TV installs it in the next minute or two.`);
      } }],
    });
  }

  let pendingDone = false;
  const paint = () => {
    const { screens, rules, byId, sites } = data;
    if (filter !== 'all' && filter !== 'none' && !sites.some((x) => x.id === filter)) filter = 'all';
    const trial = !!currentClient()?.trial_only && !state.me.is_admin;
    const addTv = (siteId = '', pairCode = '') => {
      // Free trial: 1 screen. Explain instead of letting the pairing fail.
      if (trial && screens.length >= 1) return modal({ title: 'Your free trial includes 1 screen', body: [
        h('p', {}, 'To add more TVs, buy a licence for your first TV: open it and press “Buy licence online” under Licence.'),
        h('p', { class: 'muted' }, 'Want a price for several screens? Call us on 020 8935 5495.')],
        actions: [{ label: 'Close' }, { label: 'Open my TV', class: 'primary', onClick: () => go('screen/' + screens[0].id) }] });
      return pairDialog({ fixedClient: state.clientId, siteId, code: pairCode, onDone: (s) => go('screen/' + s.id) });
    };
    const bt = trial ? businessTrial(currentClient()) : null;
    // Never licensed (every business set up since 042): the buy screen, never "Trial ended".
    const noLicence = !state.me.is_admin && neverLicensed(currentClient(), screens);
    const trialNote = noLicence
      ? h('div', { class: 'notice bad stack nolicence', style: { marginBottom: '14px', gap: '8px' } },
          h('div', {}, h('b', {}, NO_LICENCE_TEXT + '. '),
            screens.length ? 'Each business needs its own licence, and each TV too. Buy your business licence below, then open your TV and press “Buy licence online” under Licence. It plays as soon as both are licensed.'
              : 'Each business needs its own licence, and each TV too. Buy your business licence below. Then install the PROVIEW SIGNAGE app on your TV, open it, press Add a TV, type the code it shows and buy the TV’s licence online.'),
          h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
            screens.length && canManage() ? h('button', { class: 'btn sm primary', onclick: () => renewOnlineDialog(screens.find((x) => !x.license_type) || screens[0]).catch((e) => toast(e.message || String(e), true)) },
              screens.length === 1 ? 'Buy licence online' : `Buy licence: ${(screens.find((x) => !x.license_type) || screens[0]).name}`) : null,
            // (non-masters only here: no licence-portal link, owner 11 Nov 2026; the business licence's Buy button is below)
            h('span', { class: 'muted small', style: { alignSelf: 'center' } },
              screens.length && canManage() ? 'or call ' : canManage() ? 'Or call Proview on ' : 'Ask your owner to buy it, or call Proview on ',
              h('a', { href: 'tel:02089355495' }, '020 8935 5495'))))
      : !trial ? null : bt?.state === 'expired'
      ? h('div', { class: 'notice bad stack', style: { marginBottom: '14px', gap: '8px' } },
          h('div', {}, h('b', {}, `Your free trial ended on ${fmtDate(bt.ends)}. `),
            screens.length ? 'Your TV has stopped playing. Buy a licence for it (open it and press “Buy licence online”) to turn it back on.' : 'Buy a licence to start using your screens.'),
          h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
            screens.length && canManage() ? h('button', { class: 'btn sm primary', onclick: () => renewOnlineDialog(screens[0]).catch((e) => toast(e.message || String(e), true)) }, 'Buy licence online') : null,
            screens.length ? h('button', { class: 'btn sm' + (canManage() ? '' : ' primary'), onclick: () => go('screen/' + screens[0].id) }, 'Open my TV') : null,
            h('a', { class: 'btn sm', href: 'tel:02089355495' }, 'Call 020 8935 5495')))
      : h('div', { class: 'notice info', style: { marginBottom: '14px' } },
          h('b', {}, bt?.state === 'active' ? `Free trial · 1 screen · ends ${fmtDate(bt.ends)}. ` : 'Free trial · 1 screen for 3 days. '),
          screens.length ? 'Buy a licence for your TV (open it and press “Buy licence online”) to keep it playing and add more screens.' : 'Install the PROVIEW SIGNAGE app on your TV, open it, then press Add a TV and type the code it shows.');

    // Location licences (migration 045): every location needs its own licence, and each TV needs its own on top.
    // Owners see each location's licence with Buy / Renew online; the master manages them in the licence portal.
    const shownSites = sites.filter((x) => 'license_type' in x && (filter === 'all' || filter === 'none' || x.id === filter));
    const locBad = (x) => ['none', 'expired', 'grace', 'expiring'].includes(licenseState(x).state);
    const locNote = shownSites.length ? h('div', { class: 'card pad stack loc-licences' + (shownSites.some((x) => ['none', 'expired'].includes(licenseState(x).state)) ? ' bad' : ''), style: { marginBottom: '14px', gap: '8px' } },
      h('div', { class: 'row between' }, h('b', {}, shownSites.length === 1 ? 'Business licence' : 'Business licences'),
        h('span', { class: 'tiny' }, 'Each business needs its own licence, and each TV its own too.')),
      ...shownSites.map((x) => {
        const L = licenseState(x), blocked = ['none', 'expired'].includes(L.state);
        return h('div', { class: 'row between loc-lic-row', style: { gap: '8px', flexWrap: 'wrap' } },
          h('span', { class: 'grow', style: { fontWeight: 600 } }, x.name, blocked ? h('span', { class: 'tiny', style: { display: 'block', fontWeight: 500 } }, LOCATION_NO_LICENCE_TEXT + '.') : null),
          locationBadge(x),
          state.me.is_admin ? h('a', { class: 'btn sm', href: LICENCE_PORTAL, target: '_blank', rel: 'noopener' }, 'Licence portal ↗')
            : canManage() && L.state !== 'lifetime' ? h('button', { class: 'btn sm' + (locBad(x) ? ' primary' : ''), onclick: () => buyLocationDialog(x).catch((e) => toast(e.message || String(e), true)) },
              !x.license_type || x.license_type === 'trial7' ? 'Buy business licence online' : 'Renew online') : null);
      }),
      shownSites.some((x) => ['none', 'expired'].includes(licenseState(x).state)) && !state.me.is_admin
        ? h('span', { class: 'muted small' }, 'or call ', h('a', { href: 'tel:02089355495' }, '020 8935 5495')) : null) : null;

    // The location is picked in the top header dropdown (no second picker here).
    const head = h('div', { class: 'page-head' },
      headChips(`${screens.length} TV${screens.length === 1 ? '' : 's'}`,
        screens.length ? [`${screens.filter(isOnline).length} online`, 'ok'] : null,
        sites.length > 1 ? `${sites.length} locations` : null,
        clientTitle(client)),
      h('div', { class: 'row' },
        canManage() && screens.length >= 2 ? h('button', { class: 'btn', onclick: () => wallDialog({ screens, playlists: data.playlists, onDone: refresh }) }, 'Video wall') : null,
        canManage() && screens.some((s) => installedApp(s)) ? (() => {
          const n = screens.filter((s) => appBehind(s, latest)).length;
          return h('button', { class: 'btn', onclick: () => bulkUpdateDialog(screens), title: n ? `${n} TV${n === 1 ? '' : 's'} can be updated` : 'All TVs run the newest app' },
            icon('refresh'), n ? `Update TVs (${n})` : 'Update TVs');
        })() : null,
        canManage() && screens.length ? h('button', { class: 'btn', onclick: () => reloadAllDialog(filter !== 'all' && filter !== 'none' ? screens.filter((x) => x.site_id === filter) : filter === 'none' ? screens.filter((x) => !x.site_id) : screens), title: 'Restart the TV app on every TV here' }, icon('refresh'), 'Reload TVs') : null,
        canManage() ? h('button', { class: 'btn', title: 'Scan the QR code on the TV’s pairing screen', onclick: () => scanDialog((c) => addTv(filter !== 'all' && filter !== 'none' ? filter : '', c)) }, icon('qr'), 'Scan QR') : null,
        canManage() ? h('button', { class: 'btn primary', onclick: () => addTv(filter !== 'all' && filter !== 'none' ? filter : '') }, icon('plus'), 'Add a TV') : null));
    // Came from a TV's QR code (scanned with the phone camera): open Add a TV with the code filled in, once.
    if (!pendingDone) {
      pendingDone = true;
      const pc = takePendingPair();
      if (pc) {
        if (canManage()) setTimeout(() => addTv(filter !== 'all' && filter !== 'none' ? filter : '', pc), 50);
        else toast('Only an owner or admin of this business can add TVs. Ask them to scan the code.', true);
      }
    }

    if (!screens.length) {
      return main.replaceChildren(head, trialNote || '', locNote || '', h('div', { class: 'card empty' },
        h('h2', {}, 'No TVs yet'),
        h('p', {}, canManage() ? `Install the PROVIEW SIGNAGE app on your Android TV or Fire TV stick, open it, and pair it with the code it shows.${sites.length ? '' : ' Businesses are set up by Proview.'}` : 'Your manager hasn’t added any TVs to this account yet.'),
        canManage() ? h('div', { class: 'row', style: { justifyContent: 'center' } },
          h('button', { class: 'btn primary', onclick: () => addTv() }, icon('plus'), 'Add a TV')) : null));
    }

    const bannerBox = h('div');

    // Groups: one per site (alphabetical), then TVs with no site.
    let groups = sites.map((x) => ({ id: x.id, title: x.name, items: screens.filter((s) => s.site_id === x.id) }));
    const noSite = screens.filter((s) => !s.site_id);
    if (noSite.length) groups.push({ id: 'none', title: sites.length ? 'No location' : null, items: noSite });
    if (filter !== 'all') groups = groups.filter((g) => g.id === filter);

    // TVs of one location, under their sub-category headings (TVs in none: "Other TVs"; no headings at all when unused).
    const subSections = (items) => {
      const cards = (list) => h('div', { class: 'cards' }, list.map((s) => card(s, data.rules, data.byId)));
      const gs = (data.groups || []).filter((x) => items.some((s) => s.group_id === x.id));
      if (!gs.length) return cards(items);
      const rest = items.filter((s) => !gs.some((x) => x.id === s.group_id));
      const sub = (title, list) => h('div', { class: 'tv-subcat' },
        h('h3', { class: 'tv-subcat-head' }, title, h('span', { class: 'tiny', style: { marginLeft: '8px', fontWeight: 500 } }, `${list.length} TV${list.length === 1 ? '' : 's'} · ${list.filter(isOnline).length} online`)),
        cards(list));
      return h('div', {}, ...gs.map((x) => sub(x.name, items.filter((s) => s.group_id === x.id))), rest.length ? sub('Other TVs', rest) : null);
    };

    const walls = wallsOf(screens);
    const wallSection = walls.length ? h('section', { style: { marginBottom: '26px' } },
      h('h2', { style: { marginBottom: '10px' } }, 'Video walls'),
      h('div', { class: 'cards' }, walls.map((w) => h('div', { class: 'card pad wall-card' },
        h('div', { class: 'row between' }, h('h3', {}, w.name), h('span', { class: 'tiny' }, `${w.cols} × ${w.rows} · ${w.tvs.filter(isOnline).length}/${w.tvs.length} online`)),
        wallDiagram(w, screens),
        h('div', { class: 'row between' },
          h('span', { class: 'small muted' }, 'Plays: ' + (data.byId[w.tvs[0]?.default_playlist_id]?.name || 'nothing')),
          canManage() ? h('button', { class: 'btn sm', onclick: () => wallDialog({ wall: w, screens, playlists: data.playlists, onDone: refresh }) }, 'Edit wall') : null))))) : null;

    main.replaceChildren(head, trialNote || '', locNote || '', bannerBox, wallSection || '', ...groups.map((g) => h('section', { style: { marginBottom: '26px' } },
      g.title ? h('div', { class: 'row between', style: { marginBottom: '10px' } },
        h('h2', {}, g.title, h('span', { class: 'tiny', style: { marginLeft: '8px', fontWeight: 500 } }, `${g.items.length} TV${g.items.length === 1 ? '' : 's'} · ${g.items.filter(isOnline).length} online`)),
        h('div', { class: 'row', style: { gap: '4px' } },
          canManage() && g.items.length ? h('button', { class: 'btn sm ghost', title: 'Group TVs under headings such as floor, area or room', onclick: () => subCategoriesDialog(state.clientId, data.groups || [], screens, refresh) }, icon('plus'), 'Sub-categories') : null,
          canManage() && g.items.length >= 2 ? h('button', { class: 'btn sm ghost', title: 'Choose the order the TVs are listed in', onclick: () => sortTvsDialog(g.items, refresh) }, h('span', { 'aria-hidden': 'true', style: { fontWeight: 700 } }, '↕'), 'Sort TVs') : null)) : null,
      g.items.length ? subSections(g.items)
        : h('div', { class: 'card pad muted small' }, 'No TVs at this location yet.'))));
  };
  const refresh = async () => { data = await loadClientData(state.clientId); paint(); };
  paint();

  const t = setInterval(async () => { try { data = await loadClientData(state.clientId); paint(); } catch {} }, 30000);
  return () => clearInterval(t);
}
