import { clientLabel, clientTitle, sortClients } from '../core.js';
import { sb, state, h, icon, q, rpc, toast, modal, field, select, confirmBox, timeAgo, isOnline, refreshMe, setClient } from '../core.js';
import { pairDialog } from './screens.js';
import { showInviteLink } from './team.js';
import { licenseBadge, licenseDialog } from './license-ui.js';
import { licenseState, licenseSummary } from '../license.js';
import { manageSitesDialog } from './sites-ui.js';
import { integrationsCards } from './integrations.js';
import { emergencyDialog, overridesBanner } from './emergency.js';
import { fmtBytes } from '../core.js';

export async function clientsPage({ main, go, rerender }) {
  let [clients, screens, members, sites] = await Promise.all([
    q(sb.from('clients').select('*').order('name')),
    q(sb.from('screens').select('id,name,location,client_id,last_seen,claimed,published_at,license_type,license_starts_at,license_expires_at,license_notes,trial_blocked_reason,hardware_id,site_id').eq('claimed', true).order('name')),
    q(sb.from('client_members').select('client_id,user_id')),
    q(sb.from('sites').select('id,client_id,name')),
  ]);
  const media = (await sb.from('media').select('client_id,size_bytes')).data || [];
  const usage = (cid) => media.filter((m) => m.client_id === cid).reduce((t, m) => t + (Number(m.size_bytes) || 0), 0);
  const sname = Object.fromEntries(sites.map((x) => [x.id, x.name]));
  const tvSettings = (await sb.from('app_settings').select('pin_is_default,return_minutes,updated_at').eq('id', 1).maybeSingle()).data
    || { pin_is_default: true, return_minutes: 5 };
  clients = sortClients(clients);
  const byClient = (id) => screens.filter((s) => s.client_id === id);
  const unassigned = screens.filter((s) => !s.client_id);
  const cname = Object.fromEntries(clients.map((c) => [c.id, clientTitle(c)]));

  const open = (c) => { setClient(c.id); go('screens'); };

  function clientDialog(c) {
    const name = h('input', { type: 'text', value: c?.name || '', placeholder: 'e.g. Bella Pizza' });
    const email = h('input', { type: 'email', value: c?.contact_email || '', placeholder: 'owner@client.com' });
    const siteList = h('textarea', { rows: 3, placeholder: 'One per line, e.g.\nHigh Street\nStation Road' });
    const notes = h('textarea', { rows: 2, value: c?.notes || '', placeholder: 'Contact, address, contract…' });
    const sendInvite = h('input', { type: 'checkbox', checked: true });
    modal({ title: c ? 'Edit client' : 'New client', body: [
      field('Client name', name, 'Shown in client lists and dropdowns.'),
      field('Contact email', email),
      c ? h('div', { class: 'row between small' }, h('span', { class: 'muted' }, `${sites.filter((x) => x.client_id === c.id).length} site(s)`),
            h('button', { class: 'btn sm', type: 'button', onclick: () => manageSitesDialog(c.id, c.name, rerender) }, 'Manage sites…'))
        : field('Sites', siteList, 'The client’s locations. You can add more later.'),
      field('Notes (only admins see this)', notes),
      c ? null : h('label', { class: 'row small', style: { fontWeight: 600 } }, sendInvite, 'Create a manager invite for the contact email')],
    actions: [
      c ? { label: 'Delete client', class: 'danger', onClick: async () => {
        if (!(await confirmBox('Delete client?', `This permanently deletes ${clientTitle(c)}'s sites, playlists, media records and schedules. Their TVs become unassigned.`))) return false;
        const { data: files } = await sb.storage.from('media').list(c.id, { limit: 1000 });
        if (files?.length) await sb.storage.from('media').remove(files.map((f) => `${c.id}/${f.name}`));
        await q(sb.from('clients').delete().eq('id', c.id));
        await refreshMe(); rerender();
      } } : null,
      { label: 'Cancel' },
      { label: c ? 'Save' : 'Create client', class: 'primary', onClick: async () => {
        const nameV = name.value.trim(), emailV = email.value.trim().toLowerCase();
        if (!nameV) throw new Error('Enter the client name');
        if (emailV && !/^\S+@\S+\.\S+$/.test(emailV)) throw new Error('Enter a valid email address');
        const row = { name: nameV, contact_email: emailV || null, notes: notes.value || null };
        if (c) { await q(sb.from('clients').update(row).eq('id', c.id)); }
        else {
          const nc = await q(sb.from('clients').insert(row).select().single());
          const names = [...new Set(siteList.value.split('\n').map((x) => x.trim()).filter(Boolean))];
          if (names.length) await q(sb.from('sites').insert(names.map((n) => ({ client_id: nc.id, name: n }))));
          const e = sendInvite.checked ? emailV : '';
          if (e) {
            const inv = await q(sb.from('invites').insert({ client_id: nc.id, email: e, role: 'manager' }).select().single());
            setTimeout(() => showInviteLink(inv, clientTitle(nc)), 80);
          }
          toast(`${clientTitle(nc)} created`);
        }
        await refreshMe(); rerender();
      } }].filter(Boolean) });
  }

  const head = h('div', { class: 'page-head' },
    h('div', {}, h('h1', {}, 'Clients & TVs'), h('p', { class: 'muted' }, `${clients.length} clients · ${screens.length} TVs · ${screens.filter((s) => ['active','expiring','lifetime'].includes(licenseState(s).state) && s.license_type !== 'trial7').length} paid · ${screens.filter((s) => s.license_type === 'trial7').length} on trial`)),
    h('div', { class: 'row' },
      h('button', { class: 'btn danger', onclick: () => emergencyDialog({ onDone: rerender }) }, 'Emergency message'),
      h('button', { class: 'btn', onclick: () => pairDialog({ clients, onDone: async () => { await refreshMe(); rerender(); } }) }, icon('tv'), 'Pair a TV'),
      h('button', { class: 'btn primary', onclick: () => clientDialog() }, icon('plus'), 'New client')));

  const unassignedCard = unassigned.length ? h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, 'TVs waiting for a client'), h('span', { class: 'badge warn' }, unassigned.length)),
    h('div', { class: 'list' }, unassigned.map((s) => {
      let target = clients[0]?.id;
      return h('div', { class: 'list-row' },
        h('div', { class: 'grow' }, h('div', { style: { fontWeight: 600 } }, s.name), h('div', { class: 'tiny' }, isOnline(s) ? 'Online' : 'Last seen ' + timeAgo(s.last_seen))),
        clients.length ? select(clients.map((c) => [c.id, clientLabel(c)]), target, (v) => (target = v)) : h('span', { class: 'tiny' }, 'Create a client first'),
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
        h('div', { class: 'grow' }, h('div', { style: { fontWeight: 650 } }, clientTitle(c)),
          h('div', { class: 'tiny' }, [c.contact_email && c.contact_email !== clientTitle(c) ? c.contact_email : null, (() => { const n = sites.filter((x) => x.client_id === c.id).length; return `${n} site${n === 1 ? '' : 's'}`; })(), `${scr.length} TV${scr.length === 1 ? '' : 's'}`, `${users} user${users === 1 ? '' : 's'}`, usage(c.id) ? fmtBytes(usage(c.id)) + ' media' : null, c.notes ? c.notes.slice(0, 60) : null].filter(Boolean).join(' · '))),
        scr.length ? h('span', { class: 'badge ' + (on === scr.length ? 'ok' : on ? 'warn' : 'bad') }, `${on}/${scr.length} online`) : null,
        h('button', { class: 'btn sm', onclick: () => manageSitesDialog(c.id, c.name, rerender) }, 'Sites'),
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
      h('div', { class: 'grow' }, h('div', { style: { fontWeight: 600 } }, s.name), h('div', { class: 'tiny' }, [cname[s.client_id] || 'Unassigned', sname[s.site_id]].filter(Boolean).join(' · '))),
      licenseBadge(s),
      h('button', { class: 'btn sm primary', onclick: () => licenseDialog(s, () => rerender()) }, 'Renew…'))))) : null;

  const allTvs = screens.length ? h('div', { class: 'card' },
    h('div', { class: 'card-head' }, h('h2', {}, 'All TVs')),
    h('div', { class: 'list' }, screens.map((s) => h('div', { class: 'list-row' },
      h('span', { class: 'badge ' + (isOnline(s) ? 'ok' : 'bad') }, isOnline(s) ? 'Online' : 'Offline'),
      h('div', { class: 'grow' }, h('div', { style: { fontWeight: 600 } }, s.name), h('div', { class: 'tiny' }, [cname[s.client_id] || 'Unassigned', sname[s.site_id], s.location].filter(Boolean).join(' · '))),
      licenseBadge(s),
      h('button', { class: 'btn sm', onclick: () => licenseDialog(s, () => rerender()) }, 'Licence'),
      s.client_id ? h('button', { class: 'btn sm', onclick: () => { setClient(s.client_id); go('screen/' + s.id); } }, 'Manage') : null)))) : null;

  const remoteCard = h('div', { class: 'card' },
    h('div', { class: 'card-head' },
      h('div', {}, h('h2', {}, 'TV remote'),
        h('div', { class: 'tiny' }, 'Pressing Back on a TV remote opens the screen menu: reload, status, exit to the TV home screen, player address.')),
      h('label', { class: 'row small', style: { fontWeight: 600 } }, 'Reopen player after',
        select([['0', 'Never'], ['2', '2 minutes'], ['5', '5 minutes'], ['10', '10 minutes'], ['15', '15 minutes'], ['30', '30 minutes'], ['60', '1 hour']], String(tvSettings.return_minutes), async (v) => {
          try { await rpc('set_tv_settings', { p_pin: null, p_return_minutes: Number(v) }); toast('Saved. TVs pick this up within a minute'); }
          catch (e) { toast(e.message, true); }
        }))));

  const banner = await overridesBanner(rerender);
  const integ = await integrationsCards(rerender);
  main.replaceChildren(head, banner || '', h('div', { class: 'stack' }, attention, unassignedCard, clientsCard, allTvs, remoteCard, integ));
}
