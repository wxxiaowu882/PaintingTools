/**
 * 菜单右上角身份条：PC 字号略增；进会员返回 #menu
 * 用法：SMOKE_BASE=http://127.0.0.1:18080 PLAYWRIGHT_CHANNEL=msedge node scripts/identity-chrome-menu-return-qa.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
require('./_playwright-browsers-path');
const { chromium } = require('playwright');

const BASE = (process.env.SMOKE_BASE || 'http://127.0.0.1:18080').replace(/\/$/, '');
const OUT = path.join(__dirname, '..', 'runs', 'id-chrome-' + Date.now());
fs.mkdirSync(OUT, { recursive: true });

function check(report, name, pass, detail) {
  report.checks.push({ name, pass: !!pass, detail: detail || '' });
  if (!pass) report.ok = false;
  console.log((pass ? 'OK  ' : 'FAIL') + ' ' + name + (detail ? ' — ' + detail : ''));
}

async function openMenu(page) {
  await page.evaluate(() => {
    if (window.location.hash !== '#menu') {
      history.pushState({ menu: true }, '', '#menu');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    }
    if (typeof window.toggleMenu === 'function' && !document.getElementById('global-menu-overlay')?.classList.contains('active')) {
      try { window.toggleMenu(); } catch (_e) {}
    }
  });
  await page.waitForFunction(() => {
    const go = document.getElementById('global-menu-overlay');
    return !!(go && go.classList.contains('active') && document.getElementById('pt-id-chrome'));
  }, { timeout: 45000 });
}

async function main() {
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true
  });
  const report = { base: BASE, checks: [], ok: true, out: OUT };

  // --- PC font ---
  const pc = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await pc.goto(BASE + '/Solid?sandbox=portrait', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await pc.waitForTimeout(2500);
  await openMenu(pc);
  await pc.waitForTimeout(600);
  const pcFs = await pc.locator('#pt-id-chrome').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  check(report, 'PC identity font ~13px', pcFs >= 12.5 && pcFs <= 14, String(pcFs));
  await pc.screenshot({ path: path.join(OUT, 'pc-menu-identity.png') });

  // 点身份条 → 会员页（zoomAndNavigate 有淡出延迟；用 commit 避免 load 卡住）
  await pc.locator('#pt-id-chrome').click({ force: true });
  await pc.waitForURL(/\/member/, { timeout: 30000, waitUntil: 'domcontentloaded' });
  await pc.waitForTimeout(500);
  const memberUrl = pc.url();
  const ret = new URL(memberUrl).searchParams.get('return') || '';
  check(report, 'return param points to #menu', /#menu$/.test(ret), ret);
  check(report, 'return keeps underlay path', /Solid|sandbox=portrait/i.test(ret), ret);

  await pc.locator('#btn-back').click();
  await pc.waitForURL(/Solid.*#menu|#menu/, { timeout: 45000, waitUntil: 'domcontentloaded' });
  const backUrl = pc.url();
  check(report, 'back lands on #menu', /#menu/.test(backUrl), backUrl);
  check(report, 'back not bare Solid without menu', !/\/Solid[^#]*$/.test(backUrl.replace(/\/$/, '')), backUrl);
  // Solid 冷启动较慢：等菜单 DOM + hash 同步
  await pc.waitForFunction(() => {
    const go = document.getElementById('global-menu-overlay');
    return !!(go && go.classList.contains('active') && location.hash === '#menu');
  }, { timeout: 60000 });
  const menuActive = await pc.locator('#global-menu-overlay.active').count();
  check(report, 'menu overlay active after back', menuActive >= 1, String(menuActive));
  await pc.screenshot({ path: path.join(OUT, 'pc-after-back.png') });
  await pc.close();

  // --- mobile font unchanged ---
  const mob = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mob.goto(BASE + '/Solid?sandbox=portrait', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await mob.waitForTimeout(2500);
  await openMenu(mob);
  await mob.waitForTimeout(600);
  const mobFs = await mob.locator('#pt-id-chrome').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  check(report, 'mobile identity font ~11px', mobFs >= 10.5 && mobFs <= 11.5, String(mobFs));
  await mob.screenshot({ path: path.join(OUT, 'mobile-menu-identity.png') });
  await mob.close();

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
  console.log(report.ok ? 'ALL PASS' : 'HAS FAILURES');
  process.exit(report.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
