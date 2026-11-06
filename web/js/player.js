// =====================================================================
//  TV player. Runs inside the Android TV / Fire TV app (or any browser).
//  1. Signs in anonymously → registers → shows a pairing code
//  2. Once claimed, plays the published schedule; follows changes live
//  3. Caches all media locally so it keeps playing when offline
// =====================================================================
import { makeClient, configured, BUCKET } from './sb.js';
import { LayoutPlayer, WallPlayer, validWall, onAirPlaylist } from './renderer.js';
import { licenseState, licenseSummary } from './license.js';
import { createRemoteMenu } from './remote.js';
import { shrinkImage } from './imgfit.js';
import { sleepState, hhmm, DEFAULT_SLEEP } from './sleep.js';

const qs = new URLSearchParams(location.search);
const APP = qs.get('app') ? `Android ${qs.get('app')}` : 'Web player';
const MODEL = qs.get('model') || '';
const HW = /^[0-9a-f]{64}$/.test(qs.get('hw') || '') ? qs.get('hw') : '';
const sb = makeClient('signage-tv');
window.__sgBleed = 1.004;   // fill the screen edge to edge (no thin border lines)
const LS = { screen: 'signage.tv.screen', reload: 'signage.tv.reload' };
const MEDIA_CACHE = 'signage-media-v1';

const $ = (id) => document.getElementById(id);
const views = { boot: $('boot'), pair: $('pair'), wait: $('wait'), loading: $('loading'), stage: $('stage'), expired: $('expired'), error: $('error'), sleep: $('sleep') };
function show(name) { for (const [k, el] of Object.entries(views)) el.classList.toggle('on', k === name); }

let screen = null;        // our screens row
let content = null;       // published snapshot
let player = null;
let currentKey = null;    // playlistId + version currently loaded
let channel = null;
let pendingVersion = null;  // content version being downloaded

// ------------------------------------------------------------ shared clock (video walls)
// Each TV estimates how far its clock is from the server's, so every TV in a wall agrees on "now".
let clockOffset = 0, clockSyncedAt = 0, clockBusy = false;
const serverNow = () => Date.now() + clockOffset;
async function syncClock() {
  if (clockBusy) return;
  clockBusy = true;
  try {
    let best = null;
    for (let i = 0; i < 6; i++) {
      const t0 = Date.now();
      const { data, error } = await sb.rpc('server_now');
      const t1 = Date.now();
      if (error || typeof data !== 'number') continue;
      const rtt = t1 - t0;
      if (!best || rtt < best.rtt) best = { rtt, off: data - (t0 + t1) / 2 };
    }
    if (best) { clockOffset = best.off; clockSyncedAt = Date.now(); console.log('[signage] clock offset', Math.round(best.off), 'ms, rtt', best.rtt); }
  } catch {} finally { clockBusy = false; }
}

