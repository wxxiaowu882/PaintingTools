/**
 * XStudio 首屏默认作品图 / 记住用户图 / 顶栏齿轮
 * PORT=18080 PLAYWRIGHT_CHANNEL=msedge node scripts/qa-xstudio-default-image.js
 */
require('./_playwright-browsers-path');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PORT = process.env.PORT || '18080';
const BASE = process.env.BASE_URL || `http://127.0.0.1:${PORT}`;
const outDir = path.join(__dirname, '..', 'runs', 'qa-xstudio-default-image');

async function clearImageIdb(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      const del = indexedDB.deleteDatabase('xstudio');
      del.onsuccess = () => resolve();
      del.onerror = () => resolve();
      del.onblocked = () => resolve();
    });
  });
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true
  });
  const context = await browser.newContext({ viewport: { width: 393, height: 852 } });
  const page = await context.newPage();
  page.setDefaultTimeout(60000);

  // 冷启动：先进入页面再清 IDB 并 reload（勿用 addInitScript 每次导航都删库，否则无法测「记住用户图」）
  await page.goto(`${BASE}/XStudio?_qa=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => typeof window.bootStudioImage === 'function', null, { timeout: 30000 });
  await clearImageIdb(page);
  await page.reload({ waitUntil: 'domcontentloaded' });

  await page.waitForFunction(() => {
    const img = document.getElementById('paletteImg');
    return img && img.style.display !== 'none' && img.naturalWidth > 0;
  }, null, { timeout: 30000 });

  await page.waitForTimeout(600);

  const boot = await page.evaluate(() => {
    const img = document.getElementById('paletteImg');
    const ch = document.getElementById('crosshair');
    const upload = document.getElementById('uploadContainer');
    const pick = document.getElementById('pickBtn');
    const gear = document.getElementById('topConfigGearBtn');
    const manual = document.getElementById('manualBar');
    return {
      src: (img && img.src) || '',
      imgVisible: img && img.style.display !== 'none',
      naturalW: img ? img.naturalWidth : 0,
      uploadHidden: upload && upload.style.display === 'none',
      crosshairShown: ch && ch.style.display !== 'none',
      crosshairGuide: ch && ch.classList.contains('guide-active'),
      pickShown: pick && getComputedStyle(pick).display !== 'none',
      topGear: !!gear,
      targetHex: window.globalSession && window.globalSession.targetHex,
      manualKids: manual ? manual.children.length : 0
    };
  });

  await page.screenshot({ path: path.join(outDir, '01-cold-boot-demo.png'), fullPage: false });

  // 写入假用户图到 IDB，刷新后应恢复 blob
  const tinyPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC',
    'base64'
  );
  await page.evaluate(async (b64) => {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const blob = new Blob([arr], { type: 'image/png' });
    await window.saveLastUserImage(blob);
  }, tinyPng.toString('base64'));

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const img = document.getElementById('paletteImg');
    return img && img.style.display !== 'none' && img.naturalWidth > 0 && String(img.src).indexOf('blob:') === 0;
  }, null, { timeout: 30000 });
  await page.waitForTimeout(400);

  const restored = await page.evaluate(() => ({
    srcKind: String(document.getElementById('paletteImg').src).slice(0, 5),
    naturalW: document.getElementById('paletteImg').naturalWidth,
    targetHex: window.globalSession && window.globalSession.targetHex
  }));
  await page.screenshot({ path: path.join(outDir, '02-restored-user.png'), fullPage: false });

  // 顶栏齿轮打开配置
  await page.click('#topConfigGearBtn');
  await page.waitForSelector('#pigmentModal.active', { timeout: 10000 });
  const modalOpen = await page.evaluate(() => document.getElementById('pigmentModal').classList.contains('active'));
  await page.screenshot({ path: path.join(outDir, '03-top-gear-modal.png'), fullPage: false });

  const out = {
    boot,
    restored,
    modalOpen,
    demoIsGallery: /galleryIMG/i.test(boot.src),
    ok:
      boot.imgVisible &&
      boot.uploadHidden &&
      boot.crosshairShown &&
      boot.topGear &&
      !!boot.targetHex &&
      restored.srcKind === 'blob:' &&
      modalOpen === true
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
