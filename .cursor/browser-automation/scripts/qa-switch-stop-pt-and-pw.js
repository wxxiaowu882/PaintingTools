/**
 * 1) 切课停追光 2) 已选课时顶栏失败条不与「场景：」同显
 * PORT=18080 PLAYWRIGHT_CHANNEL=msedge node scripts/qa-switch-stop-pt-and-pw.js
 */
require('./_playwright-browsers-path');
const { chromium } = require('playwright');

const PORT = process.env.PORT || '18080';
const BASE = process.env.BASE_URL || `http://127.0.0.1:${PORT}`;

async function waitList(page) {
  await page.waitForFunction(() => {
    const loader = document.getElementById('scene-loader');
    const modal = document.getElementById('scene-grid-modal');
    const loaderGone = !loader || loader.style.display === 'none' || getComputedStyle(loader).display === 'none';
    const modalOn = modal && (modal.style.display === 'flex' || getComputedStyle(modal).display === 'flex');
    return loaderGone && modalOn && document.querySelectorAll('#scene-grid-container .scene-item').length > 1;
  }, null, { timeout: 120000 });
}

async function waitInScene(page) {
  await page.waitForFunction(() => {
    const loader = document.getElementById('scene-loader');
    const modal = document.getElementById('scene-grid-modal');
    const modalOff = !modal || modal.style.display === 'none';
    const loaderGone = !loader || loader.style.display === 'none' || Number(loader.style.opacity || '1') < 0.08;
    return modalOff && Number(window.currentSceneIndex) >= 0 && !window.isLoadingScene && loaderGone;
  }, null, { timeout: 240000 });
  await page.waitForTimeout(500);
}

async function main() {
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true
  });
  const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
  page.setDefaultTimeout(120000);

  await page.goto(`${BASE}/Solid?sandbox=geometry`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await waitList(page);
  await page.evaluate(() => {
    const el = document.querySelector('#scene-grid-container .scene-item[data-scene-index="0"]');
    if (el) el.click();
  });
  await waitInScene(page);

  // 模拟追光开启后切课
  const afterSwitch = await page.evaluate(async () => {
    window.useAdvancedRender = true;
    window._solidUserStoppedRender = false;
    // 假 pathTracer 标记：用一个带 dispose 的对象
    window.__qaFakePt = true;
    // 直接调内部停追光路径：通过第二次 switchScene
    const nextIdx = 1;
    await window.switchScene(nextIdx);
    // 等加载结束
    const t0 = Date.now();
    while (Date.now() - t0 < 120000) {
      if (!window.isLoadingScene && Number(window.currentSceneIndex) === nextIdx) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    return {
      idx: Number(window.currentSceneIndex),
      useAdvancedRender: !!window.useAdvancedRender,
      userStopped: !!window._solidUserStoppedRender
    };
  });

  // 顶栏冲突：已选课 + want 提示 → 顶栏条应 hidden，场景钮可见
  const chrome = await page.evaluate(() => {
    if (typeof window.solidSetPersistentWarning === 'function') {
      window.solidSetPersistentWarning('渲染失败，请点击「开始渲染」重试', true);
    }
    const pw = document.getElementById('persistent-warning');
    const top = document.getElementById('top-left-scene-btn');
    const pwDisp = pw ? pw.style.display : '';
    const topVis = top ? getComputedStyle(top).visibility : '';
    const topDisp = top ? getComputedStyle(top).display : '';
    return {
      pwDisp,
      topVis,
      topDisp,
      want: pw ? pw.getAttribute('data-solid-want') : '',
      inScene: !!(window.__solidHasSelectedScene && window.__solidHasSelectedScene()),
      ok: pwDisp === 'none' && topDisp !== 'none' && topVis !== 'hidden'
    };
  });

  await browser.close();
  const ok = !!(
    afterSwitch
    && afterSwitch.idx === 1
    && afterSwitch.useAdvancedRender === false
    && chrome
    && chrome.ok
  );
  console.log(JSON.stringify({ ok, afterSwitch, chrome }, null, 2));
  if (!ok) process.exit(1);
  console.log('PASS');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