// ------------------------------------------------------------ media cache
const objectUrls = new Map();
const isImagePath = (p) => /\.(jpe?g|png|webp|heic|heif|bmp|avif)$/i.test(p);
const FIT_EDGE = Math.min(2560, Math.max(1920, Math.round(Math.max(window.screen?.width || 0, window.screen?.height || 0) * (window.devicePixelRatio || 1))));
// Pictures are stored resized for this TV, so big phone photos decode fast.
async function fitAndStore(c, path, blob) {
  let out = blob;
  if (isImagePath(path)) { const small = await shrinkImage(blob, /\.4k\.[a-z0-9]+$/i.test(path) ? 3840 : FIT_EDGE).catch(() => null); if (small) out = small; }
  if (c) await c.put('/__media/' + path, new Response(out, { headers: { 'content-type': out.type || blob.type || 'application/octet-stream', 'x-fit': '1' } }));
  return out;
}
async function cacheGet(path) {
  if (!('caches' in window)) return null;
  const c = await caches.open(MEDIA_CACHE);
  const r = await c.match('/__media/' + path);
  if (!r) return null;
  const blob = await r.blob();
  // Pictures cached by an older player version: resize them once now.
  if (isImagePath(path) && !r.headers.get('x-fit')) return fitAndStore(c, path, blob);
  return blob;
}
/** Is this file already stored on the TV? (cheap check, doesn't read the file) */
async function isCached(path) {
  if (objectUrls.has(path)) return true;
  if (!('caches' in window)) return false;
  try { return !!(await (await caches.open(MEDIA_CACHE)).match('/__media/' + path)); } catch { return false; }
}
async function download(path, onProgress) {
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error) throw error;
  const ctl = new AbortController();
  // Never hang forever on a dead connection: give up if no data arrives for 60 seconds.
  let idle = setTimeout(() => ctl.abort(), 60000);
  const poke = () => { clearTimeout(idle); idle = setTimeout(() => ctl.abort(), 60000); };
  let blob;
  try {
    const res = await fetch(data.signedUrl, { signal: ctl.signal });
    if (!res.ok) throw new Error('download failed ' + res.status);
    const total = Number(res.headers.get('content-length')) || 0;
    const big = !isImagePath(path) && total > 20 * 1048576;
    if (big && res.body && window.TransformStream && 'caches' in window) {
      // Large videos go straight to the TV's storage while counting progress, instead of being held in memory.
      let got = 0;
      const counter = new TransformStream({ transform(chunk, ctl) { got += chunk.length; poke(); onProgress?.(total ? got / total : 0, got, total); ctl.enqueue(chunk); } });
      const c = await caches.open(MEDIA_CACHE);
      await c.put('/__media/' + path, new Response(res.body.pipeThrough(counter), { headers: { 'content-type': res.headers.get('content-type') || 'video/mp4', 'x-fit': '1' } }));
      clearTimeout(idle);
      return (await c.match('/__media/' + path)).blob();
    }
    if (res.body?.getReader) {
      const reader = res.body.getReader(), parts = [];
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value); got += value.length; poke();
        onProgress?.(total ? got / total : 0, got, total);
      }
      blob = new Blob(parts, { type: res.headers.get('content-type') || '' });
    } else blob = await res.blob();
  } finally { clearTimeout(idle); }
  const c = 'caches' in window ? await caches.open(MEDIA_CACHE) : null;
  return fitAndStore(c, path, blob);
}
const inflight = new Map();
async function resolveUrl(slide) {
  const path = slide.path;
  if (!path) return null;
  if (objectUrls.has(path)) return objectUrls.get(path);
  if (!inflight.has(path)) {
    inflight.set(path, (async () => {
      let blob = await cacheGet(path).catch(() => null);
      if (!blob) blob = await download(path);
      const url = URL.createObjectURL(blob);
      objectUrls.set(path, url);
      return url;
    })().finally(() => inflight.delete(path)));
  }
  return inflight.get(path);
}
function allPaths(c) {
  const set = new Set();
  for (const p of Object.values(c?.playlists || {})) for (const s of p.slides || []) if (s.path) set.add(s.path);
  return set;
}
// New content is only switched to once every picture and video it needs is stored on the TV,
// so playback never stalls waiting for a download. While it downloads, the TV keeps playing
// what it had (with a small "Updating" badge), or shows a progress screen if it had nothing.
let prepGen = 0;
const fmtMB = (b) => (b / 1048576 >= 10 ? Math.round(b / 1048576) : (b / 1048576).toFixed(1)) + ' MB';
function showProgress(onScreen, done, total, frac, got, size) {
  const pct = Math.round(((done + Math.min(1, frac)) / total) * 100);
  if (sleeping) return;   // downloading quietly overnight: keep the screen dark
  if (onScreen) {
    $('upd').classList.add('on');
    $('upd-text').textContent = `Updating content · ${pct}%`;
  } else {
    show('loading');
    $('load-bar').style.width = pct + '%';
    $('load-detail').textContent = `File ${Math.min(done + 1, total)} of ${total}${size ? ` · ${fmtMB(got)} of ${fmtMB(size)}` : ''} · ${pct}%`;
  }
}
async function prepare(next) {
  const gen = ++prepGen;
  const paths = [...allPaths(next)];
  const missing = [];
  for (const p of paths) if (!(await isCached(p))) missing.push(p);
  if (gen !== prepGen) return;
  if (missing.length) {
    const playing = !!player && currentKey && currentKey !== 'expired' && views.stage.classList.contains('on');
    console.log('[signage] downloading', missing.length, 'file(s) before playing');
    let failed = 0;
    for (let i = 0; i < missing.length; i++) {
      let ok = false;
      for (let attempt = 0; attempt < 3 && !ok; attempt++) {
        if (gen !== prepGen) return;            // newer content arrived: that run takes over
        try {
          showProgress(playing, i, missing.length, 0, 0, 0);
          await download(missing[i], (f, got, size) => gen === prepGen && showProgress(playing, i, missing.length, f, got, size));
          ok = true;
        } catch (e) { console.warn('download', missing[i], e.message); if (attempt < 2) await new Promise((r) => setTimeout(r, 3000)); }
      }
      if (!ok) failed++;
    }
    if (gen !== prepGen) return;
    $('upd').classList.remove('on');
    // Anything that still failed (e.g. no internet) is skipped by the player and retried later.
    if (failed) setTimeout(() => content === next && prepare(next), 60000);
  }
  if (gen !== prepGen) return;
  $('upd').classList.remove('on');
  if (content !== next) { content = next; currentKey = null; }
  evaluate();
  prune();
}
async function prune() {
  // Only ever prune against the latest content.
  const keep = allPaths(content);
  for (const [p, u] of objectUrls) if (!keep.has(p)) { URL.revokeObjectURL(u); objectUrls.delete(p); }
  if (!navigator.onLine || !('caches' in window)) return;
  const cache = await caches.open(MEDIA_CACHE);
  for (const req of await cache.keys()) {
    const p = decodeURIComponent(new URL(req.url).pathname.replace(/^\/__media\//, ''));
    if (!keep.has(p)) await cache.delete(req);
  }
}

// ------------------------------------------------------------ playback
function isExpired() { return screen?.claimed && ['expired', 'none'].includes(licenseState(screen).state); }

// ------------------------------------------------------------ sleep hours
// Set on the dashboard (screens.sleep / sleep_override). While asleep: black screen, playback stopped,
// and the Android app switches the TV off when it has permission (it wakes the TV again at the end).
let sleeping = false;
let sleepHintTimer = null, sleepRelockTimer = null;
const WAKE_KEY = 'signage.tv.wakeUntil';   // staff pressed OK on the remote: stay awake until then
const native = () => window.SignageNative;

function sleepNow() {
  if (!screen?.claimed || isExpired()) return { asleep: false };
  const st = sleepState(screen.sleep, screen.sleep_override);
  const woke = +localStorage.getItem(WAKE_KEY) || 0;
  if (st.asleep && woke > Date.now()) return { asleep: false, until: new Date(woke), manual: true };
  return st;
}
const turnOffWanted = () => (screen?.sleep?.off ?? DEFAULT_SLEEP.off);

function goNativeSleep(st) {
  try { native()?.sleepMode?.(true, String(st.until ? st.until.getTime() : 0), !!turnOffWanted()); } catch {}
}

function checkSleep() {
  const st = sleepNow();
  if (st.asleep && !sleeping) {
    sleeping = true;
    console.log('[signage] sleep hours: going to sleep until', st.until?.toString());
    player?.clear(); player = null; currentKey = 'sleep'; nowPlaying = 'sleeping';
    $('sleep-msg').textContent = st.until ? `${screen?.name || 'This screen'} wakes up at ${hhmm(st.until)}.` : '';
    show('sleep');
    goNativeSleep(st);
    heartbeat?.();
  } else if (!st.asleep && sleeping) {
    console.log('[signage] sleep hours: waking up');
    try { native()?.sleepMode?.(false, '0', false); } catch {}
    sleeping = false;
    location.reload();   // fresh start: content plays straight away
  } else if (st.asleep) {
    if (!views.sleep.classList.contains('on')) show('sleep');   // e.g. after a publish downloaded overnight
    $('sleep-msg').textContent = st.until ? `${screen?.name || 'This screen'} wakes up at ${hhmm(st.until)}.` : '';
  }
  return sleeping;
}

// While asleep: any key shows a hint; OK wakes it for an hour. If someone switches the TV back on during
// sleep hours and does nothing, it goes back to sleep after a minute.
function showSleepHint() {
  if (!sleeping) return;
  $('sleep').classList.add('hint');
  clearTimeout(sleepHintTimer); sleepHintTimer = setTimeout(() => $('sleep').classList.remove('hint'), 20000);
  clearTimeout(sleepRelockTimer); sleepRelockTimer = setTimeout(() => { const st = sleepNow(); if (sleeping && st.asleep) goNativeSleep(st); }, 60000);
}
document.addEventListener('keydown', (e) => {
  if (!sleeping) return;
  if (e.key === 'Enter' || e.key === ' ' || e.keyCode === 23) {
    e.preventDefault(); e.stopImmediatePropagation();
    localStorage.setItem(WAKE_KEY, String(Date.now() + 3600000));
    try { native()?.sleepMode?.(false, '0', false); } catch {}
    location.reload();
    return;
  }
  showSleepHint();
}, true);
document.addEventListener('visibilitychange', () => { if (document.hidden) return; try { evaluate(); } catch {} showSleepHint(); });   // TV switched back on / woken by the alarm

function evaluate() {
  if (checkSleep()) return;
  if (isExpired()) {
    if (currentKey !== 'expired') {
      currentKey = 'expired'; player?.clear(); nowPlaying = 'licence expired';
      $('expired-name').textContent = screen.name;
      const none = licenseState(screen).state === 'none';
      $('expired-title').textContent = none ? 'Licence required' : 'Licence expired';
      $('expired-msg').textContent = none ? 'needs a licence before it can play.' : 'has ended.';
      show('expired');
    }
    return;
  }
  if (currentKey === 'expired') currentKey = null;
  if (!content) return;
  const air = onAirPlaylist(content);
  const { playlistId, rule } = air;
  const wall = validWall(screen?.wall) ? screen.wall : null;
  const wallKey = wall ? `|wall:${wall.id}:${wall.cols}x${wall.rows}@${wall.x},${wall.y}:${wall.bezel || ''}` : '';
  const key = (playlistId ? `${air.key}:${content.version}` : `none:${content.version}`) + wallKey;
  if (key === currentKey) return;
  currentKey = key;
  show('stage');
  onAirId = playlistId;
  const onChange = ({ index, slide }) => { nowPlaying = slide ? `${onAirName} #${index + 1}${wall ? ' (wall)' : ''}` : 'idle'; playLog?.(slide?._pl || onAirId, slide); };
  const wantKind = wall ? 'wall' : 'layout';
  if (player && (player.kind !== wantKind || (wall && JSON.stringify(player.wall) !== JSON.stringify(wall)))) { player.clear(); player = null; }
  if (!player) {
    const clockReady = wall && Date.now() - clockSyncedAt > 60000 ? syncClock() : null;
    player = wall
      ? new WallPlayer($('stage'), { resolveUrl, onChange, wall, now: serverNow, clockReady, mutedOverride: wall.x || wall.y ? true : undefined })
      : new LayoutPlayer($('stage'), { resolveUrl, lookup: (id) => content?.playlists?.[id] || null, onChange });
    player.kind = wantKind;
    if (wall) player.wall = wall;
  }
  if (!playlistId) { player.clear(); nowPlaying = 'idle'; return; }
  const pl = air.pl;
  onAirName = air.name;
  console.log('[signage] now playing', pl.name, rule?.label || '(default)');
  player.stop();
  player.load(pl);
  player.start();
}
let nowPlaying = '';
let onAirId = null;
let onAirName = '';
let playLog = null;   // set by proof-of-play logger

function apply(row) {
  if (!row) return;
  // Remote reload. Only a NEWER request counts (an older saved copy of the row must never trigger one,
  // or the TV could reload over and over).
  const known = localStorage.getItem(LS.reload);
  const newer = row.reload_at && (!known || new Date(row.reload_at) > new Date(known));
  if (newer) localStorage.setItem(LS.reload, row.reload_at);
  if (newer && known) {
    // A publish also stamps reload_at (same moment as published_at). For that, don't restart the page:
    // fetch the latest row and let prepare() download, then switch, while the old content keeps playing.
    if (row.published_at && row.reload_at === row.published_at) setTimeout(poll, 500);
    else { localStorage.setItem(LS.screen, JSON.stringify(row)); return location.reload(); }   // "Reload TV" button
  }
  // "Update app" pressed on the dashboard (only act on fresh requests)
  if (row.update_requested_at && row.update_requested_at !== localStorage.getItem('signage.tv.update')) {
    localStorage.setItem('signage.tv.update', row.update_requested_at);
    if (Date.now() - new Date(row.update_requested_at) < 15 * 60000) { try { window.SignageNative?.checkForUpdate?.(true); } catch {} }
  }

  screen = row;
  localStorage.setItem(LS.screen, JSON.stringify(row));
  applyRotation(row.rotation);
  if (row.claimed && row.screenshot_requested_at && Date.now() - new Date(row.screenshot_requested_at) < 5 * 60000) takeScreenshot();
  $('screen-name').textContent = row.name;

  if (!row.claimed) {
    content = null; currentKey = null; pendingVersion = null; prepGen++; player?.clear(); $('upd').classList.remove('on');
    $('code').textContent = row.pairing_code || '······';
    return show('pair');
  }
  if (isExpired()) return evaluate();
  if (!row.content) {
    content = null; currentKey = null; pendingVersion = null; prepGen++; player?.clear(); $('upd').classList.remove('on');
    $('wait-name').textContent = row.name;
    // After a power cut the TV can come up before the internet or the latest data is ready.
    // Don't rely on the 60-second safety net: check again soon.
    clearTimeout(waitRecheck); waitRecheck = setTimeout(() => (screen?.claimed && !screen.content ? boot() : null), 20000);
    return show('wait');
  }
  if (currentKey === 'expired') currentKey = null;
  if (!content || content.version !== row.content.version) {
    // Don't switch yet: prepare() swaps it in once all its media is on the TV.
    if (pendingVersion !== row.content.version) { pendingVersion = row.content.version; prepare(row.content); }
    if (content) evaluate();
    return;
  }
  evaluate();
}

// ------------------------------------------------------------ backend
// Turn the whole picture when the TV is mounted on its side and can't rotate by itself.
function applyRotation(deg) {
  const r = [90, 180, 270].includes(Number(deg)) ? Number(deg) : 0;
  for (const d of [90, 180, 270]) document.body.classList.toggle('rot' + d, d === r);
}

function deviceInfo() {
  const dpr = window.devicePixelRatio || 1;
  return {
    app: APP, model: MODEL || undefined, hw: HW || undefined,
    resolution: `${Math.round(window.screen.width * dpr)}×${Math.round(window.screen.height * dpr)}`,
    ua: navigator.userAgent.slice(0, 160),
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    display: window.innerHeight > window.innerWidth ? 'portrait' : 'landscape',
    app_update: (() => { try { return window.SignageNative?.updateAvailable?.() || undefined; } catch { return undefined; } })(),
    sleeping: sleeping || undefined,
    can_turn_off: (() => { try { return window.SignageNative?.canTurnOff ? window.SignageNative.canTurnOff() : undefined; } catch { return undefined; } })(),
  };
}

async function ensureSession() {
  const { data } = await sb.auth.getSession();
  if (data.session) return data.session;
  const { data: d, error } = await sb.auth.signInAnonymously();
  if (error) {
    if (/anonymous/i.test(error.message)) throw new Error('Anonymous sign-ins are disabled. In Supabase go to Authentication → Sign In / Providers and turn on “Allow anonymous sign-ins”.');
    throw error;
  }
  return d.session;
}

async function register() {
  await ensureSession();
  const { data, error } = await sb.rpc('register_device', { p_info: deviceInfo() });
  if (error) throw error;
  return data;
}

function subscribe() {
  if (channel) sb.removeChannel(channel);
  channel = sb.channel('screen-' + screen.id)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'screens', filter: `id=eq.${screen.id}` }, (payload) => {
      if (payload.eventType === 'DELETE') return boot();
      const n = payload.new || {};
      // Live updates leave out large unchanged fields (like the published content) when something
      // small changes, e.g. the TV's own heartbeat. Never treat that as "nothing published":
      // fetch the full row instead.
      if (n.content == null && n.claimed) return poll();
      apply(n);
    })
    .subscribe((status) => { $('net').classList.toggle('bad', status !== 'SUBSCRIBED'); });
}

