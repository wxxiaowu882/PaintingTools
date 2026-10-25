/**
 * 手势/浏览器回退落到上一页 #menu 时，下划线应落在「刚从菜单进入的栏目」，而非首页。
 * PORT=18080 node scripts/qa-menu-back-underline.js
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

  await page.goto(`${BASE}/index`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    if (typeof toggleMenu === 'function') toggleMenu();
  });
  await page.waitForFunction(() => location.hash === '#menu', { timeout: 8000 });
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const items = [].slice.call(document.querySelectorAll('.menu-item'));
    const g = items.find((el) => /几何体/.test(el.textContent || ''));
    if (!g) throw new Error('geometry item missing');
    g.click();
  });
  await page.waitForURL((u) => /\/Solid/i.test(u.pathname), { timeout: 30000 });
  // 等列表出来，避免 Solid 启动期额外历史干扰回退
  await page.waitForFunction(() => {
    const m = document.getElementById('scene-grid-modal');
    return m && (m.style.display === 'flex' || getComputedStyle(m).display === 'flex');
  }, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(800);

  // 一回退：Solid → 历史中的 index#menu（菜单应开，高亮几何体而非首页）
  await page.goBack({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => location.hash === '#menu', { timeout: 10000 });
  await page.waitForTimeout(400);

  const info = await page.evaluate(() => {
    const actives = [].map.call(document.querySelectorAll('.menu-item.active .txt'), (el) =>
      (el.textContent || '').trim()
    );
    return {
      href: location.href,
      hash: location.hash,
      menu: !!(document.getElementById('global-menu-overlay') || {}).classList?.contains('active'),
      last: sessionStorage.getItem('pt_last_menu_nav'),
      actives
    };
  });
  const shot = path.join(outDir, `menu-back-underline-${Date.now()}.png`);
  await page.screenshot({ path: shot, fullPage: false });
  await browser.close();

  const ok =
    info.hash === '#menu' &&
    info.menu &&
    info.actives.some((t) => /几何体/.test(t)) &&
    !info.actives.some((t) => /首页/.test(t));

  console.log(JSON.stringify({ ok, info, shot }, null, 2));
  if (!ok) {
    console.error('FAIL');
    process.exit(1);
  }
  console.log('PASS');
  console.log('SHOT=' + shot);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
