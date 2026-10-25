/**
 * 强制显示 Solid 加载遮罩，确认顶栏被盖住（z-index + 截图）。
 * PORT=18080 node scripts/qa-solid-loader-cover.js
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
  const shot = path.join(outDir, `solid-loader-cover-${Date.now()}.png`);
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${BASE}/Solid?sandbox=geometry&skipPerf=1`, {
    waitUntil: 'domcontentloaded',
    timeout: 90000
  });
  await page.waitForSelector('#scene-loader', { timeout: 20000 });
  await page.evaluate(() => {
    const grid = document.getElementById('scene-grid-modal');
    if (grid) grid.style.display = 'none';
    const ld = document.getElementById('scene-loader');
    if (ld) {
      ld.style.display = 'flex';
      ld.style.opacity = '1';
      ld.classList.add('solid-boot-indeterminate');
    }
    const pct = document.getElementById('scene-load-pct');
    if (pct) pct.textContent = '42%';
    const t = document.getElementById('loader-text');
    if (t) t.textContent = '正在打开课程列表…';
  });
  await page.waitForTimeout(250);
  const info = await page.evaluate(() => {
    const lcs = getComputedStyle(document.getElementById('scene-loader'));
    const scs = getComputedStyle(document.getElementById('top-left-scene-btn'));
    const mcs = getComputedStyle(document.getElementById('menu-trigger-overlay'));
    return {
      lz: parseFloat(lcs.zIndex) || 0,
      sz: parseFloat(scs.zIndex) || 0,
      mz: parseFloat(mcs.zIndex) || 0,
      loaderText: (document.getElementById('loader-text') || {}).textContent || '',
      covers: (parseFloat(lcs.zIndex) || 0) > (parseFloat(scs.zIndex) || 0) &&
        (parseFloat(lcs.zIndex) || 0) > (parseFloat(mcs.zIndex) || 0)
    };
  });
  await page.screenshot({ path: shot, fullPage: false });
  await browser.close();
  console.log(JSON.stringify({ info, shot }, null, 2));
  if (!info.covers || info.lz < 9500) {
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