async function poll() {
  try {
    if (!screen) return boot();
    const { data, error } = await sb.from('screens').select('*').eq('id', screen.id).maybeSingle();
    if (error) throw error;
    if (!data) return boot();
    apply(data);
    $('net').classList.remove('bad');
    loadSettings();
    loadOverrides();
  } catch { $('net').classList.add('bad'); }
}

async function heartbeat() {
  try { await sb.rpc('screen_heartbeat', { p_info: { ...deviceInfo(), playing: nowPlaying } }); } catch {}
}

// ------------------------------------------------------------ screenshots
let shooting = false;
async function takeScreenshot() {
  if (shooting) return;
  shooting = true;
  const done = (ok, err) => sb.rpc('screenshot_done', { p_ok: ok, p_error: err || null }).then(() => {}, () => {});
  try {
    const nat = window.SignageNative;
    if (!nat || typeof nat.captureScreen !== 'function') { await done(false, 'Screenshots need the PROVIEW SIGNAGE TV app version 1.5 or newer.'); return; }
    const dataUrl = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('The TV took too long to capture the screen.')), 15000);
      window.__onScreenshot = (d, err) => { clearTimeout(t); d ? resolve(d) : reject(new Error(err || 'Capture failed')); };
      nat.captureScreen();
    });
    const blob = await (await fetch(dataUrl)).blob();
    const { error } = await sb.storage.from('screenshots').upload(`${screen.id}.jpg`, blob, { upsert: true, contentType: 'image/jpeg', cacheControl: '0' });
    if (error) throw error;
    await done(true);
  } catch (e) {
    await done(false, e.message);
  } finally {
    shooting = false;
  }
}

