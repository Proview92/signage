import { configured } from './sb.js';
import { sb, state, h, icon, brandMark, wordmark, clientLabel, clientTitle, toast, errMsg, field, refreshMe, setClient, rpc, role, promptBox, passwordToggle } from './core.js';
import { screensPage } from './pages/screens.js';
import { screenPage } from './pages/screen.js';
import { playlistsPage } from './pages/playlists.js';
import { editorPage } from './pages/editor.js';
import { mediaPage } from './pages/media.js';
import { teamPage } from './pages/team.js';
import { clientsPage } from './pages/clients.js';
import { activityPage } from './pages/activity.js';
import { reportsPage } from './pages/reports.js';
import { helpPage } from './pages/help.js';
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
  [/^help$/, helpPage, 'help'],
];

let cleanup = null, renderSeq = 0;
export function go(path) { location.hash = '#/' + path; }

async function render() {
  const my = ++renderSeq;
  cleanup?.(); cleanup = null;
  const path = location.hash.replace(/^#\/?/, '');

  if (!configured) return root.replaceChildren(setupNeeded());

  const join = path.match(/^join\/(\w+)$/);
  if (join) localStorage.setItem('signage.invite', join[1]);
  const qInvite = new URLSearchParams(location.search).get('invite');
  if (qInvite && /^\w+$/.test(qInvite)) localStorage.setItem('signage.invite', qInvite);

  if (!state.session) return root.replaceChildren(await authPage(join?.[1], path === 'signup'));
  // Password was reset by an admin to a temporary one: choose a new password before anything else.
  if (state.session.user?.app_metadata?.must_change_password) return root.replaceChildren(changePasswordPage());

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
  // Signed out (or a newer render started) while we were waiting: let that one finish instead.
  if (!state.me || !state.session || my !== renderSeq) return;
  if (!state.me.is_admin && !state.me.clients.length) return root.replaceChildren(setupBusiness());
  // Always have a valid business selected (never "none" for someone who belongs to one).
  if (!state.me.is_admin && !state.me.clients.some((c) => c.id === state.clientId)) setClient(state.me.clients[0].id);

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
    // Navigated away while this page was loading: tidy it up straight away.
    if (my !== renderSeq) { if (typeof out === 'function') out(); return; }
    if (typeof out === 'function') cleanup = out;
  } catch (e) {
    console.error(e);
    main.replaceChildren(errorPage(e));
  }
}
window.addEventListener('hashchange', () => { document.querySelectorAll('.modal-back').forEach((m) => (m._close ? m._close() : m.remove())); render(); });

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
    onchange: (e) => { setClient(e.target.value); const p = location.hash.replace(/^#\/?/, '').split('/')[0]; const to = '#/' + (['screen', 'playlist'].includes(p) ? p + 's' : (p === 'clients' ? 'screens' : p || 'screens')); if (location.hash === to) render(); else location.hash = to; },
  });
  for (const c of cs) s.append(h('option', { value: c.id, selected: c.id === state.clientId, title: clientLabel(c) }, clientLabel(c)));
  return s;
}

function shell(section, main) {
  const n = nav(section);
  const link = (key, label, ic) => h('a', { href: '#/' + key, class: section === key ? 'active' : '' }, icon(ic), h('span', {}, label));

  const side = h('aside', { class: 'side' },
    h('div', { class: 'brand' }, brandMark(), wordmark(APP)),
    h('div', { class: 'client-pick' }, clientPicker()),
    h('nav', { class: 'nav' },
      n.items.map(([k, l, i]) => link(k, l, i)),
      bell('row'),
      link('help', 'Help', 'help'),
      n.admin ? [h('div', { class: 'nav-sep' }, 'Admin'), link('clients', 'Clients & TVs', 'clients')] : null),
    h('div', { class: 'side-foot' },
      h('div', { style: { overflow: 'hidden', textOverflow: 'ellipsis' } }, state.me.email),
      h('div', { class: 'tiny' }, n.r === 'admin' ? 'Administrator' : n.r === 'manager' ? 'Manager' : 'Editor'),
      h('button', { class: 'btn sm', onclick: signOut }, icon('logout'), 'Sign out')));

  const top = h('header', { class: 'topbar' }, h('div', { class: 'brand' }, brandMark(), wordmark(APP)), clientPicker(), bell('icon'),
    h('a', { class: 'btn ghost icon', href: '#/help', style: { color: '#fff' }, 'aria-label': 'Help', title: 'Help' }, icon('help')),
    h('button', { class: 'btn ghost icon', style: { color: '#fff' }, onclick: signOut, 'aria-label': 'Sign out' }, icon('logout')));
  const tabs = h('nav', { class: 'tabbar' },
    n.items.map(([k, l, i]) => h('a', { href: '#/' + k, class: section === k ? 'active' : '' }, icon(i), l)),
    n.admin ? h('a', { href: '#/clients', class: section === 'clients' ? 'active' : '' }, icon('clients'), 'Clients') : null);

  return h('div', { class: 'app' }, side, h('div', { style: { minWidth: 0 } }, top, main), tabs);
}

