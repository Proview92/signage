// Shared dashboard helpers: Supabase client, state, DOM, UI primitives.
import { makeClient, BUCKET } from './sb.js';

export const sb = makeClient('signage-admin');
export { BUCKET };

export const state = {
  session: null,
  me: null,            // { user_id, email, is_admin, clients:[{id,name,role}] }
  clientId: null,
};

// ---------------------------------------------------------------- DOM
export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'value') el.value = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const P = {
  screens: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  playlists: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  media: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
  team: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  clients: '<path d="M3 21h18M5 21V7l7-4 7 4v14M9 9h1M9 13h1M9 17h1M14 9h1M14 13h1M14 17h1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  play: '<path d="m6 4 14 8-14 8z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  send: '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  up: '<path d="m18 15-6-6-6 6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  'eye-off': '<path d="M10.6 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17.6 17.6 0 0 1-3.2 4.2M6.6 6.6A17.4 17.4 0 0 0 2 12s3.6 7 10 7a9.7 9.7 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2M2 2l20 20"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  left: '<path d="M15 18l-6-6 6-6"/>',
  right: '<path d="M9 18l6-6-6-6"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  text: '<path d="M4 7V4h16v3M9 20h6M12 4v16"/>',
  dup: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M4 16V5a1 1 0 0 1 1-1h11"/>',
  tv: '<path d="m17 2-5 5-5-5"/><rect x="2" y="7" width="20" height="15" rx="2"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
};
export function icon(name) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.8');   // same line weight as Proview Bookings and Employee
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  s.innerHTML = P[name] || '';
  return s;
}
export const brandMark = () => h('div', { class: 'brand-mark', role: 'img', 'aria-label': 'PROVIEW' });
// "PROVIEW SIGNAGE" → bold first word + accent second word
export function wordmark(name) {
  const [first, ...rest] = String(name).split(' ');
  return h('span', { class: 'wordmark' }, h('b', {}, first), rest.length ? h('span', {}, rest.join(' ')) : null);
}

// ---------------------------------------------------------------- UI
export function toast(msg, bad = false) {
  let box = document.querySelector('.toasts');
  if (!box) { box = h('div', { class: 'toasts' }); document.body.append(box); }
  const t = h('div', { class: 'toast' + (bad ? ' bad' : '') }, msg);
  box.append(t);
  setTimeout(() => t.remove(), bad ? 6000 : 3200);
}

export function errMsg(e) {
  const m = e?.message || String(e);
  if (/exceeded the maximum allowed size|Payload too large|413/i.test(m)) return 'File is too large for your Supabase storage limit (raise it under Storage → Settings).';
  return m.replace(/^.*?ERROR:\s*/, '');
}

export function modal({ title, body, actions = [], wide = false, compact = false, onClose }) {
  const back = h('div', { class: 'modal-back' });
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
  const foot = h('div', { class: 'modal-foot' });
  for (const a of actions) {
    foot.append(h('button', {
      class: 'btn ' + (a.class || ''), type: 'button',
      onclick: async (ev) => {
        const btn = ev.currentTarget;
        btn.disabled = true;
        try { if ((await a.onClick?.(close)) !== false && a.close !== false) close(); }
        catch (e) { toast(errMsg(e), true); }
        finally { btn.disabled = false; }
      },
    }, a.label));
  }
  back.append(h('div', { class: 'modal' + (wide ? ' wide' : '') + (compact ? ' compact' : ''), role: 'dialog' },
    h('div', { class: 'modal-head' }, h('h2', {}, title),
      h('button', { class: 'btn ghost icon', onclick: close, 'aria-label': 'Close' }, icon('x'))),
    h('div', { class: 'modal-body' }, body),
    actions.length ? foot : null));
  back._close = close;
  document.body.append(back);
  setTimeout(() => back.querySelector('input,select,textarea')?.focus(), 30);
  return { close, el: back };
}