// ------------------------------------------------------------ proof-of-play
const LS_PLAYS = 'signage.tv.plays';
let lastPlay = null;   // { key, started }
function bucket() { try { return JSON.parse(localStorage.getItem(LS_PLAYS) || '{}'); } catch { return {}; } }
playLog = (playlistId, slide) => {
  const now = Date.now();
  const b = bucket();
  if (lastPlay && b[lastPlay.key]) b[lastPlay.key].seconds += Math.min(3600, Math.round((now - lastPlay.started) / 1000));
  if (!slide || !screen?.claimed) { lastPlay = null; localStorage.setItem(LS_PLAYS, JSON.stringify(b)); return; }
  const hour = new Date(now); hour.setMinutes(0, 0, 0);
  const key = `${hour.toISOString()}|${slide.id}`;
  const name = slide.text?.title || slide.name || slide.type;
  b[key] ||= { hour: hour.toISOString(), slide_id: slide.id, slide_name: name, slide_type: slide.type, media_id: slide.media_id || '',
               playlist_id: playlistId || '', playlist_name: content?.playlists?.[playlistId]?.name || '', plays: 0, seconds: 0 };
  b[key].plays += 1;
  lastPlay = { key, started: now };
  localStorage.setItem(LS_PLAYS, JSON.stringify(b));
};
async function flushPlays() {
  const b = bucket();
  const rows = Object.values(b);
  if (!rows.length || !navigator.onLine) return;
  try {
    const sent = rows.slice(0, 500);
    const { error } = await sb.rpc('log_plays', { p_rows: sent });
    if (error) throw error;
    // Re-read: plays may have been logged while we were uploading. Subtract what was sent.
    const now = bucket();
    for (const r of sent) {
      const k = `${r.hour}|${r.slide_id}`, cur = now[k];
      if (!cur) continue;
      cur.plays -= r.plays; cur.seconds -= r.seconds;
      if (cur.plays <= 0 && cur.seconds <= 0 && !(lastPlay && lastPlay.key === k)) delete now[k];
      else { cur.plays = Math.max(0, cur.plays); cur.seconds = Math.max(0, cur.seconds); }
    }
    localStorage.setItem(LS_PLAYS, JSON.stringify(now));
  } catch {}
}
setInterval(flushPlays, 10 * 60000);
setTimeout(flushPlays, 60000);

