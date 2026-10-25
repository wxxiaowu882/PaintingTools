/**
 * Solid 左上「场景」与右上问号竖直中心对齐验收 + 截图供 AI 视觉。
 * PORT=18080 node scripts/qa-solid-scene-btn-align.js
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
  const shot = path.join(outDir, `solid-topbar-align-${Date.now()}.png`);
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${BASE}/Solid?sandbox=geometry`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForSelector('#top-left-scene-btn', { timeout: 30000 });
  await page.waitForSelector('#solid-global-help-btn', { timeout: 30000 });
  // 课表模态盖住顶栏时先关掉，再量对齐并截图
  await page.evaluate(() => {
    const m = document.getElementById('scene-grid-modal');
    if (m) m.style.display = 'none';
  });
  await page.waitForTimeout(800);

  const metrics = await page.evaluate(() => {
    const a = document.getElementById('top-left-scene-btn').getBoundingClientRect();
    const b = document.getElementById('solid-global-help-btn').getBoundingClientRect();
    return {
      scene: { top: a.top, bottom: a.bottom, mid: a.top + a.height / 2, h: a.height },
      help: { top: b.top, bottom: b.bottom, mid: b.top + b.height / 2, h: b.height },
      midDelta: Math.abs((a.top + a.height / 2) - (b.top + b.height / 2)),
      topDelta: Math.abs(a.top - b.top)
    };
  });

  await page.screenshot({ path: shot, fullPage: false });
  await browser.close();

  console.log(JSON.stringify({ metrics, shot }, null, 2));
  // 允许 2px 以内误差（亚像素/字体）
  if (metrics.midDelta > 2.5) {
    console.error('FAIL: vertical mid not aligned, midDelta=' + metrics.midDelta);
    process.exit(1);
  }
  console.log('PASS: scene btn mid aligned with help (midDelta=' + metrics.midDelta + ')');
  console.log('SHOT=' + shot);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
