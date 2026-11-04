// Builds the two branded PDF guides from the Help page text (web/js/pages/help.js).
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = '/home/claude/signage/web';
const SHOTS = '/home/claude/guides/shots';
const OUT = '/home/claude/guides/out';
fs.mkdirSync(OUT, { recursive: true });

// Pull the guide data out of help.js (the part between the two arrays and the helpers).
const src = fs.readFileSync(path.join(ROOT, 'js/pages/help.js'), 'utf8');
const body = src.slice(src.indexOf('export const TV'), src.indexOf('const esc'));
const { TV, DASH } = new Function(body.replace(/export const/g, 'const') + '\nreturn { TV, DASH };')();

const SHOTS_FOR = {
  'Set up a new TV': [['tv-pair', 'The pairing screen on the TV'], ['d-addtv', 'Screens → Add a TV in the dashboard']],
  'What the TV does on its own': [['tv-playing', 'A paired TV playing its playlist']],
  'Open the TV menu with the remote': [['tv-menu', 'The screen menu']],
  'TV menu options': [['tv-status', 'Screen status'], ['tv-unlink', 'Unlink this TV asks you to confirm']],
  'Media library': [['d-media', 'Media']],
  'Create a playlist': [['d-playlists', 'Playlists']],
  'Editor step 1 · Screen & layout': [['d-step1', 'Step 1 · Screen & layout']],
  'Editor step 2 · Add / edit content': [['d-step2', 'Step 2 · Add / edit content']],
  'Editor step 3 · Schedule': [['d-step3', 'Step 3 · Schedule']],
  'Editor step 4 · Choose TVs & publish': [['d-step4', 'Step 4 · Choose TVs & publish'], ['d-publish', 'Choosing the TVs']],
  'Screens': [['d-screens', 'Screens']],
  'A TV’s own page': [['d-screen', 'A TV’s own page']],
  'Video walls': [['d-wall', 'Setting up a video wall']],
  'Emergency message': [['d-emergency', 'Emergency message']],
  'Reports (proof of play)': [['d-reports', 'Reports']],
  'Activity': [['d-activity', 'Activity and publish requests']],
  'Team and roles': [['d-team', 'Team']],
};

const img64 = (f) => 'data:image/' + (f.endsWith('.jpg') ? 'jpeg' : 'png') + ';base64,' + fs.readFileSync(f).toString('base64');
const LOGO = img64(path.join(ROOT, 'logo.png'));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const rich = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
const DATE = 'November 2026';

