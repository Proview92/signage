import { isWidget, buildWidget } from './widgets.js';

// =====================================================================
//  Slide renderer — shared by the dashboard preview and the TV player.
//  Renders onto a fixed 1920×1080 (or 1080×1920) "stage" that is scaled
//  to fit its container, so a slide looks identical everywhere.
// =====================================================================

export const TRANSITIONS = {
  none:          'None (cut)',
  fade:          'Fade',
  'slide-left':  'Slide left',
  'slide-right': 'Slide right',
  'slide-up':    'Slide up',
  'slide-down':  'Slide down',
  'zoom-in':     'Zoom in',
  'zoom-out':    'Zoom out',
  flip:          'Flip',
  blur:          'Blur',
  wipe:          'Wipe',
  'wipe-down':   'Wipe down',
  diagonal:      'Diagonal wipe',
  circle:        'Circle reveal',
  box:           'Box reveal',
  spin:          'Spin in',
  drop:          'Drop in',
  'flash-white': 'White flash',
};

export const EFFECTS = {
  none:        'None',
  kenburns:    'Ken Burns',
  'zoom-slow': 'Slow zoom in',
  'zoom-out':  'Slow zoom out',
  'pan-left':  'Pan left',
  'pan-right': 'Pan right',
  'pan-up':    'Pan up',
  'pan-down':  'Pan down',
  pulse:       'Gentle pulse',
  heartbeat:   'Heartbeat',
  flash:       'Flashing',
  'flash-fast':'Fast flashing',
  glow:        'Glow',
  bounce:      'Bounce',
  float:       'Float',
  shake:       'Shake',
  swing:       'Swing',
  rainbow:     'Colour cycle',
};

export const TEXT_ANIMS = {
  none:      'None',
  'fade-up': 'Fade up',
  'slide-in':'Slide in',
  pop:       'Pop',
  typewriter:'Typewriter',
  'bounce-in': 'Bounce in',
  'zoom-in': 'Zoom in',
  drop:      'Drop in',
  'blur-in': 'Blur in',
  'slide-up':'Slide up',
  flash:     'Flashing text',
  'pulse-text': 'Pulsing text',
};

export const TEXT_POSITIONS = {
  'top-left': 'Top left', top: 'Top', 'top-right': 'Top right',
  left: 'Left', center: 'Centre', right: 'Right',
  'bottom-left': 'Bottom left', bottom: 'Bottom', 'bottom-right': 'Bottom right',
};

export const BACKGROUNDS = {
  '#000000': 'Black',
  '#ffffff': 'White',
  '#0f172a': 'Midnight',
  '#7c2d12': 'Rust',
  '#14532d': 'Forest',
  'linear-gradient(135deg,#1e3a8a,#7c3aed)': 'Indigo glow',
  'linear-gradient(135deg,#f97316,#db2777)': 'Sunset',
  'linear-gradient(135deg,#0d9488,#2563eb)': 'Ocean',
  'linear-gradient(180deg,#111827,#374151)': 'Graphite',
};

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// ---------------------------------------------------------------------
//  Widgets placed on top of a slide: slide.items = [{ id, type, x, y, w, h (fractions of the slide),
//  widget, color, panel, text:{title,subtitle}, align }]. Each is drawn at a fixed design size and
//  scaled to fit its box, so it looks the same at any size.
// ---------------------------------------------------------------------
export const ITEM_TYPES = { text: 'Text box', clock: 'Clock & date', weather: 'Weather', qr: 'QR code', menu: 'Menu / price list' };
const ITEM_DESIGN = { text: [1400, 420], clock: [1300, 480], weather: [1600, 860], qr: [700, 790], menu: [1600, 1000] };
export function newItem(type, widgetDefaults) {
  const rect = { text: [0.08, 0.68, 0.6, 0.22], clock: [0.62, 0.05, 0.34, 0.16], weather: [0.58, 0.05, 0.38, 0.26], qr: [0.78, 0.58, 0.18, 0.36], menu: [0.05, 0.08, 0.5, 0.84] }[type] || [0.3, 0.3, 0.4, 0.3];
  const d = type === 'text' ? {} : (widgetDefaults?.(type) || {});
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2),
    type, x: rect[0], y: rect[1], w: rect[2], h: rect[3],
    widget: d.widget || {}, color: '#ffffff', panel: type !== 'qr',
    ...(type === 'text' ? { text: { title: 'Your headline', subtitle: '' }, align: 'left' } : {}),
  };
}
function textItem(inner, it) {
  const a = it.align || 'left';
  Object.assign(inner.style, { display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: { left: 'flex-start', center: 'center', right: 'flex-end' }[a], textAlign: a, color: it.color || '#fff', padding: '0 60px', boxSizing: 'border-box', textShadow: it.panel ? '' : '0 4px 24px rgba(0,0,0,.45)' });
  const t = it.text || {};
  if (t.title) { const d = document.createElement('div'); d.textContent = t.title; Object.assign(d.style, { fontSize: '150px', fontWeight: '800', lineHeight: '1.05', letterSpacing: '-0.02em' }); inner.appendChild(d); }
  if (t.subtitle) { const d = document.createElement('div'); d.textContent = t.subtitle; Object.assign(d.style, { fontSize: '70px', fontWeight: '500', marginTop: '18px', opacity: '.92' }); inner.appendChild(d); }
}
function buildItems(slide, el, opts) {
  for (const it of slide.items || []) {
    const [dw, dh] = ITEM_DESIGN[it.type] || [1200, 600];
    const box = document.createElement('div');
    box.className = 'sg-item';
    box.dataset.id = it.id;
    Object.assign(box.style, { position: 'absolute', left: it.x * 100 + '%', top: it.y * 100 + '%', width: it.w * 100 + '%', height: it.h * 100 + '%',
      zIndex: '3', overflow: 'hidden', borderRadius: '24px', background: it.panel ? (it.panelColor || 'rgba(0,0,0,.45)') : 'transparent' });
    const inner = document.createElement('div');
    Object.assign(inner.style, { position: 'absolute', left: '50%', top: '50%', width: dw + 'px', height: dh + 'px' });
    // Sizes are in stage pixels, which never change once on screen, so fit once it is attached
    // (the editor calls box._fit() again while dragging). No observers left running on the TV.
    const fit = () => { const k = Math.min(box.clientWidth / dw, box.clientHeight / dh) || 0; inner.style.transform = `translate(-50%, -50%) scale(${k})`; };
    box._fit = fit;
    let tries = 0;
    const wait = () => { if (box.isConnected && box.clientWidth) fit(); else if (++tries < 120) requestAnimationFrame(wait); };
    requestAnimationFrame(wait);
    if (it.type === 'text') textItem(inner, it);
    else buildWidget({ type: it.type, widget: it.widget || {}, text: { color: it.color || '#ffffff' } }, inner, opts);
    box.appendChild(inner);
    el.appendChild(box);
  }
}

export function newSlide(partial = {}) {
  return {
    id: (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)),
    type: 'text',            // image | video | text
    media_id: null,
    path: null,
    duration: 8,             // seconds; for video 0 = play to the end
    transition: 'none',      // new slides: no transition, no motion (can be changed per slide)
    transition_ms: 900,
    effect: 'none',
    fit: 'cover',            // cover (fill, may crop) | contain (whole picture) | blur (whole picture on a blurred copy) | stretch (resized to exactly fill)
    bg: '#000000',
    muted: true,
    text: { title: '', subtitle: '', position: 'bottom-left', color: '#ffffff', size: 'm', box: true, anim: 'fade-up' },
    schedule: null,          // { days:[0..6], from:'09:00', to:'17:00' }
    ...partial,
  };
}

