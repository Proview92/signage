// Headless tests: a person in several businesses (MULTI_BUSINESS_PICKER_STANDARD.md), and no Locations page.
// Usage: node tests/headless/multi-business.test.js [web root]   (needs Playwright + Chrome, see harness.js)
const path = require('path');
const H = require('./harness.js');
const ROOT = process.argv[2] || path.join(__dirname, '../../web');
const BASE = 'http://127.0.0.1:8851/';
const SUPA = 'zbuyafrdhbgqyaepiajm.supabase.co', SKEY = 'signage-admin';
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222';
const SA1 = 'a1a1a1a1-0000-4000-8000-000000000001', SA2 = 'a2a2a2a2-0000-4000-8000-000000000002', SB1 = 'b1b1b1b1-0000-4000-8000-000000000003';
const U = (id, email, admin = false) => ({ id, email, aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'email' }, user_metadata: {}, is_admin: admin });
const master = U('u-master', 'master@proview.test', true), multi = U('u-multi', 'Multi@Both.test'), solo = U('u-solo', 'solo@cafe-a.test');
const INIT = {
  clients: [{ id: A, name: 'Cafe Alpha', contact_email: 'a@cafe-a.test', require_approval: false, self_signup: false, trial_ends_at: null },
            { id: B, name: 'Burger Bros Ltd', contact_email: 'b@bros.test', require_approval: false, self_signup: false, trial_ends_at: null }],
  sites: [{ id: SA1, client_id: A, name: 'Alpha High St', license_type: 'lifetime', license_expires_at: null }, { id: SA2, client_id: A, name: 'Alpha Station', license_type: null, license_expires_at: null }, { id: SB1, client_id: B, name: 'Bros Kitchen', license_type: 'lifetime', license_expires_at: null }],
  screens: [{ id: 's-a1', client_id: A, site_id: SA1, name: 'Alpha Counter TV', claimed: true, license_type: 'm12', license_expires_at: '2027-06-01T00:00:00Z', last_seen: new Date().toISOString(), content: {}, device_info: {} },
            { id: 's-a2', client_id: A, site_id: SA2, name: 'Alpha Platform TV', claimed: true, license_type: 'm12', license_expires_at: '2027-06-01T00:00:00Z', last_seen: new Date().toISOString(), content: {}, device_info: {} },
            { id: 's-b1', client_id: B, site_id: SB1, name: 'Bros Grill TV', claimed: true, license_type: 'm12', license_expires_at: '2027-06-01T00:00:00Z', content: {}, device_info: {} }],
  client_members: [{ client_id: A, user_id: 'u-multi', role: 'manager', site_ids: null, features: {} },
                   { client_id: B, user_id: 'u-multi', role: 'manager', site_ids: null, features: {} },
                   { client_id: A, user_id: 'u-solo', role: 'manager', site_ids: null, features: {} }],
  playlists: [], media: [], notifications: [], schedule_items: [], approval_requests: [], team_messages: [], overrides: [], profiles: [],
};
const tables = {};
const reset = (f) => { for (const k of Object.keys(tables)) delete tables[k]; Object.assign(tables, JSON.parse(JSON.stringify(INIT))); if (f) f(tables); };
reset();
const mineIds = (u) => u?.is_admin ? null : tables.client_members.filter((m) => m.user_id === u?.id).map((m) => m.client_id);
const memb = (u, cid) => tables.client_members.find((m) => m.user_id === u?.id && m.client_id === cid);
const rls = (t, r, u) => {
  if (!u) return false; const ids = mineIds(u); if (!ids) return true;
  const cid = t === 'clients' ? r.id : r.client_id; if (cid === undefined) return true; if (!ids.includes(cid)) return false;
  if (t === 'sites') { const m = memb(u, cid); return m.role === 'manager' || !Array.isArray(m.site_ids) || m.site_ids.includes(r.id); }
  return true;
};
const whoami = (_, u) => ({ user_id: u.id, email: u.email, is_admin: !!u.is_admin,
  clients: tables.clients.filter((c) => u.is_admin || mineIds(u).includes(c.id)).map((c) => { const m = memb(u, c.id);
    return { ...c, trial_only: false, has_licence: true, role: u.is_admin ? m?.role || 'admin' : m.role, site_ids: u.is_admin || m.role === 'manager' ? null : m.site_ids, features: {} }; })
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase())) });
const SSO = { 'as-master-A': [master, A] };
const mock = H.makeMock({
  users: { 'tok-master': master, 'tok-multi': multi, 'tok-solo': solo }, tables, rls,
  passwords: { 'multi@both.test': multi, 'solo@cafe-a.test': solo }, passwordOf: () => 'correct-horse',
  otp: { 'h-master': master },
  rpc: { is_admin: (_, u) => !!u?.is_admin, whoami, am_i_deactivated: () => false, join_my_invites: () => 0, team_people: () => [], list_team: () => [], email_has_account: () => true },
  ssoLogin: (b) => { const s = SSO[b.assertion]; if (!s) return { status: 401, body: { error: 'expired' } }; return { status: 200, body: { token_hash: 'h-master', email: master.email, open: s[1] } }; },
});
const R = H.reporter();
const view = (page) => page.evaluate(() => {
  const sel = document.querySelector('.hdr-pick select');
  return {
    opts: sel ? [...sel.options].map((o) => o.textContent) : [],
    groups: sel ? [...sel.querySelectorAll('optgroup')].map((g) => g.label) : [],
    groupOpts: sel ? [...sel.querySelectorAll('optgroup')].map((g) => [...g.querySelectorAll('option')].map((o) => o.textContent)) : [],
    picked: sel ? sel.options[sel.selectedIndex]?.textContent : null, disabled: sel?.disabled ?? null, aria: sel?.getAttribute('aria-label'),
    nav: [...document.querySelectorAll('.side .nav a')].map((a) => a.textContent.trim()),
    main: document.querySelector('main')?.innerText || '', hash: location.hash, auth: !!document.querySelector('.auth'),
    bar: document.querySelector('.pv-master-bar')?.innerText || '',
    last: Object.fromEntries(Object.keys(localStorage).filter((k) => k.startsWith('signage.lastUsed.')).map((k) => [k, localStorage.getItem(k)])),
  };
});
const settle = (p, ms = 1600) => p.waitForTimeout(ms);
const lastKey = 'signage.lastUsed.multi@both.test';
const pickByText = async (page, text) => { const v = await page.evaluate((t) => [...document.querySelector('.hdr-pick select').options].find((o) => o.textContent === t)?.value, text); await page.selectOption('.hdr-pick select', v); };
const NO_LOC_WORDS = (v) => !v.opts.some((o) => /All my locations|All locations|\u25B8/.test(o)) && !v.groups.length;

