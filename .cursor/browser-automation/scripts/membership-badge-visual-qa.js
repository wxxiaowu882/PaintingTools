/**
 * 本地游客态：Solid 课表丝带 + Portrait 列表角标 截图验收
 * 用法：先 npm run serve:repo，再 node scripts/membership-badge-visual-qa.js
 */
const path = require('path');
const fs = require('fs');
require('./_playwright-browsers-path.js');
const { chromium } = require('playwright');

const PORT = process.env.PORT || '18080';
const BASE = process.env.QA_BASE || `http://127.0.0.1:${PORT}`;
const OUT = path.join(__dirname, '..', 'runs', 'member-badge-visual');
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
    await page.waitForTimeout(400);
  }
}

async function forceGuest(page) {
  await page.evaluate(() => {
    try {
      localStorage.removeItem('wuxiao_membership_entitlement_v1');
    } catch (_e) {}
    const MA = window.MembershipAccess;
    if (MA && MA.saveEntitlement) {
      MA.saveEntitlement({ tierId: 'free', level: 'guest', expiresAt: null, source: 'qa' });
    }
  });
}

(async () => {
  const report = { base: BASE, ok: true, steps: [], issues: [] };
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  try {
    // —— Solid geometry 课表 ——
    await page.goto(BASE + '/Solid?sandbox=geometry', { waitUntil: 'domcontentloaded', timeout: 120000 });
    await waitLoaderGone(page, 120000);
    await page.waitForTimeout(2000);
    await forceGuest(page);
    await page.waitForTimeout(500);

    await page.evaluate(() => {
      document.querySelectorAll('button').forEach((b) => {
        const t = (b.textContent || '').trim();
        if (/关闭|知道了|稍后再说|确定/.test(t)) try { b.click(); } catch (_e) {}
      });
      const btn = document.getElementById('top-left-scene-btn');
      if (btn) btn.click();
      const modal = document.getElementById('scene-grid-modal');
      if (modal) modal.style.display = 'flex';
    });
    await page.waitForTimeout(1500);

    // 触发 mark
    for (let i = 0; i < 15; i++) {
      const n = await page.evaluate(() => {
        try {
          if (window.MembershipAccess && window.MembershipAccess.notify) {
            window.MembershipAccess.notify();
          }
        } catch (_e) {}
        return document.querySelectorAll('.membership-badge').length;
      });
      if (n >= 2) break;
      await page.waitForTimeout(400);
    }

    const solidInfo = await page.evaluate(() => {
      const MA = window.MembershipAccess;
      const badges = Array.from(document.querySelectorAll('.membership-badge')).map((b) => {
        const strip = b.querySelector('.membership-badge-strip');
        const host = b.closest('.scene-item');
        const st = getComputedStyle(host || b);
        const bst = getComputedStyle(b);
        const rect = b.getBoundingClientRect();
        const hrect = host ? host.getBoundingClientRect() : null;
        return {
          text: ((strip && strip.textContent) || b.textContent || '').trim(),
          title: b.title || '',
          hostOpacity: st.opacity,
          badgeOverflowParent: bst.overflow,
          outsideHost: hrect
            ? rect.right > hrect.right + 1 ||
              rect.bottom > hrect.bottom + 1 ||
              rect.left < hrect.left - 1 ||
              rect.top < hrect.top - 1
            : null,
          sceneName: host && host.querySelector('.scene-name')
            ? (host.querySelector('.scene-name').textContent || '').trim()
            : ''
        };
      });
      return {
        level: MA && MA.getAccessLevel ? MA.getAccessLevel() : null,
        badgeCount: badges.length,
        labels: badges.map((b) => b.text),
        memberCount: badges.filter((b) => b.text === '会员' || b.text === 'Member').length,
        proCount: badges.filter((b) => b.text === 'Pro').length,
        greyHosts: badges.filter((b) => Number(b.hostOpacity) < 0.95).length,
        outside: badges.filter((b) => b.outsideHost).length,
        samples: badges.slice(0, 8)
      };
    });
    report.steps.push({ name: 'solid-grid', ...solidInfo });
    if (solidInfo.level !== 'guest') report.issues.push('Solid 非游客档: ' + solidInfo.level);
    if (solidInfo.memberCount < 1) report.issues.push('Solid 未见「会员」丝带');
    if (solidInfo.proCount < 1) report.issues.push('Solid 未见 Pro 丝带');
    if (solidInfo.greyHosts > 0) report.issues.push('Solid 有宿主被置灰 opacity');
    if (solidInfo.outside > 0) report.issues.push('Solid 丝带可能溢出卡片: ' + solidInfo.outside);

    const solidShot = path.join(OUT, 'solid-geometry-grid.png');
    await page.locator('#scene-grid-modal').screenshot({ path: solidShot }).catch(async () => {
      await page.screenshot({ path: solidShot, fullPage: false });
    });
    report.steps.push({ shot: solidShot });

    // 点一张锁课看弹窗文案（不要求进景）
    const clickLocked = await page.evaluate(() => {
      const locked = document.querySelector('.scene-item.membership-locked');
      if (!locked) return { ok: false, reason: 'no_locked' };
      locked.click();
      return { ok: true, name: (locked.querySelector('.scene-name') || {}).textContent || '' };
    });
    await page.waitForTimeout(800);
    const upgradeUi = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('div,dialog,section')).filter((el) => {
        const t = (el.textContent || '');
        return /会员免费|高级会员|前往会员|登录|注册/.test(t) && el.offsetParent !== null;
      });
      const top = els.sort((a, b) => (b.innerText || '').length - (a.innerText || '').length)[0];
      return {
        found: !!top,
        snippet: top ? String(top.innerText || '').slice(0, 240) : ''
      };
    });
    report.steps.push({ name: 'upgrade-prompt', clickLocked, upgradeUi });
    const upShot = path.join(OUT, 'solid-upgrade-prompt.png');
    await page.screenshot({ path: upShot, fullPage: false });
    report.steps.push({ shot: upShot });

    // 点 Member 锁课：弹窗应是「会员免费」而非高级
    await page.evaluate(() => {
      try {
        const el = document.querySelector('.membership-upgrade-root, #membership-upgrade-modal, .mu-title');
        const root = document.querySelector('[class*="membership-upgrade"], .mu-cancel');
        if (root) {
          const cancel = document.querySelector('.mu-cancel');
          if (cancel) cancel.click();
        }
      } catch (_e) {}
    });
    await page.waitForTimeout(400);
    const memberPrompt = await page.evaluate(() => {
      const scenes = window.customScenes || [];
      const idx = scenes.findIndex(
        (s) => s && s.__membershipLocked && (s.__require === 'user' || (s.meta && s.meta.require === 'user'))
      );
      if (idx < 0) return { ok: false, reason: 'no_user_locked' };
      const card = document.querySelector('.scene-item[data-scene-index="' + idx + '"]');
      if (card) card.click();
      else if (typeof window.switchScene === 'function') window.switchScene(idx);
      return { ok: true, idx: idx, name: scenes[idx].name, require: scenes[idx].__require };
    });
    await page.waitForTimeout(900);
    const memberUi = await page.evaluate(() => {
      const eye = document.querySelector('.mu-eyebrow');
      const title = document.querySelector('.mu-title');
      return {
        eye: eye ? eye.textContent.trim() : '',
        title: title ? title.textContent.trim() : ''
      };
    });
    report.steps.push({ name: 'member-upgrade-prompt', memberPrompt, memberUi });
    if (!/会员免费/.test(memberUi.eye + memberUi.title)) {
      report.issues.push('Member 锁课弹窗文案不对: ' + JSON.stringify(memberUi));
    }
    const memberShot = path.join(OUT, 'solid-member-upgrade.png');
    await page.screenshot({ path: memberShot, fullPage: false });
    report.steps.push({ shot: memberShot });

    // 裁切 Member / Pro 卡片供视觉验收
    const crops = await page.evaluate(() => {
      const out = [];
      const items = Array.from(document.querySelectorAll('.scene-item.membership-locked'));
      for (const el of items) {
        const strip = el.querySelector('.membership-badge-strip');
        const t = ((strip && strip.textContent) || '').trim();
        if ((t === '会员' || t === 'Member' || t === 'Pro') && !out.some((o) => o.text === t)) {
          const r = el.getBoundingClientRect();
          out.push({ text: t, x: r.x, y: r.y, w: r.width, h: r.height });
        }
        if (out.length >= 2) break;
      }
      return out;
    });
    for (const it of crops) {
      const p = path.join(OUT, 'crop-' + it.text + '.png');
      await page.screenshot({
        path: p,
        clip: {
          x: Math.max(0, it.x),
          y: Math.max(0, it.y),
          width: Math.min(Math.max(it.w, 1), 560),
          height: Math.min(Math.max(it.h, 1), 240)
        }
      });
      report.steps.push({ shot: p, crop: it.text });
    }

    // —— Portrait_c facial（策略里有锁课）；anatomy 默认多公开，不作为角标主验收 ——
    await page.goto(BASE + '/Portrait_c?lib=facial', { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForTimeout(3500);
    await forceGuest(page);
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      if (typeof window.openCourseGallery === 'function') window.openCourseGallery();
    });
    await page.waitForTimeout(1500);
    for (let i = 0; i < 12; i++) {
      const n = await page.evaluate(() => document.querySelectorAll('.membership-page-badge').length);
      if (n >= 1) break;
      await page.evaluate(() => {
        try {
          if (window.__portraitRefreshMembership) window.__portraitRefreshMembership();
          if (window.MembershipAccess && window.MembershipAccess.notify) window.MembershipAccess.notify();
        } catch (_e) {}
      });
      await page.waitForTimeout(400);
    }

    const portraitInfo = await page.evaluate(() => {
      const badges = Array.from(document.querySelectorAll('.membership-page-badge')).map((b) => {
        const mount = b.parentElement;
        const titleEl = mount && mount.querySelector ? mount.querySelector('.course-name') : null;
        const br = b.getBoundingClientRect();
        const tr = titleEl ? titleEl.getBoundingClientRect() : null;
        const overlapTitle =
          tr &&
          !(br.right < tr.left || br.left > tr.right || br.bottom < tr.top || br.top > tr.bottom);
        const hop = mount ? getComputedStyle(mount).opacity : '1';
        const card = b.closest('.course-card');
        const cardOp = card ? getComputedStyle(card).opacity : '1';
        return {
          text: (b.textContent || '').trim(),
          title: b.title || '',
          hostOpacity: cardOp,
          infoOpacity: hop,
          overlapTitle: !!overlapTitle,
          inInfo: !!(mount && mount.classList && mount.classList.contains('course-info'))
        };
      });
      return {
        level: window.MembershipAccess && window.MembershipAccess.getAccessLevel
          ? window.MembershipAccess.getAccessLevel()
          : null,
        badgeCount: badges.length,
        labels: badges.map((b) => b.text),
        memberCount: badges.filter((b) => b.text === '会员' || b.text === 'Member').length,
        proCount: badges.filter((b) => b.text === 'Pro').length,
        greyHosts: badges.filter((b) => Number(b.hostOpacity) < 0.95).length,
        overlapTitle: badges.filter((b) => b.overlapTitle).length,
        samples: badges.slice(0, 8)
      };
    });
    report.steps.push({ name: 'portrait-facial-list', ...portraitInfo });
    if (portraitInfo.badgeCount < 1) report.issues.push('Portrait facial 无角标');
    if (portraitInfo.memberCount < 1 && portraitInfo.proCount < 1) {
      report.issues.push('Portrait facial 角标文案不是 会员/Pro');
    }
    if (portraitInfo.greyHosts > 0) report.issues.push('Portrait 有宿主置灰');
    if (portraitInfo.overlapTitle > 0) report.issues.push('Portrait 角标可能压住标题');

    const pShot = path.join(OUT, 'portrait-facial-list.png');
    await page.screenshot({ path: pShot, fullPage: false });
    report.steps.push({ shot: pShot });

    report.ok = report.issues.length === 0;
  } catch (e) {
    report.ok = false;
    report.issues.push(String(e && e.stack || e));
  } finally {
    await browser.close();
    const reportPath = path.join(OUT, 'report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8');
    console.log(JSON.stringify(report, null, 2));
    console.log('REPORT', reportPath);
    process.exit(report.ok ? 0 : 1);
  }
})();