// ------------------------------------------------------------ notifications bell
// Notifications: one shared loader feeds the sidebar row and the mobile top-bar button.
const bellViews = new Set();
let bellItems = [];
function bellKey() { return 'signage.notif.read.' + state.me.user_id; }
function paintBells() {
  const last = localStorage.getItem(bellKey()) || '';
  const unread = bellItems.filter((n) => n.created_at > last).length;
  for (const dot of bellViews) {
    dot.textContent = unread > 9 ? '9+' : String(unread);
    dot.classList.toggle('hidden', !unread);
  }
}
async function loadBells() {
  try {
    let qry = sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(60);
    if (!state.me.is_admin && state.clientId) qry = qry.eq('client_id', state.clientId);
    bellItems = await q(qry);
    paintBells();
  } catch {}
}
function openNotifications() {
  localStorage.setItem(bellKey(), new Date().toISOString());
  paintBells();
  const names = Object.fromEntries(state.me.clients.map((c) => [c.id, c.name]));
  const ico = { offline: '🔴', online: '🟢', licence_14d: '🟡', licence_3d: '🟠', licence_expired: '⛔', payment: '💳' };
  modal({ title: 'Notifications', body: [bellItems.length ? h('div', { class: 'list' }, bellItems.map((n) => h('div', { class: 'list-row', style: { cursor: n.screen_id ? 'pointer' : 'default' },
    onclick: () => { if (n.screen_id && n.client_id) { setClient(n.client_id); document.querySelector('.modal-back')?.remove(); go('screen/' + n.screen_id); } } },
    h('div', { style: { width: '22px' } }, ico[n.kind] || '•'),
    h('div', { class: 'grow' }, h('div', { style: { fontWeight: 600 } }, n.title), h('div', { class: 'tiny' }, [n.body, state.me.is_admin && names[n.client_id]].filter(Boolean).join(' · '))),
    h('span', { class: 'tiny' }, timeAgo(n.created_at)))))
    : h('p', { class: 'muted' }, 'No notifications yet. You’ll see offline TVs, licence reminders and payments here.')] });
}
/** variant 'row' = sidebar menu row, 'icon' = mobile top-bar button */
function bell(variant = 'row') {
  const dot = h('span', { class: 'bell-dot hidden' });
  if (variant === 'row') for (const d of bellViews) if (!d.isConnected) bellViews.delete(d);   // new page: drop old badges
  bellViews.add(dot);
  const el = variant === 'row'
    ? h('a', { href: 'javascript:void 0', class: 'bell-row', onclick: (e) => { e.preventDefault(); openNotifications(); } }, icon('bell'), h('span', {}, 'Notifications'), dot)
    : h('button', { class: 'btn ghost icon bell', title: 'Notifications', 'aria-label': 'Notifications', onclick: openNotifications }, icon('bell'), dot);
  if (variant === 'row') { loadBells(); clearInterval(window.__bellTimer); window.__bellTimer = setInterval(loadBells, 60000); }
  else paintBells();
  return el;
}

async function signOut() {
  await sb.auth.signOut();
  state.me = null;
  location.hash = '';
}

// ------------------------------------------------------------ auth
// Where the "confirm your email" link sends people (keeps the invite, even on another device).
function confirmUrl() {
  const inv = localStorage.getItem('signage.invite');
  return location.origin + location.pathname + (inv ? `?invite=${inv}` : '');
}

// Sign-in left panel art: a wall of four screens (design option A)
function signageArt() {
  const d = document.createElement('div');
  d.style.display = 'contents';
  d.innerHTML = `<div class="pva pva-wall" aria-hidden="true">
<div class="t t-menu"><b>Breakfast</b><p><span>Full English</span><span>£9.50</span></p><p><span>Avocado toast</span><span>£7.00</span></p><p><span>Flat white</span><span>£3.20</span></p></div>
<div class="t t-promo"><small>TODAY</small><b>Happy hour<br>5–7pm</b></div>
<div class="t t-clock"><b>09:41</b><small>Friday · Sunny 14°</small></div>
<div class="t t-welcome"><i class="c1"></i><i class="c2"></i><b>Welcome in</b></div>
</div>
<div class="pva pva-chip pva-wallchip" aria-hidden="true"><span class="pva-dot" style="background:#4ade80"></span>4 screens playing</div>`;
  return d;
}

