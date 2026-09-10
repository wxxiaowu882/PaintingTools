const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const outDir = process.argv[2] || path.resolve(__dirname, '..', 'runs', 'tmp-102-shot');
fs.mkdirSync(outDir, { recursive: true });
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:18080';

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(120000);
  await page.goto(`${baseUrl}/Solid.html?sandbox=headform&_=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 120000
  });
  await page.waitForFunction(() => Array.isArray(window.customScenes) && window.customScenes.length > 0, null, {
    timeout: 120000
  });
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    const el = document.getElementById('scene-loader');
    if (el) el.style.display = 'none';
    const m = document.getElementById('scene-grid-modal');
    if (m) m.style.display = 'none';
  });
  const idx = await page.evaluate(() => (window.customScenes || []).findIndex((s) => s && s.id === 'V02'));
  console.log('idx', idx, 'annos', await page.evaluate((i) => {
    const s = window.customScenes[i];
    return s && s.items && s.items[0] && (s.items[0].annotations || []).map((a) => a.text);
  }, idx));
  await page.evaluate((i) => {
    window.currentSceneIndex = -1;
    window.switchScene(i);
  }, idx);
  await page.waitForTimeout(4000);
  await page.evaluate(() => {
    window.showAnnotations = true;
    const el = document.getElementById('scene-loader');
    if (el) el.style.display = 'none';
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(outDir, 'V02-annotated.png'), timeout: 90000 });
  console.log('OUT', outDir);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
