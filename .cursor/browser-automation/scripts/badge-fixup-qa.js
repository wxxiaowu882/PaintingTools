/**
 * 本轮角标修复验收：晓阶可见 / AR checkbox 叠标 / 晓色不压字
 */
const path = require('path');
const fs = require('fs');
require('./_playwright-browsers-path.js');
const { chromium } = require('playwright');

const BASE = process.env.QA_BASE || 'http://127.0.0.1:18080';
const OUT = path.join(__dirname, '..', 'runs', 'badge-fixup-qa');
fs.mkdirSync(OUT, { recursive: true });

async function guest(page) {
  await page.evaluate(async () => {
    try {
      localStorage.removeItem('wuxiao_membership_entitlement_v1');
    } catch (_e) {}
    if (window.MembershipAccess) {
      try {
        await window.MembershipAccess.ready();
      } catch (_e) {}
      if (window.MembershipAccess.clearEntitlement) window.MembershipAccess.clearEntitlement();
      if (window.MembershipAccess.notify) window.MembershipAccess.notify();
    }
  });
  await page.waitForTimeout(400);
}

async function hideFab(page) {
  await page.evaluate(() => {
    document.querySelectorAll('button').forEach((el) => {
      if ((el.textContent || '').trim() === '权限涂色') el.style.display = 'none';
    });
  });
}

(async () => {
  const report = { ok: true, issues: [], meta: {} };
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

  try {
    // —— GR ——
    await page.goto(BASE + '/GR', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(1000);
    await guest(page);
    await hideFab(page);
    const gr = await page.evaluate(() => {
      function pack(id) {
        const btn = document.getElementById(id);
        if (!btn) return null;
        const badge = btn.querySelector('.membership-page-badge');
        if (!badge) return { hasBadge: false };
        const br = badge.getBoundingClientRect();
        const rr = btn.getBoundingClientRect();
        const shell = document.querySelector('.app-shell');
        const sr = shell ? shell.getBoundingClientRect() : null;
        return {
          hasBadge: true,
          text: (badge.textContent || '').trim(),
          insideBtn: br.top >= rr.top - 1 && br.bottom <= rr.bottom + 2 && br.right <= rr.right + 2,
          clippedByShell: !!(sr && (br.top < sr.top - 0.5 || br.bottom > sr.bottom + 0.5)),
          bg: getComputedStyle(badge).backgroundColor
        };
      }
      return { four: pack('btn-save-four-panel'), poster: pack('btn-save-poster') };
    });
    report.meta.gr = gr;
    if (!gr.four || !gr.four.hasBadge) report.issues.push('晓阶4联无标');
    if (!gr.poster || !gr.poster.hasBadge) report.issues.push('晓阶色阶无标');
    if (gr.four && gr.four.clippedByShell) report.issues.push('晓阶4联仍被 app-shell 裁切');
    if (gr.four && !gr.four.insideBtn) report.issues.push('晓阶4联角标未落在按钮内');
    await page.locator('#btn-save-four-panel').screenshot({ path: path.join(OUT, 'gr-four.png') });
    await page.locator('#btn-save-poster').screenshot({ path: path.join(OUT, 'gr-poster.png') });
    await page.locator('#btn-save-four-panel').locator('xpath=..').screenshot({
      path: path.join(OUT, 'gr-bar.png')
    });

    // —— XStudio ——
    await page.goto(BASE + '/XStudio', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(800);
    await guest(page);
    await hideFab(page);
    const openMs = await page.evaluate(async () => {
      const t0 = performance.now();
      if (typeof openPigmentModal === 'function') openPigmentModal();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const shown = document.getElementById('pigmentModal')?.classList.contains('active');
      const t1 = performance.now();
      await new Promise((r) => setTimeout(r, 200));
      if (window.__xstudioRefreshMembership) window.__xstudioRefreshMembership();
      return { ms: Math.round(t1 - t0), shown };
    });
    report.meta.xstudioOpen = openMs;
    await page.waitForTimeout(500);
    const xs = await page.evaluate(() => {
      const btn = document.getElementById('modalImportBoxBtn');
      const badge = btn && btn.querySelector('.membership-page-badge');
      if (!btn || !badge) return { hasBadge: false };
      const br = badge.getBoundingClientRect();
      const rr = btn.getBoundingClientRect();
      // 粗检：角标中心不应落在按钮文字水平中带（避免明显压字）
      const midY = (rr.top + rr.bottom) / 2;
      const coversMid = br.top < midY && br.bottom > midY && br.left < rr.left + rr.width * 0.55;
      return {
        hasBadge: true,
        text: (badge.textContent || '').trim(),
        pad: btn.style.paddingRight,
        coversMid
      };
    });
    report.meta.xstudio = xs;
    if (!xs.hasBadge) report.issues.push('晓色导入无标');
    if (xs.coversMid) report.issues.push('晓色导入角标可能压住文字中部');
    if (openMs.ms > 120) report.issues.push('晓色弹壳偏慢 ' + openMs.ms + 'ms（仅作提示）');
    await page.locator('#modalImportBoxBtn').screenshot({ path: path.join(OUT, 'xs-import.png') });
    await page.locator('#pigmentModal').screenshot({ path: path.join(OUT, 'xs-modal.png') });

    // —— AR ——
    await page.goto(BASE + '/ARSketch', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(800);
    await guest(page);
    await hideFab(page);
    await page.evaluate(() => {
      const ss = document.getElementById('start-screen');
      if (ss) ss.style.display = 'none';
      const c = document.getElementById('controls');
      if (c) c.style.display = 'flex';
      const more = document.getElementById('more-controls');
      if (more) more.style.display = 'flex';
      if (window.MembershipAccess && window.MembershipAccess.notify) window.MembershipAccess.notify();
    });
    await page.waitForTimeout(400);
    const ar = await page.evaluate(() => {
      const host = document.querySelector('.ar-sketch-chk-host');
      const badge = host && host.querySelector('.membership-page-badge');
      if (!badge) return { hasBadge: false };
      const cs = getComputedStyle(badge);
      return {
        hasBadge: true,
        text: (badge.textContent || '').trim(),
        absolute: cs.position === 'absolute',
        hasBg: cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent'
      };
    });
    report.meta.ar = ar;
    if (!ar.hasBadge) report.issues.push('AR checkbox 无标');
    if (ar.hasBadge && !ar.absolute) report.issues.push('AR 角标应为绝对定位叠标');
    if (ar.hasBadge && !ar.hasBg) report.issues.push('AR 角标应有底色');
    await page.locator('#ar-sketch-mod-row').screenshot({ path: path.join(OUT, 'ar-row.png') });
    await page.locator('#controls').screenshot({ path: path.join(OUT, 'ar-panel.png') });

    // Soft: openMs 超时不作为硬失败
    report.issues = report.issues.filter((x) => !String(x).startsWith('晓色弹壳偏慢'));
    report.ok = report.issues.length === 0;
  } catch (e) {
    report.ok = false;
    report.issues.push(String((e && e.stack) || e));
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.ok ? 0 : 1);
  }
})();
