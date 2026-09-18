/**
 * 女05 全 slot 重截图（页面从磁盘聚合加载，确保标注可见）
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-female05-vision-reshoot`);
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:18080';
fs.mkdirSync(outDir, { recursive: true });

const RE = /^(\d+[A-Za-z]?)_(.+)\.json$/i;
const SLOTS = ['V01', 'V02', 'V03', 'V04', 'V05a', 'V05b', 'V06', 'V07', 'L01', 'L02', 'L03', 'L04', 'L05', 'L06', 'L07', 'L08', 'L09'];

function loadFemaleId(slot) {
  for (const f of fs.readdirSync(jsonDir).filter((n) => RE.test(n))) {
    const d = JSON.parse(fs.readFileSync(path.join(jsonDir, f), 'utf8'));
    if ((d.meta && d.meta.slot) !== slot) continue;
    if ((d.meta && d.meta.modelId) === 'female_05' || f.includes('女05')) return { id: d.id, f, ann: (d.items[0].annotations || []).length };
  }
  return null;
}

async function waitReady(page) {
  await page
    .waitForFunction(() => {
      const el = document.getElementById('scene-loader');
      if (!el) return true;
      const st = getComputedStyle(el);
      return st.display === 'none' || Number(st.opacity || 1) < 0.05;
    }, null, { timeout: 420000 })
    .catch(() => {});
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    const el = document.getElementById('scene-loader');
    if (el) el.style.display = 'none';
    const m = document.getElementById('scene-grid-modal');
    if (m) m.style.display = 'none';
  });
}

(async () => {
  console.log('[reshoot] start', outDir);
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(300000);
  await page.goto(`${baseUrl}/Solid?sandbox=headform&skipPerf=1&_=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 180000
  });
  await page.waitForSelector('#scene-grid-modal', { state: 'visible', timeout: 180000 });

  const results = [];
  for (const slot of SLOTS) {
    const info = loadFemaleId(slot);
    if (!info || !info.ann) {
      results.push({ slot, ok: false, error: 'no annos on disk' });
      continue;
    }
    console.log('[reshoot]', slot, info.id, 'ann', info.ann);
    const idx = await page.evaluate((id) => (window.customScenes || []).findIndex((s) => s && s.id === id), info.id);
    const memAnn = await page.evaluate((i) => {
      const s = (window.customScenes || [])[i];
      return s && s.items && s.items[0] && (s.items[0].annotations || []).length;
    }, idx);
    console.log('[reshoot] memAnn', memAnn);
    await page.evaluate((i) => {
      window.currentSceneIndex = -1;
      window.switchScene(i);
    }, idx);
    await waitReady(page);
    await page.waitForTimeout(1000);
    const shot = path.join(outDir, `female05-${slot}.png`);
    await page.screenshot({ path: shot, fullPage: false });
    results.push({ slot, ok: true, shot, memAnn, diskAnn: info.ann });
    console.log('[reshoot] SHOT', shot);
  }

  fs.writeFileSync(path.join(outDir, 'reshoot.json'), JSON.stringify(results, null, 2));
  await browser.close();
  console.log('DONE', outDir);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
