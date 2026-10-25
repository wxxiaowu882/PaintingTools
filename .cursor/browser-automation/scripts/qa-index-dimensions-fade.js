/**
 * 首页 DIMENSIONS 变淡视觉截图。
 * PORT=18080 node scripts/qa-index-dimensions-fade.js
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
  const shot = path.join(outDir, `index-dimensions-${Date.now()}.png`);
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${BASE}/index`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('.title-dim, .title-zh, .site-title', { timeout: 20000 });
  await page.waitForTimeout(2500);
  // 关可能挡住的菜单
  await page.evaluate(() => {
    const m = document.getElementById('global-menu-overlay');
    if (m) m.classList.remove('active');
    if (location.hash === '#menu') history.replaceState(null, '', location.pathname);
  });
  const metrics = await page.evaluate(() => {
    const dim = document.querySelector('.title-dim');
    const zh = document.querySelector('.title-zh');
    const cs = (el) => (el ? getComputedStyle(el) : null);
    const d = cs(dim);
    const z = cs(zh);
    return {
      dimText: dim ? dim.textContent.trim() : null,
      zhText: zh ? zh.textContent.trim() : null,
      dimFontPx: d ? parseFloat(d.fontSize) : null,
      zhFontPx: z ? parseFloat(z.fontSize) : null,
      dimFill: d ? d.webkitTextFillColor || d.color : null,
      zhFill: z ? z.webkitTextFillColor || z.color : null
    };
  });
  await page.screenshot({ path: shot, fullPage: false });
  await browser.close();
  console.log(JSON.stringify({ metrics, shot }, null, 2));
  if (!metrics.dimText || !/DIMENSIONS/i.test(metrics.dimText)) {
    console.error('FAIL: title-dim missing');
    process.exit(1);
  }
  if (!metrics.zhText || !/手绘工坊/.test(metrics.zhText)) {
    console.error('FAIL: title-zh missing');
    process.exit(1);
  }
  if (!(metrics.dimFontPx < metrics.zhFontPx)) {
    console.error('FAIL: DIMENSIONS should be smaller than 手绘工坊');
    process.exit(1);
  }
  console.log('PASS: DIMENSIONS smaller than 手绘工坊');
  console.log('SHOT=' + shot);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
