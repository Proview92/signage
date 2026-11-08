import { clientLabel, clientTitle } from '../core.js';
import { publishOrRequest, renameDialog } from '../core.js';
import { sb, state, h, icon, q, rpc, toast, modal, field, select, timeAgo, isOnline, canManage, hasFeature, mediaUrl, needsPublish, currentClient } from '../core.js';
import { renderStill, resolveSchedule, onAirPlaylist, isSlideActive, pausedSet } from '../renderer.js';
import { licenseBadge, LICENCE_PORTAL } from './license-ui.js';
import { loadSites, manageSitesDialog, siteSelect } from './sites-ui.js';
import { ruleForm } from './rule-form.js';
import { licenseState, businessTrial, fmtDate } from '../license.js';
import { emergencyDialog, overridesBanner } from './emergency.js';
import { publishSummary } from './show-on-tvs.js';
import { wallsOf, wallDiagram, wallDialog } from './video-wall.js';
import { validWall } from '../renderer.js';
import { latestApp, appBehind, installedApp, newestFor } from '../app-version.js';
import { sleepBadge, isAsleep } from './sleep-ui.js';

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
  if (screen.device_info?.held && isOnline(screen)) out.push(h('span', { class: 'badge warn', title: 'Someone pressed “Skip to next content” on the TV menu. Choose “Reactivate schedule” on the TV menu to go back to normal.' }, 'Schedule paused on TV'));
  if (validWall(screen.wall)) out.push(h('span', { class: 'badge', title: 'Part of a video wall' }, `Wall: ${screen.wall.name} · row ${screen.wall.y + 1}, screen ${screen.wall.x + 1}`));
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
    siteWrap.replaceChildren(sites.length ? field('Location', siteSelect(sites, site, (v) => (site = v), { noneLabel: '— Choose later —' })) : h('div', { class: 'tiny' }, 'This client has no locations yet. You can add them under Locations.'));
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

  let filter = localStorage.getItem('signage.siteFilter.' + state.clientId) || 'all';

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
        h('div', { class: 'row', style: { gap: '6px' } }, statusBadges(s, rules, byId))));
  };

  // Newest TV app version, for the "Update TVs" button (repaint once it's known).
  let latest = null;
  latestApp().then((v) => { if (v && v !== latest) { latest = v; try { paint(); } catch {} } });

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

  const paint = () => {
    const { screens, rules, byId, sites } = data;
    if (filter !== 'all' && filter !== 'none' && !sites.some((x) => x.id === filter)) filter = 'all';
    const trial = !!currentClient()?.trial_only && !state.me.is_admin;
    const addTv = (siteId = '') => {
      // Free trial: 1 screen. Explain instead of letting the pairing fail.
      if (trial && screens.length >= 1) return modal({ title: 'Your free trial includes 1 screen', body: [
        h('p', {}, 'To add more TVs, buy a licence for your first TV: open it and press “Buy licence online” under Licence.'),
        h('p', { class: 'muted' }, 'Want a price for several screens? Call us on 020 8935 5495.')],
        actions: [{ label: 'Close' }, { label: 'Open my TV', class: 'primary', onClick: () => go('screen/' + screens[0].id) }] });
      return pairDialog({ fixedClient: state.clientId, siteId, onDone: (s) => go('screen/' + s.id) });
    };
    const bt = trial ? businessTrial(currentClient()) : null;
    const trialNote = !trial ? null : bt?.state === 'expired'
      ? h('div', { class: 'notice bad stack', style: { marginBottom: '14px', gap: '8px' } },
          h('div', {}, h('b', {}, `Your free trial ended on ${fmtDate(bt.ends)}. `),
            screens.length ? 'Your TV has stopped playing. Buy a licence for it (open it and press “Buy licence online”) to turn it back on.' : 'Buy a licence to start using your screens.'),
          h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
            screens.length ? h('button', { class: 'btn sm primary', onclick: () => go('screen/' + screens[0].id) }, 'Open my TV') : null,
            h('a', { class: 'btn sm', href: LICENCE_PORTAL, target: '_blank', rel: 'noopener' }, 'Licence portal ↗'),
            h('a', { class: 'btn sm', href: 'tel:02089355495' }, 'Call 020 8935 5495')))
      : h('div', { class: 'notice info', style: { marginBottom: '14px' } },
          h('b', {}, bt?.state === 'active' ? `Free trial · 1 screen · ends ${fmtDate(bt.ends)}. ` : 'Free trial · 1 screen for 3 days. '),
          screens.length ? 'Buy a licence for your TV (open it and press “Buy licence online”) to keep it playing and add more screens.' : 'Install the PROVIEW SIGNAGE app on your TV, open it, then press Add a TV and type the code it shows.');

    const filterSel = sites.length ? h('select', { style: { width: 'auto' }, onchange: (e) => { filter = e.target.value; localStorage.setItem('signage.siteFilter.' + state.clientId, filter); window.dispatchEvent(new Event('signage:sitefilter')); paint(); } },
      h('option', { value: 'all', selected: filter === 'all' }, `All locations · ${screens.length} TV${screens.length === 1 ? '' : 's'}`),
      sites.map((x) => h('option', { value: x.id, selected: filter === x.id }, `${x.name} · ${screens.filter((s) => s.site_id === x.id).length} TV${screens.filter((s) => s.site_id === x.id).length === 1 ? '' : 's'}`)),
      screens.some((s) => !s.site_id) ? h('option', { value: 'none', selected: filter === 'none' }, `No location · ${screens.filter((s) => !s.site_id).length}`) : null) : null;

    const head = h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Screens'),
        h('p', { class: 'muted' }, `${screens.length} TV${screens.length === 1 ? '' : 's'}${sites.length ? ` across ${sites.length} location${sites.length === 1 ? '' : 's'}` : ''} for ${clientTitle(client)}`)),
      h('div', { class: 'row' }, filterSel,
        hasFeature('emergency') && (canManage() || currentClient()?.role === 'site_manager' || !currentClient()?.require_approval) ? h('button', { class: 'btn danger', onclick: () => emergencyDialog({ onDone: refresh }) }, 'Emergency message') : null,
        canManage() ? h('button', { class: 'btn', onclick: () => manageSitesDialog(state.clientId, clientTitle(client), refresh) }, 'Locations') : null,
        canManage() && screens.length >= 2 ? h('button', { class: 'btn', onclick: () => wallDialog({ screens, playlists: data.playlists, onDone: refresh }) }, 'Video wall') : null,
        canManage() && screens.some((s) => installedApp(s)) ? (() => {
          const n = screens.filter((s) => appBehind(s, latest)).length;
          return h('button', { class: 'btn', onclick: () => bulkUpdateDialog(screens), title: n ? `${n} TV${n === 1 ? '' : 's'} can be updated` : 'All TVs run the newest app' },
            icon('refresh'), n ? `Update TVs (${n})` : 'Update TVs');
        })() : null,
        canManage() ? h('button', { class: 'btn primary', onclick: () => addTv(filter !== 'all' && filter !== 'none' ? filter : '') }, icon('plus'), 'Add a TV') : null));

    if (!screens.length) {
      return main.replaceChildren(head, trialNote || '', h('div', { class: 'card empty' },
        h('h2', {}, 'No TVs yet'),
        h('p', {}, canManage() ? `Install the PROVIEW SIGNAGE app on your Android TV or Fire TV stick, open it, and pair it with the code it shows.${sites.length ? '' : ' Add your locations first so you can put each TV in the right place.'}` : 'Your manager hasn’t added any TVs to this account yet.'),
        canManage() ? h('div', { class: 'row', style: { justifyContent: 'center' } },
          sites.length ? null : h('button', { class: 'btn', onclick: () => manageSitesDialog(state.clientId, clientTitle(client), refresh) }, icon('plus'), 'Add location'),
          h('button', { class: 'btn primary', onclick: () => addTv() }, icon('plus'), 'Add a TV')) : null));
    }

    const bannerBox = h('div');
    overridesBanner(refresh).then((b) => b && bannerBox.replaceChildren(b));

    // Groups: one per site (alphabetical), then TVs with no site.
    let groups = sites.map((x) => ({ id: x.id, title: x.name, items: screens.filter((s) => s.site_id === x.id) }));
    const noSite = screens.filter((s) => !s.site_id);
    if (noSite.length) groups.push({ id: 'none', title: sites.length ? 'No location' : null, items: noSite });
    if (filter !== 'all') groups = groups.filter((g) => g.id === filter);

    const walls = wallsOf(screens);
    const wallSection = walls.length ? h('section', { style: { marginBottom: '26px' } },
      h('h2', { style: { marginBottom: '10px' } }, 'Video walls'),
      h('div', { class: 'cards' }, walls.map((w) => h('div', { class: 'card pad wall-card' },
        h('div', { class: 'row between' }, h('h3', {}, w.name), h('span', { class: 'tiny' }, `${w.cols} × ${w.rows} · ${w.tvs.filter(isOnline).length}/${w.tvs.length} online`)),
        wallDiagram(w, screens),
        h('div', { class: 'row between' },
          h('span', { class: 'small muted' }, 'Plays: ' + (data.byId[w.tvs[0]?.default_playlist_id]?.name || 'nothing')),
          canManage() ? h('button', { class: 'btn sm', onclick: () => wallDialog({ wall: w, screens, playlists: data.playlists, onDone: refresh }) }, 'Edit wall') : null))))) : null;

    main.replaceChildren(head, trialNote || '', bannerBox, wallSection || '', ...groups.map((g) => h('section', { style: { marginBottom: '26px' } },
      g.title ? h('div', { class: 'row between', style: { marginBottom: '10px' } },
        h('h2', {}, g.title, h('span', { class: 'tiny', style: { marginLeft: '8px', fontWeight: 500 } }, `${g.items.length} TV${g.items.length === 1 ? '' : 's'} · ${g.items.filter(isOnline).length} online`)),
        h('div', { class: 'row', style: { gap: '4px' } },
          g.id !== 'none' && g.items.length ? h('button', { class: 'btn sm', onclick: () => siteScheduleDialog({ site: sites.find((x) => x.id === g.id), tvs: g.items, playlists: data.playlists, onDone: refresh, go }) }, icon('calendar'), 'Location schedule') : null,
          canManage() && g.id !== 'none' ? h('button', { class: 'btn sm ghost', onclick: () => addTv(g.id) }, icon('plus'), 'Add TV here') : null)) : null,
      g.items.length ? h('div', { class: 'cards' }, g.items.map((s) => card(s, data.rules, data.byId)))
        : h('div', { class: 'card pad muted small' }, 'No TVs at this location yet.'))));
  };
  const refresh = async () => { data = await loadClientData(state.clientId); paint(); };
  paint();

  const t = setInterval(async () => { try { data = await loadClientData(state.clientId); paint(); } catch {} }, 30000);
  return () => clearInterval(t);
}
