// Help: step-by-step guides for the TV app and every part of the dashboard.
import { h, icon, sb } from '../core.js';

import { TV, DASH } from './help-data.js';
export { TV, DASH };

const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const rich = (s) => { const el = h('span'); el.innerHTML = esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>'); return el; };

function guide([title, intro, steps, tips = []], open) {
  return h('details', { class: 'help-guide', open },
    h('summary', {}, h('span', { class: 'help-title' }, title), h('span', { class: 'help-intro' }, intro)),
    h('ol', { class: 'help-steps' }, ...steps.map((s) => h('li', {}, rich(s)))),
    tips.length ? h('div', { class: 'help-tips' }, ...tips.map((t) => h('div', {}, h('b', {}, 'Tip: '), rich(t)))) : '');
}

// ---- AI help chat (answers from these guides; see supabase/functions/help-chat) ----
const CHAT_KEY = 'signage.helpChat';
const SUGGEST = ['How do I pair a new TV?', 'How do I add a scrolling ticker?', 'How do I set up a video wall?', 'My TV is on but shows no content'];

/** Small, safe formatter for the assistant's replies: paragraphs, numbered and bullet lists, **bold**. */
function formatReply(text) {
  const out = h('div', { class: 'hc-text' });
  let list = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const num = line.match(/^\d+[.)]\s+(.*)/), bul = line.match(/^[-•*]\s+(.*)/);
    if (num || bul) {
      const tag = num ? 'ol' : 'ul';
      if (!list || list.tagName.toLowerCase() !== tag) { list = h(tag); out.append(list); }
      list.append(h('li', {}, rich((num || bul)[1])));
    } else {
      list = null;
      if (line) out.append(h('p', {}, rich(line.replace(/^#+\s*/, ''))));
    }
  }
  return out;
}

function helpChat() {
  let msgs = []; try { msgs = JSON.parse(sessionStorage.getItem(CHAT_KEY) || '[]'); } catch {}
  let busy = false;
  const log = h('div', { class: 'hc-log', 'aria-live': 'polite' });
  const input = h('textarea', { rows: 1, placeholder: 'Ask a question, e.g. how do I change what plays at lunchtime?', maxlength: 2000,
    onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } },
    oninput: () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 140) + 'px'; } });
  const sendBtn = h('button', { class: 'btn primary', type: 'button', onclick: () => send() }, 'Ask');
  const clearBtn = h('button', { class: 'btn ghost sm', type: 'button', onclick: () => { msgs = []; save(); paint(); input.focus(); } }, 'New chat');
  const save = () => { try { sessionStorage.setItem(CHAT_KEY, JSON.stringify(msgs.slice(-20))); } catch {} };

  function paint() {
    clearBtn.style.display = msgs.length ? '' : 'none';
    log.replaceChildren(...(msgs.length ? msgs.map((m) => h('div', { class: 'hc-msg ' + (m.role === 'user' ? 'me' : m.error ? 'err' : 'ai') },
      m.role === 'user' ? h('div', { class: 'hc-text' }, m.content) : formatReply(m.content)))
      : [h('div', { class: 'hc-empty' }, h('div', { class: 'muted' }, 'Try one of these:'),
          h('div', { class: 'hc-suggest' }, ...SUGGEST.map((q) => h('button', { type: 'button', class: 'chip', onclick: () => send(q) }, q))))]),
      ...(busy ? [h('div', { class: 'hc-msg ai' }, h('div', { class: 'hc-dots', 'aria-label': 'Thinking' }, h('i'), h('i'), h('i')))] : []));
    log.scrollTop = log.scrollHeight;
    sendBtn.disabled = busy;
  }

  async function send(text) {
    const q = (text ?? input.value).trim();
    if (!q || busy) return;
    input.value = ''; input.style.height = 'auto';
    msgs.push({ role: 'user', content: q }); busy = true; paint();
    let reply, error;
    try {
      const history = msgs.filter((m) => !m.error).map(({ role, content }) => ({ role, content }));
      const { data, error: err } = await sb.functions.invoke('help-chat', { body: { messages: history, page: 'Help' } });
      if (err) { try { const j = await err.context?.json?.(); error = j?.error || (j?.message && `The help assistant is not available right now (${j.message}).`); } catch {} error ||= 'The help assistant is not available right now.'; }
      else reply = data?.reply;
    } catch { error = 'Could not reach the help assistant. Check your internet connection.'; }
    busy = false;
    msgs.push(reply ? { role: 'assistant', content: reply } : { role: 'assistant', error: true, content: /8935/.test(error) ? error : `${error} You can also search the guides below or call 020 8935 5495.` });
    save(); paint();
    input.focus();
  }

  paint();
  return h('div', { class: 'card hc' },
    h('div', { class: 'card-head' },
      h('div', {}, h('h2', {}, 'Ask for help'), h('div', { class: 'tiny' }, 'AI assistant · answers from the guides below. It can make mistakes: for anything urgent call 020 8935 5495.')),
      clearBtn),
    log,
    h('div', { class: 'hc-form' }, input, sendBtn));
}

export async function helpPage({ main }) {
  let tab = sessionStorage.getItem('signage.helpTab') || 'tv', term = '';
  const list = h('div', { class: 'help-list' });
  const tabs = h('div', { class: 'seg help-tabs' });
  const search = h('input', { type: 'search', placeholder: 'Search the help, e.g. ticker, Wi-Fi, publish', oninput: (e) => { term = e.target.value.trim().toLowerCase(); paint(); } });

  function paint() {
    tabs.replaceChildren(...[['tv', 'TV app'], ['dash', 'Dashboard']].map(([k, l]) =>
      h('button', { type: 'button', class: tab === k && !term ? 'on' : '', onclick: () => { tab = k; sessionStorage.setItem('signage.helpTab', k); search.value = ''; term = ''; paint(); } }, l)));
    const all = term ? [...TV.map((g) => ['TV app', g]), ...DASH.map((g) => ['Dashboard', g])] : (tab === 'tv' ? TV : DASH).map((g) => ['', g]);
    const hits = term ? all.filter(([, g]) => JSON.stringify(g).toLowerCase().includes(term)) : all;
    list.replaceChildren(...(hits.length ? hits.map(([where, g], i) => h('div', {}, where ? h('div', { class: 'tiny help-where' }, where) : '', guide(g, !!term || i === 0)))
      : [h('div', { class: 'muted' }, 'Nothing matches. Try another word, or call support on 020 8935 5495.')]));
  }
  paint();

  main.replaceChildren(
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, 'Help'), h('p', { class: 'muted' }, 'Step-by-step guides for the TV app and the dashboard.'))),
    h('div', { class: 'help-downloads' },
      h('a', { class: 'btn', href: 'docs/PROVIEW-SIGNAGE-TV-App-Guide.pdf', download: '', target: '_blank', rel: 'noopener' }, icon('download'), 'TV app guide (PDF)'),
      h('a', { class: 'btn', href: 'docs/PROVIEW-SIGNAGE-Dashboard-Guide.pdf', download: '', target: '_blank', rel: 'noopener' }, icon('download'), 'Dashboard guide (PDF)')),
    helpChat(),
    h('div', { class: 'help-bar' }, tabs, search),
    list,
    h('div', { class: 'card help-contact' }, h('div', { class: 'card-body' },
      h('b', {}, 'Still stuck?'), ' Call PROVIEW support on ', h('a', { href: 'tel:02089355495' }, '020 8935 5495'), ' or visit ', h('a', { href: 'https://www.proviewsignage.co.uk', target: '_blank', rel: 'noopener' }, 'proviewsignage.co.uk'), '.')));
}
