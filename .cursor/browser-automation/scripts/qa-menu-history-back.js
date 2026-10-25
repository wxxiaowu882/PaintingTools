/**
 * 复现菜单 history：首页开菜单→A→A上开菜单→B→back 落点。
 * PORT=18080 node scripts/qa-menu-history-back.js
 */
require('./_playwright-browsers-path');
const { chromium } = require('playwright');

const PORT = process.env.PORT || '18080';
const BASE = process.env.BASE_URL || `http://127.0.0.1:${PORT}`;

async function openMenu(page) {
  await page.evaluate(() => {
    if (location.hash !== '#menu' && typeof window.toggleMenu === 'function') {
      window.toggleMenu();
    }
  });
  await page.waitForFunction(() => location.hash === '#menu', { timeout: 8000 });
  await page.waitForTimeout(250);
}

/** 模拟菜单项导航（走页内 zoomAndNavigate / hard assign），并等到 pathname 变化 */
async function navFromMenu(page, targetPath, mode) {
  const beforePath = await page.evaluate(() => location.pathname);
  await page.evaluate(
    ({ targetPath: tp, mode: m }) => {
      if (m === 'hard') {
        window.location.assign(tp);
        return;
      }
      if (typeof window.zoomAndNavigate === 'function') {
        window.zoomAndNavigate(tp);
      } else {
        if (location.hash === '#menu') {
          history.replaceState(null, '', location.pathname + location.search);
        }
        location.href = tp;
      }
    },
    { targetPath, mode }
  );
  await page.waitForFunction(
    (prev) => {
      const p = location.pathname.replace(/\.html$/i, '');
      const t = prev.replace(/\.html$/i, '');
      return p !== t && location.hash !== '#menu';
    },
    beforePath,
    { timeout: 30000 }
  );
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(500);
}

async function runScenario(label, pageB, mode) {
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true
  });
  const page = await browser.newPage();
  const steps = [];

  await page.goto(`${BASE}/index`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1200);
  steps.push({ step: 'start', url: page.url() });

  await openMenu(page);
  steps.push({ step: 'menu_home', url: page.url() });
  await navFromMenu(page, '/Solid', 'zoom');
  steps.push({ step: 'A', url: page.url() });

  await page.waitForTimeout(1500);
  await openMenu(page);
  steps.push({ step: 'menu_on_A', url: page.url() });

  await navFromMenu(page, pageB, mode);
  const urlB = page.url();
  steps.push({ step: 'B', url: urlB });

  await page.goBack({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1000);
  const after = page.url();
  const hash = await page.evaluate(() => location.hash);
  steps.push({ step: 'after_back', url: after, hash });

  await browser.close();

  const path = new URL(after).pathname.toLowerCase().replace(/\.html$/, '');
  const landedA = path.includes('/solid');
  const landedMenu = hash === '#menu';
  const landedB = path.includes(pageB.toLowerCase().replace(/^\//, ''));
  return {
    label,
    pageB,
    mode,
    confirmed_user_report_back_to_A: landedA && !landedMenu,
    landedA,
    landedMenu,
    landedStillB: landedB,
    after,
    steps
  };
}

async function main() {
  const r1 = await runScenario('zoom→Gallery', '/Gallery', 'zoom');
  const r2 = await runScenario('hard→docs/app', '/docs/app/', 'hard');
  console.log(JSON.stringify({ r1, r2 }, null, 2));
  if (r1.confirmed_user_report_back_to_A || r2.confirmed_user_report_back_to_A) {
    console.log('CONFIRMED: at least one path backs to A (Solid).');
  } else {
    console.log('SUMMARY: see landed* flags.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
