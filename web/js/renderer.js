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
  circle:        'Circle reveal',
};

export const EFFECTS = {
  none:        'None',
  kenburns:    'Ken Burns',
  'zoom-slow': 'Slow zoom in',
  'zoom-out':  'Slow zoom out',
  'pan-left':  'Pan left',
  'pan-right': 'Pan right',
  pulse:       'Gentle pulse',
};

export const TEXT_ANIMS = {
  none:      'None',
  'fade-up': 'Fade up',
  'slide-in':'Slide in',
  pop:       'Pop',
  typewriter:'Typewriter',
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

export function newSlide(partial = {}) {
  return {
    id: (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)),
    type: 'text',            // image | video | text
    media_id: null,
    path: null,
    duration: 8,             // seconds; for video 0 = play to the end
    transition: 'fade',
    transition_ms: 900,
    effect: 'none',
    fit: 'cover',            // cover | contain
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
  if (Array.isArray(s.days) && s.days.length && !s.days.includes(now.getDay())) return false;
  const mins = now.getHours() * 60 + now.getMinutes();
  const toMin = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
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
    const k = Math.min(w / sw, h / sh);
    stage.style.transform = `translate(${(w - sw * k) / 2}px, ${(h - sh * k) / 2}px) scale(${k})`;
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
    media.src = url;
    media.playsInline = true;
    media.setAttribute('playsinline', '');
    media.preload = 'auto';
    media.muted = mutedOverride ?? (slide.muted !== false);
    if (slide.duration > 0) media.loop = true;
  }
  if (media) {
    media.className = 'sg-media';
    media.style.objectFit = slide.fit === 'contain' ? 'contain' : 'cover';
    const wrap = document.createElement('div');
    wrap.className = 'sg-media-wrap';
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
};

const E = {
  kenburns:    [{ transform: 'scale(1) translate(0,0)' }, { transform: 'scale(1.18) translate(-3%,-2%)' }],
  'zoom-slow': [{ transform: 'scale(1)' }, { transform: 'scale(1.15)' }],
  'zoom-out':  [{ transform: 'scale(1.15)' }, { transform: 'scale(1)' }],
  'pan-left':  [{ transform: 'scale(1.12) translateX(4%)' }, { transform: 'scale(1.12) translateX(-4%)' }],
  'pan-right': [{ transform: 'scale(1.12) translateX(-4%)' }, { transform: 'scale(1.12) translateX(4%)' }],
  pulse:       [{ transform: 'scale(1)' }, { transform: 'scale(1.04)' }, { transform: 'scale(1)' }],
};

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
  }[anim];
  if (!frames) return;
  kids.forEach((k, i) => k.animate(frames, { duration: 800, delay: 350 + i * 220, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' }));
}

function startEffect(el, slide, seconds) {
  const frames = E[slide.effect];
  const wrap = el.querySelector('.sg-media-wrap');
  if (!frames || !wrap) return;
  wrap.style.willChange = 'transform';
  wrap.animate(frames, {
    duration: Math.max(2, seconds) * 1000 + (slide.transition_ms || 0),
    easing: slide.effect === 'pulse' ? 'ease-in-out' : 'linear',
    fill: 'forwards',
    iterations: slide.effect === 'pulse' ? Infinity : 1,
  });
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
export function renderStill(container, slide, url, orientation = 'landscape') {
  container.__sgStill?.destroy();          // stop the previous stage's resize watcher
  container.replaceChildren();
  const st = createStage(container, orientation);
  const el = buildSlide(slide, url, { forPreview: true, mutedOverride: true });
  st.stage.appendChild(el);
  container.__sgStill = st;
  return st;
}

// ---------------------------------------------------------------------
//  Layouts: full screen, or zones (main + side panel and/or ticker).
//  settings.layout: 'full' | 'side' | 'ticker' | 'side-ticker'
//  settings.side_playlist_id: playlist shown in the side panel (portrait)
//  settings.ticker: { text, speed: 'slow'|'normal'|'fast', bg, color }
// ---------------------------------------------------------------------
export const LAYOUTS = {
  full: 'Full screen',
  side: 'Main + side panel',
  ticker: 'Main + ticker',
  'side-ticker': 'Main + side panel + ticker',
};
const TICKER_H = 96, SIDE_W = 480;

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
    this.container.replaceChildren();
  }

  load(pl) {
    this.pl = pl;
    const st = pl?.settings || {};
    const layout = st.orientation === 'portrait' ? 'full' : (st.layout || 'full');
    const side = layout.includes('side') && st.side_playlist_id ? this.opts.lookup?.(st.side_playlist_id) : null;
    const ticker = layout.includes('ticker') && st.ticker?.text ? st.ticker : null;
    const key = `${layout}|${!!side}|${!!ticker}`;
    if (key !== this.key) {
      this._reset();
      this.key = key;
      if (!side && !ticker) {
        this.players = [new SlidePlayer(this.container, this.opts)];
      } else {
        this.host = createStage(this.container, 'landscape');
        const H = 1080 - (ticker ? TICKER_H : 0), W = 1920 - (side ? SIDE_W : 0);
        const zone = (x, y, w, h) => { const z = document.createElement('div'); Object.assign(z.style, { position: 'absolute', left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px', overflow: 'hidden', background: '#000' }); this.host.stage.appendChild(z); return z; };
        this.players = [new SlidePlayer(zone(0, 0, W, H), { ...this.opts, size: { w: W, h: H } })];
        if (side) this.players.push(new SlidePlayer(zone(W, 0, SIDE_W, H), { ...this.opts, onChange: null }));
        if (ticker) this.tickerEl = zone(0, H, 1920, TICKER_H);
      }
    }
    this.players[0].load(pl);
    if (this.players[1]) this.players[1].load(side);
    if (this.tickerEl && ticker) paintTicker(this.tickerEl, ticker);
    if (this.running) this.players.forEach((p) => p.start());
  }

  start() { this.running = true; this.players.forEach((p) => p.start()); }
  stop() { this.running = false; this.players.forEach((p) => p.stop()); }
  clear() { this.stop(); this._reset(); this.key = null; this.tickerEl = null; }
  next() { this.players[0]?.next(); }
}

function paintTicker(el, t) {
  el.replaceChildren();
  Object.assign(el.style, { background: t.bg || '#3f6fd0', color: t.color || '#ffffff', display: 'flex', alignItems: 'center',
    fontFamily: '"Inter","Segoe UI",system-ui,Roboto,Arial,sans-serif', fontSize: '50px', fontWeight: '700', whiteSpace: 'nowrap' });
  const track = document.createElement('div');
  Object.assign(track.style, { display: 'inline-flex', willChange: 'transform' });
  const text = String(t.text).split('\n').map((x) => x.trim()).filter(Boolean).join('     •     ');
  for (let i = 0; i < 2; i++) { const s = document.createElement('span'); s.textContent = text + '     •     '; s.style.paddingRight = '0'; s.style.whiteSpace = 'pre'; track.appendChild(s); }
  el.appendChild(track);
  requestAnimationFrame(() => {
    const w = track.firstChild.getBoundingClientRect().width / (el.getBoundingClientRect().width / 1920 || 1);
    const pxPerSec = { slow: 90, normal: 150, fast: 240 }[t.speed] || 150;
    track.animate([{ transform: 'translateX(0)' }, { transform: `translateX(-${w}px)` }], { duration: Math.max(4000, (w / pxPerSec) * 1000), iterations: Infinity });
  });
}
