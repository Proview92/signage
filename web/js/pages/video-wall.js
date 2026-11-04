// Video walls: several TVs side by side showing one picture or video together.
import { sb, state, h, q, toast, modal, field, select, confirmBox, publishOrRequest } from '../core.js';
import { validWall } from '../renderer.js';

/** Walls of this client, grouped from the screens' `wall` settings. */
export function wallsOf(screens) {
  const map = new Map();
  for (const s of screens) {
    if (!validWall(s.wall)) continue;
    const w = map.get(s.wall.id) || { ...s.wall, tvs: [] };
    w.tvs.push(s);
    map.set(s.wall.id, w);
  }
  return [...map.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/** Little picture of a wall: a grid of TVs with their names. */
export function wallDiagram(wall, screens, size = 220) {
  const cols = wall.cols, rows = wall.rows;
  const cw = Math.floor(size / cols), ch = Math.round(cw * 9 / 16);
  const at = (x, y) => screens.find((s) => s.wall?.id === wall.id && s.wall.x === x && s.wall.y === y);
  return h('div', { class: 'wall-diagram', style: { gridTemplateColumns: `repeat(${cols}, ${cw}px)`, gridAutoRows: ch + 'px' } },
    ...Array.from({ length: rows * cols }, (_, i) => { const s = at(i % cols, Math.floor(i / cols)); return h('div', { class: 'wall-cell' + (s ? '' : ' empty') }, s ? s.name : '—'); }));
}

const shapes = [[2, 1], [3, 1], [4, 1], [1, 2], [2, 2], [3, 2], [2, 3], [3, 3], [4, 2], [4, 4]];

export function wallDialog({ wall = null, screens, playlists, onDone }) {
  const id = wall?.id || crypto.randomUUID();
  const st = {
    name: wall?.name || '',
    cols: wall?.cols || 2,
    rows: wall?.rows || 1,
    bezel: wall?.bezel || 'none',
    grid: {},     // "x,y" → screen id
    playlist: '',
  };
  for (const s of screens) if (s.wall?.id === id) st.grid[`${s.wall.x},${s.wall.y}`] = s.id;
  const first = screens.find((s) => s.wall?.id === id);
  st.playlist = first?.default_playlist_id || '';

  const name = h('input', { type: 'text', value: st.name, placeholder: 'e.g. Window wall', oninput: (e) => (st.name = e.target.value) });
  const shapeSel = select(shapes.map(([c, r]) => [`${c}x${r}`, `${c} across × ${r} down (${c * r} TVs)`]), `${st.cols}x${st.rows}`, (v) => {
    [st.cols, st.rows] = v.split('x').map(Number);
    for (const k of Object.keys(st.grid)) { const [x, y] = k.split(',').map(Number); if (x >= st.cols || y >= st.rows) delete st.grid[k]; }
    paint();
  });
  if (!shapes.some(([c, r]) => c === st.cols && r === st.rows)) shapeSel.prepend(h('option', { value: `${st.cols}x${st.rows}`, selected: true }, `${st.cols} across × ${st.rows} down`));
  const gridEl = h('div');
  const note = h('div');
  // TVs already in another wall can't be picked here.
  const free = screens.filter((s) => !validWall(s.wall) || s.wall.id === id);

  const paint = () => {
    const used = new Set(Object.values(st.grid));
    gridEl.replaceChildren(h('div', { class: 'wall-grid', style: { gridTemplateColumns: `repeat(${st.cols}, minmax(0, 1fr))` } },
      ...Array.from({ length: st.cols * st.rows }, (_, i) => {
        const x = i % st.cols, y = Math.floor(i / st.cols), k = `${x},${y}`;
        const sel = select([['', '— Choose TV —'], ...free.filter((s) => s.id === st.grid[k] || !used.has(s.id)).map((s) => [s.id, s.name])], st.grid[k] || '', (v) => { if (v) st.grid[k] = v; else delete st.grid[k]; paint(); });
        return h('div', { class: 'wall-slot' + (st.grid[k] ? ' on' : '') }, h('span', { class: 'tiny' }, `Row ${y + 1}, screen ${x + 1}`), sel);
      })));
    const picked = Object.values(st.grid).map((sid) => screens.find((s) => s.id === sid)).filter(Boolean);
    const withRules = picked.filter((s) => (s.also_playlist_ids || []).length);
    note.replaceChildren(withRules.length ? h('div', { class: 'notice' }, `Add-on playlists on ${withRules.map((s) => s.name).join(', ')} will be removed so every TV in the wall plays the same thing.`) : '');
  };
  paint();

  const save = async () => {
    const need = st.cols * st.rows;
    const cells = Object.entries(st.grid);
    if (!st.name.trim()) throw new Error('Give the wall a name');
    if (cells.length !== need) throw new Error(`Choose a TV for all ${need} positions`);
    if (!st.playlist) throw new Error('Choose what the wall should play');
    const keep = new Set(cells.map(([, sid]) => sid));
    const leaving = screens.filter((s) => s.wall?.id === id && !keep.has(s.id));
    for (const s of leaving) await q(sb.from('screens').update({ wall: null }).eq('id', s.id));
    const ids = [];
    for (const [k, sid] of cells) {
      const [x, y] = k.split(',').map(Number);
      await q(sb.from('screens').update({ wall: { id, name: st.name.trim(), cols: st.cols, rows: st.rows, x, y, bezel: st.bezel }, default_playlist_id: st.playlist, also_playlist_ids: [] }).eq('id', sid));
      ids.push(sid);
    }
    // Every TV must play the same thing at the same time, so schedule rules are cleared.
    await q(sb.from('schedule_items').delete().in('screen_id', ids));
    let ok = 0, pending = 0; const failed = [];
    for (const sid of [...ids, ...leaving.map((s) => s.id)]) {
      const s = screens.find((x) => x.id === sid);
      try { const r = await publishOrRequest('screen', sid, s?.name || ''); if (r.pending) pending++; else ok++; } catch { failed.push(s?.name || sid); }
    }
    toast(pending ? `Wall saved. Sent to your manager for approval.` : `Wall saved and published to ${ok} TV${ok === 1 ? '' : 's'}${failed.length ? ` (failed: ${failed.join(', ')})` : ''}`, failed.length > 0);
    onDone?.();
  };

  const remove = async () => {
    if (!(await confirmBox('Remove this video wall?', 'Each TV will go back to showing the whole picture on its own. Nothing is deleted.', 'Remove wall'))) return false;
    const tvs = screens.filter((s) => s.wall?.id === id);
    for (const s of tvs) await q(sb.from('screens').update({ wall: null }).eq('id', s.id));
    for (const s of tvs) { try { await publishOrRequest('screen', s.id, s.name); } catch {} }
    toast('Video wall removed');
    onDone?.();
  };

  modal({
    title: wall ? `Video wall — ${wall.name}` : 'New video wall',
    wide: true,
    body: [
      h('div', { class: 'tiny' }, 'Put TVs next to each other and show one picture or video across all of them. Every TV changes slide at the same moment and videos stay in step.'),
      h('div', { class: 'grid2' }, field('Wall name', name), field('Layout', shapeSel)),
      h('div', { class: 'small', style: { fontWeight: 600 } }, 'Which TV is where? (as you look at the wall)'),
      gridEl,
      h('div', { class: 'grid2' },
        field('Plays', select([['', '— Choose a playlist —'], ...playlists.map((p) => [p.id, p.name])], st.playlist, (v) => (st.playlist = v)), 'Pictures and videos are stretched across the whole wall.'),
        field('Gap for screen edges', select([['none', 'None'], ['thin', 'Thin bezels'], ['normal', 'Normal bezels']], st.bezel, (v) => (st.bezel = v)), 'Hides a strip behind each TV frame so lines stay straight across screens.')),
      note,
      h('div', { class: 'tiny' }, 'Sound plays from the top-left TV only. Schedule rules on these TVs are removed.'),
    ],
    actions: [
      wall ? { label: 'Remove wall', class: 'danger', onClick: remove } : null,
      { label: 'Cancel' },
      { label: wall ? 'Save and publish' : 'Create wall and publish', class: 'primary', onClick: save },
    ].filter(Boolean),
  });
}
