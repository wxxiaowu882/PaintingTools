/**
 * 探针：晓阶保存钮角标是否挂上
 */
require('./_playwright-browsers-path.js');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(process.env.QA_BASE || 'http://127.0.0.1:18080/GR', {
    waitUntil: 'domcontentloaded',
    timeout: 60000
  });
  await page.waitForTimeout(1500);
  const info = await page.evaluate(async () => {
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
    await new Promise((r) => setTimeout(r, 500));
    function pack(btn, ridKey) {
      if (!btn) return null;
      const rid = window.MembershipAccess.featureResourceId('gr', ridKey);
      const gate = window.MembershipAccess.canAccess(rid);
      const badge = btn.querySelector('.membership-page-badge');
      const cs = getComputedStyle(btn);
      const pcs = btn.parentElement ? getComputedStyle(btn.parentElement) : null;
      const br = badge && badge.getBoundingClientRect();
      const rr = btn.getBoundingClientRect();
      return {
        rid,
        gateOk: gate.ok,
        need: gate.needLevel,
        require: gate.rule && gate.rule.require,
        hasBadge: !!badge,
        badgeText: badge && badge.textContent,
        badgeStyle: badge && badge.getAttribute('style'),
        overflow: cs.overflow,
        position: cs.position,
        parentOverflow: pcs && pcs.overflow,
        parentClass: btn.parentElement && btn.parentElement.className,
        visible: rr.width > 0 && rr.height > 0,
        btnTop: Math.round(rr.top),
        badgeTop: br ? Math.round(br.top) : null,
        clippedByAppShell:
          !!document.querySelector('.app-shell') &&
          getComputedStyle(document.querySelector('.app-shell')).overflow === 'hidden'
      };
    }
    const posterPane = document.getElementById('posterPane') || document.querySelector('#posterWindow')?.closest('.pane');
    return {
      level: window.MembershipAccess.getAccessLevel && window.MembershipAccess.getAccessLevel(),
      four: pack(document.getElementById('btn-save-four-panel'), 'saveFourPanel'),
      poster: pack(document.getElementById('btn-save-poster'), 'savePoster'),
      activeTab: (document.querySelector('.tab-btn.active') || {}).textContent || null,
      appShellOverflow: document.querySelector('.app-shell')
        ? getComputedStyle(document.querySelector('.app-shell')).overflow
        : null
    };
  });
  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
