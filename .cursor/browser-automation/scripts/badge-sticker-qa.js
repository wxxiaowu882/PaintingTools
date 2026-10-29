/**
 * NEW 感叠标验收：晓色 / 晓阶 / AR
 */
const path = require('path');
const fs = require('fs');
require('./_playwright-browsers-path.js');
const { chromium } = require('playwright');

const BASE = process.env.QA_BASE || 'http://127.0.0.1:18080';
const OUT = path.join(__dirname, '..', 'runs', 'badge-sticker-qa');
fs.mkdirSync(OUT, { recursive: true });

async function guest(page) {
  await page.evaluate(async () => {
    try {
      localStorage.removeItem('wuxiao_membership_entitlement_v1');
    } catch (_e) {}
    if (window.MembershipAccess && window.MembershipAccess.ready) {
      try {
        await window.MembershipAccess.ready();
      } catch (_e) {}
    }
    if (window.MembershipAccess && window.MembershipAccess.clearEntitlement) {
      window.MembershipAccess.clearEntitlement();
    }
    if (window.MembershipAccess && window.MembershipAccess.notify) {
      window.MembershipAccess.notify();
    }
  });
}

async function hideFab(page) {
  await page.evaluate(() => {
    document.querySelectorAll('button,div,span').forEach((el) => {
      if ((el.textContent || '').trim() === '权限涂色' && el.children.length <= 1) {
        el.style.display = 'none';
      }
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
    // GR
    await page.goto(BASE + '/GR', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(1200);
    await guest(page);
    await page.waitForTimeout(500);
    await hideFab(page);
    const gr = await page.evaluate(() => {
      function info(id) {
        const btn = document.getElementById(id);
        if (!btn) return null;
        const badge = btn.querySelector('.membership-page-badge');
        if (!badge) return { hasBadge: false };
        const br = badge.getBoundingClientRect();
        const rr = btn.getBoundingClientRect();
        return {
          hasBadge: true,
          text: (badge.textContent || '').trim(),
          // 探出：角标顶边应高于按钮顶边，或右边超出按钮右边
          protrudeTop: Math.round(rr.top - br.top),
          protrudeRight: Math.round(br.right - rr.right),
          rotate: (badge.style.transform || '').indexOf('rotate') >= 0,
          hasBg: /background:\s*(?!transparent)/i.test(badge.getAttribute('style') || '')
        };
      }
      return { four: info('btn-save-four-panel'), poster: info('btn-save-poster') };
    });
    report.meta.gr = gr;
    if (!gr.four || !gr.four.hasBadge) report.issues.push('晓阶4联无标');
    if (!gr.poster || !gr.poster.hasBadge) report.issues.push('晓阶色阶无标');
    if (gr.four && gr.four.protrudeTop < 2 && gr.four.protrudeRight < 2) {
      report.issues.push('晓阶4联未探出边框');
    }
    if (gr.four && gr.four.rotate) report.issues.push('晓阶4联不应旋转');
    // 截整条底栏，看叠标探出
    const bar = await page.evaluate(() => {
      const el = document.querySelector('.bottom-actions');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x: Math.max(0, r.x - 8),
        y: Math.max(0, r.y - 16),
        width: Math.min(390, r.width + 16),
        height: Math.min(100, r.height + 24)
      };
    });
    if (bar) await page.screenshot({ path: path.join(OUT, '01-gr-bar.png'), clip: bar });
    await page.locator('#btn-save-four-panel').screenshot({ path: path.join(OUT, '02-gr-four.png') });
    await page.locator('#btn-save-poster').screenshot({ path: path.join(OUT, '03-gr-poster.png') });

    // XStudio
    await page.goto(BASE + '/XStudio', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(1200);
    await guest(page);
    await page.evaluate(() => {
      try {
        if (typeof openPigmentModal === 'function') openPigmentModal();
      } catch (_e) {}
    });
    await page.waitForTimeout(900);
    await page.evaluate(() => {
      if (window.__xstudioRefreshMembership) window.__xstudioRefreshMembership();
    });
    await page.waitForTimeout(400);
    await hideFab(page);
    const xs = await page.evaluate(() => {
      function info(el) {
        if (!el) return null;
        const badge = el.querySelector('.membership-page-badge');
        if (!badge) return { hasBadge: false };
        const br = badge.getBoundingClientRect();
        const rr = el.getBoundingClientRect();
        return {
          hasBadge: true,
          text: (badge.textContent || '').trim(),
          protrudeTop: Math.round(rr.top - br.top),
          protrudeRight: Math.round(br.right - rr.right),
          rotate: (badge.style.transform || '').indexOf('rotate') >= 0,
          inline: /position:\s*static/i.test(badge.getAttribute('style') || '')
        };
      }
      return {
        importBtn: info(document.getElementById('modalImportBoxBtn')),
        chip: info(document.querySelector('#modalTabs .tab-chip.membership-locked')),
        share: info(document.getElementById('shareBoxInlineBtn'))
      };
    });
    report.meta.xstudio = xs;
    if (!xs.importBtn || !xs.importBtn.hasBadge) report.issues.push('晓色导入无标');
    if (!xs.chip || !xs.chip.hasBadge) report.issues.push('晓色芯片无标');
    if (xs.chip && xs.chip.inline) report.issues.push('晓色芯片仍是行内而非叠标');
    if (xs.importBtn && xs.importBtn.protrudeTop < 1 && xs.importBtn.protrudeRight < 1) {
      report.issues.push('晓色导入未探出');
    }
    // 芯片在横滑条内贴角内，不要求探出
    const tabsClip = await page.evaluate(() => {
      const el = document.getElementById('modalTabs');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x: Math.max(0, r.x - 4),
        y: Math.max(0, r.y - 14),
        width: Math.min(390, r.width + 8),
        height: Math.min(70, r.height + 22)
      };
    });
    if (tabsClip) await page.screenshot({ path: path.join(OUT, '04-xstudio-tabs.png'), clip: tabsClip });
    await page.locator('#modalImportBoxBtn').screenshot({ path: path.join(OUT, '05-import.png') });
    await page.screenshot({ path: path.join(OUT, '06-xstudio-modal.png'), fullPage: false });

    // AR
    await page.goto(BASE + '/ARSketch', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(1200);
    await guest(page);
    await page.evaluate(async () => {
      try {
        if (typeof toggleUI === 'function') toggleUI(true);
        const m = document.getElementById('btn-more');
        if (m) m.click();
      } catch (_e) {}
      if (window.MembershipAccess && window.MembershipAccess.ready) {
        try {
          await window.MembershipAccess.ready();
        } catch (_e) {}
      }
      if (window.MembershipAccess && window.MembershipAccess.notify) {
        window.MembershipAccess.notify();
      }
    });
    await page.waitForTimeout(500);
    await hideFab(page);
    const ar = await page.evaluate(() => {
      const label = document.querySelector('.ar-sketch-lock-host .label');
      const badge = label && label.querySelector('.membership-page-badge');
      if (!badge) return { hasBadge: false };
      const cs = getComputedStyle(badge);
      return {
        hasBadge: true,
        text: (badge.textContent || '').trim(),
        inline: cs.position === 'static',
        rotate: cs.transform !== 'none',
        coversLabel: false
      };
    });
    report.meta.ar = ar;
    if (!ar.hasBadge) report.issues.push('AR 无标');
    if (ar.hasBadge && !ar.inline) report.issues.push('AR 线稿短标应为行内紧挨文案');
    if (ar.hasBadge && ar.rotate) report.issues.push('AR 短标不应旋转');
    const controls = await page.evaluate(() => {
      const c = document.getElementById('controls');
      if (!c || getComputedStyle(c).display === 'none') return null;
      const r = c.getBoundingClientRect();
      return {
        x: Math.max(0, r.x),
        y: Math.max(0, r.y - 10),
        width: Math.min(390, r.width),
        height: Math.min(340, r.height + 16)
      };
    });
    if (controls) await page.screenshot({ path: path.join(OUT, '07-ar-controls.png'), clip: controls });

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
