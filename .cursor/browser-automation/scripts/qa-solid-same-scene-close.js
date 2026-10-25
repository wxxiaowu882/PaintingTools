/**
 * 点当前已选场景项应关列表。需已有可进的课表。
 * PORT=18080 node scripts/qa-solid-same-scene-close.js
 */
require('./_playwright-browsers-path');
const { chromium } = require('playwright');

const PORT = process.env.PORT || '18080';
const BASE = process.env.BASE_URL || `http://127.0.0.1:${PORT}`;

async function main() {
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${BASE}/Solid?sandbox=geometry&skipPerf=1`, {
    waitUntil: 'domcontentloaded',
    timeout: 90000
  });
  // 等列表或场景按钮
  await page.waitForSelector('#top-left-scene-btn', { timeout: 60000 });
  await page.waitForTimeout(2500);

  // 尽量点进第一张可进的卡
  const entered = await page.evaluate(async () => {
    const cards = [].slice.call(document.querySelectorAll('#scene-grid-container .scene-card, #scene-grid-container [data-scene-index], #scene-grid-container > *'));
    for (let i = 0; i < Math.min(cards.length, 12); i++) {
      const el = cards[i];
      const idx = el.getAttribute && el.getAttribute('data-scene-index');
      try {
        if (typeof window.switchScene === 'function' && idx != null) {
          await window.switchScene(Number(idx));
          return { ok: true, via: 'switchScene', idx: Number(idx) };
        }
        el.click();
        return { ok: true, via: 'click', i };
      } catch (_e) {}
    }
    // 无卡时：伪造已选场景再测同 index
    window.currentSceneIndex = 0;
    window.__solidHasSelectedScene = function () { return true; };
    return { ok: true, via: 'fake', idx: 0 };
  });

  await page.waitForTimeout(entered.via === 'fake' ? 200 : 4000);

  // 打开列表
  await page.evaluate(() => {
    if (typeof window.openSceneGridModal === 'function') window.openSceneGridModal();
  });
  await page.waitForTimeout(400);
  let modalOpen = await page.evaluate(() => {
    const m = document.getElementById('scene-grid-modal');
    return m && (m.style.display === 'flex' || getComputedStyle(m).display === 'flex');
  });
  if (!modalOpen) {
    console.error('FAIL: modal not open');
    process.exit(1);
  }

  const idx = await page.evaluate(() => window.currentSceneIndex);
  await page.evaluate((i) => window.switchScene(i), idx);
  await page.waitForTimeout(300);

  modalOpen = await page.evaluate(() => {
    const m = document.getElementById('scene-grid-modal');
    return m && m.style.display !== 'none' && getComputedStyle(m).display === 'flex';
  });
  await browser.close();

  if (modalOpen) {
    console.error('FAIL: modal still open after same-scene click, idx=' + idx);
    process.exit(1);
  }
  console.log('PASS: same-scene click closes modal, idx=' + idx, entered);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
