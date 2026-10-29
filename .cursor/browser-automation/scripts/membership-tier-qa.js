/**
 * 测试站：三档门禁角标与拦截弹窗快速验收
 * 用法：node scripts/membership-tier-qa.js
 */
const path = require('path');
const fs = require('fs');
require('./_playwright-browsers-path.js');
const { chromium } = require('playwright');

const BASE = process.env.QA_BASE || 'https://test.wuxiaoart.com';
const OUT = path.join(__dirname, '..', 'runs', 'member-tier-qa');
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

(async () => {
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const report = { base: BASE, ok: true, steps: [] };

  try {
    await page.goto(BASE + '/Solid?sandbox=geometry', { waitUntil: 'domcontentloaded', timeout: 90000 });
    await waitLoaderGone(page, 90000);
    await page.waitForTimeout(2000);

    // 关掉可能挡住的渲染失败提示
    await page.evaluate(() => {
      document.querySelectorAll('button').forEach((b) => {
        const t = (b.textContent || '').trim();
        if (/关闭|知道了|稍后再说|确定/.test(t)) try { b.click(); } catch (_e) {}
      });
    });

    // 打开场景网格
    await page.evaluate(() => {
      const btn = document.getElementById('top-left-scene-btn');
      if (btn) btn.click();
      const modal = document.getElementById('scene-grid-modal');
      if (modal) modal.style.display = 'flex';
    });
    await page.waitForTimeout(1500);

    // 等门禁插件打角标
    let badges = [];
    for (let i = 0; i < 20; i++) {
      badges = await page.evaluate(() =>
        Array.from(document.querySelectorAll('.membership-badge')).map((b) => b.textContent.trim())
      );
      if (badges.length >= 2) break;
      // 触发一次 mark
      await page.evaluate(() => {
        try {
          window.dispatchEvent(new CustomEvent('membership:change', { detail: {} }));
        } catch (_e) {}
      });
      await page.waitForTimeout(400);
    }

    const lockedMeta = await page.evaluate(() => {
      const scenes = window.customScenes || [];
      return scenes
        .map((s, i) => ({
          i,
          name: s && s.name,
          locked: !!(s && (s.__membershipLocked || (s.meta && s.meta.locked))),
          require: (s && ((s.meta && s.meta.require) || s.__require)) || null
        }))
        .filter((x) => x.locked);
    });

    const access = await page.evaluate(() => {
      const MA = window.MembershipAccess;
      if (!MA) return null;
      return {
        level: MA.getAccessLevel && MA.getAccessLevel(),
        atmos: MA.canAccess(MA.tabResourceId('atmos')),
        env: MA.canAccess(MA.tabResourceId('env')),
        light: MA.canAccess(MA.tabResourceId('light'))
      };
    });

    report.steps.push({ name: 'badges', badges, lockedMeta, access });

    // 点一张会员免费探针（顶光）
    const userIdx = lockedMeta.find((x) => x.require === 'user');
    if (userIdx) {
      await page.evaluate((idx) => {
        if (typeof window.switchScene === 'function') window.switchScene(idx);
      }, userIdx.i);
      await page.waitForTimeout(800);
      const modalUser = await page.evaluate(() => {
        const m = document.getElementById('membership-upgrade-modal');
        if (!m || m.style.display === 'none') return null;
        return {
          display: m.style.display,
          eyebrow: (m.querySelector('.mu-eyebrow') && m.querySelector('.mu-eyebrow').textContent) || '',
          title: (m.querySelector('.mu-title') && m.querySelector('.mu-title').textContent) || '',
          ok: (m.querySelector('.mu-ok') && m.querySelector('.mu-ok').textContent) || ''
        };
      });
      report.steps.push({ name: 'click_user_probe', modal: modalUser });
      // 关弹窗
      await page.evaluate(() => {
        const c = document.querySelector('#membership-upgrade-modal .mu-cancel');
        if (c) c.click();
      });
      await page.waitForTimeout(300);
    }

    // 点高级会员探针
    const memIdx = lockedMeta.find((x) => x.require === 'member');
    if (memIdx) {
      await page.evaluate((idx) => {
        if (typeof window.switchScene === 'function') window.switchScene(idx);
      }, memIdx.i);
      await page.waitForTimeout(800);
      const modalMem = await page.evaluate(() => {
        const m = document.getElementById('membership-upgrade-modal');
        if (!m || m.style.display === 'none') return null;
        return {
          display: m.style.display,
          eyebrow: (m.querySelector('.mu-eyebrow') && m.querySelector('.mu-eyebrow').textContent) || '',
          title: (m.querySelector('.mu-title') && m.querySelector('.mu-title').textContent) || '',
          ok: (m.querySelector('.mu-ok') && m.querySelector('.mu-ok').textContent) || ''
        };
      });
      report.steps.push({ name: 'click_member_probe', modal: modalMem });
    }

    await page.screenshot({ path: path.join(OUT, 'solid-grid.png'), fullPage: false });

    // 断言
    const hasUserBadge = badges.some((b) => b.indexOf('会员') >= 0 || b.indexOf('Member') >= 0);
    const hasMemberBadge = badges.some((b) => b.indexOf('Pro') >= 0 || b.indexOf('高级会员') >= 0);
    const userModal = (report.steps.find((s) => s.name === 'click_user_probe') || {}).modal;
    const memberModal = (report.steps.find((s) => s.name === 'click_member_probe') || {}).modal;

    if (!access || access.level !== 'guest') {
      report.ok = false;
      report.error = 'accessLevel 应为 guest';
    } else if (!access.light || !access.light.ok) {
      report.ok = false;
      report.error = '主光 Tab 应对游客开放';
    } else if (access.atmos && access.atmos.ok) {
      report.ok = false;
      report.error = '氛围 Tab 应对游客锁定（会员探针）';
    } else if (access.env && access.env.ok) {
      report.ok = false;
      report.error = '环境光 Tab 应对游客锁定（高级会员）';
    } else if (lockedMeta.length < 2) {
      report.ok = false;
      report.error = '锁定场景不足 2';
    } else if (!hasUserBadge || !hasMemberBadge) {
      report.ok = false;
      report.error = '角标文案不全: ' + JSON.stringify(badges);
    } else if (!userModal || userModal.eyebrow.indexOf('会员免费') < 0) {
      report.ok = false;
      report.error = '会员探针弹窗不对: ' + JSON.stringify(userModal);
    } else if (!memberModal || memberModal.eyebrow.indexOf('高级会员') < 0) {
      report.ok = false;
      report.error = '高级会员探针弹窗不对: ' + JSON.stringify(memberModal);
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