const AUTH_LOOK = 'classic';   // original design; 'glow' | 'wall' | 'hero' also available
async function authPage(inviteToken, startSignup = false) {
  let invite = null;
  if (inviteToken) { try { invite = (await sb.rpc('invite_info', { p_token: inviteToken })).data; } catch {} }
  let mode = (invite && !invite.used) || startSignup ? 'signup' : 'signin';
  // Coming back from the "confirm your email" link?
  const qs = new URLSearchParams(location.search);
  const cameBack = qs.has('code') || qs.has('invite') || qs.has('error_description');
  const linkError = qs.get('error_description');
  if (cameBack) { history.replaceState(null, '', location.pathname + location.hash); if (!linkError) mode = 'signin'; }
  const rememberedEmail = localStorage.getItem('signage.signupEmail') || '';

  const email = h('input', { type: 'email', required: true, autocomplete: 'email', value: invite?.email || (cameBack ? rememberedEmail : '') || '', placeholder: 'you@company.com' });
  const pass = h('input', { type: 'password', required: true, minLength: 8, autocomplete: 'current-password', placeholder: '••••••••' });
  const pass2 = h('input', { type: 'password', minLength: 8, autocomplete: 'new-password', placeholder: 'Type it again' });
  const matchMsg = h('div', { class: 'pw-match' });
  const checkMatch = () => {
    if (!pass2.value) { matchMsg.textContent = ''; return; }
    const ok = pass.value === pass2.value;
    matchMsg.textContent = ok ? '✓ Passwords match' : 'Passwords don’t match yet';
    matchMsg.className = 'pw-match ' + (ok ? 'ok' : 'bad');
  };
  pass.addEventListener('input', checkMatch); pass2.addEventListener('input', checkMatch);
  const passField = field('Password', passwordToggle(pass), '');
  const pass2Field = field('Confirm password', h('div', {}, passwordToggle(pass2), matchMsg));
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
      : mode === 'signup' ? 'Start your free 3-day trial on 1 screen. No card needed. Invited by someone? Use the email address your invite was sent to.' : 'Manage your screens, media and schedules.';
    submit.textContent = mode === 'signup' ? 'Create account' : 'Sign in';
    swap.textContent = mode === 'signup' ? 'I already have an account' : 'Create an account';
    pass.autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
    pass.placeholder = mode === 'signup' ? 'At least 8 characters' : '••••••••';
    pass.minLength = mode === 'signup' ? 8 : 1; // older accounts may have shorter passwords
    pass2Field.classList.toggle('hidden', mode !== 'signup');
    pass2.required = mode === 'signup';
    pass2.value = ''; checkMatch();
    forgot.classList.toggle('hidden', mode === 'signup');
    msg.replaceChildren();
  };
  // After sign-up: a clear "check your email" panel with the next steps.
  const showCheckEmail = (addr) => {
    const resend = h('button', { class: 'btn sm', type: 'button', onclick: async () => {
      resend.disabled = true;
      const { error } = await sb.auth.resend({ type: 'signup', email: addr, options: { emailRedirectTo: confirmUrl() } });
      error ? toast(errMsg(error), true) : toast('Confirmation email sent again');
      setTimeout(() => (resend.disabled = false), 30000);
    } }, 'Send the email again');
    msg.replaceChildren(h('div', { class: 'notice ok stack', style: { gap: '8px' } },
      h('div', { style: { fontWeight: 700 } }, '✓ Account created — check your email'),
      h('div', {}, `We've sent a confirmation link to ${addr}. Click it and you'll come straight back here, signed in. If you open it on another device, just sign in below with your password.`),
      h('div', { class: 'row', style: { gap: '8px' } }, resend)));
  };
  swap.onclick = () => { mode = mode === 'signup' ? 'signin' : 'signup'; paint(); };
  paint();
  if (cameBack && linkError) msg.replaceChildren(h('div', { class: 'notice bad' }, `That link didn't work: ${linkError}. Sign in below, or use “Forgot password?”.`));
  else if (cameBack) msg.replaceChildren(h('div', { class: 'notice ok' }, '✓ Email confirmed. Sign in with your password to continue.'));

  // Unknown email on the sign-in form: offer to create an account instead of failing silently.
  let prompting = false, lastChecked = '';
  function noAccountPrompt(addr) {
    if (prompting) return; prompting = true;
    modal({
      title: 'This email doesn’t exist',
      compact: true,
      body: [h('p', {}, 'We couldn’t find an account for', h('br'), h('b', { class: 'nm-email' }, addr.toLowerCase())),
        h('p', {}, 'Would you like to create a new account?'),
        h('p', { class: 'nm-note' }, 'Includes a free 3-day trial on 1 screen.')],
      onClose: () => { prompting = false; },
      actions: [
        { label: 'No, go back', onClick: () => { pass.value = ''; msg.replaceChildren(h('div', { class: 'notice' }, 'Check the email address and try again.')); setTimeout(() => email.focus(), 50); } },
        { label: 'Yes, create a new account', class: 'primary', onClick: () => {
          const typed = pass.value;
          mode = 'signup'; paint();
          email.value = addr; pass.value = typed; pass2.value = '';
          msg.replaceChildren(h('div', { class: 'notice info' }, typed.length >= 8 ? 'Type your password again to confirm it, then press Create account.' : 'Choose a password (at least 8 characters), then press Create account.'));
          setTimeout(() => (typed.length >= 8 ? pass2 : pass).focus(), 50);
        } },
      ],
    });
  }

  email.addEventListener('change', async () => {
    const addr = email.value.trim();
    if (mode !== 'signin' || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr) || addr.toLowerCase() === lastChecked) return;
    lastChecked = addr.toLowerCase();
    try {
      const { data: exists, error } = await sb.rpc('email_has_account', { p_email: addr });
      if (!error && exists === false && mode === 'signin' && email.value.trim().toLowerCase() === lastChecked) noAccountPrompt(addr);
    } catch {}
  });

  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      submit.disabled = true;
      msg.replaceChildren();
      try {
        if (mode === 'signup') {
          if (pass.value.length < 8) throw new Error('Use at least 8 characters for your password.');
          if (pass.value !== pass2.value) { pass2.focus(); throw new Error('The two passwords don’t match. Please type them again.'); }
          const addr = email.value.trim();
          const { data, error } = await sb.auth.signUp({ email: addr, password: pass.value, options: { emailRedirectTo: confirmUrl() } });
          if (error) throw error;
          if (!data.session) {
            localStorage.setItem('signage.signupEmail', addr);
            mode = 'signin'; paint(); showCheckEmail(addr);
            submit.disabled = false; return;
          }
        } else {
          const addr = email.value.trim();
          const { error } = await sb.auth.signInWithPassword({ email: addr, password: pass.value });
          if (error) {
            // Supabase gives the same answer for "no such account" and "wrong password": ask which it is.
            if (/invalid login credentials/i.test(error.message || '')) {
              const { data: exists, error: e2 } = await sb.rpc('email_has_account', { p_email: addr });
              if (!e2 && exists === false) { submit.disabled = false; return noAccountPrompt(addr); }
              if (!e2 && exists === true) throw new Error('That password isn’t right. Try again, or press “Forgot password?” to reset it.');
            }
            throw error;
          }
        }
      } catch (err) {
        msg.replaceChildren(h('div', { class: 'notice' }, errMsg(err)));
      }
      submit.disabled = false;
    },
  }, h('div', { class: 'auth-brand' }, h('img', { class: 'auth-logo', src: 'logo.png', alt: '' }), wordmark(APP)),
    title, sub, msg, field('Email', email), passField, pass2Field, submit,
    h('div', { class: 'row between' }, swap, forgot));

  // Sign-in page design: 'glow' | 'wall' | 'hero' (?look=… to preview another)
  const look = new URLSearchParams(location.search).get('look') || AUTH_LOOK;
  return h('div', { class: 'auth look-' + look },
    h('div', { class: 'auth-bg', 'aria-hidden': 'true' }, ...Array.from({ length: 10 }, (_, i) => h('i', { class: 't' + i }))),
    h('div', { class: 'auth-art' },
      h('img', { class: 'auth-art-logo', src: 'logo.png', alt: '' }),
      h('div', { class: 'brand', style: { padding: 0 } }, brandMark(), wordmark(APP)),
      h('h2', {}, 'Every screen, on schedule — from your phone.'),
      signageArt(),
      h('div', { class: 'muted', style: { color: '#9a9aa4' } }, 'Upload, build slides, schedule and publish to your TVs.')),
    h('div', { class: 'auth-form' }, form));
}

