import { publishOrRequest } from '../core.js';
import { sb, state, h, icon, q, rpc, toast, modal, field, select, confirmBox, mediaUrl, fmtDuration, errMsg } from '../core.js';
import { layoutWithTicker, ITEM_TYPES, newItem, areaPixels } from '../renderer.js';
import { SlidePlayer, LayoutPlayer, LAYOUTS, layoutLabel, normLayout, zoneCount, zonePlaylistIds, renderStill, newSlide, TRANSITIONS, EFFECTS, TEXT_ANIMS, TEXT_POSITIONS, BACKGROUNDS, DAY_NAMES } from '../renderer.js';
import { pickMedia } from './media.js';
import { playlistLength } from './playlists.js';
import { WIDGET_TYPES, widgetDefaults, isWidget } from '../widgets.js';
import { widgetFields, layoutDialog, layoutDiagram } from './widget-editor.js';
import { showOnTvsDialog } from './show-on-tvs.js';

export async function editorPage({ main, params: [id], go }) {
  const pl = await q(sb.from('playlists').select('*').eq('id', id).single());
  pl.settings = pl.settings || {};
  const allPlaylists = await q(sb.from('playlists').select('id,name,slides,settings').eq('client_id', state.clientId));
  const lookup = (pid) => (pid === pl.id ? pl : allPlaylists.find((x) => x.id === pid)) || null;
  let sel = pl.slides.length ? 0 : -1;
  let selItem = null;   // id of the widget box being edited on the current slide
  // Split-screen: which area of the layout we're editing (slides carry .zone = area index)
  let area = 0;
  const areaCount = () => zoneCount(normLayout(pl.settings).layout);
  const inArea = (s) => areaCount() < 2 || (s.zone || 0) === area;
  const areaIdx = () => pl.slides.map((s, i) => (inArea(s) ? i : -1)).filter((i) => i >= 0);
  const insertAt = () => (sel >= 0 && inArea(pl.slides[sel]) ? sel + 1 : (areaIdx().at(-1) ?? pl.slides.length - 1) + 1);
  const zoneProp = () => (areaCount() > 1 && area > 0 ? { zone: area } : {});
  // In a split layout, pictures and videos are fitted inside their area instead of being cut off.
  const areaFit = () => (areaCount() > 1 ? 'stretch' : 'cover');
  delete pl.settings.auto_publish;   // option removed: TVs update when you press Update TVs / Publish
  let saveTimer = null, saving = false, dirty = false, player = null, previewTimer = null;

  // ------------------------------------------------ saving
  const status = h('span', { class: 'tiny' }, 'All changes saved');
  let savingP = null;
  const save = async () => {
    clearTimeout(saveTimer);
    while (savingP) await savingP.catch(() => {});   // let a save in progress finish first
    if (!dirty) return;
    let done; savingP = new Promise((r) => (done = r));
    saving = true; dirty = false; status.textContent = 'Saving…';
    try {
      await q(sb.from('playlists').update({ name: pl.name, slides: pl.slides, settings: pl.settings }).eq('id', id));
      status.textContent = 'All changes saved';
    } catch (e) { dirty = true; status.textContent = 'Not saved'; toast(errMsg(e), true); }
    saving = false; savingP = null; done();
    if (dirty) schedule();
  };
  const schedule = () => { dirty = true; status.textContent = 'Unsaved changes…'; clearTimeout(saveTimer); saveTimer = setTimeout(save, 700); };
  const beforeUnload = (e) => { if (dirty) { save(); e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);

  // ------------------------------------------------ actions
  async function addMedia() {
    const picked = await pickMedia({ multiple: true });
    if (!picked?.length) return;
    const slides = picked.map((m) => newSlide({
      type: m.kind, media_id: m.id, path: m.path, name: m.name,
      duration: m.kind === 'video' ? 0 : 8, video_duration: m.duration_s ? Number(m.duration_s) : undefined,
      effect: 'none', fit: areaFit(m.kind), text: { ...newSlide().text, title: '', subtitle: '' }, ...zoneProp(),
    }));
    const at = insertAt();
    pl.slides.splice(at, 0, ...slides);
    sel = at; schedule(); paint();
  }
  function addText() {
    const s = newSlide({ type: 'text', bg: 'linear-gradient(135deg,#1e3a8a,#7c3aed)', text: { title: 'Your headline', subtitle: 'Add a line of detail here', position: 'center', color: '#ffffff', size: 'l', box: false, anim: 'fade-up' }, ...zoneProp() });
    const at = insertAt();
    pl.slides.splice(at, 0, s);
    sel = at; schedule(); paint();
  }
  // A slide shows the text-overlay settings only once an overlay has been added (text slides always).
  const hasOverlay = (x) => x.type === 'text' || !!(x.text && (x.text.on || x.text.title || x.text.subtitle));
  function addWidget() {
    const cur = pl.slides[sel];
    // Widgets go on top of the selected slide (drag to place), or become a full-screen slide of their own.
    let where = cur ? 'on' : 'slide';
    let type = cur ? 'text' : 'clock';
    const desc = { text: 'Headline and a line of text', clock: 'Time and date', weather: 'Current weather + forecast (needs internet)', qr: 'Scan-to-open link',
      menu: 'Items with prices, in columns', web: 'Show a live web page', youtube: 'Play a YouTube video (needs internet)' };
    const list = h('div', { class: 'stack', style: { gap: '8px' } });
    const paintList = () => {
      const types = where === 'on' ? ITEM_TYPES : WIDGET_TYPES;
      if (!types[type]) type = Object.keys(types)[0];
      list.replaceChildren(...Object.entries(types).map(([k, l]) =>
        h('label', { class: 'row', style: { fontWeight: 600, gap: '10px' } }, h('input', { type: 'radio', name: 'wt', value: k, checked: k === type, onchange: () => (type = k) }), l,
          h('span', { class: 'tiny', style: { fontWeight: 400 } }, desc[k] || ''))));
    };
    paintList();
    modal({ title: 'Add a widget', body: [
      cur ? h('div', { class: 'seg', style: { marginBottom: '6px' } },
        ...[['on', 'On this slide (drag to place)'], ['slide', 'As a full-screen slide']].map(([v, l]) =>
          h('button', { type: 'button', class: where === v ? 'on' : '', onclick: (e) => { where = v; [...e.currentTarget.parentNode.children].forEach((b) => b.classList.toggle('on', b === e.currentTarget)); paintList(); } }, l))) : null,
      list],
    actions: [{ label: 'Cancel' }, { label: 'Add', class: 'primary', onClick: () => {
      if (where === 'on' && cur) {
        const it = newItem(type, widgetDefaults);
        (cur.items || (cur.items = [])).push(it);
        selItem = it.id;
        schedule(); paint();
        setTimeout(() => inspEl.querySelector('.items-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
        toast('Drag the box on the preview to move it. Drag its corner to resize.');
        return;
      }
      const d = widgetDefaults(type);
      const s = newSlide({ type, transition: 'none', effect: 'none', duration: d.duration || 10, ...d,
        text: { ...newSlide().text, title: '', subtitle: '', ...(d.text || {}) }, ...zoneProp() });
      const at = insertAt();
      pl.slides.splice(at, 0, s); sel = at; schedule(); paint();
    } }] });
  }
  async function deleteSlide(i) {
    if (!(await confirmBox('Delete slide?', 'This removes the slide from the playlist (the file stays in your media library).'))) return;
    pl.slides.splice(i, 1);
    if (sel >= pl.slides.length) sel = pl.slides.length - 1;
    else if (i < sel) sel--;
    schedule(); paint();
  }
  function move(from, to) {
    if (to < 0 || to >= pl.slides.length || from === to) return;
    const [s] = pl.slides.splice(from, 1);
    pl.slides.splice(to, 0, s);
    sel = to; schedule(); paint();
  }
  let autoTimer = null;
  function autoPublish() {
    clearTimeout(autoTimer);
    autoTimer = setTimeout(async () => {
      try {
        const r = await publishOrRequest('playlist', id, pl.name);
        status.textContent = r.pending ? 'Saved · waiting for approval' : r.published ? `Saved · live on ${r.published} TV${r.published === 1 ? '' : 's'}` : 'Saved · not on any TV yet (use Publish)';
      } catch (e) { status.textContent = 'Saved · TVs not updated'; }
    }, 4000);
  }

  // ------------------------------------------------ preview
  const previewBox = h('div', { class: 'preview-box' });
  // The shape of the area a slide plays in (split layouts), sized like the TV lays it out (short side = 1080).
  function areaShape(s) {
    if (!s || areaCount() < 2) return null;
    const portrait = pl.settings.orientation === 'portrait';
    const { layout, ticker } = normLayout(pl.settings);
    const plan = layoutWithTicker(layout, portrait ? 1080 : 1920, portrait ? 1920 : 1080, ticker && pl.settings.ticker?.text ? pl.settings.ticker : null, pl.settings.layout_split);
    const r = plan.zones[s.zone || 0] || plan.zones[0];
    const k = 1080 / Math.max(1, Math.min(r[2], r[3]));
    return { w: Math.round(r[2] * k), h: Math.round(r[3] * k) };
  }
  let playerShape = '';
  function refreshPreview(withTransition = false) {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(() => {
      const shape = areaShape(pl.slides[sel]);
      const shapeKey = shape ? `${shape.w}x${shape.h}` : (pl.settings.orientation || 'landscape');
      if (shape) {
        // Exactly the area's shape: as wide as the column allows, but not taller than the window.
        previewBox.className = 'preview-box area';
        const avail = previewBox.parentElement?.clientWidth || 640, maxH = Math.min(window.innerHeight * 0.62, 620);
        const wPx = Math.min(avail, maxH * shape.w / shape.h);
        Object.assign(previewBox.style, { aspectRatio: '', width: Math.round(wPx) + 'px', height: Math.round(wPx * shape.h / shape.w) + 'px' });
      } else {
        previewBox.className = 'preview-box' + (pl.settings.orientation === 'portrait' ? ' portrait' : '');
        Object.assign(previewBox.style, { aspectRatio: '', width: '', height: '' });
      }
      if (player && playerShape !== shapeKey) { player.clear(); player.host.destroy(); previewBox.replaceChildren(); player = null; }
      if (!player) player = new SlidePlayer(previewBox, { resolveUrl: (s) => mediaUrl(s.path), mutedOverride: true, size: shape || null });
      playerShape = shapeKey;
      if (!shape) player.host.setOrientation(pl.settings.orientation || 'landscape');
      const s = pl.slides[sel];
      if (!s) { player.clear(); return; }
      const prev = pl.slides[sel - 1] || pl.slides[pl.slides.length - 1];
      const one = { ...s, schedule: null };
      player.stop();
      if (withTransition && prev && prev !== s) {
        player.load({ slides: [{ ...prev, duration: 1.2, schedule: null, id: 'prev-' + prev.id }, one], settings: pl.settings });
      } else {
        player.load({ slides: [one], settings: pl.settings });
      }
      player.start();
      setTimeout(paintEditLayer, 60);
    }, 250);
  }

  function previewAll() {
    const box = h('div', { class: 'preview-box' + (pl.settings.orientation === 'portrait' ? ' portrait' : '') });
    const counter = h('span', { class: 'tiny' });
    const p = new LayoutPlayer(box, { resolveUrl: (s) => mediaUrl(s.path), lookup, onChange: ({ index, total }) => (counter.textContent = index >= 0 ? `Slide ${index + 1} of ${total}` : 'No slides are scheduled for right now') });
    p.load({ slides: pl.slides, settings: pl.settings });
    modal({ title: `Preview: ${pl.name}`, wide: true, body: [box, h('div', { class: 'row between' }, counter,
      h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: () => p.next() }, 'Next slide'),
        h('button', { class: 'btn sm', onclick: () => box.requestFullscreen?.() }, 'Full screen')))], onClose: () => p.stop() });
    p.start();
  }

  // ------------------------------------------------ slide list
  const listEl = h('div', { class: 'slides-list' });
  const areaEl = h('div', { class: 'area-wrap' });
  const rowThumbs = [];
  function slideTitle(s) {
    return s.text?.title || s.name || (s.type === 'text' ? 'Text slide' : s.type === 'video' ? 'Video' : WIDGET_TYPES[s.type] || 'Picture');
  }
  function areaTabs() {
    const n = areaCount();
    if (n < 2) return null;
    const portrait = pl.settings.orientation === 'portrait';
    const { layout, ticker } = normLayout(pl.settings);
    const zones = zonePlaylistIds(pl.settings);
    const px = areaPixels(layout, portrait, ticker && pl.settings.ticker?.text ? pl.settings.ticker : null, pl.settings.layout_split);
    return h('div', { class: 'area-tabs' },
      h('div', { class: 'tiny', style: { width: '100%' } }, 'Choose an area, then add slides to it:'),
      ...Array.from({ length: n }, (_, i) => {
        const count = pl.slides.filter((s) => (s.zone || 0) === i).length;
        const other = i > 0 && !count && zones[i - 1] ? allPlaylists.find((p) => p.id === zones[i - 1]) : null;
        return h('button', { type: 'button', class: 'area-tab' + (i === area ? ' on' : ''), onclick: () => { area = i; const first = areaIdx()[0]; sel = first ?? -1; paint(); } },
          layoutDiagram(layout, portrait, false, i, 40, null, pl.settings.layout_split),
          h('span', {}, h('b', {}, `Area ${i + 1}`), h('small', {}, other ? `Plays “${other.name}”` : `${count} slide${count === 1 ? '' : 's'}`),
            h('small', { class: 'area-px', title: 'Make pictures and videos for this area this size (double it for 4K)' }, `${px[i][0]} × ${px[i][1]} px`)));
      }));
  }
  function paintList() {
    rowThumbs.length = 0;
    let dragFrom = null;
    const idx = areaIdx();
    const nextIn = (i, dir) => idx[idx.indexOf(i) + dir];
    areaEl.replaceChildren(areaTabs() || '');
    listEl.replaceChildren(...pl.slides.map((s, i) => {
      if (!inArea(s)) return '';
      const n = idx.indexOf(i) + 1;
      const mini = h('div', { class: 'mini' });
      rowThumbs[i] = mini;
      paintThumb(i);
      const row = h('div', {
        class: 'slide-row' + (i === sel ? ' active' : ''), draggable: true,
        onclick: () => { sel = i; paint(); },
        ondragstart: (e) => { dragFrom = i; row.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(i)); },
        ondragend: () => row.classList.remove('dragging'),
        ondragover: (e) => { e.preventDefault(); row.classList.add('drop-before'); },
        ondragleave: () => row.classList.remove('drop-before'),
        ondrop: (e) => { e.preventDefault(); row.classList.remove('drop-before'); const from = dragFrom ?? Number(e.dataTransfer.getData('text/plain')); move(from, from < i ? i - 1 : i); },
      },
        h('div', { class: 'num', title: 'Drag to reorder' }, n),
        mini,
        h('div', { style: { minWidth: 0 } }, h('div', { class: 't' }, slideTitle(s)),
          h('div', { class: 's' }, `${s.type === 'video' && !(s.duration > 0) ? 'Full video' : (s.duration || 8) + 's'} · ${TRANSITIONS[s.transition] || 'Fade'}${s.schedule ? ' · ⏱' : ''}`)),
        h('div', { class: 'acts' },
          h('button', { type: 'button', title: 'Move earlier', 'aria-label': 'Move earlier', disabled: nextIn(i, -1) === undefined, onclick: (e) => { e.stopPropagation(); move(i, nextIn(i, -1)); } }, icon('up')),
          h('button', { type: 'button', title: 'Move later', 'aria-label': 'Move later', disabled: nextIn(i, 1) === undefined, onclick: (e) => { e.stopPropagation(); move(i, nextIn(i, 1)); } }, icon('down')),
          h('button', { type: 'button', class: 'del', title: 'Remove from playlist', 'aria-label': 'Remove slide', onclick: (e) => { e.stopPropagation(); deleteSlide(i); } }, icon('trash'))));
      return row;
    }),
    !idx.length && areaCount() > 1 ? h('div', { class: 'tiny', style: { padding: '8px 4px' } }, `Area ${area + 1} is empty. Add pictures, videos or text below.`) : '',
    h('div', { class: 'row', style: { padding: '6px 2px', gap: '6px', flexWrap: 'wrap' } },
      h('button', { class: 'btn sm', onclick: addMedia }, icon('media'), 'Add media'),
      h('button', { class: 'btn sm', onclick: addText }, icon('text'), 'Text slide'),
      h('button', { class: 'btn sm', onclick: addWidget }, icon('plus'), 'Widget')));
  }
  async function paintThumb(i) {
    const s = pl.slides[i], el = rowThumbs[i];
    if (!s || !el) return;
    const url = s.path ? await mediaUrl(s.path).catch(() => null) : null;
    renderStill(el, s, url, pl.settings.orientation, areaShape(s));
  }

  // Start / End date side by side. Empty = the slide shows all the time until it's stopped or deleted.
  function dateRange(s) {
    const fmt = (d) => new Date(d + 'T00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    const note = h('div', { class: 'tiny' });
    const paintNote = () => {
      const a = s.valid_from, b = s.valid_until;
      note.textContent = !a && !b ? 'No dates: this slide shows all the time, until you stop or delete it.'
        : a && b ? `Shows from ${fmt(a)} to the end of ${fmt(b)}.`
        : a ? `Starts on ${fmt(a)}, then shows until you stop or delete it.` : `Shows now until the end of ${fmt(b)}.`;
      if (a && b && b < a) note.textContent = '⚠ End date is before the start date, so this slide won’t show.';
    };
    const box = (key, label) => {
      const input = h('input', { type: 'date', value: s[key] || '', onclick: () => { try { input.showPicker?.(); } catch {} } });
      const clear = h('button', { class: 'date-clear', type: 'button', title: 'Clear date', 'aria-label': `Clear ${label}` }, '×');
      const ph = h('span', { class: 'date-ph' }, icon('calendar'), 'Not set');
      const sync = () => { clear.classList.toggle('hidden', !input.value); ph.classList.toggle('hidden', !!input.value); input.classList.toggle('empty', !input.value); };
      input.onchange = () => { change((x) => (x[key] = input.value || null)); s[key] = input.value || null; sync(); paintNote(); };
      clear.onclick = () => { input.value = ''; input.onchange(); };
      sync();
      return h('label', { class: 'field' }, label, h('div', { class: 'date-wrap' }, input, ph, clear));
    };
    paintNote();
    return h('div', { class: 'full stack', style: { gap: '6px' } }, h('div', { class: 'date-pair' }, box('valid_from', 'Start date'), box('valid_until', 'End date')), note);
  }

  // ------------------------------------------------ inspector
  const inspEl = h('div', { class: 'card-body' });
  function change(mut, { list = true, transition = false } = {}) {
    mut(pl.slides[sel]);
    schedule();
    if (list) {
      const row = listEl.children[sel];
      if (row) { row.querySelector('.t').textContent = slideTitle(pl.slides[sel]); }
      paintThumb(sel);
    }
    refreshPreview(transition);
  }

  // ------------------------------------------------ widgets placed on the slide
  function changeItem(id, mut, opts) {
    change((x) => { const it = (x.items || []).find((i) => i.id === id); if (it) mut(it); }, opts);
  }
  function itemsSection(s) {
    const items = s.items || [];
    if (selItem && !items.some((i) => i.id === selItem)) selItem = null;
    if (!items.length) return '';
    return h('div', { class: 'full stack items-section', style: { gap: '10px' } },
      h('div', { class: 'section-title' }, 'Widgets on this slide'),
      h('div', { class: 'tiny' }, 'Drag a box on the preview to move it, or drag its corner to resize.'),
      ...items.map((it) => {
        const open = it.id === selItem;
        const head = h('div', { class: 'row between item-head' + (open ? ' on' : ''), onclick: () => { selItem = open ? null : it.id; paintInspector(); paintEditLayer(); } },
          h('b', { class: 'small' }, ITEM_TYPES[it.type] || it.type, it.type === 'text' && it.text?.title ? ` · ${it.text.title.slice(0, 24)}` : ''),
          h('div', { class: 'row', style: { gap: '4px' } },
            h('button', { class: 'btn sm ghost', type: 'button', onclick: (e) => { e.stopPropagation(); selItem = it.id; paintInspector(); paintEditLayer(); } }, open ? 'Editing' : 'Edit'),
            h('button', { class: 'btn sm ghost danger', type: 'button', title: 'Remove this widget', onclick: (e) => { e.stopPropagation(); change((x) => { x.items = (x.items || []).filter((i) => i.id !== it.id); }); if (selItem === it.id) selItem = null; paintInspector(); } }, icon('trash'))));
        if (!open) return h('div', { class: 'item-card' }, head);
        const ch = (mut, opts) => changeItem(it.id, mut, opts);
        const fields = it.type === 'text'
          ? [h('div', { class: 'full' }, field('Headline', h('input', { type: 'text', value: it.text?.title || '', oninput: (e) => ch((x) => { x.text = { ...(x.text || {}), title: e.target.value }; }) }))),
             h('div', { class: 'full' }, field('Line of text', h('input', { type: 'text', value: it.text?.subtitle || '', oninput: (e) => ch((x) => { x.text = { ...(x.text || {}), subtitle: e.target.value }; }) }))),
             field('Align', select([['left', 'Left'], ['center', 'Centre'], ['right', 'Right']], it.align || 'left', (v) => ch((x) => (x.align = v))))]
          : widgetFields(it, (mut, opts) => ch(mut, opts), paintInspector).slice(1);
        return h('div', { class: 'item-card on' }, head,
          h('div', { class: 'inspector', style: { padding: 0, marginTop: '8px' } }, ...fields,
            field('Text colour', h('input', { type: 'color', value: it.color || '#ffffff', oninput: (e) => ch((x) => (x.color = e.target.value)) })),
            h('label', { class: 'row small', style: { fontWeight: 600, alignSelf: 'end' } }, h('input', { type: 'checkbox', checked: !!it.panel, onchange: (e) => ch((x) => (x.panel = e.target.checked)) }), 'Dark panel behind it')));
      }));
  }

  // Draggable boxes drawn over the preview, one per widget on the selected slide.
  const editLayer = h('div', { class: 'edit-layer' });
  function paintEditLayer() {
    const s = pl.slides[sel];
    const stage = previewBox.querySelector('.sg-stage');
    if (!previewBox.contains(editLayer)) previewBox.appendChild(editLayer);
    if (!s || !(s.items || []).length || !stage) { editLayer.replaceChildren(); return; }
    const pb = previewBox.getBoundingClientRect(), sr = stage.getBoundingClientRect();
    Object.assign(editLayer.style, { left: sr.left - pb.left + 'px', top: sr.top - pb.top + 'px', width: sr.width + 'px', height: sr.height + 'px' });
    editLayer.replaceChildren(...s.items.map((it) => {
      const box = h('div', { class: 'edit-box' + (it.id === selItem ? ' on' : ''), title: ITEM_TYPES[it.type] });
      const place = () => Object.assign(box.style, { left: it.x * 100 + '%', top: it.y * 100 + '%', width: it.w * 100 + '%', height: it.h * 100 + '%' });
      const live = () => previewBox.querySelectorAll(`.sg-item[data-id="${it.id}"]`).forEach((el) => { Object.assign(el.style, { left: it.x * 100 + '%', top: it.y * 100 + '%', width: it.w * 100 + '%', height: it.h * 100 + '%' }); el._fit?.(); });
      place();
      const grip = h('div', { class: 'edit-grip', title: 'Drag to resize' });
      box.append(h('span', { class: 'edit-label' }, ITEM_TYPES[it.type]), grip);
      const drag = (e, resize) => {
        e.preventDefault(); e.stopPropagation();
        if (selItem !== it.id) { selItem = it.id; paintInspector(); editLayer.querySelectorAll('.edit-box').forEach((b) => b.classList.toggle('on', b === box)); }
        const W = editLayer.clientWidth, H = editLayer.clientHeight, sx = e.clientX, sy = e.clientY, o = { x: it.x, y: it.y, w: it.w, h: it.h };
        const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
        const move = (ev) => {
          const dx = (ev.clientX - sx) / W, dy = (ev.clientY - sy) / H;
          if (resize) { it.w = clamp(o.w + dx, 0.05, 1 - it.x); it.h = clamp(o.h + dy, 0.05, 1 - it.y); }
          else { it.x = clamp(o.x + dx, 0, 1 - it.w); it.y = clamp(o.y + dy, 0, 1 - it.h); }
          place(); live();
        };
        const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); schedule(); paintThumb(sel); };
        window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
      };
      box.addEventListener('pointerdown', (e) => drag(e, false));
      grip.addEventListener('pointerdown', (e) => drag(e, true));
      return box;
    }));
  }
  const onResize = () => paintEditLayer();
  window.addEventListener('resize', onResize);

  function paintInspector() {
    const s = pl.slides[sel];
    if (!s) {
      inspEl.replaceChildren(h('div', { class: 'empty' }, h('h2', {}, 'Add your first slide'),
        h('p', {}, 'Use pictures and videos from your media library, or make a text slide.'),
        h('div', { class: 'row', style: { justifyContent: 'center' } },
          h('button', { class: 'btn primary', onclick: addMedia }, icon('media'), 'Add media'),
          h('button', { class: 'btn', onclick: addText }, icon('text'), 'Text slide'),
          h('button', { class: 'btn', onclick: addWidget }, icon('plus'), 'Widget'))));
      return;
    }
    const t = s.text || (s.text = { ...newSlide().text, title: '', subtitle: '' });
    const isVideo = s.type === 'video';

    // duration
    const fullVideo = h('input', { type: 'checkbox', checked: isVideo && !(s.duration > 0), onchange: (e) => { change((x) => (x.duration = e.target.checked ? 0 : 15)); paintInspector(); } });
    const dur = h('input', { type: 'number', min: 1, max: 3600, step: 1, value: s.duration > 0 ? s.duration : 8, disabled: isVideo && !(s.duration > 0), oninput: (e) => change((x) => (x.duration = Math.max(1, Number(e.target.value) || 8)), { list: true }) });

    // background swatches
    const sw = h('div', { class: 'swatches' }, Object.entries(BACKGROUNDS).map(([v, l]) =>
      h('button', { type: 'button', class: 'swatch' + (s.bg === v ? ' on' : ''), title: l, style: { background: v }, onclick: () => { change((x) => (x.bg = v)); paintInspector(); } })),
      h('input', { type: 'color', title: 'Custom colour', value: /^#/.test(s.bg) ? s.bg : '#000000', oninput: (e) => change((x) => (x.bg = e.target.value)) }));

    const posGrid = h('div', { class: 'pos-grid' }, Object.entries(TEXT_POSITIONS).map(([v, l]) =>
      h('button', { type: 'button', title: l, class: t.position === v ? 'on' : '', onclick: () => { change((x) => (x.text.position = v)); paintInspector(); } })));
    const sizeSeg = h('div', { class: 'seg' }, [['s', 'S'], ['m', 'M'], ['l', 'L'], ['xl', 'XL']].map(([v, l]) =>
      h('button', { type: 'button', class: t.size === v ? 'on' : '', onclick: () => { change((x) => (x.text.size = v)); paintInspector(); } }, l)));

    // per-slide schedule
    const sch = s.schedule;
    const schedOn = h('input', { type: 'checkbox', checked: !!sch, onchange: (e) => { change((x) => (x.schedule = e.target.checked ? { days: [1, 2, 3, 4, 5], from: '09:00', to: '17:00' } : null)); paintInspector(); } });
    const schedBody = sch ? h('div', { class: 'stack full' },
      h('div', { class: 'chips' }, [1, 2, 3, 4, 5, 6, 0].map((d) => h('button', { type: 'button', class: 'chip' + (sch.days?.includes(d) ? ' on' : ''), onclick: () => {
        change((x) => { const ds = x.schedule.days || []; x.schedule.days = ds.includes(d) ? ds.filter((y) => y !== d) : [...ds, d]; }); paintInspector(); } }, DAY_NAMES[d]))),
      h('label', { class: 'row small', style: { fontWeight: 600 } },
        h('input', { type: 'checkbox', checked: !!sch.per_day, onchange: (e) => {
          change((x) => {
            x.schedule.per_day = e.target.checked;
            if (e.target.checked) {   // start every day from the current times
              x.schedule.times = x.schedule.times || {};
              for (const d of x.schedule.days || []) x.schedule.times[d] ||= { from: x.schedule.from || '09:00', to: x.schedule.to || '17:00' };
            }
          });
          paintInspector();
        } }), 'Different times on each day'),
      sch.per_day
        ? h('div', { class: 'stack', style: { gap: '8px' } },
            [1, 2, 3, 4, 5, 6, 0].filter((d) => sch.days?.includes(d)).map((d) => {
              const t = sch.times?.[d] || { from: sch.from || '09:00', to: sch.to || '17:00' };
              const set = (k, v) => change((x) => { x.schedule.times ||= {}; x.schedule.times[d] = { ...(x.schedule.times[d] || t), [k]: v }; });
              return h('div', { class: 'day-times' },
                h('b', {}, DAY_NAMES[d]),
                h('input', { type: 'time', value: t.from || '', 'aria-label': `${DAY_NAMES[d]} from`, onchange: (e) => set('from', e.target.value) }),
                h('span', { class: 'tiny' }, 'to'),
                h('input', { type: 'time', value: t.to || '', 'aria-label': `${DAY_NAMES[d]} until`, onchange: (e) => set('to', e.target.value) }));
            }),
            sch.days?.length ? h('div', { class: 'tiny' }, 'Tip: an end time earlier than the start (e.g. 22:00 to 02:00) runs past midnight.') : h('div', { class: 'tiny' }, 'Pick at least one day above.'))
        : h('div', { class: 'grid2' },
            field('From', h('input', { type: 'time', value: sch.from || '', onchange: (e) => change((x) => (x.schedule.from = e.target.value)) })),
            field('Until', h('input', { type: 'time', value: sch.to || '', onchange: (e) => change((x) => (x.schedule.to = e.target.value)) })))) : null;

    inspEl.replaceChildren(h('div', { class: 'inspector' },
      ...(isWidget(s.type) ? widgetFields(s, change, paintInspector) : [h('div', { class: 'section-title' }, s.type === 'text' ? 'Text slide' : isVideo ? 'Video' : 'Picture')]),
      (s.type === 'image' || s.type === 'video') ? h('div', { class: 'full row' },
        h('button', { class: 'btn sm', onclick: async () => {
          const [m] = (await pickMedia({ multiple: false })) || [];
          if (m) { change((x) => Object.assign(x, { type: m.kind, media_id: m.id, path: m.path, name: m.name, video_duration: m.duration_s ? Number(m.duration_s) : undefined, duration: m.kind === 'video' ? 0 : (x.duration || 8) })); paintInspector(); }
        } }, 'Replace…'),
        h('div', { class: 'seg' }, [['stretch', areaCount() > 1 ? 'Stretch to area' : 'Stretch to screen'], ['cover', 'Fill (crop)'], ['contain', 'Fit whole'], ...(s.type === 'image' ? [['blur', 'Fit + blur']] : [])].map(([v, l]) =>
          h('button', { type: 'button', class: (s.fit || 'cover') === v ? 'on' : '', onclick: () => { change((x) => { x.fit = v; x.fit_set = true; }); paintInspector(); } }, l))),
        isVideo ? h('label', { class: 'row small' }, h('input', { type: 'checkbox', checked: s.muted === false, onchange: (e) => change((x) => (x.muted = !e.target.checked), { list: false }) }), 'Play sound on TV') : null) : null,
      itemsSection(s),
      h('div', { class: 'full' }, field('Background', sw)),

      h('div', { class: 'section-title' }, 'Timing'),
      field('Show for (seconds)', dur),
      isVideo ? h('label', { class: 'row small', style: { alignSelf: 'end', fontWeight: 600, paddingBottom: '10px' } }, fullVideo, 'Play the whole video') : h('div'),

      h('div', { class: 'section-title' }, 'Transition & effect'),
      field('Transition in', select(TRANSITIONS, s.transition || 'fade', (v) => change((x) => (x.transition = v), { transition: true }))),
      field('Speed', h('input', { type: 'range', min: 200, max: 2500, step: 100, value: s.transition_ms ?? 900, onchange: (e) => change((x) => (x.transition_ms = Number(e.target.value)), { transition: true, list: false }) })),
      s.type !== 'text' ? field('Motion effect', select(EFFECTS, s.effect || 'none', (v) => change((x) => (x.effect = v)))) : h('div'),
      h('div', { class: 'row', style: { alignSelf: 'end' } },
        h('button', { class: 'btn sm', onclick: () => refreshPreview(true) }, icon('play'), 'Replay'),
        h('button', { class: 'btn sm ghost', onclick: () => { pl.slides.forEach((x) => { x.transition = s.transition; x.transition_ms = s.transition_ms; }); schedule(); paintList(); toast('Transition applied to all slides'); } }, 'Apply to all')),

      ...(!hasOverlay(s) ? [] : [
      h('div', { class: 'section-title row between overlay-section' }, s.type === 'text' ? 'Text' : 'Text overlay',
        s.type === 'text' ? null : h('button', { class: 'btn sm ghost danger', type: 'button', onclick: () => { change((x) => { x.text = { ...x.text, on: false, title: '', subtitle: '' }; }); paintInspector(); } }, icon('trash'), 'Remove')),
      h('div', { class: 'full' }, field('Headline', h('textarea', { rows: 2, value: t.title || '', placeholder: 'Optional', oninput: (e) => change((x) => (x.text.title = e.target.value)) }))),
      h('div', { class: 'full' }, field('Sub-text', h('textarea', { rows: 2, value: t.subtitle || '', placeholder: 'Optional', oninput: (e) => change((x) => (x.text.subtitle = e.target.value)) }))),
      field('Position', posGrid),
      field('Size', sizeSeg),
      field('Colour', h('div', { class: 'row' }, h('input', { type: 'color', value: t.color || '#ffffff', oninput: (e) => change((x) => (x.text.color = e.target.value)) }),
        h('label', { class: 'row small' }, h('input', { type: 'checkbox', checked: !!t.box, onchange: (e) => change((x) => (x.text.box = e.target.checked)) }), 'Dark box behind text'))),
      field('Text animation', select(TEXT_ANIMS, t.anim || 'none', (v) => change((x) => (x.text.anim = v)))),
      ]),

      h('div', { class: 'section-title' }, 'Show this slide only at certain times'),
      dateRange(s),
      h('label', { class: 'row small full', style: { fontWeight: 600 } }, schedOn, 'Limit this slide to days / times (e.g. lunch specials)'),
      schedBody,

      h('div', { class: 'section-title' }, 'Slide'),
      h('div', { class: 'full row' },
        h('button', { class: 'btn sm', onclick: () => { const c = { ...structuredClone(s), id: newSlide().id }; pl.slides.splice(sel + 1, 0, c); sel++; schedule(); paint(); } }, icon('dup'), 'Duplicate'),
        h('button', { class: 'btn sm danger', onclick: () => deleteSlide(sel) }, icon('trash'), 'Delete')),
      h('div', { class: 'full row save-row' },
        h('button', { class: 'btn primary', onclick: async (e) => { const b = e.currentTarget; b.disabled = true; try { await save(); toast('Changes saved'); } finally { b.disabled = false; } } }, icon('check'), 'Save changes'),
        h('span', { class: 'tiny' }, 'Changes also save automatically as you edit. Press “Publish” to send them to your TVs.'))));
  }

  // ------------------------------------------------ page
  const totalEl = h('span', { class: 'tiny' });
  function paint() {
    totalEl.textContent = `${pl.slides.length} slides · ${fmtDuration(playlistLength(pl))} loop`;
    paintList();
    paintInspector();
    refreshPreview(false);
  }

  const nameInput = h('input', { type: 'text', value: pl.name, style: { fontSize: '22px', fontWeight: 750, border: '1px solid transparent', background: 'transparent', padding: '4px 6px', marginLeft: '-6px' },
    oninput: (e) => { const v = e.target.value.trim(); e.target.classList.toggle('invalid', !v); if (v) { pl.name = v; schedule(); } },
    onblur: (e) => { if (!e.target.value.trim()) { e.target.value = pl.name; e.target.classList.remove('invalid'); toast('A playlist needs a name', true); } } });
  const orient = h('div', { class: 'seg' }, [['landscape', 'Landscape'], ['portrait', 'Portrait']].map(([v, l]) =>
    h('button', { type: 'button', class: (pl.settings.orientation || 'landscape') === v ? 'on' : '', onclick: (e) => {
      pl.settings.orientation = v; schedule();
      [...orient.children].forEach((b) => b.classList.toggle('on', b === e.currentTarget));
      paint();
    } }, l)));

  const layoutBtn = h('button', { class: 'btn', title: 'Full screen, side panel or ticker' });
  const paintLayoutBtn = () => { const n = normLayout(pl.settings); layoutBtn.replaceChildren(layoutDiagram(n.layout, pl.settings.orientation === 'portrait', false, 0, 30, n.ticker && pl.settings.ticker?.text ? pl.settings.ticker : null, pl.settings.layout_split), `Layout: ${layoutLabel(n.layout, pl.settings.orientation === 'portrait')}${n.ticker ? ' + ticker' : ''}`); };
  layoutBtn.onclick = () => layoutDialog(pl, allPlaylists, (st) => {
    const before = areaCount();
    Object.assign(pl.settings, st);
    const n = areaCount();
    pl.slides.forEach((s) => { if ((s.zone || 0) >= n) delete s.zone; });
    // Switching to a split layout: fit existing pictures/videos inside their area so nothing is cut off.
    // (Slides where someone picked the fit by hand keep their choice.)
    if (n > 1) pl.slides.forEach((s) => { if ((s.type === 'image' || s.type === 'video') && !s.fit_set) s.fit = 'stretch'; });
    if (n <= 1 && before > 1) pl.slides.forEach((s) => { if (!s.fit_set && s.fit !== 'cover') s.fit = 'cover'; });
    if (area >= n) area = 0;
    schedule(); paintLayoutBtn(); paint();
    toast(n > 1 ? `Layout saved. Pick an area above the slides and add media to it.` : 'Layout saved');
  });
  paintLayoutBtn();

  main.replaceChildren(
    h('div', { class: 'page-head' },
      h('div', { class: 'grow' }, h('div', { class: 'crumb' }, h('a', { href: '#/playlists' }, 'Playlists'), ' / Edit'), nameInput,
        h('div', { class: 'row' }, totalEl, '·', status)),
      h('div', { class: 'row' }, orient,
        layoutBtn,
        h('button', { class: 'btn', onclick: previewAll }, icon('play'), 'Preview'),
        h('button', { class: 'btn primary', onclick: async () => { await save(); showOnTvsDialog(pl); } }, icon('send'), 'Publish'))),
    h('div', { class: 'editor' },
      h('div', { class: 'card' }, areaEl, listEl),
      h('div', { class: 'stack' }, h('div', { class: 'card pad' }, previewBox), h('div', { class: 'card' }, inspEl))));
  paint();

  return () => { save(); clearTimeout(previewTimer); player?.stop(); window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('resize', onResize); };
}
