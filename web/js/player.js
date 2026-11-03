// =====================================================================
//  TV player. Runs inside the Android TV / Fire TV app (or any browser).
//  1. Signs in anonymously → registers → shows a pairing code
//  2. Once claimed, plays the published schedule; follows changes live
//  3. Caches all media locally so it keeps playing when offline
// =====================================================================
import { makeClient, configured, BUCKET } from './sb.js';
import { SlidePlayer, resolveSchedule } from './renderer.js';

const qs = new URLSearchParams(location.search);
const APP = qs.get('app') ? `Android ${qs.get('app')}` : 'Web player';
const MODEL = qs.get('model') || '';
const sb = makeClient('signage-tv');
const LS = { screen: 'signage.tv.screen', reload: 'signage.tv.reload' };
const MEDIA_CACHE = 'signage-media-v1';

const $ = (id) => document.getElementById(id);
const views = { boot: $('boot'), pair: $('pair'), wait: $('wait'), stage: $('stage'), error: $('error') };
function show(name) { for (const [k, el] of Object.entries(views)) el.classList.toggle('on', k === name); }

let screen = null;        // our screens row
let content = null;       // published snapshot
let player = null;
let currentKey = null;    // playlistId + version currently loaded
let channel = null;

// ------------------------------------------------------------ media cache
const objectUrls = new Map();
async function cacheGet(path) {
  if (!('caches' in window)) return null;
  const c = await caches.open(MEDIA_CACHE);
  const r = await c.match('/__media/' + path);
  return r ? r.blob() : null;
}
async function download(path) {
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error) throw error;
  const res = await fetch(data.signedUrl);
  if (!res.ok) throw new Error('download failed ' + res.status);
  if ('caches' in window) {
    const c = await caches.open(MEDIA_CACHE);
    await c.put('/__media/' + path, res.clone());
  }
  return res.blob();
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
async function prefetchAndPrune(c) {
  const paths = allPaths(c);
  for (const p of paths) {
    try { if (!objectUrls.has(p) && !(await cacheGet(p))) await download(p); } catch (e) { console.warn('prefetch', p, e.message); }
  }
  if (!navigator.onLine || !('caches' in window)) return;
  const cache = await caches.open(MEDIA_CACHE);
  for (const req of await cache.keys()) {
    const p = decodeURIComponent(new URL(req.url).pathname.replace(/^\/__media\//, ''));
    if (!paths.has(p)) {
      await cache.delete(req);
      if (objectUrls.has(p)) { URL.revokeObjectURL(objectUrls.get(p)); objectUrls.delete(p); }
    }
  }
}

// ------------------------------------------------------------ playback
function evaluate() {
  if (!content) return;
  const { playlistId, rule } = resolveSchedule(content);
  const key = playlistId ? `${playlistId}:${content.version}` : `none:${content.version}`;
  if (key === currentKey) return;
  currentKey = key;
  show('stage');
  if (!player) player = new SlidePlayer($('stage'), { resolveUrl, onChange: ({ index, slide }) => { nowPlaying = slide ? `${content.playlists[playlistId]?.name} #${index + 1}` : 'idle'; } });
  if (!playlistId) { player.clear(); nowPlaying = 'idle'; return; }
  const pl = content.playlists[playlistId];
  console.log('[signage] now playing', pl.name, rule?.label || '(default)');
  player.stop();
  player.load(pl);
  player.start();
}
let nowPlaying = '';

function apply(row) {
  if (!row) return;
  // remote reload
  const known = localStorage.getItem(LS.reload);
  if (row.reload_at && known && row.reload_at !== known) {
    localStorage.setItem(LS.reload, row.reload_at);
    return location.reload();
  }
  if (row.reload_at) localStorage.setItem(LS.reload, row.reload_at);

  screen = row;
  localStorage.setItem(LS.screen, JSON.stringify(row));
  $('screen-name').textContent = row.name;

  if (!row.claimed) {
    content = null; currentKey = null; player?.clear();
    $('code').textContent = row.pairing_code || '······';
    return show('pair');
  }
  if (!row.content) {
    content = null; currentKey = null; player?.clear();
    $('wait-name').textContent = row.name;
    return show('wait');
  }
  if (!content || content.version !== row.content.version) {
    content = row.content;
    prefetchAndPrune(content);
  }
  evaluate();
}

// ------------------------------------------------------------ backend
function deviceInfo() {
  const dpr = window.devicePixelRatio || 1;
  return {
    app: APP, model: MODEL || undefined,
    resolution: `${Math.round(window.screen.width * dpr)}×${Math.round(window.screen.height * dpr)}`,
    ua: navigator.userAgent.slice(0, 160),
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
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
      apply(payload.new);
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
  } catch { $('net').classList.add('bad'); }
}

async function heartbeat() {
  try { await sb.rpc('screen_heartbeat', { p_info: { ...deviceInfo(), playing: nowPlaying } }); } catch {}
}

let booting = false;
async function boot() {
  if (booting) return;
  booting = true;
  try {
    const row = await register();
    apply(row);
    subscribe();
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
  setInterval(evaluate, 15000);   // schedule changes over time
  setInterval(poll, 60000);       // safety net if realtime drops
  setInterval(heartbeat, 60000);
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
