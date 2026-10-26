/**
 * 几何体 · 静物：左右「上一课/下一课」
 * 1) 列表态隐藏 2) 模拟进课后显隐/首尾禁用 3) 点击走 switchScene
 * 4) headform 现亦显示导航（完整三沙盒见 qa-solid-lesson-nav-three-sandboxes.js）
 * （完整 3D 进课在无头环境常因 GLB/首帧过久不稳定，故主测导航契约；可选 REAL_ENTER=1）
 * PORT=18080 PLAYWRIGHT_CHANNEL=msedge node scripts/qa-geometry-lesson-nav.js
 */
require('./_playwright-browsers-path');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PORT = process.env.PORT || '18080';
const BASE = process.env.BASE_URL || `http://127.0.0.1:${PORT}`;
const outDir = path.join(__dirname, '..', 'runs');
const REAL_ENTER = process.env.REAL_ENTER === '1';

async function waitList(page) {
  await page.waitForFunction(() => {
    const loader = document.getElementById('scene-loader');
    const modal = document.getElementById('scene-grid-modal');
    const loaderGone = !loader || loader.style.display === 'none' || getComputedStyle(loader).display === 'none';
    const modalOn = modal && (modal.style.display === 'flex' || getComputedStyle(modal).display === 'flex');
    return loaderGone && modalOn && document.querySelectorAll('#scene-grid-container .scene-item').length > 1;
  }, null, { timeout: 120000 });
  await page.waitForTimeout(300);
}