const CSS = `
* { box-sizing: border-box; }
body { margin: 0; font-family: Inter, "Segoe UI", Arial, sans-serif; color: #1d1d24; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.wm { letter-spacing: .16em; font-weight: 500; }
.wm span { background: linear-gradient(90deg, #62b0ec, #8b88dc); -webkit-background-clip: text; background-clip: text; color: transparent; }
/* cover */
.cover { width: 210mm; height: 297mm; position: relative; overflow: hidden; color: #fff;
  background: radial-gradient(ellipse at 25% 15%, #24304a 0%, #10131d 55%, #0b0c12 100%); padding: 26mm 22mm; display: flex; flex-direction: column; }
.cover .glow { position: absolute; right: -40mm; bottom: -40mm; width: 160mm; height: 160mm; border-radius: 50%; background: radial-gradient(circle, rgba(90,95,187,.45), rgba(47,132,212,.15) 45%, transparent 70%); }
.cover .brand { display: flex; align-items: center; gap: 5mm; }
.cover .brand img { height: 15mm; }
.cover .brand .wm { font-size: 15pt; }
.cover .mid { margin-top: auto; margin-bottom: auto; position: relative; }
.cover .kicker { font-size: 11pt; letter-spacing: .2em; text-transform: uppercase; color: #8fb8ee; font-weight: 600; }
.cover h1 { font-size: 44pt; line-height: 1.05; margin: 5mm 0 6mm; font-weight: 800; letter-spacing: -.01em; }
.cover h1 em { font-style: normal; background: linear-gradient(90deg, #62b0ec, #8b88dc); -webkit-background-clip: text; background-clip: text; color: transparent; }
.cover p { font-size: 13pt; line-height: 1.55; color: #c9d3ea; max-width: 140mm; margin: 0; }
.cover .hero { margin-top: 12mm; width: 150mm; border-radius: 4mm; box-shadow: 0 10mm 30mm rgba(0,0,0,.55); border: 1px solid rgba(255,255,255,.12); }
.cover .foot { position: relative; display: flex; justify-content: space-between; font-size: 10pt; color: #9fb0cf; border-top: 1px solid rgba(255,255,255,.14); padding-top: 5mm; }
.cover .foot b { color: #fff; font-weight: 600; }
/* inner pages */
.page { padding: 0 18mm; }
.toc { padding-top: 6mm; }
h2.toc-h { font-size: 22pt; margin: 0 0 2mm; }
.toc .sub { color: #6b6b78; margin: 0 0 8mm; font-size: 11pt; }
.toc ol { list-style: none; padding: 0; margin: 0; columns: 1; }
.toc li { display: flex; gap: 4mm; align-items: baseline; padding: 1.9mm 0; border-bottom: 1px solid #ecebe6; font-size: 11.5pt; }
.toc li .n { color: #4a6cd0; font-weight: 700; width: 9mm; flex: none; }
.toc li .i { color: #8a8a96; font-size: 9.5pt; margin-left: auto; text-align: right; max-width: 85mm; }
.howto { margin-top: 9mm; background: #eef3fd; border-radius: 3mm; padding: 5mm 6mm; font-size: 10.5pt; line-height: 1.5; color: #33405e; }
.guide { padding-top: 9mm; }
.guide.newpage { break-before: page; }
.guide.short { break-inside: avoid; }
.ghead { display: flex; gap: 4mm; align-items: center; break-after: avoid; }
.num { width: 11mm; height: 11mm; border-radius: 50%; background: linear-gradient(135deg, #2f84d4, #5a5fbb); color: #fff; font-weight: 700; font-size: 12pt; display: grid; place-items: center; flex: none; }
.ghead h3 { font-size: 17pt; margin: 0; letter-spacing: -.01em; }
.intro { color: #6b6b78; font-size: 11pt; margin: 2mm 0 5mm 15mm; break-after: avoid; }
figure { margin: 0 0 5mm; break-inside: avoid; }
figure img { width: 100%; max-height: 100mm; object-fit: contain; object-position: top; border-radius: 2.5mm; border: 1px solid #e3e2dc; box-shadow: 0 1.5mm 5mm rgba(20,24,40,.10); display: block; }
figure.half img { max-height: 95mm; width: auto; max-width: 100%; margin: 0 auto; }
figure.half { display: inline-block; width: calc(50% - 3mm); vertical-align: top; }
figure.half + figure.half { margin-left: 5mm; }
figure.dialog img { width: auto; max-width: 100%; max-height: 85mm; margin: 0 auto; }
figcaption { font-size: 9pt; color: #8a8a96; margin-top: 2mm; text-align: center; }
ol.steps { list-style: none; counter-reset: s; padding: 0; margin: 0 0 4mm; }
ol.steps li { counter-increment: s; position: relative; padding: 2.2mm 0 2.2mm 12mm; font-size: 11pt; line-height: 1.5; break-inside: avoid; border-bottom: 1px dashed #ecebe6; }
ol.steps li:last-child { border-bottom: 0; }
ol.steps li::before { content: counter(s); position: absolute; left: 0; top: 2mm; width: 7.5mm; height: 7.5mm; border-radius: 50%; background: #eaf1fd; color: #3f6fd0; font-weight: 700; font-size: 9.5pt; display: grid; place-items: center; }
ol.steps b { color: #1d1d24; font-weight: 650; }
.tips { background: #fff8e8; border-left: 1.2mm solid #f0b400; border-radius: 1.5mm; padding: 3.5mm 5mm; font-size: 10pt; line-height: 1.5; margin-bottom: 4mm; break-inside: avoid; }
.tips div + div { margin-top: 1.5mm; }
.back { break-before: page; padding-top: 70mm; text-align: center; }
.back img { height: 18mm; }
.back .wm { display: block; font-size: 15pt; margin: 4mm 0 10mm; color: #1d1d24; }
.back h3 { font-size: 18pt; margin: 0 0 3mm; }
.back p { color: #6b6b78; font-size: 11.5pt; line-height: 1.6; margin: 0; }
.back .contact { margin: 9mm auto 0; display: inline-flex; gap: 10mm; font-size: 12pt; font-weight: 600; }
`;

function figures(title) {
  const list = SHOTS_FOR[title] || [];
  const dialogish = (f) => /addtv|publish|emergency|wall/.test(f);
  const half = list.length === 2;
  return list.map(([f, cap]) => `<figure class="${half ? 'half' : ''} ${dialogish(f) && !half ? 'dialog' : ''}"><img src="${img64(path.join(SHOTS, f + '.jpg'))}"><figcaption>${esc(cap)}</figcaption></figure>`).join('');
}

