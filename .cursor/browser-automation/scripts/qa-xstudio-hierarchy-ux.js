/**
 * XStudio：齿轮上移 / 铅笔可见 / 分享·导入层次 / 图左右顶足
 * PORT=18080 PLAYWRIGHT_CHANNEL=msedge node scripts/qa-xstudio-hierarchy-ux.js
 */
require('./_playwright-browsers-path');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PORT = process.env.PORT || '18080';
const BASE = process.env.BASE_URL || `http://127.0.0.1:${PORT}`;
const outDir = path.join(__dirname, '..', 'runs', 'qa-xstudio-hierarchy-ux');

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true
  });
  const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
  page.setDefaultTimeout(60000);

  await page.goto(`${BASE}/XStudio?_qa=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => {
    const img = document.getElementById('paletteImg');
    return img && img.style.display !== 'none' && img.naturalWidth > 0;
  }, null, { timeout: 30000 });
  await page.waitForTimeout(500);

  const layout = await page.evaluate(() => {
    const gear = document.getElementById('topConfigGearBtn');
    const brand = document.querySelector('.brand-actions');
    const header = document.querySelector('.app-header');
    const img = document.getElementById('paletteImg');
    const wrap = document.getElementById('imgWrapper');
    const wr = wrap.getBoundingClientRect();
    const ir = img.getBoundingClientRect();
    const leftGap = Math.abs(ir.left - wr.left);
    const rightGap = Math.abs(wr.right - ir.right);
    return {
      gearInBrand: !!(gear && brand && brand.contains(gear)),
      gearInAppHeader: !!(gear && header && header.contains(gear)),
      imgW: Math.round(ir.width),
      wrapW: Math.round(wr.width),
      leftGap: Math.round(leftGap * 10) / 10,
      rightGap: Math.round(rightGap * 10) / 10,
      trayLabel: (document.querySelector('#manualBarHeader span') || {}).innerText || ''
    };
  });
  await page.screenshot({ path: path.join(outDir, '01-boot-fit-width.png'), fullPage: false });

  await page.click('#topConfigGearBtn');
  await page.waitForSelector('#pigmentModal.active', { timeout: 10000 });
  await page.waitForTimeout(300);

  const modal = await page.evaluate(() => {
    const importBtn = document.getElementById('modalImportBoxBtn');
    const header = document.querySelector('.modal-header');
    const shareBar = document.getElementById('boxShareBar');
    const pens = document.querySelectorAll('.tab-rename-btn');
    let penVisible = false;
    if (pens.length) {
      const s = getComputedStyle(pens[0]);
      penVisible = s.display !== 'none' && s.visibility !== 'hidden' && s.color !== 'rgb(255, 255, 255)';
    }
    return {
      importInHeader: !!(importBtn && header && header.contains(importBtn)),
      importText: importBtn ? importBtn.innerText.trim() : '',
      shareBarText: shareBar ? shareBar.innerText.replace(/\s+/g, ' ').trim() : '',
      shareOnlyOne: shareBar ? shareBar.querySelectorAll('button').length : 0,
      penCount: pens.length,
      penVisible,
      penColor: pens.length ? getComputedStyle(pens[0]).color : null,
      groupTitle: (document.getElementById('currentGroupTitle') || {}).innerText || ''
    };
  });
  await page.screenshot({ path: path.join(outDir, '02-modal-hierarchy.png'), fullPage: false });

  await page.click('#boxShareBar button');
  await page.waitForSelector('#shareBoxOverlay.active', { timeout: 5000 });
  const shareOv = await page.evaluate(() => {
    const el = document.getElementById('shareBoxOverlay');
    return {
      active: el && el.classList.contains('active'),
      text: el ? el.innerText.replace(/\s+/g, ' ').trim().slice(0, 120) : ''
    };
  });
  await page.screenshot({ path: path.join(outDir, '03-share-overlay.png'), fullPage: false });
  await page.evaluate(() => window.closeShareBoxOverlay && window.closeShareBoxOverlay());

  const out = {
    layout,
    modal,
    shareOv,
    ok:
      layout.gearInBrand &&
      !layout.gearInAppHeader &&
      layout.leftGap <= 2 &&
      layout.rightGap <= 2 &&
      Math.abs(layout.imgW - layout.wrapW) <= 2 &&
      modal.importInHeader &&
      modal.importText === '导入颜料盒' &&
      modal.shareBarText === '分享颜料盒' &&
      modal.shareOnlyOne === 1 &&
      modal.penCount >= 1 &&
      modal.penVisible &&
      modal.groupTitle === '当前颜料盒' &&
      shareOv.active
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
