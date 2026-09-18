/** 203c：裁切居中 + 重截缩略图 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-headform-203c`);
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:18080';
fs.mkdirSync(outDir, { recursive: true });

function load203() {
  const f = fs.readdirSync(jsonDir).find((n) => n.startsWith('203_') && n.endsWith('.json'));
  const full = path.join(jsonDir, f);
  return { f, full, data: JSON.parse(fs.readFileSync(full, 'utf8')) };
}
function rebuild() {
  const files = fs
    .readdirSync(jsonDir)
    .filter((fn) => /^\d+[A-Za-z]?_.+\.json$/i.test(fn))
    .sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));
  fs.writeFileSync(
    path.join(jsonDir, '沙盒_头部造型规律.json'),
    JSON.stringify(files.map((fn) => JSON.parse(fs.readFileSync(path.join(jsonDir, fn), 'utf8')))) + '\n'
  );
}

(async () => {
  const file = load203();
  file.data.crop = {
    display: 'block',
    left: '260px',
    top: '70px',
    width: '760px',
    height: '760px'
  };
  file.data.id = 'L03';
  file.data.meta = Object.assign({}, file.data.meta, { line: 'light', slot: 'L03', status: 'seeded' });
  fs.writeFileSync(file.full, JSON.stringify(file.data) + '\n');
  rebuild();

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${baseUrl}/Solid.html?sandbox=headform&skipPerf=1&_=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 120000
  });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    window.useAdvancedRender = false;
    window.perfTestDone = true;
    window._solidUserStoppedRender = true;
    try {
      if (typeof window.stopRender === 'function') window.stopRender();
    } catch (e) {}
    if (window.loadJSONData) window.loadJSONData();
  });
  await page.waitForFunction(() => (window.customScenes || []).length > 0, null, { timeout: 120000 });
  await page.waitForFunction(() => !!(window.__solidHost && window.__solidHost.getCamera), null, {
    timeout: 120000
  });
  await page.evaluate(() => {
    const m = document.getElementById('scene-grid-modal');
    if (m) m.style.display = 'none';
    const scenes = window.customScenes || [];
    let i = scenes.findIndex((s) => s && s.id === 'L03');
    if (i < 0) i = scenes.findIndex((s) => s && /蝴蝶/.test(String(s.name || '')));
    window.currentSceneIndex = -1;
    window.switchScene(i);
  });
  for (let i = 0; i < 80; i++) {
    const n = await page.evaluate(() => {
      let c = 0;
      try {
        window.__solidHost.getSceneGroup().traverse((o) => {
          if (o.isMesh) c++;
        });
      } catch (e) {}
      return c;
    });
    if (n > 0) break;
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(2200);
  for (let k = 0; k < 5; k++) {
    await page.evaluate(() => {
      try {
        if (typeof window.stopRender === 'function') window.stopRender();
      } catch (e) {}
      window.useAdvancedRender = false;
      const el = document.getElementById('scene-loader');
      if (el) el.style.display = 'none';
    });
    await page.waitForTimeout(280);
  }

  const crop = { x: 260, y: 70, width: 760, height: 720 };
  await page.evaluate(() => {
    if (window.showAnnotations !== false && typeof window.toggleAnnotations === 'function') window.toggleAnnotations();
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outDir, 'L03-light-only.png'), clip: crop });
  await page.evaluate(() => {
    if (window.showAnnotations !== true && typeof window.toggleAnnotations === 'function') window.toggleAnnotations();
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outDir, 'L03-annotated-crop.png'), clip: crop });
  await page.evaluate(() => {
    if (window.showAnnotations !== false && typeof window.toggleAnnotations === 'function') window.toggleAnnotations();
  });
  await page.waitForTimeout(300);
  const thumb = await page.screenshot({
    type: 'jpeg',
    quality: 72,
    clip: { x: crop.x + 30, y: crop.y + 30, width: 700, height: 700 }
  });
  const f2 = load203();
  f2.data.thumbnail = 'data:image/jpeg;base64,' + thumb.toString('base64');
  f2.data.id = 'L03';
  fs.writeFileSync(f2.full, JSON.stringify(f2.data) + '\n');
  rebuild();
  console.log('OUT', outDir);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
