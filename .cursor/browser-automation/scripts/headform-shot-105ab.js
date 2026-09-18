/**
 * 截取 105A / 105B 当前标注画面，供 AI 视觉核对
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const outDir = path.resolve(__dirname, '..', 'runs', '105ab-vision');
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:18080';
fs.mkdirSync(outDir, { recursive: true });

function rebuildAggregate() {
  const files = fs
    .readdirSync(jsonDir)
    .filter((fn) => /^\d+[A-Za-z]?_.+\.json$/i.test(fn))
    .sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));
  const merged = files.map((fn) => JSON.parse(fs.readFileSync(path.join(jsonDir, fn), 'utf8')));
  fs.writeFileSync(path.join(jsonDir, '沙盒_头部造型规律.json'), JSON.stringify(merged) + '\n');
  return merged.length;
}

async function boot(page) {
  await page.goto(`${baseUrl}/Solid.html?sandbox=headform&skipPerf=1&_=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 90000
  });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    window.useAdvancedRender = false;
    window.perfTestDone = true;
    window.isTestingPerformance = false;
    if ((!window.customScenes || !window.customScenes.length) && window.loadJSONData) window.loadJSONData();
  });
  await page.waitForFunction(
    () => (window.customScenes || []).length > 0 && window.__solidHost && window.__solidHost.getCamera(),
    null,
    { timeout: 90000 }
  );
}

async function openByIndex(page, index) {
  await page.evaluate((idx) => {
    const m = document.getElementById('scene-grid-modal');
    if (m) m.style.display = 'none';
    window.currentSceneIndex = -1;
    window.switchScene(idx);
  }, index);
  for (let i = 0; i < 80; i++) {
    const n = await page.evaluate(() => {
      let c = 0;
      try {
        window.__solidHost.getSceneGroup().traverse((o) => {
          if (o.isMesh) c++;
        });
      } catch (_e) {}
      return c;
    });
    if (n > 0) break;
    await page.waitForTimeout(400);
  }
  await page.evaluate(() => {
    const el = document.getElementById('scene-loader');
    if (el) el.style.display = 'none';
    const m = document.getElementById('scene-grid-modal');
    if (m) m.style.display = 'none';
  });
  await page.waitForTimeout(1400);
}

async function main() {
  rebuildAggregate();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(120000);
  await boot(page);

  const list = await page.evaluate(() =>
    (window.customScenes || []).map((s, i) => ({
      i,
      name: s && s.name,
      camZ: s && s.camera && s.camera.pos && s.camera.pos[2],
      labels: ((s.items && s.items[0] && s.items[0].annotations) || []).map((a) => a.text)
    }))
  );
  fs.writeFileSync(path.join(outDir, 'scene-list.json'), JSON.stringify(list, null, 2), 'utf8');
  console.log(
    'scenes',
    list.filter((x) => /侧后|全侧/.test(String(x.name || '')))
  );

  const targets = list.filter((x) => String(x.name || '').includes('侧后'));
  for (const t of targets) {
    await openByIndex(page, t.i);
    const tag = /见鼻/.test(t.name) ? 'see-nose' : /隐鼻/.test(t.name) ? 'hide-nose' : 'side-rear';
    const shot = path.join(outDir, `live_${tag}_${t.i}.png`);
    await page.screenshot({ path: shot, fullPage: false });
    console.log('shot', shot, t.name);
  }
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
