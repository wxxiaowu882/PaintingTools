/**
 * XStudio 颜料盒分享码：导出 → 改名冲突导入 → 需「使用此方案」才生效
 * PORT=18080 PLAYWRIGHT_CHANNEL=msedge node scripts/qa-xstudio-box-share.js
 */
require('./_playwright-browsers-path');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PORT = process.env.PORT || '18080';
const BASE = process.env.BASE_URL || `http://127.0.0.1:${PORT}`;
const outDir = path.join(__dirname, '..', 'runs', 'qa-xstudio-box-share');

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true
  });
  const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
  page.setDefaultTimeout(60000);
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('xstudioMyBoxes');
      localStorage.removeItem('customIds');
      localStorage.removeItem('customIds2');
      localStorage.removeItem('currentTabId');
    } catch (_e) {}
  });
  await page.goto(`${BASE}/XStudio?_qa=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => typeof window.openPigmentModal === 'function' && window.appState && window.appState.myBoxes && window.appState.myBoxes.length > 0, null, { timeout: 60000 });
  await page.waitForTimeout(800);

  await page.evaluate(() => window.openPigmentModal());
  await page.waitForSelector('#pigmentModal.active', { timeout: 10000 });

  const title = await page.locator('.modal-title').innerText();
  const hasPencil = await page.locator('.tab-rename-btn').count();

  const code = await page.evaluate(() => {
    const payload = window.buildSharePayloadForTab(
      window.modalState.viewingTabId,
      window.modalState.tempMyBoxes,
      window.modalState.tempUserAdded
    );
    payload.name = '自定义色1'; // 故意与现有重名，测自动改名
    return window.encodeShareCode(payload);
  });

  const beforeBoxes = await page.evaluate(() => window.modalState.tempMyBoxes.length);
  const beforeActive = await page.evaluate(() => window.appState.currentTabId);

  await page.evaluate((c) => {
    document.getElementById('importBoxTextarea').value = c;
    window.confirmImportBoxShare();
  }, code);

  const afterImport = await page.evaluate(() => ({
    n: window.modalState.tempMyBoxes.length,
    firstName: window.modalState.tempMyBoxes[0] && window.modalState.tempMyBoxes[0].name,
    viewing: window.modalState.viewingTabId,
    activeStill: window.appState.currentTabId
  }));

  await page.screenshot({ path: path.join(outDir, '01-after-import.png'), fullPage: false });

  await page.evaluate(() => window.confirmPigmentSet());
  await page.waitForTimeout(400);
  const afterConfirm = await page.evaluate(() => ({
    n: window.appState.myBoxes.length,
    current: window.appState.currentTabId,
    firstName: window.appState.myBoxes[0] && window.appState.myBoxes[0].name,
    ls: localStorage.getItem('xstudioMyBoxes') ? JSON.parse(localStorage.getItem('xstudioMyBoxes')).length : 0
  }));

  const out = {
    title,
    hasPencil,
    codePrefix: String(code).slice(0, 8),
    beforeBoxes,
    beforeActive,
    afterImport,
    afterConfirm,
    ok: !!(
      title.indexOf('配置我的颜料盒') >= 0
      && hasPencil >= 1
      && String(code).indexOf('XWBOX1.') === 0
      && afterImport.n === beforeBoxes + 1
      && afterImport.firstName && afterImport.firstName !== '自定义色1'
      && afterImport.activeStill === beforeActive
      && afterConfirm.n === afterImport.n
      && afterConfirm.ls === afterConfirm.n
    )
  };

  console.log(JSON.stringify(out, null, 2));
  await browser.close();
  if (!out.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
