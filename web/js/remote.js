// =====================================================================
//  TV remote menu, driven by a D-pad remote.
//  Opened by: Back pressed 3 times or Menu (Android app), or "M" key (browser).
//  (A PIN step exists below but is switched off: REQUIRE_PIN = false.)
// =====================================================================
const native = () => window.SignageNative || null;
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LS_SETTINGS = 'signage.tv.settings';
const REQUIRE_PIN = false;

async function sha256hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function createRemoteMenu({ getStatus, onReload }) {
  let settings = JSON.parse(localStorage.getItem(LS_SETTINGS) || 'null') || { pin_hash: null, return_minutes: 5 };
  let open = false, mode = 'pin', pin = '', fails = 0, lockedUntil = 0, focus = 0, closeTimer = null;

  const root = document.createElement('div');
  root.id = 'remote';
  root.innerHTML = `
    <div class="rm-card">
      <div class="rm-head"><div class="wm"><b>PROVIEW</b> <span>SIGNAGE</span></div><div class="rm-title"></div></div>
      <div class="rm-body"></div>
      <div class="rm-foot">Use ▲ ▼ and OK · Back to close</div>
    </div>`;
  document.body.appendChild(root);
  const $title = root.querySelector('.rm-title');
  const $body = root.querySelector('.rm-body');

  function setSettings(s) {
    if (!s || !s.pin_hash) return;
    settings = s;
    localStorage.setItem(LS_SETTINGS, JSON.stringify(s));
    try { native()?.setConfig(JSON.stringify(s)); } catch {}
  }
  async function pinHash() {
    return settings.pin_hash || sha256hex('proview-pin:1234');
  }

  // ---------------------------------------------------------------- render
  function buttons() { return [...$body.querySelectorAll('[data-k]')]; }
  function paintFocus() { buttons().forEach((b, i) => b.classList.toggle('focus', i === focus)); }

  function renderPin(msg = '') {
    mode = 'pin';
    $title.textContent = 'Enter PIN';
    const dots = Array.from({ length: Math.max(4, pin.length) }, (_, i) => `<i class="${i < pin.length ? 'on' : ''}"></i>`).join('');
    const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'OK'];
    $body.innerHTML = `<div class="rm-dots">${dots}</div><div class="rm-msg">${msg}</div>
      <div class="rm-pad">${keys.map((k) => `<button data-k="${k}">${k}</button>`).join('')}</div>`;
    if (focus > 11) focus = 0;
    paintFocus();
  }

  function renderMenu() {
    mode = 'menu';
    const st = getStatus();
    $title.textContent = 'Screen menu';
    const isApp = !!native();
    const items = [
      ['reload', 'Reload content', 'Fetch the latest schedule and media now'],
      ['status', 'Screen status', 'Licence, device and connection details'],
      isApp ? ['wifi', 'Wi-Fi & network settings', `Connect to a different Wi-Fi network${settings.return_minutes ? ` · player reopens in ${settings.return_minutes} min` : ''}`] : null,
      isApp ? ['exit', `Exit to home screen${settings.return_minutes ? ` (reopens in ${settings.return_minutes} min)` : ''}`, 'For changing other TV settings'] : null,
      isApp ? ['exit-stay', 'Exit until next restart', 'Stays closed until the TV is switched off and on'] : null,
      isApp && native()?.checkForUpdate ? ['update', 'Check for app update', `Installed: version ${native()?.appVersion?.() || '?'}`] : null,
      isApp && st.needsOverlay ? ['overlay', 'Allow automatic reopening', 'Grant “Display over other apps” so the player can reopen itself'] : null,
      ['close', 'Close menu', ''],
    ].filter(Boolean);
    $body.innerHTML = `<div class="rm-list">${items.map(([k, t, s]) => `<button data-k="${esc(k)}"><b>${esc(t)}</b>${s ? `<span>${esc(s)}</span>` : ''}</button>`).join('')}</div>`;
    focus = 0; paintFocus();
  }

  function renderStatus() {
    mode = 'status';
    const st = getStatus();
    $title.textContent = 'Screen status';
    const rows = [
      ['Screen', st.name || '—'], ['Licence', st.licence || '—'], ['Now playing', st.playing || '—'],
      ['Connection', (st.online ? 'Online' : 'Offline') + (native()?.networkType ? ` · ${native().networkType() || '—'}` : '')], ['Device', st.model || '—'], ['App', st.app || '—'],
      ['Auto-reopen', st.isApp ? (settings.return_minutes ? `${settings.return_minutes} min after leaving${st.needsOverlay ? ' (needs permission)' : ''}` : 'Off') : 'Browser player'],
    ];
    $body.innerHTML = `<table class="rm-table">${rows.map(([a, b]) => `<tr><td>${esc(a)}</td><td>${esc(b)}</td></tr>`).join('')}</table>
      <div class="rm-list"><button data-k="back"><b>Back</b></button></div>`;
    focus = 0; paintFocus();
  }

  // ---------------------------------------------------------------- actions
  async function pressPin(k) {
    if (Date.now() < lockedUntil) return renderPin(`Too many attempts. Try again in ${Math.ceil((lockedUntil - Date.now()) / 1000)}s`);
    if (/^\d$/.test(k)) { if (pin.length < 8) pin += k; return renderPin(); }
    if (k === '⌫') { pin = pin.slice(0, -1); return renderPin(); }
    if (k === 'OK') {
      if (pin.length < 4) return renderPin('Enter at least 4 digits');
      const ok = (await sha256hex('proview-pin:' + pin)) === (await pinHash());
      pin = '';
      if (ok) { fails = 0; return renderMenu(); }
      fails++;
      if (fails >= 3) { lockedUntil = Date.now() + 60000; fails = 0; return renderPin('Too many attempts. Locked for 60 seconds'); }
      return renderPin('Wrong PIN');
    }
  }

  function action(k) {
    switch (k) {
      case 'reload': close(); onReload(); break;
      case 'status': renderStatus(); break;
      case 'back': renderMenu(); break;
      case 'exit': close(); native()?.exitToHome(settings.return_minutes || 0); break;
      case 'wifi': {
        close();
        const n = native();
        if (n?.openWifi) n.openWifi(settings.return_minutes || 0);
        else n?.exitToHome(settings.return_minutes || 0);   // older TV app: go to home screen instead
        break;
      }
      case 'exit-stay': close(); native()?.exitToHome(0); break;
      case 'overlay': native()?.openOverlayPermission(); break;
      case 'update': close(); native()?.checkForUpdate?.(true); break;
      case 'close': close(); break;
    }
  }

  function activate() {
    const b = buttons()[focus];
    if (!b) return;
    const k = b.dataset.k;
    if (mode === 'pin') pressPin(k); else action(k);
  }

  function move(dx, dy) {
    const n = buttons().length;
    if (!n) return;
    if (mode === 'pin') {
      const r = Math.floor(focus / 3), c = focus % 3;
      const nr = Math.min(3, Math.max(0, r + dy)), nc = Math.min(2, Math.max(0, c + dx));
      focus = nr * 3 + nc;
    } else {
      focus = (focus + dy + n) % n;
    }
    paintFocus();
  }

  // ---------------------------------------------------------------- open/close
  function show() {
    if (open) return true;
    open = true; pin = ''; focus = 0;
    root.classList.add('on');
    if (REQUIRE_PIN) renderPin(); else renderMenu();
    clearTimeout(closeTimer);
    closeTimer = setTimeout(close, 60000);
    return true;
  }
  function close() {
    open = false; pin = '';
    root.classList.remove('on');
    clearTimeout(closeTimer);
  }

  // Captures all keys while open
  document.addEventListener('keydown', (e) => {
    if (!open) {
      if (!native() && (e.key === 'm' || e.key === 'M' || e.key === 'ContextMenu')) { e.preventDefault(); show(); }
      return;
    }
    e.preventDefault(); e.stopImmediatePropagation();
    clearTimeout(closeTimer); closeTimer = setTimeout(close, 60000);
    const map = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    if (map[e.key]) return move(...map[e.key]);
    if (e.key === 'Enter' || e.key === ' ') return activate();
    if (e.key === 'Escape' || e.key === 'Backspace' || e.key === 'GoBack' || e.key === 'BrowserBack') {
      if (mode === 'pin' && pin && e.key === 'Backspace') return pressPin('⌫');
      if (mode === 'status') return renderMenu();
      return close();
    }
    if (mode === 'pin' && /^\d$/.test(e.key)) return pressPin(e.key);
  }, true);
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-k]');
    if (!b) return;
    focus = buttons().indexOf(b);
    activate();
  });

  // Hooks for the Android app
  window.signageRemote = { open: show, close, isOpen: () => open, back: () => { if (!open) return false; if (mode === 'status') renderMenu(); else close(); return true; } };
  if (settings.pin_hash) { try { native()?.setConfig(JSON.stringify(settings)); } catch {} }

  return { setSettings, open: show, close, isOpen: () => open };
}
