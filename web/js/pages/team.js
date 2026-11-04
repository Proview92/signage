import { clientTitle } from '../core.js';
import { sb, state, h, icon, q, rpc, toast, modal, field, select, confirmBox, copyText, timeAgo, canManage, currentClient, refreshMe, errMsg } from '../core.js';

export const inviteLink = (token) => `${location.origin}${location.pathname}#/join/${token}`;

/** Invite dialog: emails the invite from PROVIEW SIGNAGE (autoSend), with Copy link as a fallback. */
export function showInviteLink(inv, clientName, { autoSend = false } = {}) {
  const link = inviteLink(inv.token);
  const role = inv.role === 'manager' ? 'manager' : 'editor';
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

export function inviteDialog(clientId, clientName, onDone) {
  const email = h('input', { type: 'email', placeholder: 'name@company.com' });
  let role = 'editor';
  modal({ title: `Invite someone to ${clientName}`, body: [
    field('Email address', email),
    field('Access', select([['editor', 'Editor — media, playlists & schedules'], ['manager', 'Manager — also add TVs and invite people']], role, (v) => (role = v)))],
  actions: [{ label: 'Cancel' }, { label: 'Send invite', class: 'primary', onClick: async () => {
    const e = email.value.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(e)) throw new Error('Enter a valid email address');
    const inv = await q(sb.from('invites').insert({ client_id: clientId, email: e, role }).select().single());
    onDone?.();
    setTimeout(() => showInviteLink(inv, clientName, { autoSend: true }), 50);
  } }] });
}

const roleLabel = { manager: 'Manager', editor: 'Editor' };

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

export async function teamPage({ main, rerender }) {
  const client = currentClient();
  const manage = canManage();
  const load = async () => Promise.all([
    rpc('list_members', { p_client: state.clientId }),
    manage ? q(sb.from('invites').select('*').eq('client_id', state.clientId).is('accepted_at', null).order('created_at', { ascending: false })) : [],
  ]);
  let [members, invites] = await load();

  const paint = () => {
    main.replaceChildren(
      h('div', { class: 'page-head' },
        h('div', {}, h('h1', {}, 'Team'), h('p', { class: 'muted' }, `People who can manage ${clientTitle(client)}'s screens.`)),
        manage ? h('button', { class: 'btn primary', onclick: () => inviteDialog(state.clientId, clientTitle(client), refresh) }, icon('plus'), 'Invite someone') : null),
      h('div', { class: 'stack' },
        h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, 'Members')),
          h('div', { class: 'list' }, members.length ? members.map((m) => h('div', { class: 'list-row' },
            h('div', { class: 'grow' }, h('div', { style: { fontWeight: 600 } }, m.email || 'Unknown', m.user_id === state.me.user_id ? h('span', { class: 'tiny' }, '  (you)') : null),
              h('div', { class: 'tiny' }, 'Joined ' + timeAgo(m.created_at))),
            manage && m.user_id !== state.me.user_id
              ? select([['editor', 'Editor'], ['manager', 'Manager']], m.role, async (v) => { await q(sb.from('client_members').update({ role: v }).eq('client_id', state.clientId).eq('user_id', m.user_id)); toast('Role updated'); })
              : h('span', { class: 'badge plain' }, roleLabel[m.role]),
            state.me.is_admin && m.user_id !== state.me.user_id ? h('button', { class: 'btn sm', title: 'Reset to the temporary password 123456', onclick: () => resetPassword(m) }, 'Reset password') : null,
            manage && m.user_id !== state.me.user_id ? h('button', { class: 'btn sm danger', onclick: async () => {
              if (!(await confirmBox('Remove member?', `${m.email} will lose access to ${clientTitle(client)}.`, 'Remove'))) return;
              await q(sb.from('client_members').delete().eq('client_id', state.clientId).eq('user_id', m.user_id));
              refresh();
            } }, 'Remove') : null))
            : h('div', { class: 'list-row muted small' }, state.me.is_admin ? 'No client users yet. Invite the client’s staff so they can manage their own screens.' : 'No members.'))),
        manage ? h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, 'Pending invites')),
          h('div', { class: 'list' }, invites.length ? invites.map((i) => h('div', { class: 'list-row' },
            h('div', { class: 'grow' }, h('div', { style: { fontWeight: 600 } }, i.email), h('div', { class: 'tiny' }, `${roleLabel[i.role]} · created ${timeAgo(i.created_at)}`)),
            h('button', { class: 'btn sm', onclick: () => showInviteLink(i, clientTitle(client)) }, icon('send'), 'Resend'),
            h('button', { class: 'btn sm danger', onclick: async () => { await q(sb.from('invites').delete().eq('id', i.id)); refresh(); } }, 'Revoke')))
            : h('div', { class: 'list-row muted small' }, 'No pending invites.'))) : null,
        !manage ? h('div', { class: 'notice info' }, 'Ask a manager if you need to add people or TVs.') : null));
  };
  const refresh = async () => { [members, invites] = await load(); paint(); };
  paint();
}
