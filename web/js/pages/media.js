import { sb, state, h, icon, q, fetchAll, toast, modal, field, confirmBox, promptBox, mediaUrls, fmtBytes, fmtDuration, timeAgo, errMsg, BUCKET } from '../core.js';

import { shrinkImage } from '../imgfit.js';

const cfg = window.SIGNAGE_CONFIG || {};

async function listMedia() {
  return fetchAll(() => sb.from('media').select('*').eq('client_id', state.clientId).order('created_at', { ascending: false }).order('id'));
}

function readMeta(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const done = (m) => { URL.revokeObjectURL(url); resolve(m); };
    if (file.type.startsWith('image/')) {
      const img = new Image();
      img.onload = () => done({ width: img.naturalWidth, height: img.naturalHeight });
      img.onerror = () => done({});
      img.src = url;
    } else {
      const v = document.createElement('video');
      v.preload = 'metadata'; v.muted = true;
      v.onloadedmetadata = () => done({ width: v.videoWidth, height: v.videoHeight, duration_s: isFinite(v.duration) ? Math.round(v.duration * 10) / 10 : null });
      v.onerror = () => done({});
      setTimeout(() => done({}), 8000);
      v.src = url;
    }
  });
}

// Upload with real progress (XHR to the Storage REST API).
async function uploadFile(file, path, onProgress) {
  const { data: { session } } = await sb.auth.getSession();
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${cfg.SUPABASE_URL}/storage/v1/object/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`);
    xhr.setRequestHeader('Authorization', `Bearer ${session.access_token}`);
    xhr.setRequestHeader('apikey', cfg.SUPABASE_ANON_KEY);
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.setRequestHeader('cache-control', 'max-age=31536000');
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      if (xhr.status < 300) return resolve();
      let m = xhr.responseText;
      try { m = JSON.parse(m).message || JSON.parse(m).error || m; } catch {}
      reject(new Error(xhr.status === 413 ? 'Payload too large' : m));
    };
    xhr.onerror = () => reject(new Error('Network error while uploading'));
    xhr.send(file);
  });
}

// Ask once per upload: 1080p (smoothest on any TV) or 4K (sharper on 4K TVs).
const QKEY = 'signage.uploadQuality';
function askQuality(files) {
  const imgs = files.filter((f) => f.type.startsWith('image/')).length;
  const vids = files.filter((f) => f.type.startsWith('video/')).length;
  if (!imgs && !vids) return Promise.resolve('1080');
  let last = '1080'; try { last = localStorage.getItem(QKEY) || '1080'; } catch {}
  return new Promise((resolve) => {
    let done = false;
    const opt = (val, title, text) => h('label', { class: 'card pad', style: { display: 'flex', gap: '10px', alignItems: 'flex-start', cursor: 'pointer' } },
      h('input', { type: 'radio', name: 'uq', value: val, checked: last === val, style: { marginTop: '4px' } }),
      h('div', {}, h('h3', {}, title), h('div', { class: 'tiny', style: { marginTop: '4px' } }, text)));
    const body = h('div', { class: 'stack' },
      h('p', { class: 'muted small', style: { margin: 0 } }, `Uploading ${[imgs && `${imgs} picture${imgs > 1 ? 's' : ''}`, vids && `${vids} video${vids > 1 ? 's' : ''}`].filter(Boolean).join(' and ')}. What quality should ${imgs + vids > 1 ? 'they' : 'it'} be for your TVs?`),
      h('div', { class: 'grid2' },
        opt('1080', '1080p (Full HD)', 'Recommended. Plays smoothly on every TV and TV stick, and uploads faster.'),
        opt('4k', '4K (Ultra HD)', 'Sharper on 4K TVs with a 4K-capable player. Bigger files; cheaper TV sticks may stutter.')),
      vids ? h('div', { class: 'tiny' }, 'Pictures are resized to the size you pick. Videos upload as they are — we\'ll tell you if one doesn\'t match.') : null);
    const pick = () => body.querySelector('input[name=uq]:checked')?.value || '1080';
    modal({
      title: 'Picture & video quality', body,
      onClose: () => { if (!done) resolve(null); },
      actions: [
        { label: 'Cancel', onClick: () => { done = true; resolve(null); } },
        { label: 'Upload', class: 'primary', onClick: () => { done = true; const v = pick(); try { localStorage.setItem(QKEY, v); } catch {} resolve(v); } },
      ],
    });
  });
}

// PDFs: every page becomes a sharp picture (rendered at 4K size, then resized like any picture),
// so TVs only ever have to show plain images.
const PDF_MAX_PAGES = 50;
async function pdfToImages(file, progressEl) {
  const status = h('div', { class: 'upload-row' }, h('div', { style: { width: '40%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, file.name), h('span', { class: 'tiny' }, 'Reading PDF…'));
  progressEl?.append(status);
  try {
    const pdfjs = await import('../../vendor/pdfjs/pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('../../vendor/pdfjs/pdf.worker.mjs', import.meta.url).href;
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const n = Math.min(doc.numPages, PDF_MAX_PAGES);
    if (doc.numPages > PDF_MAX_PAGES) toast(`${file.name} has ${doc.numPages} pages. Only the first ${PDF_MAX_PAGES} were added.`);
    const base = file.name.replace(/\.pdf$/i, '');
    const out = [];
    for (let i = 1; i <= n; i++) {
      status.lastChild.textContent = `Converting page ${i} of ${n}…`;
      const page = await doc.getPage(i);
      const vp1 = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: 3840 / Math.max(vp1.width, vp1.height) });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(vp.width); canvas.height = Math.round(vp.height);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.92));
      canvas.width = canvas.height = 0; page.cleanup();
      if (blob) out.push(new File([blob], n > 1 ? `${base} – page ${i}.jpg` : `${base}.jpg`, { type: 'image/jpeg' }));
    }
    doc.destroy();
    status.remove();
    return out;
  } catch (e) {
    status.lastChild.textContent = 'Could not read this PDF';
    toast(`${file.name}: ${errMsg(e)}`, true);
    return [];
  }
}

export async function uploadFiles(files, progressEl, folder = null) {
  const out = [];
  files = [...files];
  // Turn any PDFs into one picture per page first.
  const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);
  if (files.some(isPdf)) {
    const expanded = [];
    for (const f of files) expanded.push(...(isPdf(f) ? await pdfToImages(f, progressEl) : [f]));
    files = expanded;
  }
  const quality = await askQuality(files);
  if (!quality) return out;
  const k4 = quality === '4k';
  for (let file of files) {
    const kind = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : null;
    const bar = h('div');
    const row = h('div', { class: 'upload-row' }, h('div', { style: { width: '40%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, file.name), h('div', { class: 'bar' }, bar), h('span', { class: 'tiny' }, fmtBytes(file.size)));
    progressEl?.append(row);
    if (!kind) { row.lastChild.textContent = 'Not a picture, video or PDF'; continue; }
    try {
      // Pictures are resized to the chosen quality so TVs show them smoothly.
      if (kind === 'image') {
        const small = await shrinkImage(file, k4 ? 3840 : 1920).catch(() => null);
        if (small) {
          const ext2 = small.type === 'image/png' ? 'png' : 'jpg';
          file = new File([small], file.name.replace(/\.[^.]+$/, '') + '.' + ext2, { type: small.type });
          row.lastChild.textContent = fmtBytes(file.size);
        }
      }
      const meta = await readMeta(file);
      const px = (meta.width || 0) * (meta.height || 0);
      if (kind === 'video' && !k4 && px > 1920 * 1080 * 1.2)
        toast(`${file.name} is ${meta.width}×${meta.height} (4K), not 1080p. It will upload as is — for the smoothest playback, export it at 1080p from your phone or editor and upload again.`);
      if (kind === 'video' && k4 && px && px < 3840 * 2160 * 0.8)
        toast(`${file.name} is ${meta.width}×${meta.height}, so it will play at that quality, not 4K.`);
      const ext = (file.name.split('.').pop() || (kind === 'image' ? 'jpg' : 'mp4')).toLowerCase().replace(/[^a-z0-9]/g, '');
      const path = `${state.clientId}/${crypto.randomUUID()}${k4 ? '.4k' : ''}.${ext}`;   // .4k = TV keeps full 4K
      await uploadFile(file, path, (p) => (bar.style.width = Math.round(p * 100) + '%'));
      const m = await q(sb.from('media').insert({ client_id: state.clientId, folder: folder || null, name: file.name.replace(/\.[^.]+$/, ''), path, kind, mime: file.type, size_bytes: file.size, ...meta }).select().single());
      out.push(m);
      bar.style.width = '100%';
      row.lastChild.textContent = 'Done';
      if (file.type === 'video/quicktime') toast(`${file.name}: .mov files may not play on every TV — MP4 (H.264) is safest.`);
    } catch (e) {
      row.lastChild.textContent = 'Failed';
      bar.style.background = 'var(--bad)'; bar.style.width = '100%';
      toast(`${file.name}: ${errMsg(e)}`, true);
    }
  }
  return out;
}

function mediaThumb(m, url) {
  const t = h('div', { class: 'thumb' });
  if (!url) t.append(h('div', { class: 'blank' }, '…'));
  else if (m.kind === 'image') t.append(h('img', { src: url, loading: 'lazy', alt: '' }));
  else t.append(h('video', { src: url + '#t=0.5', preload: 'metadata', muted: true, playsInline: true }));
  t.append(h('span', { class: 'tag' }, (m.kind === 'video' ? (m.duration_s ? fmtDuration(m.duration_s) : 'Video') : 'Image') + ((m.width || 0) >= 3000 || (m.height || 0) >= 3000 ? ' · 4K' : '')));
  return t;
}

function uploader(onUploaded, getFolder = () => null) {
  const input = h('input', { type: 'file', multiple: true, accept: 'image/*,video/*,application/pdf,.pdf', class: 'hidden', onchange: async () => { const f = [...input.files]; input.value = ''; onUploaded(await uploadFiles(f, progress, getFolder())); } });
  const progress = h('div', { style: { marginTop: '10px' } });
  const dz = h('div', { class: 'dropzone',
    ondragover: (e) => { e.preventDefault(); dz.classList.add('over'); },
    ondragleave: () => dz.classList.remove('over'),
    ondrop: async (e) => { e.preventDefault(); dz.classList.remove('over'); onUploaded(await uploadFiles([...e.dataTransfer.files], progress, getFolder())); } },
    h('div', { style: { fontWeight: 650, color: 'var(--ink)' } }, 'Drop pictures, videos or PDFs here'),
    h('div', { class: 'small', style: { margin: '4px 0 12px' } }, 'JPG, PNG, WebP, GIF, MP4, WebM or PDF (each page becomes a picture). On a phone you can pick from your camera roll.'),
    h('button', { class: 'btn primary', type: 'button', onclick: () => input.click() }, icon('upload'), 'Choose files'),
    input, progress);
  return dz;
}

function usage(m, playlists) {
  return playlists.filter((p) => (p.slides || []).some((s) => s.media_id === m.id || s.path === m.path));
}

const QUOTA_BYTES = 1024 ** 3;   // shown as a guide; your Supabase plan sets the real limit

export async function mediaPage({ main }) {
  let items = await listMedia();
  const playlists = await q(sb.from('playlists').select('id,name,slides').eq('client_id', state.clientId));
  let filter = 'all', search = '', folder = localStorage.getItem('signage.folder.' + state.clientId) || '';
  const grid = h('div', { class: 'media-grid' });
  const folderBar = h('div', { class: 'chips' });
  const usageEl = h('div');

  const folders = () => [...new Set(items.map((m) => m.folder).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const setFolder = (f) => { folder = f; localStorage.setItem('signage.folder.' + state.clientId, f); paintAll(); };

  function paintUsage() {
    const used = items.reduce((t, m) => t + (Number(m.size_bytes) || 0), 0);
    const pct = Math.min(100, (used / QUOTA_BYTES) * 100);
    usageEl.replaceChildren(h('div', { class: 'row', style: { gap: '10px' } },
      h('span', { class: 'tiny' }, `Storage used: ${fmtBytes(used) || '0 B'}`),
      h('div', { class: 'bar', style: { maxWidth: '200px' } }, h('div', { style: { width: pct + '%', background: pct > 85 ? 'var(--bad)' : 'var(--accent)' } }))));
  }

  function paintFolders() {
    const fs = folders();
    folderBar.replaceChildren(...[
      h('button', { class: 'chip' + (!folder ? ' on' : ''), onclick: () => setFolder('') }, `All files (${items.length})`),
      ...fs.map((f) => h('button', { class: 'chip' + (folder === f ? ' on' : ''), onclick: () => setFolder(f) }, `📁 ${f} (${items.filter((m) => m.folder === f).length})`)),
      items.some((m) => !m.folder) && fs.length ? h('button', { class: 'chip' + (folder === '__none' ? ' on' : ''), onclick: () => setFolder('__none') }, `Not in a folder (${items.filter((m) => !m.folder).length})`) : null,
      h('button', { class: 'chip', onclick: async () => {
        const n = await promptBox('New folder', 'Folder name', { placeholder: 'e.g. Christmas', okLabel: 'Create folder' });
        if (n) { setFolder(n); toast('Folder ready: uploads go into it, or move files in from their details'); }
      } }, '+ New folder')].filter(Boolean));
  }

  async function paintGrid() {
    const shown = items.filter((m) => (filter === 'all' || m.kind === filter) && (!search || m.name.toLowerCase().includes(search))
      && (!folder || (folder === '__none' ? !m.folder : m.folder === folder)));
    if (!shown.length) { grid.replaceChildren(h('div', { class: 'muted small' }, items.length ? (folder && folder !== '__none' ? `Folder “${folder}” is empty. Upload above to add files to it.` : 'Nothing matches.') : 'No media yet — upload something above.')); return; }
    const urls = await mediaUrls(shown.map((m) => m.path));
    grid.replaceChildren(...shown.map((m) => h('div', { class: 'card media-item', onclick: () => details(m, urls[m.path]) },
      mediaThumb(m, urls[m.path]),
      h('div', { class: 'info' }, h('div', {}, m.name), h('div', { class: 'tiny' }, [m.folder && !folder ? `📁 ${m.folder}` : null, m.width && `${m.width}×${m.height}`, fmtBytes(m.size_bytes)].filter(Boolean).join(' · '))))));
  }
  const paintAll = () => { paintFolders(); paintUsage(); paintGrid(); headCount.textContent = `${items.length} file${items.length === 1 ? '' : 's'}`; };

  function details(m, url) {
    const used = usage(m, playlists);
    const name = h('input', { type: 'text', value: m.name });
    const fold = h('input', { type: 'text', value: m.folder || '', placeholder: 'No folder', list: 'folder-list' });
    const dl = h('datalist', { id: 'folder-list' }, folders().map((f) => h('option', { value: f })));
    const preview = m.kind === 'image' ? h('img', { src: url, style: { width: '100%', borderRadius: '10px', maxHeight: '50vh', objectFit: 'contain', background: '#111' } })
      : h('video', { src: url, controls: true, playsInline: true, style: { width: '100%', borderRadius: '10px', maxHeight: '50vh', background: '#111' } });
    modal({ title: 'Media details', body: [preview, h('div', { class: 'grid2' }, field('Name', name), field('Folder', h('div', {}, fold, dl), 'Type a new name to create a folder.')),
      h('div', { class: 'small muted' }, [m.kind === 'video' ? 'Video' : 'Image', m.width && `${m.width}×${m.height}`, m.duration_s && fmtDuration(m.duration_s), fmtBytes(m.size_bytes), 'Uploaded ' + timeAgo(m.created_at)].filter(Boolean).join(' · ')),
      used.length ? h('div', { class: 'notice info' }, `Used in: ${used.map((p) => p.name).join(', ')}`) : null],
    actions: [
      { label: 'Delete', class: 'danger', onClick: async () => {
        if (!(await confirmBox('Delete this file?', used.length ? `It's used in ${used.length} playlist(s). Those slides will be skipped on TVs.` : 'This can’t be undone.'))) return false;
        await sb.storage.from(BUCKET).remove([m.path]);
        await q(sb.from('media').delete().eq('id', m.id));
        items = items.filter((x) => x.id !== m.id); paintAll(); toast('Deleted');
      } },
      { label: 'Save', class: 'primary', onClick: async () => {
        const upd = { name: name.value.trim() || m.name, folder: fold.value.trim() || null };
        await q(sb.from('media').update(upd).eq('id', m.id));
        Object.assign(m, upd); paintAll();
      } }] });
  }

  const seg = h('div', { class: 'seg' }, [['all', 'All'], ['image', 'Pictures'], ['video', 'Videos']].map(([v, l]) =>
    h('button', { class: v === filter ? 'on' : '', onclick: (e) => { filter = v; [...seg.children].forEach((b) => b.classList.toggle('on', b === e.currentTarget)); paintGrid(); } }, l)));
  const headCount = h('p', { class: 'muted' });

  main.replaceChildren(
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Media'), headCount), usageEl),
    h('div', { class: 'stack' },
      uploader((added) => { items = [...added, ...items]; paintAll(); }, () => (folder && folder !== '__none' ? folder : null)),
      folderBar,
      h('div', { class: 'row between' }, seg, h('input', { type: 'text', placeholder: 'Search…', style: { maxWidth: '240px' }, oninput: (e) => { search = e.target.value.toLowerCase(); paintGrid(); } })),
      grid));
  paintAll();
}

