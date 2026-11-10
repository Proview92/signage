// Users: Owner / Admin (and the Proview admin) invite people, set their role, pick their sites,
// switch features on or off, and remove them. The database enforces all of this (migration 030).
import { clientTitle, headChips } from '../core.js';
import { sb, state, h, icon, q, rpc, toast, modal, field, select, confirmBox, copyText, timeAgo, canManage, currentClient, errMsg, FEATURES, featureDefault, roleLabel, passwordToggle } from '../core.js';
import { loadSites } from './sites-ui.js';

const req = (label) => h('span', {}, label, h('span', { style: { color: '#d92d20' }, title: 'Required' }, ' *'));

export const inviteLink = (token) => `${location.origin}${location.pathname}#/join/${token}`;

const ROLE_OPTIONS = [
  ['manager', 'Owner / Admin — every location, every feature, manages users'],
  ['site_manager', 'Manager — chosen locations and features, publishes without approval'],
  ['editor', 'Staff — chosen locations and features'],
];

/** Invite dialog: emails the invite from PROVIEW SIGNAGE (autoSend), with Copy link as a fallback. */
export function showInviteLink(inv, clientName, { autoSend = false } = {}) {
  const link = inviteLink(inv.token);
  const role = roleLabel(inv.role).toLowerCase();
  const statusEl = h('div', { class: 'notice info', style: { display: 'none' } });
  const setStatus = (text, kind = 'info') => { statusEl.textContent = text; statusEl.className = 'notice' + (kind === 'ok' ? ' ok' : kind === 'bad' ? ' bad' : ' info'); statusEl.style.display = ''; };
  const sendBtn = h('button', { class: 'btn primary', type: 'button' }, icon('send'), autoSend ? 'Send again' : 'Send invite email');
  const send = async () => {
    sendBtn.disabled = true; setStatus(`Sending to ${inv.email}…`);
    try {
      await rpc('send_invite_email', { p_invite: inv.id });
      setStatus(`✓ Invite emailed to ${inv.email}. They just click “Accept invite” in the email.`, 'ok');
      sendBtn.replaceChildren(icon('send'), 'Send again');
    } catch (e) { setStatus(errMsg(e), 'bad'); }
    sendBtn.disabled = false;
  };
  sendBtn.onclick = send;
  modal({ title: 'Invite ready', body: [
    h('p', { class: 'muted', style: { margin: 0 } }, `${inv.email} gets ${role} access to ${clientName}. They sign up with that email address.`),
    statusEl,
    sendBtn,
    h('div', { class: 'tiny', style: { marginTop: '4px' } }, 'Or copy the link and send it yourself (WhatsApp, text, etc.):'),
    h('div', { class: 'copy-box' }, h('input', { type: 'text', value: link, readOnly: true, onclick: (e) => e.target.select() }), h('button', { class: 'btn', onclick: () => copyText(link) }, icon('copy'), 'Copy'))],
  actions: [{ label: 'Done' }] });
  if (autoSend) send();
}

/**
 * Role + sites + features editor. a = { role, site_ids (null = all sites), features }.
 * Returns { el, value() } where value() gives the row fields to save.
 */
const ROLE_CARDS = [
  ['manager', 'Owner / Admin', 'Everything, and manages users'],
  ['site_manager', 'Manager', 'Chosen features, publishes without approval'],
  ['editor', 'Staff', 'Chosen features'],
];
const FEATURE_ICON = { screens: 'screens', schedule: 'calendar', playlists: 'playlists', media: 'media', billing: 'chart' };
const shortLabel = (l) => l.split(' (')[0].replace(' & ', ' and ');

