/**
 * 验收：菜单「安卓 App 下载」必须跳到 /docs/app/（首页 + Solid）。
 *   PORT=18080 node scripts/qa-android-app-menu-nav.js
 */
require('./_playwright-browsers-path');
const { chromium } = require('playwright');

const PORT = process.env.PORT || '18080';
const BASE = process.env.BASE_URL || `http://127.0.0.1:${PORT}`;

function menuPathKey(p) {
  let s = String(p || '').split('?')[0];
  s = s.replace(/\/+$/, '') || '/';
  const parts = s.split('/').filter(Boolean).map(function (seg) {
    let x = seg.toLowerCase();
    if (x.endsWith('.html')) x = x.slice(0, -5);
    return x;
  });
  if (!parts.length) return 'index';
  if (parts.length === 1) return parts[0] || 'index';
  return parts.join('/');
}

async function openMenuGoDownload(page, fromLabel, errors) {
  await page.evaluate(() => {
    if (typeof window.toggleMenu === 'function') window.toggleMenu();
  });
  await page.waitForTimeout(700);
  const item = page.locator('.menu-item', { hasText: '安卓 App 下载' });
  if ((await item.count()) < 1) {
    errors.push(fromLabel + ': 安卓 App 下载 not found');
    return;
  }
  const cls = await item.first().getAttribute('class');
  if (fromLabel === 'home' && cls && /\bactive\b/.test(cls)) {
    errors.push('home: 安卓 App 下载 incorrectly active (' + cls + ')');
  }
  await Promise.all([
    page.waitForURL(/\/docs\/app\/?/, { timeout: 10000 }),
    item.first().click()
  ]).catch((e) => {
    errors.push(fromLabel + '→download failed: ' + e.message + ' url=' + page.url());
  });
  await page.waitForTimeout(300);
  if (!/\/docs\/app\/?/.test(page.url())) {
    errors.push(fromLabel + ': expected /docs/app/, got ' + page.url());
  }
  const title = await page.title();
  if (!/安卓 App 下载/.test(title)) {
    errors.push(fromLabel + ': title mismatch: ' + title);
  }
  if ((await page.locator('#btnDownload').count()) < 1) {
    errors.push(fromLabel + ': #btnDownload missing');
  }
}

async function main() {
  if (menuPathKey('/docs/app/') === menuPathKey('/index')) {
    throw new Error('unit: docs/app still collides with index');
  }

  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];

  await page.goto(`${BASE}/index`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => typeof window.toggleMenu === 'function', null, { timeout: 15000 });
  await page.waitForTimeout(400);
  await openMenuGoDownload(page, 'home', errors);

  await page.goto(`${BASE}/Solid?sandbox=geometry`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => typeof window.toggleMenu === 'function', null, { timeout: 20000 });
  await page.waitForTimeout(800);
  await openMenuGoDownload(page, 'Solid', errors);

  // 下载页接口：本地静态没有 Worker，/api/android-apk 可能 404；直链 apk 若存在应 200
  const apkDirect = await page.request.head(`${BASE}/docs/app/wuxiao-workshop.apk`);
  console.log('local apk direct status', apkDirect.status());

  await browser.close();

  if (errors.length) {
    console.error('FAIL');
    errors.forEach((e) => console.error(' -', e));
    process.exit(1);
  }
  console.log('PASS: homepage + Solid menu → /docs/app/');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