// Picker used by the playlist editor. Resolves to an array of media rows.
export function pickMedia({ multiple = true, title, okLabel, allowEmpty = false } = {}) {
  return new Promise(async (resolve) => {
    let items = await listMedia();
    const chosen = new Map();
    let done = false;
    const grid = h('div', { class: 'media-grid', style: { maxHeight: '52vh', overflow: 'auto', padding: '2px' } });
    const paint = async () => {
      if (!items.length) { grid.replaceChildren(h('div', { class: 'muted small' }, 'Your library is empty — upload files above.')); return; }
      const urls = await mediaUrls(items.map((m) => m.path));
      grid.replaceChildren(...items.map((m) => {
        const card = h('div', { class: 'card media-item' + (chosen.has(m.id) ? ' selected' : ''), onclick: () => {
          if (!multiple) { chosen.clear(); grid.querySelectorAll('.selected').forEach((x) => x.classList.remove('selected')); }
          chosen.has(m.id) ? chosen.delete(m.id) : chosen.set(m.id, m);
          card.classList.toggle('selected', chosen.has(m.id));
        } }, mediaThumb(m, urls[m.path]), h('div', { class: 'check' }, '✓'), h('div', { class: 'info' }, h('div', {}, m.name)));
        return card;
      }));
    };
    const up = uploader((added) => { items = [...added, ...items]; added.forEach((m) => (multiple || !chosen.size) && chosen.set(m.id, m)); paint(); });
    modal({ title: title || (multiple ? 'Add pictures & videos' : 'Choose media'), wide: true,
      body: [up, h('div', { class: 'tiny' }, multiple ? 'Tick the files to use, in the order they should play. New uploads are ticked automatically.' : ''), grid],
      onClose: () => { if (!done) resolve(null); },
      actions: [{ label: 'Cancel' }, { label: okLabel || (multiple ? 'Add selected' : 'Use selected'), class: 'primary', onClick: () => {
        if (!chosen.size && !allowEmpty) throw new Error('Tick at least one file');
        done = true; resolve([...chosen.values()]);
      } }] });
    paint();
  });
}