function accessEditor(a, sites) {
  let role = a.role === null ? null : (a.role || 'editor');   // null = nothing picked yet, they must choose
  let all = a.site_ids == null;
  const chosen = new Set(a.site_ids || []);
  const feats = { ...(a.features || {}) };
  const on = (k) => (typeof feats[k] === 'boolean' ? feats[k] : featureDefault(k));
  const group = 'role' + Math.random().toString(36).slice(2, 7);

  // A tile with a label on the left and an on/off switch on the right.
  const tile = (checked, label, onchange, { ic, hint, disabled } = {}) => h('label', { class: 'tog-tile' + (disabled ? ' off' : ''), title: hint || '' },
    ic ? icon(ic) : null, h('span', { class: 'grow' }, label),
    h('input', { type: 'checkbox', class: 'switch', checked, disabled: !!disabled, onchange: (e) => onchange(e.target.checked) }));

  const roleBox = h('div', { class: 'role-cards' }, ROLE_CARDS.map(([val, label, sub]) => h('label', { class: 'role-card' },
    h('input', { type: 'radio', name: group, value: val, checked: val === role, onchange: () => { role = val; paintRole(); } }),
    h('b', {}, label), h('span', { class: 'tiny' }, sub))));

  // Locations only matter when the business has more than one.
  const siteBox = h('div', { class: 'tog-grid' });
  const paintSites = () => siteBox.replaceChildren(
    tile(all, 'All locations', (v) => { all = v; paintSites(); }, { ic: 'clients', hint: 'Includes locations added later' }),
    ...sites.map((s) => tile(all || chosen.has(s.id), s.name, (v) => { v ? chosen.add(s.id) : chosen.delete(s.id); }, { disabled: all })));
  paintSites();

  const featBox = h('div', { class: 'tog-grid' }, FEATURES.map(([k, label]) => tile(on(k), shortLabel(label), (v) => { feats[k] = v; }, { ic: FEATURE_ICON[k], hint: label })));
  const scoped = h('div', { class: 'stack' },
    sites.length > 1 ? h('div', {}, h('div', { class: 'sec-label' }, 'Locations they can use'), siteBox) : null,
    h('div', {}, h('div', { class: 'sec-label' }, 'What they can see and use'), featBox, h('div', { class: 'tiny', style: { marginTop: '6px' } }, 'Anything switched off is hidden and blocked for them.')));
  const fullNote = h('div', { class: 'notice info small' }, 'Owner / Admins see every location and every feature, and can add and edit users.');
  const paintRole = () => { scoped.classList.toggle('hidden', !role || role === 'manager'); fullNote.classList.toggle('hidden', role !== 'manager'); };
  paintRole();

  const el = h('div', { class: 'stack' }, h('div', {}, h('div', { class: 'sec-label' }, req('Role')), roleBox), scoped, fullNote);
  const value = () => {
    if (!role) throw new Error('Choose a role');
    if (role === 'manager') return { role, site_ids: null, features: {} };
    if (!all && !chosen.size && sites.length > 1) throw new Error('Switch on at least one location, or All locations');
    const features = {};
    for (const [k] of FEATURES) features[k] = on(k);
    return { role, site_ids: all || sites.length <= 1 ? null : [...chosen], features };
  };
  return { el, value };
}

function accessSummary(m, sites) {
  if (m.role === 'manager') return 'All locations · all features';
  const siteTxt = m.site_ids == null ? 'All locations' : (m.site_ids.map((id) => sites.find((s) => s.id === id)?.name).filter(Boolean).join(', ') || 'No locations');
  const off = FEATURES.filter(([k]) => !(typeof (m.features || {})[k] === 'boolean' ? m.features[k] : featureDefault(k)));
  return `${siteTxt} · ${off.length ? 'No access to: ' + off.map(([, l]) => l.split(' (')[0]).join(', ') : 'all features'}`;
}

