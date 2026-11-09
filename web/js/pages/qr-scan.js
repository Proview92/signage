// Pair a TV by scanning the QR code on its "Pair this screen" page.
// The QR holds  https://app.proviewsignage.co.uk/#/pair/<CODE>  so a phone's own camera app works too:
// it opens the dashboard, which remembers the code (pendingPair) and opens Add a TV with it filled in.
import { h, modal, toast } from '../core.js';

const KEY = 'signage.pendingPair';

/** Pull the 6-character pairing code out of a scanned QR (our link) or plain text. */
export function codeFromText(t) {
  const s = String(t || '').trim();
  const m = /#\/pair\/([A-Za-z0-9]{6})\b/.exec(s) || /^([A-Za-z0-9]{6})$/.exec(s);
  return m ? m[1].toUpperCase() : null;
}

/** Remember a code from a #/pair/<CODE> link until someone signed in can use it. */
export function rememberPairLink(hash = location.hash) {
  const m = /^#\/?pair\/([A-Za-z0-9]{6})\b/.exec(hash || '');
  if (!m) return false;
  // localStorage (not session) so it survives signing in or confirming an email; kept for 30 minutes
  try { localStorage.setItem(KEY, JSON.stringify({ code: m[1].toUpperCase(), at: Date.now() })); } catch {}
  return true;
}
export function hasPendingPair() {
  try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); return !!v && Date.now() - v.at < 30 * 60000; } catch { return false; }
}
export function takePendingPair() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    localStorage.removeItem(KEY);
    return v && Date.now() - v.at < 30 * 60000 ? v.code : null;
  } catch { return null; }
}

let jsqr = null;
function loadJsQR() {
  if (window.jsQR) return Promise.resolve(window.jsQR);
  return (jsqr ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = new URL('../../vendor/jsQR.js', import.meta.url).href;
    s.onload = () => (window.jsQR ? res(window.jsQR) : rej(new Error('QR reader did not load')));
    s.onerror = () => { jsqr = null; rej(new Error('QR reader did not load')); };
    document.head.append(s);
  }));
}

/** Camera dialog. Calls onCode(code) once a TV pairing QR is read. */
export function scanDialog(onCode) {
  if (!navigator.mediaDevices?.getUserMedia) {
    toast('This browser can’t open the camera. Type the code shown on the TV instead.', true);
    return;
  }
  const video = h('video', { class: 'qr-video', playsinline: '', muted: '', autoplay: '' });
  video.muted = true; video.setAttribute('playsinline', '');
  const msg = h('p', { class: 'muted small', style: { margin: '10px 0 0', textAlign: 'center' } }, 'Starting the camera…');
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let stream = null, stopped = false, timer = null, detector = null, decode = null;
  const stop = () => { stopped = true; clearTimeout(timer); stream?.getTracks().forEach((t) => t.stop()); };
  const dlg = modal({
    title: 'Scan the QR code on the TV',
    body: [h('div', { class: 'qr-frame' }, video, h('div', { class: 'qr-aim', 'aria-hidden': 'true' })), msg],
    actions: [{ label: 'Cancel' }],
    onClose: stop,
  });

  const found = (text) => {
    const code = codeFromText(text);
    if (!code) { msg.textContent = 'That QR code isn’t a PROVIEW SIGNAGE pairing code. Scan the one on the TV’s “Pair this screen” page.'; return false; }
    dlg.close();
    onCode(code);
    return true;
  };
  const tick = async () => {
    if (stopped) return;
    try {
      if (video.readyState >= 2 && video.videoWidth) {
        if (detector) {
          const r = await detector.detect(video);
          if (r[0]?.rawValue && found(r[0].rawValue)) return;
        } else if (decode) {
          const w = Math.min(640, video.videoWidth), hgt = Math.round(video.videoHeight * (w / video.videoWidth));
          canvas.width = w; canvas.height = hgt;
          ctx.drawImage(video, 0, 0, w, hgt);
          const r = decode(ctx.getImageData(0, 0, w, hgt).data, w, hgt, { inversionAttempts: 'dontInvert' });
          if (r?.data && found(r.data)) return;
        }
      }
    } catch {}
    timer = setTimeout(tick, 200);
  };

  (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      if (stopped) return stop();
      video.srcObject = stream;
      await video.play().catch(() => {});
      if ('BarcodeDetector' in window) {
        try { const f = await window.BarcodeDetector.getSupportedFormats?.(); if (!f || f.includes('qr_code')) detector = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch {}
      }
      if (!detector) decode = await loadJsQR();
      msg.textContent = 'Point your camera at the QR code on the TV.';
      tick();
    } catch (e) {
      msg.textContent = /denied|NotAllowed/i.test(String(e?.name || e?.message))
        ? 'Camera access was blocked. Allow the camera for this site, or type the code shown on the TV.'
        : 'Couldn’t open the camera. Type the code shown on the TV instead.';
    }
  })();
}
