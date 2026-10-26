/**
 * 取色引线 + 受光探针压亮截图
 * PORT=18080 PLAYWRIGHT_CHANNEL=msedge node scripts/qa-cs-prober-tone-shots.js
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
  }, null, { timeout: 120000 });
}

async function waitInSceneSoft(page) {
  // 不等待 isLoadingScene 完全结束（重 GLB 可能很久）；有 index + 遮罩淡出即可采样
  await page.waitForFunction(() => {
    const modal = document.getElementById('scene-grid-modal');
    const modalOff = !modal || modal.style.display === 'none';
    return modalOff && Number(window.currentSceneIndex) >= 0;
  }, null, { timeout: 120000 });
  await page.waitForTimeout(2500);
}

async function enterByNameSub(page, sub) {
  const idx = await page.evaluate((needle) => {
    return (window.customScenes || []).findIndex((sc) => sc && String(sc.name || '').indexOf(needle) >= 0);
  }, sub);
  if (idx < 0) throw new Error('not found: ' + sub);
  await page.evaluate((i) => { if (typeof window.switchScene === 'function') window.switchScene(i); }, idx);
  await waitInSceneSoft(page);
  return idx;
}

async function shotScene(page, nameSub, kind) {
  await page.goto(`${BASE}/Solid?sandbox=geometry`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await waitList(page);
  const idx = await enterByNameSub(page, nameSub);
  const info = { idx, kind };
  if (kind === 'cs') {
    info.labels = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.anno-cs-label')).slice(0, 8).map((el) => ({
        text: (el.textContent || '').trim().slice(0, 24),
        color: getComputedStyle(el).color,
        border: el.style.borderColor || ''
      }));
    });
    info.lines = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('#anno-cs-svg [stroke]'))
        .map((p) => p.getAttribute('stroke'))
        .filter(Boolean)
        .slice(0, 12);
    });
    info.jsonLine = await page.evaluate(() => {
      const sc = window.customScenes && window.customScenes[window.currentSceneIndex];
      const items = (sc && sc.items) || [];
      for (let i = 0; i < items.length; i++) {
        const arr = items[i].colorSampleAnnotations || [];
        if (arr[0] && arr[0].lineColor) return arr[0].lineColor;
      }
      return null;
    });
    const shot = path.join(outDir, 'qa-cs-tone-sixzone.png');
    await page.screenshot({ path: shot, fullPage: false });
    info.shot = shot;
  } else {
    info.strokes = await page.evaluate(() => {
      const root = document.getElementById('prober-html-layer') || document.body;
      return Array.from(root.querySelectorAll('line')).map((l) => ({
        stroke: l.getAttribute('stroke'),
        dash: l.getAttribute('stroke-dasharray') || ''
      })).slice(0, 20);
    });
    info.anchors = await page.evaluate(() => {
      const root = document.getElementById('prober-html-layer') || document.body;
      return Array.from(root.querySelectorAll('circle')).map((c) => c.getAttribute('fill')).slice(0, 12);
    });
    info.jsonColor = await page.evaluate(() => {
      const sc = window.customScenes && window.customScenes[window.currentSceneIndex];
      const items = (sc && sc.items) || [];
      for (let i = 0; i < items.length; i++) {
        const arr = items[i].probers || [];
        if (arr[0] && arr[0].color) return arr[0].color;
      }
      return null;
    });
    const shot = path.join(outDir, 'qa-prober-tone-normals.png');
    await page.screenshot({ path: shot, fullPage: false });
    info.shot = shot;
  }
  return info;
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true
  });
  const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
  page.setDefaultTimeout(120000);

  const cs = await shotScene(page, '六区色律', 'cs');
  const pr = await shotScene(page, '面转则明暗分', 'pr');
  await browser.close();

  const csTextOk = (cs.labels || []).length > 0 && (cs.labels || []).every((l) => {
    const m = String(l.color || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!m) return false;
    return !(+m[1] === 255 && +m[2] === 255 && +m[3] === 255);
  });
  const csLineOk = cs.jsonLine === '#bdb9b2'
    || (cs.lines || []).some((s) => /#bdb9b2|189,\s*185,\s*178/i.test(String(s)));
  const prOk = pr.jsonColor === '#bdb9b2'
    || (pr.strokes || []).some((x) => !x.dash && /#bdb9b2|189,\s*185/i.test(String(x.stroke)))
    || (pr.anchors || []).some((f) => /#bdb9b2|189,\s*185/i.test(String(f)));

  const out = { ok: !!(csTextOk && csLineOk && prOk), checks: { csTextOk, csLineOk, prOk }, cs, pr };
  console.log(JSON.stringify(out, null, 2));
  if (!out.ok) process.exit(1);
  console.log('PASS');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
