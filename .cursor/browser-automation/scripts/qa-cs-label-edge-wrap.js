/**
 * 取色标签贴右缘：不应一字竖条
 * PORT=18080 PLAYWRIGHT_CHANNEL=msedge node scripts/qa-cs-label-edge-wrap.js
 */
require('./_playwright-browsers-path');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PORT = process.env.PORT || '18080';
const BASE = process.env.BASE_URL || `http://127.0.0.1:${PORT}`;
const outDir = path.join(__dirname, '..', 'runs', 'qa-cs-label-edge');

async function waitList(page) {
  await page.waitForFunction(() => {
    const loader = document.getElementById('scene-loader');
    const modal = document.getElementById('scene-grid-modal');
    const loaderGone = !loader || loader.style.display === 'none' || getComputedStyle(loader).display === 'none';
    const modalOn = modal && (modal.style.display === 'flex' || getComputedStyle(modal).display === 'flex');
    return loaderGone && modalOn && document.querySelectorAll('#scene-grid-container .scene-item').length > 0;
  }, null, { timeout: 120000 });
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true
  });
  const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
  page.setDefaultTimeout(120000);

  await page.goto(`${BASE}/Solid?sandbox=geometry`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await waitList(page);
  const idx = await page.evaluate(() =>
    (window.customScenes || []).findIndex((s) => /六区色律/.test(String(s.name || '')))
  );
  if (idx < 0) throw new Error('六区色律 not found');
  await page.evaluate(async (i) => {
    const r = window.switchScene(i);
    if (r && typeof r.then === 'function') await r;
  }, idx);
  await page.waitForFunction(
    () => !window.isLoadingScene && Number(window.currentSceneIndex) >= 0
      && (window.colorSampleAnnoList || []).length > 0
      && !!(window.ColorSampleAnnotationManager && window.ColorSampleAnnotationManager._cachedCamera),
    null,
    { timeout: 240000 }
  );
  await page.waitForTimeout(1500);

  const natural = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.anno-cs-label')).map((el) => {
      const r = el.getBoundingClientRect();
      return {
        t: (el.innerText || '').slice(0, 24).replace(/\n/g, '|'),
        w: Math.round(r.width),
        h: Math.round(r.height),
        right: Math.round(r.right)
      };
    })
  );
  const naturalShot = path.join(outDir, '01-natural.png');
  await page.screenshot({ path: naturalShot, fullPage: false });

  const forced = await page.evaluate(() => {
    const mgr = window.ColorSampleAnnotationManager;
    const cam = mgr && mgr._cachedCamera;
    const list = window.colorSampleAnnoList || [];
    const data = list.find((a) => a && a.domLabel && /反光/.test(a.domLabel.innerText || ''))
      || list.find((a) => a && a.domLabel);
    if (!data || !cam) return { ok: false, reason: !data ? 'nodata' : 'nocam', n: list.length };
    data.dx = 180;
    data.dy = 20;
    delete data.dxW;
    delete data.dyW;
    delete data._csLabelAnchorRight;
    mgr.updateScreenPositions(cam);
    const el = data.domLabel;
    const r = el.getBoundingClientRect();
    return {
      ok: true,
      w: r.width,
      h: r.height,
      left: r.left,
      right: r.right,
      maxW: el.style.maxWidth,
      ar: data._csLabelAnchorRight,
      t: (el.innerText || '').slice(0, 40)
    };
  });
  const forcedShot = path.join(outDir, '02-forced-right.png');
  await page.screenshot({ path: forcedShot, fullPage: false });

  const naturalOk = natural.length > 0 && natural.every((L) => L.w >= 40 && L.h < L.w * 8);
  const forcedOk = !!(forced.ok && forced.w >= 72 && forced.h < forced.w * 5);
  const out = {
    natural,
    naturalShot,
    forced,
    forcedShot,
    naturalOk,
    forcedOk,
    ok: naturalOk && forcedOk
  };
  await browser.close();
  console.log(JSON.stringify(out, null, 2));
  if (!out.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
