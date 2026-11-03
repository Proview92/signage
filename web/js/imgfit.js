// Shrink very large pictures (phone photos are often 12–48 megapixels) so
// TVs can decode and animate them smoothly. Returns a new Blob, or null
// when the picture is already a sensible size / can't be processed.
export async function shrinkImage(blob, maxEdge = 2560) {
  const type = (blob.type || '').toLowerCase();
  if (!type.startsWith('image/') || /gif|svg/.test(type)) return null; // keep animations & vectors
  if (typeof createImageBitmap !== 'function') return null;
  let bmp;
  try { bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' }); }
  catch { try { bmp = await createImageBitmap(blob); } catch { return null; } }
  const { width: w, height: h } = bmp;
  const k = Math.min(1, maxEdge / Math.max(w, h));
  // Already small and light enough: leave as is.
  if (k === 1 && blob.size < 2.5 * 1024 * 1024) { bmp.close?.(); return null; }
  const cw = Math.round(w * k), ch = Math.round(h * k);
  const canvas = document.createElement('canvas');
  canvas.width = cw; canvas.height = ch;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  const png = type.includes('png') || type.includes('webp');
  if (!png) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, cw, ch); }
  ctx.drawImage(bmp, 0, 0, cw, ch);
  bmp.close?.();
  const out = await new Promise((r) => canvas.toBlob(r, png ? 'image/png' : 'image/jpeg', 0.9));
  canvas.width = canvas.height = 0;
  if (!out || (k === 1 && out.size >= blob.size)) return null;
  return Object.assign(out, { width: cw, height: ch });
}
