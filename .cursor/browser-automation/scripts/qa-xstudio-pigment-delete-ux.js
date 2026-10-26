/**
 * XStudio：分享位/文案/钛白无减号/删除确认弹层
 * PORT=18080 PLAYWRIGHT_CHANNEL=msedge node scripts/qa-xstudio-pigment-delete-ux.js
 */
require('./_playwright-browsers-path');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PORT = process.env.PORT || '18080';
const BASE = process.env.BASE_URL || `http://127.0.0.1:${PORT}`;
const outDir = path.join(__dirname, '..', 'runs', 'qa-xstudio-pigment-delete-ux');

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true
  });
  const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
  page.setDefaultTimeout(60000);
  await page.goto(`${BASE}/XStudio?_qa=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => typeof window.openPigmentModal === 'function', null, { timeout: 30000 });
  await page.evaluate(() => window.openPigmentModal());
  await page.waitForSelector('#pigmentModal.active', { timeout: 10000 });
  await page.waitForTimeout(400);

  const snap = await page.evaluate(() => {
    const title = (document.getElementById('currentGroupTitle') || {}).innerText || '';
    const share = document.getElementById('shareBoxInlineBtn');
    const reset = document.getElementById('resetCustomBtn');
    const libTitle = (document.getElementById('librarySectionTitle') || {}).innerText || '';
    const oldShareBar = document.getElementById('boxShareBar');
    const pans = [...document.querySelectorAll('#currentSetGrid .pigment-pan-item')];
    const white = pans.find(el => (el.querySelector('.pigment-pan-label') || {}).innerText === '钛白');
    const lemon = pans.find(el => (el.querySelector('.pigment-pan-label') || {}).innerText === '柠檬黄');
    return {
      title,
      libTitle,
      shareText: share ? share.innerText.trim() : '',
      shareDisplay: share ? getComputedStyle(share).display : 'missing',
      shareBeforeReset: !!(share && reset && share.compareDocumentPosition(reset) & Node.DOCUMENT_POSITION_FOLLOWING),
      oldShareBarGone: !oldShareBar,
      whiteHasMinus: white ? !!white.querySelector('.pan-action-icon') : null,
      lemonHasMinus: lemon ? !!lemon.querySelector('.pan-action-icon') : null
    };
  });
  await page.screenshot({ path: path.join(outDir, '01-header-and-minus.png'), fullPage: false });

  // 点柠檬黄触发移出确认
  await page.evaluate(() => {
    const pans = [...document.querySelectorAll('#currentSetGrid .pigment-pan-item')];
    const lemon = pans.find(el => (el.querySelector('.pigment-pan-label') || {}).innerText === '柠檬黄');
    if (lemon) lemon.click();
  });
  await page.waitForSelector('#confirmActionOverlay.active', { timeout: 5000 });
  const confirm = await page.evaluate(() => ({
    title: (document.getElementById('confirmActionTitle') || {}).innerText || '',
    desc: (document.getElementById('confirmActionDesc') || {}).innerText || '',
    ok: (document.getElementById('confirmActionOkBtn') || {}).innerText || '',
    hasSwatch: !!(document.getElementById('confirmActionSwatch') && getComputedStyle(document.getElementById('confirmActionSwatch')).display !== 'none')
  }));
  await page.screenshot({ path: path.join(outDir, '02-remove-confirm.png'), fullPage: false });
  await page.evaluate(() => window.hideConfirmAction());

  const out = {
    snap,
    confirm,
    ok:
      snap.title === '颜料盒中的颜料：' &&
      snap.libTitle.indexOf('后备仓库') >= 0 &&
      snap.shareText === '分享颜料盒' &&
      snap.shareDisplay !== 'none' &&
      snap.shareBeforeReset &&
      snap.oldShareBarGone &&
      snap.whiteHasMinus === false &&
      snap.lemonHasMinus === true &&
      confirm.title === '移出颜料盒' &&
      confirm.ok === '移出' &&
      confirm.hasSwatch
  };
  fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
  if (!out.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
