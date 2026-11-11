// Admin: email alerts (Resend). Online payments are managed in the Proview licence portal.
import { sb, state, h, q, rpc, toast, modal, field, select, timeAgo } from '../core.js';

export async function integrationsCards(rerender) {
  let st;
  try { st = await rpc('get_integration_settings'); } catch (e) { return h('div', { class: 'notice' }, 'Alerts & payments need the latest database update (migration 008).'); }

  // ---------------- alerts
  const alertsDialog = () => {
    const key = h('input', { type: 'password', autocomplete: 'off', placeholder: st.has_resend_key ? 'Saved — leave blank to keep' : 're_…' });
    const from = h('input', { type: 'text', value: !st.email_from || /onboarding@resend\.dev/.test(st.email_from) ? 'PROVIEW SIGNAGE <alerts@proviewsignage.co.uk>' : st.email_from });
    const extra = h('input', { type: 'email', value: st.admin_alert_email || '', placeholder: 'Optional extra address for alerts' });
    let on = st.alerts_email_enabled, mins = String(st.alert_offline_minutes || 15), toClients = st.alerts_to_clients;
    modal({ title: 'Alerts & email', body: [
      h('p', { class: 'muted small', style: { margin: 0 } }, 'Every 5 minutes PROVIEW SIGNAGE checks for TVs that go offline, come back online, or whose licence ends in 14 or 3 days or has expired. Alerts always appear under 🔔. Email is optional.'),
      field('Count a TV as offline after', select([['5', '5 minutes'], ['10', '10 minutes'], ['15', '15 minutes'], ['30', '30 minutes'], ['60', '1 hour']], mins, (v) => (mins = v))),
      h('label', { class: 'row small', style: { fontWeight: 600 } }, h('input', { type: 'checkbox', checked: on, onchange: (e) => (on = e.target.checked) }), 'Also send alerts by email'),
      h('label', { class: 'row small', style: { fontWeight: 600 } }, h('input', { type: 'checkbox', checked: toClients, onchange: (e) => (toClients = e.target.checked) }), 'Email the business’s managers and contact email too (otherwise only you)'),
      field('Resend API key', key, h('span', {}, 'Create a free account at resend.com → API Keys → Create. Paste it here yourself. It is stored encrypted.')),
      field('Send from', from, 'The address alerts come from. It must be on a domain verified in Resend (proviewsignage.co.uk is).'),
      field('Extra alert address', extra)],
    actions: [
      { label: 'Send test email', close: false, onClick: async () => { await save(); await rpc('send_test_email'); toast('Test email sent: check your inbox (and spam)'); } },
      { label: 'Cancel' },
      { label: 'Save', class: 'primary', onClick: async () => { await save(); toast('Saved'); rerender(); } }] });
    async function save() {
      const p = { alerts_email_enabled: on, alert_offline_minutes: Number(mins), alerts_to_clients: toClients, email_from: from.value, admin_alert_email: extra.value };
      if (key.value.trim()) p.resend_api_key = key.value.trim();
      await rpc('set_integration_settings', { p });
      st = await rpc('get_integration_settings');
    }
  };

  const status = (ok, text) => h('span', { class: 'badge ' + (ok ? 'ok' : 'plain') }, text);
  return h('div', { class: 'stack' },
    h('div', { class: 'card' },
      h('div', { class: 'card-head' },
        h('div', {}, h('h2', {}, 'Alerts & email'), h('div', { class: 'tiny' }, `Offline after ${st.alert_offline_minutes} min · licence reminders at 14 and 3 days · shown under 🔔`)),
        h('div', { class: 'row' }, st.cron === false ? status(false, 'Checker not running') : null,
          status(st.alerts_email_enabled && st.has_resend_key, st.alerts_email_enabled && st.has_resend_key ? 'Email on' : 'Email off'),
          h('button', { class: 'btn sm', onclick: alertsDialog }, 'Set up')))),
    h('div', { class: 'card' },
      h('div', { class: 'card-head' },
        h('div', {}, h('h2', {}, 'Online payments'), h('div', { class: 'tiny' }, 'Prices, Stripe links and payments for all Proview apps are managed in the licence portal.')),
        h('a', { class: 'btn sm', href: 'https://license.proviewcrm.co.uk', target: '_blank', rel: 'noopener' }, 'Licence portal ↗'))));
}

