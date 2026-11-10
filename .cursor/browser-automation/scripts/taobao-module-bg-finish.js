/**
 * 补齐肖像 / 晓摹 虚背景截图
 */
'use strict';
require('./_playwright-browsers-path');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:18080';
const outDir = path.resolve(__dirname, '..', '..', '..', '自用工具文件_不部署', '淘宝店铺装修素材_2026-11', 'module-bg');
const gallerySample = path.resolve(__dirname, '..', '..', '..', 'docs', 'galleryIMG', '东方的笑', '1.jpg');
fs.mkdirSync(outDir, { recursive: true });

async function dismissAll(page) {
  for (let i = 0; i < 6; i++) {
    await page.evaluate(() => {
      document.querySelectorAll('button, a, [role=button]').forEach((btn) => {
        const t = (btn.textContent || '').trim();
        if (/稍后再说|我知道了|关闭|跳过|开始体验|知道了|暂不|取消/.test(t)) {
          try { btn.click(); } catch (e) {}
        }
      });
      document.querySelectorAll('[role=dialog], .modal, [class*="modal"], [class*="dialog"], [class*="guide"], [class*="help"]').forEach((el) => {
        const t = el.textContent || '';
        if (/会员|注册|欢迎|渲染|解析|操作指南/.test(t)) {
          el.style.setProperty('display', 'none', 'important');
        }
      });
    }).catch(() => {});
    await page.waitForTimeout(300);
  }
}

async function hideChrome(page) {
  await page.evaluate(() => {
    const sels = ['#global-menu', '#global-menu-root', '.global-menu', '#scene-grid-modal', '#hw-debug-panel', '#scene-loader'];
    sels.forEach((sel) => document.querySelectorAll(sel).forEach((el) => el.style.setProperty('display', 'none', 'important')));
    document.querySelectorAll('button').forEach((btn) => {
      const t = (btn.textContent || '').trim();
      if (/权限|涂色|开始渲染|停止渲染|稍后再说|去注册/.test(t)) btn.style.setProperty('display', 'none', 'important');
    });
    document.querySelectorAll('.HotspotAnnotation, .hotspot, [class*="Hotspot"]').forEach((el) => {
      el.style.setProperty('display', 'none', 'important');
    });
  });
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 720 } });
  page.setDefaultTimeout(240000);

  // —— 肖像：关弹层后切到有模型的课 ——
  console.log('portrait…');
  await page.goto(`${baseUrl}/Solid?sandbox=portrait&skipPerf=1&_=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 180000
  });
  await page.waitForFunction(() => Array.isArray(window.customScenes) && window.customScenes.length > 0, {
    timeout: 180000
  });
  await dismissAll(page);

  // 优先找名字像石膏/头像且尽量靠前的课
  const pick = await page.evaluate(() => {
    const arr = window.customScenes || [];
    const prefer = [/石膏/, /头/, /肖像/, /青年/, /女/, /男/, /凯撒/, /大卫/];
    let idx = -1;
    for (const re of prefer) {
      idx = arr.findIndex((s) => re.test(String(s && s.name || '')));
      if (idx >= 0) break;
    }
    if (idx < 0) idx = Math.min(8, arr.length - 1);
    return { idx, name: arr[idx] && arr[idx].name, n: arr.length };
  });
  console.log('pick', pick);
  await page.evaluate((i) => {
    window.currentSceneIndex = -1;
    if (typeof window.switchScene === 'function') window.switchScene(i);
    const m = document.getElementById('scene-grid-modal');
    if (m) m.style.display = 'none';
  }, pick.idx);
  await dismissAll(page);
  await page
    .waitForFunction(() => {
      const el = document.getElementById('scene-loader');
      if (!el) return true;
      const st = getComputedStyle(el);
      return st.display === 'none' || Number(st.opacity || 1) < 0.05;
    }, { timeout: 240000 })
    .catch(() => {});
  await page.waitForTimeout(2800);
  await dismissAll(page);
  await hideChrome(page);
  await page.waitForTimeout(400);

  const outP = path.join(outDir, 'bg-portrait.png');
  await page.screenshot({ path: outP, type: 'png' });
  console.log('OK portrait', fs.statSync(outP).size);

  // —— 晓摹：导入一张作品作叠图氛围 ——
  console.log('arsketch…');
  await page.goto(`${baseUrl}/ARSketch?_=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(2000);
  await dismissAll(page);

  const input = page.locator('input[type=file]').first();
  const sample = fs.existsSync(gallerySample)
    ? gallerySample
    : path.resolve(__dirname, '..', '..', '..', 'docs', 'galleryIMG', '信任', '1.jpg');
  if (await input.count()) {
    await input.setInputFiles(sample).catch((e) => console.warn('setInputFiles', e.message));
    await page.waitForTimeout(2500);
  } else {
    // 点「导入参考图」再找 file input
    await page.getByText(/导入参考图|选择图片|打开/).first().click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(500);
    const input2 = page.locator('input[type=file]').first();
    if (await input2.count()) {
      await input2.setInputFiles(sample).catch(() => {});
      await page.waitForTimeout(2500);
    }
  }
  await dismissAll(page);
  await hideChrome(page);
  const outM = path.join(outDir, 'bg-mu.png');
  await page.screenshot({ path: outM, type: 'png' });
  console.log('OK mu', fs.statSync(outM).size);

  // —— 晓阶：同样塞一张图，色阶界面更有辨识 ——
  console.log('gr…');
  await page.goto(`${baseUrl}/GR?_=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(1500);
  await dismissAll(page);
  const grInput = page.locator('input[type=file]').first();
  if (await grInput.count()) {
    await grInput.setInputFiles(sample).catch(() => {});
    await page.waitForTimeout(2500);
  } else {
    await page.getByText(/打开相册|选择图片|打开图片/).first().click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
    const gi = page.locator('input[type=file]').first();
    if (await gi.count()) {
      await gi.setInputFiles(sample).catch(() => {});
      await page.waitForTimeout(2500);
    }
  }
  await dismissAll(page);
  await hideChrome(page);
  const outJ = path.join(outDir, 'bg-jie.png');
  await page.screenshot({ path: outJ, type: 'png' });
  console.log('OK jie', fs.statSync(outJ).size);

  await browser.close();
  console.log('DONE');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