(async () => {
  const srv = await H.serveStatic(ROOT, 8851);
  const b = await H.launch();
  try {
    // 1) two businesses, last used A: lands in A; the dropdown lists business names only
    {
      reset();
      const { page, errors, ctx } = await H.openApp(b, { base: BASE, supaHost: SUPA, mock, seed: { [SKEY]: H.storedSession('tok-multi', multi), [lastKey]: JSON.stringify({ client: A }) } });
      await page.goto(BASE); await settle(page);
      let v = await view(page);
      R.ok(v.picked === 'Cafe Alpha' && /Alpha Counter TV/.test(v.main) && !/Bros Grill TV/.test(v.main), 'sign-in: lands in the last-used business (Cafe Alpha) ' + v.picked);
      R.ok(JSON.stringify(v.opts) === JSON.stringify(['Burger Bros Ltd', 'Cafe Alpha']) && NO_LOC_WORDS(v), 'dropdown: business names only, by name, no optgroups or location entries ' + JSON.stringify(v.opts));
      R.ok(v.aria === 'Business' && v.disabled === false, 'dropdown: aria-label "Business", enabled');
      R.ok(/Alpha Counter TV/.test(v.main) && /Alpha Platform TV/.test(v.main) && /Alpha High St/.test(v.main) && /Alpha Station/.test(v.main), 'business view: every location of Cafe Alpha, grouped by location');
      // switch to B
      let n0 = mock.log.length;
      await pickByText(page, 'Burger Bros Ltd'); await settle(page);
      v = await view(page);
      R.ok(v.picked === 'Burger Bros Ltd' && /Bros Grill TV/.test(v.main) && !/Alpha (Counter|Platform) TV/.test(v.main), 'switch: Burger Bros Ltd opens B with only its TV');
      R.ok(!H.leaks(mock.log, n0, ['Alpha Counter TV', 'Alpha Platform TV']).length, 'switch: nothing of Cafe Alpha loaded after switching to B');
      R.ok(JSON.parse(v.last[lastKey] || '{}').client === B, 'switch: remembered as last used, by email ' + JSON.stringify(v.last));
      // a business never mixes with another
      n0 = mock.log.length;
      await pickByText(page, 'Cafe Alpha'); await settle(page);
      v = await view(page);
      R.ok(/Alpha Counter TV/.test(v.main) && /Alpha Platform TV/.test(v.main) && !/Bros Grill TV/.test(v.main), 'Cafe Alpha: both of its TVs, none of Burger Bros');
      R.ok(!H.leaks(mock.log, n0, ['Bros Grill TV', 's-b1']).length, 'Cafe Alpha: no Burger Bros data requested or returned');
      R.ok(/Business licences/.test(v.main) && /Each business needs its own licence/.test(v.main) && /Business: lifetime licence/.test(v.main) && /Buy business licence online/.test(v.main) && !/Location licence|Each location needs|Location: /.test(v.main), 'licence box: "Business licence" wording ' + (v.main.match(/.{0,40}icence.{0,40}/g) || []).slice(0, 4).join(' / '));
      // sign out, sign in again with the password: back in the last used business (survives sign-out)
      await pickByText(page, 'Burger Bros Ltd'); await settle(page, 900);
      await page.click('text=SIGN OUT').catch(() => page.evaluate(() => [...document.querySelectorAll('button,a')].find((x) => /sign out/i.test(x.textContent))?.click()));
      await settle(page, 1500);
      v = await view(page);
      R.ok(v.auth && !!v.last[lastKey], 'sign-out: sign-in page, the last-used business is still remembered for this email');
      await page.fill('input[type=email]', 'multi@both.test'); await page.fill('input[type=password]', 'correct-horse');
      await page.click('form button[type=submit]'); await settle(page, 2200);
      v = await view(page);
      R.ok(v.picked === 'Burger Bros Ltd' && /Bros Grill TV/.test(v.main), 'password sign-in: lands in Burger Bros Ltd (last used) ' + v.picked);
      R.ok(!/choose a business/i.test(v.main), 'sign-in: no "choose a business" page');
      // no Locations page: no menu item, old URLs go to the home page (Screens)
      R.ok(!v.nav.some((t) => /^Locations$/i.test(t)), 'no Locations menu item ' + JSON.stringify(v.nav));
      for (const old of ['locations', 'sites', 'clients']) { await page.goto(BASE + '#/' + old); await settle(page, 900); const w = await view(page); R.ok(w.hash === '#/screens', `old URL #/${old} goes to Screens (${w.hash})`); }
      R.ok(!errors.length, 'two businesses: no page errors ' + errors.join(' | '));
      await ctx.close();
    }
    // 2) a new device (nothing remembered): the first usable business by name
    {
      reset();
      const { page, errors, ctx } = await H.openApp(b, { base: BASE, supaHost: SUPA, mock, seed: { [SKEY]: H.storedSession('tok-multi', multi) } });
      await page.goto(BASE); await settle(page);
      const v = await view(page);
      R.ok(v.picked === 'Burger Bros Ltd', 'new device: first usable business by name ' + v.picked);
      R.ok(!errors.length, 'new device: no page errors ' + errors.join(' | '));
      await ctx.close();
    }
    // 3) fallback when A is unusable: switched off in A (not in whoami), or no location they can see in A
    for (const [why, change] of [
      ['switched off in Cafe Alpha', (t) => { t.client_members = t.client_members.filter((m) => !(m.user_id === 'u-multi' && m.client_id === A)); }],
      ['no location in Cafe Alpha', (t) => { const m = t.client_members.find((x) => x.user_id === 'u-multi' && x.client_id === A); m.role = 'editor'; m.site_ids = []; }],
      ['Cafe Alpha has no locations', (t) => { t.sites = t.sites.filter((s) => s.client_id !== A); t.screens = t.screens.filter((s) => s.client_id !== A); }]]) {
      reset(change);
      const { page, errors, ctx } = await H.openApp(b, { base: BASE, supaHost: SUPA, mock, seed: { [SKEY]: H.storedSession('tok-multi', multi), [lastKey]: JSON.stringify({ client: A }), 'signage.client': A } });
      await page.goto(BASE); await settle(page);
      const v = await view(page);
      R.ok(!v.auth && /Bros Grill TV/.test(v.main) && JSON.stringify(v.opts) === JSON.stringify(['Burger Bros Ltd']) && v.disabled === true,
        `fallback (${why}): opens Burger Bros Ltd, dropdown = its name, disabled ${JSON.stringify(v.opts)}`);
      R.ok(!errors.length, `fallback (${why}): no page errors ` + errors.join(' | '));
      await ctx.close();
    }
    // 4) a single-business owner: the business name in a disabled box, the whole business on Screens
    {
      reset();
      const { page, errors, ctx } = await H.openApp(b, { base: BASE, supaHost: SUPA, mock, seed: { [SKEY]: H.storedSession('tok-solo', solo), ['signage.siteFilter.' + A]: SA1 } });
      await page.goto(BASE); await settle(page);
      const v = await view(page);
      R.ok(JSON.stringify(v.opts) === JSON.stringify(['Cafe Alpha']) && v.disabled === true, 'single business: its name, disabled ' + JSON.stringify(v.opts));
      R.ok(/Alpha Counter TV/.test(v.main) && /Alpha Platform TV/.test(v.main), 'single business: Screens shows both locations (an old stored location filter is ignored)');
      R.ok(!v.nav.some((t) => /^Locations$/i.test(t)), 'single business: no Locations menu item');
      R.ok(!errors.length, 'single business: no page errors ' + errors.join(' | '));
      await ctx.close();
    }
    // 5) master-open is unchanged
    {
      reset();
      const { page, errors, ctx } = await H.openApp(b, { base: BASE, supaHost: SUPA, mock });
      const n0 = mock.log.length; await page.goto(BASE + '#pv_sso=as-master-A'); await settle(page, 2200);
      const v = await view(page);
      R.ok(/Viewing\s+Cafe Alpha\s+as Proview/.test(v.bar) && JSON.stringify(v.opts) === JSON.stringify(['Cafe Alpha']) && v.disabled === true, 'master-open: the opened business\'s name, disabled ' + JSON.stringify(v.opts));
      R.ok(!mock.log.slice(n0).some((e) => /rpc\/whoami/.test(e.url)) && !H.leaks(mock.log, n0, ['Burger Bros Ltd', 'Bros Grill TV']).length, 'master-open: whoami not called, no other business loaded');
      R.ok(!v.nav.some((t) => /^Locations$/i.test(t)) && !Object.keys(v.last).length, 'master-open: no Locations menu item, nothing remembered as last used');
      R.ok(!errors.length, 'master-open: no page errors ' + errors.join(' | '));
      await ctx.close();
    }
    // 5b) the master signed in directly: "Open a business from the licence portal"
    {
      reset();
      const { page, errors, ctx } = await H.openApp(b, { base: BASE, supaHost: SUPA, mock, seed: { [SKEY]: H.storedSession('tok-master', master) } });
      await page.goto(BASE); await settle(page);
      const t = await page.evaluate(() => document.body.innerText);
      R.ok(/Open a business from the licence portal/.test(t) && !/Open a location/.test(t), 'master direct: "Open a business from the licence portal" (page and menu)');
      R.ok(!errors.length, 'master direct: no page errors ' + errors.join(' | '));
      await ctx.close();
    }
    // 6) the stale "add your locations" text is gone
    const fs = require('fs');
    const src = fs.readFileSync(path.join(ROOT, 'js/pages/screens.js'), 'utf8');
    R.ok(!/Add your locations first/.test(src) && /Businesses are set up by Proview\./.test(src), 'Screens: "Add your locations first" replaced by "Businesses are set up by Proview."');
  } finally { await b.close(); srv.close(); }
  process.exit(R.done() ? 1 : 0);
})();
