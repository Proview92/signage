// Builds web/help-kb.json from web/js/pages/help-data.js: the knowledge the AI help chat answers from.
// Run on deploy (see .github/workflows/pages.yml). Usage: node tools/help-kb.js
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../web/js/pages/help-data.js'), 'utf8');
const { TV, DASH, FACTS } = new Function(src.replace(/export const/g, 'const') + '\nreturn { TV, DASH, FACTS };')();
const guide = ([title, intro, steps, tips = []]) =>
  `## ${title}\n${intro}\n${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}${tips.length ? '\nTips:\n' + tips.map((t) => `- ${t}`).join('\n') : ''}`;
const text = [
  '# Facts', FACTS.map((f) => `- ${f}`).join('\n'),
  '# TV app guides', TV.map(guide).join('\n\n'),
  '# Dashboard guides', DASH.map(guide).join('\n\n'),
].join('\n\n');
fs.writeFileSync(path.join(__dirname, '../web/help-kb.json'), JSON.stringify({ updated: new Date().toISOString(), text }));
console.log(`help-kb.json: ${text.length} characters`);
