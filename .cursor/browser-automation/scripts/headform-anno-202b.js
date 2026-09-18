/**
 * 202 光位微调：在「接上」与「三角亮仍可读」之间找档；写回缩略图
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-headform-202b`);
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:18080';
fs.mkdirSync(outDir, { recursive: true });

function load202() {
  const f = fs.readdirSync(jsonDir).find((n) => n.startsWith('202_') && n.endsWith('.json'));
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

async function forceRaster(page) {
  await page.evaluate(() => {
    try {
      if (typeof window.stopRender === 'function') window.stopRender();
    } catch (e) {}
    window._solidUserStoppedRender = true;
    window.useAdvancedRender = false;
    window.perfTestDone = true;
    window.isLoadingScene = false;
    const el = document.getElementById('scene-loader');
    if (el) {
      el.style.display = 'none';
      el.style.opacity = '0';
    }
  });
}

async function waitMeshes(page) {
  for (let i = 0; i < 120; i++) {
    const n = await page.evaluate(() => {
      let c = 0;
      try {
        window.__solidHost.getSceneGroup().traverse((o) => {
          if (o.isMesh) c++;
        });
      } catch (e) {}
      return c;
    });
    if (n > 0) return n;
    await page.waitForTimeout(400);
  }
  return 0;
}

(async () => {
  // 比 46/42 再侧、再高：逼鼻影接到颊影，仍留暗颊三角亮
  const chosen = { azimuth: 36, elevation: 46, size: 9, intensity: 2.2 };
  const file = load202();
  Object.assign(file.data.light, chosen);
  file.data.env.skyLightScale = 0.5;
  file.data.id = 'L02';
  file.data.meta = Object.assign({}, file.data.meta, {
    line: 'light',
    slot: 'L02',
    status: 'seeded'
  });
  fs.writeFileSync(file.full, JSON.stringify(file.data) + '\n');
  rebuild();

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${baseUrl}/Solid.html?sandbox=headform&skipPerf=1&_=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 120000
  });
  await page.waitForTimeout(2000);
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
    let i = scenes.findIndex((s) => s && s.id === 'L02');
    if (i < 0) i = scenes.findIndex((s) => s && /伦勃朗|Rembrandt/i.test(String(s.name || '')));
    window.currentSceneIndex = -1;
    window.switchScene(i);
  });
  const n = await waitMeshes(page);
  console.log('meshes', n);
  if (n < 1) throw new Error('no mesh');
  await page.waitForTimeout(2500);
  for (let k = 0; k < 6; k++) {
    await forceRaster(page);
    await page.waitForTimeout(350);
  }

  const crop = await page.evaluate(() => {
    const s = (window.customScenes || []).find((x) => x && (x.id === 'L02' || /伦勃朗/.test(String(x.name || ''))));
    const c = (s && s.crop) || {};
    return {
      x: parseFloat(c.left) || 450,
      y: parseFloat(c.top) || 90,
      width: Math.min(760, parseFloat(c.width) || 760),
      height: 720
    };
  });

  // 关标注须走 toggleAnnotations（applySolidAnnotationOverlayLayers 未挂 window）
  await page.evaluate(() => {
    if (window.showAnnotations !== false && typeof window.toggleAnnotations === 'function') {
      window.toggleAnnotations();
    }
  });
  await forceRaster(page);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outDir, 'L02-light-crop.png'), clip: crop });
  await page.evaluate(() => {
    if (window.showAnnotations !== true && typeof window.toggleAnnotations === 'function') {
      window.toggleAnnotations();
    }
  });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(outDir, 'L02-annotated-full.png') });
  await page.screenshot({ path: path.join(outDir, 'L02-annotated-crop.png'), clip: crop });
  await page.evaluate(() => {
    if (window.showAnnotations !== false && typeof window.toggleAnnotations === 'function') {
      window.toggleAnnotations();
    }
  });
  await page.waitForTimeout(300);
  const thumb = await page.screenshot({
    type: 'jpeg',
    quality: 72,
    clip: { x: crop.x + 20, y: crop.y + 20, width: 700, height: 700 }
  });
  const f2 = load202();
  f2.data.thumbnail = 'data:image/jpeg;base64,' + thumb.toString('base64');
  fs.writeFileSync(f2.full, JSON.stringify(f2.data) + '\n');
  rebuild();
  console.log('OUT', outDir, 'light', chosen);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
