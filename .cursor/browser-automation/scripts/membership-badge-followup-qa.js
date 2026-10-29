/**
 * 跟进验收：短标「会员」、Portrait 丝带、Solid 模块行内标、进公开课不误弹空气透视
 */
const path = require('path');
const fs = require('fs');
require('./_playwright-browsers-path.js');
const { chromium } = require('playwright');

const BASE = process.env.QA_BASE || 'http://127.0.0.1:18080';
const OUT = path.join(__dirname, '..', 'runs', 'member-badge-followup');
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
    await page.waitForTimeout(400);
  }
}

(async () => {
  const report = { base: BASE, ok: true, issues: [], steps: [] };
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); // phone-ish

  try {
    await page.goto(BASE + '/Solid?sandbox=geometry', { waitUntil: 'domcontentloaded', timeout: 120000 });
    await waitLoader(page, 120000);
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      try { localStorage.removeItem('wuxiao_membership_entitlement_v1'); } catch (_e) {}
      if (window.MembershipAccess && window.MembershipAccess.saveEntitlement) {
        window.MembershipAccess.saveEntitlement({ tierId: 'free', level: 'guest', source: 'qa' });
      }
      document.documentElement.classList.add('wuxiao-android-shell');
      document.documentElement.classList.add('solid-scene-list-v2');
      const btn = document.getElementById('top-left-scene-btn');
      if (btn) btn.click();
      const modal = document.getElementById('scene-grid-modal');
      if (modal) modal.style.display = 'flex';
    });
    await page.waitForTimeout(2000);

    const grid = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.scene-item'));
      const heights = items.slice(0, 8).map((el) => Math.round(el.getBoundingClientRect().height));
      const thumbs = items.slice(0, 8).map((el) => {
        const img = el.querySelector('.scene-thumb');
        const r = img ? img.getBoundingClientRect() : null;
        return r ? { w: Math.round(r.width), h: Math.round(r.height) } : null;
      });
      const strips = Array.from(document.querySelectorAll('.membership-badge-strip')).map((s) =>
        (s.textContent || '').trim()
      );
      return {
        itemCount: items.length,
        heights,
        thumbs,
        stripLabels: strips.slice(0, 12),
        hasMemberEn: strips.some((t) => t === 'Member'),
        hasVipCn: strips.some((t) => t === '会员'),
        hasPro: strips.some((t) => t === 'Pro'),
        thinRows: heights.filter((h) => h > 0 && h < 80).length
      };
    });
    report.steps.push({ name: 'android-shell-grid', ...grid });
    if (grid.thinRows > 0) report.issues.push('列表行偏窄: ' + JSON.stringify(grid.heights));
    if (grid.hasMemberEn) report.issues.push('仍出现英文 Member');
    if (!grid.hasVipCn) report.issues.push('未见短标「会员」');
    if (!grid.hasPro) report.issues.push('未见 Pro');
    await page.screenshot({ path: path.join(OUT, '01-solid-grid-phone.png'), fullPage: false });

    // 点公开课（无锁）：不应弹空气透视
    const publicClick = await page.evaluate(() => {
      const scenes = window.customScenes || [];
      const idx = scenes.findIndex((s) => s && !s.__membershipLocked);
      if (idx < 0) return { ok: false };
      const card = document.querySelector('.scene-item[data-scene-index="' + idx + '"]');
      if (card) card.click();
      else if (typeof window.switchScene === 'function') window.switchScene(idx);
      return { ok: true, name: scenes[idx].name };
    });
    await page.waitForTimeout(3500);
    const prompt = await page.evaluate(() => {
      const eye = document.querySelector('.mu-eyebrow');
      const title = document.querySelector('.mu-title');
      const modal = document.querySelector('.mu-title') && document.querySelector('.mu-title').closest('[style*="display: flex"],[style*="display:flex"]');
      const eyeT = eye ? eye.textContent.trim() : '';
      const titleT = title ? title.textContent.trim() : '';
      const visible = !!(eye && eye.offsetParent !== null);
      return { visible, eye: eyeT, title: titleT, bad: /空气透视/.test(eyeT + titleT) };
    });
    report.steps.push({ name: 'public-scene-no-fog-prompt', publicClick, prompt });
    if (prompt.visible && prompt.bad) report.issues.push('进公开课误弹空气透视: ' + JSON.stringify(prompt));
    await page.screenshot({ path: path.join(OUT, '02-after-public-scene.png'), fullPage: false });

    // 打开氛围 tab 看行内标（游客）
    await page.evaluate(() => {
      try {
        if (typeof window.switchTab === 'function') window.switchTab('atmos');
        else {
          const b = document.getElementById('btn-tab-atmos');
          if (b) b.click();
        }
        if (window.MembershipAccess && window.MembershipAccess.notify) window.MembershipAccess.notify();
      } catch (_e) {}
    });
    await page.waitForTimeout(800);
    const mods = await page.evaluate(() => {
      const slots = Array.from(document.querySelectorAll('.membership-mod-badge[data-mod-slot]')).map((b) => ({
        slot: b.getAttribute('data-mod-slot'),
        text: (b.textContent || '').trim()
      }));
      return { slots };
    });
    report.steps.push({ name: 'mod-inline-badges', ...mods });
    await page.screenshot({ path: path.join(OUT, '03-atmos-inline.png'), fullPage: false });

    // Portrait facial
    await page.goto(BASE + '/Portrait_c?lib=facial', { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForTimeout(2500);
    await page.evaluate(() => {
      try { localStorage.removeItem('wuxiao_membership_entitlement_v1'); } catch (_e) {}
      if (window.MembershipAccess && window.MembershipAccess.saveEntitlement) {
        window.MembershipAccess.saveEntitlement({ tierId: 'free', level: 'guest', source: 'qa' });
      }
      if (typeof window.openCourseGallery === 'function') window.openCourseGallery();
    });
    await page.waitForTimeout(2000);
    for (let i = 0; i < 10; i++) {
      const n = await page.evaluate(() => {
        try { if (window.__portraitRefreshMembership) window.__portraitRefreshMembership(); } catch (_e) {}
        return document.querySelectorAll('.membership-badge-strip').length;
      });
      if (n >= 1) break;
      await page.waitForTimeout(400);
    }
    const portrait = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('.course-card'));
      const borders = cards.slice(0, 3).map((c) => getComputedStyle(c).borderTopColor + '/' + getComputedStyle(c).borderTopWidth);
      const strips = Array.from(document.querySelectorAll('.membership-badge-strip')).map((s) =>
        (s.textContent || '').trim()
      );
      const overflow = cards.slice(0, 1).map((c) => getComputedStyle(c).overflow);
      return { strips, borders, overflow, hasMemberEn: strips.includes('Member') };
    });
    report.steps.push({ name: 'portrait-ribbon', ...portrait });
    if (portrait.hasMemberEn) report.issues.push('Portrait 仍 Member 英文');
    if (portrait.strips.length < 1) report.issues.push('Portrait 无丝带角标');
    await page.screenshot({ path: path.join(OUT, '04-portrait-facial.png'), fullPage: false });

    report.ok = report.issues.length === 0;
  } catch (e) {
    report.ok = false;
    report.issues.push(String(e && e.stack || e));
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.ok ? 0 : 1);
  }
})();