function buildBody(guides, intro) {
  const toc = `<section class="page toc"><h2 class="toc-h">Contents</h2><p class="sub">${esc(intro)}</p><ol>${guides.map(([t, i], k) =>
    `<li><span class="n">${String(k + 1).padStart(2, '0')}</span><span>${esc(t)}</span><span class="i">${esc(i)}</span></li>`).join('')}</ol>
    <div class="howto"><b>How to use this guide.</b> Each section is a set of numbered steps. Words in <b>bold</b> are the buttons and menu names you will see on screen. Yellow boxes are tips. The pictures show example content.</div></section>`;
  const sections = guides.map(([t, intro2, steps, tips = []], k) => {
    const hasPics = (SHOTS_FOR[t] || []).length > 0;
    return `<section class="page guide ${k === 0 || hasPics ? 'newpage' : ''} ${!hasPics && steps.length <= 7 ? 'short' : ''}">
      <div class="ghead"><div class="num">${k + 1}</div><h3>${esc(t)}</h3></div>
      <div class="intro">${esc(intro2)}</div>
      ${figures(t)}
      <ol class="steps">${steps.map((s) => `<li>${rich(s)}</li>`).join('')}</ol>
      ${tips.length ? `<div class="tips">${tips.map((x) => `<div><b>Tip:</b> ${rich(x)}</div>`).join('')}</div>` : ''}
    </section>`;
  }).join('');
  const back = `<section class="page back"><img src="${LOGO}"><span class="wm">PROVIEW<span>SIGNAGE</span></span>
    <h3>Need a hand?</h3><p>Our team is happy to help with setup, content and anything else.<br>The Help page in the dashboard has these guides too, with search.</p>
    <div class="contact"><span>☎ 020 8935 5495</span><span>www.proviewsignage.co.uk</span></div></section>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page { size: A4; margin: 14mm 0 16mm; }${CSS}</style></head><body>${toc}${sections}${back}</body></html>`;
}

function buildCover({ kicker, title, blurb, hero }) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>@page { size: A4; margin: 0; }${CSS}</style></head><body><div class="cover"><div class="glow"></div>
    <div class="brand"><img src="${LOGO}"><span class="wm">PROVIEW<span>SIGNAGE</span></span></div>
    <div class="mid"><div class="kicker">${esc(kicker)}</div><h1>${title}</h1><p>${esc(blurb)}</p>
      <img class="hero" src="${img64(path.join(SHOTS, hero + '.jpg'))}"></div>
    <div class="foot"><span><b>www.proviewsignage.co.uk</b> · app.proviewsignage.co.uk</span><span>Support <b>020 8935 5495</b> · ${DATE}</span></div></div></body></html>`;
}

const FOOTER = (name) => `<div style="width:100%;font-family:Inter,Arial,sans-serif;font-size:8px;color:#9a9aa4;padding:0 18mm;display:flex;justify-content:space-between;">
  <span><b style="color:#1d1d24;letter-spacing:.12em;font-weight:600">PROVIEW</b><b style="color:#5b8fdc;letter-spacing:.12em;font-weight:600">SIGNAGE</b> &nbsp;·&nbsp; ${name}</span>
  <span>Support 020 8935 5495 &nbsp;·&nbsp; Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const docs = [
    { file: 'PROVIEW-SIGNAGE-TV-App-Guide.pdf', name: 'TV App Guide', guides: TV, hero: 'tv-menu',
      kicker: 'TV App Guide', title: 'Your screens,<br><em>set up and running</em>',
      blurb: 'Step-by-step instructions for installing, pairing and looking after the PROVIEW SIGNAGE app on Android TV, Google TV and Fire TV.',
      intro: 'Everything you need to set up the TV app and use the screen menu with the remote.' },
    { file: 'PROVIEW-SIGNAGE-Dashboard-Guide.pdf', name: 'Dashboard Guide', guides: DASH, hero: 'd-step2',
      kicker: 'Dashboard Guide', title: 'Create, schedule<br><em>and publish</em>',
      blurb: 'A complete walkthrough of the PROVIEW SIGNAGE dashboard: media, playlists, layouts, schedules, TVs, reports, team and more.',
      intro: 'Every part of the dashboard at app.proviewsignage.co.uk, one step at a time.' },
  ];
  for (const d of docs) {
    await page.setContent(buildCover(d), { waitUntil: 'load' });
    const cover = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
    await page.setContent(buildBody(d.guides, d.intro), { waitUntil: 'load' });
    const inner = await page.pdf({ format: 'A4', printBackground: true, displayHeaderFooter: true,
      headerTemplate: '<div></div>', footerTemplate: FOOTER(d.name), margin: { top: '14mm', bottom: '16mm', left: '0', right: '0' } });
    fs.writeFileSync(path.join(OUT, 'cover.pdf'), cover);
    fs.writeFileSync(path.join(OUT, 'inner.pdf'), inner);
    require('child_process').execFileSync('python3', ['-c', `
from pypdf import PdfReader, PdfWriter
w = PdfWriter()
for f in ['${OUT}/cover.pdf', '${OUT}/inner.pdf']:
    for p in PdfReader(f).pages: w.add_page(p)
w.add_metadata({'/Title': 'PROVIEW SIGNAGE ${d.name}', '/Author': 'PROVIEW SIGNAGE', '/Subject': '${d.name}'})
w.write('${OUT}/${d.file}')
`]);
    console.log('built', d.file);
  }
  fs.unlinkSync(path.join(OUT, 'cover.pdf')); fs.unlinkSync(path.join(OUT, 'inner.pdf'));
  await browser.close();
})();
