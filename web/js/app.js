import { configured } from './sb.js';
import { sb, state, h, icon, brandMark, wordmark, clientLabel, clientTitle, toast, errMsg, field, refreshMe, setClient, rpc, role } from './core.js';
import { screensPage } from './pages/screens.js';
import { screenPage } from './pages/screen.js';
import { playlistsPage } from './pages/playlists.js';
import { editorPage } from './pages/editor.js';
import { mediaPage } from './pages/media.js';
import { teamPage } from './pages/team.js';
import { clientsPage } from './pages/clients.js';
import { activityPage } from './pages/activity.js';
import { reportsPage } from './pages/reports.js';
import { q, timeAgo, modal } from './core.js';

const root = document.getElementById('root');
const APP = window.SIGNAGE_CONFIG?.APP_NAME || 'PROVIEW SIGNAGE';
document.title = APP;

// ------------------------------------------------------------ routing
const routes = [
  [/^screens$/, screensPage, 'screens'],
  [/^screen\/([\w-]+)$/, screenPage, 'screens'],
  [/^playlists$/, playlistsPage, 'playlists'],
  [/^playlist\/([\w-]+)$/, editorPage, 'playlists'],
  [/^media$/, mediaPage, 'media'],
  [/^team$/, teamPage, 'team'],
  [/^activity(\?.*)?$/, activityPage, 'activity'],
  [/^reports$/, reportsPage, 'reports'],
  [/^clients$/, clientsPage, 'clients'],
];

let cleanup = null;
export function go(path) { location.hash = '#/' + path; }

