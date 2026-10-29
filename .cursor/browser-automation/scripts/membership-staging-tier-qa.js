/**
 * 测站三档验收：游客 → 注册会员 → 兑码高级会员
 * 用法：
 *   REDEEM_CODE=XXXXXXXXXX node scripts/membership-staging-tier-qa.js
 */
const path = require('path');
const fs = require('fs');
require('./_playwright-browsers-path.js');
const { chromium } = require('playwright');

const BASE = process.env.QA_BASE || 'https://test.wuxiaoart.com';
const CODE = String(process.env.REDEEM_CODE || '').trim().toUpperCase();
const OUT = path.join(__dirname, '..', 'runs', 'member-staging-tier-qa');
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

async function refreshEntitlement(page) {
  await page.evaluate(async () => {
    try {
      const MA = window.MembershipAccess;
      if (!MA) return;
      const r = await fetch('/api/membership/me', { credentials: 'same-origin', cache: 'no-cache' });
      const data = await r.json();
      if (data && data.entitlement && MA.saveEntitlement) MA.saveEntitlement(data.entitlement);
      else if (data && data.accessLevel === 'guest' && MA.saveEntitlement) {
        MA.saveEntitlement({ tierId: 'free', level: 'guest', expiresAt: null, source: 'me' });
      }
      if (MA.notify) MA.notify();
    } catch (_e) {}
  });
  await page.waitForTimeout(400);
}

