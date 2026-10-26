/**
 * 三沙盒课间导航：列表隐藏；模拟进课后可见；下一课走 switchScene；筛选同序（headform 二级 slot）
 * PORT=18080 PLAYWRIGHT_CHANNEL=msedge node scripts/qa-solid-lesson-nav-three-sandboxes.js
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

function simEnterFirst() {
  window.__qaSwitchCalls = [];
  window.__qaOrigSwitchScene = window.switchScene;
  window.switchScene = function (i) { window.__qaSwitchCalls.push(i); };
  window.currentSceneIndex = 0;
  window.currentSceneData = window.customScenes[0];
  window.isLoadingScene = false;
  window.__solidFetchingSceneDetail = false;
  window.__solidPendingSwitchSceneIndex = null;
  try { document.body.classList.remove('immersive-mode'); } catch (_e) {}
  try {
    window.__solidImmersiveLastInputAt = performance.now();
    window._solidLastInteractAt = window.__solidImmersiveLastInputAt;
  } catch (_e2) {}
  const modal = document.getElementById('scene-grid-modal');
  if (modal) modal.style.display = 'none';
  const ld = document.getElementById('scene-loader');
  if (ld) { ld.style.display = 'none'; ld.style.opacity = '0'; }
  if (typeof window.solidUpdateLessonNav === 'function') window.solidUpdateLessonNav();
  const prev = document.getElementById('solid-lesson-nav-prev');
  const next = document.getElementById('solid-lesson-nav-next');
  const vis = (el) => !!(el && !el.hidden && el.classList.contains('is-visible'));
  return {
    sandbox: window.__solidSandboxKey || '',
    n: (window.customScenes || []).length,
    prevVisible: vis(prev),
    nextVisible: vis(next),
    prevDisabled: !!(prev && prev.disabled),
    nextDisabled: !!(next && next.disabled),
    listLen: (typeof window.solidBuildLessonNavList === 'function')
      ? 0
      : 0
  };
}

async function probeSandbox(page, sandbox) {
  await page.goto(`${BASE}/Solid?sandbox=${sandbox}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await waitList(page);
  const listHidden = await page.evaluate(() => {
    const prev = document.getElementById('solid-lesson-nav-prev');
    const next = document.getElementById('solid-lesson-nav-next');
    return !!(prev && next && prev.hidden && next.hidden);
  });
  const sim = await page.evaluate(simEnterFirst);
  // solidBuildLessonNavList 不在 window 上；用点击下一课验证
  const clickNext = await page.evaluate(() => {
    window.__qaSwitchCalls = [];
    const next = document.getElementById('solid-lesson-nav-next');
    if (next && !next.disabled) next.click();
    return { calls: window.__qaSwitchCalls.slice(), disabled: !!(next && next.disabled) };
  });
  return { listHidden, sim, clickNext };
}

async function main() {
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(120000);

  const geometry = await probeSandbox(page, 'geometry');
  const headform = await probeSandbox(page, 'headform');
  // headform：设二级 slot 后邻课应只在同 slot（若有 ≥2）
  const headformSlot = await page.evaluate(() => {
    // 找某个 slot 下 ≥2 的课
    const all = (window.customScenes || []).map((sc, i) => ({ sc, i }));
    const bySlot = Object.create(null);
    all.forEach(({ sc, i }) => {
      const line = sc && sc.meta ? sc.meta.line : '';
      if (line !== 'view') return;
      const slot = sc.meta && sc.meta.slot != null ? String(sc.meta.slot) : '';
      if (!slot) return;
      if (!bySlot[slot]) bySlot[slot] = [];
      bySlot[slot].push(i);
    });
    let pick = null;
    Object.keys(bySlot).forEach((s) => {
      if (!pick && bySlot[s].length >= 2) pick = { slot: s, idxs: bySlot[s] };
    });
    if (!pick) return { ok: true, skipped: true };
    try {
      localStorage.setItem('SolidConsumer_FavoritesView_v1_headform', JSON.stringify('外轮廓规律'));
      localStorage.setItem('SolidConsumer_HeadformLesson_v1', JSON.stringify({ viewSlot: pick.slot, lightSlot: '' }));
    } catch (_e) {}
    window.currentSceneIndex = pick.idxs[0];
    window.currentSceneData = window.customScenes[pick.idxs[0]];
    window.isLoadingScene = false;
    const modal = document.getElementById('scene-grid-modal');
    if (modal) modal.style.display = 'none';
    if (typeof window.solidUpdateLessonNav === 'function') window.solidUpdateLessonNav();
    window.__qaSwitchCalls = [];
    window.switchScene = function (i) { window.__qaSwitchCalls.push(i); };
    const next = document.getElementById('solid-lesson-nav-next');
    if (next && !next.disabled) next.click();
    const call = window.__qaSwitchCalls[0];
    const ok = call === pick.idxs[1];
    return { skipped: false, slot: pick.slot, idxs: pick.idxs.slice(0, 3), call, ok };
  });

  const portrait = await probeSandbox(page, 'portrait');

  await browser.close();

  function sandboxOk(r) {
    return !!(
      r
      && r.listHidden
      && r.sim
      && r.sim.n > 1
      && r.sim.prevVisible
      && r.sim.nextVisible
      && r.sim.prevDisabled === true
      && r.sim.nextDisabled === false
      && r.clickNext
      && r.clickNext.calls
      && r.clickNext.calls[0] === 1
    );
  }

  const ok = !!(
    sandboxOk(geometry)
    && sandboxOk(headform)
    && sandboxOk(portrait)
    && geometry.sim.sandbox === 'geometry'
    && headform.sim.sandbox === 'headform'
    && portrait.sim.sandbox === 'portrait'
    && headformSlot
    && (headformSlot.skipped || headformSlot.ok)
  );

  const out = { ok, geometry, headform, headformSlot, portrait };
  console.log(JSON.stringify(out, null, 2));
  if (!ok) process.exit(1);
  console.log('PASS');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
