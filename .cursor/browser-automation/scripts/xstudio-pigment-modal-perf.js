/**
 * 晓色配置页：打开 / 切 Tab / 关闭 耗时验收
 * 用法：PORT=18080 node scripts/xstudio-pigment-modal-perf.js
 */
const path = require('path');
const fs = require('fs');
require('./_playwright-browsers-path.js');
const { chromium } = require('playwright');

const BASE = process.env.QA_BASE || 'http://127.0.0.1:18080';
const OUT = path.join(__dirname, '..', 'runs', 'xstudio-pigment-perf');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const report = { ok: true, issues: [], timings: {} };

  await page.goto(BASE + '/XStudio', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(2500);

  // 模拟壳 class，便于检查注入相关样式是否冲突（本地无壳变量时 safe-top=0）
  await page.evaluate(() => {
    document.documentElement.classList.add('wuxiao-android-shell');
    document.documentElement.style.setProperty('--app-safe-top', '28px');
    let st = document.getElementById('wuxiao-shell-safe-top');
    if (!st) {
      st = document.createElement('style');
      st.id = 'wuxiao-shell-safe-top';
      document.head.appendChild(st);
    }
    st.textContent =
      'html.wuxiao-android-shell{--app-safe-top:28px;}' +
      'html.wuxiao-android-shell .brand-bar{padding-top:calc(var(--app-safe-top) + 10px)!important;}' +
      'html.wuxiao-android-shell .backdrop,html.wuxiao-android-shell .pigment-modal{backdrop-filter:none!important;-webkit-backdrop-filter:none!important;}' +
      'html.wuxiao-android-shell .pigment-modal:not(.active){pointer-events:none!important;}' +
      'html.wuxiao-android-shell body.modal-open{overflow:hidden!important;}' +
      'html.wuxiao-android-shell body.modal-open .app-container{pointer-events:none!important;}' +
      'html.wuxiao-android-shell body.modal-open #pigmentModal,html.wuxiao-android-shell body.modal-open #modalBackdrop,html.wuxiao-android-shell body.modal-open #pigmentModal .close-modal{pointer-events:auto!important;}' +
      'html.wuxiao-android-shell #pigmentModal.active{top:calc(var(--app-safe-top) + 72px)!important;}' +
      'html.wuxiao-android-shell #pigmentModal .close-modal{z-index:40!important;}';
  });

  const brandPad = await page.evaluate(() => {
    const el = document.querySelector('.brand-bar');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { paddingTop: cs.paddingTop, border: cs.border };
  });
  report.brandPad = brandPad;
  if (!brandPad || parseFloat(brandPad.paddingTop) < 30) {
    report.ok = false;
    report.issues.push('品牌栏顶空未生效');
  }

  const openMs = await page.evaluate(async () => {
    const t0 = performance.now();
    openPigmentModal();
    // 等到 Tab 与当前网格有内容
    for (let i = 0; i < 80; i++) {
      const tabs = document.querySelectorAll('#modalTabs .tab-chip').length;
      const pans = document.querySelectorAll('#currentSetGrid .pigment-pan-item, #currentSetGrid .pigment-select-item').length;
      const modal = document.getElementById('pigmentModal');
      if (modal && modal.classList.contains('active') && tabs >= 5 && pans >= 1) {
        return Math.round(performance.now() - t0);
      }
      await new Promise((r) => setTimeout(r, 16));
    }
    return -1;
  });
  report.timings.openMs = openMs;
  // 首屏：Tab+当前盒应在约 500ms 内可交互（不含后备库灌完）
  if (openMs < 0 || openMs > 500) {
    report.ok = false;
    report.issues.push('打开配置页过慢或失败 openMs=' + openMs);
  }

  await page.screenshot({ path: path.join(OUT, 'modal-open.png') });

  // 关闭钮样式：不应有边框盒
  const closeCss = await page.evaluate(() => {
    const el = document.querySelector('#pigmentModal .close-modal');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      tag: el.tagName,
      borderWidth: cs.borderWidth,
      borderStyle: cs.borderStyle,
      background: cs.backgroundColor,
      padding: cs.padding
    };
  });
  report.closeCss = closeCss;
  if (!closeCss || closeCss.tag !== 'DIV') {
    report.ok = false;
    report.issues.push('关闭钮不是 DIV');
  }
  if (closeCss && closeCss.borderStyle && closeCss.borderStyle !== 'none' && parseFloat(closeCss.borderWidth) > 0) {
    report.ok = false;
    report.issues.push('关闭钮出现边框');
  }

  // 切预设 Tab 耗时（应快：不重建 Tab）
  const tabMs = await page.evaluate(async () => {
    const chip = document.querySelector('#modalTabs .tab-chip[data-palette-id="std12"]');
    if (!chip) return -2;
    const t0 = performance.now();
    chip.click();
    for (let i = 0; i < 60; i++) {
      if (chip.classList.contains('active')) {
        const pans = document.querySelectorAll('#currentSetGrid .pigment-pan-item').length;
        if (pans >= 8) return Math.round(performance.now() - t0);
      }
      await new Promise((r) => setTimeout(r, 16));
    }
    return -1;
  });
  report.timings.tabStd12Ms = tabMs;
  if (tabMs < 0 || tabMs > 400) {
    report.ok = false;
    report.issues.push('切标准12色过慢或失败 tabMs=' + tabMs);
  }

  const tab2Ms = await page.evaluate(async () => {
    const chip = document.querySelector('#modalTabs .tab-chip[data-palette-id="basic"]');
    if (!chip) return -2;
    const t0 = performance.now();
    chip.click();
    for (let i = 0; i < 60; i++) {
      if (chip.classList.contains('active')) {
        return Math.round(performance.now() - t0);
      }
      await new Promise((r) => setTimeout(r, 16));
    }
    return -1;
  });
  report.timings.tabBasicMs = tab2Ms;
  if (tab2Ms < 0 || tab2Ms > 400) {
    report.ok = false;
    report.issues.push('切基础三色过慢 tabMs=' + tab2Ms);
  }

  // 点 × 应关闭
  const closed = await page.evaluate(() => {
    const btn = document.querySelector('#pigmentModal .close-modal');
    if (!btn) return false;
    btn.click();
    return !document.getElementById('pigmentModal').classList.contains('active');
  });
  report.closedByX = closed;
  if (!closed) {
    report.ok = false;
    report.issues.push('点击 × 未能关闭');
  }

  await page.screenshot({ path: path.join(OUT, 'after-close.png') });
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
  process.exit(report.ok ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