async function render() {
  cleanup?.(); cleanup = null;
  const path = location.hash.replace(/^#\/?/, '');

  if (!configured) return root.replaceChildren(setupNeeded());

  const join = path.match(/^join\/(\w+)$/);
  if (join) localStorage.setItem('signage.invite', join[1]);

  if (!state.session) return root.replaceChildren(await authPage(join?.[1]));

  // Pending invite (from link or after email confirmation)
  const pending = localStorage.getItem('signage.invite');
  if (pending) {
    try {
      const cid = await rpc('accept_invite', { p_token: pending });
      localStorage.removeItem('signage.invite');
      await refreshMe();
      setClient(cid);
      toast('Invite accepted — welcome!');
      if (join) return go('screens');
    } catch (e) {
      localStorage.removeItem('signage.invite');
      toast(errMsg(e), true);
      if (join) return go('screens');
    }
  }

  if (!state.me) {
    try { await refreshMe(); } catch (e) { return root.replaceChildren(errorPage(e)); }
  }
  if (!state.me.is_admin && !state.me.clients.length) return root.replaceChildren(noAccess());

  let match = null, page = null, section = null;
  for (const [re, fn, sec] of routes) { const m = path.match(re); if (m) { match = m; page = fn; section = sec; break; } }
  if (!page) return go(state.me.is_admin && !state.clientId ? 'clients' : 'screens');
  if (section === 'clients' && !state.me.is_admin) return go('screens');
  if (section !== 'clients' && !state.clientId) return go('clients');

  const main = h('main', { class: 'main' });
  root.replaceChildren(shell(section, main));
  main.append(h('div', { class: 'row', style: { gap: '10px', color: '#888' } }, h('div', { class: 'spinner' }), 'Loading…'));
  try {
    const out = await page({ main, params: match.slice(1), go, rerender: render });
    if (typeof out === 'function') cleanup = out;
  } catch (e) {
    console.error(e);
    main.replaceChildren(errorPage(e));
  }
}
window.addEventListener('hashchange', render);

// ------------------------------------------------------------ shell
function nav(section) {
  const r = role();
  const items = [
    ['screens', 'Screens', 'screens'],
    ['playlists', 'Playlists', 'playlists'],
    ['media', 'Media', 'media'],
    ['reports', 'Reports', 'chart'],
    ['activity', 'Activity', 'activity'],
    ['team', 'Team', 'team'],
  ];
  return { items: state.clientId ? items : [], admin: state.me.is_admin, r, section };
}

function clientPicker() {
  const cs = state.me.clients;
  if (!cs.length) return null;
  if (cs.length === 1 && !state.me.is_admin) return h('div', { class: 'tiny', style: { color: '#9a9aa4', padding: '0 10px 14px' } }, clientTitle(cs[0]));
  const s = h('select', {
    'aria-label': 'Client',
    onchange: (e) => { setClient(e.target.value); const p = location.hash.replace(/^#\/?/, '').split('/')[0]; go(['screen', 'playlist'].includes(p) ? p + 's' : (p === 'clients' ? 'screens' : p || 'screens')); render(); },
  });
  for (const c of cs) s.append(h('option', { value: c.id, selected: c.id === state.clientId, title: clientLabel(c) }, clientLabel(c)));
  return s;
}

function shell(section, main) {
  const n = nav(section);
  const link = (key, label, ic) => h('a', { href: '#/' + key, class: section === key ? 'active' : '' }, icon(ic), h('span', {}, label));

  const side = h('aside', { class: 'side' },
    h('div', { class: 'brand', style: { justifyContent: 'space-between' } }, h('div', { class: 'row', style: { gap: '10px', flexWrap: 'nowrap' } }, brandMark(), wordmark(APP)), bell()),
    h('div', { class: 'client-pick' }, clientPicker()),
    h('nav', { class: 'nav' },
      n.items.map(([k, l, i]) => link(k, l, i)),
      n.admin ? [h('div', { class: 'nav-sep' }, 'Admin'), link('clients', 'Clients & TVs', 'clients')] : null),
    h('div', { class: 'side-foot' },
      h('div', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, state.me.email),
      h('div', { class: 'tiny' }, n.r === 'admin' ? 'Administrator' : n.r === 'manager' ? 'Manager' : 'Editor'),
      h('button', { class: 'btn sm', onclick: signOut }, icon('logout'), 'Sign out')));

  const top = h('header', { class: 'topbar' }, h('div', { class: 'brand' }, brandMark(), wordmark(APP)), clientPicker(), bell(),
    h('button', { class: 'btn ghost icon', style: { color: '#fff' }, onclick: signOut, 'aria-label': 'Sign out' }, icon('logout')));
  const tabs = h('nav', { class: 'tabbar' },
    n.items.map(([k, l, i]) => h('a', { href: '#/' + k, class: section === k ? 'active' : '' }, icon(i), l)),
    n.admin ? h('a', { href: '#/clients', class: section === 'clients' ? 'active' : '' }, icon('clients'), 'Clients') : null);

  return h('div', { class: 'app' }, side, h('div', { style: { minWidth: 0 } }, top, main), tabs);
}

// ------------------------------------------------------------ notifications bell
function bell() {
  const key = 'signage.notif.read.' + state.me.user_id;
  const btn = h('button', { class: 'btn ghost icon bell', title: 'Notifications', style: { color: '#c9c9d1', position: 'relative' } }, '🔔');
  const dot = h('span', { class: 'bell-dot hidden' });
  btn.append(dot);
  let items = [];
  const load = async () => {
    try {
      let qry = sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(60);
      if (!state.me.is_admin && state.clientId) qry = qry.eq('client_id', state.clientId);
      items = await q(qry);
      const last = localStorage.getItem(key) || '';
      const unread = items.filter((n) => n.created_at > last).length;
      dot.textContent = unread > 9 ? '9+' : String(unread);
      dot.classList.toggle('hidden', !unread);
    } catch {}
  };
  btn.onclick = () => {
    localStorage.setItem(key, new Date().toISOString());
    dot.classList.add('hidden');
    const names = Object.fromEntries(state.me.clients.map((c) => [c.id, c.name]));
    const ico = { offline: '🔴', online: '🟢', licence_14d: '🟡', licence_3d: '🟠', licence_expired: '⛔', payment: '💳' };
    modal({ title: 'Notifications', body: [items.length ? h('div', { class: 'list' }, items.map((n) => h('div', { class: 'list-row', style: { cursor: n.screen_id ? 'pointer' : 'default' },
      onclick: () => { if (n.screen_id && n.client_id) { setClient(n.client_id); document.querySelector('.modal-back')?.remove(); go('screen/' + n.screen_id); } } },
      h('div', { style: { width: '22px' } }, ico[n.kind] || '•'),
      h('div', { class: 'grow' }, h('div', { style: { fontWeight: 600 } }, n.title), h('div', { class: 'tiny' }, [n.body, state.me.is_admin && names[n.client_id]].filter(Boolean).join(' · '))),
      h('span', { class: 'tiny' }, timeAgo(n.created_at)))))
      : h('p', { class: 'muted' }, 'No notifications yet. You’ll see offline TVs, licence reminders and payments here.')] });
  };
  load();
  clearInterval(window.__bellTimer);
  window.__bellTimer = setInterval(load, 60000);
  return btn;
}

async function signOut() {
  await sb.auth.signOut();
  state.me = null;
  location.hash = '';
}

// ------------------------------------------------------------ auth
async function authPage(inviteToken) {
  let invite = null;
  if (inviteToken) { try { invite = (await sb.rpc('invite_info', { p_token: inviteToken })).data; } catch {} }
  let mode = invite && !invite.used ? 'signup' : 'signin';

  const email = h('input', { type: 'email', required: true, autocomplete: 'email', value: invite?.email || '', placeholder: 'you@company.com' });
  const pass = h('input', { type: 'password', required: true, minLength: 8, autocomplete: 'current-password', placeholder: '••••••••' });
  const msg = h('div');
  const submit = h('button', { class: 'btn primary', type: 'submit' });
  const title = h('h1');
  const sub = h('p', { class: 'muted', style: { margin: 0 } });
  const swap = h('button', { class: 'btn ghost sm', type: 'button' });
  const forgot = h('button', { class: 'btn ghost sm', type: 'button', onclick: async () => {
    if (!email.value) return toast('Enter your email first', true);
    const { error } = await sb.auth.resetPasswordForEmail(email.value, { redirectTo: location.origin + location.pathname });
    error ? toast(errMsg(error), true) : toast('Password reset email sent');
  } }, 'Forgot password?');

  const paint = () => {
    title.textContent = mode === 'signup' ? 'Create your account' : 'Sign in';
    sub.textContent = invite && !invite.used
      ? `You've been invited to manage screens for ${invite.client} as ${invite.role === 'manager' ? 'a manager' : 'an editor'}.`
      : mode === 'signup' ? 'Sign up with the email address your invite was sent to.' : 'Manage your screens, media and schedules.';
    submit.textContent = mode === 'signup' ? 'Create account' : 'Sign in';
    swap.textContent = mode === 'signup' ? 'I already have an account' : 'Create an account';
    pass.autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
    forgot.classList.toggle('hidden', mode === 'signup');
    msg.replaceChildren();
  };
  swap.onclick = () => { mode = mode === 'signup' ? 'signin' : 'signup'; paint(); };
  paint();

  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      submit.disabled = true;
      msg.replaceChildren();
      try {
        if (mode === 'signup') {
          const { data, error } = await sb.auth.signUp({ email: email.value.trim(), password: pass.value, options: { emailRedirectTo: location.origin + location.pathname } });
          if (error) throw error;
          if (!data.session) {
            msg.replaceChildren(h('div', { class: 'notice info' }, 'Check your inbox to confirm your email, then come back and sign in.'));
            mode = 'signin'; submit.disabled = false; return;
          }
        } else {
          const { error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: pass.value });
          if (error) throw error;
        }
      } catch (err) {
        msg.replaceChildren(h('div', { class: 'notice' }, errMsg(err)));
      }
      submit.disabled = false;
    },
  }, h('div', { class: 'brand', style: { color: 'var(--ink)', padding: 0, marginBottom: '10px' } }, brandMark(), wordmark(APP)),
    title, sub, msg, field('Email', email), field('Password', pass), submit,
    h('div', { class: 'row between' }, swap, forgot));

  return h('div', { class: 'auth' },
    h('div', { class: 'auth-art' },
      h('div', { class: 'brand', style: { padding: 0 } }, brandMark(), wordmark(APP)),
      h('h2', {}, 'Every screen, on schedule — from your phone.'),
      h('div', { class: 'tv' }),
      h('div', { class: 'muted', style: { color: '#9a9aa4' } }, 'Upload, build slides, schedule and publish to your TVs.')),
    h('div', { class: 'auth-form' }, form));
}

