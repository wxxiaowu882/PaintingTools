/**
 * 肖像光影沙盒：按场景序号截图（用于 AI 视觉命名/说明）
 * 用法：node scripts/portrait-sandbox-shot-batch.js 1 10
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const from = Math.max(1, parseInt(process.argv[2] || '1', 10) || 1);
const to = Math.max(from, parseInt(process.argv[3] || String(from), 10) || from);
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:18080';
const outDir = path.resolve(__dirname, '..', 'runs', 'portrait-vision-batch');
fs.mkdirSync(outDir, { recursive: true });

async function waitLoaderGone(page) {
  await page
    .waitForFunction(() => {
      const el = document.getElementById('scene-loader');
      if (!el) return true;
      const st = getComputedStyle(el);
      return st.display === 'none' || Number(st.opacity || 1) < 0.05;
    }, null, { timeout: 300000 })
    .catch(() => {});
  await page.waitForTimeout(1500);
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(300000);
  await page.goto(`${baseUrl}/Solid?sandbox=portrait&skipPerf=1&_=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 180000
  });
  await page.waitForFunction(() => {
    const m = document.getElementById('scene-grid-modal');
    return m && m.style.display === 'flex' && Array.isArray(window.customScenes) && window.customScenes.length > 0;
  }, { timeout: 180000 });

  const total = await page.evaluate(() => (window.customScenes || []).length);
  const manifest = [];
  for (let n = from; n <= to; n++) {
    // customScenes 按统合顺序；文件名数字与 name 字段 "01" 对齐
    const idx = await page.evaluate((want) => {
      const arr = window.customScenes || [];
      const pad = String(want).padStart(2, '0');
      // 命名后 name 多为「21 基努·里维斯」，按编号前缀匹配
      const re = new RegExp('^' + pad + '(?:\\s|$)');
      let i = arr.findIndex((s) => s && re.test(String(s.name || '')));
      if (i < 0) {
        const re2 = new RegExp('^' + want + '(?:\\s|$)');
        i = arr.findIndex((s) => s && re2.test(String(s.name || '')));
      }
      if (i < 0) i = arr.findIndex((s) => s && String(s.name) === pad);
      if (i < 0) i = arr.findIndex((s) => s && String(s.name) === String(want));
      return i;
    }, n);
    if (idx < 0) {
      console.log('SKIP missing', n);
      manifest.push({ n, ok: false, error: 'not in customScenes' });
      continue;
    }
    const meta = await page.evaluate((i) => {
      const s = (window.customScenes || [])[i] || {};
      const it = (s.items || []).find((x) => x && x.type === 'glb');
      const url = it && it.url ? String(it.url) : '';
      const base = url.split('?')[0].replace(/\\/g, '/').split('/').pop() || '';
      return { name: s.name, glb: base, i };
    }, idx);
    console.log('SHOT', n, meta.glb);
    await page.evaluate((i) => {
      window.currentSceneIndex = -1;
      window.switchScene(i);
    }, idx);
    await waitLoaderGone(page);
    await page.evaluate(() => {
      const m = document.getElementById('scene-grid-modal');
      if (m) m.style.display = 'none';
      const el = document.getElementById('scene-loader');
      if (el) el.style.display = 'none';
    });
    await page.waitForTimeout(800);
    const shot = path.join(outDir, `portrait-${String(n).padStart(3, '0')}.png`);
    await page.screenshot({ path: shot, fullPage: false });
    manifest.push({ n, ok: true, shot, ...meta, total });
  }
  const manPath = path.join(outDir, `manifest-${from}-${to}.json`);
  fs.writeFileSync(manPath, JSON.stringify({ from, to, total, items: manifest }, null, 2));
  console.log('DONE', manPath);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