// ---------------------------------------------------------------------
//  Scheduling
// ---------------------------------------------------------------------
export function isSlideActive(slide, now = new Date()) {
  // Show-from / show-until dates (e.g. a promotion that ends on 30 Nov)
  if (slide.valid_from || slide.valid_until) {
    const d = localDate(now);
    if (slide.valid_from && d < slide.valid_from) return false;
    if (slide.valid_until && d > slide.valid_until) return false;
  }
  const s = slide.schedule;
  if (!s) return true;
  const mins = now.getHours() * 60 + now.getMinutes();
  const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
  // Different times on each day: { per_day: true, days: [...], times: { "1": {from,to}, ... } }
  if (s.per_day && s.times) {
    const day = now.getDay(), yday = (day + 6) % 7;
    const on = (d) => !Array.isArray(s.days) || !s.days.length || s.days.includes(d);
    // A ticked day without its own times uses the main From/Until (as the editor shows); none at all = all day.
    const win = (d) => { const t = s.times[d] || { from: s.from, to: s.to }; return t.from && t.to ? [toMin(t.from), toMin(t.to)] : [0, 24 * 60]; };
    const today = on(day) && win(day);
    if (today) {
      const [a, b] = today;
      if (a <= b ? (mins >= a && mins < b) : mins >= a) return true;
    }
    const prev = on(yday) && win(yday);       // yesterday's window running past midnight
    return !!(prev && prev[0] > prev[1] && mins < prev[1]);
  }
  if (Array.isArray(s.days) && s.days.length && !s.days.includes(now.getDay())) return false;
  if (s.from && s.to) {
    const a = toMin(s.from), b = toMin(s.to);
    return a <= b ? (mins >= a && mins < b) : (mins >= a || mins < b); // overnight ranges
  }
  return true;
}

// ---------------------------------------------------------------------
//  Per-screen schedule: which playlist should be on air right now?
//  content = { default, schedule:[{playlist_id, days, start_time, end_time,
//              start_date, end_date, priority}], playlists:{id:{...}} }
// ---------------------------------------------------------------------
const pad = (n) => String(n).padStart(2, '0');
export const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toMin = (t) => { if (!t) return null; const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };

export function ruleMatches(rule, now = new Date()) {
  const today = localDate(now);
  const mins = now.getHours() * 60 + now.getMinutes();
  // Different times on each day.
  if (rule.day_times && Object.keys(rule.day_times).length) {
    const dayOk = (d) => !Array.isArray(rule.days) || !rule.days.length || rule.days.includes(d);
    const dateOk = (ds) => !(rule.start_date && ds < rule.start_date) && !(rule.end_date && ds > rule.end_date);
    const win = (d) => {
      const t = rule.day_times[d] || { from: rule.start_time, to: rule.end_time };
      const a = toMin(t.from), b = toMin(t.to);
      return a == null && b == null ? [0, 24 * 60] : [a ?? 0, b ?? 24 * 60];
    };
    const d = now.getDay();
    if (dayOk(d) && dateOk(today)) {
      const [a, b] = win(d);
      if (a <= b ? (mins >= a && mins < b) : mins >= a) return true;
    }
    const y = new Date(now); y.setDate(y.getDate() - 1);
    if (dayOk(y.getDay()) && dateOk(localDate(y))) {
      const [a, b] = win(y.getDay());
      if (a > b && mins < b) return true;      // yesterday's slot running past midnight
    }
    return false;
  }
  const a = toMin(rule.start_time), b = toMin(rule.end_time);
  const start = a ?? 0, end = b ?? 24 * 60;
  const overnight = start > end;
  // For an overnight rule (22:00–02:00), the early-morning part belongs to
  // the previous day's slot, so check days/dates against yesterday.
  let ref = now, dateStr = today;
  if (overnight && mins < end) {
    ref = new Date(now); ref.setDate(ref.getDate() - 1); dateStr = localDate(ref);
  }
  if (rule.start_date && dateStr < rule.start_date) return false;
  if (rule.end_date && dateStr > rule.end_date) return false;
  if (Array.isArray(rule.days) && rule.days.length && !rule.days.includes(ref.getDay())) return false;
  if (a == null && b == null) return true;
  return overnight ? (mins >= start || mins < end) : (mins >= start && mins < end);
}

export function resolveSchedule(content, now = new Date()) {
  if (!content) return { playlistId: null, rule: null };
  const rules = [...(content.schedule || [])].sort((x, y) => (y.priority || 0) - (x.priority || 0));
  for (const r of rules) {
    if (content.playlists?.[r.playlist_id] && ruleMatches(r, now)) return { playlistId: r.playlist_id, rule: r };
  }
  const d = content.default;
  return { playlistId: d && content.playlists?.[d] ? d : null, rule: null };
}

/**
 * What should be on air, including "add-on" playlists that play after the
 * default one (content.also). Returns { playlistId, rule, key, pl, name }.
 */
export function onAirPlaylist(content, now = new Date()) {
  const r = resolveSchedule(content, now);
  if (!content) return { ...r, key: null, pl: null, name: null };
  const also = (content.also || []).filter((id) => content.playlists?.[id] && id !== r.playlistId);
  if (r.rule || !also.length) {
    const pl = r.playlistId ? content.playlists[r.playlistId] : null;
    return { ...r, key: r.playlistId, pl, name: pl?.name || null };
  }
  const ids = [r.playlistId, ...also].filter(Boolean);
  const main = content.playlists[ids[0]];
  const name = ids.map((i) => content.playlists[i].name).join(' + ');
  return { playlistId: ids[0], rule: null, key: ids.join('+'), name,
    pl: { name, settings: main.settings, slides: ids.flatMap((i) => (content.playlists[i].slides || []).map((s) => ({ ...s, _pl: i }))) } };
}

