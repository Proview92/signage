import { fmtWhen, tvId } from '../core.js';
import { sb, state, h, icon, q, rpc, toast, modal, field, select, confirmBox, timeAgo, canManage, hasFeature, mediaUrl, draftContent, colorFor, setClient } from '../core.js';
import { SlidePlayer, LayoutPlayer, onAirPlaylist, pausedSet, resolveSchedule, describeRule, DAY_NAMES, localDate, zonePlaylistIds } from '../renderer.js';
import { statusBadges } from './screens.js';
import { publishOrRequest } from '../core.js';
import { ruleForm } from './rule-form.js';
import { loadSites, siteSelect } from './sites-ui.js';
import { licenseBanner, licensePortalButton } from './license-ui.js';
import { renewOnlineDialog } from './integrations.js';
import { licenseState, licenseSummary, licenseLabel, fmtDate, tvLocationLicence } from '../license.js';
import { latestApp, newestFor, installedApp, appBehind } from '../app-version.js';
import { sleepCard } from './sleep-ui.js';
import { loadPauses, pauseBadge, pauseControls } from './playlist-pause.js';

export async function screenPage({ main, params: [id], go, rerender }) {
  let sites = [], screen, playlists, rules, byId, player = null, tick = null, latest = null, pauses = {};

  const load = async () => {
    [screen, playlists, rules, sites] = await Promise.all([
      q(sb.from('screens').select('*').eq('id', id).single()),
      q(sb.from('playlists').select('id,name,updated_at,slides,settings').eq('client_id', state.clientId).order('name')),
      q(sb.from('schedule_items').select('*').eq('screen_id', id).order('priority', { ascending: false }).order('created_at', { ascending: false })),
      loadSites(state.clientId).catch(() => []),
      latestApp().then((v) => { latest = v; }),
      loadPauses().then((v) => { pauses = v; }),
    ]);
    byId = Object.fromEntries(playlists.map((p) => [p.id, p]));
  };
  await load();
  if (!screen.client_id) { toast('This TV has been unlinked. Pair it again from Screens → Add a TV.', true); return go('screens'); }
  if (screen.client_id !== state.clientId) { setClient(screen.client_id); return rerender(); }

  const plIds = () => playlists.map((p) => p.id);

  // Changes on this page go live straight away (or go for approval).
  async function goLive() {
    try {
      const r = await publishOrRequest('screen', id, screen.name);
      toast(r.pending ? 'Saved. Sent to your manager for approval' : 'Saved and live on the TV');
      await load(); paint();
    } catch (e) { toast('Saved, but the TV wasn’t updated: ' + (e.message || e), true); }
  }

  async function publish() {
    const r = await publishOrRequest('screen', id, screen.name);
    toast(r.pending ? 'Sent to your manager for approval. It goes live once they approve it.' : 'Published — the TV will update in a few seconds');
    await load(); paint();
  }

  function editDetails() {
    const name = h('input', { type: 'text', value: screen.name });
    const loc = h('input', { type: 'text', value: screen.location || '', placeholder: 'e.g. Counter, Window' });
    let site = screen.site_id || '';
    let rotation = String(screen.rotation || 0);
    const shown = screen.device_info?.display;
    modal({ title: 'Screen details', body: [field('Name', name),
      sites.length ? field('Location', siteSelect(sites, site, (v) => (site = v))) : h('div', { class: 'tiny' }, 'No locations yet: managers can add them on the Screens page.'),
      field('Position at the location', loc),
      field('Screen rotation', select([['0', 'Automatic (use the TV’s own setting)'], ['90', 'Turn 90° clockwise'], ['270', 'Turn 90° anticlockwise'], ['180', 'Upside down (180°)']], rotation, (v) => (rotation = v)),
        `Leave on Automatic unless the TV is mounted on its side and the picture comes out sideways.${shown ? ` The TV currently reports a ${shown} screen.` : ''}`)], actions: [
      { label: 'Cancel' },
      { label: 'Save', class: 'primary', onClick: async () => {
        await q(sb.from('screens').update({ name: name.value.trim() || 'Screen', location: loc.value.trim() || null, site_id: site || null, rotation: Number(rotation) }).eq('id', id));
        await load(); paint();
      } }] });
  }

  async function unpair() {
    if (!(await confirmBox('Remove this TV?', 'The TV will go back to showing a pairing code. Its schedule will be deleted.', 'Remove TV'))) return;
    await rpc('unpair_screen', { p_screen: id });
    toast('TV removed'); go('screens');
  }

  async function updateApp() {
    await q(sb.from('screens').update({ update_requested_at: new Date().toISOString() }).eq('id', id));
    toast('Update check sent. If a newer app is out, the TV shows an update screen: press OK on the remote to install.');
  }

  async function reloadTv() {
    await q(sb.from('screens').update({ reload_at: new Date().toISOString() }).eq('id', id));
    toast('Reload sent to the TV');
  }

  function ruleDialog(rule) {
    if (!playlists.length) { toast('Create a playlist first', true); return go('playlists'); }
    const form = ruleForm(playlists, rule);
    modal({
      title: rule ? 'Edit schedule rule' : 'Add schedule rule',
      body: form.body,
      actions: [
        rule ? { label: 'Delete', class: 'danger', onClick: async () => { await q(sb.from('schedule_items').delete().eq('id', rule.id)); await load(); paint(); goLive(); } } : null,
        { label: 'Cancel' },
        { label: rule ? 'Save rule' : 'Add rule', class: 'primary', onClick: async () => {
          const row = { screen_id: id, client_id: state.clientId, ...form.read() };
          if (rule) await q(sb.from('schedule_items').update(row).eq('id', rule.id));
          else await q(sb.from('schedule_items').insert(row));
          await load(); paint(); goLive();
        } },
      ].filter(Boolean),
    });
  }

  function weekView(content) {
    const wrap = h('div', { class: 'week' });
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const now = new Date();
    for (let d = 0; d < 7; d++) {
      const day = new Date(start); day.setDate(start.getDate() + d);
      const track = h('div', { class: 'track' });
      let segStart = 0, cur;
      const STEP = 15;
      for (let m = 0; m <= 1440; m += STEP) {
        const t = new Date(day); t.setMinutes(m);
        const pid = m < 1440 ? resolveSchedule(content, t).playlistId : '__end';
        if (m === 0) { cur = pid; continue; }
        if (pid !== cur) {
          if (cur) {
            const w = (m - segStart) / 1440 * 100;
            track.append(h('div', { class: 'seg-bar', title: `${byId[cur]?.name} ${fmtM(segStart)}–${fmtM(m)}`, style: { left: (segStart / 1440 * 100) + '%', width: w + '%', background: colorFor(cur, plIds()) } }, w > 9 ? byId[cur]?.name || '' : ''));
          }
          segStart = m; cur = pid;
        }
      }
      if (d === 0) track.append(h('div', { class: 'now-line', style: { left: ((now.getHours() * 60 + now.getMinutes()) / 1440 * 100) + '%' } }));
      wrap.append(h('div', { class: 'day' }, d === 0 ? 'Today' : day.toLocaleDateString(undefined, { weekday: 'short' })), track);
    }
    wrap.append(h('div'), h('div', { class: 'hours' }, ['00', '06', '12', '18', '24'].map((x) => h('span', {}, x))));
    return wrap;
  }
  const fmtM = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

  function startPreview(box) {
    player?.stop();
    const { pl } = onAirPlaylist(screen.content, new Date(), pausedSet(screen.paused_playlists));
    box.replaceChildren();
    if (!pl) { box.append(h('div', { class: 'thumb' }, h('div', { class: 'blank' }, screen.content ? 'Nothing scheduled right now' : 'Nothing published yet'))); return; }
    const stage = h('div', { class: 'preview-box' + (pl.settings?.orientation === 'portrait' ? ' portrait' : '') });
    box.append(stage);
    player = new LayoutPlayer(stage, { resolveUrl: (s) => mediaUrl(s.path), mutedOverride: true, lookup: (pid) => screen.content?.playlists?.[pid] || null });
    player.load(pl);
    player.start();
  }

  function paint() {
    const draft = draftContent(screen, rules, byId);
    const live = onAirPlaylist(screen.content, new Date(), pausedSet(screen.paused_playlists));
    const liveName = live.name;
    const dinfo = screen.device_info || {};

    const head = h('div', { class: 'page-head' },
      h('div', {},
        h('div', { class: 'crumb' }, h('a', { href: '#/screens' }, 'Screens'), ' / ', screen.name),
        h('div', { class: 'row' }, h('h1', {}, screen.name), h('button', { class: 'btn ghost icon sm', onclick: editDetails, 'aria-label': 'Edit details' }, icon('edit'))),
        h('div', { class: 'row', style: { marginTop: '6px', gap: '6px' } }, statusBadges(screen, rules, byId), (() => { const t = [sites.find((x) => x.id === screen.site_id)?.name, screen.location].filter(Boolean).join(' · '); return t ? h('span', { class: 'tiny' }, t) : null; })())),
      h('div', { class: 'row' },
        (() => {
          const installed = installedApp(screen);
          if (!installed) return null;
          // Compare with the newest version ourselves: the TV's own "update available" note can be hours old.
          const best = newestFor(screen, latest), behind = appBehind(screen, latest);
          return h('button', { class: 'btn' + (behind ? ' primary' : ''), onclick: updateApp, title: behind ? `Installed: ${installed}` : `Installed: ${installed} (up to date)` },
            behind ? `Update app to ${best}` : `App ${installed} ✓`);
        })(),
        h('button', { class: 'btn', onclick: reloadTv, title: 'Force the TV app to reload' }, icon('refresh'), 'Reload TV'),
        h('button', { class: 'btn primary', onclick: publish, disabled: licenseState(screen).state === 'expired', title: licenseState(screen).state === 'expired' ? 'Licence expired' : '' }, icon('send'), 'Re-send to TV')));

    const preview = h('div');
    const onair = h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'On air now'), h('span', { class: 'tiny' }, screen.published_at ? `Published ${timeAgo(screen.published_at)}` : 'Never published')),
      h('div', { class: 'card-body stack' },
        preview,
        h('div', { class: 'onair' }, h('span', { class: 'live' }, 'LIVE'),
          h('div', { class: 'grow' }, h('div', { style: { fontWeight: 700 } }, liveName || 'Nothing playing'),
            h('div', { class: 'tiny', style: { color: '#aaa' } }, live.rule ? `${live.rule.label || 'Schedule rule'} · ${describeRule(live.rule)}` : liveName ? 'Default playlist' : 'Set a default playlist or add a rule, then publish')))));

    const defSel = select([['', '— Nothing (blank screen) —'], ...playlists.map((p) => [p.id, p.name])], screen.default_playlist_id || '', async (v) => {
      await q(sb.from('screens').update({ default_playlist_id: v || null }).eq('id', id));
      await load(); paint(); goLive();
    });

    function alsoBox() {
      const also = (screen.also_playlist_ids || []).filter((x) => byId[x]);
      const save = async (list) => { await q(sb.from('screens').update({ also_playlist_ids: list }).eq('id', id)); await load(); paint(); goLive(); };
      const others = playlists.filter((p) => p.id !== screen.default_playlist_id && !also.includes(p.id));
      return h('div', { class: 'stack', style: { gap: '6px' } },
        h('div', { class: 'small', style: { fontWeight: 600, color: 'var(--ink-2)' } }, 'Also plays after it (add-ons)'),
        also.length ? h('div', { class: 'chips' }, also.map((pid) => h('span', { class: 'chip on', style: { display: 'inline-flex', gap: '6px', alignItems: 'center' } }, byId[pid].name,
          h('button', { type: 'button', title: 'Remove', style: { background: 'none', border: 0, color: 'inherit', cursor: 'pointer', padding: 0, fontSize: '15px' },
            onclick: () => save(also.filter((x) => x !== pid)) }, '×'))))
          : h('div', { class: 'tiny' }, 'None. The default playlist plays on its own.'),
        screen.default_playlist_id && others.length ? h('div', {}, h('select', { style: { width: 'auto' }, onchange: (e) => e.target.value && save([...also, e.target.value]) },
          h('option', { value: '' }, '+ Add another playlist…'), others.map((p) => h('option', { value: p.id }, p.name)))) : null);
    }

    const sched = h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('div', {}, h('h2', {}, 'Schedule'), h('div', { class: 'tiny' }, 'Times are the TV’s local time. Changes go live on the TV straight away.')),
        h('button', { class: 'btn sm primary', onclick: () => ruleDialog() }, icon('plus'), 'Add rule')),
      h('div', { class: 'card-body stack' },
        field('Default playlist', defSel, 'Plays whenever no schedule rule applies.'),
        alsoBox(),
        h('div', {}, h('h3', { style: { marginBottom: '10px' } }, 'Next 7 days'), weekView(draft))),
      h('div', { class: 'list' },
        rules.length ? rules.map((r) => h('div', { class: 'rule' + (r.enabled ? '' : ' off') },
          h('div', { class: 'dot', style: { background: colorFor(r.playlist_id, plIds()) } }),
          h('div', { style: { minWidth: 0 } },
            h('div', { style: { fontWeight: 650 } }, r.label || byId[r.playlist_id]?.name || 'Rule',
              r.priority >= 100 ? h('span', { class: 'badge plain', style: { marginLeft: '8px' } }, 'Override') : r.priority >= 10 ? h('span', { class: 'badge plain', style: { marginLeft: '8px' } }, 'High') : null),
            h('div', { class: 'small muted' }, `${byId[r.playlist_id]?.name || '?'} · ${describeRule({ ...r, start_time: r.start_time?.slice(0, 5), end_time: r.end_time?.slice(0, 5) })}`)),
          h('div', { class: 'row', style: { gap: '4px' } },
            h('label', { class: 'row tiny', title: 'Enabled' }, h('input', { type: 'checkbox', checked: r.enabled, onchange: async (e) => { await q(sb.from('schedule_items').update({ enabled: e.target.checked }).eq('id', r.id)); await load(); paint(); goLive(); } })),
            h('button', { class: 'btn sm', onclick: () => ruleDialog(r) }, 'Edit'))))
          : h('div', { class: 'list-row muted small' }, 'No rules yet — the default playlist plays all the time.')));

    // Every playlist this TV can show: default, add-ons, schedule rules, and playlists shown inside a layout area.
    function assignedCard() {
      const roles = new Map(), add = (pid, role) => { if (!pid || !byId[pid]) return; if (!roles.has(pid)) roles.set(pid, []); if (!roles.get(pid).includes(role)) roles.get(pid).push(role); };
      add(screen.default_playlist_id, 'Default');
      (screen.also_playlist_ids || []).forEach((pid) => add(pid, 'Add-on'));
      rules.forEach((r) => add(r.playlist_id, r.enabled ? `Scheduled · ${describeRule({ ...r, start_time: r.start_time?.slice(0, 5), end_time: r.end_time?.slice(0, 5) })}` : 'Scheduled (rule off)'));
      [...roles.keys()].forEach((pid) => zonePlaylistIds(byId[pid].settings || {}).forEach((zid, i) => zid && add(zid, `Area ${i + 2} of “${byId[pid].name}”`)));
      const liveId = Object.keys(screen.content?.playlists || {}).find((k) => screen.content.playlists[k]?.name === liveName);
      return h('div', { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', {}, 'Playlists on this TV'), h('span', { class: 'tiny' }, roles.size ? `${roles.size} assigned` : '')),
        h('div', { class: 'list' },
          roles.size ? [...roles].map(([pid, rs]) => h('div', { class: 'list-row row between', style: { gap: '10px', flexWrap: 'nowrap' } },
            h('div', { style: { minWidth: 0 } },
              h('div', { style: { fontWeight: 650 } }, byId[pid].name, pid === liveId ? h('span', { class: 'badge ok', style: { marginLeft: '8px' } }, 'Playing now') : null),
              h('div', { class: 'small muted', style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, `${(byId[pid].slides || []).length} slides · ${rs.join(' · ')}`)),
            h('div', { class: 'row', style: { gap: '6px', flex: 'none', flexWrap: 'wrap', justifyContent: 'flex-end' } },
              pauseBadge(pauses[pid]),
              pauseControls(byId[pid], pauses[pid], async () => { await load(); paint(); }),
              h('a', { class: 'btn sm', href: '#/playlist/' + pid }, icon('edit'), 'Edit'))))
            : h('div', { class: 'list-row muted small' }, 'No playlists assigned yet. Choose a default playlist below.')));
    }

    const L = licenseState(screen);
    const lic = h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'Licence'), h('span', { class: 'badge ' + licenseSummary(screen).tone }, licenseSummary(screen).text)),
      h('div', { class: 'card-body stack small' },
        h('div', { class: 'row between' }, h('span', { class: 'muted' }, 'Plan'), licenseLabel(screen.license_type)),
        screen.license_starts_at ? h('div', { class: 'row between' }, h('span', { class: 'muted' }, 'Started'), fmtDate(screen.license_starts_at)) : null,
        h('div', { class: 'row between' }, h('span', { class: 'muted' }, L.state === 'lifetime' ? 'Expires' : (L.daysLeft >= 0 ? 'Expires' : 'Expired')), L.state === 'lifetime' ? 'Never' : L.expires ? fmtDate(L.expires) : '—'),
        state.me.is_admin && screen.license_notes ? h('div', { class: 'row between' }, h('span', { class: 'muted' }, 'Notes'), screen.license_notes) : null,
        tvLocationLicence(screen) ? h('div', { class: 'row between' }, h('span', { class: 'muted' }, 'Business licence'),
          h('span', { class: 'badge ' + licenseSummary(tvLocationLicence(screen)).tone }, licenseSummary(tvLocationLicence(screen)).text)) : null,
        h('div', { class: 'row' },
          state.me.is_admin ? licensePortalButton() : null,
          hasFeature('billing') && L.state !== 'lifetime' ? h('button', { class: 'btn sm' + (['none', 'expired', 'grace'].includes(L.state) || screen.license_type === 'trial7' ? ' primary' : ''), onclick: () => renewOnlineDialog(screen) }, !screen.license_type || screen.license_type === 'trial7' ? 'Buy licence online' : 'Renew online') : null)));

    const shotImg = h('div', { class: 'thumb shot-box', style: { borderRadius: '8px' } }, h('div', { class: 'blank' }, screen.screenshot_at ? 'Loading…' : 'No screenshot yet'));
    if (screen.screenshot_path) sb.storage.from('screenshots').createSignedUrl(screen.screenshot_path, 600).then(({ data }) => {
      if (data?.signedUrl) {
        const src = data.signedUrl + '&t=' + Date.parse(screen.screenshot_at || 0);
        // Show the whole picture at its real shape (portrait TVs too); tap to open it full size.
        const img = h('img', { src, alt: 'Screenshot', title: 'Open full size', onclick: () => window.open(src, '_blank'),
          onload: () => { if (img.naturalWidth) shotImg.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`; shotImg.classList.toggle('tall', img.naturalHeight > img.naturalWidth); } });
        shotImg.replaceChildren(img);
      }
    });
    const shotBtn = h('button', { class: 'btn sm', onclick: async () => {
      shotBtn.disabled = true; shotBtn.textContent = 'Asking the TV…';
      const before = screen.screenshot_at;
      await q(sb.from('screens').update({ screenshot_requested_at: new Date().toISOString() }).eq('id', id));
      for (let i = 0; i < 15; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const s = await q(sb.from('screens').select('screenshot_at,screenshot_path,screenshot_error,screenshot_requested_at').eq('id', id).single());
        if (s.screenshot_at !== before || (!s.screenshot_requested_at && s.screenshot_error)) { Object.assign(screen, s); break; }
      }
      if (screen.screenshot_error && screen.screenshot_at === before) toast(screen.screenshot_error, true);
      else if (screen.screenshot_at === before) toast('The TV didn’t respond. Is it online?', true);
      paint();
    } }, icon('screens'), 'Take screenshot');
    const shot = h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'Live screenshot'), h('span', { class: 'tiny' }, screen.screenshot_at ? 'Taken ' + timeAgo(screen.screenshot_at) : '')),
      h('div', { class: 'card-body stack' }, shotImg, h('div', { class: 'row between' }, h('span', { class: 'tiny' }, 'Exactly what the TV is showing (TV app 1.5+).'), shotBtn)));

    const device = h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', {}, 'Device')),
      h('div', { class: 'card-body stack small' },
        h('div', { class: 'row between' }, h('span', { class: 'muted' }, 'Last seen'), timeAgo(screen.last_seen)),
        screen.paired_at ? h('div', { class: 'row between' }, h('span', { class: 'muted' }, 'Paired on'), fmtWhen(screen.paired_at)) : null,
        h('div', { class: 'row between' }, h('span', { class: 'muted' }, 'Pairing code used'), screen.paired_code ? h('b', { style: { fontFamily: 'ui-monospace, monospace', letterSpacing: '1px' } }, screen.paired_code) : h('span', { class: 'muted' }, screen.paired_at ? 'not recorded (paired before 10 Nov 2026)' : 'not recorded')),
        screen.paired_by ? h('div', { class: 'row between' }, h('span', { class: 'muted' }, 'Paired by'), screen.paired_by) : null,
        tvId(screen) ? h('div', { class: 'row between', title: 'Fixed for this TV box, even if it is re-paired' }, h('span', { class: 'muted' }, 'TV ID'), h('b', { style: { fontFamily: 'ui-monospace, monospace' } }, tvId(screen))) : null,
        dinfo.model ? h('div', { class: 'row between' }, h('span', { class: 'muted' }, 'Model'), dinfo.model) : null,
        dinfo.resolution ? h('div', { class: 'row between' }, h('span', { class: 'muted' }, 'Resolution'), dinfo.resolution) : null,
        dinfo.app ? h('div', { class: 'row between' }, h('span', { class: 'muted' }, 'App'), dinfo.app) : null,
        dinfo.playing ? h('div', { class: 'row between' }, h('span', { class: 'muted' }, 'Reported playing'), dinfo.playing) : null,
        h('div', { class: 'row', style: { marginTop: '6px' } },
          canManage() ? h('button', { class: 'btn sm danger', onclick: unpair }, icon('trash'), 'Remove TV') : null)));

    const banner = licenseBanner(screen);
    main.replaceChildren(head, banner ? h('div', { style: { marginBottom: '16px' } }, banner) : '', h('div', { class: 'split' },
      h('div', { class: 'stack' }, onair, assignedCard(), shot, lic, device),
      h('div', { class: 'stack' }, sched, sleepCard(screen, { onChange: async () => { await load(); paint(); } }))));
    startPreview(preview);
  }
  paint();

  // keep the status fresh & follow schedule changes in the preview
  let lastPid = resolveSchedule(screen.content).playlistId;
  tick = setInterval(async () => {
    try {
      const s = await q(sb.from('screens').select('last_seen,device_info,content,published_at,schedule_updated_at,license_type,license_expires_at').eq('id', id).single());
      const pid = resolveSchedule(s.content).playlistId;
      Object.assign(screen, s);
      if (pid !== lastPid) { lastPid = pid; paint(); }
    } catch {}
  }, 30000);
  return () => { clearInterval(tick); player?.stop(); };
}
