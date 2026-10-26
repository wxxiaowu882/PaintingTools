/**
 * 1) 本地课表缩略图应能渐进刷出（氛围等 Tab 切过去也有图）
 * 2) 几何体课切换箭头默认透明度约 50%
 * PORT=18080 PLAYWRIGHT_CHANNEL=msedge node scripts/qa-thumb-hydrate-and-nav-opacity.js
 */
require('./_playwright-browsers-path');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PORT = process.env.PORT || '18080';
const BASE = process.env.BASE_URL || `http://127.0.0.1:${PORT}`;
const outDir = path.join(__dirname, '..', 'runs');

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
  const results = {};

  await page.goto(`${BASE}/Solid?sandbox=geometry`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await waitList(page);

  // 等缩略图补全一段时间（本地从静态 JSON 批切）
  const deadline = Date.now() + 90000;
  let thumbStat = null;
  while (Date.now() < deadline) {
    thumbStat = await page.evaluate(() => {
      const scenes = window.customScenes || [];
      const withT = scenes.filter((s) => s && s.thumbnail).length;
      const ready = document.querySelectorAll('#scene-grid-container img.scene-thumb.solid-thumb-ready').length;
      const pending = document.querySelectorAll('#scene-grid-container img.scene-thumb.solid-thumb-pending').length;
      const items = document.querySelectorAll('#scene-grid-container .scene-item').length;
      return { n: scenes.length, withT, ready, pending, items };
    });
    if (thumbStat.withT >= Math.min(12, thumbStat.n) && thumbStat.ready >= Math.min(6, thumbStat.items)) break;
    await page.waitForTimeout(800);
  }
  results.thumbAllTab = thumbStat;

  // 切到「氛围」Tab，确认也能上屏
  await page.evaluate(() => {
    const btn = [].find.call(document.querySelectorAll('#scene-tabbar .scene-tab'), (el) => /氛围/.test(el.textContent || ''));
    if (btn) btn.click();
  });
  await page.waitForTimeout(600);
  const atmosDeadline = Date.now() + 45000;
  let atmos = null;
  while (Date.now() < atmosDeadline) {
    atmos = await page.evaluate(() => {
      const items = document.querySelectorAll('#scene-grid-container .scene-item');
      let ready = 0;
      let pending = 0;
      items.forEach((el) => {
        const img = el.querySelector('img.scene-thumb');
        if (!img) return;
        if (img.classList.contains('solid-thumb-ready')) ready++;
        if (img.classList.contains('solid-thumb-pending')) pending++;
      });
      return { items: items.length, ready, pending };
    });
    if (atmos.items > 0 && atmos.ready >= Math.min(2, atmos.items)) break;
    await page.waitForTimeout(600);
  }
  results.thumbAtmos = atmos;
  const shot = path.join(outDir, `qa-thumb-atmos-${Date.now()}.png`);
  await page.screenshot({ path: shot, fullPage: false });
  results.shotAtmos = shot;

  // 箭头透明度：模拟进课
  results.navOpacity = await page.evaluate(() => {
    try { document.body.classList.remove('immersive-mode'); } catch (_e) {}
    window.currentSceneIndex = 0;
    window.currentSceneData = window.customScenes[0];
    window.isLoadingScene = false;
    const modal = document.getElementById('scene-grid-modal');
    if (modal) modal.style.display = 'none';
    if (typeof window.solidUpdateLessonNav === 'function') window.solidUpdateLessonNav();
    const next = document.getElementById('solid-lesson-nav-next');
    const op = next ? Number(getComputedStyle(next).opacity) : -1;
    return {
      visible: !!(next && !next.hidden && next.classList.contains('is-visible')),
      opacity: op,
      near50: op > 0.42 && op < 0.58
    };
  });

  await browser.close();

  results.ok = !!(
    results.thumbAllTab
    && results.thumbAllTab.withT >= 12
    && results.thumbAllTab.ready >= 6
    && results.thumbAtmos
    && results.thumbAtmos.items > 0
    && results.thumbAtmos.ready >= Math.min(2, results.thumbAtmos.items)
    && results.navOpacity
    && results.navOpacity.visible
    && results.navOpacity.near50
  );

  console.log(JSON.stringify(results, null, 2));
  if (!results.ok) {
    console.error('FAIL');
    process.exit(1);
  }
  console.log('PASS');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
