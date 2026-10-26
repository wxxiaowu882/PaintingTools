/**
 * XStudio：帮助弹层 + 标题文案
 * PORT=18080 PLAYWRIGHT_CHANNEL=msedge node scripts/qa-xstudio-about-modal.js
 */
require('./_playwright-browsers-path');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PORT = process.env.PORT || '18080';
const BASE = process.env.BASE_URL || `http://127.0.0.1:${PORT}`;
const outDir = path.join(__dirname, '..', 'runs', 'qa-xstudio-about-modal');

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true
  });
  const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
  page.setDefaultTimeout(60000);
  await page.goto(`${BASE}/XStudio?_qa=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => typeof window.showInfo === 'function', null, { timeout: 30000 });

  const beforeUrl = page.url();
  await page.click('.info-btn');
  await page.waitForSelector('#aboutOverlay.active', { timeout: 5000 });
  await page.waitForTimeout(300);
  const about = await page.evaluate(() => {
    const body = document.querySelector('.about-sheet-body');
    const text = body ? body.innerText : '';
    return {
      urlStillXStudio: /\/XStudio/i.test(location.pathname) || /XStudio/i.test(location.href),
      title: (document.getElementById('aboutSheetTitle') || {}).innerText || '',
      hasCoreRecipe: text.indexOf('给配方') >= 0,
      hasCorePractice: text.indexOf('练调色') >= 0,
      hasCoreBox: text.indexOf('管颜料盒') >= 0 || text.indexOf('颜料盒') >= 0,
      hasShare: text.indexOf('分享颜料盒') >= 0,
      hasImport: text.indexOf('导入颜料盒') >= 0,
      noRememberTalk: text.indexOf('本机会') < 0 && text.indexOf('尽量记住') < 0,
      noTitaniumSection: text.indexOf('移出、删除') < 0 && text.indexOf('钛白') < 0,
      noWhereImage: text.indexOf('画面从哪') < 0
    };
  });
  await page.screenshot({ path: path.join(outDir, '01-about-modal.png'), fullPage: false });
  await page.evaluate(() => window.closeAbout());
  await page.waitForTimeout(200);

  await page.evaluate(() => window.openPigmentModal());
  await page.waitForSelector('#pigmentModal.active', { timeout: 10000 });
  const groupTitle = await page.evaluate(() => (document.getElementById('currentGroupTitle') || {}).innerText || '');
  await page.screenshot({ path: path.join(outDir, '02-group-title.png'), fullPage: false });

  const afterUrl = page.url();
  const out = {
    beforeUrl,
    afterUrl,
    about,
    groupTitle,
    ok:
      about.urlStillXStudio &&
      about.title === '使用说明' &&
      about.hasCoreRecipe &&
      about.hasCorePractice &&
      about.hasCoreBox &&
      about.hasShare &&
      about.hasImport &&
      about.noRememberTalk &&
      about.noTitaniumSection &&
      about.noWhereImage &&
      groupTitle === '这个颜料盒中的颜料：' &&
      !/AboutXStudio/i.test(afterUrl)
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
