/**
 * 拍 headform 净图（关掉标注层）供 AI 视觉定点
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-headform-clean`);
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:18080';
const ids = (process.env.SCENE_IDS || 'V01,L01').split(',').map((s) => s.trim());
fs.mkdirSync(outDir, { recursive: true });

async function waitReady(page) {
  await page.waitForFunction(() => {
    const el = document.getElementById('scene-loader');
    if (!el) return true;
    const st = getComputedStyle(el);
    return st.display === 'none' || Number(st.opacity || 1) < 0.05;
  }, null, { timeout: 180000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    const el = document.getElementById('scene-loader');
    if (el) el.style.display = 'none';
    const m = document.getElementById('scene-grid-modal');
    if (m) m.style.display = 'none';
    window.showAnnotations = false;
    ['annotation-layer', 'dashed-line-layer', 'dashed-line-svg'].forEach((id) => {
      const n = document.getElementById(id);
      if (n) n.style.display = 'none';
    });
  });
}

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${baseUrl}/Solid.html?sandbox=headform&_=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 90000
  });
  await page.waitForFunction(() => Array.isArray(window.customScenes) && window.customScenes.length > 0, null, {
    timeout: 90000
  });
  await page.waitForFunction(() => !!(window.__solidHost && window.__solidHost.getCamera()), null, {
    timeout: 90000
  });
  await waitReady(page);

  for (const id of ids) {
    const idx = await page.evaluate((want) => {
      return (window.customScenes || []).findIndex((s) => s && String(s.id) === String(want));
    }, id);
    await page.evaluate((i) => {
      window.currentSceneIndex = -1;
      window.switchScene(i);
    }, idx);
    await waitReady(page);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(outDir, `${id}-clean.png`), timeout: 60000 });
    console.log('shot', id);
  }
  console.log('OUT', outDir);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
