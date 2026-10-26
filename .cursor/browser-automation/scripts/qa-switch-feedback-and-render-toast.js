/**
 * 1) 场景→列表→点其它课：切换瞬间 loader 已可见（不等清场后才出）
 * 2) 「开始渲染」：toast 与按钮亮态在 defer core 之前已出现
 * PORT=18080 PLAYWRIGHT_CHANNEL=msedge node scripts/qa-switch-feedback-and-render-toast.js
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
  await page.waitForTimeout(400);
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

  // 回列表再点第 2 课：switchScene 同步段须已关列表并显示 loader（在双 rAF / 清场之前）
  const switchFb = await page.evaluate(async () => {
    if (typeof window.openSceneGridModal === 'function') window.openSceneGridModal();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    function snap(tag) {
      const ld = document.getElementById('scene-loader');
      const modal = document.getElementById('scene-grid-modal');
      return {
        tag,
        loaderDisp: ld ? ld.style.display : null,
        loaderOp: ld ? ld.style.opacity : null,
        modalDisp: modal ? modal.style.display : null,
        loaderText: ((document.getElementById('loader-text') || {}).textContent || '').trim()
      };
    }

    const before = snap('before');
    const nextIdx = 1;
    // 调用后立刻采样：async 函数跑到第一个 await 前的同步段应已出遮罩
    const p = window.switchScene(nextIdx);
    const afterSync = snap('after_sync');

    const modalHiddenEarly = afterSync.modalDisp === 'none';
    const loaderVisibleEarly = afterSync.loaderDisp === 'flex' && Number(afterSync.loaderOp || 0) > 0.5;

    try { await p; } catch (_e) {}
    const t0 = Date.now();
    while (Date.now() - t0 < 180000) {
      if (!window.isLoadingScene && Number(window.currentSceneIndex) === nextIdx) break;
      await new Promise((r) => setTimeout(r, 200));
    }

    return {
      before,
      afterSync,
      modalHiddenEarly,
      loaderVisibleEarly,
      idx: Number(window.currentSceneIndex),
      ok: modalHiddenEarly && loaderVisibleEarly
    };
  });

  // 「开始渲染」：拦截 core，确认 toast/按钮先于 core
  const renderFb = await page.evaluate(async () => {
    window._solidHardwareUnsupported = false;
    const order = [];
    const origCore = window._solidDoForceReRenderCore;
    window._solidDoForceReRenderCore = function () {
      order.push('core');
      const t = document.getElementById('render-toast');
      const br = document.getElementById('btn-rerender');
      order.push({
        toastOp: t ? t.style.opacity : null,
        toastText: t ? t.textContent : null,
        btnBg: br ? br.style.background : null
      });
      // 不跑真 core，避免拖垮 QA
    };

    // 同步观察：forceReRender 返回前 toast 是否已亮
    order.push('before_call');
    window.forceReRender();
    const t = document.getElementById('render-toast');
    const br = document.getElementById('btn-rerender');
    order.push({
      phase: 'sync_after_call',
      toastOp: t ? t.style.opacity : null,
      toastText: t ? String(t.textContent || '') : null,
      btnBg: br ? br.style.background : null
    });

    await new Promise((r) => setTimeout(r, 30));

    window._solidDoForceReRenderCore = origCore;

    const sync = order.find((x) => x && x.phase === 'sync_after_call');
    const toastFirst = !!(sync && Number(sync.toastOp) >= 1 && /正在开始渲染/.test(sync.toastText || ''));
    const btnBright = !!(sync && sync.btnBg && /0\.28|255,\s*255,\s*255/.test(String(sync.btnBg)));
    const coreAfter = order.indexOf('core') > order.findIndex((x) => x && x.phase === 'sync_after_call');

    return {
      order,
      toastFirst,
      btnBright,
      coreAfter,
      ok: toastFirst && btnBright && coreAfter
    };
  });

  await browser.close();
  const ok = !!(switchFb && switchFb.ok && renderFb && renderFb.ok);
  console.log(JSON.stringify({ ok, switchFb, renderFb }, null, 2));
  if (!ok) process.exit(1);
  console.log('PASS');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