function navProbe() {
  const prev = document.getElementById('solid-lesson-nav-prev');
  const next = document.getElementById('solid-lesson-nav-next');
  const vis = (el) => {
    if (!el || el.hidden) return false;
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity || '1') > 0.05;
  };
  return {
    idx: Number(window.currentSceneIndex),
    sandbox: window.__solidSandboxKey || '',
    n: (window.customScenes || []).length,
    prevVisible: vis(prev),
    nextVisible: vis(next),
    prevDisabled: !!(prev && prev.disabled),
    nextDisabled: !!(next && next.disabled),
    prevLabel: prev ? (prev.getAttribute('aria-label') || '') : '',
    nextLabel: next ? (next.getAttribute('aria-label') || '') : '',
    hasFn: typeof window.solidUpdateLessonNav === 'function',
    hasGo: typeof window.solidGotoAdjacentLesson === 'function'
  };
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(120000);
  const results = {};

  await page.goto(`${BASE}/Solid?sandbox=geometry`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await waitList(page);

  results.listHidden = await page.evaluate(() => {
    const prev = document.getElementById('solid-lesson-nav-prev');
    const next = document.getElementById('solid-lesson-nav-next');
    return !!(prev && next && prev.hidden && next.hidden);
  });

  // 模拟已进第一课（不拉 GLB）：关列表、置 index、刷新导航
  // switchScene 只记调用，不进真实加载（避免污染后续断言）
  results.simFirst = await page.evaluate(() => {
    window.__qaSwitchCalls = [];
    window.__qaOrigSwitchScene = window.switchScene;
    window.switchScene = function (i) {
      window.__qaSwitchCalls.push(i);
    };
    window.currentSceneIndex = 0;
    window.currentSceneData = window.customScenes[0];
    window.isLoadingScene = false;
    window.__solidFetchingSceneDetail = false;
    window.__solidPendingSwitchSceneIndex = null;
    try { document.body.classList.remove('immersive-mode'); } catch (_eIm) {}
    try {
      window.__solidImmersiveLastInputAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      window._solidLastInteractAt = window.__solidImmersiveLastInputAt;
    } catch (_eAt) {}
    const modal = document.getElementById('scene-grid-modal');
    if (modal) modal.style.display = 'none';
    const ld = document.getElementById('scene-loader');
    if (ld) { ld.style.display = 'none'; ld.style.opacity = '0'; }
    if (typeof window.solidUpdateLessonNav === 'function') window.solidUpdateLessonNav();
    return (function () {
      const prev = document.getElementById('solid-lesson-nav-prev');
      const next = document.getElementById('solid-lesson-nav-next');
      const vis = (el) => {
        if (!el || el.hidden) return false;
        if (!el.classList.contains('is-visible')) return false;
        const s = getComputedStyle(el);
        // 沉浸态会把 opacity 置 0；契约测以 is-visible + 非 hidden 为准，避免误判
        return s.display !== 'none';
      };
      return {
        idx: Number(window.currentSceneIndex),
        sandbox: window.__solidSandboxKey || '',
        n: (window.customScenes || []).length,
        prevVisible: vis(prev),
        nextVisible: vis(next),
        prevDisabled: !!(prev && prev.disabled),
        nextDisabled: !!(next && next.disabled),
        prevLabel: prev ? (prev.getAttribute('aria-label') || '') : '',
        nextLabel: next ? (next.getAttribute('aria-label') || '') : '',
        hasFn: typeof window.solidUpdateLessonNav === 'function',
        hasGo: typeof window.solidGotoAdjacentLesson === 'function'
      };
    })();
  });

  const shot1 = path.join(outDir, `qa-lesson-nav-sim-${Date.now()}.png`);
  await page.screenshot({ path: shot1, fullPage: false });
  results.shotSim = shot1;

  // 点下一课应调用 switchScene(下一索引)
  results.clickNext = await page.evaluate(() => {
    window.__qaSwitchCalls = [];
    const next = document.getElementById('solid-lesson-nav-next');
    if (next) next.click();
    return { calls: window.__qaSwitchCalls.slice() };
  });

  // 模拟最后一课：下一课禁用
  results.simLast = await page.evaluate(() => {
    const last = (window.customScenes || []).length - 1;
    window.isLoadingScene = false;
    window.__solidFetchingSceneDetail = false;
    window.__solidPendingSwitchSceneIndex = null;
    try { document.body.classList.remove('immersive-mode'); } catch (_eIm2) {}
    try {
      window.__solidImmersiveLastInputAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      window._solidLastInteractAt = window.__solidImmersiveLastInputAt;
    } catch (_eAt2) {}
    const modal = document.getElementById('scene-grid-modal');
    if (modal) modal.style.display = 'none';
    window.currentSceneIndex = last;
    window.currentSceneData = window.customScenes[last];
    if (typeof window.solidUpdateLessonNav === 'function') window.solidUpdateLessonNav();
    const prev = document.getElementById('solid-lesson-nav-prev');
    const next = document.getElementById('solid-lesson-nav-next');
    return {
      idx: last,
      prevDisabled: !!(prev && prev.disabled),
      nextDisabled: !!(next && next.disabled),
      prevVisible: !!(prev && !prev.hidden && prev.classList.contains('is-visible')),
      nextVisible: !!(next && !next.hidden && next.classList.contains('is-visible'))
    };
  });

  // 点上一课
  results.clickPrev = await page.evaluate(() => {
    window.__qaSwitchCalls = [];
    const prev = document.getElementById('solid-lesson-nav-prev');
    if (prev) prev.click();
    return { calls: window.__qaSwitchCalls.slice() };
  });

  // headform 亦应显示（三沙盒共用）；完整契约见 qa-solid-lesson-nav-three-sandboxes.js
  await page.goto(`${BASE}/Solid?sandbox=headform`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await waitList(page);
  results.headform = await page.evaluate(() => {
    window.currentSceneIndex = 0;
    window.currentSceneData = window.customScenes[0];
    window.isLoadingScene = false;
    const modal = document.getElementById('scene-grid-modal');
    if (modal) modal.style.display = 'none';
    const ld = document.getElementById('scene-loader');
    if (ld) { ld.style.display = 'none'; ld.style.opacity = '0'; }
    if (typeof window.solidUpdateLessonNav === 'function') window.solidUpdateLessonNav();
    const prev = document.getElementById('solid-lesson-nav-prev');
    const next = document.getElementById('solid-lesson-nav-next');
    return {
      sandbox: window.__solidSandboxKey || '',
      prevHidden: !!(prev && prev.hidden),
      nextHidden: !!(next && next.hidden),
      prevVisible: !!(prev && !prev.hidden && prev.classList.contains('is-visible')),
      nextVisible: !!(next && !next.hidden && next.classList.contains('is-visible'))
    };
  });

  if (REAL_ENTER) {
    await page.goto(`${BASE}/Solid?sandbox=geometry`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await waitList(page);
    await page.evaluate(() => {
      const el = document.querySelector('#scene-grid-container .scene-item[data-scene-index="0"]');
      if (el) el.click();
    });
    const deadline = Date.now() + 180000;
    let real = null;
    while (Date.now() < deadline) {
      await page.waitForTimeout(2000);
      real = await page.evaluate(navProbe);
      const done = await page.evaluate(() => {
        const ld = document.getElementById('scene-loader');
        const modal = document.getElementById('scene-grid-modal');
        const loaderGone = !ld || ld.style.display === 'none' || Number(ld.style.opacity || '1') < 0.08;
        const modalOff = !modal || modal.style.display === 'none';
        return modalOff && !window.isLoadingScene && Number(window.currentSceneIndex) >= 0 && loaderGone;
      });
      if (done) break;
    }
    results.realEnter = real;
    const shotR = path.join(outDir, `qa-lesson-nav-real-${Date.now()}.png`);
    await page.screenshot({ path: shotR, fullPage: false });
    results.shotReal = shotR;
  }

  await browser.close();

  const s = results.simFirst || {};
  const last = results.simLast || {};
  const nextCall = (results.clickNext && results.clickNext.calls && results.clickNext.calls[0]);
  const prevCall = (results.clickPrev && results.clickPrev.calls && results.clickPrev.calls[0]);
  results.ok = !!(
    results.listHidden
    && s.hasFn && s.hasGo
    && s.sandbox === 'geometry'
    && s.n > 1
    && s.prevVisible && s.nextVisible
    && s.prevDisabled === true
    && s.nextDisabled === false
    && s.prevLabel === '上一课' && s.nextLabel === '下一课'
    && nextCall === 1
    && last.prevDisabled === false && last.nextDisabled === true
    && prevCall === (last.idx - 1)
    && results.headform && results.headform.sandbox === 'headform'
    && results.headform.prevVisible && results.headform.nextVisible
  );

  console.log(JSON.stringify(results, null, 2));
  if (!results.ok) {
    console.error('FAIL');
    process.exit(1);
  }
  console.log('PASS');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
