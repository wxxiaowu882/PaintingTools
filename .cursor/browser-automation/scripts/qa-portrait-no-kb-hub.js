/**
 * Portrait：进站应为课程列表，无「切换知识库」；关列表未选课时仍回列表。
 * PORT=18080 node scripts/qa-portrait-no-kb-hub.js
 */
require('./_playwright-browsers-path');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PORT = process.env.PORT || '18080';
const BASE = process.env.BASE_URL || `http://127.0.0.1:${PORT}`;
const outDir = path.join(__dirname, '..', 'runs');

async function checkLib(page, lib, shotName) {
  await page.goto(`${BASE}/Portrait_c?lib=${lib}`, {
    waitUntil: 'domcontentloaded',
    timeout: 90000
  });
  await page.waitForSelector('#course-gallery-modal.show', { timeout: 30000 });
  await page.waitForTimeout(1200);

  const early = await page.evaluate(() => {
    const modal = document.getElementById('course-gallery-modal');
    const sel = document.getElementById('model-selector-text');
    const title = document.querySelector('.gallery-title');
    const body = document.body ? document.body.innerText : '';
    return {
      modalShow: !!(modal && modal.classList.contains('show')),
      title: title ? title.textContent.trim() : null,
      selText: sel ? sel.textContent.trim() : null,
      hasKbWording: /切换知识库/.test(body) || (sel && /切换知识库/.test(sel.textContent))
    };
  });

  const shot = path.join(outDir, `${shotName}-${Date.now()}.png`);
  await page.screenshot({ path: shot, fullPage: false });

  // 从首页菜单式进入再关列表：应 history.back，不得停在知识库空壳
  await page.goto(`${BASE}/index`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    if (typeof window.toggleMenu === 'function') window.toggleMenu();
  });
  await page.waitForFunction(() => location.hash === '#menu', { timeout: 8000 }).catch(() => {});
  await page.evaluate((lib) => {
    const url = '/Portrait_c?lib=' + lib;
    if (typeof window.zoomAndNavigate === 'function') window.zoomAndNavigate(url);
    else location.href = url;
  }, lib);
  await page.waitForURL((u) => /Portrait_c/i.test(u.pathname), { timeout: 30000 });
  await page.waitForSelector('#course-gallery-modal.show', { timeout: 30000 });
  await page.waitForTimeout(800);
  await page.click('.gallery-close');
  await page.waitForTimeout(1200);
  const afterClose = {
    url: page.url(),
    leftPortrait: !(await page.evaluate(() => /Portrait_c/i.test(location.pathname))),
    bodyHasKb: await page.evaluate(() => /切换知识库/.test(document.body ? document.body.innerText : ''))
  };

  return { lib, early, afterClose, shot };
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const r1 = await checkLib(page, 'anatomy', 'portrait-anatomy-list');
  const r2 = await checkLib(page, 'facial', 'portrait-facial-list');
  await browser.close();

  const ok =
    r1.early.modalShow &&
    !r1.early.hasKbWording &&
    r1.afterClose.leftPortrait &&
    !r1.afterClose.bodyHasKb &&
    r2.early.modalShow &&
    !r2.early.hasKbWording &&
    r2.afterClose.leftPortrait &&
    !r2.afterClose.bodyHasKb;

  console.log(JSON.stringify({ ok, r1, r2 }, null, 2));
  if (!ok) {
    console.error('FAIL');
    process.exit(1);
  }
  console.log('PASS: anatomy/facial enter course list; no 切换知识库 hub');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
