/**
 * 截图验收标注压亮：几何体「最深处」近白标 + headform 青绿/红标
 * PORT=18080 PLAYWRIGHT_CHANNEL=msedge node scripts/qa-anno-color-tone-shots.js
 */
require('./_playwright-browsers-path');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PORT = process.env.PORT || '18080';
const BASE = process.env.BASE_URL || `http://127.0.0.1:${PORT}`;
const outDir = path.join(__dirname, '..', 'runs');

async function waitList(page) {
  await page.waitForFunction(() => {
    const loader = document.getElementById('scene-loader');
    const modal = document.getElementById('scene-grid-modal');
    const loaderGone = !loader || loader.style.display === 'none' || getComputedStyle(loader).display === 'none';
    const modalOn = modal && (modal.style.display === 'flex' || getComputedStyle(modal).display === 'flex');
    return loaderGone && modalOn && document.querySelectorAll('#scene-grid-container .scene-item').length > 0;
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
  await page.waitForTimeout(1200);
}

async function enterByMatch(page, predSrc) {
  const idx = await page.evaluate((src) => {
    // eslint-disable-next-line no-new-func
    const pred = new Function('s', 'return (' + src + ')(s);');
    const scenes = window.customScenes || [];
    return scenes.findIndex((s) => s && pred(s));
  }, predSrc);
  if (idx < 0) throw new Error('scene not found');
  await page.evaluate((i) => {
    if (typeof window.switchScene === 'function') window.switchScene(i);
  }, idx);
  await waitInScene(page);
  return idx;
}

async function sampleAnnoColors(page) {
  return page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll('.anno-leader-label'));
    return labels.slice(0, 12).map((el) => ({
      text: (el.textContent || '').trim().slice(0, 40),
      border: el.style.borderColor || '',
      bg: el.style.backgroundColor || '',
      dataColor: el.dataset.color || ''
    }));
  });
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true
  });
  const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
  page.setDefaultTimeout(120000);
  const out = {};

  await page.goto(`${BASE}/Solid?sandbox=geometry`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await waitList(page);
  // 课名曾用「最深处/最暗处」两种写法，兼容匹配
  out.geoIdx = await enterByMatch(page, "s => /球体/.test(String(s.name||'')) && /最[深暗]处探讨/.test(String(s.name||''))");
  out.geoColors = await sampleAnnoColors(page);
  const geoShot = path.join(outDir, 'qa-anno-tone-geometry-darkest.png');
  await page.screenshot({ path: geoShot, fullPage: false });
  out.geoShot = geoShot;

  // 导航可见
  out.geoNav = await page.evaluate(() => {
    const prev = document.getElementById('solid-lesson-nav-prev');
    const next = document.getElementById('solid-lesson-nav-next');
    return {
      prevVisible: !!(prev && !prev.hidden && prev.classList.contains('is-visible')),
      nextVisible: !!(next && !next.hidden && next.classList.contains('is-visible'))
    };
  });

  await page.goto(`${BASE}/Solid?sandbox=headform`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await waitList(page);
  // name 无头模名；modelLabel 才有「欧男大本」。优先 102 正面（含红+青绿）
  out.hfIdx = await enterByMatch(
    page,
    "s => { const m = (s.meta && s.meta.modelLabel) ? String(s.meta.modelLabel) : ''; const n = String(s.name||''); return m.indexOf('欧男大本') >= 0 && n.indexOf('正面') >= 0 && n.indexOf('侧') < 0; }"
  );
  out.hfColors = await sampleAnnoColors(page);
  const hfShot = path.join(outDir, 'qa-anno-tone-headform.png');
  await page.screenshot({ path: hfShot, fullPage: false });
  out.hfShot = hfShot;

  out.hfNav = await page.evaluate(() => {
    const prev = document.getElementById('solid-lesson-nav-prev');
    const next = document.getElementById('solid-lesson-nav-next');
    return {
      prevVisible: !!(prev && !prev.hidden && prev.classList.contains('is-visible')),
      nextVisible: !!(next && !next.hidden && next.classList.contains('is-visible'))
    };
  });

  await browser.close();

  const geoOk = !!(out.geoColors && out.geoColors.length && out.geoColors.every((c) => {
    const d = String(c.dataColor || '').toLowerCase();
    return d === '#bdb9b2' || d === '#b8b4ad' || !d.startsWith('#ed') && !d.startsWith('#e8') && d !== '#ffffff' && d !== '#fff';
  }));
  const hfHasTeal = !!(out.hfColors || []).some((c) => /#19a[89]a[89]|#19a9a7/i.test(String(c.dataColor || '')));
  const hfHasRed = !!(out.hfColors || []).some((c) => /#a91919/i.test(String(c.dataColor || '')));
  out.ok = !!(geoOk && out.geoNav && out.geoNav.prevVisible && out.hfNav && out.hfNav.prevVisible && (hfHasTeal || hfHasRed));
  out.checks = { geoOk, hfHasTeal, hfHasRed };

  console.log(JSON.stringify(out, null, 2));
  if (!out.ok) process.exit(1);
  console.log('PASS');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
