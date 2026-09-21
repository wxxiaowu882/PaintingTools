require('./_playwright-browsers-path');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto('http://127.0.0.1:18080/Solid?sandbox=headform&skipPerf=1&_=' + Date.now(), {
    waitUntil: 'domcontentloaded',
    timeout: 180000
  });
  await page.waitForSelector('#scene-grid-modal', { state: 'visible', timeout: 180000 });
  const idx = await page.evaluate(() => (window.customScenes || []).findIndex((s) => s && s.id === 'V02_male_bald_asian_01'));
  console.log('idx', idx);
  await page.evaluate((i) => {
    window.currentSceneIndex = -1;
    window.switchScene(i);
  }, idx);
  await page
    .waitForFunction(() => {
      const el = document.getElementById('scene-loader');
      if (!el) return true;
      const st = getComputedStyle(el);
      return st.display === 'none' || Number(st.opacity || 1) < 0.05;
    }, null, { timeout: 180000 })
    .catch(() => {});
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    const el = document.getElementById('scene-loader');
    if (el) el.style.display = 'none';
    const m = document.getElementById('scene-grid-modal');
    if (m) m.style.display = 'none';
  });
  await page.waitForFunction(() => {
    const host = window.__solidHost;
    if (!host || !host.getSceneGroup) return false;
    let n = 0;
    host.getSceneGroup().traverse((o) => {
      if (o.isMesh) n++;
    });
    return n > 0;
  }, null, { timeout: 120000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    if (!window.showAnnotations && typeof window.toggleAnnotations === 'function') window.toggleAnnotations();
    ['annotation-layer', 'dashed-line-layer', 'dashed-line-svg'].forEach((id) => {
      const n = document.getElementById(id);
      if (n) n.style.display = '';
    });
  });
  await page.waitForTimeout(400);
  const out = require('path').join(
    __dirname,
    '..',
    'runs',
    '2026-09-19T00-46-56-headform-vision-baldasian',
    'V02_anno.png'
  );
  const out2 = require('path').join(__dirname, '..', 'runs', 'bald-V02-handtune-34A.png');
  await page.screenshot({ path: out });
  await page.screenshot({ path: out2 });
  console.log('SHOT', out);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
