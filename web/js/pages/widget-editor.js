// Inspector fields for widget slides, and the playlist layout dialog.
import { h, field, select, toast, modal, errMsg } from '../core.js';
import { WIDGET_TYPES, geocode, youtubeId } from '../widgets.js';
import { LAYOUTS } from '../renderer.js';

/** Fields for the selected widget slide. change(fn) mutates + saves; repaint() redraws the inspector. */
export function widgetFields(s, change, repaint) {
  const w = s.widget || (s.widget = {});
  const set = (k, v, opts) => change((x) => { x.widget = { ...(x.widget || {}), [k]: v }; }, opts);
  const out = [h('div', { class: 'section-title' }, WIDGET_TYPES[s.type])];

  if (s.type === 'clock') {
    out.push(
      h('label', { class: 'row small', style: { fontWeight: 600 } }, h('input', { type: 'checkbox', checked: w.h24 !== false, onchange: (e) => set('h24', e.target.checked) }), '24-hour clock'),
      h('label', { class: 'row small', style: { fontWeight: 600 } }, h('input', { type: 'checkbox', checked: !!w.seconds, onchange: (e) => set('seconds', e.target.checked) }), 'Show seconds'),
      h('label', { class: 'row small', style: { fontWeight: 600 } }, h('input', { type: 'checkbox', checked: w.date !== false, onchange: (e) => set('date', e.target.checked) }), 'Show date'),
      field('Time zone', select([['', 'The TV’s own time zone'], ['Europe/London', 'London'], ['Europe/Paris', 'Paris'], ['Europe/Istanbul', 'Istanbul'], ['America/New_York', 'New York'], ['Asia/Dubai', 'Dubai'], ['Asia/Tokyo', 'Tokyo']], w.tz || '', (v) => set('tz', v))));
  }

  if (s.type === 'weather') {
    const place = h('input', { type: 'text', value: w.place || '', placeholder: 'Town or postcode area' });
    out.push(
      h('div', { class: 'full' }, field('Location', h('div', { class: 'row', style: { flexWrap: 'nowrap' } }, h('div', { class: 'grow' }, place),
        h('button', { class: 'btn sm', type: 'button', onclick: async () => {
          try { const g = await geocode(place.value.trim()); change((x) => { x.widget = { ...x.widget, ...g }; }); toast(`Weather for ${g.place}`); repaint(); }
          catch (e) { toast(errMsg(e), true); }
        } }, 'Find')), `Currently: ${w.place || '—'}`)),
      field('Forecast days', select([['0', 'Today only'], ['3', '3 days'], ['4', '4 days'], ['5', '5 days'], ['6', '6 days']], String(w.days ?? 4), (v) => set('days', Number(v)))),
      field('Units', select([['c', '°C'], ['f', '°F']], w.unit || 'c', (v) => set('unit', v))));
  }

  if (s.type === 'qr') {
    out.push(
      h('div', { class: 'full' }, field('Link the QR code opens', h('input', { type: 'url', value: w.url || '', placeholder: 'https://…', onchange: (e) => set('url', e.target.value.trim()) }))),
      h('div', { class: 'full' }, field('Caption under the code', h('input', { type: 'text', value: w.caption || '', oninput: (e) => set('caption', e.target.value) }))));
  }

  if (s.type === 'menu') {
    const rows = h('div', { class: 'stack full', style: { gap: '6px' } });
    const paintRows = () => rows.replaceChildren(...(w.items || []).map((it, i) => h('div', { class: 'row', style: { flexWrap: 'nowrap', gap: '6px' } },
      h('input', { type: 'text', value: it.name, placeholder: 'Item', style: { flex: '2' }, oninput: (e) => change((x) => { x.widget.items[i].name = e.target.value; }) }),
      h('input', { type: 'text', value: it.price, placeholder: '£0.00', style: { flex: '1', minWidth: '70px' }, oninput: (e) => change((x) => { x.widget.items[i].price = e.target.value; }) }),
      h('input', { type: 'text', value: it.desc || '', placeholder: 'Description (optional)', style: { flex: '3' }, oninput: (e) => change((x) => { x.widget.items[i].desc = e.target.value; }) }),
      h('button', { class: 'btn sm ghost icon danger', type: 'button', title: 'Remove', onclick: () => { change((x) => x.widget.items.splice(i, 1)); paintRows(); } }, '×'))));
    paintRows();
    out.push(
      field('Heading', h('input', { type: 'text', value: w.title || '', oninput: (e) => set('title', e.target.value) })),
      field('Columns', select([['1', '1'], ['2', '2'], ['3', '3']], String(w.columns || 2), (v) => set('columns', Number(v)))),
      h('div', { class: 'full tiny' }, 'Items'),
      rows,
      h('div', { class: 'full' }, h('button', { class: 'btn sm', type: 'button', onclick: () => { change((x) => (x.widget.items = [...(x.widget.items || []), { name: '', price: '', desc: '' }])); paintRows(); } }, '+ Add item')));
  }

  if (s.type === 'web') {
    out.push(
      h('div', { class: 'full' }, field('Web address', h('input', { type: 'url', value: w.url || '', placeholder: 'https://…', onchange: (e) => set('url', e.target.value.trim()) }),
        'Shown live. Many big sites (Google, Facebook, banks) block being shown inside other apps; dashboards, menus and your own pages usually work.')),
      field('Zoom', select([['0.5', '50%'], ['0.75', '75%'], ['1', '100%'], ['1.25', '125%'], ['1.5', '150%'], ['2', '200%']], String(w.zoom || 1), (v) => set('zoom', Number(v)))));
  }

  if (s.type === 'youtube') {
    out.push(
      h('div', { class: 'full' }, field('YouTube link', h('input', { type: 'url', value: w.url || '', placeholder: 'https://www.youtube.com/watch?v=…', onchange: (e) => {
        if (e.target.value && !youtubeId(e.target.value)) toast('That doesn’t look like a YouTube link', true);
        set('url', e.target.value.trim());
      } }), 'Needs internet on the TV. Set how long it shows under Timing.')),
      h('label', { class: 'row small', style: { fontWeight: 600 } }, h('input', { type: 'checkbox', checked: !!w.sound, onchange: (e) => set('sound', e.target.checked) }), 'Play sound on TV'));
  }
  return out;
}