function changePasswordPage() {
  const until = state.session.user.app_metadata.temp_password_until;
  if (until && new Date(until) < new Date()) {
    sb.auth.signOut();
    toast('That temporary password has expired. Ask your administrator to reset it again.', true);
    return h('div');
  }
  const pass = h('input', { type: 'password', required: true, minLength: 8, autocomplete: 'new-password', placeholder: 'At least 8 characters' });
  const pass2 = h('input', { type: 'password', required: true, minLength: 8, autocomplete: 'new-password', placeholder: 'Type it again' });
  const msg = h('div');
  const submit = h('button', { class: 'btn primary', type: 'submit', style: { width: '100%' } }, 'Save new password');
  const form = h('form', { class: 'stack', style: { maxWidth: '400px', width: '100%' }, onsubmit: async (e) => {
    e.preventDefault();
    msg.replaceChildren();
    if (pass.value !== pass2.value) return msg.replaceChildren(h('div', { class: 'notice bad' }, 'The two passwords don’t match.'));
    if (pass.value === '123456') return msg.replaceChildren(h('div', { class: 'notice bad' }, 'Choose a password of your own, not the temporary one.'));
    submit.disabled = true;
    try {
      const { error } = await sb.auth.updateUser({ password: pass.value });
      if (error) throw error;
      const { data } = await sb.auth.refreshSession();   // fresh login token without the "must change" flag
      if (data?.session) state.session = data.session;
      if (state.session?.user?.app_metadata) delete state.session.user.app_metadata.must_change_password;
      toast('Password saved. Welcome back!');
      render();
    } catch (err) { msg.replaceChildren(h('div', { class: 'notice bad' }, errMsg(err))); submit.disabled = false; }
  } },
    h('img', { src: 'logo.png', alt: 'PROVIEW', style: { height: '56px', alignSelf: 'center' } }),
    h('h1', { style: { textAlign: 'center', margin: '6px 0 0' } }, 'Choose a new password'),
    h('p', { class: 'muted', style: { textAlign: 'center', margin: 0 } }, `Your password was reset by an administrator. Set a new one for ${state.session.user.email} to continue.`),
    field('New password', passwordToggle(pass)),
    field('Confirm new password', passwordToggle(pass2)),
    msg, submit,
    h('button', { class: 'btn ghost', type: 'button', onclick: signOut }, 'Sign out'));
  return h('div', { class: 'auth-form', style: { minHeight: '100vh' } }, form);
}