// ------------------------------------------------------------ emergency messages
const OV_COLORS = { red: ['#b91c1c', '#fff'], orange: ['#ea580c', '#fff'], blue: ['#1d4ed8', '#fff'], green: ['#15803d', '#fff'], black: ['#000', '#fff'] };
let overrides = JSON.parse(localStorage.getItem('signage.tv.overrides') || '[]');
let ovChannel = null;
function paintOverride() {
  const now = new Date().toISOString();
  const o = overrides.find((x) => x.active && x.starts_at <= now && (!x.ends_at || x.ends_at > now));
  const el = $('override');
  if (!o || !screen?.claimed) { el.classList.remove('on'); return; }
  const [bg, fg] = OV_COLORS[o.style] || OV_COLORS.red;
  el.style.background = bg; el.style.color = fg;
  $('ov-msg').textContent = o.message;
  $('ov-sub').textContent = o.subtitle || '';
  el.classList.add('on');
}
async function loadOverrides() {
  try {
    const { data, error } = await sb.from('overrides').select('*').eq('active', true).order('created_at', { ascending: false });
    if (error) throw error;
    overrides = data || [];
    localStorage.setItem('signage.tv.overrides', JSON.stringify(overrides));
  } catch {}
  paintOverride();
}
function subscribeOverrides() {
  if (ovChannel) sb.removeChannel(ovChannel);
  ovChannel = sb.channel('overrides').on('postgres_changes', { event: '*', schema: 'public', table: 'overrides' }, () => loadOverrides()).subscribe();
}
setInterval(paintOverride, 10000);

