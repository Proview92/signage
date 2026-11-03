import { sb, state, h, icon, q, rpc, toast, modal, field, select, confirmBox, timeAgo, isOnline, refreshMe, setClient } from '../core.js';
import { pairDialog } from './screens.js';
import { showInviteLink } from './team.js';
import { licenseBadge, licenseDialog } from './license-ui.js';
import { licenseState, licenseSummary } from '../license.js';

export async function clientsPage({ main, go, rerender }) {
  const [clients, screens, members] = await Promise.all([
    q(sb.from('clients').select('*').order('name')),
    q(sb.from('screens').select('id,name,location,client_id,last_seen,claimed,published_at,license_type,license_starts_at,license_expires_at,license_notes').eq('claimed', true).order('name')),
    q(sb.from('client_members').select('client_id,user_id')),
  ]);
  const byClient = (id) => screens.filter((s) => s.client_id === id);
  const unassigned = screens.filter((s) => !s.client_id);
  const cname = Object.fromEntries(clients.map((c) => [c.id, c.name]));

  const open = (c) => { setClient(c.id); go('screens'); };

  function clientDialog(c) {
    const name = h('input', { type: 'text', value: c?.name || '', placeholder: 'e.g. Bella Pizza Ltd' });
    const notes = h('textarea', { rows: 2, value: c?.notes || '', placeholder: 'Contact, address, contract…' });
    const mgr = h('input', { type: 'email', placeholder: 'owner@client.com (optional)' });
    modal({ title: c ? 'Edit client' : 'New client', body: [field('Client name', name), field('Notes (only admins see this)', notes),
      c ? null : field('Invite a manager', mgr, 'They’ll get a sign-up link to manage this client’s TVs.')],
    actions: [
      c ? { label: 'Delete client', class: 'danger', onClick: async () => {
        if (!(await confirmBox('Delete client?', `This permanently deletes ${c.name}'s playlists, media records and schedules. Their TVs become unassigned.`))) return false;
        const { data: files } = await sb.storage.from('media').list(c.id, { limit: 1000 });
        if (files?.length) await sb.storage.from('media').remove(files.map((f) => `${c.id}/${f.name}`));
        await q(sb.from('clients').delete().eq('id', c.id));
        await refreshMe(); rerender();
      } } : null,
      { label: 'Cancel' },
      { label: c ? 'Save' : 'Create client', class: 'primary', onClick: async () => {
        if (!name.value.trim()) throw new Error('Enter a name');
        if (c) { await q(sb.from('clients').update({ name: name.value.trim(), notes: notes.value || null }).eq('id', c.id)); }
        else {
          const nc = await q(sb.from('clients').insert({ name: name.value.trim(), notes: notes.value || null }).select().single());
          const e = mgr.value.trim().toLowerCase();
          if (e) {
            const inv = await q(sb.from('invites').insert({ client_id: nc.id, email: e, role: 'manager' }).select().single());
            setTimeout(() => showInviteLink(inv, nc.name), 80);
          }
          toast(`${nc.name} created`);
        }
        await refreshMe(); rerender();
      } }].filter(Boolean) });
  }

  const head = h('div', { class: 'page-head' },
    h('div', {}, h('h1', {}, 'Clients & TVs'), h('p', { class: 'muted' }, `${clients.length} clients · ${screens.length} TVs · ${screens.filter((s) => ['active','expiring','lifetime'].includes(licenseState(s).state) && s.license_type !== 'trial7').length} paid · ${screens.filter((s) => s.license_type === 'trial7').length} on trial`)),
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => pairDialog({ clients, onDone: async () => { await refreshMe(); rerender(); } }) }, icon('tv'), 'Pair a TV'),
      h('button', { class: 'btn primary', onclick: () => clientDialog() }, icon('plus'), 'New client')));

  const unassignedCard = unassigned.length ? h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, 'TVs waiting for a client'), h('span', { class: 'badge warn' }, unassigned.length)),
    h('div', { class: 'list' }, unassigned.map((s) => {
      let target = clients[0]?.id;
      return h('div', { class: 'list-row' },
        h('div', { class: 'grow' }, h('div', { style: { fontWeight: 600 } }, s.name), h('div', { class: 'tiny' }, isOnline(s) ? 'Online' : 'Last seen ' + timeAgo(s.last_seen))),
        clients.length ? select(clients.map((c) => [c.id, c.name]), target, (v) => (target = v)) : h('span', { class: 'tiny' }, 'Create a client first'),
        clients.length ? h('button', { class: 'btn sm primary', onclick: async () => { await rpc('assign_screen', { p_screen: s.id, p_client: target }); toast('Assigned'); rerender(); } }, 'Assign') : null,
        h('button', { class: 'btn sm danger', onclick: async () => { await rpc('unpair_screen', { p_screen: s.id }); rerender(); } }, 'Unpair'));
    }))) : null;

  const clientsCard = clients.length ? h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Clients')),
    h('div', { class: 'list' }, clients.map((c) => {
      const scr = byClient(c.id);
      const on = scr.filter(isOnline).length;
      const users = members.filter((m) => m.client_id === c.id).length;
      return h('div', { class: 'list-row' },
        h('div', { class: 'grow' }, h('div', { style: { fontWeight: 650 } }, c.name), h('div', { class: 'tiny' }, `${scr.length} TV${scr.length === 1 ? '' : 's'} · ${users} user${users === 1 ? '' : 's'}${c.notes ? ' · ' + c.notes.slice(0, 60) : ''}`)),
        scr.length ? h('span', { class: 'badge ' + (on === scr.length ? 'ok' : on ? 'warn' : 'bad') }, `${on}/${scr.length} online`) : null,
        h('button', { class: 'btn sm ghost icon', title: 'Edit', onclick: () => clientDialog(c) }, icon('edit')),
        h('button', { class: 'btn sm', onclick: () => open(c) }, 'Open'));
    }))) : h('div', { class: 'card empty' }, h('h2', {}, 'Add your first client'),
      h('p', {}, 'Each client gets their own TVs, media library, playlists and schedules — and their own logins.'),
      h('button', { class: 'btn primary', onclick: () => clientDialog() }, icon('plus'), 'New client'));

  const needs = screens
    .map((s) => ({ s, L: licenseState(s) }))
    .filter(({ L }) => ['none', 'expiring', 'grace', 'expired'].includes(L.state))
    .sort((a, b) => (a.L.expires ?? 0) - (b.L.expires ?? 0));
  const attention = needs.length ? h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, 'Licences needing attention'), h('span', { class: 'badge warn' }, needs.length)),
    h('div', { class: 'list' }, needs.map(({ s }) => h('div', { class: 'list-row' },
      h('div', { class: 'grow' }, h('div', { style: { fontWeight: 600 } }, s.name), h('div', { class: 'tiny' }, cname[s.client_id] || 'Unassigned')),
      licenseBadge(s),
      h('button', { class: 'btn sm primary', onclick: () => licenseDialog(s, () => rerender()) }, 'Renew…'))))) : null;

  const allTvs = screens.length ? h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, 'All TVs')),
    h('div', { class: 'list' }, screens.map((s) => h('div', { class: 'list-row' },
      h('span', { class: 'badge ' + (isOnline(s) ? 'ok' : 'bad') }, isOnline(s) ? 'Online' : 'Offline'),
      h('div', { class: 'grow' }, h('div', { style: { fontWeight: 600 } }, s.name), h('div', { class: 'tiny' }, [cname[s.client_id] || 'Unassigned', s.location].filter(Boolean).join(' · '))),
      licenseBadge(s),
      h('button', { class: 'btn sm', onclick: () => licenseDialog(s, () => rerender()) }, 'Licence'),
      s.client_id ? h('button', { class: 'btn sm', onclick: () => { setClient(s.client_id); go('screen/' + s.id); } }, 'Manage') : null)))) : null;

  main.replaceChildren(head, h('div', { class: 'stack' }, attention, unassignedCard, clientsCard, allTvs));
}
