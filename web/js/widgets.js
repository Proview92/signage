// =====================================================================
//  Widget slides: clock, weather, QR code, menu board, web page, YouTube.
//  Each builder appends its content to the slide element (1920×1080 or
//  1080×1920 stage) and cleans up its own timers when removed.
// =====================================================================

export const WIDGET_TYPES = {
  clock: 'Clock & date',
  weather: 'Weather',
  qr: 'QR code',
  menu: 'Menu / price list',
  web: 'Web page',
  youtube: 'YouTube video',
};
export const isWidget = (t) => t in WIDGET_TYPES;

export function widgetDefaults(type) {
  switch (type) {
    case 'clock': return { widget: { h24: true, seconds: false, date: true, tz: '' }, bg: 'linear-gradient(135deg,#111827,#374151)' };
    case 'weather': return { widget: { place: 'London', lat: 51.5072, lon: -0.1276, days: 4, unit: 'c' }, bg: 'linear-gradient(135deg,#0d9488,#2563eb)', duration: 12 };
    case 'qr': return { widget: { url: 'https://example.com', caption: 'Scan me' }, bg: '#ffffff', text: { title: 'Follow us', subtitle: 'Scan for offers', position: 'left', color: '#111111', size: 'l', box: false, anim: 'fade-up' } };
    case 'menu': return { widget: { title: 'Menu', columns: 2, items: [
      { name: 'Flat white', price: '£3.20', desc: '' }, { name: 'Cappuccino', price: '£3.40', desc: '' },
      { name: 'Latte', price: '£3.40', desc: '' }, { name: 'Espresso', price: '£2.40', desc: '' },
      { name: 'Croissant', price: '£2.50', desc: 'Butter, baked daily' }, { name: 'Pain au chocolat', price: '£2.80', desc: '' },
    ] }, bg: 'linear-gradient(180deg,#1c1917,#44403c)', duration: 20 };
    case 'web': return { widget: { url: 'https://example.com', zoom: 1 }, bg: '#ffffff', duration: 30 };
    case 'youtube': return { widget: { url: '', sound: false }, bg: '#000000', duration: 60 };
    default: return {};
  }
}

const css = (el, styles) => Object.assign(el.style, styles);
const div = (styles = {}, text) => { const d = document.createElement('div'); css(d, styles); if (text != null) d.textContent = text; return d; };
/** Run fn every ms until the element leaves the page. */
function every(el, ms, fn) {
  fn();
  let seen = false;
  const t = setInterval(() => { if (el.isConnected) seen = true; else if (seen) return clearInterval(t); fn(); }, ms);
  setTimeout(() => { if (!el.isConnected) clearInterval(t); }, 15000);
}

export function buildWidget(slide, el, { forPreview = false } = {}) {
  const w = slide.widget || {};
  const color = slide.text?.color || '#ffffff';
  switch (slide.type) {
    case 'clock': return clock(el, w, color);
    case 'weather': return weather(el, w, color);
    case 'qr': return qr(el, w, slide);
    case 'menu': return menu(el, w, color);
    case 'web': return web(el, w, forPreview);
    case 'youtube': return youtube(el, w, forPreview);
  }
}

