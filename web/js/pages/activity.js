// Activity log + publish approvals for the selected client.
import { sb, state, h, icon, q, rpc, toast, modal, field, timeAgo, canManage, currentClient, clientTitle, refreshMe } from '../core.js';

const ACTION_ICON = { created: '＋', updated: '✎', deleted: '🗑', published: '➤', approved: '✓', rejected: '✕', 'licence changed': '🔑' };

export async function activityPage({ main, rerender }) {
  const client = currentClient();
  const manage = canManage();
  let tab = new URLSearchParams(location.hash.split('?')[1] || '').get('tab') || (manage ? 'approvals' : 'activity');
  let rows = [], reqs = [], who = '', what = '';

  const load = async () => {
    [rows, reqs] = await Promise.all([
      q(sb.from('activity').select('*').eq('client_id', state.clientId).order('at', { ascending: false }).limit(300)),
      q(sb.from('approval_requests').select('*').eq('client_id', state.clientId).order('requested_at', { ascending: false }).limit(100)),
    ]);
  };
  await load();

  const decide = (r, approve) => {
    const note = h('textarea', { rows: 2, placeholder: approve ? 'Optional note' : 'Reason (shown to the editor)' });
    modal({ title: `${approve ? 'Approve' : 'Reject'}: ${r.target_name || r.kind}`, body: [
      h('p', { class: 'muted small', style: { margin: 0 } }, approve
        ? `This publishes the current ${r.kind === 'screen' ? 'schedule and playlists for this TV' : 'version of this playlist to every TV that uses it'}.`
        : 'Nothing is published. The editor sees your reason.'), field('Note', note)],
    actions: [{ label: 'Cancel' }, { label: approve ? 'Approve & publish' : 'Reject', class: approve ? 'primary' : 'danger', onClick: async () => {
      const n = await rpc('decide_approval', { p_request: r.id, p_approve: approve, p_note: note.value || null });
      toast(approve ? `Approved: published to ${n} TV${n === 1 ? '' : 's'}` : 'Rejected');
      await load(); paint();
    } }] });
  };

  const approvalToggle = () => {
    const on = !!client.require_approval;
    return h('label', { class: 'row small', style: { fontWeight: 600 } },
      h('input', { type: 'checkbox', checked: on, disabled: !manage, onchange: async (e) => {
        try { await rpc('set_require_approval', { p_client: state.clientId, p_on: e.target.checked }); await refreshMe(); toast(e.target.checked ? 'Editors’ changes now need approval' : 'Approval switched off'); rerender(); }
        catch (err) { toast(err.message, true); e.target.checked = on; }
      } }), 'Editors need a manager’s approval to publish');
  };

  const paint = () => {
    const pending = reqs.filter((r) => r.status === 'pending');
    const tabs = h('div', { class: 'seg' },
      [['approvals', `Approvals${pending.length ? ` (${pending.length})` : ''}`], ['activity', 'Activity log']].map(([k, l]) =>
        h('button', { class: tab === k ? 'on' : '', onclick: () => { tab = k; paint(); } }, l)));

    let body;
    if (tab === 'approvals') {
      body = h('div', { class: 'stack' },
        h('div', { class: 'card pad stack' }, approvalToggle(),
          h('div', { class: 'tiny' }, client.require_approval
            ? 'Editors can still edit playlists and schedules. When they press Publish, managers get a request here.'
            : 'Off: anyone in the team can publish straight to the TVs.')),
        h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', {}, 'Requests')),
          h('div', { class: 'list' }, reqs.length ? reqs.map((r) => h('div', { class: 'list-row' },
            h('span', { class: 'badge ' + (r.status === 'pending' ? 'warn' : r.status === 'approved' ? 'ok' : 'bad') }, r.status),
            h('div', { class: 'grow' },
              h('div', { style: { fontWeight: 600 } }, `${r.kind === 'screen' ? 'TV' : 'Playlist'}: ${r.target_name || '—'}`),
              h('div', { class: 'tiny' }, `Requested by ${r.requested_email || '?'} · ${timeAgo(r.requested_at)}${r.decided_at ? ` · ${r.status} ${timeAgo(r.decided_at)}` : ''}${r.decision_note ? ` · “${r.decision_note}”` : ''}`)),
            r.status === 'pending' && manage ? h('div', { class: 'row', style: { gap: '6px' } },
              h('button', { class: 'btn sm', onclick: () => r.kind === 'screen' ? (location.hash = '#/screen/' + r.target_id) : (location.hash = '#/playlist/' + r.target_id) }, 'View'),
              h('button', { class: 'btn sm danger', onclick: () => decide(r, false) }, 'Reject'),
              h('button', { class: 'btn sm primary', onclick: () => decide(r, true) }, 'Approve')) : null))
            : h('div', { class: 'list-row muted small' }, 'No publish requests yet.'))));
    } else {
      const people = [...new Set(rows.map((r) => r.email).filter(Boolean))];
      const shown = rows.filter((r) => (!who || r.email === who) && (!what || r.entity === what));
      body = h('div', { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', {}, 'Recent changes'),
          h('div', { class: 'row' },
            h('select', { style: { width: 'auto' }, onchange: (e) => { who = e.target.value; paint(); } }, h('option', { value: '' }, 'Everyone'), people.map((p) => h('option', { value: p, selected: p === who }, p))),
            h('select', { style: { width: 'auto' }, onchange: (e) => { what = e.target.value; paint(); } }, h('option', { value: '' }, 'Everything'),
              [...new Set(rows.map((r) => r.entity))].map((e) => h('option', { value: e, selected: e === what }, e))))),
        h('div', { class: 'list' }, shown.length ? shown.map((r) => h('div', { class: 'list-row' },
          h('div', { style: { width: '28px', textAlign: 'center', fontSize: '16px' } }, ACTION_ICON[r.action] || '•'),
          h('div', { class: 'grow' },
            h('div', {}, h('b', {}, r.email || 'Someone'), ` ${r.action} ${r.entity} `, r.entity_name ? h('b', {}, r.entity_name) : ''),
            r.details ? h('div', { class: 'tiny' }, r.details) : null),
          h('span', { class: 'tiny', title: new Date(r.at).toLocaleString() }, timeAgo(r.at))))
          : h('div', { class: 'list-row muted small' }, 'Nothing yet.')));
    }
    main.replaceChildren(
      h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Activity'), h('p', { class: 'muted' }, `Who changed what for ${clientTitle(client)}.`)), tabs),
      body);
  };
  paint();
}