// New sign-up with no business yet: create one and start the free trial.
function setupBusiness() {
  const name = h('input', { type: 'text', required: true, maxLength: 80, autocomplete: 'organization', placeholder: 'e.g. Station Road Café' });
  const phone = h('input', { type: 'tel', maxLength: 30, autocomplete: 'tel', placeholder: 'Optional, so we can help you get set up' });
  const msg = h('div');
  const submit = h('button', { class: 'btn primary', type: 'submit', style: { width: '100%' } }, 'Start my free trial');
  const form = h('form', { class: 'stack', style: { maxWidth: '440px', width: '100%' }, onsubmit: async (e) => {
    e.preventDefault(); msg.replaceChildren(); submit.disabled = true;
    try {
      await rpc('create_my_business', { p_name: name.value, p_phone: phone.value || null });
      await refreshMe();
      toast('Welcome! Now pair your TV to start your 3-day trial.');
      location.hash = '#/screens'; render();
    } catch (err) { msg.replaceChildren(h('div', { class: 'notice bad' }, errMsg(err))); submit.disabled = false; }
  } },
    h('img', { src: 'logo.png', alt: 'PROVIEW', style: { height: '56px', alignSelf: 'center' } }),
    h('h1', { style: { textAlign: 'center', margin: '6px 0 0' } }, 'Set up your business'),
    h('p', { class: 'muted', style: { textAlign: 'center', margin: 0 } }, `Signed in as ${state.me.email}. Your free trial includes 1 screen for 3 days, with every feature.`),
    msg, field('Business name', name), field('Phone number', phone), submit,
    h('p', { class: 'tiny', style: { textAlign: 'center', margin: 0 } }, 'Were you invited to someone else’s account? Open the invite link from your email instead.'),
    h('div', { style: { textAlign: 'center' } }, h('button', { class: 'btn ghost sm', type: 'button', onclick: signOut }, 'Sign out')));
  setTimeout(() => name.focus(), 50);
  return h('div', { class: 'auth-form', style: { minHeight: '100vh' } }, form);
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
      promptBox('Choose a new password', 'New password (8+ characters)', { type: 'password', okLabel: 'Save password', minLength: 8 })
        .then((p) => p && sb.auth.updateUser({ password: p }).then(({ error }) => toast(error ? errMsg(error) : 'Password updated', !!error)));
    }
    if (had !== !!session) { state.me = null; render(); }
  });
  render();
})();
