import { sb, state, h, icon, q, toast, confirmBox, timeAgo, fmtDuration, mediaUrl } from '../core.js';
import { renderStill, LAYOUTS, layoutLabel } from '../renderer.js';
import { layoutDiagram } from './widget-editor.js';
import { templateGallery } from './templates.js';
import { showOnTvsDialog } from './show-on-tvs.js';
import { pickMedia } from './media.js';
import { newSlide } from '../renderer.js';
import { modal, field } from '../core.js';

export function playlistLength(p) {
  return (p.slides || []).reduce((t, s) => t + (Number(s.duration) > 0 ? Number(s.duration) : (s.video_duration || 10)), 0);
}

export async function playlistsPage({ main, go }) {
  const [playlists, screens, rules] = await Promise.all([
    q(sb.from('playlists').select('*').eq('client_id', state.clientId).order('updated_at', { ascending: false })),
    q(sb.from('screens').select('id,default_playlist_id').eq('client_id', state.clientId)),
    q(sb.from('schedule_items').select('screen_id,playlist_id').eq('client_id', state.clientId)),
  ]);
  const usedOn = (pid) => new Set([...screens.filter((s) => s.default_playlist_id === pid).map((s) => s.id), ...rules.filter((r) => r.playlist_id === pid).map((r) => r.screen_id)]).size;

  // New playlist: name, landscape or portrait, and a layout, then straight into the editor.
  const create = () => {
    const st = { orientation: 'landscape', layout: 'full' };
    const name = h('input', { type: 'text', value: '', placeholder: 'e.g. Breakfast menu, Window promos', required: true, autocomplete: 'off', oninput: () => name.classList.remove('invalid') });
    const orientEl = h('div', { class: 'orient-grid' });
    const layoutEl = h('div', { class: 'lay-grid' });
    const paint = () => {
      const portrait = st.orientation === 'portrait';
      orientEl.replaceChildren(...[['landscape', 'Landscape', 'TV mounted wide (16:9)'], ['portrait', 'Portrait', 'TV mounted tall (9:16)']].map(([v, l, d]) =>
        h('button', { type: 'button', class: 'orient-card' + (st.orientation === v ? ' on' : ''), onclick: () => { st.orientation = v; paint(); } },
          h('span', { class: 'orient-shape ' + v }), h('span', {}, h('b', {}, l), h('small', {}, d)))));
      layoutEl.replaceChildren(...Object.keys(LAYOUTS).map((k) =>
        h('button', { type: 'button', class: 'lay-card' + (st.layout === k ? ' on' : ''), onclick: () => { st.layout = k; paint(); } },
          layoutDiagram(k, portrait, st.layout === k), h('span', {}, layoutLabel(k, portrait)))));
    };
    paint();
    modal({
      title: 'New playlist',
      wide: true,
      body: [
        field('Playlist name (required)', name),
        h('div', { class: 'small', style: { fontWeight: 600 } }, 'Screen orientation'),
        orientEl,
        h('div', { class: 'small', style: { fontWeight: 600 } }, 'Layout'),
        h('div', { class: 'tiny', style: { marginTop: '-6px' } }, 'Split the screen into areas, or keep it full screen. You can change this later.'),
        layoutEl,
      ],
      actions: [{ label: 'Cancel' }, { label: 'Create and edit', class: 'primary', onClick: async () => {
        const n = name.value.trim();
        if (!n) { name.classList.add('invalid'); name.focus(); throw new Error('Please give the playlist a name'); }
        const p = await q(sb.from('playlists').insert({ client_id: state.clientId, name: n, slides: [], settings: { orientation: st.orientation, layout: st.layout } }).select().single());
        go('playlist/' + p.id);
      } }],
    });
  };

  const head = h('div', { class: 'page-head' },
    h('div', {}, h('h1', {}, 'Playlists'), h('p', { class: 'muted' }, 'Build slideshows from your pictures, videos and text, then schedule them on your TVs.')),
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => templateGallery(go) }, 'From template'),
      h('button', { class: 'btn primary', onclick: create }, icon('plus'), 'New playlist')));

  if (!playlists.length) {
    return main.replaceChildren(head, h('div', { class: 'card empty' }, h('h2', {}, 'No playlists yet'),
      h('p', {}, 'A playlist is a set of slides — pictures, videos or text — with transitions and effects.'),
      h('div', { class: 'row', style: { justifyContent: 'center' } },
        h('button', { class: 'btn', onclick: () => templateGallery(go) }, 'Start from a template'),
        h('button', { class: 'btn primary', onclick: create }, icon('plus'), 'Blank playlist'))));
  }

  main.replaceChildren(head, h('div', { class: 'cards' }, playlists.map((p) => {
    const thumb = h('div', { class: 'thumb' });
    const first = p.slides?.[0];
    if (first) mediaUrl(first.path).catch(() => null).then((u) => renderStill(thumb, first, u, p.settings?.orientation));
    else thumb.append(h('div', { class: 'blank' }, 'Empty'));
    const n = usedOn(p.id);
    return h('div', { class: 'card screen-card' },
      h('a', { href: '#/playlist/' + p.id, style: { textDecoration: 'none' } }, thumb),
      h('div', { class: 'screen-meta' },
        h('div', { class: 'row between' }, h('a', { href: '#/playlist/' + p.id, style: { textDecoration: 'none' } }, h('h3', {}, p.name)),
          h('div', { class: 'row', style: { gap: '4px' } },
            h('a', { class: 'btn sm', href: '#/playlist/' + p.id, title: 'Edit slides, timings and layout' }, icon('edit'), 'Edit'),
            h('button', { class: 'btn sm', title: 'Choose which TVs show this playlist', onclick: () => showOnTvsDialog(p, { onDone: () => window.dispatchEvent(new HashChangeEvent('hashchange')) }) }, 'Publish'),
            h('button', { class: 'btn ghost icon sm', title: 'Duplicate', onclick: async () => {
              const c = await q(sb.from('playlists').insert({ client_id: state.clientId, name: p.name + ' (copy)', slides: p.slides, settings: p.settings }).select().single());
              toast('Duplicated'); go('playlist/' + c.id);
            } }, icon('dup')),
            h('button', { class: 'btn ghost icon sm danger', title: 'Delete', onclick: async () => {
              if (!(await confirmBox('Delete playlist?', n ? `“${p.name}” is scheduled on ${n} TV${n > 1 ? 's' : ''}. Its schedule rules will be removed too. Already-published TVs keep playing it until you publish again.` : `“${p.name}” will be deleted.`))) return;
              await q(sb.from('playlists').delete().eq('id', p.id));
              toast('Deleted'); go('playlists'); window.dispatchEvent(new HashChangeEvent('hashchange'));
            } }, icon('trash')))),
        h('div', { class: 'small muted' }, `${p.slides.length} slide${p.slides.length === 1 ? '' : 's'} · ${fmtDuration(playlistLength(p))}${p.settings?.orientation === 'portrait' ? ' · Portrait' : ''}`),
        h('div', { class: 'row', style: { gap: '6px' } },
          h('span', { class: 'badge plain' }, n ? `On ${n} TV${n > 1 ? 's' : ''}` : 'Not scheduled'),
          h('span', { class: 'tiny' }, 'Edited ' + timeAgo(p.updated_at)))));
  })));
}
