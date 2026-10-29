/**
 * 本地：会员角标美学验收截图（Solid 列表 / Portrait 画廊 / GR 按钮）
 * 用法：QA_BASE=http://127.0.0.1:18080 node scripts/membership-badge-aesthetics-qa.js
 */
const path = require('path');
const fs = require('fs');
require('./_playwright-browsers-path.js');
const { chromium } = require('playwright');

const BASE = process.env.QA_BASE || 'http://127.0.0.1:18080';
const OUT = path.join(__dirname, '..', 'runs', 'badge-aesthetics');
fs.mkdirSync(OUT, { recursive: true });

async function dismissOverlays(page) {
  await page.evaluate(() => {
    document.querySelectorAll('button').forEach((b) => {
      const t = (b.textContent || '').trim();
      if (/关闭|知道了|稍后再说|确定|跳过|开始学习|我知道了/.test(t)) {
        try { b.click(); } catch (_e) {}
      }
    });
    const guide = document.getElementById('solid-first-frame-hint') || document.querySelector('.solid-guide-overlay');
    if (guide) try { guide.style.display = 'none'; } catch (_e) {}
  });
}

async function waitLoaderGone(page, id, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const visible = await page.evaluate((eid) => {
      const el = document.getElementById(eid);
      if (!el) return false;
      if (el.classList && el.classList.contains('is-hidden')) return false;
      const st = getComputedStyle(el);
      return st.display !== 'none' && st.visibility !== 'hidden' && Number(st.opacity) > 0.05;
    }, id);
    if (!visible) return;
    await page.waitForTimeout(400);
  }
}

