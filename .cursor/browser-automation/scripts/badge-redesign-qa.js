/**
 * 角标重设计验收：Solid 氛围紧挨文案 + 晓阶/晓色/AR 右上角描边短标
 */
const path = require('path');
const fs = require('fs');
require('./_playwright-browsers-path.js');
const { chromium } = require('playwright');

const BASE = process.env.QA_BASE || 'http://127.0.0.1:18080';
const OUT = path.join(__dirname, '..', 'runs', 'badge-redesign-qa');
fs.mkdirSync(OUT, { recursive: true });

async function waitLoader(page, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const vis = await page.evaluate(() => {
      const el = document.getElementById('scene-loader');
      if (!el) return false;
      const st = getComputedStyle(el);
      return st.display !== 'none' && Number(st.opacity) > 0.05;
    });
    if (!vis) return;
    await page.waitForTimeout(300);
  }
}

async function guest(page) {
  await page.evaluate(async () => {
    try {
      localStorage.removeItem('wuxiao_membership_entitlement_v1');
    } catch (_e) {}
    if (window.MembershipAccess && window.MembershipAccess.ready) {
      try {
        await window.MembershipAccess.ready();
      } catch (_eR) {}
    }
    if (window.MembershipAccess && window.MembershipAccess.saveEntitlement) {
      window.MembershipAccess.saveEntitlement({ tierId: 'free', level: 'guest', source: 'qa' });
    }
    if (window.MembershipAccess && window.MembershipAccess.notify) {
      window.MembershipAccess.notify();
    }
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
    // —— Solid atmos ——
    await page.goto(BASE + '/Solid?sandbox=geometry', {
      waitUntil: 'domcontentloaded',
      timeout: 120000
    });
    await waitLoader(page, 120000);
    await page.waitForTimeout(1000);
    await guest(page);
    await page.evaluate(() => {
      const modal = document.getElementById('scene-grid-modal');
      if (modal) modal.style.display = 'none';
      const panel = document.getElementById('main-panel');
      if (panel) {
        panel.classList.remove('minimized');
        panel.style.zIndex = '2000';
      }
      if (typeof window.switchTab === 'function') window.switchTab('atmos');
      if (window.MembershipAccess && window.MembershipAccess.notify) {
        window.MembershipAccess.notify();
      }
    });
    await page.waitForTimeout(900);
    const atmos = await page.evaluate(() => {
      function measure(slot) {
        const badge = document.querySelector(
          '.membership-mod-badge[data-mod-slot="' + slot + '"]'
        );
        if (!badge) return { slot, missing: true };
        const label = badge.closest('label') || badge.parentElement;
        const br = badge.getBoundingClientRect();
        const parent = label && label.parentElement;
        const pr = parent ? parent.getBoundingClientRect() : null;
        return {
          slot,
          text: (badge.textContent || '').trim(),
          insideLabel: !!badge.closest('label'),
          distToRowRight: pr ? Math.round(pr.right - br.right) : null,
          parentJustify: parent ? getComputedStyle(parent).justifyContent : null
        };
      }
      return { fog: measure('fog-title'), dof: measure('dof-title') };
    });
    report.meta.atmos = atmos;
    if (atmos.fog.missing || !atmos.fog.insideLabel) report.issues.push('fog 未挂进 label');
    if (atmos.dof.missing || !atmos.dof.insideLabel) report.issues.push('dof 未挂进 label');
    if (atmos.fog.distToRowRight != null && atmos.fog.distToRowRight < 40) {
      report.issues.push('fog 仍靠行最右 dist=' + atmos.fog.distToRowRight);
    }
    if (atmos.dof.distToRowRight != null && atmos.dof.distToRowRight < 40) {
      report.issues.push('dof 仍靠行最右 dist=' + atmos.dof.distToRowRight);
    }
    await page.screenshot({ path: path.join(OUT, '01-solid-atmos.png'), fullPage: false });

    // —— GR ——
    await page.goto(BASE + '/GR', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(1200);
    await guest(page);
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      if (window.MembershipAccess && window.MembershipAccess.notify) {
        window.MembershipAccess.notify();
      }
    });
    await page.waitForTimeout(400);
    const gr = await page.evaluate(() => {
      function info(id) {
        const btn = document.getElementById(id);
        if (!btn) return null;
        const badge = btn.querySelector('.membership-page-badge');
        const br = badge ? badge.getBoundingClientRect() : null;
        const rr = btn.getBoundingClientRect();
        return {
          text: badge ? (badge.textContent || '').trim() : null,
          hasBadge: !!badge,
          topDelta: br ? Math.round(br.top - rr.top) : null,
          rightDelta: br ? Math.round(rr.right - br.right) : null,
          opacity: getComputedStyle(btn).opacity
        };
      }
      return { four: info('btn-save-four-panel'), poster: info('btn-save-poster') };
    });
    report.meta.gr = gr;
    if (!gr.four || !gr.four.hasBadge) report.issues.push('晓阶 4联无角标');
    if (!gr.poster || !gr.poster.hasBadge) report.issues.push('晓阶 色阶图无角标');
    if (gr.four && Number(gr.four.opacity) < 0.9) report.issues.push('晓阶按钮被置灰');
    await page.evaluate(() => {
      document.querySelectorAll('button,div,span').forEach((el) => {
        if ((el.textContent || '').trim() === '权限涂色' && el.children.length <= 1) {
          el.style.display = 'none';
        }
      });
    });
    await page.locator('#btn-save-four-panel').screenshot({ path: path.join(OUT, '02-gr-four.png') });
    await page.locator('#btn-save-poster').screenshot({ path: path.join(OUT, '03-gr-poster.png') });
    await page.screenshot({ path: path.join(OUT, '04-gr-bottom.png'), fullPage: false });

    // —— XStudio ——
    await page.goto(BASE + '/XStudio', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(1500);
    await guest(page);
    await page.evaluate(() => {
      try {
        if (typeof openPigmentModal === 'function') openPigmentModal();
        else {
          const g = document.getElementById('configGearBtn');
          if (g) g.click();
        }
      } catch (_e) {}
    });
    await page.waitForTimeout(1000);
    await page.evaluate(() => {
      if (window.__xstudioRefreshMembership) window.__xstudioRefreshMembership();
      if (window.MembershipAccess && window.MembershipAccess.notify) {
        window.MembershipAccess.notify();
      }
    });
    await page.waitForTimeout(500);
    const xs = await page.evaluate(() => {
      const badges = Array.from(document.querySelectorAll('.membership-page-badge')).map((b) => ({
        text: (b.textContent || '').trim(),
        parent: (b.parentElement && (b.parentElement.className || b.parentElement.id || '')) || ''
      }));
      return { badges, count: badges.length };
    });
    report.meta.xstudio = xs;
    if (xs.count < 1) report.issues.push('晓色未见角标');
    await page.evaluate(() => {
      document.querySelectorAll('button,div,span').forEach((el) => {
        if ((el.textContent || '').trim() === '权限涂色' && el.children.length <= 1) {
          el.style.display = 'none';
        }
      });
    });
    const xsOverlap = await page.evaluate(() => {
      function overlapsText(btn) {
        if (!btn) return null;
        const badge = btn.querySelector('.membership-page-badge');
        if (!badge) return { hasBadge: false };
        const br = badge.getBoundingClientRect();
        // 粗检：角标应落在右上，左缘应大于按钮中线
        const rr = btn.getBoundingClientRect();
        const mid = rr.left + rr.width * 0.45;
        return {
          hasBadge: true,
          text: (badge.textContent || '').trim(),
          badgeLeftPastMid: br.left >= mid,
          rightDelta: Math.round(rr.right - br.right),
          pad: btn.getAttribute('data-membership-pad') === '1'
        };
      }
      return {
        importBtn: overlapsText(document.getElementById('modalImportBoxBtn')),
        chip: overlapsText(document.querySelector('#modalTabs .tab-chip.membership-locked'))
      };
    });
    report.meta.xstudioOverlap = xsOverlap;
    if (xsOverlap.importBtn && xsOverlap.importBtn.hasBadge && !xsOverlap.importBtn.badgeLeftPastMid) {
      report.issues.push('晓色导入角标可能压字');
    }
    if (xsOverlap.chip && xsOverlap.chip.hasBadge && !xsOverlap.chip.badgeLeftPastMid) {
      report.issues.push('晓色芯片角标可能压字');
    }
    const imp = page.locator('#modalImportBoxBtn');
    if (await imp.count()) await imp.screenshot({ path: path.join(OUT, '05b-xstudio-import.png') });
    const chip = page.locator('#modalTabs .tab-chip.membership-locked').first();
    if (await chip.count()) await chip.screenshot({ path: path.join(OUT, '05c-xstudio-chip.png') });
    await page.screenshot({ path: path.join(OUT, '05-xstudio-modal.png'), fullPage: false });

    // —— AR ——
    await page.goto(BASE + '/ARSketch', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(1200);
    await guest(page);
    await page.evaluate(async () => {
      try {
        if (typeof toggleUI === 'function') toggleUI(true);
        const more = document.getElementById('btn-more');
        if (more) more.click();
      } catch (_e) {}
      if (window.MembershipAccess && window.MembershipAccess.ready) {
        try {
          await window.MembershipAccess.ready();
        } catch (_eR) {}
      }
      if (window.MembershipAccess && window.MembershipAccess.notify) {
        window.MembershipAccess.notify();
      }
      // 强制再刷一次（更多面板展开后）
      const row = document.getElementById('ar-sketch-mod-row');
      const host = row && (row.querySelector('.ar-sketch-lock-host') || row.firstElementChild);
      if (host && window.MembershipPaintHost && window.MembershipAccess) {
        const rid = window.MembershipAccess.uiResourceId('arsketch', 'ctrl:sketch');
        window.MembershipPaintHost.markLockedEl(host, rid, '线稿', { surface: 'dark' });
      }
    });
    await page.waitForTimeout(600);
    // 藏涂色 FAB，避免挡角标
    await page.evaluate(() => {
      document.querySelectorAll('button,div,span').forEach((el) => {
        if ((el.textContent || '').trim() === '权限涂色' && el.children.length <= 1) {
          el.style.display = 'none';
        }
      });
    });
    const ar = await page.evaluate(() => {
      const host =
        document.querySelector('.ar-sketch-lock-host') ||
        document.getElementById('ar-sketch-mod-row');
      const badge = host && host.querySelector('.membership-page-badge');
      const br = badge ? badge.getBoundingClientRect() : null;
      const hr = host ? host.getBoundingClientRect() : null;
      return {
        text: badge ? (badge.textContent || '').trim() : null,
        hasBadge: !!badge,
        hostW: hr ? Math.round(hr.width) : null,
        rightDelta: br && hr ? Math.round(hr.right - br.right) : null
      };
    });
    report.meta.ar = ar;
    if (!ar.hasBadge) report.issues.push('AR 线稿无角标');
    const arBox = await page.evaluate(() => {
      const row = document.getElementById('ar-sketch-mod-row');
      if (!row) return null;
      const r = row.getBoundingClientRect();
      return {
        x: Math.max(0, r.x - 4),
        y: Math.max(0, r.y - 4),
        width: Math.min(380, r.width + 8),
        height: Math.min(100, Math.max(36, r.height + 8))
      };
    });
    if (arBox) {
      await page.screenshot({ path: path.join(OUT, '06-ar-row.png'), clip: arBox });
    }
    await page.screenshot({ path: path.join(OUT, '07-ar-panel.png'), fullPage: false });

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