export function describeRule(r) {
  if (r.day_times && Object.keys(r.day_times).length) {
    const ds = r.days?.length ? [...r.days] : [0, 1, 2, 3, 4, 5, 6];
    const order = [1, 2, 3, 4, 5, 6, 0].filter((d) => ds.includes(d));
    const fmtT = (d) => { const t = r.day_times[d] || { from: r.start_time, to: r.end_time }; return t.from || t.to ? `${(t.from || '00:00').slice(0, 5)}–${(t.to || '24:00').slice(0, 5)}` : 'all day'; };
    const parts = order.map((d) => `${DAY_NAMES[d]} ${fmtT(d)}`).join(', ');
    const fmt = (s) => new Date(s + 'T00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    return parts + (r.start_date || r.end_date ? ` · ${r.start_date ? fmt(r.start_date) : '…'} → ${r.end_date ? fmt(r.end_date) : '…'}` : '');
  }
  const days = !r.days || !r.days.length || r.days.length === 7 ? 'Every day'
    : (JSON.stringify([...r.days].sort()) === '[1,2,3,4,5]' ? 'Weekdays'
    : (JSON.stringify([...r.days].sort()) === '[0,6]' ? 'Weekends'
    : [...r.days].sort().map((d) => DAY_NAMES[d]).join(', ')));
  const time = r.start_time || r.end_time ? `${(r.start_time || '00:00').slice(0, 5)}–${(r.end_time || '24:00').slice(0, 5)}` : 'all day';
  const fmt = (s) => new Date(s + 'T00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const dates = r.start_date || r.end_date ? ` · ${r.start_date ? fmt(r.start_date) : '…'} → ${r.end_date ? fmt(r.end_date) : '…'}` : '';
  return `${days}, ${time}${dates}`;
}

// ---------------------------------------------------------------------
//  Stage: fixed-size canvas scaled to its container
// ---------------------------------------------------------------------
export function createStage(container, orientation = 'landscape', size = null) {
  container.classList.add('sg-host');
  const stage = document.createElement('div');
  stage.className = 'sg-stage';
  container.appendChild(stage);
  const setOrientation = (o) => {
    const portrait = o === 'portrait';
    stage.style.width = (size ? size.w : portrait ? 1080 : 1920) + 'px';
    stage.style.height = (size ? size.h : portrait ? 1920 : 1080) + 'px';
    fit();
  };
  const fit = () => {
    const w = container.clientWidth, h = container.clientHeight;
    const sw = parseFloat(stage.style.width), sh = parseFloat(stage.style.height);
    if (!w || !h) return;
    // On the TV (bleed > 1) the picture overshoots the screen very slightly and is snapped to whole pixels,
    // so a rounding gap can never show as a thin line along an edge.
    const bleed = window.__sgBleed || 1;
    const k = Math.min(w / sw, h / sh) * bleed;
    const tx = (w - sw * k) / 2, ty = (h - sh * k) / 2;
    stage.style.transform = bleed > 1 ? `translate(${Math.floor(tx)}px, ${Math.floor(ty)}px) scale(${k})` : `translate(${tx}px, ${ty}px) scale(${k})`;
  };
  const ro = new ResizeObserver(fit);
  ro.observe(container);
  setOrientation(orientation);
  return { stage, setOrientation, fit, destroy: () => { ro.disconnect(); stage.remove(); } };
}

// ---------------------------------------------------------------------
//  Build one slide's DOM
// ---------------------------------------------------------------------
export function buildSlide(slide, url, { forPreview = false, mutedOverride } = {}) {
  const el = document.createElement('div');
  el.className = 'sg-slide';
  el.style.background = slide.bg || '#000';

  let media = null;
  if (slide.type === 'image' && url) {
    media = document.createElement('img');
    media.src = url;
    media.alt = '';
    media.decoding = 'async';
  } else if (slide.type === 'video' && url) {
    media = document.createElement('video');
    // Previews show a frame a little way in (many videos open on a blank/white frame).
    media.src = forPreview && !String(url).includes('#') ? url + '#t=2' : url;
    media.playsInline = true;
    media.setAttribute('playsinline', '');
    media.preload = 'auto';
    media.muted = mutedOverride ?? (slide.muted !== false);
    if (slide.duration > 0) media.loop = true;
  }
  if (media) {
    media.className = 'sg-media';
    const fitWhole = slide.fit === 'contain' || slide.fit === 'blur';
    media.style.objectFit = slide.fit === 'stretch' ? 'fill' : fitWhole ? 'contain' : 'cover';
    const wrap = document.createElement('div');
    wrap.className = 'sg-media-wrap';
    // "Fit + blur": a soft, enlarged copy of the picture fills the spare space behind it.
    if (slide.fit === 'blur' && slide.type === 'image' && url) {
      const bg = document.createElement('img');
      bg.className = 'sg-media-bg'; bg.src = url; bg.alt = ''; bg.decoding = 'async';
      wrap.appendChild(bg);
    }
    wrap.appendChild(media);
    el.appendChild(wrap);
  } else if (isWidget(slide.type)) {
    buildWidget(slide, el, { forPreview });
  } else if (slide.type !== 'text') {
    const ph = document.createElement('div');
    ph.className = 'sg-missing';
    ph.textContent = forPreview ? 'Choose a picture or video' : '';
    el.appendChild(ph);
  }

  const t = slide.text || {};
  if (t.title || t.subtitle) {
    const box = document.createElement('div');
    box.className = `sg-text pos-${t.position || 'bottom-left'} size-${t.size || 'm'}${t.box ? ' boxed' : ''}`;
    box.style.color = t.color || '#fff';
    if (t.title) {
      const h = document.createElement('div');
      h.className = 'sg-title';
      h.textContent = t.title;
      box.appendChild(h);
    }
    if (t.subtitle) {
      const p = document.createElement('div');
      p.className = 'sg-subtitle';
      p.textContent = t.subtitle;
      box.appendChild(p);
    }
    el.appendChild(box);
  }
  buildItems(slide, el, { forPreview });
  return el;
}

function waitReady(el, timeout = 10000) {
  const m = el.querySelector('.sg-media');
  if (!m) return Promise.resolve(true);
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => { if (!done) { done = true; resolve(ok); } };
    setTimeout(() => finish(m.tagName === 'IMG' ? m.complete && m.naturalWidth > 0 : m.readyState >= 2), timeout);
    if (m.tagName === 'IMG') {
      // Decode fully before the transition starts, so it doesn't stutter.
      const decoded = () => (m.decode ? m.decode().then(() => finish(true), () => finish(m.naturalWidth > 0)) : finish(true));
      if (m.complete && m.naturalWidth) return decoded();
      m.addEventListener('load', decoded, { once: true });
      m.addEventListener('error', () => finish(false), { once: true });
    } else {
      if (m.readyState >= 3) return finish(true);
      m.addEventListener('canplay', () => finish(true), { once: true });
      m.addEventListener('error', () => finish(false), { once: true });
    }
  });
}

// Start a video and resolve once its first frame is actually on screen,
// so we never fade in a black / frozen box.
function startVideo(video, timeout = 2500) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    setTimeout(finish, timeout);
    const onFrame = () => (video.requestVideoFrameCallback ? video.requestVideoFrameCallback(() => finish()) : setTimeout(finish, 80));
    video.addEventListener('playing', onFrame, { once: true });
    video.play().catch(() => { video.muted = true; video.play().catch(finish); });
  });
}

// ---------------------------------------------------------------------
//  Animations (Web Animations API)
// ---------------------------------------------------------------------
const T = {
  fade:          { in: [{ opacity: 0 }, { opacity: 1 }], out: [{ opacity: 1 }, { opacity: 0 }] },
  'slide-left':  { in: [{ transform: 'translateX(100%)' }, { transform: 'none' }], out: [{ transform: 'none' }, { transform: 'translateX(-100%)' }] },
  'slide-right': { in: [{ transform: 'translateX(-100%)' }, { transform: 'none' }], out: [{ transform: 'none' }, { transform: 'translateX(100%)' }] },
  'slide-up':    { in: [{ transform: 'translateY(100%)' }, { transform: 'none' }], out: [{ transform: 'none' }, { transform: 'translateY(-100%)' }] },
  'slide-down':  { in: [{ transform: 'translateY(-100%)' }, { transform: 'none' }], out: [{ transform: 'none' }, { transform: 'translateY(100%)' }] },
  'zoom-in':     { in: [{ opacity: 0, transform: 'scale(1.35)' }, { opacity: 1, transform: 'none' }], out: [{ opacity: 1 }, { opacity: 0 }] },
  'zoom-out':    { in: [{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'none' }], out: [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'scale(1.2)' }] },
  flip:          { in: [{ transform: 'rotateY(-90deg)', offset: 0 }, { transform: 'rotateY(-90deg)', offset: .5 }, { transform: 'none' }],
                   out: [{ transform: 'none' }, { transform: 'rotateY(90deg)', offset: .5 }, { transform: 'rotateY(90deg)' }] },
  blur:          { in: [{ opacity: 0, filter: 'blur(16px)' }, { opacity: 1, filter: 'blur(0)' }], out: [{ opacity: 1, filter: 'blur(0)' }, { opacity: 0, filter: 'blur(16px)' }] },
  wipe:          { in: [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], out: [{ opacity: 1 }, { opacity: 1 }] },
  circle:        { in: [{ clipPath: 'circle(0% at 50% 50%)' }, { clipPath: 'circle(75% at 50% 50%)' }], out: [{ opacity: 1 }, { opacity: 1 }] },
  'wipe-down':   { in: [{ clipPath: 'inset(0 0 100% 0)' }, { clipPath: 'inset(0 0 0 0)' }], out: [{ opacity: 1 }, { opacity: 1 }] },
  diagonal:      { in: [{ clipPath: 'polygon(0 0, 0 0, 0 0, 0 0)' }, { clipPath: 'polygon(0 0, 200% 0, 0 200%, 0 0)' }], out: [{ opacity: 1 }, { opacity: 1 }] },
  box:           { in: [{ clipPath: 'inset(50% 50% 50% 50%)' }, { clipPath: 'inset(0 0 0 0)' }], out: [{ opacity: 1 }, { opacity: 1 }] },
  spin:          { in: [{ opacity: 0, transform: 'rotate(-180deg) scale(.3)' }, { opacity: 1, transform: 'none' }], out: [{ opacity: 1 }, { opacity: 0 }] },
  drop:          { in: [{ transform: 'translateY(-100%)' }, { transform: 'translateY(4%)', offset: .7 }, { transform: 'translateY(-1.5%)', offset: .85 }, { transform: 'none' }], out: [{ opacity: 1 }, { opacity: 1 }] },
  'flash-white': { in: [{ opacity: 0, filter: 'brightness(3)' }, { opacity: 1, filter: 'brightness(3)', offset: .35 }, { opacity: 1, filter: 'brightness(1)' }], out: [{ opacity: 1, filter: 'brightness(1)' }, { opacity: 1, filter: 'brightness(3)' }] },
};