/** Client-side: pick a plan and pay for a TV's licence (prices are set in the Proview licence portal). */
export async function renewOnlineDialog(screen) {
  const plans = await rpc('licence_buy_plans');
  const entries = Object.entries(plans || {}).sort((a, b) => ORDER.indexOf(a[0]) - ORDER.indexOf(b[0]));
  if (!entries.length) return toast('Online payment isn’t available yet. Call Proview on 020 8935 5495 to buy or renew.', true);
  let pick = entries.find(([k]) => k === 'm12')?.[0] || entries[0][0];
  const buying = !screen.license_type || screen.license_type === 'trial7';
  modal({ title: `${buying ? 'Buy a licence' : 'Renew licence'}: ${screen.name}`, body: [
    h('p', { class: 'muted small', style: { margin: 0 } }, buying
      ? 'Choose a plan. You’ll pay securely with Stripe, and the TV is licensed within about 5 minutes.'
      : 'Choose a plan. Time is added on top of the current licence. You’ll pay securely with Stripe; the licence updates within about 5 minutes.'),
    h('div', { class: 'stack', style: { gap: '8px' } }, entries.map(([k, p]) => h('label', { class: 'row card pad', style: { fontWeight: 600, padding: '12px 14px' } },
      h('input', { type: 'radio', name: 'plan', checked: k === pick, onchange: () => (pick = k) }), h('span', { class: 'grow' }, p.label || k), money(p))))],
  actions: [{ label: 'Cancel' }, { label: 'Pay with card', class: 'primary', onClick: () => {
    const p = plans[pick];
    const u = new URL(p.link);
    u.searchParams.set('client_reference_id', `${p.ref || 'pvs'}__${screen.id}__${pick}`);
    if (state.me.email) u.searchParams.set('prefilled_email', state.me.email);
    window.open(u.toString(), '_blank', 'noopener');
  } }] });
}
/**
 * Client-side: pick a plan and pay for a LOCATION's licence (migration 045: every location needs its own licence, and
 * each TV needs its own on top). Prices are the licence portal's "location" prices; Stripe reference
 * pvs__loc__<site id>__<plan> (HUB_UNITS.md), which the portal applies to unit loc/<site id>.
 */
export async function buyLocationDialog(site) {
  let plans = {};
  try { plans = (await rpc('licence_buy_plans_by_kind'))?.location || {}; } catch { plans = {}; }
  const entries = Object.entries(plans).sort((a, b) => ORDER.indexOf(a[0]) - ORDER.indexOf(b[0]));
  if (!entries.length) return toast('Online payment for location licences isn’t available yet. Call Proview on 020 8935 5495 to buy one.', true);
  let pick = entries.find(([k]) => k === 'm12')?.[0] || entries[0][0];
  const buying = !site.license_type || site.license_type === 'trial7';
  modal({ title: `${buying ? 'Buy a location licence' : 'Renew location licence'}: ${site.name}`, body: [
    h('p', { class: 'muted small', style: { margin: 0 } }, (buying
      ? 'Every location needs its own licence, and each TV needs its own licence too. Choose a plan. You’ll pay securely with Stripe, and the location is licensed within about 5 minutes.'
      : 'Choose a plan. Time is added on top of the current licence. You’ll pay securely with Stripe; the licence updates within about 5 minutes.')),
    h('div', { class: 'stack', style: { gap: '8px' } }, entries.map(([k, p]) => h('label', { class: 'row card pad', style: { fontWeight: 600, padding: '12px 14px' } },
      h('input', { type: 'radio', name: 'plan', checked: k === pick, onchange: () => (pick = k) }), h('span', { class: 'grow' }, p.label || k), money(p))))],
  actions: [{ label: 'Cancel' }, { label: 'Pay with card', class: 'primary', onClick: () => {
    const p = plans[pick];
    const u = new URL(p.link);
    u.searchParams.set('client_reference_id', `${p.ref || 'pvs'}__loc__${site.id}__${pick}`);
    if (state.me.email) u.searchParams.set('prefilled_email', state.me.email);
    window.open(u.toString(), '_blank', 'noopener');
  } }] });
}
const ORDER = ['m1', 'm3', 'm6', 'm12', 'm24', 'm36', 'lifetime'];
const money = (p) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: (p.currency || 'gbp').toUpperCase() }).format(p.amount / 100);
