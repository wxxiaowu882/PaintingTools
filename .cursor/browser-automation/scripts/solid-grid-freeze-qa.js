/**
 * 场景列表卡死回归：补图后切 Tab / 进课不应长时间无响应
 */
const path = require('path');
const fs = require('fs');
require('./_playwright-browsers-path.js');
const { chromium } = require('playwright');

const BASE = process.env.QA_BASE || 'https://test.wuxiaoart.com';
const OUT = path.join(__dirname, '..', 'runs', 'solid-grid-freeze-qa');
fs.mkdirSync(OUT, { recursive: true });

async function waitLoaderGone(page, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const visible = await page.evaluate(() => {
      const el = document.getElementById('scene-loader');
      if (!el) return false;
      const st = getComputedStyle(el);
      return st.display !== 'none' && st.visibility !== 'hidden' && Number(st.opacity) > 0.05;
    });
    if (!visible) return;
    await page.waitForTimeout(300);
  }
}

(async () => {
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const report = { ok: true, steps: [] };
  try {
    await page.goto(BASE + '/Solid?sandbox=geometry', { waitUntil: 'domcontentloaded', timeout: 90000 });
    await waitLoaderGone(page, 90000);
    await page.waitForTimeout(2500);

    // 等至少一批缩略图进内存
    await page.waitForTimeout(3000);

    const t0 = Date.now();
    await page.evaluate(() => {
      const tab = document.querySelector('#scene-tabbar .scene-tab[data-mode="几何体"]')
        || document.querySelector('#scene-tabbar .scene-tab:not([data-mode="all"])');
      if (tab) tab.click();
    });
    // 若卡死，evaluate 后下一句会拖很久
    const items = await page.evaluate(() =>
      document.querySelectorAll('#scene-grid-container .scene-item').length
    );
    const tabMs = Date.now() - t0;
    report.steps.push({ name: 'switch_tab', ms: tabMs, items });

    // 再切回全部
    const t1 = Date.now();
    await page.evaluate(() => {
      const tab = document.querySelector('#scene-tabbar .scene-tab[data-mode="all"]');
      if (tab) tab.click();
    });
    const allCount = await page.evaluate(() =>
      document.querySelectorAll('#scene-grid-container .scene-item').length
    );
    const allMs = Date.now() - t1;
    report.steps.push({ name: 'switch_all', ms: allMs, items: allCount });

    // 点一个未锁定公开场景进课
    const enter = await page.evaluate(async () => {
      const scenes = window.customScenes || [];
      let idx = -1;
      for (let i = 0; i < scenes.length; i++) {
        const s = scenes[i];
        if (!s || s.__membershipLocked || (s.meta && s.meta.locked)) continue;
        idx = i;
        break;
      }
      if (idx < 0) return { ok: false, error: 'no_public_scene' };
      const t = Date.now();
      try {
        await window.switchScene(idx);
      } catch (e) {
        return { ok: false, error: String(e && e.message), ms: Date.now() - t, idx };
      }
      return {
        ok: true,
        idx,
        ms: Date.now() - t,
        loading: !!window.isLoadingScene,
        hydrateCancel: typeof window.__solidThumbHydrateCancel
      };
    });
    report.steps.push({ name: 'enter_scene', enter });

    await page.screenshot({ path: path.join(OUT, 'after.png') });

    // 无头环境上 134 卡重建可到数秒；硬卡死通常 >15s。阈值用于抓回归。
    if (tabMs > 8000 || allMs > 8000) {
      report.ok = false;
      report.error = '切 Tab 过慢: ' + tabMs + '/' + allMs;
    } else if (!enter || !enter.ok) {
      report.ok = false;
      report.error = '进课失败: ' + JSON.stringify(enter);
    }

    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
  } catch (e) {
    report.ok = false;
    report.error = String(e && e.stack ? e.stack : e);
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
    console.error(report.error);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