// ------------------------------------------------------------ remote menu
const remote = createRemoteMenu({
  getStatus: () => {
    let needsOverlay = false;
    try { needsOverlay = !!window.SignageNative && !window.SignageNative.canReopen(); } catch {}
    return {
      name: screen?.name, licence: screen?.claimed ? licenseSummary(screen).text : 'Not paired',
      playing: nowPlaying, online: navigator.onLine && !$('net').classList.contains('bad'),
      model: MODEL || navigator.platform, app: APP, isApp: !!window.SignageNative, needsOverlay, paired: !!screen?.claimed,
      needsTurnOff: (() => { try { return !!native()?.canTurnOff && !native().canTurnOff(); } catch { return false; } })(),   // show until granted, so it can be set up in advance
    };
  },
  onReload: () => location.reload(),
  // Unlink from the TV's own menu: back to the pairing screen with a new code.
  onUnlink: async () => {
    const { data, error } = await sb.rpc('device_unpair');
    if (error) throw error;
    apply(data);
  },
});
async function loadSettings() {
  try {
    const { data } = await sb.rpc('get_tv_settings');
    if (data) remote.setSettings(data);
  } catch {}
}

let booting = false;
let waitRecheck = null;
// Self-heal watchdog (e.g. after a power cut): if the TV is paired and has content to play but is
// still showing a holding screen (paired / error / starting up), restart the player page —
// the same as pressing "Reload" on the remote. At most once every 3 minutes.
const BOOTED_AT = Date.now();
setInterval(() => {
  if (!screen?.claimed || !screen.content || isExpired()) return;
  const stuck = ['wait', 'error', 'boot'].some((k) => views[k].classList.contains('on'));
  if (!stuck || Date.now() - BOOTED_AT < 45000) return;
  let last = 0; try { last = +sessionStorage.getItem('signage.selfheal') || 0; } catch {}
  if (Date.now() - last < 180000) return;
  try { sessionStorage.setItem('signage.selfheal', String(Date.now())); } catch {}
  console.warn('[signage] content available but not showing; reloading');
  location.reload();
}, 15000);
async function boot() {
  if (booting) return;
  booting = true;
  try {
    const row = await register();
    apply(row);
    subscribe();
    loadSettings();
    loadOverrides();
    subscribeOverrides();
  } catch (e) {
    console.error(e);
    const cached = JSON.parse(localStorage.getItem(LS.screen) || 'null');
    if (cached?.content) { apply(cached); $('net').classList.add('bad'); }
    else { $('error-msg').textContent = e.message || String(e); show('error'); }
    setTimeout(() => { booting = false; boot(); }, 30000);
    return;
  }
  booting = false;
}