/** Ask for a line of text in the site's own dialog. Resolves to the text, or null if cancelled. */
export function promptBox(title, label, { type = 'text', placeholder = '', okLabel = 'OK', minLength = 1 } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const input = h('input', { type, placeholder, autocomplete: type === 'password' ? 'new-password' : 'off' });
    const ok = () => { const v = input.value.trim(); if (v.length < minLength) throw new Error(minLength > 1 ? `Use at least ${minLength} characters` : 'Please fill this in'); done = true; resolve(v); };
    const m = modal({ title, body: field(label, type === 'password' ? passwordToggle(input) : input), onClose: () => { if (!done) resolve(null); },
      actions: [{ label: 'Cancel' }, { label: okLabel, class: 'primary', onClick: ok }] });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { try { ok(); m.close(); } catch (err) { toast(errMsg(err), true); } } });
  });
}

/** Wrap a password input with a show/hide (eye) button. Returns the wrapper. */
export function passwordToggle(input) {
  const btn = h('button', { class: 'pw-eye', type: 'button', tabIndex: -1, 'aria-label': 'Show password', title: 'Show password' }, icon('eye'));
  btn.onclick = () => {
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    btn.replaceChildren(icon(show ? 'eye-off' : 'eye'));
    btn.title = btn.ariaLabel = show ? 'Hide password' : 'Show password';
    btn.setAttribute('aria-label', btn.title);
    input.focus();
  };
  return h('div', { class: 'pw-wrap' }, input, btn);
}

export function confirmBox(title, text, okLabel = 'Delete', danger = true) {
  return new Promise((resolve) => {
    let done = false;
    modal({
      title, body: h('p', { class: 'muted', style: { margin: 0 } }, text),
      onClose: () => { if (!done) resolve(false); },
      actions: [
        { label: 'Cancel', onClick: () => { done = true; resolve(false); } },
        { label: okLabel, class: danger ? 'danger' : 'primary', onClick: () => { done = true; resolve(true); } },
      ],
    });
  });
}

export function field(label, input, hint) {
  return h('label', { class: 'field' }, label, input, hint ? h('span', { class: 'tiny' }, hint) : null);
}

export function select(options, value, onchange) {
  const s = h('select', { onchange: (e) => onchange?.(e.target.value) });
  for (const [v, l] of Array.isArray(options) ? options : Object.entries(options)) {
    s.append(h('option', { value: v, selected: String(v) === String(value) }, l));
  }
  return s;
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied'); }
  catch { prompt('Copy this:', text); }
}

