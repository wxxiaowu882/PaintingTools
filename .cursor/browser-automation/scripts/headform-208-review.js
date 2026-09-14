/** 208 手调验收截图 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-headform-208-review`);
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:18080';
fs.mkdirSync(outDir, { recursive: true });

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${baseUrl}/Solid.html?sandbox=headform&skipPerf=1&_=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 90000
  });
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    window.useAdvancedRender = false;
    window.perfTestDone = true;
    if (window.loadJSONData) window.loadJSONData();
  });
  await page.waitForFunction(
    () => (window.customScenes || []).length > 0 && window.__solidHost,
    null,
    { timeout: 90000 }
  );
  await page.evaluate(() => {
    const m = document.getElementById('scene-grid-modal');
    if (m) m.style.display = 'none';
    const i = window.customScenes.findIndex((s) => s && s.id === 'L08');
    window.currentSceneIndex = -1;
    window.switchScene(i);
  });
  for (let i = 0; i < 100; i++) {
    const st = await page.evaluate(() => {
      let n = 0;
      try {
        window.__solidHost.getSceneGroup().traverse((o) => {
          if (o.isMesh) n++;
        });
      } catch (e) {}
      return { n, loading: !!window.isLoadingScene };
    });
    if (st.n > 0 && !st.loading) break;
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    if (window.resetAll) window.resetAll();
  });
  await page.waitForTimeout(500);
  const light = await page.evaluate(() => ({
    az: document.getElementById('azimuthVal')?.innerText,
    el: document.getElementById('elevationVal')?.innerText
  }));
  fs.writeFileSync(path.join(outDir, 'light.json'), JSON.stringify(light, null, 2));
  await page.evaluate(() => {
    try {
      if (window.stopRender) window.stopRender();
    } catch (e) {}
    window.useAdvancedRender = false;
    window.perfTestDone = true;
    const el = document.getElementById('scene-loader');
    if (el) {
      el.style.display = 'none';
      el.style.opacity = '0';
    }
    window.showAnnotations = true;
  });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(outDir, 'annos.png') });
  await page.evaluate(() => {
    window.showAnnotations = false;
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outDir, 'clean.png') });
  console.log('OUT', outDir, light);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