function noAccess() {
  return h('div', { class: 'auth-form', style: { minHeight: '100vh' } },
    h('div', { class: 'stack', style: { maxWidth: '420px', textAlign: 'center' } },
      h('h1', {}, 'No screens yet'),
      h('p', { class: 'muted' }, `You're signed in as ${state.me.email}, but this account hasn't been added to a client yet. Ask your provider for an invite link, then open it while signed in.`),
      h('div', {}, h('button', { class: 'btn', onclick: signOut }, 'Sign out'))));
}

function setupNeeded() {
  return h('div', { class: 'auth-form', style: { minHeight: '100vh' } },
    h('div', { class: 'stack', style: { maxWidth: '520px' } },
      h('h1', {}, 'Almost there'),
      h('p', { class: 'muted' }, 'Add your Supabase project URL and anon key to web/config.js, then reload. See README.md for the full setup.')));
}

function errorPage(e) {
  return h('div', { class: 'card pad stack' }, h('h2', {}, 'Something went wrong'), h('div', { class: 'notice' }, errMsg(e)),
    h('div', {}, h('button', { class: 'btn', onclick: () => render() }, 'Try again')));
}

// ------------------------------------------------------------ boot
(async () => {
  if (!configured) return render();
  const { data } = await sb.auth.getSession();
  state.session = data.session;
  sb.auth.onAuthStateChange((event, session) => {
    const had = !!state.session;
    state.session = session;
    if (event === 'PASSWORD_RECOVERY') {
      const p = prompt('Choose a new password (8+ characters):');
      if (p) sb.auth.updateUser({ password: p }).then(({ error }) => toast(error ? errMsg(error) : 'Password updated', !!error));
    }
    if (had !== !!session) { state.me = null; render(); }
  });
  render();
})();
