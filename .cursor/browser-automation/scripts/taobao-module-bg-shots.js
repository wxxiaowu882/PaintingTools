/**
 * 淘宝首页模块虚背景：从工坊真实场景/工具页截图
 * 用法：先 serve:repo，再 node scripts/taobao-module-bg-shots.js
 */
'use strict';

require('./_playwright-browsers-path');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:18080';
const outDir = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '自用工具文件_不部署',
  '淘宝店铺装修素材_2026-11',
  'module-bg'
);
fs.mkdirSync(outDir, { recursive: true });

async function waitLoaderGone(page) {
  await page
    .waitForFunction(() => {
      const el = document.getElementById('scene-loader');
      if (!el) return true;
      const st = getComputedStyle(el);
      return st.display === 'none' || Number(st.opacity || 1) < 0.05;
    }, null, { timeout: 240000 })
    .catch(() => {});
  await page.waitForTimeout(2000);
}

async function dismissOverlays(page) {
  await page.evaluate(() => {
    const kill = (sel) => {
      document.querySelectorAll(sel).forEach((el) => {
        el.style.setProperty('display', 'none', 'important');
        el.style.setProperty('visibility', 'hidden', 'important');
        el.style.setProperty('opacity', '0', 'important');
        el.style.setProperty('pointer-events', 'none', 'important');
      });
    };
    kill('#global-menu, #global-menu-root, .global-menu, #hw-debug-panel');
    kill('#scene-grid-modal, #scene-loader, .membership-paint-host, [data-membership-lock]');
    kill('.lock-ribbon, .membership-gate');
    // 权限涂色等角标
    document.querySelectorAll('button, .badge, .pill, [class*="badge"]').forEach((el) => {
      const t = (el.textContent || '').trim();
      if (/权限|涂色|会员|Pro/.test(t) && t.length < 12) {
        el.style.setProperty('display', 'none', 'important');
      }
    });
  }).catch(() => {});
}

async function openFirstScene(page) {
  await page.waitForFunction(() => {
    return Array.isArray(window.customScenes) && window.customScenes.length > 0;
  }, { timeout: 180000 }).catch(() => {});

  const n = await page.evaluate(() => (window.customScenes || []).length);
  console.log('  scenes:', n);
  if (n > 0) {
    await page.evaluate(() => {
      try {
        window.currentSceneIndex = -1;
        if (typeof window.switchScene === 'function') window.switchScene(0);
      } catch (e) {}
      const m = document.getElementById('scene-grid-modal');
      if (m) m.style.display = 'none';
    });
  } else {
    // 点课表第一张卡
    await page.evaluate(() => {
      const m = document.getElementById('scene-grid-modal');
      if (m) m.style.display = 'flex';
    }).catch(() => {});
    await page.waitForTimeout(800);
    const card = page.locator('#scene-grid-modal .scene-card, #scene-grid-modal [data-scene-index], #scene-grid-modal button, #scene-grid-modal .card').first();
    if (await card.count()) {
      await card.click({ force: true }).catch(() => {});
    }
  }
}

async function waitCanvasLit(page) {
  // 等 canvas 有非近黑像素
  await page
    .waitForFunction(() => {
      const cvs = document.querySelector('canvas');
      if (!cvs || cvs.width < 40 || cvs.height < 40) return false;
      try {
        const ctx = cvs.getContext('2d') || cvs.getContext('webgl') || cvs.getContext('webgl2');
        // WebGL 读不到 2d；改用截图亮度代理：有 model / scene 即可
      } catch (e) {}
      const mv = document.querySelector('model-viewer');
      if (mv) return true;
      // Solid 常见：canvas + 无 loader
      const loader = document.getElementById('scene-loader');
      if (loader) {
        const st = getComputedStyle(loader);
        if (st.display !== 'none' && Number(st.opacity || 1) > 0.05) return false;
      }
      return !!cvs;
    }, { timeout: 120000 })
    .catch(() => {});
  await page.waitForTimeout(2500);
}

async function shotSolid(page, sandbox, file) {
  const url = `${baseUrl}/Solid?sandbox=${sandbox}&skipPerf=1&_=${Date.now()}`;
  console.log('GOTO', url);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await openFirstScene(page);
  await waitLoaderGone(page);
  await waitCanvasLit(page);
  await dismissOverlays(page);
  await page.waitForTimeout(500);

  const out = path.join(outDir, file);
  // 优先截主画布区域
  const box = await page.evaluate(() => {
    const mv = document.querySelector('model-viewer');
    const cvs = document.querySelector('canvas');
    const el = mv || cvs || document.body;
    const r = el.getBoundingClientRect();
    return { x: Math.max(0, r.x), y: Math.max(0, r.y), width: Math.min(r.width, window.innerWidth), height: Math.min(r.height, window.innerHeight) };
  });
  if (box && box.width > 100 && box.height > 100) {
    await page.screenshot({
      path: out,
      type: 'png',
      clip: {
        x: Math.floor(box.x),
        y: Math.floor(box.y),
        width: Math.floor(Math.min(box.width, 1100)),
        height: Math.floor(Math.min(box.height, 720))
      }
    });
  } else {
    await page.screenshot({ path: out, type: 'png' });
  }
  console.log('OK', out, fs.statSync(out).size);
}

async function shotTool(page, route, file, prep) {
  const url = `${baseUrl}${route}${route.includes('?') ? '&' : '?'}_=${Date.now()}`;
  console.log('GOTO', url);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(2800);
  if (typeof prep === 'function') await prep(page);
  await dismissOverlays(page);
  await page.waitForTimeout(400);
  const out = path.join(outDir, file);
  await page.screenshot({ path: out, type: 'png' });
  console.log('OK', out, fs.statSync(out).size);
}

(async () => {
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true
  });
  const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
  page.setDefaultTimeout(240000);

  // 几何：优先 geometry，失败再 geometrysketch
  try {
    await shotSolid(page, 'geometry', 'bg-geo.png');
  } catch (e) {
    console.warn('geometry fail', e.message);
    await shotSolid(page, 'geometrysketch', 'bg-geo.png');
  }
  await shotSolid(page, 'portrait', 'bg-portrait.png');

  await shotTool(page, '/GR', 'bg-jie.png');
  await shotTool(page, '/XStudio', 'bg-se.png');
  // 晓摹空落地偏黑：叠一张作品作参考氛围（仍是工具页框）
  await shotTool(page, '/ARSketch', 'bg-mu.png');

  await browser.close();
  console.log('DONE', outDir);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
