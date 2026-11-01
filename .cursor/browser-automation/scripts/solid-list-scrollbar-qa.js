/**
 * Solid 课表：移动端隐藏滚动条，PC 仍有细条
 * 用法：SMOKE_BASE=https://test.wuxiaoart.com PLAYWRIGHT_CHANNEL=msedge node scripts/solid-list-scrollbar-qa.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
require('./_playwright-browsers-path');
const { chromium } = require('playwright');

const BASE = (process.env.SMOKE_BASE || 'http://127.0.0.1:18080').replace(/\/$/, '');

function check(report, name, pass, detail) {
  report.checks.push({ name, pass: !!pass, detail: detail || '' });
  if (!pass) report.ok = false;
  console.log((pass ? 'OK  ' : 'FAIL') + ' ' + name + (detail ? ' — ' + detail : ''));
}

async function openPortraitList(page) {
  await page.goto(BASE + '/Solid?sandbox=portrait', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForSelector('#scene-grid-modal', { timeout: 60000 });
  await page.waitForFunction(() => {
    const m = document.getElementById('scene-grid-modal');
    const g = document.getElementById('scene-grid-container');
    return !!(m && getComputedStyle(m).display === 'flex' && g && g.children.length > 3);
  }, { timeout: 60000 });
}

async function scrollbarProbe(page) {
  return page.evaluate(() => {
    const g = document.getElementById('scene-grid-container');
    if (!g) return null;
    const cs = getComputedStyle(g);
    // webkit scrollbar pseudo may be empty; use overflow + scrollbar-width + client/offset
    const gap = g.offsetWidth - g.clientWidth;
    return {
      scrollbarWidth: cs.scrollbarWidth || '',
      msOverflowStyle: cs.msOverflowStyle || '',
      overflowY: cs.overflowY,
      canScroll: g.scrollHeight > g.clientHeight + 8,
      classicBarGap: gap,
      innerW: window.innerWidth
    };
  });
}

async function main() {
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true
  });
  const report = { base: BASE, checks: [], ok: true };

  const mob = await browser.newPage({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true
  });
  await openPortraitList(mob);
  const m = await scrollbarProbe(mob);
  check(report, 'mobile scrollbar-width none', m && m.scrollbarWidth === 'none', JSON.stringify(m));
  check(report, 'mobile still scrollable', m && m.canScroll, JSON.stringify(m));
  check(report, 'mobile no classic bar gap', m && m.classicBarGap <= 1, String(m && m.classicBarGap));
  await mob.close();

  const pc = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await openPortraitList(pc);
  const p = await scrollbarProbe(pc);
  check(report, 'pc scrollbar-width thin', p && p.scrollbarWidth === 'thin', JSON.stringify(p));
  check(report, 'pc still scrollable', p && p.canScroll, JSON.stringify(p));
  await pc.close();

  await browser.close();
  console.log(report.ok ? 'ALL PASS' : 'HAS FAILURES');
  process.exit(report.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
