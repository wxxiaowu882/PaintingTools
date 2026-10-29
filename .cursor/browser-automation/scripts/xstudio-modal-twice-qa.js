/**
 * 晓色配置页：打开→关→再开；含「刚打开立刻点」竞态 + 暖启动
 */
const path = require('path');
const fs = require('fs');
require('./_playwright-browsers-path.js');
const { chromium } = require('playwright');

const BASE = process.env.QA_BASE || 'http://127.0.0.1:18080';
const OUT = path.join(__dirname, '..', 'runs', 'xstudio-modal-twice');
fs.mkdirSync(OUT, { recursive: true });

function buildShellInjectCss(topPx) {
  return (
    'html.wuxiao-android-shell,html.wuxiao-android-shell body{overflow-x:hidden!important;overflow-y:auto!important;}' +
    'html.wuxiao-android-shell{--app-safe-top:' + topPx + 'px;}' +
    'html.wuxiao-android-shell .brand-bar{padding-top:calc(var(--app-safe-top) + 10px)!important;}' +
    'html.wuxiao-android-shell .backdrop,html.wuxiao-android-shell .pigment-modal{backdrop-filter:none!important;-webkit-backdrop-filter:none!important;}' +
    'html.wuxiao-android-shell body.modal-open{overflow:hidden!important;}' +
    'html.wuxiao-android-shell body.modal-open .app-container{pointer-events:none!important;}' +
    'html.wuxiao-android-shell body.modal-open #pigmentModal,html.wuxiao-android-shell body.modal-open #modalBackdrop{pointer-events:auto!important;}' +
    'html.wuxiao-android-shell #pigmentModal.active{top:calc(var(--app-safe-top) + 72px)!important;pointer-events:auto!important;}' +
    'html.wuxiao-android-shell #pigmentModal .close-modal{z-index:70!important;}' +
    'html.wuxiao-android-shell #pigmentModalBusy{backdrop-filter:none!important;-webkit-backdrop-filter:none!important;background:rgba(247,248,250,0.88)!important;}'
  );
}