const E = {
  kenburns:    [{ transform: 'scale(1) translate(0,0)' }, { transform: 'scale(1.18) translate(-3%,-2%)' }],
  'zoom-slow': [{ transform: 'scale(1)' }, { transform: 'scale(1.15)' }],
  'zoom-out':  [{ transform: 'scale(1.15)' }, { transform: 'scale(1)' }],
  'pan-left':  [{ transform: 'scale(1.12) translateX(4%)' }, { transform: 'scale(1.12) translateX(-4%)' }],
  'pan-right': [{ transform: 'scale(1.12) translateX(-4%)' }, { transform: 'scale(1.12) translateX(4%)' }],
  'pan-up':    [{ transform: 'scale(1.12) translateY(4%)' }, { transform: 'scale(1.12) translateY(-4%)' }],
  'pan-down':  [{ transform: 'scale(1.12) translateY(-4%)' }, { transform: 'scale(1.12) translateY(4%)' }],
  pulse:       [{ transform: 'scale(1)' }, { transform: 'scale(1.04)' }, { transform: 'scale(1)' }],
  heartbeat:   [{ transform: 'scale(1)' }, { transform: 'scale(1.07)', offset: .14 }, { transform: 'scale(1)', offset: .28 }, { transform: 'scale(1.05)', offset: .42 }, { transform: 'scale(1)', offset: .7 }, { transform: 'scale(1)' }],
  flash:       [{ opacity: 1 }, { opacity: 1, offset: .45 }, { opacity: .12, offset: .5 }, { opacity: .12, offset: .95 }, { opacity: 1 }],
  'flash-fast':[{ opacity: 1 }, { opacity: 1, offset: .45 }, { opacity: .12, offset: .5 }, { opacity: .12, offset: .95 }, { opacity: 1 }],
  glow:        [{ filter: 'brightness(1) saturate(1)' }, { filter: 'brightness(1.35) saturate(1.3)' }, { filter: 'brightness(1) saturate(1)' }],
  bounce:      [{ transform: 'translateY(0)' }, { transform: 'translateY(-4%)', offset: .3 }, { transform: 'translateY(0)', offset: .55 }, { transform: 'translateY(-1.5%)', offset: .75 }, { transform: 'translateY(0)' }],
  float:       [{ transform: 'translateY(0)' }, { transform: 'translateY(-2.5%)' }, { transform: 'translateY(0)' }],
  shake:       [{ transform: 'translateX(0)' }, { transform: 'translateX(-1.2%) rotate(-.6deg)', offset: .1 }, { transform: 'translateX(1.2%) rotate(.6deg)', offset: .2 }, { transform: 'translateX(-1%)', offset: .3 }, { transform: 'translateX(1%)', offset: .4 }, { transform: 'translateX(0)', offset: .5 }, { transform: 'translateX(0)' }],
  swing:       [{ transform: 'rotate(0)' }, { transform: 'rotate(2deg)' }, { transform: 'rotate(0)' }, { transform: 'rotate(-2deg)' }, { transform: 'rotate(0)' }],
  rainbow:     [{ filter: 'hue-rotate(0deg)' }, { filter: 'hue-rotate(360deg)' }],
};
// Effects that repeat for as long as the slide is on screen: [period ms, easing]
const E_LOOP = { pulse: [3000, 'ease-in-out'], heartbeat: [1400, 'ease-in-out'], flash: [1000, 'linear'], 'flash-fast': [500, 'linear'],
  glow: [1800, 'ease-in-out'], bounce: [1400, 'ease-out'], float: [4000, 'ease-in-out'], shake: [1600, 'linear'], swing: [3000, 'ease-in-out'], rainbow: [6000, 'linear'] };

