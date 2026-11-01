/**
 * 菜单跳转：确认 zoomAndNavigate 不会在跳转前拆掉遮罩
 * 用法：SMOKE_BASE=https://test.wuxiaoart.com PLAYWRIGHT_CHANNEL=msedge node scripts/menu-nav-no-flash-qa.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
require('./_playwright-browsers-path');
const { chromium } = require('playwright');

const BASE = (process.env.SMOKE_BASE || 'http://127.0.0.1:18080').replace(/\/$/, '');
const OUT = path.join(__dirname, '..', 'runs', 'menu-no-flash-' + Date.now());
fs.mkdirSync(OUT, { recursive: true });

function check(report, name, pass, detail) {
  report.checks.push({ name, pass: !!pass, detail: detail || '' });
  if (!pass) report.ok = false;
  console.log((pass ? 'OK  ' : 'FAIL') + ' ' + name + (detail ? ' — ' + detail : ''));
}

async function main() {
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const report = { base: BASE, checks: [], ok: true, out: OUT };

  await page.goto(BASE + '/Solid?sandbox=portrait#menu', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForSelector('#global-menu-overlay.active', { timeout: 60000 });
  await page.waitForTimeout(800);

  const probe = await page.evaluate(() => {
    const src = String(window.zoomAndNavigate || '');
    return {
      hasFn: typeof window.zoomAndNavigate === 'function',
      removesActiveBeforeNav: /classList\.remove\(['"]active['"]\)/.test(src),
      keepsCoverComment: /不要先拆掉菜单遮罩/.test(src)
    };
  });
  check(report, 'zoomAndNavigate exists', probe.hasFn);
  check(report, 'no longer removes overlay active before nav', !probe.removesActiveBeforeNav, JSON.stringify(probe));
  check(report, 'has anti-flash comment', probe.keepsCoverComment);

  // 右上角进会员仍带 #menu 返回
  await page.locator('#pt-id-chrome').click({ force: true });
  await page.waitForURL(/\/member/, { timeout: 30000, waitUntil: 'domcontentloaded' });
  const ret = new URL(page.url()).searchParams.get('return') || '';
  check(report, 'identity return still #menu', /#menu$/.test(ret), ret);

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
  console.log(report.ok ? 'ALL PASS' : 'HAS FAILURES');
  process.exit(report.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
