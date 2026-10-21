/**
 * 肖像光影沙盒：按场景编号列表截图（用于 AI 视觉精炼泛名）
 * 用法：node scripts/portrait-sandbox-shot-list.js 31,32,33,39-46
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

function parseList(arg) {
  const out = new Set();
  String(arg || '')
    .split(/[,，\s]+/)
    .filter(Boolean)
    .forEach((tok) => {
      const m = tok.match(/^(\d+)\s*[-–~]\s*(\d+)$/);
      if (m) {
        const a = parseInt(m[1], 10);
        const b = parseInt(m[2], 10);
        for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.add(i);
      } else {
        const n = parseInt(tok, 10);
        if (n > 0) out.add(n);
      }
    });
  return Array.from(out).sort((a, b) => a - b);
}

const nums = parseList(process.argv[2]);
if (!nums.length) {
  console.error('usage: node scripts/portrait-sandbox-shot-list.js 31,32,39-46');
  process.exit(1);
}

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
  await page.waitForTimeout(1000);
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
  for (const n of nums) {
    const idx = await page.evaluate((want) => {
      const arr = window.customScenes || [];
      const pad = String(want).padStart(2, '0');
      const re = new RegExp('^' + pad + '(?:\\s|$)');
      let i = arr.findIndex((s) => s && re.test(String(s.name || '')));
      if (i < 0) {
        const re2 = new RegExp('^' + want + '(?:\\s|$)');
        i = arr.findIndex((s) => s && re2.test(String(s.name || '')));
      }
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
    await page.waitForTimeout(500);
    const shot = path.join(outDir, `portrait-${String(n).padStart(3, '0')}.png`);
    await page.screenshot({ path: shot, fullPage: false });
    manifest.push({ n, ok: true, shot, ...meta, total });
  }
  const tag = nums[0] + '-' + nums[nums.length - 1];
  const manPath = path.join(outDir, `manifest-list-${tag}.json`);
  fs.writeFileSync(manPath, JSON.stringify({ nums, total, items: manifest }, null, 2));
  console.log('DONE', manPath);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
