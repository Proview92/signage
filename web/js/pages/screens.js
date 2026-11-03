import { sb, state, h, icon, q, rpc, toast, modal, field, select, timeAgo, isOnline, canManage, mediaUrl, needsPublish, currentClient } from '../core.js';
import { renderStill, resolveSchedule, isSlideActive } from '../renderer.js';
import { licenseBadge } from './license-ui.js';

export async function loadClientData(clientId) {
  const [screens, playlists, rules] = await Promise.all([
    q(sb.from('screens').select('*').eq('client_id', clientId).order('name')),
    q(sb.from('playlists').select('id,name,updated_at,slides,settings').eq('client_id', clientId).order('name')),
    q(sb.from('schedule_items').select('*').eq('client_id', clientId).order('priority', { ascending: false })),
  ]);
  return { screens, playlists, rules, byId: Object.fromEntries(playlists.map((p) => [p.id, p])) };
}

export function screenThumb(screen, contentOverride) {
  const box = h('div', { class: 'thumb' });
  const content = contentOverride ?? screen.content;
  const { playlistId } = resolveSchedule(content);
  const pl = playlistId && content.playlists[playlistId];
  const slide = pl?.slides?.find((s) => isSlideActive(s)) || pl?.slides?.[0];
  if (!slide) {
    box.append(h('div', { class: 'blank' }, screen.content ? 'Nothing scheduled right now' : 'Nothing published yet'));
    return box;
  }
  (async () => {
    const url = slide.path ? await mediaUrl(slide.path).catch(() => null) : null;
    renderStill(box, slide, url, pl.settings?.orientation);
  })();
  return box;
}

export function statusBadges(screen, rules, byId) {
  const out = [];
  out.push(isOnline(screen) ? h('span', { class: 'badge ok' }, 'Online') : h('span', { class: 'badge bad' }, screen.last_seen ? `Offline · ${timeAgo(screen.last_seen)}` : 'Offline'));
  if (needsPublish(screen, rules.filter((r) => r.screen_id === screen.id), byId)) out.push(h('span', { class: 'badge warn' }, 'Unpublished changes'));
  out.push(licenseBadge(screen));
  return out;
}

export function pairDialog({ fixedClient, clients, onDone }) {
  const code = h('input', { type: 'text', class: 'code-input', maxLength: 6, placeholder: 'ABC123', autocomplete: 'off', autocapitalize: 'characters' });
  const name = h('input', { type: 'text', placeholder: 'e.g. Reception TV' });
  const loc = h('input', { type: 'text', placeholder: 'e.g. Ground floor (optional)' });
  let clientId = fixedClient || '';
  const pick = clients ? select([['', '— Assign later —'], ...clients.map((c) => [c.id, c.name])], clientId, (v) => (clientId = v)) : null;
  modal({
    title: 'Add a TV',
    body: [
      h('div', { class: 'notice info' }, 'Open the PROVIEW SIGNAGE app on the TV. It shows a 6-character code — type it below.'),
      field('Pairing code', code),
      field('Screen name', name),
      field('Location', loc),
      pick ? field('Client', pick, 'Which client will manage this TV?') : null,
    ],
    actions: [
      { label: 'Cancel' },
      { label: 'Pair TV', class: 'primary', onClick: async () => {
        if (code.value.trim().length < 6) throw new Error('Enter the 6-character code shown on the TV');
        const s = await rpc('claim_screen', { p_code: code.value, p_name: name.value || null, p_client: clientId || null });
        if (loc.value.trim()) await q(sb.from('screens').update({ location: loc.value.trim() }).eq('id', s.id));
        if (s.license_type === 'trial7') toast(`${s.name} paired — 7-day trial started`);
        else if (s.license_type) toast(`${s.name} paired`);
        else toast(`${s.name} paired, but no free trial: ${s.trial_blocked_reason || 'this device needs a licence'}`, true);
        onDone?.(s);
      } },
    ],
  });
}

export async function screensPage({ main, go }) {
  const client = currentClient();
  let data = await loadClientData(state.clientId);

  const paint = () => {
    const { screens, rules, byId } = data;
    const head = h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Screens'), h('p', { class: 'muted' }, `${screens.length} TV${screens.length === 1 ? '' : 's'} for ${client.name}`)),
      canManage() ? h('button', { class: 'btn primary', onclick: () => pairDialog({ fixedClient: state.clientId, onDone: (s) => go('screen/' + s.id) }) }, icon('plus'), 'Add a TV') : null);

    if (!screens.length) {
      return main.replaceChildren(head, h('div', { class: 'card empty' },
        h('h2', {}, 'No TVs yet'),
        h('p', {}, canManage() ? 'Install the PROVIEW SIGNAGE app on your Android TV or Fire TV stick, open it, and pair it with the code it shows.' : 'Your manager hasn’t added any TVs to this account yet.'),
        canManage() ? h('button', { class: 'btn primary', onclick: () => pairDialog({ fixedClient: state.clientId, onDone: (s) => go('screen/' + s.id) }) }, icon('plus'), 'Add a TV') : null));
    }

    const cards = h('div', { class: 'cards' }, screens.map((s) => {
      const { playlistId, rule } = resolveSchedule(s.content);
      const now = playlistId ? s.content.playlists[playlistId]?.name : null;
      return h('a', { class: 'card screen-card', href: '#/screen/' + s.id },
        screenThumb(s),
        h('div', { class: 'screen-meta' },
          h('div', { class: 'row between' }, h('h3', {}, s.name), h('span', { class: 'tiny' }, s.location || '')),
          h('div', { class: 'small muted' }, now ? `Playing: ${now}${rule?.label ? ` · ${rule.label}` : ''}` : 'Idle'),
          h('div', { class: 'row', style: { gap: '6px' } }, statusBadges(s, rules, byId))));
    }));
    main.replaceChildren(head, cards);
  };
  paint();

  const t = setInterval(async () => { try { data = await loadClientData(state.clientId); paint(); } catch {} }, 30000);
  return () => clearInterval(t);
}