async function openSolidGrid(page) {
  await page.goto(BASE + '/Solid?sandbox=geometry', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await waitLoaderGone(page, 120000);
  await page.waitForTimeout(1200);
  await refreshEntitlement(page);
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
  await page.waitForTimeout(1800);
  for (let i = 0; i < 20; i++) {
    const n = await page.evaluate(() => document.querySelectorAll('.membership-badge, .scene-item').length);
    if (n >= 1) break;
    await page.evaluate(() => {
      try {
        if (window.MembershipAccess && window.MembershipAccess.notify) window.MembershipAccess.notify();
      } catch (_e) {}
    });
    await page.waitForTimeout(400);
  }
}

async function badgeStats(page) {
  return page.evaluate(() => {
    const MA = window.MembershipAccess;
    const badges = Array.from(document.querySelectorAll('.membership-badge')).map((b) => {
      const strip = b.querySelector('.membership-badge-strip');
      return ((strip && strip.textContent) || b.textContent || '').trim();
    });
    return {
      level: MA && MA.getAccessLevel ? MA.getAccessLevel() : null,
      badgeCount: badges.length,
      memberCount: badges.filter((t) => t === '会员' || t === 'Member').length,
      proCount: badges.filter((t) => t === 'Pro').length
    };
  });
}

async function dismissUpgrade(page) {
  await page.evaluate(() => {
    const c = document.querySelector('.mu-cancel');
    if (c) c.click();
  });
  await page.waitForTimeout(300);
}

async function clickLockedByRequire(page, need) {
  await dismissUpgrade(page);
  return page.evaluate((need) => {
    const scenes = window.customScenes || [];
    const idx = scenes.findIndex((s) => {
      if (!s || !s.__membershipLocked) return false;
      const r = s.__require || (s.meta && s.meta.require) || '';
      return String(r) === need;
    });
    if (idx < 0) {
      // fallback: use badge text
      const want = need === 'user' ? '会员' : 'Pro';
      const cards = Array.from(document.querySelectorAll('.scene-item.membership-locked'));
      for (const el of cards) {
        const strip = el.querySelector('.membership-badge-strip');
        const t = ((strip && strip.textContent) || '').trim();
        if (t === want) {
          el.scrollIntoView({ block: 'center' });
          el.click();
          return { ok: true, via: 'badge', name: (el.innerText || '').split('\n')[0], require: need };
        }
      }
      return { ok: false, reason: 'not_found', need };
    }
    const card = document.querySelector('.scene-item[data-scene-index="' + idx + '"]');
    if (card) {
      card.scrollIntoView({ block: 'center' });
      card.click();
    } else if (typeof window.switchScene === 'function') {
      window.switchScene(idx);
    }
    return { ok: true, via: 'index', idx, name: scenes[idx].name, require: scenes[idx].__require || need };
  }, need);
}

async function readUpgrade(page) {
  await page.waitForTimeout(900);
  return page.evaluate(() => {
    const eye = document.querySelector('.mu-eyebrow');
    const title = document.querySelector('.mu-title');
    const body = document.querySelector('.mu-body');
    return {
      eye: eye ? eye.textContent.trim() : '',
      title: title ? title.textContent.trim() : '',
      body: body ? body.textContent.trim() : ''
    };
  });
}

(async () => {
  const report = { base: BASE, code: CODE ? CODE.slice(0, 2) + '********' : '', ok: true, issues: [], steps: [] };
  if (!CODE || CODE.length < 8) {
    console.error('需要 REDEEM_CODE');
    process.exit(2);
  }

  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  try {
    // —— 游客 ——
    await context.clearCookies();
    await page.goto(BASE + '/member', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.evaluate(() => {
      try { localStorage.removeItem('wuxiao_membership_entitlement_v1'); } catch (_e) {}
    });
    await openSolidGrid(page);
    const guestBadges = await badgeStats(page);
    report.steps.push({ name: 'guest-badges', ...guestBadges });
    if (guestBadges.level !== 'guest') report.issues.push('游客档 level=' + guestBadges.level);
    if (guestBadges.memberCount < 1) report.issues.push('游客未见「会员」角标');
    if (guestBadges.proCount < 1) report.issues.push('游客未见 Pro');
    await page.screenshot({ path: path.join(OUT, '01-guest-grid.png'), fullPage: false });

    const uClick = await clickLockedByRequire(page, 'user');
    const uUi = await readUpgrade(page);
    report.steps.push({ name: 'guest-member-prompt', uClick, uUi });
    if (!/会员免费/.test(uUi.eye + uUi.title)) {
      report.issues.push('游客点「会员」课弹窗不对: ' + JSON.stringify(uUi));
    }
    await page.screenshot({ path: path.join(OUT, '02-guest-member-prompt.png'), fullPage: false });
    await dismissUpgrade(page);

    const pClick = await clickLockedByRequire(page, 'member');
    const pUi = await readUpgrade(page);
    report.steps.push({ name: 'guest-pro-prompt', pClick, pUi });
    if (!/高级会员/.test(pUi.eye + pUi.title)) {
      report.issues.push('游客点 Pro 课弹窗不对: ' + JSON.stringify(pUi));
    }
    await page.screenshot({ path: path.join(OUT, '03-guest-pro-prompt.png'), fullPage: false });
    await dismissUpgrade(page);

    // —— 注册会员（测站用假手机号；11 位 1 开头）——
    const phone = '1' + String(Date.now()).slice(-10);
    const pass = 'Qa' + Math.random().toString(36).slice(2, 10) + '9';
    await page.goto(BASE + '/member#account', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(1000);
    const reg = await page.evaluate(async ({ phone, pass }) => {
      const deviceId = (window.MembershipAccess && window.MembershipAccess.getDeviceId)
        ? window.MembershipAccess.getDeviceId()
        : ('qa_' + Date.now());
      const r = await fetch('/api/membership/account/register', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phone, password: pass, deviceId: deviceId })
      });
      const data = await r.json().catch(() => ({}));
      return { status: r.status, data };
    }, { phone, pass });
    report.steps.push({
      name: 'register',
      ok: !!(reg.data && reg.data.ok),
      phone: phone.slice(0, 3) + '****' + phone.slice(-4),
      status: reg.status,
      err: reg.data && reg.data.error
    });
    if (!(reg.data && reg.data.ok)) {
      report.issues.push('注册失败: ' + JSON.stringify(reg.data));
    } else {
      await page.evaluate((ent) => {
        try {
          if (window.MembershipAccess && window.MembershipAccess.saveEntitlement) {
            window.MembershipAccess.saveEntitlement(ent);
          }
        } catch (_e) {}
      }, reg.data.entitlement || { level: 'user', accountId: true });
    }

    await openSolidGrid(page);
    const userBadges = await badgeStats(page);
    report.steps.push({ name: 'user-badges', ...userBadges });
    if (userBadges.level !== 'user') report.issues.push('注册后 level=' + userBadges.level);
    if (userBadges.memberCount > 0) report.issues.push('会员档仍见「会员」角标');
    if (userBadges.proCount < 1) report.issues.push('会员档未见 Pro 角标');
    await page.screenshot({ path: path.join(OUT, '04-user-grid.png'), fullPage: false });

    const userPro = await clickLockedByRequire(page, 'member');
    const userProUi = await readUpgrade(page);
    report.steps.push({ name: 'user-pro-prompt', userPro, userProUi });
    if (!/高级会员/.test(userProUi.eye + userProUi.title)) {
      report.issues.push('会员点 Pro 课弹窗不对: ' + JSON.stringify(userProUi));
    }
    await page.screenshot({ path: path.join(OUT, '05-user-pro-prompt.png'), fullPage: false });
    await dismissUpgrade(page);

    // —— 兑码高级 ——
    await page.goto(BASE + '/member#benefits', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(800);
    const redeem = await page.evaluate(async (code) => {
      const r = await fetch('/api/membership/redeem', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
      });
      const data = await r.json().catch(() => ({}));
      return { status: r.status, data };
    }, CODE);
    report.steps.push({
      name: 'redeem',
      ok: !!(redeem.data && redeem.data.ok),
      status: redeem.status,
      level: redeem.data && redeem.data.entitlement && redeem.data.entitlement.level,
      err: redeem.data && redeem.data.error
    });
    if (!(redeem.data && redeem.data.ok)) {
      report.issues.push('兑码失败: ' + JSON.stringify(redeem.data));
    } else {
      await page.evaluate((ent) => {
        try {
          if (window.MembershipAccess && window.MembershipAccess.saveEntitlement) {
            window.MembershipAccess.saveEntitlement(ent);
          }
        } catch (_e) {}
      }, redeem.data.entitlement || { level: 'member' });
    }

    await openSolidGrid(page);
    const memberBadges = await badgeStats(page);
    report.steps.push({ name: 'member-badges', ...memberBadges });
    if (memberBadges.level !== 'member') report.issues.push('兑码后 level=' + memberBadges.level);
    if (memberBadges.badgeCount > 0) report.issues.push('高级会员仍见角标 count=' + memberBadges.badgeCount);
    await page.screenshot({ path: path.join(OUT, '06-member-grid.png'), fullPage: false });

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
