// "All sites" (Proview master, the landing page and the top of the client picker):
// every client and each of its sites, with TV counts and licences. Open one to see it as its team does.
import { sb, state, h, icon, isOnline, setClient, clientTitle, refreshMe, toast, errMsg, promptBox, modal, timeAgo, rpc, pairedLine, fmtWhen, copyText } from '../core.js';
import { licenseState, businessTrial, businessTrialText, neverLicensed, locationSummary } from '../license.js';
import { integrationsCards } from './integrations.js';
import { takePendingPair } from './qr-scan.js';
import { pairDialog } from './screens.js';

const LIC_PORTAL = 'https://license.proviewcrm.co.uk';
const NEEDS = ['none', 'expiring', 'grace', 'expired'];

export async function clientsPage({ main, go, rerender }) {
  if (!state.me?.is_admin) return go('screens');
  const clients = state.me.clients.slice().sort((a, b) => clientTitle(a).localeCompare(clientTitle(b)));
  // Screens and sites across the platform (the master can read all of them). Sites are optional:
  // if that query fails the list still shows each client, just without the per-site rows.
  const [scr, st, wt] = await Promise.all([
    sb.from('screens').select('*').eq('claimed', true),
    sb.from('sites').select('*'),
    // TVs showing their "Pair this screen" code right now (seen in the last 15 minutes)
    sb.from('screens').select('id, pairing_code, last_seen, created_at, device_info').eq('claimed', false)
      .gt('last_seen', new Date(Date.now() - 15 * 60000).toISOString()).order('created_at', { ascending: false })
      .then((r) => r, () => ({ data: [] })),
  ]);
  const waiting = (wt.data || []).filter((w) => w.pairing_code);
  if (scr.error) throw scr.error;
  const screens = scr.data || [];
  const sites = (st.data || []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const needs = (list) => list.filter((s) => NEEDS.includes(licenseState(s).state)).length;
  // location licences (migration 045): a location needs its own licence as well as each TV; older databases have none
  const hasLocLic = (x) => 'license_type' in x;
  const locNeeds = (list) => list.filter((x) => hasLocLic(x) && NEEDS.includes(licenseState(x).state));

  const open = (cid, siteId) => {
    setClient(cid);
    try { localStorage.setItem('signage.siteFilter.' + cid, siteId || 'all'); } catch {}
    go('screens');
  };
  const refresh = async () => { try { await refreshMe(); } catch {} rerender(); };
  // "+ Add business" (master only), design D (ADD_BUSINESS_D_SPEC, 11 Nov 2026): business + owner in one grid, then two choices.
  //   How will they sign in?  invite (email link, they choose the password) | set a password now (no email)
  //   Licence                 none yet | 3-day trial (master_trial, migration 045) | set it now (licence portal)
  // add_business (038) does the business, its location and the Owner login all-or-nothing on the server. For an invite the
  // login gets a random password nobody sees and Supabase emails a set-your-password link (app.js's PASSWORD_RECOVERY
  // handler then asks them to choose one).
  const addClient = () => window.pvAddBiz({ onSubmit: async (v, ui) => {   // the pop-up: web/pv-addbiz.js, shared by all six apps
    const rand = (n) => { const a = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; return [...crypto.getRandomValues(new Uint32Array(n))].map((x) => a[x % a.length]).join(''); };
    const need = (input, msg) => { toast(msg, true); input.focus(); return false; };
    const e = v.email, b = v.biz, invite = v.invite, lic = v.lic;
    const pw = invite ? rand(24) : v.password;
    if (b.length < 2) return need(ui.input('biz'), 'Enter the business name');
    if (v.name.length < 2) return need(ui.input('name'), 'Enter the owner’s name');
    if (!/^\S+@\S+\.\S+$/.test(e)) return need(ui.input('email'), 'Enter a valid email address');
    if (!invite && pw.length < 6) return need(ui.input('pw'), 'The password needs at least 6 characters');
    let r;
    try { r = await rpc('add_business', { p_business: b, p_name: v.name, p_email: e, p_mobile: v.mobile, p_password: pw }); }
    catch (err) { toast(errMsg(err), true); return false; }
    const p = (text, cls) => h('p', { class: cls || '', style: { margin: 0 } }, text);
    // licence: a 3-day business trial now (never replaces a licence already set)
    let licLine;
    if (lic === 'trial') {
      try {
        const t = await rpc('master_trial', { p_client: r.client_id });
        licLine = t?.applied ? p(`On a 3-day trial until ${new Date(t.expires_at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}. Each TV paired before then plays until the trial ends.`, 'notice ok')
          : p('It already had a licence, so no trial was added.', 'muted');
      } catch (err) { licLine = p(`The business was added, but the trial couldn’t be started: ${errMsg(err)}. Set a licence in the licence portal.`, 'notice warn'); }
    } else if (lic === 'none') licLine = p('No licence yet: they buy one when they sign in.', 'muted');
    else licLine = p('Next, set its licence in the licence portal.', 'muted');
    // sign-in: email the invite (new logins only; an existing login keeps its password)
    let signIn = null;
    if (r?.existing) {
      signIn = p(`${e} already had a PROVIEW SIGNAGE login, so they were made Owner / Admin of this business and keep the password they already use.${invite ? ' No invite was needed.' : ' The password you typed was not applied.'}`);
    } else if (invite) {
      const { error: me } = await sb.auth.resetPasswordForEmail(e, { redirectTo: location.origin + location.pathname });
      signIn = me ? p(`The business was added, but the invite email couldn’t be sent (${errMsg(me)}). They can use “Forgot password?” on the sign-in page with ${e}.`, 'notice warn')
        : h('p', { class: 'notice ok', style: { margin: 0 } }, 'Invite sent to ', h('b', {}, e), '. They open the email link and choose their own password.');
    }
    await refresh();
    const site = location.origin + location.pathname;
    const details = `PROVIEW SIGNAGE login\n${site}\nEmail: ${e}\nPassword: ${pw}`;
    const pwCard = !r?.existing && !invite ? [
      p('The owner can sign in now. No email was sent, so pass these on yourself:', 'muted'),
      h('div', { class: 'notice info login-card' }, h('div', {}, h('span', { class: 'muted' }, 'Sign in at'), h('b', {}, site.replace(/^https?:\/\//, ''))), h('div', {}, h('span', { class: 'muted' }, 'Email'), h('b', {}, e)), h('div', {}, h('span', { class: 'muted' }, 'Password'), h('b', {}, pw))),
      h('button', { class: 'btn', type: 'button', style: { alignSelf: 'flex-start' }, onclick: () => copyText(details) }, icon('copy'), 'Copy login details')] : null;
    setTimeout(() => {
      const done = modal({ title: `${b} added`, body: h('div', { class: 'stack' }, signIn, pwCard, licLine),
        actions: [{ label: 'Stay here' }, { label: 'Open business', class: 'primary', onClick: () => open(r.client_id) }] });
      if (lic === 'set') done.el.querySelector('.modal-foot').prepend(h('a', { class: 'btn', href: LIC_PORTAL, target: '_blank', rel: 'noopener' }, 'Set licence ↗'));
    }, 50);
    return true;
  } });

  const online = screens.filter(isOnline);
  const ids = new Set(clients.map((c) => c.id));
  const loose = screens.filter((s) => !s.client_id || !ids.has(s.client_id));
  const attention = screens.filter((s) => NEEDS.includes(licenseState(s).state));
  const locAttention = locNeeds(sites.filter((x) => ids.has(x.client_id)));
  const bizName = (cid) => { const c = clients.find((x) => x.id === cid); return c ? clientTitle(c) : 'Not in a business'; };
  const siteName = (sid) => sites.find((x) => x.id === sid)?.name || '';
  const dot = (tone) => h('span', { class: 'ov-dot ' + tone });
  const chev = () => h('span', { class: 'ov-chev', 'aria-hidden': 'true' }, '›');
  const openTv = (s) => { setClient(s.client_id); document.querySelector('.modal-back')?._close?.(); go('screen/' + s.id); };
  const licText = (s) => { const L = licenseState(s); return { none: 'No licence', expiring: `Ends in ${L.daysLeft} day${L.daysLeft === 1 ? '' : 's'}`, grace: 'Expired, in grace period', expired: 'Expired', lifetime: 'Lifetime', active: 'Active' }[L.state]; };

  // A business the master started on a 3-day trial from Add business (044, self_signup false): shown like a trial until a TV has a licence.
  const bTrial = (c) => businessTrial(c) || (!c.self_signup && c.trial_ends_at && c.has_licence === false ? businessTrial({ ...c, trial_only: true }) : null);
  // Online sign-ups from before 042 still on their 3-day trial: "Trial – ends <date>" / "Trial expired" (gone once a TV licence is bought).
  const status = (c, list) => {
    const t = bTrial(c);
    if (t) return h('span', { class: 'badge ' + (t.state === 'expired' ? 'bad' : 'warn'), title: t.ends ? new Date(t.ends).toLocaleString() : 'Signed up online' }, businessTrialText(t));
    // Never licensed (no free trials since 042): red "No licence" until a TV licence is bought.
    if (!t && neverLicensed(c, list)) return h('span', { class: 'badge bad', title: 'No TV of this business has a licence yet' }, 'No licence');
    const lb = locNeeds(sites.filter((x) => x.client_id === c.id));
    if (lb.some((x) => licenseState(x).state === 'none')) return h('span', { class: 'badge bad', title: 'Each location needs its own licence, as well as each TV' }, 'No location licence');
    if (!list.length && !lb.length) return h('span', { class: 'badge' }, 'No TVs yet');
    const bad = needs(list) + lb.length;
    if (bad) return h('span', { class: 'badge bad' }, `${bad} licence${bad === 1 ? '' : 's'} need${bad === 1 ? 's' : ''} attention`);
    if (!list.every(isOnline)) return h('span', { class: 'badge warn' }, `${list.filter((x) => !isOnline(x)).length} offline`);
    return h('span', { class: 'badge ok' }, 'All good');
  };
  const tvLine = (tvs) => tvs.length ? `${tvs.filter(isOnline).length} of ${tvs.length} TV${tvs.length === 1 ? '' : 's'} online` : 'No TVs';
  const tvTone = (tvs) => !tvs.length ? 'none' : tvs.every(isOnline) ? 'ok' : tvs.some(isOnline) ? 'warn' : 'bad';

  // ---- one card per business; its locations inside (click one = open the business on that location)
  const cards = clients.map((c) => {
    const list = screens.filter((s) => s.client_id === c.id);
    const mine = sites.filter((s) => s.client_id === c.id);
    const locRow = (label, tvs, siteId) => h('button', { type: 'button', class: 'ov-loc', onclick: () => open(c.id, siteId), title: 'Open on this location' },
      dot(tvTone(tvs)), h('span', { class: 'grow' }, label), h('span', { class: 'muted small' }, tvLine(tvs)), chev());
    const rows = mine.map((s) => locRow(s.name, list.filter((x) => x.site_id === s.id), s.id));
    const none = list.filter((x) => !x.site_id || !mine.some((s) => s.id === x.site_id));
    if (mine.length && none.length) rows.push(locRow(h('span', { class: 'muted' }, 'No location'), none, 'none'));
    if (!mine.length) rows.push(h('div', { class: 'ov-loc muted' }, 'Setting up its location… press Refresh.'));
    // Only one location (and no TVs outside it): the card already says it all, so no location list
    const single = mine.length === 1 && rows.length === 1;
    if (single) rows.length = 0;
    const locOk = mine.every((x) => !hasLocLic(x) || licenseState(x).state === 'lifetime');
    const locLine = mine.filter(hasLocLic).length === 1 ? locationSummary(mine.find(hasLocLic)).text
      : mine.some(hasLocLic) ? `${mine.filter((x) => hasLocLic(x) && !NEEDS.includes(licenseState(x).state)).length} of ${mine.filter(hasLocLic).length} locations licensed` : '';
    const lic0 = list.length && locOk && list.every((s) => licenseState(s).state === 'lifetime') ? 'Licences: lifetime'
      : bTrial(c) ? (c.self_signup ? 'Trial · signed up online' : 'Trial · 3 days, from Add business') : neverLicensed(c, list) ? (list.length ? 'No licence yet · buy one for each TV' : 'No licence yet · pair a TV, then buy its licence')
      : list.length ? `${list.length} TV licence${list.length === 1 ? '' : 's'}` : 'Pair a TV to get started';
    const lic = lic0 === 'Licences: lifetime' || !locLine || bTrial(c) ? lic0 : `${locLine} · ${lic0}`;
    const el = h('article', { class: 'card ov-biz' },
      h('div', { class: 'ov-bh' },
        h('div', { class: 'grow' }, h('h3', {}, clientTitle(c)),
          h('div', { class: 'muted small' }, single
            ? [mine[0].name !== clientTitle(c) && mine[0].name, tvLine(list)].filter(Boolean).join(' · ')
            : `${mine.length} location${mine.length === 1 ? '' : 's'} · ${list.length ? list.length + ' TV' + (list.length === 1 ? '' : 's') : 'no TVs yet'}`)),
        status(c, list)),
      ...rows,
      h('div', { class: 'ov-bf' }, h('span', { class: 'muted small' }, lic), h('button', { class: 'btn sm primary', onclick: () => open(c.id, single ? mine[0].id : undefined) }, 'Open business')));
    const text = [clientTitle(c), c.name, c.contact_email, businessTrialText(bTrial(c)), !bTrial(c) && neverLicensed(c, list) && 'No licence', locNeeds(mine).length && 'No location licence', ...mine.map((s) => s.name)].filter(Boolean).join(' ').toLowerCase();
    return { el, text };
  });

  // ---- the summary boxes: each opens the list behind its number
  const listModal = (title, items, empty) => modal({ title, wide: true, body: items.length
    ? h('div', { class: 'list ov-list' }, items)
    : h('p', { class: 'muted' }, empty) });
  const tvItem = (s, extra) => {
    const inBiz = s.client_id && ids.has(s.client_id);
    return h(inBiz ? 'button' : 'div', { type: inBiz ? 'button' : undefined, class: 'ov-li', onclick: inBiz ? () => openTv(s) : undefined },
      dot(isOnline(s) ? 'ok' : 'bad'),
      h('span', { class: 'grow' }, h('b', {}, s.name || 'Unnamed TV'), h('span', { class: 'tiny', style: { display: 'block' } }, [bizName(s.client_id), siteName(s.site_id), !isOnline(s) && (s.last_seen ? 'last seen ' + timeAgo(s.last_seen) : 'never connected'), pairedLine(s)].filter(Boolean).join(' · '))),
      extra || h('span', { class: 'muted small' }, isOnline(s) ? 'Online' : 'Offline'),
      inBiz ? chev() : h('a', { class: 'btn sm', href: LIC_PORTAL, target: '_blank', rel: 'noopener', onclick: (e) => e.stopPropagation() }, 'Licence portal ↗'));
  };
  const byName = (a, b) => (bizName(a.client_id) + (a.name || '')).localeCompare(bizName(b.client_id) + (b.name || ''));
  const showBusinesses = () => listModal('Businesses', clients.map((c) => {
    const list = screens.filter((s) => s.client_id === c.id);
    return h('button', { type: 'button', class: 'ov-li', onclick: () => { document.querySelector('.modal-back')?._close?.(); open(c.id); } },
      dot(tvTone(list)), h('span', { class: 'grow' }, h('b', {}, clientTitle(c)), h('span', { class: 'tiny', style: { display: 'block' } }, `${sites.filter((s) => s.client_id === c.id).length} location(s) · ${tvLine(list)}`)),
      status(c, list), chev());
  }), 'No businesses yet.');
  const showLocations = () => listModal('Locations', sites.filter((s) => ids.has(s.client_id)).sort((a, b) => (bizName(a.client_id) + a.name).localeCompare(bizName(b.client_id) + b.name)).map((s) => {
    const tvs = screens.filter((x) => x.site_id === s.id);
    return h('button', { type: 'button', class: 'ov-li', onclick: () => { document.querySelector('.modal-back')?._close?.(); open(s.client_id, s.id); } },
      dot(tvTone(tvs)), h('span', { class: 'grow' }, h('b', {}, s.name), h('span', { class: 'tiny', style: { display: 'block' } }, bizName(s.client_id))),
      h('span', { class: 'muted small' }, tvLine(tvs)), hasLocLic(s) ? locBadge(s) : null, chev());
  }), 'No locations yet.');
  const locBadge = (x) => { const L = licenseState(x); return h('span', { class: 'badge ' + (L.state === 'expiring' ? 'warn' : NEEDS.includes(L.state) ? 'bad' : 'ok') }, 'Location: ' + licText(x).toLowerCase()); };
  const locItem = (x) => h('button', { type: 'button', class: 'ov-li', onclick: () => { document.querySelector('.modal-back')?._close?.(); open(x.client_id, x.id); } },
    dot(NEEDS.includes(licenseState(x).state) ? 'bad' : 'ok'), h('span', { class: 'grow' }, h('b', {}, x.name), h('span', { class: 'tiny', style: { display: 'block' } }, bizName(x.client_id) + ' · location licence')),
    locBadge(x), chev());
  const showTvs = (title, list, empty, extra) => listModal(title, list.slice().sort(byName).map((s) => tvItem(s, extra?.(s))), empty);

  const offline = screens.filter((s) => !isOnline(s));
  const stat = (k, v, onclick, tone) => h('button', { type: 'button', class: 'card ov-stat' + (tone ? ' ' + tone : ''), onclick, title: 'Show the list' },
    h('div', { class: 'tiny' }, k), h('div', { class: 'ov-v' }, String(v)));
  const stats = h('div', { class: 'ov-stats' },
    stat('Businesses', clients.length, showBusinesses),
    stat('Locations', sites.filter((s) => ids.has(s.client_id)).length, showLocations),
    stat('Screens', screens.length, () => showTvs('Screens', screens, 'No TVs yet.')),
    stat('Online', online.length, () => showTvs('Online now', online, 'No TVs are online right now.'), online.length ? 'ok' : ''),
    stat('Offline', offline.length, () => showTvs('Offline', offline, 'Every TV is online.'), offline.length ? 'warn' : ''),
    stat('Licences need attention', attention.length + locAttention.length, () => listModal('Licences needing attention', [
      ...locAttention.slice().sort((a, b) => (bizName(a.client_id) + a.name).localeCompare(bizName(b.client_id) + b.name)).map(locItem),
      ...attention.slice().sort(byName).map((s) => tvItem(s, h('span', { class: 'badge ' + (licenseState(s).state === 'expiring' ? 'warn' : 'bad') }, licText(s))))],
      'Every licence is fine.'), attention.length + locAttention.length ? 'bad' : ''));

  // TVs paired but not given to a business yet: one clear warning instead of a table row
  const looseBox = loose.length ? h('div', { class: 'card ov-warnbox' },
    h('span', { class: 'ov-warnicon', 'aria-hidden': 'true' }, '!'),
    h('div', { class: 'grow', style: { minWidth: '200px' } }, h('b', {}, `${loose.length} TV${loose.length === 1 ? '' : 's'} ${loose.length === 1 ? "isn't" : "aren't"} in a business yet`),
      h('div', { class: 'muted small' }, `Paired but not in a business yet${loose.some(isOnline) ? `, ${loose.filter(isOnline).length} of them online` : ''}. Use Assign TVs to put them in a business.`)),
    h('button', { class: 'btn sm primary', onclick: () => sortDialog(loose) }, 'Assign TVs')) : null;

  // Give TVs that aren't in a business to an existing business, or to a new one made here.
  function sortDialog(tvs) {
    // newest first: when the TV first started the app (or was paired, if that is all we know)
    const added = (s) => [s.created_at, s.license_starts_at, s.paired_at].filter(Boolean).sort((a, b) => new Date(a) - new Date(b))[0] || '';
    tvs = [...tvs].sort((a, b) => new Date(added(b) || 0) - new Date(added(a) || 0));
    const ticks = tvs.map((s) => ({ s, box: h('input', { type: 'checkbox', checked: true }) }));
    let mode = 'existing';
    const pick = h('select', {}, h('option', { value: '' }, '— Choose a business —'), ...clients.map((c) => h('option', { value: c.id }, clientTitle(c))));
    const newName = h('input', { type: 'text', placeholder: 'New business name', disabled: true });
    const radio = (val, label, field) => h('label', { class: 'ov-pick' },
      h('input', { type: 'radio', name: 'sortmode', value: val, checked: val === mode, onchange: () => { mode = val; pick.disabled = mode !== 'existing'; newName.disabled = mode !== 'new'; (mode === 'new' ? newName : pick).focus(); } }),
      h('span', { class: 'grow' }, h('b', {}, label), field));
    const dlg = modal({
      title: `Assign ${tvs.length === 1 ? 'this TV' : 'these TVs'} to a business`,
      body: [
        h('p', { class: 'muted small', style: { marginTop: 0 } }, 'Tick the TVs to move. They go into the business’s location and start blank: publish a playlist to them afterwards.'),
        h('div', { class: 'list ov-list', style: { maxHeight: '38vh' } }, ticks.map(({ s, box }) => h('label', { class: 'ov-li', style: { cursor: 'pointer' } }, box,
          h('span', { class: 'ov-dot ' + (isOnline(s) ? 'ok' : 'bad') }),
          h('span', { class: 'grow' }, h('b', {}, s.name || 'Unnamed TV'), h('span', { class: 'tiny', style: { display: 'block' } }, [added(s) && 'Added ' + fmtWhen(added(s)), isOnline(s) ? 'Online' : (s.last_seen ? 'Last seen ' + timeAgo(s.last_seen) : 'Never connected'), pairedLine(s, { long: true }), s.device_info?.model].filter(Boolean).join(' · ')))))),
        h('div', { class: 'stack', style: { gap: '10px', marginTop: '14px' } },
          radio('existing', 'Existing business', pick),
          radio('new', 'New business', newName)),
      ],
      actions: [{ label: 'Cancel' }, { label: 'Assign', class: 'primary', onClick: async () => {
        const chosen = ticks.filter((t) => t.box.checked).map((t) => t.s);
        if (!chosen.length) { toast('Tick at least one TV', true); return false; }
        let cid = mode === 'existing' ? pick.value : '';
        try {
          if (mode === 'new') {
            const nm = newName.value.trim();
            if (nm.length < 2) { toast('Type the new business’s name', true); newName.focus(); return false; }
            const { data, error } = await sb.from('clients').insert({ name: nm }).select('id').single();
            if (error) throw error;
            cid = data.id;
          } else if (!cid) { toast('Choose a business', true); pick.focus(); return false; }
          for (const s of chosen) await rpc('assign_screen', { p_screen: s.id, p_client: cid });
          await refreshMe();
          toast(`${chosen.length} TV${chosen.length === 1 ? '' : 's'} moved to ${mode === 'new' ? newName.value.trim() : clientTitle(clients.find((c) => c.id === cid))}`);
          refresh();
        } catch (e) { toast(errMsg(e), true); return false; }
      } }],
    });
    return dlg;
  }

  // TVs on their pairing screen: one row each, with Pair (opens Add a TV with the code and a business picker)
  const waitingBox = waiting.length ? h('section', { class: 'card ov-waiting' },
    h('div', { class: 'ov-wh' }, h('h2', {}, 'Waiting to be paired'), h('span', { class: 'chip' }, String(waiting.length)),
      h('span', { class: 'muted small grow' }, 'These TVs are showing their pairing code right now.')),
    ...waiting.map((w) => h('div', { class: 'ov-wrow' },
      h('span', { class: 'ov-code' }, w.pairing_code),
      h('span', { class: 'grow' }, h('b', {}, w.device_info?.model ? String(w.device_info.model).replace(/^rockchip /i, 'Android box ') : 'TV'),
        h('span', { class: 'tiny', style: { display: 'block' } }, [w.device_info?.resolution, w.device_info?.app, 'on since ' + timeAgo(w.created_at)].filter(Boolean).join(' · '))),
      h('button', { class: 'btn sm primary', onclick: () => pairDialog({ clients, code: w.pairing_code, onDone: (s) => { if (s?.client_id) { setClient(s.client_id); go('screen/' + s.id); } else refresh(); } }) }, 'Pair'))))
    : null;

  const grid = h('div', { class: 'ov-grid' });
  const search = h('input', { type: 'search', placeholder: 'Search businesses or locations', 'aria-label': 'Search businesses or locations', class: 'ov-search', oninput: () => paint() });
  const emptyState = () => h('div', { class: 'card', style: { gridColumn: '1 / -1' } },
    h('div', { class: 'stack', style: { alignItems: 'center', textAlign: 'center', padding: '28px 12px', gap: '10px' } },
      h('h3', { style: { margin: 0 } }, 'No businesses yet'),
      h('p', { class: 'muted', style: { margin: 0 } }, 'Add a business here, or add businesses, locations and licences in the Proview licence portal.'),
      h('div', { class: 'row', style: { justifyContent: 'center', gap: '8px', flexWrap: 'wrap' } },
        h('button', { class: 'btn primary', onclick: addClient }, icon('plus'), 'Add business'),
        h('a', { class: 'btn', href: LIC_PORTAL, target: '_blank', rel: 'noopener' }, 'Open licence portal ↗'),
        h('button', { class: 'btn', onclick: refresh }, icon('refresh'), 'Refresh'))));
  function paint() {
    const t = search.value.trim().toLowerCase();
    const shown = cards.filter((b) => !t || b.text.includes(t));
    if (!clients.length) grid.replaceChildren(emptyState());
    else if (!shown.length) grid.replaceChildren(h('p', { class: 'muted', style: { gridColumn: '1 / -1' } }, `No businesses or locations match “${search.value.trim()}”.`));
    else grid.replaceChildren(...shown.map((b) => b.el));
  }
  paint();

  // A TV's QR code was scanned and no business is open: pick the business in Add a TV.
  const pendingCode = takePendingPair();
  if (pendingCode) setTimeout(() => pairDialog({ clients, code: pendingCode, onDone: (s) => { if (s?.client_id) { setClient(s.client_id); go('screen/' + s.id); } else refresh(); } }), 50);

  main.replaceChildren(
    h('div', { class: 'page-head' },
      h('p', { class: 'muted', style: { margin: 0 } }, 'Every business on the platform with its locations. Open one to see it as its team does.'),
      h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
        h('button', { class: 'btn', onclick: refresh, title: 'Refresh' }, icon('refresh'), 'Refresh'),
        h('a', { class: 'btn', href: LIC_PORTAL, target: '_blank', rel: 'noopener' }, 'Licences ↗'),
        h('button', { class: 'btn primary', onclick: addClient }, icon('plus'), 'Add business'))),
    stats,
    ...[waitingBox, looseBox, h('div', { class: 'ov-tools' }, search)].filter(Boolean),
    grid,
    // Alerts & email (Resend key, offline alerts) - master only; it lived on the old Clients & TVs page
    h('h2', { style: { margin: '24px 0 10px' } }, 'Platform settings'),
    await integrationsCards(rerender).catch(() => h('div', { class: 'notice' }, 'Could not load alerts & email settings.')));
}