// ---------------------------------------------------------------- formatting
export function timeAgo(ts) {
  if (!ts) return 'never';
  const s = Math.round((Date.now() - new Date(ts)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
export const isOnline = (scr) => scr.last_seen && Date.now() - new Date(scr.last_seen) < 3 * 60 * 1000;
export function fmtBytes(n) {
  if (!n) return '';
  const u = ['B', 'KB', 'MB', 'GB']; let i = 0;
  while (n >= 1024 && i < 3) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 && i ? 1 : 0)} ${u[i]}`;
}
export function fmtDuration(sec) {
  sec = Math.round(sec);
  const m = Math.floor(sec / 60), s = sec % 60;
  return m ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
}
export const PALETTE = ['#4a8fe0', '#3157ff', '#12a150', '#a23cf0', '#e0a100', '#0aa5b8', '#e3326b', '#5a6270'];
export function colorFor(id, ids) { const i = Math.max(0, ids.indexOf(id)); return PALETTE[i % PALETTE.length]; }

// ---------------------------------------------------------------- client & site labels
export const clientTitle = (c) => (c ? c.name || '' : '');
export const clientLabel = clientTitle;
export const sortClients = (cs) => [...cs].sort((a, b) => clientTitle(a).localeCompare(clientTitle(b)));
export const sortSites = (ss) => [...ss].sort((a, b) => a.name.localeCompare(b.name));

// ---------------------------------------------------------------- roles
export function currentClient() { return state.me?.clients.find((c) => c.id === state.clientId) || null; }
export function role() { return state.me?.is_admin ? 'admin' : currentClient()?.role || null; }
export const canManage = () => ['admin', 'manager'].includes(role());

// Proview access model. Stored roles: 'manager' = Owner / Admin (whole business), 'site_manager' = Manager,
// 'editor' = Staff. Managers and Staff have site_ids (null = all sites) and features ({key:false} = off).
// Keep FEATURES in step with supabase/migrations/030_access_model.sql (the database enforces them).
export const FEATURES = [
  ['screens', 'TV settings (name, site, sleep, reload, video wall)'],
  ['schedule', 'Schedules (what plays on each TV, publish a TV)'],
  ['playlists', 'Playlists & templates'],
  ['media', 'Media library (upload, edit, delete)'],
  ['emergency', 'Emergency messages'],
  ['reports', 'Reports'],
  ['activity', 'Activity log'],
  ['billing', 'Licence payments (buy / renew online)'],
];
const FEATURE_OFF_BY_DEFAULT = ['billing'];
export const ROLE_LABEL = { admin: 'Proview admin', manager: 'Owner / Admin', site_manager: 'Manager', editor: 'Staff' };
export const roleLabel = (r) => ROLE_LABEL[r] || r || '';
export const featureDefault = (f) => !FEATURE_OFF_BY_DEFAULT.includes(f);
/** Owners, admins and the Proview master have every feature; Managers/Staff follow their switches. */
export function hasFeature(f) {
  if (canManage()) return true;
  const c = currentClient();
  if (!c) return false;
  const v = (c.features || {})[f];
  return typeof v === 'boolean' ? v : featureDefault(f);
}
/** Site ids this person is limited to, or null for every site. */
export const mySiteIds = () => (canManage() ? null : currentClient()?.site_ids ?? null);
/**
 * Playlists and media carry site_ids (null = shared with every site). People limited to some sites can
 * change an item only if every site it covers is one of theirs (shared items are read-only to them).
 * Mirrors can_edit_sites in supabase/migrations/031_content_sites.sql (the database enforces it).
 */
export function canEditContent(item) {
  const mine = mySiteIds();
  if (!mine) return true;
  const s = item?.site_ids;
  return Array.isArray(s) && s.length > 0 && s.every((x) => mine.includes(x));
}
const PAGE_FEATURE = { playlists: 'playlists', media: 'media', reports: 'reports', activity: 'activity' };
export function canView(section) {
  if (section === 'team') return canManage();
  if (section === 'screens') return true;           // TVs are listed for everyone (their own sites only)
  const f = PAGE_FEATURE[section];
  return !f || hasFeature(f);
}

// ---------------------------------------------------------------- media URLs
const urlCache = new Map();
export async function mediaUrl(path) {
  if (!path) return null;
  const c = urlCache.get(path);
  if (c && c.exp > Date.now()) return c.url;
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error) throw error;
  urlCache.set(path, { url: data.signedUrl, exp: Date.now() + 50 * 60 * 1000 });
  return data.signedUrl;
}
export async function mediaUrls(paths) {
  const need = [...new Set(paths.filter((p) => p && !(urlCache.get(p)?.exp > Date.now())))];
  for (let i = 0; i < need.length; i += 100) {
    const { data } = await sb.storage.from(BUCKET).createSignedUrls(need.slice(i, i + 100), 3600);
    for (const d of data || []) if (d.signedUrl) urlCache.set(d.path, { url: d.signedUrl, exp: Date.now() + 50 * 60 * 1000 });
  }
  return Object.fromEntries(paths.map((p) => [p, urlCache.get(p)?.url || null]));
}

// ---------------------------------------------------------------- data
export async function q(promise) {
  const { data, error } = await promise;
  if (error) throw error;
  return data;
}
export const rpc = (fn, args) => q(sb.rpc(fn, args));
/** Fetch every row (Supabase returns at most 1000 per request). build() must return a fresh query. */
export async function fetchAll(build, max = 50000) {
  const out = [];
  for (let i = 0; i < max; i += 1000) {
    const rows = await q(build().range(i, i + 999));
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

/**
 * Publish a screen or playlist. If the client requires approval and the user
 * is an editor, a request is sent to the managers instead.
 * Returns { published: n } or { pending: true }.
 */
export async function publishOrRequest(kind, id, name) {
  try {
    const n = await rpc(kind === 'screen' ? 'publish_screen' : 'publish_playlist', kind === 'screen' ? { p_screen: id } : { p_playlist: id });
    return { published: kind === 'screen' ? 1 : n };
  } catch (e) {
    if (!/APPROVAL_REQUIRED/.test(e.message || '')) throw e;
    const { data: existing } = await sb.from('approval_requests').select('id').eq('target_id', id).eq('status', 'pending').limit(1);
    if (!existing?.length) await q(sb.from('approval_requests').insert({ client_id: state.clientId, kind, target_id: id, target_name: name }));
    return { pending: true };
  }
}

export async function refreshMe() {
  const me = await rpc('whoami');
  // No signed-in user (the session ended in the background): don't carry on with an empty account.
  if (!me?.user_id) { await sb.auth.signOut().catch(() => {}); throw new Error('Your sign-in has ended. Please sign in again.'); }
  state.me = me;
  const ids = state.me.clients.map((c) => c.id);
  const saved = localStorage.getItem('signage.client');
  state.clientId = ids.includes(state.clientId) ? state.clientId : (ids.includes(saved) ? saved : ids[0] || null);
  return state.me;
}
export function setClient(id) {
  if (!id) return;   // never switch to "no business": every page needs one
  state.clientId = id;
  localStorage.setItem('signage.client', id);
}

// Build a screen's content locally from the DRAFT (default + rules + playlists)
export function draftContent(screen, rules, playlistsById) {
  const ids = new Set([screen.default_playlist_id, ...rules.filter((r) => r.enabled).map((r) => r.playlist_id)].filter(Boolean));
  const playlists = {};
  for (const id of ids) if (playlistsById[id]) playlists[id] = playlistsById[id];
  return {
    default: screen.default_playlist_id,
    schedule: rules.filter((r) => r.enabled).map((r) => ({ ...r, start_time: r.start_time?.slice(0, 5) || null, end_time: r.end_time?.slice(0, 5) || null })),
    playlists,
  };
}

export function needsPublish(screen, rules, playlistsById) {
  const pub = screen.published_at ? new Date(screen.published_at) : null;
  const hasDraft = screen.default_playlist_id || rules.some((r) => r.enabled);
  if (!pub) return !!hasDraft;
  if (screen.schedule_updated_at && new Date(screen.schedule_updated_at) > pub) return true;
  const ids = [screen.default_playlist_id, ...(screen.also_playlist_ids || []), ...rules.map((r) => r.playlist_id)].filter(Boolean);
  const side = ids.flatMap((id) => [playlistsById[id]?.settings?.side_playlist_id, ...(playlistsById[id]?.settings?.zones || [])]).filter(Boolean);
  return [...ids, ...side].some((id) => playlistsById[id] && new Date(playlistsById[id].updated_at) > pub);
}

/** Small "Rename" pop-up: calls save(newName) when the user presses Save or Enter. */
export function renameDialog(title, current, save) {
  const input = h('input', { type: 'text', value: current || '', maxlength: 80 });
  let saveBtn = null;
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); (saveBtn ||= [...document.querySelectorAll('.modal-back button.primary')].pop())?.click(); } });
  modal({ title, body: [field('Name', input)], actions: [
    { label: 'Cancel' },
    { label: 'Save', class: 'primary', onClick: async () => {
      const v = input.value.trim();
      if (!v) { toast('Please enter a name', true); return false; }
      if (v !== current) await save(v);
    } }] });
  setTimeout(() => { input.focus(); input.select(); }, 30);
}
