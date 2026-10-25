/**
 * 验收：菜单→A→再开菜单→B→back 应落到 A#menu 且菜单已开。
 * 并截图供 AI 视觉（返回后应直接见菜单，非裸首页）。
 * PORT=18080 node scripts/qa-menu-back-to-menu.js
 */
require('./_playwright-browsers-path');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PORT = process.env.PORT || '18080';
const BASE = process.env.BASE_URL || `http://127.0.0.1:${PORT}`;
const outDir = path.join(__dirname, '..', 'runs');

async function openMenu(page) {
  await page.evaluate(() => {
    if (location.hash !== '#menu' && typeof window.toggleMenu === 'function') window.toggleMenu();
  });
  await page.waitForFunction(() => location.hash === '#menu', { timeout: 8000 });
  await page.waitForTimeout(200);
}

async function navFromMenu(page, targetPath) {
  const before = await page.evaluate(() => location.pathname);
  await page.evaluate((tp) => {
    if (typeof window.zoomAndNavigate === 'function') window.zoomAndNavigate(tp);
    else window.location.href = tp;
  }, targetPath);
  await page.waitForFunction(
    (prev) => location.pathname.replace(/\.html$/i, '') !== prev.replace(/\.html$/i, '') && location.hash !== '#menu',
    before,
    { timeout: 30000 }
  );
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(600);
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const steps = [];

  await page.goto(`${BASE}/index`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1500);
  steps.push({ step: 'start', url: page.url() });

  await openMenu(page);
  await navFromMenu(page, '/Solid');
  steps.push({ step: 'A', url: page.url() });

  await page.waitForTimeout(1500);
  await openMenu(page);
  steps.push({ step: 'menu_on_A', url: page.url() });

  await navFromMenu(page, '/Gallery');
  steps.push({ step: 'B', url: page.url() });

  // 返回：应进 Solid#menu，菜单秒开
  await page.goBack({ waitUntil: 'domcontentloaded', timeout: 30000 });
  // 尽量短延迟后立刻取样（测「不闪」：菜单应已 active）
  await page.waitForTimeout(80);
  const early = await page.evaluate(() => {
    const o = document.getElementById('global-menu-overlay');
    const cover = document.getElementById('global-menu-boot-cover');
    const cs = o ? getComputedStyle(o) : null;
    return {
      url: location.href,
      hash: location.hash,
      hasActive: !!(o && o.classList.contains('active')),
      opacity: cs ? cs.opacity : null,
      visibility: cs ? cs.visibility : null,
      hasCover: !!cover
    };
  });
  const shotEarly = path.join(outDir, `menu-back-early-${Date.now()}.png`);
  await page.screenshot({ path: shotEarly, fullPage: false });

  await page.waitForTimeout(500);
  const late = await page.evaluate(() => {
    const o = document.getElementById('global-menu-overlay');
    return {
      url: location.href,
      hash: location.hash,
      hasActive: !!(o && o.classList.contains('active')),
      menuTextSample: (o && o.innerText || '').slice(0, 80)
    };
  });
  const shotLate = path.join(outDir, `menu-back-late-${Date.now()}.png`);
  await page.screenshot({ path: shotLate, fullPage: false });

  await browser.close();

  const ok =
    /\/solid/i.test(early.url) &&
    early.hash === '#menu' &&
    early.hasActive &&
    late.hasActive;

  const result = { ok, early, late, shotEarly, shotLate, steps };
  console.log(JSON.stringify(result, null, 2));
  if (!ok) {
    console.error('FAIL: back did not land on A#menu with menu open');
    process.exit(1);
  }
  console.log('PASS: back → A#menu with menu active');
  console.log('SHOT_EARLY=' + shotEarly);
  console.log('SHOT_LATE=' + shotLate);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