(async () => {
  const report = { ok: true, issues: [], cycles: [], race: null, warm: null };
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

  const css = buildShellInjectCss(28);
  const safeJs =
    '(function(){ try { var css = ' +
    JSON.stringify(css) +
    '; document.documentElement.classList.add("wuxiao-android-shell");' +
    'var s=document.createElement("style"); s.id="wuxiao-shell-inject-css"; s.textContent=css;' +
    '(document.head||document.documentElement).appendChild(s);' +
    'window.__SHELL_INJECT_SAFE_OK__=true; } catch(e){ window.__SHELL_INJECT_SAFE_OK__=false; throw e; } })();';
  try {
    fs.writeFileSync(path.join(OUT, '_inject_check.js'), safeJs);
    require('child_process').execFileSync(process.execPath, ['--check', path.join(OUT, '_inject_check.js')], {
      stdio: 'pipe'
    });
    report.injectSyntaxOk = true;
  } catch (e) {
    report.ok = false;
    report.injectSyntaxOk = false;
    report.issues.push('壳注入 JS 语法检查失败');
  }

  await page.goto(BASE + '/XStudio', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(2800);
  await page.evaluate((cssText) => {
    document.documentElement.classList.add('wuxiao-android-shell');
    const s = document.createElement('style');
    s.id = 'wuxiao-shell-inject-css';
    s.textContent = cssText;
    document.head.appendChild(s);
  }, css);

  // —— 硬验收：点开瞬间必须已有 active 弹层 + busy 进度条（同步路径不得卡死） ——
  const instant = await page.evaluate(() => {
    const t0 = performance.now();
    if (typeof openPigmentModal === 'function') openPigmentModal();
    const modal = document.getElementById('pigmentModal');
    const busy = document.getElementById('pigmentModalBusy');
    return {
      ms: Math.round(performance.now() - t0),
      active: !!(modal && modal.classList.contains('active')),
      busy: !!(busy && busy.classList.contains('active')),
      pe: modal ? getComputedStyle(modal).pointerEvents : ''
    };
  });
  report.instant = instant;
  if (!instant.active) {
    report.ok = false;
    report.issues.push('点齿轮后弹层未立刻 active');
  }
  if (!instant.busy) {
    report.ok = false;
    report.issues.push('点齿轮后进度条蒙版未立刻出现');
  }
  if (instant.ms > 80) {
    report.ok = false;
    report.issues.push('openPigmentModal 同步耗时过长 ms=' + instant.ms);
  }
  await page.evaluate(() => { try { closePigmentModal(); } catch (_e) {} });
  await page.waitForTimeout(200);

  // —— 竞态：仅在 busy 期间点 Tab/backdrop，不得误关；再等解锁 ——
  await page.click('#topConfigGearBtn');
  const race = await page.evaluate(async () => {
    const out = {
      stayedOpen: true,
      busySeen: false,
      unlocked: false,
      hitBusy: false,
      backdropIgnoredWhileBusy: true
    };
    const modal = document.getElementById('pigmentModal');
    const busy = document.getElementById('pigmentModalBusy');
    out.busySeen = !!(busy && busy.classList.contains('active'));
    const tBusy = Date.now();
    while (Date.now() - tBusy < 8000 && window.__pigmentModalBusy) {
      const tabs = document.getElementById('modalTabs');
      if (tabs) {
        const r = tabs.getBoundingClientRect();
        const el = document.elementFromPoint(r.left + Math.min(40, r.width / 2), r.top + 12);
        if (el && (el.id === 'pigmentModalBusy' || (el.closest && el.closest('#pigmentModalBusy')))) {
          out.hitBusy = true;
        }
        if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      }
      const bd = document.getElementById('modalBackdrop');
      if (bd && typeof bd.onclick === 'function') {
        // 直接走 backdrop 处理器：busy 时应忽略
        bd.onclick({ target: bd });
      } else if (bd) {
        bd.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      }
      if (!modal.classList.contains('active')) {
        out.stayedOpen = false;
        out.backdropIgnoredWhileBusy = false;
        break;
      }
      await new Promise((r) => setTimeout(r, 40));
    }
    const t0 = Date.now();
    while (Date.now() - t0 < 8000) {
      if (!window.__pigmentModalBusy && modal.classList.contains('active')) {
        out.unlocked = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    out.stillActive = modal.classList.contains('active');
    out.busyFinal = !!window.__pigmentModalBusy;
    return out;
  });
  report.race = race;
  if (!race.busySeen) {
    report.warnings = report.warnings || [];
    report.warnings.push('首次打开未看到 busy 蒙版（可能过快）');
  }
  if (!race.stayedOpen || !race.stillActive) {
    report.ok = false;
    report.issues.push('竞态：加载中点击导致弹窗关闭');
  }
  if (!race.unlocked) {
    report.ok = false;
    report.issues.push('竞态：busy 未在时限内解除');
  }
  await page.screenshot({ path: path.join(OUT, 'race-ready.png') });

  // 就绪后切 Tab + ×（Tab 横滑容器内，用 DOM click 避免 outside viewport）
  let afterTab = await page.evaluate(() => {
    const chip = document.querySelector('#modalTabs .tab-chip[data-palette-id="basic"]');
    if (chip) {
      try { chip.scrollIntoView({ block: 'nearest', inline: 'center' }); } catch (_e) {}
      chip.click();
    }
    return {
      active: document.getElementById('pigmentModal').classList.contains('active'),
      viewing: window.modalState && modalState.viewingTabId,
      hasChip: !!chip
    };
  });
  await page.waitForTimeout(100);
  if (!afterTab.active || afterTab.viewing !== 'basic') {
    report.ok = false;
    report.issues.push('就绪后点 Tab 异常 ' + JSON.stringify(afterTab));
  }
  let closed = await page.evaluate(() => {
    const x = document.querySelector('#pigmentModal .close-modal');
    if (x) x.click();
    else if (typeof closePigmentModal === 'function') closePigmentModal();
    return !document.getElementById('pigmentModal').classList.contains('active');
  });
  await page.waitForTimeout(200);
  closed = await page.evaluate(() => !document.getElementById('pigmentModal').classList.contains('active'));
  if (!closed) {
    report.ok = false;
    report.issues.push('第1次 × 未能关闭');
  }

  // —— 暖启动：再开应几乎无 busy ——
  const tWarm0 = Date.now();
  await page.click('#topConfigGearBtn');
  const warm = await page.evaluate(async () => {
    const out = { busyFlash: false, readyMs: 0 };
    const t0 = Date.now();
    out.busyFlash = !!(document.getElementById('pigmentModalBusy') && document.getElementById('pigmentModalBusy').classList.contains('active'));
    while (Date.now() - t0 < 3000) {
      if (document.getElementById('pigmentModal').classList.contains('active') && !window.__pigmentModalBusy) {
        out.readyMs = Date.now() - t0;
        break;
      }
      await new Promise((r) => setTimeout(r, 16));
    }
    out.active = document.getElementById('pigmentModal').classList.contains('active');
    out.cacheReady = !!(window._pigmentModalUi && window._pigmentModalUi.cacheReady);
    return out;
  });
  warm.wallMs = Date.now() - tWarm0;
  report.warm = warm;
  if (!warm.active) {
    report.ok = false;
    report.issues.push('暖启动未打开');
  }
  if (warm.readyMs > 400) {
    report.warnings = report.warnings || [];
    report.warnings.push('暖启动偏慢 readyMs=' + warm.readyMs);
  }

  for (let n = 2; n <= 3; n++) {
    afterTab = await page.evaluate(() => {
      const chip = document.querySelector('#modalTabs .tab-chip[data-palette-id="basic"]');
      if (chip) {
        try { chip.scrollIntoView({ block: 'nearest', inline: 'center' }); } catch (_e) {}
        chip.click();
      }
      return {
        active: document.getElementById('pigmentModal').classList.contains('active'),
        viewing: window.modalState && modalState.viewingTabId
      };
    });
    await page.waitForTimeout(80);
    if (!afterTab.active) {
      report.ok = false;
      report.issues.push('第' + n + '次：点 Tab 后弹窗被关闭');
    }
    closed = await page.evaluate(() => {
      const x = document.querySelector('#pigmentModal .close-modal');
      if (x) x.click();
      return !document.getElementById('pigmentModal').classList.contains('active');
    });
    await page.waitForTimeout(120);
    if (!closed) {
      report.ok = false;
      report.issues.push('第' + n + '次：× 未能关闭');
    }
    await page.click('#topConfigGearBtn');
    await page.waitForFunction(() => {
      const m = document.getElementById('pigmentModal');
      return m && m.classList.contains('active') && !window.__pigmentModalBusy;
    }, { timeout: 8000 });
    report.cycles.push({ n, afterTab, closed });
  }

  const xStyle = await page.evaluate(() => {
    const el = document.querySelector('#pigmentModal .close-modal');
    const cs = getComputedStyle(el);
    return { tag: el.tagName, border: cs.borderStyle, bw: cs.borderWidth, z: cs.zIndex };
  });
  if (xStyle.tag !== 'DIV' || (xStyle.border !== 'none' && parseFloat(xStyle.bw) > 0)) {
    report.ok = false;
    report.issues.push('× 样式异常 ' + JSON.stringify(xStyle));
  }
  await page.evaluate(() => {
    const x = document.querySelector('#pigmentModal .close-modal');
    if (x) x.click();
  });

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
  process.exit(report.ok ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
