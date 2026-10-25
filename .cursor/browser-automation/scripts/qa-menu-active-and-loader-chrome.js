/**
 * 1) 列表页开菜单：对应项应有 active 下划线
 * 2) Solid 加载遮罩期间：顶栏场景/汉堡不得露在进度条之上
 * PORT=18080 node scripts/qa-menu-active-and-loader-chrome.js
 */
require('./_playwright-browsers-path');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PORT = process.env.PORT || '18080';
const BASE = process.env.BASE_URL || `http://127.0.0.1:${PORT}`;
const outDir = path.join(__dirname, '..', 'runs');

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const result = { ok: true, parts: [] };

  // --- Solid loader chrome ---
  await page.goto(`${BASE}/Solid?sandbox=geometry&skipPerf=1`, {
    waitUntil: 'domcontentloaded',
    timeout: 90000
  });
  // 尽量在 loader 仍显示时取样（短等）
  await page.waitForSelector('#scene-loader', { timeout: 15000 });
  const loaderShot = path.join(outDir, `solid-loader-chrome-${Date.now()}.png`);
  const loaderInfo = await page.evaluate(() => {
    const ld = document.getElementById('scene-loader');
    const scene = document.getElementById('top-left-scene-btn');
    const menu = document.getElementById('menu-trigger-overlay');
    const cs = (el) => (el ? getComputedStyle(el) : null);
    const l = cs(ld);
    const s = cs(scene);
    const m = cs(menu);
    const lz = l ? parseFloat(l.zIndex) || 0 : 0;
    const sz = s ? parseFloat(s.zIndex) || 0 : 0;
    const mz = m ? parseFloat(m.zIndex) || 0 : 0;
    const loaderUp =
      ld &&
      l.display !== 'none' &&
      parseFloat(l.opacity || '1') > 0.2;
    return {
      loaderUp,
      lz,
      sz,
      mz,
      loaderCoversChrome: lz > sz && lz > mz,
      scenePe: s ? s.pointerEvents : null,
      menuPe: m ? m.pointerEvents : null
    };
  });
  await page.screenshot({ path: loaderShot, fullPage: false });
  const loaderOk = loaderInfo.loaderUp && loaderInfo.loaderCoversChrome;
  result.parts.push({ name: 'loader', ok: loaderOk, loaderInfo, loaderShot });
  if (!loaderOk) result.ok = false;

  // 等列表出来
  await page.waitForFunction(() => {
    const m = document.getElementById('scene-grid-modal');
    const ld = document.getElementById('scene-loader');
    const listOn = m && (m.style.display === 'flex' || getComputedStyle(m).display === 'flex');
    const ldOff = !ld || ld.style.display === 'none' || parseFloat(getComputedStyle(ld).opacity || '1') < 0.05;
    return listOn || ldOff;
  }, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(800);

  // 关列表 → 应开菜单且高亮几何体
  await page.evaluate(() => {
    if (typeof window.closeSceneGridModal === 'function') window.closeSceneGridModal();
  });
  await page.waitForTimeout(500);
  const solidMenu = await page.evaluate(() => {
    const overlay = document.getElementById('global-menu-overlay');
    const actives = [].map.call(document.querySelectorAll('.menu-item.active .txt'), (el) =>
      (el.textContent || '').trim()
    );
    return {
      menuOpen: !!(overlay && overlay.classList.contains('active')),
      actives,
      href: location.href
    };
  });
  const solidMenuShot = path.join(outDir, `solid-list-menu-active-${Date.now()}.png`);
  await page.screenshot({ path: solidMenuShot, fullPage: false });
  const solidActiveOk =
    solidMenu.menuOpen && solidMenu.actives.some((t) => /几何体/.test(t));
  result.parts.push({ name: 'solid-menu-active', ok: solidActiveOk, solidMenu, solidMenuShot });
  if (!solidActiveOk) result.ok = false;

  // Portrait anatomy：关列表 → 菜单高亮头骨
  await page.goto(`${BASE}/Portrait_c?lib=anatomy`, {
    waitUntil: 'domcontentloaded',
    timeout: 90000
  });
  await page.waitForSelector('#course-gallery-modal.show', { timeout: 30000 });
  await page.waitForTimeout(1000);
  await page.click('.gallery-close');
  await page.waitForTimeout(600);
  const portraitMenu = await page.evaluate(() => {
    const overlay = document.getElementById('global-menu-overlay');
    const actives = [].map.call(document.querySelectorAll('.menu-item.active .txt'), (el) =>
      (el.textContent || '').trim()
    );
    return {
      menuOpen: !!(overlay && overlay.classList.contains('active')),
      actives,
      href: location.href,
      leftPortrait: !/Portrait_c/i.test(location.pathname)
    };
  });
  const portraitShot = path.join(outDir, `portrait-list-menu-active-${Date.now()}.png`);
  await page.screenshot({ path: portraitShot, fullPage: false });
  const portraitOk =
    portraitMenu.menuOpen &&
    !portraitMenu.leftPortrait &&
    portraitMenu.actives.some((t) => /头骨/.test(t));
  result.parts.push({ name: 'portrait-menu-active', ok: portraitOk, portraitMenu, portraitShot });
  if (!portraitOk) result.ok = false;

  await browser.close();
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) {
    console.error('FAIL');
    process.exit(1);
  }
  console.log('PASS');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
