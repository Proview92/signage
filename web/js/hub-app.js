// Proview Signage: data for the shared header tray (../hub.js).
import { sb, state, q, rpc, canManage, canView, roleLabel, toast } from './core.js';

const H = () => window.PVHub;
const cap = (s) => String(s || '').split('@')[0].split(/[._-]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') || 'Someone';
const PAGES = [['screens', 'Screens'], ['playlists', 'Playlists'], ['media', 'Media'], ['reports', 'Reports'], ['activity', 'Activity'], ['team', 'Users'], ['help', 'Help']];

const cache = { client: null, index: { screens: [], playlists: [], media: [] }, people: [], msgs: [], reqs: [], chatOff: false, loadedAt: 0 };

async function loadIndex() {
  const c = state.clientId; if (!c) return;
  try {
    const [s, p, m] = await Promise.all([
      q(sb.from('screens').select('id,name').eq('client_id', c).order('name').limit(500)),
      q(sb.from('playlists').select('id,name').eq('client_id', c).order('name').limit(500)),
      q(sb.from('media').select('id,name').eq('client_id', c).order('created_at', { ascending: false }).limit(500)),
    ]);
    if (state.clientId === c) cache.index = { screens: s || [], playlists: p || [], media: m || [] };
  } catch {}
}
async function loadChat() {
  const c = state.clientId; if (!c) return;
  try {
    const [people, msgs] = await Promise.all([
      cache.people.length && cache.client === c ? cache.people : rpc('team_people', { p_client: c }),
      q(sb.from('team_messages').select('id,author,author_email,to_user,body,created_at').eq('client_id', c).order('created_at', { ascending: false }).limit(300)),
    ]);
    if (state.clientId !== c) return;
    cache.people = Array.isArray(people) ? people : []; cache.msgs = (Array.isArray(msgs) ? msgs : []).reverse(); cache.chatOff = false;
  } catch (e) {
    if (/team_messages|team_people|does not exist|schema cache|PGRST20|42P01|42883/i.test(((e && e.message) || '') + ' ' + ((e && e.code) || ''))) cache.chatOff = true;
  }
}
async function loadReqs() {
  const c = state.clientId; if (!c) return;
  try { cache.reqs = await q(sb.from('approval_requests').select('*').eq('client_id', c).order('requested_at', { ascending: false }).limit(100)); } catch {}
}
async function refreshAll() {
  if (!state.me || !state.clientId) return;
  if (cache.client !== state.clientId) { cache.client = state.clientId; cache.people = []; cache.msgs = []; cache.reqs = []; cache.index = { screens: [], playlists: [], media: [] }; }
  await Promise.all([loadChat(), loadReqs(), Date.now() - cache.loadedAt > 60000 ? loadIndex().then(() => { cache.loadedAt = Date.now(); }) : null]);
  H()?.chatChanged();
}

const seenKey = () => 'pvhub.' + state.me?.user_id + '.' + state.clientId + '.inboxSeen';
function inboxRaw() {
  const me = state.me?.user_id, seen = +(localStorage.getItem(seenKey()) || 0), manage = canManage();
  const out = [];
  for (const r of cache.reqs) {
    const what = `${r.kind === 'screen' ? 'TV' : 'playlist'} “${r.target_name || '—'}”`;
    const open = () => { location.hash = r.kind === 'screen' ? '#/screen/' + r.target_id : '#/playlist/' + r.target_id; };
    if (r.status === 'pending' && manage) {
      out.push({ icon: 'page', need: true, unread: true, at: r.requested_at, title: `${cap(r.requested_email)} wants to publish the ${what}`, sub: r.note || 'Waiting for a manager to approve', open,
        actions: [
          { label: 'Approve', kind: 'pri', run: async () => { const n = await rpc('decide_approval', { p_request: r.id, p_approve: true, p_note: null }); toast(`Approved: published to ${n} TV${n === 1 ? '' : 's'}`); await loadReqs(); } },
          { label: 'Reject', kind: 'bad', run: async () => { await rpc('decide_approval', { p_request: r.id, p_approve: false, p_note: null }); toast('Rejected'); await loadReqs(); } },
        ] });
    } else if (r.requested_by === me && r.status !== 'pending') {
      const at = r.decided_at || r.requested_at;
      out.push({ icon: 'check', at, unread: new Date(at).getTime() > seen, title: `Your ${what} was ${r.status}`, sub: r.decision_note ? `“${r.decision_note}”` : '', open });
    } else if (r.requested_by === me) {
      out.push({ icon: 'page', at: r.requested_at, title: `Waiting for approval: ${what}`, sub: 'A manager will approve or reject it', open });
    }
  }
  return out.sort((a, b) => ((b.need ? 1 : 0) - (a.need ? 1 : 0)) || (new Date(b.at) - new Date(a.at)));
}

let started = false;
export function startHub(go) {
  const hub = H(); if (!hub) return;
  hub.init({
    key: () => (state.me?.user_id || 'x') + '.' + (state.clientId || ''),
    searchItems(qs) {
      const out = [];
      const pages = PAGES.filter(([k]) => k === 'help' || (state.clientId && canView(k)));
      pages.filter(([, l]) => !qs || l.toLowerCase().includes(qs)).forEach(([k, l]) => out.push({ group: 'Pages', icon: 'page', label: l, run: () => go(k) }));
      if (qs) {
        const m = (x) => (x.name || '').toLowerCase().includes(qs);
        cache.index.screens.filter(m).slice(0, 8).forEach((x) => out.push({ group: 'TVs', icon: 'page', label: x.name, run: () => go('screen/' + x.id) }));
        cache.index.playlists.filter(m).slice(0, 8).forEach((x) => out.push({ group: 'Playlists', icon: 'page', label: x.name, run: () => go('playlist/' + x.id) }));
        cache.index.media.filter(m).slice(0, 8).forEach((x) => out.push({ group: 'Media', icon: 'page', label: x.name, run: () => go('media') }));
      }
      return out;
    },
    chat: {
      me: () => ({ id: state.me?.user_id }),
      teamName: () => (state.me?.clients || []).find((c) => c.id === state.clientId)?.name || 'Everyone',
      unavailable: () => (!state.clientId ? 'Pick a business first.' : cache.chatOff ? 'Team chat isn’t switched on yet. It will appear here as soon as Proview turns it on.' : ''),
      people: () => cache.people.map((p) => ({ id: p.user_id, name: cap(p.email), sub: roleLabel(p.role) })),
      cached: () => cache.msgs.map((m) => ({ id: m.id, by: m.author, byName: cap(m.author_email), to: m.to_user || 'all', text: m.body, at: m.created_at })),
      refresh: async () => { await loadChat(); },
      async send(conv, text) {
        const row = await q(sb.from('team_messages').insert({ client_id: state.clientId, body: text, to_user: conv === 'all' ? null : conv }).select('id,author,author_email,to_user,body,created_at').single());
        if (row) cache.msgs.push(row);
      },
    },
    inbox: {
      empty: 'Nothing waiting for you. Publish requests and approvals show up here.',
      items: async () => { await loadReqs(); return inboxRaw(); },
      count: () => inboxRaw().filter((i) => i.unread).length,
      seen: () => localStorage.setItem(seenKey(), String(Date.now())),
    },
  });
  refreshAll();
  if (!started) { started = true; setInterval(refreshAll, 30000); addEventListener('focus', refreshAll); }
}

/** the status dot: green online, amber offline */
export function statusDot() {
  const d = document.createElement('span');
  d.setAttribute('role', 'img');
  const paint = () => { d.className = 'hdr-dot' + (navigator.onLine ? '' : ' offline'); d.title = navigator.onLine ? 'Online' : 'Offline — changes will be sent when you’re back online'; d.setAttribute('aria-label', navigator.onLine ? 'Online' : 'Offline'); };
  paint(); addEventListener('online', paint); addEventListener('offline', paint);
  return d;
}
