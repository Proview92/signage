import { sb, state, h, icon, q, toast, modal, field, confirmBox, mediaUrls, fmtBytes, fmtDuration, timeAgo, errMsg, BUCKET } from '../core.js';

const cfg = window.SIGNAGE_CONFIG || {};

async function listMedia() {
  return q(sb.from('media').select('*').eq('client_id', state.clientId).order('created_at', { ascending: false }));
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

export async function uploadFiles(files, progressEl) {
  const out = [];
  for (const file of files) {
    const kind = file.type.startsWith('image/') ? 'image' : file.type.startsWith('video/') ? 'video' : null;
    const bar = h('div');
    const row = h('div', { class: 'upload-row' }, h('div', { style: { width: '40%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, file.name), h('div', { class: 'bar' }, bar), h('span', { class: 'tiny' }, fmtBytes(file.size)));
    progressEl?.append(row);
    if (!kind) { row.lastChild.textContent = 'Not a picture or video'; continue; }
    try {
      const meta = await readMeta(file);
      const ext = (file.name.split('.').pop() || (kind === 'image' ? 'jpg' : 'mp4')).toLowerCase().replace(/[^a-z0-9]/g, '');
      const path = `${state.clientId}/${crypto.randomUUID()}.${ext}`;
      await uploadFile(file, path, (p) => (bar.style.width = Math.round(p * 100) + '%'));
      const m = await q(sb.from('media').insert({ client_id: state.clientId, name: file.name.replace(/\.[^.]+$/, ''), path, kind, mime: file.type, size_bytes: file.size, ...meta }).select().single());
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
  t.append(h('span', { class: 'tag' }, m.kind === 'video' ? (m.duration_s ? fmtDuration(m.duration_s) : 'Video') : 'Image'));
  return t;
}

function uploader(onUploaded) {
  const input = h('input', { type: 'file', multiple: true, accept: 'image/*,video/*', class: 'hidden', onchange: async () => { const f = [...input.files]; input.value = ''; onUploaded(await uploadFiles(f, progress)); } });
  const progress = h('div', { style: { marginTop: '10px' } });
  const dz = h('div', { class: 'dropzone',
    ondragover: (e) => { e.preventDefault(); dz.classList.add('over'); },
    ondragleave: () => dz.classList.remove('over'),
    ondrop: async (e) => { e.preventDefault(); dz.classList.remove('over'); onUploaded(await uploadFiles([...e.dataTransfer.files], progress)); } },
    h('div', { style: { fontWeight: 650, color: 'var(--ink)' } }, 'Drop pictures or videos here'),
    h('div', { class: 'small', style: { margin: '4px 0 12px' } }, 'JPG, PNG, WebP, GIF, MP4 or WebM. On a phone you can pick from your camera roll.'),
    h('button', { class: 'btn primary', type: 'button', onclick: () => input.click() }, icon('upload'), 'Choose files'),
    input, progress);
  return dz;
}

function usage(m, playlists) {
  return playlists.filter((p) => (p.slides || []).some((s) => s.media_id === m.id || s.path === m.path));
}

export async function mediaPage({ main }) {
  let items = await listMedia();
  const playlists = await q(sb.from('playlists').select('id,name,slides').eq('client_id', state.clientId));
  let filter = 'all', search = '';
  const grid = h('div', { class: 'media-grid' });

  async function paintGrid() {
    const shown = items.filter((m) => (filter === 'all' || m.kind === filter) && (!search || m.name.toLowerCase().includes(search)));
    if (!shown.length) { grid.replaceChildren(h('div', { class: 'muted small' }, items.length ? 'Nothing matches.' : 'No media yet — upload something above.')); return; }
    const urls = await mediaUrls(shown.map((m) => m.path));
    grid.replaceChildren(...shown.map((m) => h('div', { class: 'card media-item', onclick: () => details(m, urls[m.path]) },
      mediaThumb(m, urls[m.path]),
      h('div', { class: 'info' }, h('div', {}, m.name), h('div', { class: 'tiny' }, [m.width && `${m.width}×${m.height}`, fmtBytes(m.size_bytes)].filter(Boolean).join(' · '))))));
  }

  function details(m, url) {
    const used = usage(m, playlists);
    const name = h('input', { type: 'text', value: m.name });
    const preview = m.kind === 'image' ? h('img', { src: url, style: { width: '100%', borderRadius: '10px', maxHeight: '50vh', objectFit: 'contain', background: '#111' } })
      : h('video', { src: url, controls: true, playsInline: true, style: { width: '100%', borderRadius: '10px', maxHeight: '50vh', background: '#111' } });
    modal({ title: 'Media details', body: [preview, field('Name', name),
      h('div', { class: 'small muted' }, [m.kind === 'video' ? 'Video' : 'Image', m.width && `${m.width}×${m.height}`, m.duration_s && fmtDuration(m.duration_s), fmtBytes(m.size_bytes), 'Uploaded ' + timeAgo(m.created_at)].filter(Boolean).join(' · ')),
      used.length ? h('div', { class: 'notice info' }, `Used in: ${used.map((p) => p.name).join(', ')}`) : null],
    actions: [
      { label: 'Delete', class: 'danger', onClick: async () => {
        if (!(await confirmBox('Delete this file?', used.length ? `It's used in ${used.length} playlist(s). Those slides will be skipped on TVs.` : 'This can’t be undone.'))) return false;
        await sb.storage.from(BUCKET).remove([m.path]);
        await q(sb.from('media').delete().eq('id', m.id));
        items = items.filter((x) => x.id !== m.id); paintGrid(); toast('Deleted');
      } },
      { label: 'Save', class: 'primary', onClick: async () => {
        await q(sb.from('media').update({ name: name.value.trim() || m.name }).eq('id', m.id));
        m.name = name.value.trim() || m.name; paintGrid();
      } }] });
  }

  const seg = h('div', { class: 'seg' }, [['all', 'All'], ['image', 'Pictures'], ['video', 'Videos']].map(([v, l]) =>
    h('button', { class: v === filter ? 'on' : '', onclick: (e) => { filter = v; [...seg.children].forEach((b) => b.classList.toggle('on', b === e.currentTarget)); paintGrid(); } }, l)));

  main.replaceChildren(
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Media'), h('p', { class: 'muted' }, `${items.length} file${items.length === 1 ? '' : 's'}`))),
    h('div', { class: 'stack' },
      uploader((added) => { items = [...added, ...items]; paintGrid(); }),
      h('div', { class: 'row between' }, seg, h('input', { type: 'text', placeholder: 'Search…', style: { maxWidth: '240px' }, oninput: (e) => { search = e.target.value.toLowerCase(); paintGrid(); } })),
      grid));
  paintGrid();
}

// Picker used by the playlist editor. Resolves to an array of media rows.
export function pickMedia({ multiple = true } = {}) {
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
    modal({ title: multiple ? 'Add pictures & videos' : 'Choose media', wide: true, body: [up, grid],
      onClose: () => { if (!done) resolve(null); },
      actions: [{ label: 'Cancel' }, { label: multiple ? 'Add selected' : 'Use selected', class: 'primary', onClick: () => { done = true; resolve([...chosen.values()]); } }] });
    paint();
  });
}
