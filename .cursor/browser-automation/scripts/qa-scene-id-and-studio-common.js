/**
 * 1) 几何体/头部造型列表标题含编号；肖像名称前缀编号保留
 * 2) 肖像一级有「画室常用」且在石膏左侧；点开无二级芯片
 * PORT=18080 node scripts/qa-scene-id-and-studio-common.js
 */
require('./_playwright-browsers-path');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PORT = process.env.PORT || '18080';
const BASE = process.env.BASE_URL || `http://127.0.0.1:${PORT}`;
const outDir = path.join(__dirname, '..', 'runs');

async function waitList(page) {
  await page.waitForFunction(() => {
    const loader = document.getElementById('scene-loader');
    const modal = document.getElementById('scene-grid-modal');
    const loaderGone = !loader || loader.style.display === 'none' || getComputedStyle(loader).display === 'none';
    const modalOn = modal && (modal.style.display === 'flex' || getComputedStyle(modal).display === 'flex');
    return loaderGone && modalOn && document.querySelectorAll('#scene-grid-container .scene-item').length > 0;
  }, { timeout: 120000 });
  await page.waitForTimeout(500);
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const results = {};

  // geometry
  await page.goto(`${BASE}/Solid?sandbox=geometry`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await waitList(page);
  results.geometry = await page.evaluate(() => {
    const t = (document.querySelector('#scene-grid-container .scene-item .scene-title') || {}).textContent || '';
    const uid = (window.customScenes && window.customScenes[0] && window.customScenes[0].uid) || '';
    return { title: t.trim(), uid, ok: !!(uid && t.indexOf(uid) >= 0) };
  });
  const shotG = path.join(outDir, `qa-id-geometry-${Date.now()}.png`);
  await page.screenshot({ path: shotG, fullPage: false });
  results.geometry.shot = shotG;

  // headform
  await page.goto(`${BASE}/Solid?sandbox=headform`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await waitList(page);
  results.headform = await page.evaluate(() => {
    const t = (document.querySelector('#scene-grid-container .scene-item .scene-title') || {}).textContent || '';
    const uid = (window.customScenes && window.customScenes[0] && window.customScenes[0].uid) || '';
    return { title: t.trim(), uid, ok: !!(uid && t.indexOf(uid) >= 0) };
  });
  const shotH = path.join(outDir, `qa-id-headform-${Date.now()}.png`);
  await page.screenshot({ path: shotH, fullPage: false });
  results.headform.shot = shotH;

  // portrait + 画室常用
  await page.goto(`${BASE}/Solid?sandbox=portrait`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await waitList(page);
  results.portraitTabs = await page.evaluate(() => {
    const tabs = [].map.call(document.querySelectorAll('#scene-tabbar .scene-tab'), (el) => (el.textContent || '').trim());
    const iStudio = tabs.indexOf('画室常用');
    const iPlaster = tabs.indexOf('石膏');
    return { tabs, iStudio, iPlaster, orderOk: iStudio >= 0 && iPlaster >= 0 && iStudio < iPlaster };
  });
  await page.evaluate(() => {
    const btn = [].find.call(document.querySelectorAll('#scene-tabbar .scene-tab'), (el) => /画室常用/.test(el.textContent || ''));
    if (btn) btn.click();
  });
  await page.waitForTimeout(600);
  results.studio = await page.evaluate(() => {
    const sub = document.getElementById('scene-subtabbar');
    const subHidden = !sub || sub.style.display === 'none' || getComputedStyle(sub).display === 'none' || !sub.innerHTML.trim();
    const items = [].map.call(document.querySelectorAll('#scene-grid-container .scene-item .scene-title'), (el) => (el.textContent || '').trim());
    const count = items.length;
    const first = items[0] || '';
    const mats = (window.customScenes || []).filter((s) => s && s.meta && s.meta.material === '画室常用').length;
    return { subHidden, count, first, mats, ok: subHidden && count >= 10 && count === mats };
  });
  const shotP = path.join(outDir, `qa-studio-common-${Date.now()}.png`);
  await page.screenshot({ path: shotP, fullPage: false });
  results.studio.shot = shotP;

  await browser.close();

  const ok = !!(results.geometry.ok && results.headform.ok && results.portraitTabs.orderOk && results.studio.ok);
  console.log(JSON.stringify({ ok, results }, null, 2));
  if (!ok) {
    console.error('FAIL');
    process.exit(1);
  }
  console.log('PASS');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
