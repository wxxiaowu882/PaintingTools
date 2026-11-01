/**
 * 测站会员流程验收：密码文案、注册、登录、注销、兑换门禁
 * 用法：SMOKE_BASE=https://test.wuxiaoart.com PLAYWRIGHT_CHANNEL=msedge node scripts/member-flow-staging-qa.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
require('./_playwright-browsers-path');
const { chromium } = require('playwright');

const BASE = (process.env.SMOKE_BASE || 'https://test.wuxiaoart.com').replace(/\/$/, '');
const OUT = path.join(__dirname, '..', 'runs', 'member-flow-' + Date.now());
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
  const context = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const page = await context.newPage();
  const report = { base: BASE, checks: [], ok: true, out: OUT };
  const phone = '136' + String(Date.now()).slice(-8);
  const password = 'test12';
  const nick = '流程测';

  await page.goto(BASE + '/member', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => {
    const main = document.querySelector('#id-bar-main');
    const code = document.querySelector('#code');
    const callout = document.querySelector('#redeem-callout');
    const ma = window.MembershipAccess;
    return !!(ma && main && code && callout && /游客/.test(main.textContent || '') && code.disabled && !callout.hidden);
  }, { timeout: 20000 });

  const html = await page.content();
  check(report, 'no old password hint copy', !/好记的简单密码|安全密码|自行选择/.test(html));
  check(report, 'guest identity', ((await page.locator('#id-bar-main').textContent()) || '').trim() === '游客');
  check(report, 'guest redeem gated', await page.locator('#code').isDisabled());
  check(report, 'guest redeem callout visible', await page.locator('#redeem-callout').isVisible());

  await page.click('#mode-register');
  await page.waitForTimeout(300);
  check(report, 'register shows nick+confirm', await page.locator('#reg-only-fields').isVisible() && await page.locator('#pwd2-wrap').isVisible());
  check(report, 'register pwd autocomplete off', (await page.locator('#pwd').getAttribute('autocomplete')) === 'off');
  check(report, 'register pwd2 autocomplete off', (await page.locator('#pwd2').getAttribute('autocomplete')) === 'off');
  check(report, 'register phone autocomplete off', (await page.locator('#phone').getAttribute('autocomplete')) === 'off');
  check(report, 'register pwd starts readonly', await page.locator('#pwd').evaluate((el) => el.hasAttribute('readonly')));

  await page.click('#pwd');
  await page.waitForTimeout(100);
  check(report, 'register pwd unlock on focus', !(await page.locator('#pwd').evaluate((el) => el.hasAttribute('readonly'))));

  await page.fill('#display-name', nick);
  await page.fill('#phone', phone);
  await page.click('#pwd');
  await page.fill('#pwd', password);
  await page.click('#pwd2');
  await page.fill('#pwd2', password);
  await page.click('#btn-acct-submit');
  await page.waitForFunction(() => {
    const main = (document.querySelector('#id-bar-main') && document.querySelector('#id-bar-main').textContent) || '';
    return /会员/.test(main);
  }, { timeout: 25000 });
  await page.waitForFunction(() => {
    const t = ((document.querySelector('#acct-msg') && document.querySelector('#acct-msg').textContent) || '').trim();
    return t && t !== '注册中…';
  }, { timeout: 10000 }).catch(() => {});

  const afterRegMsg = ((await page.locator('#acct-msg').textContent()) || '').trim();
  const afterRegMain = ((await page.locator('#id-bar-main').textContent()) || '').trim();
  check(report, 'register success identity', afterRegMain === '会员' || /会员/.test(afterRegMain), afterRegMain + ' | ' + afterRegMsg);
  check(report, 'register no JSON parse error', !/Unexpected token|Not Found|is not valid JSON/i.test(afterRegMsg), afterRegMsg);
  check(report, 'logged-in redeem enabled', !(await page.locator('#code').isDisabled()));
  await page.screenshot({ path: path.join(OUT, '01-after-register.png'), fullPage: true });

  // logout
  const clearBtn = page.locator('#btn-clear');
  if (await clearBtn.isVisible().catch(() => false)) {
    await clearBtn.click();
    await page.waitForTimeout(800);
  } else {
    await page.evaluate(() => {
      try { localStorage.removeItem('wuxiao_membership_entitlement_v1'); } catch (_e) {}
      if (window.MembershipAccess && MembershipAccess.clearLocal) MembershipAccess.clearLocal();
      location.reload();
    });
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(1000);
  }
  const afterLogout = ((await page.locator('#id-bar-main').textContent()) || '').trim();
  check(report, 'logout back to guest', afterLogout === '游客', afterLogout);
  check(report, 'guest redeem gated again', await page.locator('#code').isDisabled());
  await page.screenshot({ path: path.join(OUT, '02-after-logout.png'), fullPage: true });

  // login
  await page.click('#mode-login');
  await page.waitForTimeout(200);
  await page.evaluate(() => { const m = document.getElementById('acct-msg'); if (m) m.textContent = ''; });
  await page.fill('#phone', phone);
  await page.fill('#pwd', password);
  await page.click('#btn-acct-submit');
  await page.waitForFunction(() => {
    const main = (document.querySelector('#id-bar-main') && document.querySelector('#id-bar-main').textContent) || '';
    return /会员/.test(main);
  }, { timeout: 25000 });
  const afterLoginMain = ((await page.locator('#id-bar-main').textContent()) || '').trim();
  const afterLoginMsg = ((await page.locator('#acct-msg').textContent()) || '').trim();
  check(report, 'login success identity', afterLoginMain === '会员' || /会员/.test(afterLoginMain), afterLoginMain + ' | ' + afterLoginMsg);
  check(report, 'login redeem enabled', !(await page.locator('#code').isDisabled()));
  await page.screenshot({ path: path.join(OUT, '03-after-login.png'), fullPage: true });

  // wrong password
  if (await clearBtn.isVisible().catch(() => false)) {
    await clearBtn.click();
    await page.waitForTimeout(800);
  }
  await page.waitForFunction(() => {
    const main = (document.querySelector('#id-bar-main') && document.querySelector('#id-bar-main').textContent) || '';
    return /游客/.test(main);
  }, { timeout: 10000 });
  await page.click('#mode-login');
  await page.evaluate(() => { const m = document.getElementById('acct-msg'); if (m) m.textContent = ''; });
  await page.fill('#phone', phone);
  await page.fill('#pwd', 'wrong99');
  await page.click('#btn-acct-submit');
  await page.waitForFunction(() => {
    const t = ((document.querySelector('#acct-msg') && document.querySelector('#acct-msg').textContent) || '').trim();
    return t && t !== '登录中…' && t !== '已注销本机状态';
  }, { timeout: 15000 });
  const badMsg = ((await page.locator('#acct-msg').textContent()) || '').trim();
  const stillGuest = /游客/.test(((await page.locator('#id-bar-main').textContent()) || '').trim());
  check(report, 'wrong password stays guest', stillGuest);
  check(report, 'wrong password friendly error', !!badMsg && !/Unexpected token|is not valid JSON|Not Found/i.test(badMsg), badMsg);
  await page.screenshot({ path: path.join(OUT, '04-wrong-password.png'), fullPage: true });

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
  console.log('\nreport:', path.join(OUT, 'report.json'));
  console.log(report.ok ? 'ALL PASS' : 'HAS FAILURES');
  process.exit(report.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
