/**
 * 验收：肖像沙盒 87 名为塞内卡，且出现在「画室常用」
 * PORT=18080 node scripts/qa-portrait-87-seneca.js
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
  await page.waitForTimeout(800);
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${BASE}/Solid?sandbox=portrait&skipPerf=1&_=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 90000
  });
  await waitList(page);

  const allHit = await page.evaluate(() => {
    const scenes = window.customScenes || [];
    const s87 = scenes.find((s) => String(s.uid) === '87');
    const titles = [].map.call(
      document.querySelectorAll('#scene-grid-container .scene-item .scene-title'),
      (el) => (el.textContent || '').trim()
    );
    const card = titles.find((t) => t.indexOf('87') >= 0 || /塞内卡/.test(t));
    return {
      dataName: s87 && s87.name,
      material: s87 && s87.meta && s87.meta.material,
      cardTitle: card || null,
      titleHasSeneca: !!(card && /塞内卡/.test(card))
    };
  });

  const shotAll = path.join(outDir, `qa-87-seneca-all-${Date.now()}.png`);
  // scroll card into view if possible
  await page.evaluate(() => {
    const items = document.querySelectorAll('#scene-grid-container .scene-item');
    for (const it of items) {
      const t = (it.querySelector('.scene-title') || {}).textContent || '';
      if (/塞内卡/.test(t) && /87/.test(t)) {
        it.scrollIntoView({ block: 'center' });
        it.classList.add('selected');
        break;
      }
    }
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: shotAll, fullPage: false });

  await page.evaluate(() => {
    const btn = [].find.call(
      document.querySelectorAll('#scene-tabbar .scene-tab'),
      (el) => /画室常用/.test(el.textContent || '')
    );
    if (btn) btn.click();
  });
  await page.waitForTimeout(700);

  const studio = await page.evaluate(() => {
    const titles = [].map.call(
      document.querySelectorAll('#scene-grid-container .scene-item .scene-title'),
      (el) => (el.textContent || '').trim()
    );
    const hit = titles.find((t) => /87/.test(t) && /塞内卡/.test(t));
    return { count: titles.length, hit: hit || null, titlesSample: titles.slice(0, 30) };
  });

  await page.evaluate(() => {
    const items = document.querySelectorAll('#scene-grid-container .scene-item');
    for (const it of items) {
      const t = (it.querySelector('.scene-title') || {}).textContent || '';
      if (/塞内卡/.test(t) && /87/.test(t)) {
        it.scrollIntoView({ block: 'center' });
        break;
      }
    }
  });
  await page.waitForTimeout(300);
  const shotStudio = path.join(outDir, `qa-87-seneca-studio-${Date.now()}.png`);
  await page.screenshot({ path: shotStudio, fullPage: false });

  await browser.close();

  const ok = !!(
    allHit.dataName === '塞内卡' &&
    allHit.material === '画室常用' &&
    allHit.titleHasSeneca &&
    studio.hit
  );
  const result = { ok, allHit, studio, shotAll, shotStudio };
  console.log(JSON.stringify(result, null, 2));
  if (!ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