/** Add user: makes a ready-to-use login (no invite email). They sign in with the email and password set here. */
export async function addUserDialog(clientId, clientName, onDone) {
  const sites = await loadSites(clientId).catch(() => []);
  const name = h('input', { type: 'text', placeholder: 'e.g. Sam Taylor', autocomplete: 'off' });
  const email = h('input', { type: 'email', placeholder: 'name@company.com', autocomplete: 'off' });
  const mobile = h('input', { type: 'tel', placeholder: '07…', autocomplete: 'off' });
  const pass = h('input', { type: 'password', placeholder: 'At least 6 characters', autocomplete: 'new-password' });
  const suggest = () => { const a = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const r = crypto.getRandomValues(new Uint32Array(10)); pass.value = [...r].map((n) => a[n % a.length]).join(''); pass.type = 'text'; };
  const acc = accessEditor({ role: null, site_ids: null, features: {} }, sites);
  modal({ title: `Add a user to ${clientName}`, wide: true, body: [
    h('p', { class: 'muted small', style: { margin: 0 } }, 'This makes their login straight away. No email is sent: give them the email and password and they can sign in.'),
    h('div', { class: 'form-2' }, field(req('Name'), name), field('Mobile', mobile), field(req('Email (they sign in with this)'), email),
      field(req('Password'), h('div', { class: 'row', style: { gap: '6px', flexWrap: 'nowrap' } }, h('div', { class: 'grow' }, passwordToggle(pass)), h('button', { class: 'btn sm', type: 'button', onclick: suggest }, 'Suggest')))),
    acc.el],
    actions: [{ label: 'Cancel' }, { label: 'Add user', class: 'primary', onClick: async () => {
      const e = email.value.trim().toLowerCase();
      if (name.value.trim().length < 2) throw new Error('Enter their name');
      if (!/^\S+@\S+\.\S+$/.test(e)) throw new Error('Enter a valid email address');
      if (pass.value.length < 6) throw new Error('The password needs at least 6 characters');
      const a = acc.value();
      const r = await rpc('add_user', { p_client: clientId, p_name: name.value.trim(), p_email: e, p_mobile: mobile.value.trim(), p_password: pass.value, p_role: a.role, p_site_ids: a.site_ids, p_features: a.features });
      const pw = pass.value;
      onDone?.();
      const site = location.origin + location.pathname;
      const details = `PROVIEW SIGNAGE login\n${site}\nEmail: ${e}\nPassword: ${pw}`;
      setTimeout(() => modal({ title: r?.existing ? 'User added' : 'User added: they can sign in now',
        body: r?.existing
          ? h('p', { style: { margin: 0 } }, `${e} already had a PROVIEW SIGNAGE login, so they were added to ${clientName} and keep the password they already use. The password you typed was not applied.`)
          : h('div', { class: 'stack' },
            h('p', { class: 'muted', style: { margin: 0 } }, 'No email was sent. Pass these details on yourself:'),
            h('div', { class: 'notice info login-card' }, h('div', {}, h('span', { class: 'muted' }, 'Sign in at'), h('b', {}, site.replace(/^https?:\/\//, ''))), h('div', {}, h('span', { class: 'muted' }, 'Email'), h('b', {}, e)), h('div', {}, h('span', { class: 'muted' }, 'Password'), h('b', {}, pw))),
            h('button', { class: 'btn', type: 'button', onclick: () => copyText(details) }, icon('copy'), 'Copy login details')),
        actions: [{ label: 'Done', class: 'primary' }] }), 50);
    } }] });
}

export async function inviteDialog(clientId, clientName, onDone) {
  const sites = await loadSites(clientId).catch(() => []);
  const email = h('input', { type: 'email', placeholder: 'name@company.com' });
  const acc = accessEditor({ role: 'editor', site_ids: null, features: {} }, sites);
  modal({ title: `Invite someone to ${clientName}`, wide: true, body: [field(req('Email address'), email), acc.el],
    actions: [{ label: 'Cancel' }, { label: 'Send invite', class: 'primary', onClick: async () => {
      const e = email.value.trim().toLowerCase();
      if (!/^\S+@\S+\.\S+$/.test(e)) throw new Error('Enter a valid email address');
      const inv = await q(sb.from('invites').insert({ client_id: clientId, email: e, ...acc.value() }).select().single());
      onDone?.();
      setTimeout(() => showInviteLink(inv, clientName, { autoSend: true }), 50);
    } }] });
}

function editDialog(m, sites, clientName, onDone) {
  const acc = accessEditor(m, sites);
  const name = h('input', { type: 'text', value: m.full_name || '', placeholder: 'e.g. Sam Taylor' });
  const mobile = h('input', { type: 'tel', value: m.mobile || '', placeholder: '07…' });
  modal({ title: `Edit ${m.full_name || m.email || 'this person'}`, wide: true, body: [
    h('p', { class: 'muted small', style: { margin: 0 } }, `${m.email} · what they can see and do in ${clientName}.`),
    h('div', { class: 'form-2' }, field(req('Name'), name), field('Mobile', mobile)), acc.el],
    actions: [{ label: 'Cancel' }, { label: 'Save', class: 'primary', onClick: async () => {
      const access = acc.value();
      if (name.value.trim() !== (m.full_name || '') || mobile.value.trim() !== (m.mobile || '')) {
        if (name.value.trim().length < 2) throw new Error('Enter their name');
        await rpc('update_user_details', { p_client: state.clientId, p_user: m.user_id, p_name: name.value.trim(), p_mobile: mobile.value.trim() });
      }
      await q(sb.from('client_members').update(access).eq('client_id', state.clientId).eq('user_id', m.user_id));
      toast('User updated');
      onDone?.();
    } }] });
}

// Password help for a user: type a new password for them, or email them a reset link.
function passwordDialog(m) {
  const pass = h('input', { type: 'password', placeholder: 'At least 6 characters', autocomplete: 'new-password' });
  const suggest = () => { const a = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const r = crypto.getRandomValues(new Uint32Array(10)); pass.value = [...r].map((n) => a[n % a.length]).join(''); pass.type = 'text'; };
  const status = h('div', { class: 'notice info', style: { display: 'none' } });
  const say = (text, kind) => { status.textContent = text; status.className = 'notice ' + (kind || 'info'); status.style.display = ''; };
  const setBtn = h('button', { class: 'btn primary', type: 'button', onclick: async () => {
    if (pass.value.length < 6) return say('The password needs at least 6 characters.', 'bad');
    setBtn.disabled = true;
    try {
      await rpc('set_user_password', { p_client: state.clientId, p_user: m.user_id, p_password: pass.value });
      pass.type = 'text';
      say(`✓ Password changed. ${m.email} has been signed out everywhere and can sign in with the new password now. No email was sent, so pass it on yourself.`, 'ok');
    } catch (e) { say(errMsg(e), 'bad'); }
    setBtn.disabled = false;
  } }, 'Set password');
  const linkBtn = h('button', { class: 'btn', type: 'button', onclick: async () => {
    linkBtn.disabled = true;
    try {
      const { error } = await sb.auth.resetPasswordForEmail(m.email, { redirectTo: location.origin + location.pathname });
      if (error) throw error;
      say(`✓ Reset link emailed to ${m.email}. They click it and choose their own new password. Their current password keeps working until they do.`, 'ok');
    } catch (e) { say(errMsg(e), 'bad'); }
    linkBtn.disabled = false;
  } }, icon('send'), 'Email a reset link');
  modal({ title: `Password for ${m.full_name || m.email}`, body: [
    field(req('Type a new password for them'), h('div', { class: 'row', style: { gap: '6px', flexWrap: 'nowrap' } }, h('div', { class: 'grow' }, passwordToggle(pass)), h('button', { class: 'btn sm', type: 'button', onclick: suggest }, 'Suggest'), setBtn)),
    h('div', { class: 'or-line' }, 'or'),
    h('div', { class: 'row between', style: { gap: '10px' } }, h('span', { class: 'small muted grow' }, `Let them choose their own: sends an email to ${m.email}.`), linkBtn),
    state.me.is_admin ? h('button', { class: 'btn ghost sm', type: 'button', style: { alignSelf: 'flex-start' }, onclick: () => resetPassword(m) }, 'Or reset to the temporary password 123456') : null,
    status],
    actions: [{ label: 'Done' }] });
}

// Admin: reset someone's password to the temporary password 123456 (they choose a new one when they sign in).
async function resetPassword(m) {
  if (!(await confirmBox('Reset password?', `${m.email}'s password will be set to the temporary password 123456. They will be signed out everywhere, and must choose a new password when they next sign in. The temporary password stops working after 24 hours.`, 'Reset password', false))) return;
  try {
    await rpc('admin_reset_password', { p_user: m.user_id });
    modal({ title: 'Password reset', body: h('div', { class: 'stack' },
      h('p', { style: { margin: 0 } }, `Tell ${m.email} to sign in with:`),
      h('div', { class: 'notice info', style: { fontSize: '20px', fontWeight: 700, letterSpacing: '.12em', textAlign: 'center' } }, '123456'),
      h('p', { class: 'tiny', style: { margin: 0 } }, 'They will be asked to choose a new password straight away. If they don’t sign in within 24 hours, reset it again.')),
      actions: [{ label: 'Done', class: 'primary' }] });
  } catch (e) { toast(errMsg(e), true); }
}

export async function teamPage({ main }) {
  const client = currentClient();
  const manage = canManage();
  const load = async () => Promise.all([
    rpc('list_team', { p_client: state.clientId }),
    manage ? q(sb.from('invites').select('*').eq('client_id', state.clientId).is('accepted_at', null).order('created_at', { ascending: false })) : [],
    loadSites(state.clientId).catch(() => []),
  ]);
  let [members, invites, sites] = await load();

  const paint = () => {
    main.replaceChildren(
      h('div', { class: 'page-head' },
        headChips(`${members.length} ${members.length === 1 ? 'person' : 'people'}`, members.some((m) => m.active === false) ? `${members.filter((m) => m.active === false).length} deactivated` : null, manage && invites.length ? `${invites.length} invite${invites.length === 1 ? '' : 's'} pending` : null, clientTitle(client)),
        manage ? h('div', { class: 'row', style: { gap: '8px' } },
          h('button', { class: 'btn', title: 'Emails them a link to set up their own login', onclick: () => inviteDialog(state.clientId, clientTitle(client), refresh) }, icon('send'), 'Invite by email'),
          h('button', { class: 'btn primary', title: 'Make their login now, no email sent', onclick: () => addUserDialog(state.clientId, clientTitle(client), refresh) }, icon('plus'), 'Add user')) : null),
      h('div', { class: 'stack' },
        h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, 'Members')),
          h('div', { class: 'list' }, members.length ? members.map((m) => {
            const me = m.user_id === state.me.user_id;
            const active = m.active !== false;
            // Owner / Admins can only be switched off by the Proview master account.
            const canToggle = manage && !me && (state.me.is_admin || m.role !== 'manager');
            const sw = h('input', { type: 'checkbox', class: 'switch status', checked: active, disabled: !canToggle,
              'aria-label': active ? 'Active: switch off to deactivate' : 'Deactivated: switch on to activate',
              onchange: async (e) => {
                const on = e.target.checked;
                if (!on && !(await confirmBox('Deactivate this account?', `${m.full_name || m.email} won’t be able to use ${clientTitle(client)} until you switch them back on. Their role and access are kept.`, 'Deactivate'))) { e.target.checked = true; return; }
                e.target.disabled = true;
                try { await rpc('set_user_active', { p_client: state.clientId, p_user: m.user_id, p_active: on }); toast(on ? 'Account activated' : 'Account deactivated'); }
                catch (err) { toast(errMsg(err), true); }
                refresh();
              } });
            const statusTitle = me ? 'You can’t deactivate your own account' : !canToggle && manage ? 'Only Proview can deactivate an Owner / Admin' : active ? 'Active: switch off to deactivate' : 'Deactivated: switch on to activate';
            return h('div', { class: 'list-row' + (active ? '' : ' user-off') },
              h('div', { class: 'grow' }, h('div', { style: { fontWeight: 600 } }, m.full_name || m.email || 'Unknown', me ? h('span', { class: 'tiny' }, '  (you)') : null),
                m.full_name || m.mobile ? h('div', { class: 'small muted' }, [m.full_name && m.email, m.mobile].filter(Boolean).join(' · ')) : null,
                h('div', { class: 'tiny' }, accessSummary(m, sites) + ' · joined ' + timeAgo(m.created_at))),
              h('span', { class: 'badge plain' }, roleLabel(m.role)),
              manage ? h('label', { class: 'status-tog' + (active ? ' on' : ' off'), title: statusTitle }, sw, h('span', {}, active ? 'Active' : 'Deactivated')) : null,
              manage && !me && active ? h('button', { class: 'btn sm', onclick: () => editDialog(m, sites, clientTitle(client), refresh) }, icon('edit'), 'Edit') : null,
              manage && !me && active ? h('button', { class: 'btn sm', title: 'Type a new password or email a reset link', onclick: () => passwordDialog(m) }, 'Password') : null,
              manage && !me && (active || canToggle) ? h('button', { class: 'btn sm danger', onclick: async () => {
                if (!(await confirmBox('Remove user?', `${m.email} will lose access to ${clientTitle(client)}.`, 'Remove'))) return;
                try {
                  if (active) await q(sb.from('client_members').delete().eq('client_id', state.clientId).eq('user_id', m.user_id));
                  else await rpc('remove_deactivated_user', { p_client: state.clientId, p_user: m.user_id });
                } catch (err) { toast(errMsg(err), true); }
                refresh();
              } }, 'Remove') : null);
          })
            : h('div', { class: 'list-row muted small' }, state.me.is_admin ? 'No users yet. Add the business’s staff so they can manage their own screens.' : 'No members.'))),
        manage ? h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, 'Pending invites')),
          h('div', { class: 'list' }, invites.length ? invites.map((i) => h('div', { class: 'list-row' },
            h('div', { class: 'grow' }, h('div', { style: { fontWeight: 600 } }, i.email), h('div', { class: 'tiny' }, `${roleLabel(i.role)} · ${accessSummary(i, sites)} · created ${timeAgo(i.created_at)}`)),
            h('button', { class: 'btn sm', onclick: () => showInviteLink(i, clientTitle(client)) }, icon('send'), 'Resend'),
            h('button', { class: 'btn sm danger', onclick: async () => { await q(sb.from('invites').delete().eq('id', i.id)); refresh(); } }, 'Revoke')))
            : h('div', { class: 'list-row muted small' }, 'No pending invites.'))) : null,
        h('div', { class: 'notice info' }, 'Owners / Admins see every location and feature. Managers and Staff only see the locations and features you tick. Nobody can change their own access.')));
  };
  const refresh = async () => { [members, invites, sites] = await load(); paint(); };
  paint();
}
