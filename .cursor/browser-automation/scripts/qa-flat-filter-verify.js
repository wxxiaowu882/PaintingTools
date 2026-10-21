/**
 * Verifier: 肖像沙盒扁平芯片 + 互斥 + 02 鲁迅 + 一级 Tab
 * 用法：source env.playwright.sh && node scripts/qa-flat-filter-verify.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:18080';
const outDir = path.resolve(__dirname, '..', 'runs', 'portrait-vision-batch');
fs.mkdirSync(outDir, { recursive: true });

const EXPECTED_CHIPS = ['男', '女', '儿童', '中青年', '老年', '东方', '西方'];
const FORBIDDEN = ['性别·全部', '年龄·全部', '族裔·全部', '全部'];

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  // 清掉可能残留的筛选记忆
  await context.addInitScript(() => {
    try {
      localStorage.removeItem('SolidConsumer_PortraitFilter_v2');
      localStorage.removeItem('SolidConsumer_PortraitFilter_v1');
    } catch (_e) {}
  });
  const page = await context.newPage();
  page.setDefaultTimeout(180000);

  await page.goto(`${baseUrl}/Solid?sandbox=portrait&skipPerf=1&_=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 180000
  });
  await page.waitForFunction(() => {
    const m = document.getElementById('scene-grid-modal');
    return m && m.style.display === 'flex' && Array.isArray(window.customScenes) && window.customScenes.length > 0;
  }, { timeout: 180000 });
  await page.waitForTimeout(800);

  const report = { pass: true, fails: [], checks: {} };

  // —— 一级 Tab ——
  const primaryTabs = await page.evaluate(() => {
    const bar = document.getElementById('scene-tabs') || document.querySelector('.scene-tabs');
    if (!bar) return [];
    return Array.from(bar.querySelectorAll('button, .scene-tab')).map((b) =>
      String(b.textContent || '').replace(/\s+/g, ' ').trim()
    );
  });
  const needPrimary = ['全部', '石膏', '真人', '收藏夹'];
  const primaryOk = needPrimary.every((t) => primaryTabs.some((x) => x.indexOf(t) >= 0));
  report.checks.primaryTabs = { primaryTabs, ok: primaryOk };
  if (!primaryOk) {
    report.pass = false;
    report.fails.push('一级 Tab 缺少：期望含 ' + needPrimary.join('/') + '，实际 ' + JSON.stringify(primaryTabs));
  }

  // —— 二级芯片文案 ——
  const chipInfo = await page.evaluate(() => {
    const sub = document.getElementById('scene-subtabs') || document.querySelector('.scene-subtabs');
    if (!sub) return { texts: [], html: '', display: 'missing' };
    const st = getComputedStyle(sub);
    return {
      display: st.display,
      texts: Array.from(sub.querySelectorAll('.scene-subtab, button')).map((b) =>
        String(b.textContent || '').trim()
      ),
      tags: Array.from(sub.querySelectorAll('[data-ptag]')).map((b) => b.getAttribute('data-ptag')),
      html: sub.innerHTML.slice(0, 800)
    };
  });
  report.checks.chips = chipInfo;

  const hasForbidden = chipInfo.texts.some((t) => {
    if (FORBIDDEN.indexOf(t) >= 0) return true;
    if (/·全部$/.test(t)) return true;
    if (t === '性别·全部' || t === '年龄·全部' || t === '族裔·全部') return true;
    return false;
  });
  // 「全部」作为二级芯片禁止；一级 Tab 的全部不算
  const hasAllAsChip = chipInfo.texts.some((t) => t === '全部' || /性别·全部|年龄·全部|族裔·全部/.test(t));
  const chipsExact =
    chipInfo.texts.length === EXPECTED_CHIPS.length &&
    EXPECTED_CHIPS.every((c, i) => chipInfo.texts[i] === c);
  const chipsSetOk =
    EXPECTED_CHIPS.every((c) => chipInfo.texts.indexOf(c) >= 0) &&
    chipInfo.texts.every((t) => EXPECTED_CHIPS.indexOf(t) >= 0);

  report.checks.chipsOk = { chipsExact, chipsSetOk, hasForbidden, hasAllAsChip };
  if (!chipsSetOk || hasAllAsChip || hasForbidden) {
    report.pass = false;
    report.fails.push(
      '二级芯片不符：期望仅 ' +
        EXPECTED_CHIPS.join('/') +
        '，实际 ' +
        JSON.stringify(chipInfo.texts)
    );
  }

  // 截图芯片区
  const subLoc = page.locator('#scene-subtabs, .scene-subtabs').first();
  const chipShot = path.join(outDir, 'qa-flat-filter-chips.png');
  if (await subLoc.count()) {
    await subLoc.screenshot({ path: chipShot });
  } else {
    await page.screenshot({ path: chipShot, fullPage: false });
  }
  report.checks.chipShot = chipShot;

  // 全模态截图（含一级+二级）
  const modalShot = path.join(outDir, 'qa-flat-filter-modal.png');
  const modal = page.locator('#scene-grid-modal').first();
  if (await modal.count()) {
    await modal.screenshot({ path: modalShot }).catch(async () => {
      await page.screenshot({ path: modalShot, fullPage: false });
    });
  }
  report.checks.modalShot = modalShot;

  async function cardStats() {
    return page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('#scene-grid .scene-item, .scene-grid .scene-item, #scene-list .scene-item'));
      // fallback: any .scene-item inside modal
      const all = items.length
        ? items
        : Array.from(document.querySelectorAll('#scene-grid-modal .scene-item'));
      const titles = all.map((el) => {
        const t =
          el.querySelector('.scene-title, .title, .name') ||
          el.querySelector('span, div');
        return String((t && t.textContent) || el.textContent || '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 40);
      });
      return { count: all.length, sample: titles.slice(0, 12), has02LuXun: titles.some((t) => /02\s*鲁迅|鲁迅/.test(t)) };
    });
  }

  const baseline = await cardStats();
  report.checks.baseline = baseline;

  // 02 鲁迅：在未筛选或全部列表中
  if (!baseline.has02LuXun) {
    // 可能标题结构不同，查 customScenes
    const name02 = await page.evaluate(() => {
      const arr = window.customScenes || [];
      const s = arr.find((x) => x && /^02\b/.test(String(x.name || '')));
      return s ? s.name : null;
    });
    report.checks.name02 = name02;
    if (!name02 || !/鲁迅/.test(name02)) {
      report.pass = false;
      report.fails.push('场景 02 显示名不含鲁迅：' + JSON.stringify(name02));
    }
  } else {
    report.checks.name02 = 'visible in list';
  }

  // —— 互斥：点「男」——
  await page.click('.scene-subtab[data-ptag="男"]');
  await page.waitForTimeout(400);
  const afterMale = await cardStats();
  const maleActive = await page.evaluate(() => {
    const b = document.querySelector('.scene-subtab[data-ptag="男"]');
    return !!(b && b.classList.contains('active'));
  });
  report.checks.afterMale = { ...afterMale, maleActive };
  const maleShot = path.join(outDir, 'qa-flat-filter-male.png');
  await page.screenshot({ path: maleShot, fullPage: false });
  report.checks.maleShot = maleShot;

  if (!(afterMale.count < baseline.count && afterMale.count > 0)) {
    report.pass = false;
    report.fails.push(
      `点「男」后列表应变短：baseline=${baseline.count} afterMale=${afterMale.count}`
    );
  }
  if (!maleActive) {
    report.pass = false;
    report.fails.push('点「男」后芯片未 active');
  }

  // —— 再点「西方」应替换（非交集）——
  await page.click('.scene-subtab[data-ptag="西方"]');
  await page.waitForTimeout(400);
  const afterWest = await cardStats();
  const westState = await page.evaluate(() => {
    const male = document.querySelector('.scene-subtab[data-ptag="男"]');
    const west = document.querySelector('.scene-subtab[data-ptag="西方"]');
    return {
      maleActive: !!(male && male.classList.contains('active')),
      westActive: !!(west && west.classList.contains('active')),
      tag: (() => {
        try {
          return JSON.parse(localStorage.getItem('SolidConsumer_PortraitFilter_v2') || '{}').tag || '';
        } catch (_e) {
          return '';
        }
      })()
    };
  });
  report.checks.afterWest = { ...afterWest, ...westState };
  const westShot = path.join(outDir, 'qa-flat-filter-west.png');
  await page.screenshot({ path: westShot, fullPage: false });
  report.checks.westShot = westShot;

  if (!westState.westActive || westState.maleActive || westState.tag !== '西方') {
    report.pass = false;
    report.fails.push('点「西方」后应仅西方 active（替换男）：' + JSON.stringify(westState));
  }
  // 西方列表数应与「仅西方」一致，不等于男∩西方（用 evaluate 算期望）
  const expectedWestOnly = await page.evaluate(() => {
    const arr = window.customScenes || [];
    // 复用页面函数若暴露；否则粗算 meta.region
    return arr.filter((s) => s && s.meta && s.meta.region === '西方').length;
  });
  report.checks.expectedWestOnly = expectedWestOnly;
  // 列表可能含 fallback 推断，允许误差但必须明显不是交集
  if (afterWest.count === 0) {
    report.pass = false;
    report.fails.push('点「西方」后列表为空');
  }
  // 若男∩西方远小于仅西方，而 afterWest 接近仅西方 → 替换成功
  const intersectMW = await page.evaluate(() => {
    const arr = window.customScenes || [];
    return arr.filter((s) => s && s.meta && s.meta.gender === '男' && s.meta.region === '西方').length;
  });
  report.checks.intersectMaleWest = intersectMW;
  if (intersectMW > 0 && afterWest.count === intersectMW && expectedWestOnly > intersectMW + 2) {
    report.pass = false;
    report.fails.push(
      `疑似男∩西方交集而非替换：afterWest=${afterWest.count} intersect=${intersectMW} westOnly≈${expectedWestOnly}`
    );
  }

  // —— 再点已选「西方」取消 ——
  await page.click('.scene-subtab[data-ptag="西方"]');
  await page.waitForTimeout(400);
  const afterClear = await cardStats();
  const clearState = await page.evaluate(() => {
    const west = document.querySelector('.scene-subtab[data-ptag="西方"]');
    let tag = '';
    try {
      tag = JSON.parse(localStorage.getItem('SolidConsumer_PortraitFilter_v2') || '{}').tag || '';
    } catch (_e) {}
    return {
      westActive: !!(west && west.classList.contains('active')),
      tag,
      anyActive: !!document.querySelector('.scene-subtab.active')
    };
  });
  report.checks.afterClear = { ...afterClear, ...clearState };
  const clearShot = path.join(outDir, 'qa-flat-filter-clear.png');
  await page.screenshot({ path: clearShot, fullPage: false });
  report.checks.clearShot = clearShot;

  if (clearState.westActive || clearState.tag || clearState.anyActive) {
    report.pass = false;
    report.fails.push('再点「西方」应取消筛选：' + JSON.stringify(clearState));
  }
  if (afterClear.count !== baseline.count) {
    report.pass = false;
    report.fails.push(
      `取消后列表数应恢复 baseline：baseline=${baseline.count} afterClear=${afterClear.count}`
    );
  }

  const reportPath = path.join(outDir, 'qa-flat-filter-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ pass: report.pass, fails: report.fails, reportPath, chipShot, modalShot }, null, 2));
  await browser.close();
  process.exit(report.pass ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