/** Playlist layout: full screen, side panel, ticker. */
export function layoutDialog(pl, playlists, onSave) {
  const st = { layout: 'full', ticker: { text: '', speed: 'normal', bg: '#ff5a1f', color: '#ffffff' }, ...pl.settings };
  st.ticker = { speed: 'normal', bg: '#ff5a1f', color: '#ffffff', ...(pl.settings.ticker || {}) };
  const others = playlists.filter((p) => p.id !== pl.id);
  const sideWrap = h('div', { class: 'stack' });
  const tickWrap = h('div', { class: 'stack' });
  const text = h('textarea', { rows: 3, value: st.ticker.text || '', placeholder: 'One message per line, e.g.\nFree Wi-Fi: CAFE-GUEST\nOpen 7am–7pm every day' });
  const paint = () => {
    sideWrap.classList.toggle('hidden', !st.layout.includes('side'));
    tickWrap.classList.toggle('hidden', !st.layout.includes('ticker'));
  };
  sideWrap.append(field('Side panel shows playlist', select([['', '— Choose a playlist —'], ...others.map((p) => [p.id, `${p.name}${p.settings?.orientation === 'portrait' ? '' : ' (landscape: will be letterboxed)'}`])], st.side_playlist_id || '', (v) => (st.side_playlist_id = v || null)),
    'Tip: make a Portrait playlist for the side panel, e.g. offers, a clock or weather.'));
  tickWrap.append(field('Ticker text', text),
    h('div', { class: 'grid3' },
      field('Speed', select([['slow', 'Slow'], ['normal', 'Normal'], ['fast', 'Fast']], st.ticker.speed, (v) => (st.ticker.speed = v))),
      field('Background', h('input', { type: 'color', value: st.ticker.bg, oninput: (e) => (st.ticker.bg = e.target.value) })),
      field('Text colour', h('input', { type: 'color', value: st.ticker.color, oninput: (e) => (st.ticker.color = e.target.value) }))));
  paint();
  modal({
    title: 'Screen layout',
    body: [
      pl.settings.orientation === 'portrait' ? h('div', { class: 'notice info' }, 'Layouts are for landscape playlists. Switch this playlist to Landscape to use them.') : null,
      field('Layout', select(LAYOUTS, st.layout, (v) => { st.layout = v; paint(); })),
      sideWrap, tickWrap,
    ],
    actions: [{ label: 'Cancel' }, { label: 'Save layout', class: 'primary', onClick: () => {
      st.ticker.text = text.value;
      if (st.layout.includes('side') && !st.side_playlist_id) throw new Error('Choose a playlist for the side panel');
      if (st.layout.includes('ticker') && !text.value.trim()) throw new Error('Enter the ticker text');
      onSave({ layout: st.layout, side_playlist_id: st.side_playlist_id || null, ticker: st.ticker });
    } }],
  });
}
