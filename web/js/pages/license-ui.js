import { state, h, rpc, toast, modal, field, select } from '../core.js';
import { LICENSE_TYPES, licenseLabel, licenseState, licenseSummary, previewExpiry, fmtDate, GRACE_DAYS } from '../license.js';

export function licenseBadge(screen) {
  const { text, tone } = licenseSummary(screen);
  return h('span', { class: `badge ${tone}`, title: licenseLabel(screen.license_type) }, text);
}

/** Banner for the screen page when the licence needs attention (shown to everyone). */
export function licenseBanner(screen) {
  const L = licenseState(screen);
  const who = state.me?.is_admin ? 'Renew it below.' : 'Contact Proview to renew.';
  if (L.state === 'grace') return h('div', { class: 'notice' }, `This TV's licence expired on ${fmtDate(L.expires)}. It will keep playing for ${L.graceLeft} more day${L.graceLeft === 1 ? '' : 's'}, then show “Licence expired”. ${who}`);
  if (L.state === 'expired') return h('div', { class: 'notice' }, `This TV's licence expired on ${fmtDate(L.expires)} and the ${GRACE_DAYS}-day grace period is over. The TV is showing “Licence expired” and can't be published to. ${who}`);
  if (L.state === 'expiring') return h('div', { class: 'notice info' }, `${L.type === 'trial7' ? 'Trial' : 'Licence'} ends ${fmtDate(L.expires)} (${L.daysLeft} day${L.daysLeft === 1 ? '' : 's'}). ${who}`);
  if (L.state === 'none') return h('div', { class: 'notice' }, `This TV has no licence${screen.trial_blocked_reason ? ` (${screen.trial_blocked_reason})` : ''} and isn't playing. ${who}`);
  return null;
}

/** Admin dialog to set or extend a TV's licence. */
export function licenseDialog(screen, onDone) {
  const cur = licenseState(screen);
  let type = 'm12';
  const canExtend = ['active', 'expiring'].includes(cur.state);
  let extend = canExtend;
  const custom = h('input', { type: 'date', min: new Date().toISOString().slice(0, 10) });
  const notes = h('input', { type: 'text', value: screen.license_notes || '', placeholder: 'e.g. Invoice #1042, paid by card' });
  const preview = h('div', { class: 'onair', style: { padding: '12px 16px' } });
  const customWrap = h('div', { class: 'hidden' }, field('Licence ends on', custom));
  const extendWrap = canExtend
    ? h('label', { class: 'row small', style: { fontWeight: 600 } },
        h('input', { type: 'checkbox', checked: extend, onchange: (e) => { extend = e.target.checked; paint(); } }),
        `Add on top of the current end date (${fmtDate(cur.expires)})`)
    : h('div', { class: 'tiny' }, 'The new licence starts today.');

  const paint = () => {
    customWrap.classList.toggle('hidden', type !== 'custom');
    extendWrap.classList.toggle('hidden', ['lifetime', 'custom'].includes(type));
    const exp = previewExpiry(type, { extend, current: screen.license_expires_at, custom: custom.value });
    preview.replaceChildren(h('span', { class: 'live', style: { background: 'var(--accent)' } }, 'NEW'),
      h('div', {}, h('div', { style: { fontWeight: 700 } }, licenseLabel(type)),
        h('div', { class: 'tiny', style: { color: '#bbb' } }, exp === null ? 'Never expires' : exp ? `Ends ${fmtDate(exp)}` : 'Pick an end date')));
  };
  custom.addEventListener('input', paint);

  const currentText = cur.state === 'none' ? 'No licence'
    : cur.state === 'lifetime' ? 'Lifetime'
    : `${licenseLabel(screen.license_type)} · ${cur.daysLeft >= 0 ? 'ends' : 'ended'} ${fmtDate(cur.expires)}`;

  modal({
    title: `Licence: ${screen.name}`,
    body: [
      h('div', { class: 'row between small' }, h('span', { class: 'muted' }, 'Current'), h('span', { style: { fontWeight: 600 } }, currentText)),
      field('New licence', select(LICENSE_TYPES, type, (v) => { type = v; paint(); })),
      customWrap, extendWrap, field('Notes', notes, 'Internal reference, e.g. invoice number.'), preview,
    ],
    actions: [
      { label: 'Cancel' },
      { label: 'Save licence', class: 'primary', onClick: async () => {
        if (type === 'custom' && !custom.value) throw new Error('Pick an end date');
        const s = await rpc('set_screen_license', {
          p_screen: screen.id, p_type: type, p_extend: extend && !['lifetime', 'custom'].includes(type),
          p_expires: type === 'custom' ? new Date(custom.value + 'T23:59:59').toISOString() : null,
          p_notes: notes.value || null,
        });
        toast(`Licence saved: ${licenseSummary(s).text}`);
        onDone?.(s);
      } },
    ],
  });
  paint();
}
