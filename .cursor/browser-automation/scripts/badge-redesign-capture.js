/**
 * 角标重设计：强制露出控制条 / AR 面板后截图
 */
const path = require('path');
const fs = require('fs');
require('./_playwright-browsers-path.js');
const { chromium } = require('playwright');

const BASE = process.env.QA_BASE || 'http://127.0.0.1:18080';
const OUT = path.join(__dirname, '..', 'runs', 'badge-redesign-qa');
fs.mkdirSync(OUT, { recursive: true });

async function waitLoader(page) {
  for (let i = 0; i < 100; i++) {
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
      } catch (_e) {}
    }
    if (window.MembershipAccess && window.MembershipAccess.saveEntitlement) {
      window.MembershipAccess.saveEntitlement({ tierId: 'free', level: 'guest', source: 'qa' });
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
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const summary = {};

  // —— Solid atmos ——
  await page.goto(BASE + '/Solid?sandbox=geometry', {
    waitUntil: 'domcontentloaded',
    timeout: 120000
  });
  await waitLoader(page);
  await page.waitForTimeout(800);
  await guest(page);
  await page.evaluate(() => {
    const modal = document.getElementById('scene-grid-modal');
    if (modal) modal.style.display = 'none';
    const panel = document.getElementById('main-panel');
    if (panel) {
      panel.classList.remove('minimized');
      panel.style.setProperty('display', 'block', 'important');
      panel.style.setProperty('opacity', '1', 'important');
      panel.style.setProperty('visibility', 'visible', 'important');
      panel.style.setProperty('z-index', '5000', 'important');
      panel.style.setProperty('bottom', '16px', 'important');
    }
    if (typeof window.switchTab === 'function') window.switchTab('atmos');
    if (window.MembershipAccess && window.MembershipAccess.notify) {
      window.MembershipAccess.notify();
    }
  });
  await page.waitForTimeout(1000);
  await hideFab(page);
  const atmosMeta = await page.evaluate(() => {
    const panel = document.getElementById('main-panel');
    const fogBadge = document.querySelector('[data-mod-slot="fog-title"]');
    const dofBadge = document.querySelector('[data-mod-slot="dof-title"]');
    const pr = panel ? panel.getBoundingClientRect() : null;
    return {
      fog: fogBadge
        ? {
            text: fogBadge.textContent.trim(),
            insideLabel: !!fogBadge.closest('label'),
            fogText: (document.querySelector('[data-membership-mod="fog"]') || {}).innerText
          }
        : null,
      dof: dofBadge
        ? {
            text: dofBadge.textContent.trim(),
            insideLabel: !!dofBadge.closest('label')
          }
        : null,
      panel: pr
        ? { x: pr.x, y: pr.y, w: pr.width, h: pr.height }
        : null
    };
  });
  summary.atmos = atmosMeta;
  if (atmosMeta.panel && atmosMeta.panel.h > 40) {
    const p = atmosMeta.panel;
    await page.screenshot({
      path: path.join(OUT, '50-atmos-panel.png'),
      clip: {
        x: Math.max(0, Math.floor(p.x)),
        y: Math.max(0, Math.floor(p.y)),
        width: Math.min(390, Math.ceil(p.w)),
        height: Math.min(300, Math.ceil(p.h))
      }
    });
  }
  await page.screenshot({ path: path.join(OUT, '51-atmos-full.png'), fullPage: false });

  // —— XStudio ——
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
  await page.locator('#modalImportBoxBtn').screenshot({ path: path.join(OUT, '52-import.png') });
  await page.locator('#modalTabs .tab-chip.membership-locked').first().screenshot({
    path: path.join(OUT, '53-chip.png')
  });
  await page.screenshot({ path: path.join(OUT, '54-xstudio.png'), fullPage: false });

  // —— GR ——
  await page.goto(BASE + '/GR', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(1000);
  await guest(page);
  await page.waitForTimeout(400);
  await hideFab(page);
  await page.locator('#btn-save-four-panel').screenshot({ path: path.join(OUT, '55-gr-four.png') });
  await page.locator('#btn-save-poster').screenshot({ path: path.join(OUT, '56-gr-poster.png') });

  // —— AR ——
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
    const host = document.querySelector('.ar-sketch-lock-host');
    if (host && window.MembershipPaintHost && window.MembershipAccess) {
      const rid = window.MembershipAccess.uiResourceId('arsketch', 'ctrl:sketch');
      window.MembershipPaintHost.markLockedEl(host, rid, '线稿', { surface: 'dark' });
    }
  });
  await page.waitForTimeout(500);
  await hideFab(page);
  const arClip = await page.evaluate(() => {
    const row = document.getElementById('ar-sketch-mod-row');
    const host = document.querySelector('.ar-sketch-lock-host');
    const badge = host && host.querySelector('.membership-page-badge');
    const r = row ? row.getBoundingClientRect() : null;
    return {
      text: row ? row.innerText.replace(/\s+/g, ' ') : null,
      badge: badge ? badge.textContent.trim() : null,
      clip: r
        ? {
            x: Math.max(0, r.x - 6),
            y: Math.max(0, r.y - 6),
            width: Math.min(378, r.width + 12),
            height: Math.min(120, Math.max(40, r.height + 12))
          }
        : null
    };
  });
  summary.ar = arClip;
  if (arClip.clip) {
    await page.screenshot({ path: path.join(OUT, '57-ar-row.png'), clip: arClip.clip });
  }
  const controlsClip = await page.evaluate(() => {
    const c = document.getElementById('controls');
    if (!c || getComputedStyle(c).display === 'none') return null;
    const r = c.getBoundingClientRect();
    return {
      x: Math.max(0, r.x),
      y: Math.max(0, r.y),
      width: Math.min(390, r.width),
      height: Math.min(360, r.height)
    };
  });
  if (controlsClip && controlsClip.height > 40) {
    await page.screenshot({ path: path.join(OUT, '58-ar-controls.png'), clip: controlsClip });
  }

  fs.writeFileSync(path.join(OUT, 'capture-summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
