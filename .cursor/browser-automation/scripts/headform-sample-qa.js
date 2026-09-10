/**
 * headform 样板关视觉验收：Solid.html?sandbox=headform → V01/L01 截图。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outputDir = path.join(runsRoot, `${stamp}-headform-sample-qa`);
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:18080';

fs.mkdirSync(outputDir, { recursive: true });

async function waitLoaderGone(page) {
  await page.waitForFunction(() => {
    const el = document.getElementById('scene-loader');
    if (!el) return true;
    const st = getComputedStyle(el);
    return st.display === 'none' || Number(st.opacity || 1) < 0.05;
  }, null, { timeout: 180000 }).catch(() => {});
  await page.waitForTimeout(2000);
}

async function openSceneById(page, id) {
  const idx = await page.evaluate((want) => {
    const arr = window.customScenes || [];
    return arr.findIndex((s) => s && String(s.id) === String(want));
  }, id);
  if (idx < 0) throw new Error('scene not found: ' + id);
  await page.evaluate((i) => window.switchScene(i), idx);
  await waitLoaderGone(page);
  // hide UI chrome for cleaner shot
  await page.evaluate(() => {
    const ids = ['scene-grid-modal', 'global-menu-overlay'];
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  });
  return idx;
}

async function shot(page, name) {
  await page.screenshot({
    path: path.join(outputDir, name),
    fullPage: false,
    timeout: 60000
  });
}

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(60000);
  const log = [];
  const push = (m) => {
    log.push(m);
    console.log(m);
  };
  page.on('console', (msg) => {
    if (msg.type() === 'error') push('BROWSERERR ' + msg.text());
  });
  page.on('pageerror', (err) => push('PAGEERROR ' + err.message));

  try {
    await page.goto(`${baseUrl}/Solid.html?sandbox=headform&_=${Date.now()}`, {
      waitUntil: 'domcontentloaded',
      timeout: 90000
    });
    await page.waitForFunction(() => Array.isArray(window.customScenes) && window.customScenes.length > 0, null, {
      timeout: 90000
    });
    await waitLoaderGone(page);
    const meta = await page.evaluate(() =>
      (window.customScenes || []).map((s) => ({
        id: s.id,
        name: s.name,
        status: s.meta && s.meta.status,
        items: (s.items || []).length,
        url: s.items && s.items[0] && s.items[0].url
      }))
    );
    fs.writeFileSync(path.join(outputDir, 'scenes-meta.json'), JSON.stringify(meta, null, 2));
    push('scenes=' + meta.length);
    await shot(page, '00-grid.png');

    await openSceneById(page, 'V01');
    await shot(page, '01-V01.png');
    push('shot V01 url=' + (meta.find((m) => m.id === 'V01') || {}).url);

    await openSceneById(page, 'L01');
    await shot(page, '02-L01.png');
    push('shot L01');

    fs.writeFileSync(path.join(outputDir, 'log.txt'), log.join('\n') + '\n');
    console.log('OUT', outputDir);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
