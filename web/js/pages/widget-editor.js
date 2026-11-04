// Inspector fields for widget slides, and the playlist layout dialog.
import { h, field, select, toast, modal, errMsg } from '../core.js';
import { WIDGET_TYPES, geocode, youtubeId } from '../widgets.js';
import { LAYOUTS, normLayout, layoutZones, zoneCount, zonePlaylistIds } from '../renderer.js';

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
    const paintRows = () => rows.replaceChildren(...(s.widget?.items || []).map((it, i) => h('div', { class: 'row', style: { flexWrap: 'nowrap', gap: '6px' } },
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
/** Small picture of a layout (areas numbered). */
export function layoutDiagram(layout, portrait = false, active = false) {
  const W = portrait ? 54 : 96, H = portrait ? 96 : 54;
  const box = h('div', { class: 'lay-diagram' + (active ? ' on' : ''), style: { width: W + 'px', height: H + 'px' } });
  layoutZones(layout, portrait ? 1080 : 1920, portrait ? 1920 : 1080).forEach(([x, y, w, hh], i) => {
    const k = W / (portrait ? 1080 : 1920);
    box.append(h('div', { class: 'lay-zone' + (i === 0 ? ' main' : ''), style: { left: x * k + 'px', top: y * k + 'px', width: w * k + 'px', height: hh * k + 'px' } }, String(i + 1)));
  });
  return box;
}

export function layoutDialog(pl, playlists, onSave) {
  const portrait = pl.settings.orientation === 'portrait';
  const norm = normLayout(pl.settings);
  const st = { layout: norm.layout, ticker_on: norm.ticker, zones: zonePlaylistIds(pl.settings), ticker: { text: '', speed: 'normal', bg: '#3f6fd0', color: '#ffffff', ...(pl.settings.ticker || {}) } };
  const others = playlists.filter((p) => p.id !== pl.id);
  const picker = h('div', { class: 'lay-grid' });
  const zonesWrap = h('div', { class: 'stack', style: { gap: '10px' } });
  const tickWrap = h('div', { class: 'stack' });
  const text = h('textarea', { rows: 3, value: st.ticker.text || '', placeholder: 'One message per line, e.g.\nFree Wi-Fi: CAFE-GUEST\nOpen 7am–7pm every day' });
  const tickOn = h('input', { type: 'checkbox', checked: st.ticker_on, onchange: (e) => { st.ticker_on = e.target.checked; paint(); } });

  const paint = () => {
    picker.replaceChildren(...Object.entries(LAYOUTS).map(([k, label]) =>
      h('button', { type: 'button', class: 'lay-card' + (st.layout === k ? ' on' : ''), onclick: () => { st.layout = k; paint(); } },
        layoutDiagram(k, portrait, st.layout === k), h('span', {}, label))));
    const n = zoneCount(st.layout);
    while (st.zones.length < n - 1) st.zones.push(null);
    zonesWrap.replaceChildren(...(n > 1 ? [
      h('div', { class: 'row', style: { gap: '12px', flexWrap: 'nowrap', alignItems: 'center' } }, layoutDiagram(st.layout, portrait),
        h('div', { class: 'tiny' }, `Area 1 plays this playlist (“${pl.name}”). Choose what plays in the other area${n > 2 ? 's' : ''}. Tip: a playlist with just one picture or video works too.`)),
      ...Array.from({ length: n - 1 }, (_, i) => field(`Area ${i + 2} plays`, select([['', '— Choose a playlist —'], ...others.map((p) => [p.id, p.name])], st.zones[i] || '', (v) => (st.zones[i] = v || null)))),
    ] : []));
    tickWrap.classList.toggle('hidden', !st.ticker_on);
  };
  tickWrap.append(field('Ticker text', text),
    h('div', { class: 'grid3' },
      field('Speed', select([['slow', 'Slow'], ['normal', 'Normal'], ['fast', 'Fast']], st.ticker.speed, (v) => (st.ticker.speed = v))),
      field('Background', h('input', { type: 'color', value: st.ticker.bg, oninput: (e) => (st.ticker.bg = e.target.value) })),
      field('Text colour', h('input', { type: 'color', value: st.ticker.color, oninput: (e) => (st.ticker.color = e.target.value) }))));
  paint();
  modal({
    title: 'Screen layout',
    wide: true,
    body: [
      h('div', { class: 'tiny' }, 'Split the screen into areas. Each area plays its own playlist at the same time.'),
      picker, zonesWrap,
      h('label', { class: 'row small', style: { fontWeight: 600 } }, tickOn, 'Add a scrolling ticker along the bottom'),
      tickWrap,
    ],
    actions: [{ label: 'Cancel' }, { label: 'Save layout', class: 'primary', onClick: () => {
      st.ticker.text = text.value;
      const n = zoneCount(st.layout);
      const zones = st.zones.slice(0, n - 1);
      const missing = zones.findIndex((z) => !z);
      if (missing >= 0) throw new Error(`Choose a playlist for area ${missing + 2}`);
      if (st.ticker_on && !text.value.trim()) throw new Error('Enter the ticker text');
      onSave({ layout: st.layout, zones, side_playlist_id: st.layout === 'side' ? zones[0] : null, ticker_on: st.ticker_on, ticker: st.ticker });
    } }],
  });
}