(async () => {
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true
  });
  const report = { base: BASE, ok: true, checks: [] };

  // —— 1) Solid 几何课表（手机宽）——
  {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2
    });
    await page.goto(BASE + '/Solid?sandbox=geometry&_v=badgeAes2', {
      waitUntil: 'domcontentloaded',
      timeout: 90000
    });
    await waitLoaderGone(page, 'scene-loader', 90000);
    await page.waitForTimeout(1500);
    await dismissOverlays(page);
    await page.evaluate(() => {
      const btn = document.getElementById('top-left-scene-btn');
      if (btn) btn.click();
      const modal = document.getElementById('scene-grid-modal');
      if (modal) modal.style.display = 'flex';
    });
    await page.waitForTimeout(1200);
    for (let i = 0; i < 25; i++) {
      const n = await page.evaluate(() => document.querySelectorAll('.membership-badge').length);
      if (n >= 1) break;
      await page.evaluate(() => {
        try { window.dispatchEvent(new CustomEvent('membership:change', { detail: {} })); } catch (_e) {}
      });
      await page.waitForTimeout(300);
    }
    const solidMeta = await page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('.scene-item')).slice(0, 8);
      return items.map((el) => {
        const badge = el.querySelector('.membership-badge');
        const rItem = el.getBoundingClientRect();
        let overflow = false;
        let text = '';
        if (badge) {
          text = (badge.textContent || '').trim();
          const rB = badge.getBoundingClientRect();
          overflow = rB.right > rItem.right + 1 || rB.bottom > rItem.bottom + 1 || rB.left < rItem.left - 1;
        }
        return {
          title: ((el.querySelector('.scene-title') || el.querySelector('.scene-name') || {}).textContent || '').trim().slice(0, 40),
          badge: text,
          overflow,
          itemOverflow: getComputedStyle(el).overflow
        };
      });
    });
    const shot1 = path.join(OUT, '01-solid-geometry-list-mobile.png');
    await page.locator('#scene-grid-modal').screenshot({ path: shot1 }).catch(async () => {
      await page.screenshot({ path: shot1, fullPage: false });
    });
    report.checks.push({ name: 'solid-list', meta: solidMeta, shot: shot1 });
    if (solidMeta.some((x) => x.overflow)) report.ok = false;
    if (solidMeta.some((x) => x.badge && !/^(会员|Member|Pro)$/.test(x.badge))) report.ok = false;

    // 模块按钮角标
    await page.evaluate(() => {
      const modal = document.getElementById('scene-grid-modal');
      if (modal) modal.style.display = 'none';
    });
    await page.waitForTimeout(400);
    const modMeta = await page.evaluate(() => {
      const hosts = [];
      document.querySelectorAll('.membership-badge, .membership-page-badge').forEach((b) => {
        const parent = b.parentElement;
        if (!parent) return;
        const op = getComputedStyle(parent).opacity;
        hosts.push({
          text: (b.textContent || '').trim(),
          parentOpacity: op,
          bg: getComputedStyle(b).backgroundColor,
          cls: b.className
        });
      });
      // 底部 tab / 模块旁
      const tabs = Array.from(document.querySelectorAll('[data-tab], .tab-btn, #control-panel button')).slice(0, 12);
      return {
        badges: hosts,
        sampleOpacity: tabs.map((t) => ({
          t: (t.textContent || '').trim().slice(0, 20),
          op: getComputedStyle(t).opacity,
          locked: t.classList.contains('membership-locked')
        }))
      };
    });
    const shot1b = path.join(OUT, '01b-solid-mods.png');
    await page.screenshot({ path: shot1b, fullPage: false });
    report.checks.push({ name: 'solid-mods', meta: modMeta, shot: shot1b });
    await page.close();
  }

  // —— 2) Portrait_c anatomy 画廊 ——
  {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2
    });
    await page.goto(BASE + '/Portrait_c?lib=anatomy&_v=badgeAes2', {
      waitUntil: 'domcontentloaded',
      timeout: 90000
    });
    await waitLoaderGone(page, 'loading-screen', 90000);
    await page.waitForTimeout(2000);
    // 打开课表
    await page.evaluate(() => {
      const btn = document.querySelector('.gallery-trigger-btn') || document.getElementById('gallery-trigger');
      if (btn) btn.click();
      const gal = document.getElementById('gallery-modal') || document.querySelector('.gallery-modal, #course-gallery');
      if (gal) {
        gal.style.display = 'flex';
        gal.style.opacity = '1';
        gal.classList && gal.classList.add('active', 'show');
      }
    });
    await page.waitForTimeout(1500);
    for (let i = 0; i < 20; i++) {
      const n = await page.evaluate(() => document.querySelectorAll('.membership-page-badge').length);
      if (n >= 1) break;
      await page.evaluate(() => {
        try { window.dispatchEvent(new CustomEvent('membership:change', { detail: {} })); } catch (_e) {}
      });
      await page.waitForTimeout(300);
    }
    const portMeta = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.course-card')).slice(0, 8).map((card) => {
        const info = card.querySelector('.course-info');
        const badge = card.querySelector('.membership-page-badge');
        const name = card.querySelector('.course-name');
        const meta = card.querySelector('.course-meta');
        let covers = false;
        let text = '';
        if (badge && name) {
          text = (badge.textContent || '').trim();
          const rb = badge.getBoundingClientRect();
          const rn = name.getBoundingClientRect();
          const rm = meta ? meta.getBoundingClientRect() : null;
          const overlap = (a, b) => !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
          covers = overlap(rb, rn) || (rm && overlap(rb, rm));
        }
        const padR = info ? getComputedStyle(info).paddingRight : '';
        const op = getComputedStyle(card).opacity;
        return { text, covers, padR, cardOpacity: op, name: name ? name.textContent.trim().slice(0, 30) : '' };
      });
    });
    const shot2 = path.join(OUT, '02-portrait-anatomy-gallery.png');
    await page.screenshot({ path: shot2, fullPage: false });
    report.checks.push({ name: 'portrait-gallery', meta: portMeta, shot: shot2 });
    if (portMeta.some((x) => x.covers)) report.ok = false;
    if (portMeta.some((x) => x.text && !/^(会员|Member|Pro)$/.test(x.text))) report.ok = false;
    if (portMeta.some((x) => x.cardOpacity && Number(x.cardOpacity) < 0.9 && x.text)) report.ok = false;
    await page.close();
  }

  // —— 3) GR 按钮角标 ——
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(BASE + '/GR?_v=badgeAes2', { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForTimeout(2500);
    const grMeta = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.membership-page-badge')).map((b) => {
        const p = b.parentElement;
        return {
          text: (b.textContent || '').trim(),
          parentOpacity: p ? getComputedStyle(p).opacity : '',
          bg: getComputedStyle(b).backgroundColor,
          top: getComputedStyle(b).top,
          right: getComputedStyle(b).right
        };
      });
    });
    const shot3 = path.join(OUT, '03-gr-buttons.png');
    await page.screenshot({ path: shot3, fullPage: false });
    report.checks.push({ name: 'gr-buttons', meta: grMeta, shot: shot3 });
    if (grMeta.some((x) => x.parentOpacity && Number(x.parentOpacity) < 0.9)) report.ok = false;
    await page.close();
  }

  // —— 4) 黑屏：菜单跳 Portrait_c 时 body 是否被设为透明 ——
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(BASE + '/Solid?sandbox=geometry&_v=badgeAes2b', {
      waitUntil: 'domcontentloaded',
      timeout: 90000
    });
    await waitLoaderGone(page, 'scene-loader', 60000);
    await page.waitForTimeout(800);
    const fadeCheck = await page.evaluate(() => {
      const fn = String(window.zoomAndNavigate || '');
      return {
        hasSkip: /Portrait_c/.test(fn) && /skipFade/.test(fn),
        fnLen: fn.length
      };
    });
    report.checks.push({ name: 'skip-fade', meta: fadeCheck });
    if (!fadeCheck.hasSkip) report.ok = false;
    await page.close();
  }

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
  process.exit(report.ok ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
