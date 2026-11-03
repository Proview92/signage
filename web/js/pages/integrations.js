// Admin: email alerts (Resend) and online payments (Stripe Payment Links).
import { sb, state, h, q, rpc, toast, modal, field, select, timeAgo } from '../core.js';
import { LICENSE_TYPES } from '../license.js';

const PAY_PLANS = LICENSE_TYPES.filter(([k]) => !['trial7', 'custom'].includes(k));

export async function integrationsCards(rerender) {
  let st;
  try { st = await rpc('get_integration_settings'); } catch (e) { return h('div', { class: 'notice' }, 'Alerts & payments need the latest database update (migration 008).'); }

  // ---------------- alerts
  const alertsDialog = () => {
    const key = h('input', { type: 'password', autocomplete: 'off', placeholder: st.has_resend_key ? 'Saved — leave blank to keep' : 're_…' });
    const from = h('input', { type: 'text', value: st.email_from || '' });
    const extra = h('input', { type: 'email', value: st.admin_alert_email || '', placeholder: 'Optional extra address for alerts' });
    let on = st.alerts_email_enabled, mins = String(st.alert_offline_minutes || 15), toClients = st.alerts_to_clients;
    modal({ title: 'Alerts & email', body: [
      h('p', { class: 'muted small', style: { margin: 0 } }, 'Every 5 minutes PROVIEW SIGNAGE checks for TVs that go offline, come back online, or whose licence ends in 14 or 3 days or has expired. Alerts always appear under 🔔. Email is optional.'),
      field('Count a TV as offline after', select([['5', '5 minutes'], ['10', '10 minutes'], ['15', '15 minutes'], ['30', '30 minutes'], ['60', '1 hour']], mins, (v) => (mins = v))),
      h('label', { class: 'row small', style: { fontWeight: 600 } }, h('input', { type: 'checkbox', checked: on, onchange: (e) => (on = e.target.checked) }), 'Also send alerts by email'),
      h('label', { class: 'row small', style: { fontWeight: 600 } }, h('input', { type: 'checkbox', checked: toClients, onchange: (e) => (toClients = e.target.checked) }), 'Email the client’s managers and contact email too (otherwise only you)'),
      field('Resend API key', key, h('span', {}, 'Create a free account at resend.com → API Keys → Create. Paste it here yourself. It is stored encrypted.')),
      field('Send from', from, 'Until you verify your domain in Resend, keep “onboarding@resend.dev”: it can only send to your own Resend login email. After verifying e.g. proviewsecurity.co.uk, use “PROVIEW SIGNAGE <alerts@proviewsecurity.co.uk>”.'),
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

  // ---------------- payments
  const payDialog = () => {
    const key = h('input', { type: 'password', autocomplete: 'off', placeholder: st.has_stripe_key ? 'Saved — leave blank to keep' : 'rk_live_…' });
    let on = st.stripe_enabled;
    const plans = structuredClone(st.stripe_plans || {});
    const rows = PAY_PLANS.map(([k, label]) => {
      const p = plans[k] || {};
      const link = h('input', { type: 'url', value: p.link || '', placeholder: 'https://buy.stripe.com/…' });
      const price = h('input', { type: 'number', min: 0, step: '0.01', value: p.amount ? (p.amount / 100).toFixed(2) : '', placeholder: '0.00', style: { width: '110px' } });
      return { k, label, link, price };
    });
    modal({ title: 'Online licence payments', wide: true, body: [
      h('div', { class: 'notice info' }, h('b', {}, 'How it works. '), 'In Stripe, create a Payment Link for each licence you sell. Paste each link and its price below. Clients see “Renew online” on their TV’s licence. When they pay, the licence extends automatically within about 5 minutes.'),
      h('label', { class: 'row small', style: { fontWeight: 600 } }, h('input', { type: 'checkbox', checked: on, onchange: (e) => (on = e.target.checked) }), 'Offer online renewal to clients'),
      field('Stripe restricted key', key, 'Stripe → Developers → API keys → Create restricted key → give “Checkout Sessions: Read”, nothing else. Paste it here yourself.'),
      h('div', { class: 'stack', style: { gap: '8px' } }, h('div', { class: 'tiny' }, 'Plans (GBP). Leave a link blank to not sell that plan online.'),
        ...rows.map((r) => h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, h('div', { style: { width: '110px', fontWeight: 600 } }, r.label), h('div', { class: 'grow' }, r.link), h('span', { class: 'tiny' }, '£'), r.price))),
      st.stripe_last_error ? h('div', { class: 'notice' }, 'Last check: ' + st.stripe_last_error) : st.stripe_checked_at ? h('div', { class: 'tiny' }, 'Last checked ' + timeAgo(st.stripe_checked_at)) : null],
    actions: [{ label: 'Cancel' }, { label: 'Save', class: 'primary', onClick: async () => {
      const out = {};
      for (const r of rows) {
        const link = r.link.value.trim();
        if (!link) continue;
        if (!/^https:\/\/(buy\.stripe\.com|checkout\.stripe\.com)\//.test(link)) throw new Error(`${r.label}: paste a Stripe Payment Link (https://buy.stripe.com/…)`);
        const amt = Math.round(parseFloat(r.price.value) * 100);
        if (!(amt > 0)) throw new Error(`${r.label}: enter the price`);
        out[r.k] = { link, amount: amt, currency: 'gbp', label: r.label };
      }
      if (on && !Object.keys(out).length) throw new Error('Add at least one plan');
      const p = { stripe_enabled: on, stripe_plans: out };
      if (key.value.trim()) p.stripe_secret_key = key.value.trim();
      await rpc('set_integration_settings', { p });
      toast('Payment settings saved'); rerender();
    } }] });
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
        h('div', {}, h('h2', {}, 'Online payments'), h('div', { class: 'tiny' }, 'Clients renew licences by card (Stripe); licences extend automatically.')),
        h('div', { class: 'row' }, status(st.stripe_enabled && st.has_stripe_key, st.stripe_enabled && st.has_stripe_key ? `On · ${Object.keys(st.stripe_plans || {}).length} plans` : 'Off'),
          h('button', { class: 'btn sm', onclick: payDialog }, 'Set up')))));
}

/** Client-side: pick a plan and pay for a TV's licence. */
export async function renewOnlineDialog(screen) {
  const plans = await rpc('get_payment_plans');
  const entries = Object.entries(plans || {});
  if (!entries.length) return toast('Online renewal isn’t available. Contact Proview to renew.', true);
  let pick = entries.find(([k]) => k === 'm12')?.[0] || entries[0][0];
  modal({ title: `Renew licence: ${screen.name}`, body: [
    h('p', { class: 'muted small', style: { margin: 0 } }, 'Choose a plan. Time is added on top of the current licence. You’ll pay securely with Stripe; the licence updates within about 5 minutes.'),
    h('div', { class: 'stack', style: { gap: '8px' } }, entries.map(([k, p]) => h('label', { class: 'row card pad', style: { fontWeight: 600, padding: '12px 14px' } },
      h('input', { type: 'radio', name: 'plan', checked: k === pick, onchange: () => (pick = k) }), h('span', { class: 'grow' }, p.label || k), `£${(p.amount / 100).toFixed(2)}`)))],
  actions: [{ label: 'Cancel' }, { label: 'Pay with card', class: 'primary', onClick: () => {
    const p = plans[pick];
    const u = new URL(p.link);
    u.searchParams.set('client_reference_id', `${screen.id}__${pick}`);
    if (state.me.email) u.searchParams.set('prefilled_email', state.me.email);
    window.open(u.toString(), '_blank', 'noopener');
  } }] });
}
