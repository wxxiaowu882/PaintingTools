/**
 * 运营台手机视口冒烟：Tab 吸顶可横滑、主操作区触控尺寸
 * 用法：SMOKE_BASE=https://test.wuxiaoart.com PLAYWRIGHT_CHANNEL=msedge node scripts/member-ops-mobile-qa.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
require('./_playwright-browsers-path');
const { chromium } = require('playwright');

const BASE = (process.env.SMOKE_BASE || 'http://127.0.0.1:18080').replace(/\/$/, '');
const OUT = path.join(__dirname, '..', 'runs', 'member-ops-mobile-' + Date.now());
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
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true
  });
  const report = { base: BASE, checks: [], ok: true, out: OUT };

  await page.goto(BASE + '/member-ops', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(600);

  // 露出 app 区以测 Tab（不依赖真实口令）
  await page.evaluate(() => {
    document.getElementById('sec-login').classList.add('hidden');
    document.getElementById('sec-app').classList.remove('hidden');
  });
  await page.waitForTimeout(200);

  const layout = await page.evaluate(() => {
    const tabs = document.getElementById('ops-tabs');
    const tcs = tabs ? getComputedStyle(tabs) : null;
    const tabBtns = Array.from(document.querySelectorAll('#ops-tabs .tab'));
    const first = tabBtns[0];
    const fr = first ? first.getBoundingClientRect() : null;
    const pwd = document.getElementById('ops-pwd');
    const gen = document.getElementById('btn-gen');
    const scroll = document.querySelector('.table-scroll');
    return {
      tabsPosition: tcs && tcs.position,
      tabsOverflowX: tcs && tcs.overflowX,
      tabsWrap: tcs && tcs.flexWrap,
      tabCount: tabBtns.length,
      tabH: fr && Math.round(fr.height),
      tabMinW: fr && Math.round(fr.width),
      inputFs: pwd ? parseFloat(getComputedStyle(pwd).fontSize) : 0,
      genW: gen ? Math.round(gen.getBoundingClientRect().width) : 0,
      viewportW: window.innerWidth,
      hasTableScroll: !!scroll
    };
  });

  check(report, 'tabs sticky', layout.tabsPosition === 'sticky', JSON.stringify(layout));
  check(report, 'tabs no wrap / scrollable', layout.tabsWrap === 'nowrap' && /auto|scroll/.test(layout.tabsOverflowX || ''), JSON.stringify(layout));
  check(report, 'tab touch height >= 40', layout.tabH >= 40, String(layout.tabH));
  check(report, 'input font >= 16 (no iOS zoom)', layout.inputFs >= 15.5, String(layout.inputFs));
  check(report, 'primary gen btn near full width', layout.genW >= layout.viewportW * 0.7, String(layout.genW + '/' + layout.viewportW));
  check(report, 'ledger table-scroll class', layout.hasTableScroll);

  // 注入假行：确认操作列不再用 .row 拉满宽叠高
  const rowProbe = await page.evaluate(() => {
    const tb = document.getElementById('ledger-tbody');
    if (!tb) return null;
    tb.innerHTML =
      '<tr><td><code>ABCDEFGHIJ</code></td><td>高级会员 · 三个月</td><td>2026-10-31 08:00</td>' +
      '<td><span class="pill warn">待兑换</span></td><td>—</td><td></td>' +
      '<td class="ops-cell-actions">' +
      '<button type="button" class="secondary">复制</button>' +
      '<button type="button" class="secondary">重置可再兑</button>' +
      '<button type="button" class="secondary">去兑换</button></td></tr>';
    const tr = tb.querySelector('tr');
    const cell = tb.querySelector('.ops-cell-actions');
    const btn = cell && cell.querySelector('button');
    const main = document.querySelector('main');
    return {
      trH: tr ? Math.round(tr.getBoundingClientRect().height) : 0,
      btnW: btn ? Math.round(btn.getBoundingClientRect().width) : 0,
      mainW: main ? Math.round(main.getBoundingClientRect().width) : 0,
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth
    };
  });
  check(report, 'ledger row height compact', rowProbe && rowProbe.trH > 0 && rowProbe.trH <= 72, JSON.stringify(rowProbe));
  check(report, 'ledger action btn not full-width', rowProbe && rowProbe.btnW > 0 && rowProbe.btnW < 160, JSON.stringify(rowProbe));
  check(report, 'page width within viewport', rowProbe && rowProbe.scrollW <= rowProbe.clientW + 2, JSON.stringify(rowProbe));

  await page.click('#ops-tabs .tab[data-tab="accounts"]');
  await page.waitForTimeout(400);
  const acctOn = await page.locator('#ops-tabs .tab[data-tab="accounts"].active').count();
  check(report, 'switch to accounts tab', acctOn === 1);
  const acctWidth = await page.evaluate(() => {
    const card = document.querySelector('[data-panel="accounts"] .card');
    return {
      cardW: card ? Math.round(card.getBoundingClientRect().width) : 0,
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth
    };
  });
  check(report, 'accounts panel within viewport', acctWidth.scrollW <= acctWidth.clientW + 2, JSON.stringify(acctWidth));

  await page.screenshot({ path: path.join(OUT, 'mobile-codes.png'), fullPage: false });
  await page.click('#ops-tabs .tab[data-tab="codes"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, 'mobile-tabs.png'), fullPage: false });

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
  console.log(report.ok ? 'ALL PASS' : 'HAS FAILURES');
  process.exit(report.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