// ---------------------------------------------------------------- clock
function clock(el, w, color) {
  const wrap = div({ position: 'absolute', inset: '0', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color, textAlign: 'center' });
  const time = div({ fontSize: '300px', fontWeight: '800', letterSpacing: '-0.03em', lineHeight: '1', fontVariantNumeric: 'tabular-nums' });
  const date = div({ fontSize: '72px', fontWeight: '500', opacity: '.85', marginTop: '30px' });
  wrap.append(time, w.date !== false ? date : '');
  el.appendChild(wrap);
  const opts = w.tz ? { timeZone: w.tz } : {};
  every(el, 1000, () => {
    const now = new Date();
    time.textContent = now.toLocaleTimeString(undefined, { ...opts, hour: '2-digit', minute: '2-digit', second: w.seconds ? '2-digit' : undefined, hour12: !w.h24 });
    date.textContent = now.toLocaleDateString(undefined, { ...opts, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  });
}

// ---------------------------------------------------------------- weather (Open-Meteo, no key)
const WMO = {
  0: ['Clear', '☀️'], 1: ['Mostly clear', '🌤️'], 2: ['Partly cloudy', '⛅'], 3: ['Cloudy', '☁️'], 45: ['Fog', '🌫️'], 48: ['Fog', '🌫️'],
  51: ['Drizzle', '🌦️'], 53: ['Drizzle', '🌦️'], 55: ['Drizzle', '🌦️'], 61: ['Rain', '🌧️'], 63: ['Rain', '🌧️'], 65: ['Heavy rain', '🌧️'],
  66: ['Freezing rain', '🌧️'], 67: ['Freezing rain', '🌧️'], 71: ['Snow', '🌨️'], 73: ['Snow', '🌨️'], 75: ['Heavy snow', '❄️'], 77: ['Snow', '🌨️'],
  80: ['Showers', '🌦️'], 81: ['Showers', '🌦️'], 82: ['Heavy showers', '⛈️'], 85: ['Snow showers', '🌨️'], 86: ['Snow showers', '🌨️'],
  95: ['Thunderstorm', '⛈️'], 96: ['Thunderstorm', '⛈️'], 99: ['Thunderstorm', '⛈️'],
};
export async function geocode(place) {
  const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&name=${encodeURIComponent(place)}`);
  const j = await r.json();
  const g = j.results?.[0];
  if (!g) throw new Error(`Couldn't find “${place}”`);
  return { lat: g.latitude, lon: g.longitude, place: [g.name, g.admin1 && g.admin1 !== g.name ? g.admin1 : null, g.country_code].filter(Boolean).join(', ') };
}
async function forecast(w) {
  const key = `signage.wx.${w.lat},${w.lon},${w.unit}`;
  try { const c = JSON.parse(localStorage.getItem(key) || 'null'); if (c && Date.now() - c.t < 30 * 60000) return c.d; } catch {}
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${w.lat}&longitude=${w.lon}&current=temperature_2m,weather_code,wind_speed_10m&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=7${w.unit === 'f' ? '&temperature_unit=fahrenheit' : ''}`;
  const d = await (await fetch(u)).json();
  try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), d })); } catch {}
  return d;
}
function weather(el, w, color) {
  const wrap = div({ position: 'absolute', inset: '0', display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', color, gap: '60px' });
  el.appendChild(wrap);
  const paint = async () => {
    let d;
    try { d = await forecast(w); } catch { wrap.replaceChildren(div({ fontSize: '56px', opacity: '.8' }, 'Weather unavailable')); return; }
    const u = w.unit === 'f' ? '°F' : '°C';
    const [label, icon] = WMO[d.current?.weather_code] || ['', '🌡️'];
    const top = div({ display: 'flex', alignItems: 'center', gap: '50px' });
    top.append(div({ fontSize: '220px', lineHeight: '1' }, icon),
      (() => { const b = div(); b.append(div({ fontSize: '200px', fontWeight: '800', lineHeight: '1' }, `${Math.round(d.current.temperature_2m)}${u}`), div({ fontSize: '60px', opacity: '.9' }, `${label} · ${w.place || ''}`)); return b; })());
    const days = div({ display: 'flex', gap: '28px' });
    const n = Math.min(Math.max(Number(w.days) || 4, 0), 6);
    for (let i = 1; i <= n && d.daily?.time?.[i]; i++) {
      const [, ic] = WMO[d.daily.weather_code[i]] || ['', '🌡️'];
      const c = div({ background: 'rgba(0,0,0,.22)', borderRadius: '28px', padding: '26px 34px', textAlign: 'center', minWidth: '200px' });
      c.append(div({ fontSize: '44px', fontWeight: '700' }, new Date(d.daily.time[i] + 'T12:00').toLocaleDateString(undefined, { weekday: 'short' })),
        div({ fontSize: '90px', margin: '10px 0' }, ic),
        div({ fontSize: '44px' }, `${Math.round(d.daily.temperature_2m_max[i])}° / ${Math.round(d.daily.temperature_2m_min[i])}°`));
      days.appendChild(c);
    }
    wrap.replaceChildren(top, n ? days : '');
  };
  every(el, 15 * 60000, paint);
}

// ---------------------------------------------------------------- QR code
let qrLib = null;
async function loadQr() {
  if (!qrLib) {
    const m = await import('https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/+esm');
    qrLib = m.default || m.qrcode || m;
  }
  return qrLib;
}
export async function qrSvg(text, dark = '#000', light = '#fff') {
  const qrcode = await loadQr();
  const q = qrcode(0, 'M');
  q.addData(text || ' ');
  q.make();
  const n = q.getModuleCount(), m = 2, size = n + m * 2;
  let path = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) path += `M${c + m} ${r + m}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="${light}"/><path d="${path}" fill="${dark}"/></svg>`;
}
function qr(el, w, slide) {
  const hasText = slide.text?.title || slide.text?.subtitle;
  const box = div({ position: 'absolute', top: '50%', transform: 'translateY(-50%)', right: hasText ? '160px' : '50%', marginRight: hasText ? '0' : '-330px', width: '660px', textAlign: 'center' });
  const code = div({ width: '660px', height: '660px', background: '#fff', borderRadius: '36px', padding: '30px', boxSizing: 'border-box', boxShadow: '0 20px 60px rgba(0,0,0,.18)' });
  const cap = div({ marginTop: '28px', fontSize: '46px', fontWeight: '700', color: slide.text?.color || '#111' }, w.caption || '');
  box.append(code, cap);
  el.appendChild(box);
  qrSvg(w.url).then((svg) => { code.innerHTML = svg; code.firstChild.style.width = '100%'; code.firstChild.style.height = '100%'; })
    .catch(() => { code.textContent = 'QR unavailable offline'; css(code, { display: 'grid', placeItems: 'center', fontSize: '40px', color: '#666' }); });
}

// ---------------------------------------------------------------- menu board
function menu(el, w, color) {
  const wrap = div({ position: 'absolute', inset: '70px 100px', color, display: 'flex', flexDirection: 'column' });
  if (w.title) wrap.append(div({ fontSize: '120px', fontWeight: '800', letterSpacing: '-0.02em', marginBottom: '40px' }, w.title));
  const items = (w.items || []).filter((i) => i.name || i.price);
  const cols = Math.min(Math.max(Number(w.columns) || 1, 1), 3);
  const grid = div({ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, columnGap: '90px', rowGap: items.length > 12 ? '18px' : '30px', alignContent: 'start', flex: '1' });
  const fs = items.length > 16 ? 40 : items.length > 10 ? 48 : 58;
  for (const i of items) {
    const row = div({ display: 'flex', flexDirection: 'column' });
    const line = div({ display: 'flex', alignItems: 'baseline', gap: '18px', fontSize: fs + 'px', fontWeight: '650' });
    line.append(div({}, i.name || ''), div({ flex: '1', borderBottom: `4px dotted ${color}`, opacity: '.35', transform: 'translateY(-10px)' }), div({ fontWeight: '800' }, i.price || ''));
    row.append(line);
    if (i.desc) row.append(div({ fontSize: Math.round(fs * 0.55) + 'px', opacity: '.75', marginTop: '4px' }, i.desc));
    grid.appendChild(row);
  }
  wrap.appendChild(grid);
  el.appendChild(wrap);
}

// ---------------------------------------------------------------- web page / YouTube
function frame(el, src, { interactive = false, zoom = 1 } = {}) {
  const f = document.createElement('iframe');
  f.src = src;
  f.allow = 'autoplay; encrypted-media; picture-in-picture';
  f.referrerPolicy = 'no-referrer-when-downgrade';
  f.setAttribute('allowfullscreen', '');
  css(f, { position: 'absolute', left: '0', top: '0', border: '0', width: (100 / zoom) + '%', height: (100 / zoom) + '%', transform: `scale(${zoom})`, transformOrigin: '0 0', pointerEvents: interactive ? 'auto' : 'none', background: '#fff' });
  el.appendChild(f);
}
function web(el, w, forPreview) {
  if (!/^https:\/\//i.test(w.url || '')) { el.appendChild(div({ position: 'absolute', inset: '0', display: 'grid', placeItems: 'center', fontSize: '56px', color: '#666' }, 'Enter a web address starting with https://')); return; }
  frame(el, w.url, { zoom: Number(w.zoom) || 1 });
  if (forPreview) el.appendChild(div({ position: 'absolute', left: '20px', bottom: '20px', background: 'rgba(0,0,0,.7)', color: '#fff', padding: '10px 18px', borderRadius: '10px', fontSize: '28px' }, 'Some websites refuse to be shown inside other apps. Check the preview.'));
}
export function youtubeId(url) {
  const m = String(url || '').match(/(?:youtu\.be\/|v=|\/embed\/|\/shorts\/|\/live\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : (/^[A-Za-z0-9_-]{11}$/.test(url || '') ? url : null);
}
function youtube(el, w, forPreview) {
  const id = youtubeId(w.url);
  if (!id) { el.appendChild(div({ position: 'absolute', inset: '0', display: 'grid', placeItems: 'center', fontSize: '56px', color: '#888' }, 'Paste a YouTube link')); return; }
  const mute = forPreview || !w.sound ? 1 : 0;
  frame(el, `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&mute=${mute}&controls=0&loop=1&playlist=${id}&playsinline=1&rel=0&modestbranding=1`);
}
