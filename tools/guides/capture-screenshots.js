const { chromium } = require('playwright');
const w = (ms) => new Promise((r) => setTimeout(r, ms));
const OUT = '/home/claude/guides/shots/';
(async () => {
  const b = await chromium.launch(); const errs = [];
  // ---- TV
  const tv = async (user) => { const a = await b.newContext({ viewport: { width: 960, height: 540 }, deviceScaleFactor: 2 });
    await a.addInitScript((u) => { if (!sessionStorage.x) { localStorage.clear(); sessionStorage.x = 1; } localStorage.setItem('mocksession', JSON.stringify({ access_token: 'x', user: { id: u, device: true } }));
      window.SignageNative = { canReopen: () => true, exitToHome() {}, openWifi() {}, setConfig() {}, checkForUpdate() {}, appVersion: () => '2.6', networkType: () => 'Wi-Fi', updateAvailable: () => '', captureScreen() {}, openOverlayPermission() {} }; }, user);
    const p = await a.newPage(); p.on('pageerror', (e) => errs.push(e.message)); await p.goto('http://localhost:8080/player.html?app=2.6&model=' + encodeURIComponent('Fire TV Stick 4K')); return p; };
  let p = await tv('dnew'); await w(3000); await p.evaluate(() => document.querySelectorAll('b, strong, span').forEach((e) => { if (e.textContent.trim() === 'localhost:8080') e.textContent = 'app.proviewsignage.co.uk'; })); await p.screenshot({ path: OUT + 'tv-pair.png' });
  p = await tv('d1'); await w(4500); await p.screenshot({ path: OUT + 'tv-playing.png' });
  await p.evaluate(() => window.signageRemote.open()); await w(400); await p.screenshot({ path: OUT + 'tv-menu.png' });
  await p.click('#remote button[data-k="status"]'); await w(300); await p.screenshot({ path: OUT + 'tv-status.png' });
  await p.keyboard.press('Escape'); await w(200);
  await p.click('#remote button[data-k="unlink"]'); await w(300); await p.screenshot({ path: OUT + 'tv-unlink.png' });
  // ---- Dashboard
  const a = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await a.addInitScript(() => { if (!sessionStorage.x) { localStorage.removeItem('mockdb'); sessionStorage.x = 1; } localStorage.setItem('mocksession', JSON.stringify({ access_token: 'x', user: { id: 'u-admin', email: 'altun@proviewtech.co.uk' } })); localStorage.setItem('signage.client', 'c-acme'); });
  p = await a.newPage(); p.on('pageerror', (e) => errs.push(e.message));
  const shot = async (name) => { await w(1500); await p.screenshot({ path: OUT + name + '.png', clip: { x: 236, y: 0, width: 1204, height: 900 } }); };
  await p.goto('http://localhost:8080/index.html#/screens'); await shot('d-screens');
  await p.click('button:has-text("Add a TV")'); await w(500); await p.locator('.modal').screenshot({ path: OUT + 'd-addtv.png' }); await p.keyboard.press('Escape');
  await p.goto('http://localhost:8080/index.html#/screen/s1'); await shot('d-screen');
  await p.goto('http://localhost:8080/index.html#/playlists'); await shot('d-playlists');
  await p.goto('http://localhost:8080/index.html#/media'); await shot('d-media');
  await p.goto('http://localhost:8080/index.html#/playlists'); await w(1200);
  await p.locator('a:has-text("Edit")').first().click(); await w(1500);
  await p.click('.ed-steps button:has-text("Screen")'); await shot('d-step1');
  await p.click('.ed-steps button:has-text("Add / edit")'); await shot('d-step2');
  await p.click('.ed-steps button:has-text("Schedule")'); await shot('d-step3');
  await p.click('.ed-steps button:has-text("Choose TVs")'); await shot('d-step4');
  await p.click('.page-head button:has-text("Publish")'); await w(1000); await p.locator('.modal').screenshot({ path: OUT + 'd-publish.png' }); await p.keyboard.press('Escape');
  await p.goto('http://localhost:8080/index.html#/reports'); await shot('d-reports');
  await p.goto('http://localhost:8080/index.html#/activity'); await shot('d-activity');
  await p.goto('http://localhost:8080/index.html#/team'); await shot('d-team');
  await p.goto('http://localhost:8080/index.html#/screens'); await w(1200);
  await p.click('button:has-text("Emergency message")'); await w(500); await p.locator('.modal').screenshot({ path: OUT + 'd-emergency.png' }); await p.keyboard.press('Escape');
  await p.click('button:has-text("Video wall")').catch(() => {}); await w(600); if (await p.locator('.modal').count()) { await p.locator('.modal').screenshot({ path: OUT + 'd-wall.png' }); await p.keyboard.press('Escape'); }
  console.log('errors', errs); await b.close();
})();