function animateText(el, anim) {
  const box = el.querySelector('.sg-text');
  if (!box || !anim || anim === 'none') return;
  const kids = [...box.children];
  if (anim === 'typewriter') {
    kids.forEach((k, i) => {
      const full = k.textContent;
      k.textContent = '';
      k.style.minHeight = '1em';
      let n = 0;
      const start = 400 + i * (full.length * 45 + 200);
      setTimeout(function tick() {
        if (!k.isConnected) return;
        k.textContent = full.slice(0, ++n);
        if (n < full.length) setTimeout(tick, 45);
      }, start);
    });
    return;
  }
  const frames = {
    'fade-up':  [{ opacity: 0, transform: 'translateY(40px)' }, { opacity: 1, transform: 'none' }],
    'slide-in': [{ opacity: 0, transform: 'translateX(-120px)' }, { opacity: 1, transform: 'none' }],
    pop:        [{ opacity: 0, transform: 'scale(.6)' }, { opacity: 1, transform: 'scale(1.05)', offset: .7 }, { opacity: 1, transform: 'none' }],
    'bounce-in':[{ opacity: 0, transform: 'scale(.3)' }, { opacity: 1, transform: 'scale(1.12)', offset: .5 }, { transform: 'scale(.94)', offset: .72 }, { transform: 'scale(1.03)', offset: .88 }, { opacity: 1, transform: 'none' }],
    'zoom-in':  [{ opacity: 0, transform: 'scale(1.6)' }, { opacity: 1, transform: 'none' }],
    drop:       [{ opacity: 0, transform: 'translateY(-160px)' }, { opacity: 1, transform: 'translateY(12px)', offset: .7 }, { opacity: 1, transform: 'none' }],
    'blur-in':  [{ opacity: 0, filter: 'blur(18px)' }, { opacity: 1, filter: 'blur(0)' }],
    'slide-up': [{ opacity: 0, transform: 'translateY(120px)' }, { opacity: 1, transform: 'none' }],
  }[anim];
  // Text that keeps moving while the slide is on screen.
  const loops = { flash: [[{ opacity: 1 }, { opacity: 1, offset: .5 }, { opacity: .15, offset: .5 }, { opacity: .15 }], 1000, 'linear'],
    'pulse-text': [[{ transform: 'scale(1)' }, { transform: 'scale(1.06)' }, { transform: 'scale(1)' }], 1600, 'ease-in-out'] }[anim];
  if (loops) { kids.forEach((k) => { k.style.display = k.style.display || 'block'; k.animate(loops[0], { duration: loops[1], easing: loops[2], iterations: Infinity }); }); return; }
  if (!frames) return;
  kids.forEach((k, i) => k.animate(frames, { duration: 800, delay: 350 + i * 220, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' }));
}

function startEffect(el, slide, seconds) {
  const frames = E[slide.effect];
  // Pictures/videos move as a whole; text and widget slides move their content.
  const target = el.querySelector('.sg-media-wrap') || el.querySelector('.sg-text') || [...el.children].find((c) => !c.classList.contains('sg-item'));
  if (!frames || !target) return;
  target.style.willChange = /flash|glow|rainbow/.test(slide.effect) ? 'opacity, filter' : 'transform';
  const loop = E_LOOP[slide.effect];
  target.animate(frames, loop
    ? { duration: loop[0], easing: loop[1], iterations: Infinity }
    : { duration: Math.max(2, seconds) * 1000 + (slide.transition_ms || 0), easing: 'linear', fill: 'forwards', iterations: 1 });
}

// ---------------------------------------------------------------------
//  Player
// ---------------------------------------------------------------------
export class SlidePlayer {
  /**
   * @param {HTMLElement} container
   * @param {{ resolveUrl:(slide)=>Promise<string|null>, onChange?:(info)=>void, mutedOverride?:boolean }} opts
   */
  constructor(container, opts) {
    this.opts = opts;
    this.host = createStage(container, 'landscape', opts.size || null);
    this.slides = [];
    this.index = -1;
    this.current = null;
    this.timer = null;
    this.running = false;
    this.token = 0;
  }

  load(content) {
    const settings = content?.settings || {};
    this.host.setOrientation(settings.orientation || 'landscape');
    this.slides = (content?.slides || []).filter(Boolean);
    this.index = -1;
    this.fresh = true;            // content changed: rebuild even a single slide
    if (this.running) this.next();
  }

  start() { this.running = true; this.next(); }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    this.token++;
  }

  clear() {
    this.stop();
    this.host.stage.replaceChildren();
    this.current = null;
  }

  activeIndexes() {
    const now = new Date();
    return this.slides.map((s, i) => (isSlideActive(s, now) ? i : -1)).filter((i) => i >= 0);
  }

  async next() {
    clearTimeout(this.timer);
    const my = ++this.token;
    const active = this.activeIndexes();
    if (!active.length) {
      this.opts.onChange?.({ index: -1, total: this.slides.length, idle: true });
      this._swap(null, null, my);
      this.timer = setTimeout(() => this.running && this.next(), 30000);
      return;
    }
    const pos = active.findIndex((i) => i > this.index);
    const idx = pos >= 0 ? active[pos] : active[0];
    // One slide on screen and nothing changed: keep it running untouched
    // (rebuilding it would restart the video / flash the picture).
    if (active.length === 1 && !this.fresh && this.current && this.current.dataset.id === this.slides[idx].id) {
      this.timer = setTimeout(() => this.running && this.next(), 60000);
      return;
    }
    this.fresh = false;
    await this.show(idx, my, active.length);
  }

  async goto(i) {
    this.index = i - 1;
    return this.next();
  }

  async show(idx, my = ++this.token, activeCount = 1) {
    const slide = this.slides[idx];
    let url = null;
    const isMedia = slide.type === 'image' || slide.type === 'video';
    if (isMedia) {
      // Don't let a slow/stalled download freeze the screen: give up after 20s
      // (the download carries on in the background for next time).
      try { url = await Promise.race([this.opts.resolveUrl(slide), new Promise((r) => setTimeout(() => r(null), 20000))]); }
      catch (e) { console.warn('media failed', e); }
    }
    if (my !== this.token) return;
    const el = buildSlide(slide, url, { mutedOverride: this.opts.mutedOverride });
    el.style.opacity = '0';           // laid out & decoding, but not visible yet
    this.host.stage.appendChild(el);
    const ok = isMedia && !url ? false : await waitReady(el);   // missing file → skip the slide
    if (my !== this.token) { el.remove(); return; }
    if (!ok && (slide.type === 'image' || slide.type === 'video') && this.slides.length > 1) {
      el.remove();
      this.index = idx;
      this.timer = setTimeout(() => this.next(), 1000);
      return;
    }
    this.index = idx;
    const video = el.querySelector('video');
    if (video) { await startVideo(video); if (my !== this.token) { el.remove(); return; } }
    el.style.opacity = '';
    // Same single slide re-shown: no transition needed.
    const skipTransition = activeCount === 1 && this.current && this.current.dataset.id === slide.id;
    el.dataset.id = slide.id;
    this._swap(el, slide, my, skipTransition);

    let seconds = Number(slide.duration) || 0;
    if (video) {
      if (seconds <= 0) {
        video.loop = activeCount === 1;
        const fallback = (isFinite(video.duration) && video.duration > 0 ? video.duration : 60) + 2;
        seconds = fallback;
        video.addEventListener('ended', () => { if (my === this.token && activeCount > 1) this.next(); }, { once: true });
      }
    }
    if (seconds <= 0) seconds = 8;
    startEffect(el, slide, seconds);
    animateText(el, slide.text?.anim);
    this.opts.onChange?.({ index: idx, total: this.slides.length, slide });

    if (this.running && (activeCount > 1 || slide.schedule)) {
      this.timer = setTimeout(() => this.next(), seconds * 1000);
    } else if (this.running) {
      // single slide: re-check schedule every minute
      this.timer = setTimeout(() => this.next(), Math.max(seconds, 60) * 1000);
    }
  }

  _swap(el, slide, my, skip = false) {
    const prev = this.current;
    this.current = el;
    const kind = skip ? 'none' : (slide?.transition || 'fade');
    const ms = skip ? 0 : (slide?.transition_ms ?? 900);
    const anim = T[kind];
    if (el) el.style.zIndex = 2;
    if (prev) {
      prev.style.zIndex = 1;
      // Freeze the outgoing video: many TV sticks can't decode two videos at once.
      prev.querySelectorAll('video').forEach((v) => { try { v.pause(); } catch {} });
    }

    const cleanup = () => {
      if (prev && prev !== this.current) {
        prev.querySelectorAll('video').forEach((v) => { v.pause(); v.removeAttribute('src'); v.load(); });
        prev.remove();
      }
    };
    if (!anim || ms <= 0 || !prev || !el) { cleanup(); return; }
    const opt = { duration: ms, easing: 'cubic-bezier(.65,0,.35,1)', fill: 'both' };
    el.style.willChange = prev.style.willChange = 'transform, opacity';
    const a = el.animate(anim.in, opt);
    prev.animate(anim.out, opt);
    const end = () => { el.style.willChange = ''; cleanup(); };
    a.finished.then(() => { a.cancel(); end(); }).catch(end);
  }
}

// Render a single static frame (used for thumbnails).
export function renderStill(container, slide, url, orientation = 'landscape', size = null) {
  container.__sgStill?.destroy();          // stop the previous stage's resize watcher
  container.replaceChildren();
  const st = createStage(container, orientation, size);
  const el = buildSlide(slide, url, { forPreview: true, mutedOverride: true });
  st.stage.appendChild(el);
  container.__sgStill = st;
  return st;
}

// ---------------------------------------------------------------------
//  Layouts: the screen split into areas, each playing its own playlist.
//  settings.layout: 'full' | 'split-v' | 'split-h' | 'main-two' | 'three' | 'quad' | 'side'
//    (older values 'ticker' / 'side-ticker' still work)
//  Each slide has slide.zone = area index (0 = area 1). An area with no slides of its own can
//  instead play another playlist: settings.zones = [playlistId for area 2, area 3, area 4].
//  settings.ticker_on + settings.ticker: { text, speed: 'slow'|'normal'|'fast', bg, color,
//    position: 'bottom'|'top'|'both'|'<area index>:bottom|top|both', text2 (bottom text when 'both'), size: 'small'|'normal'|'large', dir: 'rtl'|'ltr' }
// ---------------------------------------------------------------------
export const LAYOUTS = {
  full: 'Full screen',
  'split-v': 'Two halves, side by side',
  'split-h': 'Two halves, top and bottom',
  'main-two': 'Large area + two small',
  three: 'Three columns',
  quad: 'Four squares (2×2)',
  side: 'Main + narrow side panel',
};
/** Layout name, worded for the screen's orientation. */
export const layoutLabel = (k, portrait = false) => (portrait ? { three: 'Three rows', side: 'Main + narrow bottom panel' }[k] : null) || LAYOUTS[k] || LAYOUTS.full;
const TICKER_H = 96;

/** Normalise old layout values. Returns { layout, ticker:boolean }. */
export function normLayout(st = {}) {
  let layout = st.layout || 'full', ticker = !!st.ticker_on;
  if (layout === 'ticker') { layout = 'full'; ticker = true; }
  if (layout === 'side-ticker') { layout = 'side'; ticker = true; }
  if (!LAYOUTS[layout]) layout = 'full';
  return { layout, ticker };
}

/** Size sliders each layout offers: [key, label, default fraction]. settings.layout_split = { a, b }. */
export function splitControls(layout, portrait = false) {
  return ({
    'split-v': [['a', 'Area 1 width', 0.5]],
    'split-h': [['a', 'Area 1 height', 0.5]],
    'main-two': portrait ? [['a', 'Area 1 height', 2 / 3], ['b', 'Area 2 width', 0.5]] : [['a', 'Area 1 width', 2 / 3], ['b', 'Area 2 height', 0.5]],
    three: portrait ? [['a', 'Area 1 height', 1 / 3], ['b', 'Area 2 height', 1 / 3]] : [['a', 'Area 1 width', 1 / 3], ['b', 'Area 2 width', 1 / 3]],
    quad: [['a', 'Left column width', 0.5], ['b', 'Top row height', 0.5]],
    side: [['a', portrait ? 'Bottom panel height' : 'Side panel width', 0.25]],
  })[layout] || [];
}
const clampF = (v, d, lo = 0.1, hi = 0.9) => { const n = Number(v); return Math.min(hi, Math.max(lo, isFinite(n) && n > 0 ? n : d)); };

/** Areas as [x, y, w, h] for a stage of W×H. Area 0 plays the playlist itself. sp = optional sizes { a, b }. */
export function layoutZones(layout, W, H, sp = null) {
  const portrait = H > W;
  const f = (k) => { const c = splitControls(layout, portrait).find((x) => x[0] === k); return clampF(sp?.[k], c ? c[2] : 0.5); };
  const R = Math.round;
  switch (layout) {
    case 'split-v': { const lw = R(W * f('a')); return [[0, 0, lw, H], [lw, 0, W - lw, H]]; }
    case 'split-h': { const th = R(H * f('a')); return [[0, 0, W, th], [0, th, W, H - th]]; }
    case 'three': {
      const a = Math.min(f('a'), 0.8), b = Math.min(Math.max(f('b'), 0.1), 0.9 - a);   // every area keeps at least 10%
      if (portrait) { const h1 = R(H * a), h2 = R(H * b); return [[0, 0, W, h1], [0, h1, W, h2], [0, h1 + h2, W, H - h1 - h2]]; }
      const w1 = R(W * a), w2 = R(W * b); return [[0, 0, w1, H], [w1, 0, w2, H], [w1 + w2, 0, W - w1 - w2, H]];
    }
    case 'quad': { const cw = R(W * f('a')), rh = R(H * f('b')); return [[0, 0, cw, rh], [cw, 0, W - cw, rh], [0, rh, cw, H - rh], [cw, rh, W - cw, H - rh]]; }
    case 'main-two': {
      if (portrait) { const mh = R(H * f('a')), sw = R(W * f('b')); return [[0, 0, W, mh], [0, mh, sw, H - mh], [sw, mh, W - sw, H - mh]]; }
      const mw = R(W * f('a')), sh = R(H * f('b')); return [[0, 0, mw, H], [mw, 0, W - mw, sh], [mw, sh, W - mw, H - sh]];
    }
    case 'side': {
      if (portrait) { const ph = R(H * f('a')); return [[0, 0, W, H - ph], [0, H - ph, W, ph]]; }
      const pw = R(W * f('a')); return [[0, 0, W - pw, H], [W - pw, 0, pw, H]];
    }
    default: return [[0, 0, W, H]];
  }
}
export const zoneCount = (layout) => layoutZones(layout, 1920, 1080).length;

export const TICKER_SIZES = { small: 64, normal: TICKER_H, large: 140 };
/** Where the ticker sits: { area: null | index, edge: 'top'|'bottom' }. */
export function tickerPlace(t = {}, layout = 'full') {
  const m = /^(?:(\d+):)?(top|bottom|both)$/.exec(t.position || 'bottom') || [];
  let area = m[1] != null ? +m[1] : null;
  if (area != null && area >= zoneCount(layout)) area = null;
  if (area != null && zoneCount(layout) < 2) area = null;
  return { area, edge: m[2] || 'bottom' };
}
/** Areas and ticker strips for a W×H stage: { zones: [[x,y,w,h]…], tickers: [{ rect: [x,y,w,h], edge }] }. */
/** Pixel size of each area on a Full HD screen (1920×1080, or 1080×1920 in portrait): [[w, h], …] */
export function areaPixels(layout, portrait = false, ticker = null, split = null) {
  return layoutWithTicker(layout, portrait ? 1080 : 1920, portrait ? 1920 : 1080, ticker, split).zones.map(([, , w, h]) => [w, h]);
}
export function layoutWithTicker(layout, W, H, t = null, sp = null) {
  if (!t) return { zones: layoutZones(layout, W, H, sp), tickers: [] };
  const TH = TICKER_SIZES[t.size] || TICKER_H;
  const { area, edge } = tickerPlace(t, layout);
  const top = edge !== 'bottom', bottom = edge !== 'top';
  const cut = ([x, y, w, h]) => [x, y + (top ? TH : 0), w, Math.max(1, h - (top ? TH : 0) - (bottom ? TH : 0))];
  const strips = ([x, y, w, h]) => [...(top ? [{ rect: [x, y, w, TH], edge: 'top' }] : []), ...(bottom ? [{ rect: [x, y + h - TH, w, TH], edge: 'bottom' }] : [])];
  if (area == null) {
    const [, cy, , ch] = cut([0, 0, W, H]);
    return { zones: layoutZones(layout, W, ch, sp).map(([x, y, w, h]) => [x, y + cy, w, h]), tickers: strips([0, 0, W, H]) };
  }
  const zones = layoutZones(layout, W, H, sp);
  const box = zones[area];
  zones[area] = cut(box);
  return { zones, tickers: strips(box) };
}

/** Playlist ids for areas 2…n. */
export function zonePlaylistIds(st = {}) {
  const { layout } = normLayout(st);
  const ids = [...(Array.isArray(st.zones) ? st.zones : [])].slice(0, zoneCount(layout) - 1);
  if (layout === 'side' && !ids[0] && st.side_playlist_id) ids[0] = st.side_playlist_id;
  while (ids.length < zoneCount(layout) - 1) ids.push(null);
  return ids;
}

export class LayoutPlayer {
  /** opts: SlidePlayer opts + lookup(playlistId) → playlist ({slides, settings}) */
  constructor(container, opts) {
    this.container = container;
    this.opts = opts;
    this.players = [];
    this.host = null;
    this.running = false;
  }

  _reset() {
    this.players.forEach((p) => { p.stop(); p.host.destroy(); });
    this.players = [];
    this.host?.destroy();
    this.host = null;
    this.tickerEls = [];
    this.container.replaceChildren();
  }

  load(pl) {
    this.pl = pl;
    const st = pl?.settings || {};
    const portrait = st.orientation === 'portrait';
    const { layout, ticker: tickerOn } = normLayout(st);
    const ticker = tickerOn && st.ticker?.text ? st.ticker : null;
    const extras = zonePlaylistIds(st).map((id) => (id ? this.opts.lookup?.(id) || null : null));
    const key = `${portrait}|${layout}|${ticker ? `${ticker.position || 'bottom'}|${ticker.size || 'normal'}` : ''}` + '|' + JSON.stringify(st.layout_split || {});
    if (key !== this.key) {
      this._reset();
      this.key = key;
      if (layout === 'full' && !ticker) {
        this.players = [new SlidePlayer(this.container, this.opts)];
      } else {
        this.host = createStage(this.container, portrait ? 'portrait' : 'landscape');
        const SW = portrait ? 1080 : 1920, SH = portrait ? 1920 : 1080;
        const plan = layoutWithTicker(layout, SW, SH, ticker, st.layout_split);
        const zone = (x, y, w, h) => { const z = document.createElement('div'); Object.assign(z.style, { position: 'absolute', left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px', overflow: 'hidden', background: '#000' }); this.host.stage.appendChild(z); return z; };
        this.players = plan.zones.map(([x, y, w, h], i) =>
          // Lay each area out at "full-screen scale" (its short side = 1080) so text and pictures keep sensible proportions.
          { const k = 1080 / Math.max(1, Math.min(w, h)); return new SlidePlayer(zone(x, y, w, h), { ...this.opts, size: { w: Math.round(w * k), h: Math.round(h * k) }, onChange: i === 0 ? this.opts.onChange : null }); });
        this.tickerEls = plan.tickers.map((tk) => { const z = zone(...tk.rect); z.style.zIndex = '2'; z.dataset.edge = tk.edge; return z; });
      }
    }
    if (this.players.length > 1) {
      const own = (i) => (pl?.slides || []).filter((s) => (s.zone || 0) === i);
      this.players[0].load({ ...pl, slides: own(0) });
      this.players.slice(1).forEach((p, i) => {
        const mine = own(i + 1);
        p.load(mine.length ? { name: pl?.name, settings: pl?.settings || {}, slides: mine } : (extras[i] || { slides: [], settings: {} }));
      });
    } else this.players[0].load(pl);
    if (ticker) this.tickerEls.forEach((el) => paintTicker(el, el.dataset.edge === 'bottom' && this.tickerEls.length > 1 && ticker.text2?.trim() ? { ...ticker, text: ticker.text2 } : ticker));
    if (this.running) this.players.forEach((p) => p.start());
  }

  start() { this.running = true; this.players.forEach((p) => p.start()); }
  stop() { this.running = false; this.players.forEach((p) => p.stop()); }
  clear() { this.stop(); this._reset(); this.key = null; }
  next() { this.players[0]?.next(); }
}

// ---------------------------------------------------------------------
//  Video wall: several TVs show one picture together, each its own tile.
//  screen.wall = { id, name, cols, rows, x, y, bezel }   (x/y = this TV's column/row, 0-based)
//  Every TV in the wall works out what should be on screen from a shared clock (opts.now = server
//  time), so slides change at the same moment and videos are kept in step while they play.
// ---------------------------------------------------------------------
export const WALL_BEZEL = { none: 0, thin: 14, normal: 34 };
export function validWall(w) {
  return !!(w && w.id && w.cols >= 1 && w.rows >= 1 && w.cols * w.rows >= 2 && w.x >= 0 && w.y >= 0 && w.x < w.cols && w.y < w.rows);
}

const PREP_MS = 3500;          // get the next slide ready this long before it starts

export class WallPlayer {
  /** opts: { resolveUrl, onChange, now:()=>ms (server time), wall } */
  constructor(container, opts) {
    this.container = container;
    this.opts = opts;
    this.now = opts.now || (() => Date.now());
    this.wall = opts.wall;
    this.slides = [];
    this.current = null;
    this.token = 0;
    this.running = false;
    this.vdur = {};            // video length (ms) by slide id
    this.outer = this.host = null;
    this.key = null;
  }

  _build(portrait) {
    const w = this.wall;
    const key = `${portrait}|${w.cols}x${w.rows}@${w.x},${w.y}|${w.bezel || 0}`;
    if (key === this.key) return;
    this._teardown();
    this.key = key;
    const TW = portrait ? 1080 : 1920, TH = portrait ? 1920 : 1080;
    const gap = WALL_BEZEL[w.bezel] ?? 0;                 // hidden strip behind each bezel (tile pixels)
    this.outer = createStage(this.container, portrait ? 'portrait' : 'landscape', { w: TW, h: TH });
    const inner = document.createElement('div');
    const IW = w.cols * TW + (w.cols - 1) * gap, IH = w.rows * TH + (w.rows - 1) * gap;
    Object.assign(inner.style, { position: 'absolute', left: -w.x * (TW + gap) + 'px', top: -w.y * (TH + gap) + 'px', width: IW + 'px', height: IH + 'px', overflow: 'hidden' });
    this.outer.stage.appendChild(inner);
    // Lay the whole wall out with its short side = 1080, like a single screen.
    const f = 1080 / Math.min(IW, IH);
    this.host = createStage(inner, 'landscape', { w: Math.round(IW * f), h: Math.round(IH * f) });
  }

  _teardown() {
    this.host?.destroy(); this.outer?.destroy();
    this.host = this.outer = null; this.current = null; this.key = null;
    this.container.replaceChildren();
  }

  load(pl) {
    this.pl = pl;
    this.slides = (pl?.slides || []).filter(Boolean);
    this._build((pl?.settings || {}).orientation === 'portrait');
    this.ready = this._probe();
    if (this.running) this.start();
  }

  // Every TV must agree on each slide's length, so look up video lengths before starting.
  async _probe() {
    await Promise.all(this.slides.filter((s) => s.type === 'video' && !(Number(s.duration) > 0) && !this.vdur[s.id]).map(async (s) => {
      try {
        const url = await Promise.race([this.opts.resolveUrl(s), new Promise((r) => setTimeout(() => r(null), 30000))]);
        if (!url) return;
        const v = document.createElement('video');
        v.preload = 'metadata'; v.muted = true; v.src = url;
        const d = await new Promise((r) => { v.onloadedmetadata = () => r(v.duration); v.onerror = () => r(0); setTimeout(() => r(0), 15000); });
        v.removeAttribute('src'); v.load();
        if (isFinite(d) && d > 0) this.vdur[s.id] = Math.round(d * 1000);
      } catch {}
    }));
  }

  _len(s) {
    const d = Number(s.duration) || 0;
    if (d > 0) return d * 1000;
    if (s.type === 'video') return this.vdur[s.id] || 30000;
    return 8000;
  }

  /** The slide on air at time t: { slide, idx, start, end, single } (times in ms, server clock). */
  segAt(t) {
    const date = new Date(t);
    const active = this.slides.map((s, i) => [s, i]).filter(([s]) => isSlideActive(s, date));
    if (!active.length) return null;
    const lens = active.map(([s]) => this._len(s));
    const cycle = lens.reduce((a, b) => a + b, 0);
    const off = ((t % cycle) + cycle) % cycle;
    let acc = 0;
    for (let k = 0; k < active.length; k++) {
      if (off < acc + lens[k]) return { slide: active[k][0], idx: active[k][1], start: t - off + acc, end: t - off + acc + lens[k], single: active.length === 1 };
      acc += lens[k];
    }
    return null;
  }

  start() {
    this.stop();
    this.running = true;
    const my = this.token;
    Promise.all([this.ready, this.opts.clockReady]).then(() => my === this.token && this.running && this._run(my));
  }

  stop() {
    this.running = false;
    this.token++;
    clearInterval(this.drift);
    clearTimeout(this.sleepT);
  }

  clear() { this.stop(); this._teardown(); }
  next() {}                                        // the wall follows the clock; no skipping

  _sleepUntil(ts, my) {
    return new Promise((r) => {
      const tick = () => {
        if (my !== this.token) return r();
        const left = ts - this.now();
        if (left <= 0) return r();
        this.sleepT = setTimeout(tick, Math.min(left, 30000));
      };
      tick();
    });
  }

  async _prepare(slide) {
    let url = null;
    const isMedia = slide.type === 'image' || slide.type === 'video';
    if (isMedia) {
      try { url = await Promise.race([this.opts.resolveUrl(slide), new Promise((r) => setTimeout(() => r(null), 20000))]); } catch {}
      if (!url) return null;
    }
    const el = buildSlide(slide, url, { mutedOverride: this.opts.mutedOverride });
    el.style.opacity = '0';
    const v = el.querySelector('video');
    if (v) { v.autoplay = false; v.loop = true; v.pause?.(); }
    this.host.stage.appendChild(el);
    const ok = await waitReady(el, 15000);
    if (!ok) { el.remove(); return null; }
    return el;
  }

  async _run(my) {
    let seg = null;
    while (this.running && my === this.token) {
      const t = this.now();
      const next = seg && t < seg.end ? this.segAt(seg.end + 1) : this.segAt(t);
      if (!next) {
        this._swap(null, null);
        this.opts.onChange?.({ index: -1, total: this.slides.length, idle: true });
        seg = null;
        await this._sleepUntil(this.now() + 30000, my);
        continue;
      }
      const reuse = !!(seg && this.current && next.single && next.slide.id === seg.slide.id);
      const el = reuse ? this.current : await this._prepare(next.slide);
      if (my !== this.token) { if (!reuse) el?.remove(); return; }
      await this._sleepUntil(next.start, my);
      if (my !== this.token) { if (!reuse) el?.remove(); return; }
      if (!reuse) { if (el) el.style.opacity = ''; this._swap(el, next.slide); }
      this._play(next, reuse);
      this.opts.onChange?.({ index: next.idx, total: this.slides.length, slide: next.slide });
      seg = next;
      await this._sleepUntil(seg.end - PREP_MS, my);
    }
  }

  // Start the slide and keep its video in step with the shared clock.
  _play(seg, reuse) {
    clearInterval(this.drift);
    const el = this.current;
    if (!el) return;
    if (!reuse) { startEffect(el, seg.slide, (seg.end - seg.start) / 1000); animateText(el, seg.slide.text?.anim); }
    const v = el.querySelector('video');
    if (!v) return;
    const want = () => { const p = (this.now() - seg.start) / 1000; const d = v.duration; return isFinite(d) && d > 0 ? p % d : p; };
    // Seeking takes a moment; measure it and jump once more, a little ahead, to land on time.
    const t0 = performance.now();
    try { v.currentTime = want(); } catch {}
    v.addEventListener('seeked', () => {
      const lag = (performance.now() - t0) / 1000;
      if (Math.abs(v.currentTime - want()) > 0.06) { try { v.currentTime = want() + Math.min(lag, 1); } catch {} }
    }, { once: true });
    v.playbackRate = 1;
    v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });
    this.drift = setInterval(() => {
      if (v.paused || v.seeking || !v.isConnected) return;
      const target = want();
      let d = v.currentTime - target;                       // + = ahead of the wall clock
      const dur = v.duration;
      if (isFinite(dur) && dur > 0) { if (d > dur / 2) d -= dur; if (d < -dur / 2) d += dur; }
      if (Math.abs(d) > 0.8) { try { v.currentTime = target + 0.12; } catch {} v.playbackRate = 1; }
      else if (Math.abs(d) > 0.025) v.playbackRate = Math.min(1.08, Math.max(0.92, 1 - d * 0.6));
      else v.playbackRate = 1;
    }, 500);
  }

  _swap(el, slide) {
    const prev = this.current;
    this.current = el;
    const kind = slide?.transition || 'fade';
    const anim = T[kind];
    const ms = slide?.transition_ms ?? 900;
    if (el) el.style.zIndex = 2;
    if (prev) { prev.style.zIndex = 1; prev.querySelectorAll('video').forEach((v) => { try { v.pause(); } catch {} }); }
    const cleanup = () => {
      if (prev && prev !== this.current) { prev.querySelectorAll('video').forEach((v) => { v.removeAttribute('src'); v.load(); }); prev.remove(); }
    };
    if (!anim || ms <= 0 || !prev || !el) return cleanup();
    const opt = { duration: ms, easing: 'cubic-bezier(.65,0,.35,1)', fill: 'both' };
    const a = el.animate(anim.in, opt);
    prev.animate(anim.out, opt);
    a.finished.then(() => { a.cancel(); cleanup(); }).catch(cleanup);
  }
}

export function paintTicker(el, t) {
  el.replaceChildren();
  Object.assign(el.style, { background: t.bg || '#3f6fd0', color: t.color || '#ffffff', display: 'flex', alignItems: 'center',
    fontFamily: '"Inter","Segoe UI",system-ui,Roboto,Arial,sans-serif', fontSize: Math.round((TICKER_SIZES[t.size] || TICKER_H) * 0.52) + 'px', fontWeight: '700', whiteSpace: 'nowrap' });
  const track = document.createElement('div');
  Object.assign(track.style, { display: 'inline-flex', willChange: 'transform' });
  const text = String(t.text).split('\n').map((x) => x.trim()).filter(Boolean).join('     •     ');
  for (let i = 0; i < 2; i++) { const s = document.createElement('span'); s.textContent = text + '     •     '; s.style.paddingRight = '0'; s.style.whiteSpace = 'pre'; track.appendChild(s); }
  el.appendChild(track);
  // A plain CSS animation that moves the track by half its own width (it holds the text twice), so it
  // scrolls even if the width can't be measured yet (screen still loading, app starting, TV rotated).
  if (!document.getElementById('sg-tick-css')) {
    const css = document.createElement('style'); css.id = 'sg-tick-css';
    css.textContent = '@keyframes sg-tick{from{transform:translate3d(0,0,0)}to{transform:translate3d(-50%,0,0)}}';
    document.head.appendChild(css);
  }
  const pxPerSec = { slow: 90, normal: 150, fast: 240 }[t.speed] || 150;
  const fs = parseFloat(el.style.fontSize) || 30;
  const time = () => {
    const w = track.firstChild?.offsetWidth || (text.length + 11) * fs * 0.55;   // estimate if not laid out yet
    return Math.max(4, w / pxPerSec);
  };
  track.style.animation = `sg-tick ${time()}s linear infinite${t.dir === 'ltr' ? ' reverse' : ''}`;
  // Fix the speed once the text is really laid out (fonts loaded); a change of duration keeps it running.
  const settle = (n) => setTimeout(() => {
    if (!track.isConnected) return;
    if (track.firstChild.offsetWidth) track.style.animationDuration = time() + 's';
    else if (n < 20) settle(n + 1);
  }, n ? 500 : 50);
  settle(0);
  document.fonts?.ready?.then(() => track.isConnected && track.firstChild.offsetWidth && (track.style.animationDuration = time() + 's'));
}
