#!/usr/bin/env node
/**
 * 本地验收：几何体 002 房子模型是否加载进场景（非空舞台）。
 *   PORT=18080 node .cursor/browser-automation/scripts/geometry-002-house-qa.js
 */
const fs = require('fs');
const path = require('path');
require('./_playwright-browsers-path.js');
const { chromium } = require('playwright');

const PORT = process.env.PORT || '18080';
const BASE = `http://127.0.0.1:${PORT}`;
const OUT_DIR = path.join(__dirname, '..', 'runs');
const SHOT = path.join(OUT_DIR, `geometry-002-house-${Date.now()}.png`);

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const glbHits = [];
  page.on('response', (res) => {
    const u = res.url();
    if (/静物_其它_房子|%E9%9D%99%E7%89%A9_%E5%85%B6%E5%AE%83_%E6%88%BF%E5%AD%90/i.test(u)) {
      glbHits.push({ status: res.status(), url: u });
    }
  });

  await page.goto(`${BASE}/Solid?sandbox=geometry&skipPerf=1`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => typeof window.switchScene === 'function' && Array.isArray(window.customScenes) && window.customScenes.length > 0, null, { timeout: 120000 });

  const idx = await page.evaluate(() => {
    const list = window.customScenes || [];
    for (let i = 0; i < list.length; i++) {
      const sc = list[i];
      const uid = sc && sc.uid != null ? String(sc.uid).trim() : '';
      if (uid === '002' || uid === '2') return i;
      if (sc && /以简驭繁/.test(String(sc.name || ''))) return i;
    }
    return -1;
  });
  if (idx < 0) throw new Error('找不到 uid=002 / 以简驭繁 场景');

  await page.evaluate((i) => window.switchScene(i), idx);
  await page.waitForFunction(() => {
    const el = document.getElementById('scene-loader');
    if (!el) return true;
    const st = getComputedStyle(el);
    return st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity || 1) === 0;
  }, null, { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(2500);

  const stats = await page.evaluate(() => {
    const host = window.__solidHost;
    const g = host && host.getSceneGroup ? host.getSceneGroup() : null;
    let meshes = 0;
    let glbLike = 0;
    if (g) {
      g.traverse((o) => {
        if (o.isMesh) {
          meshes++;
          const n = String(o.name || o.parent && o.parent.name || '');
          if (/房|house|静物/i.test(n)) glbLike++;
        }
      });
    }
    const title = (document.querySelector('.solid-scene-label') && document.querySelector('.solid-scene-label').textContent) || '';
    const nameEl = document.getElementById('current-scene-name') || document.querySelector('[data-current-scene-name]');
    return {
      meshes,
      glbLike,
      title,
      sceneName: nameEl ? nameEl.textContent : '',
      currentIndex: window.currentSceneIndex
    };
  });

  await page.screenshot({ path: SHOT, fullPage: false });
  await browser.close();

  const okGlb = glbHits.some((h) => h.status === 200);
  const okMeshes = stats.meshes >= 1;
  const result = { ok: okGlb && okMeshes, glbHits, stats, shot: SHOT };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

main().catch((e) => {
  console.error('[geometry-002-house-qa] FAIL', e && e.message ? e.message : e);
  process.exit(1);
});