// ------------------------------------------------------------ start
if (!configured) {
  $('error-msg').textContent = 'This player is not configured yet. Add your Supabase URL and key to config.js.';
  show('error');
} else {
  const dash = new URL('index.html', location.href).href.replace(/^https?:\/\//, '').replace(/\/index\.html$/, '');
  $('dash-url').textContent = dash;
  const cached = JSON.parse(localStorage.getItem(LS.screen) || 'null');
  if (cached?.claimed && cached.content) apply(cached);   // instant start from last known state
  boot();
  setInterval(evaluate, 15000);   // schedule changes & licence expiry over time
  setInterval(poll, 60000);       // safety net if realtime drops
  setInterval(heartbeat, 60000);
  setInterval(() => { if (validWall(screen?.wall)) syncClock(); }, 10 * 60000);   // keep wall clocks agreed
  setTimeout(heartbeat, 5000);
  window.addEventListener('online', () => { poll(); });
  sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') { localStorage.removeItem(LS.screen); location.reload(); } });
}

// Remote control: → next, OK toggles info
document.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowRight' || e.key === 'MediaTrackNext') player?.next();
  if (e.key === 'Enter' || e.key === ' ') $('info').classList.toggle('on');
});
// Keep display awake in plain browsers
async function wake() { try { await navigator.wakeLock?.request('screen'); } catch {} }
wake(); document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && wake());
// Hide cursor
let mt; document.addEventListener('mousemove', () => { document.body.classList.add('cursor'); clearTimeout(mt); mt = setTimeout(() => document.body.classList.remove('cursor'), 2500); });

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
setInterval(() => { $('info-text').textContent = `${screen?.name || ''} · ${nowPlaying || '—'} · ${APP}`; }, 2000);
