// Users: Owner / Admin (and the Proview admin) invite people, set their role, pick their sites,
// switch features on or off, and remove them. The database enforces all of this (migration 030).
import { clientTitle } from '../core.js';
import { sb, state, h, icon, q, rpc, toast, modal, field, select, confirmBox, copyText, timeAgo, canManage, currentClient, errMsg, FEATURES, featureDefault, roleLabel } from '../core.js';
import { loadSites } from './sites-ui.js';

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
function accessEditor(a, sites) {
  let role = a.role || 'editor';
  let all = a.site_ids == null;
  const chosen = new Set(a.site_ids || []);
  const feats = { ...(a.features || {}) };
  const on = (k) => (typeof feats[k] === 'boolean' ? feats[k] : featureDefault(k));

  const checkRow = (checked, label, onchange, extra = {}) => h('label', { class: 'row small', style: { gap: '8px', alignItems: 'center', padding: '3px 0', cursor: 'pointer' } },
    h('input', { type: 'checkbox', checked, onchange: (e) => onchange(e.target.checked), ...extra }), h('span', {}, label));

  const siteBox = h('div', {});
  const paintSites = () => siteBox.replaceChildren(
    checkRow(all, 'All locations (including locations added later)', (v) => { all = v; paintSites(); }),
    sites.length
      ? h('div', { style: { paddingLeft: '22px', opacity: all ? 0.5 : 1 } }, sites.map((s) => checkRow(all || chosen.has(s.id), s.name, (v) => { v ? chosen.add(s.id) : chosen.delete(s.id); }, { disabled: all })))
      : h('div', { class: 'tiny' }, 'This business has no locations yet. Add them on the Screens page (Locations button).'));
  paintSites();

  const featBox = h('div', {}, FEATURES.map(([k, label]) => checkRow(on(k), label, (v) => { feats[k] = v; })));
  const scoped = h('div', { class: 'stack' },
    field('Locations they can use', siteBox),
    field('What they can use', featBox, 'Everything not ticked is hidden and blocked for them.'));
  const paintRole = () => scoped.classList.toggle('hidden', role === 'manager');
  paintRole();

  const el = h('div', { class: 'stack' },
    field('Role', select(ROLE_OPTIONS, role, (v) => { role = v; paintRole(); })),
    scoped);
  const value = () => {
    if (role === 'manager') return { role, site_ids: null, features: {} };
    if (!all && !chosen.size && sites.length) throw new Error('Pick at least one location, or tick All locations');
    const features = {};
    for (const [k] of FEATURES) features[k] = on(k);
    return { role, site_ids: all ? null : [...chosen], features };
  };
  return { el, value };
}

function accessSummary(m, sites) {
  if (m.role === 'manager') return 'All locations · all features';
  const siteTxt = m.site_ids == null ? 'All locations' : (m.site_ids.map((id) => sites.find((s) => s.id === id)?.name).filter(Boolean).join(', ') || 'No locations');
  const off = FEATURES.filter(([k]) => !(typeof (m.features || {})[k] === 'boolean' ? m.features[k] : featureDefault(k)));
  return `${siteTxt} · ${off.length ? 'No access to: ' + off.map(([, l]) => l.split(' (')[0]).join(', ') : 'all features'}`;
}

export async function inviteDialog(clientId, clientName, onDone) {
  const sites = await loadSites(clientId).catch(() => []);
  const email = h('input', { type: 'email', placeholder: 'name@company.com' });
  const acc = accessEditor({ role: 'editor', site_ids: null, features: {} }, sites);
  modal({ title: `Invite someone to ${clientName}`, wide: true, body: [field('Email address', email), acc.el],
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
  modal({ title: `Access for ${m.email || 'this person'}`, wide: true, body: [h('p', { class: 'muted', style: { margin: 0 } }, `What ${m.email} can see and do in ${clientName}.`), acc.el],
    actions: [{ label: 'Cancel' }, { label: 'Save', class: 'primary', onClick: async () => {
      await q(sb.from('client_members').update(acc.value()).eq('client_id', state.clientId).eq('user_id', m.user_id));
      toast('Access updated');
      onDone?.();
    } }] });
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
        h('div', {}, h('h1', {}, 'Users'), h('p', { class: 'muted' }, `People who can manage ${clientTitle(client)}'s screens, which locations they see and what they can use.`)),
        manage ? h('button', { class: 'btn primary', onclick: () => inviteDialog(state.clientId, clientTitle(client), refresh) }, icon('plus'), 'Invite someone') : null),
      h('div', { class: 'stack' },
        h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, 'Members')),
          h('div', { class: 'list' }, members.length ? members.map((m) => {
            const me = m.user_id === state.me.user_id;
            return h('div', { class: 'list-row' },
              h('div', { class: 'grow' }, h('div', { style: { fontWeight: 600 } }, m.email || 'Unknown', me ? h('span', { class: 'tiny' }, '  (you)') : null),
                h('div', { class: 'tiny' }, accessSummary(m, sites) + ' · joined ' + timeAgo(m.created_at))),
              h('span', { class: 'badge plain' }, roleLabel(m.role)),
              manage && !me ? h('button', { class: 'btn sm', onclick: () => editDialog(m, sites, clientTitle(client), refresh) }, icon('edit'), 'Edit access') : null,
              state.me.is_admin && !me ? h('button', { class: 'btn sm', title: 'Reset to the temporary password 123456', onclick: () => resetPassword(m) }, 'Reset password') : null,
              manage && !me ? h('button', { class: 'btn sm danger', onclick: async () => {
                if (!(await confirmBox('Remove user?', `${m.email} will lose access to ${clientTitle(client)}.`, 'Remove'))) return;
                await q(sb.from('client_members').delete().eq('client_id', state.clientId).eq('user_id', m.user_id));
                refresh();
              } }, 'Remove') : null);
          })
            : h('div', { class: 'list-row muted small' }, state.me.is_admin ? 'No users yet. Invite the business’s staff so they can manage their own screens.' : 'No members.'))),
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
