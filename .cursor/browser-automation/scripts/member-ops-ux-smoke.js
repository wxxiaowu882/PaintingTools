/**
 * 会员页 / 运营台 UX 冒烟（静态结构 + 交互）
 * 用法：SMOKE_BASE=http://127.0.0.1:18080 PLAYWRIGHT_CHANNEL=msedge node scripts/member-ops-ux-smoke.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
require('./_playwright-browsers-path');
const { chromium } = require('playwright');

const BASE = (process.env.SMOKE_BASE || 'http://127.0.0.1:18080').replace(/\/$/, '');
const OUT = path.join(__dirname, '..', 'runs', 'member-ops-ux-' + new Date().toISOString().slice(0, 10));
fs.mkdirSync(OUT, { recursive: true });

async function main() {
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true
  });
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const report = { base: BASE, checks: [], ok: true };

  function check(name, pass, detail) {
    report.checks.push({ name, pass: !!pass, detail: detail || '' });
    if (!pass) report.ok = false;
  }

  // --- member ---
  await page.goto(BASE + '/member', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(800);
  check('member no sticky top bar', await page.locator('#identity-bar').count() === 0);
  check('member identity in account card', await page.locator('#acct-identity #id-bar-main').count() === 1);
  const guestMain = ((await page.locator('#id-bar-main').textContent()) || '').trim();
  check('member guest label', guestMain === '游客', guestMain);
  check('member guest hides redeem link', await page.locator('#id-bar-next').isHidden());
  check('member mode tabs wording', /已有账号/.test((await page.locator('#mode-login').textContent()) || ''));
  check('member single primary submit', await page.locator('#btn-acct-submit.primary').count() === 1);
  check('member tabs not yellow', await page.locator('#mode-login.active').evaluate((el) => {
    const bg = getComputedStyle(el).backgroundColor;
    return bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent' || bg === 'rgba(0,0,0,0)';
  }).catch(() => false));
  check('member redeem callout when guest', await page.locator('#redeem-callout').isVisible());
  check('member login mode hides confirm pwd', await page.locator('#pwd2-wrap').isHidden());
  check('member submit says 登录', /登录/.test((await page.locator('#btn-acct-submit').textContent()) || ''));
  await page.click('#mode-register');
  await page.waitForTimeout(200);
  check('member register shows confirm pwd', await page.locator('#pwd2-wrap').isVisible());
  check('member register shows nick', await page.locator('#reg-only-fields').isVisible());
  check('member submit says 注册', /注册/.test((await page.locator('#btn-acct-submit').textContent()) || ''));
  check('member forgot copy wx', await page.locator('#btn-copy-wx-forgot').count() === 1);
  await page.screenshot({ path: path.join(OUT, 'member-register-mode.png'), fullPage: true });

  await page.fill('#display-name', '测');
  await page.fill('#phone', '13800000000');
  // 注册态密码框先 readonly，点进后再填（减轻浏览器推荐密码）
  await page.click('#pwd');
  await page.fill('#pwd', '12345');
  await page.click('#pwd2');
  await page.fill('#pwd2', '123456');
  await page.click('#btn-acct-submit');
  await page.waitForTimeout(300);
  const acctMsg = (await page.locator('#acct-msg').textContent()) || '';
  check('member register client validate', /昵称|密码|不一致|至少/.test(acctMsg), acctMsg.slice(0, 80));

  await page.click('#btn-redeem-goto-acct');
  await page.waitForTimeout(400);
  check('member goto acct from redeem', await page.locator('#account').isVisible());
  check('member back to login wording on submit', /登录/.test((await page.locator('#btn-acct-submit').textContent()) || ''));

  // --- member-ops static (no admin login) ---
  await page.goto(BASE + '/member-ops', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(500);
  check('ops login form', await page.locator('#sec-login').isVisible());
  // probe banner exists but inside sec-app (hidden until login)
  check('ops probe banner exists', await page.locator('#probe-banner').count() === 1);
  check('ops policy tab label', await page.locator('button.tab[data-tab="policy"]').textContent().then((t) => /权限与宣传/.test(t || '')));
  // reveal app temporarily to screenshot guide (DOM only)
  await page.evaluate(() => {
    document.getElementById('sec-login').classList.add('hidden');
    document.getElementById('sec-app').classList.remove('hidden');
    const tabs = document.querySelectorAll('.tab');
    tabs.forEach((t) => t.classList.toggle('active', t.getAttribute('data-tab') === 'policy'));
    document.querySelectorAll('.tab-panel').forEach((p) => {
      p.classList.toggle('active', p.getAttribute('data-panel') === 'policy');
    });
  });
  await page.waitForTimeout(200);
  const policyText = await page.locator('[data-panel="policy"]').innerText();
  check('ops policy is guide not table list', /权限涂色/.test(policyText) && !/scene-tbody/.test(policyText) && /游客/.test(policyText), policyText.slice(0, 120));
  check('ops no visible scene table', await page.locator('#scene-tbody').isHidden());
  await page.screenshot({ path: path.join(OUT, 'ops-policy-guide.png'), fullPage: true });

  await page.evaluate(() => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.getAttribute('data-tab') === 'start'));
    document.querySelectorAll('.tab-panel').forEach((p) => {
      p.classList.toggle('active', p.getAttribute('data-panel') === 'start');
    });
  });
  const startText = await page.locator('[data-panel="start"]').innerText();
  check('ops start has staging vs prod', /测站/.test(startText) && /正式站/.test(startText) && /假码/.test(startText));
  await page.screenshot({ path: path.join(OUT, 'ops-how-to-test.png'), fullPage: true });

  await page.evaluate(() => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.getAttribute('data-tab') === 'codes'));
    document.querySelectorAll('.tab-panel').forEach((p) => {
      p.classList.toggle('active', p.getAttribute('data-panel') === 'codes');
    });
  });
  const notePh = await page.locator('#code-note').getAttribute('placeholder');
  check('ops code note strong placeholder', /手机号|微信/.test(notePh || ''), notePh);
  check('ops probe controls', await page.locator('#btn-probe-off').count() === 1 && await page.locator('#btn-probe-on').count() === 1);
  await page.screenshot({ path: path.join(OUT, 'ops-codes-note.png'), fullPage: true });

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
  process.exit(report.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
