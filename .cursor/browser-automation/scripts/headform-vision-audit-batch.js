/**
 * 头部造型规律 · 只读批截图（AI 视觉验收用）
 * - 不写回 JSON / 不改聚合索引
 * - 找场景：meta.slot + 模型 URL（大本 vs 女05），禁止只靠可能错误的 id
 *
 * PORT=18080 MODE=daben node scripts/headform-vision-audit-batch.js
 * PORT=18080 MODE=f05sample node scripts/headform-vision-audit-batch.js
 */
require('./_playwright-browsers-path');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PORT = process.env.PORT || '18080';
const BASE = process.env.BASE_URL || `http://127.0.0.1:${PORT}`;
const MODE = process.env.MODE || 'daben'; // daben | f05sample | f05all
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = process.env.OUT_DIR
  ? path.resolve(process.env.OUT_DIR)
  : path.join(runsRoot, `${stamp}-headform-vision-${MODE}`);
fs.mkdirSync(outDir, { recursive: true });

const DABEN_SLOTS = [
  'V01', 'V02', 'V03', 'V04', 'V05a', 'V05b', 'V06', 'V07',
  'L01', 'L02', 'L03', 'L04', 'L05', 'L06', 'L07', 'L08', 'L09',
];
const F05_SAMPLE = ['V01', 'V03', 'V07', 'L01', 'L03', 'L05', 'L08', 'L09'];

function slotsForMode() {
  if (process.env.SLOTS) {
    return process.env.SLOTS.split(',').map((s) => s.trim()).filter(Boolean);
  }
  if (MODE === 'daben') return DABEN_SLOTS;
  if (MODE === 'f05sample') return F05_SAMPLE;
  return DABEN_SLOTS;
}

function isFemaleScene(s) {
  const id = String((s && s.id) || '');
  const mid = String((s && s.meta && (s.meta.modelId || s.meta.modelLabel)) || '');
  const url = String((((s && s.items) || [])[0] || {}).url || '');
  if (/female_05|女05/i.test(id) || /female_05|女05/i.test(mid)) return true;
  if (/女中青年_05|女05/i.test(url)) return true;
  return false;
}

function isDabenScene(s) {
  const url = String((((s && s.items) || [])[0] || {}).url || '');
  if (/大本|蝙蝠侠|布鲁斯/i.test(url)) return true;
  // 无女05迹象且非 female → 视为大本
  return !isFemaleScene(s);
}

async function waitLoaderGone(page) {
  await page.waitForFunction(() => {
    const el = document.getElementById('scene-loader');
    if (!el) return true;
    const st = getComputedStyle(el);
    return st.display === 'none' || Number(st.opacity || 1) < 0.05;
  }, null, { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(400);
}

async function stabilize(page) {
  await page.evaluate(() => {
    try {
      window.useAdvancedRender = false;
      window.perfTestDone = true;
      window._solidUserStoppedRender = true;
      if (typeof window.stopRender === 'function') window.stopRender();
    } catch (_e) {}
    const hide = (el) => {
      if (!el) return;
      el.style.display = 'none';
      el.style.opacity = '0';
    };
    hide(document.getElementById('scene-loader'));
    hide(document.getElementById('scene-grid-modal'));
  });
  await page.waitForTimeout(80);
}

async function setAnnotations(page, on) {
  await page.evaluate((want) => {
    const cur = !!window.showAnnotations;
    if (cur !== !!want && typeof window.toggleAnnotations === 'function') {
      window.toggleAnnotations();
    }
    const disp = want ? '' : 'none';
    ['annotation-layer', 'dashed-line-layer', 'dashed-line-svg'].forEach((id) => {
      const n = document.getElementById(id);
      if (n) n.style.display = disp;
    });
    window.showAnnotations = !!want;
  }, on);
  await page.waitForTimeout(200);
}

async function shotCropOrFull(page, filePath) {
  // 视觉验收默认全画幅：crop 常把左侧引出线圆标裁掉，无法核对编号
  if (process.env.FORCE_FULL === '1' || process.env.FORCE_FULL === 'true') {
    await page.screenshot({ path: filePath, timeout: 60000 });
    return;
  }
  const box = await page.evaluate(() => {
    const s = (window.customScenes || [])[window.currentSceneIndex];
    const c = (s && s.crop) || {};
    const x = parseFloat(c.left);
    const y = parseFloat(c.top);
    const w = parseFloat(c.width);
    const h = parseFloat(c.height);
    if ([x, y, w, h].every((n) => Number.isFinite(n) && n > 0) && c.display !== 'none') {
      return { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) };
    }
    if ([x, y, w, h].every((n) => Number.isFinite(n) && n > 40)) {
      return { x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h) };
    }
    return null;
  });
  if (box) {
    await page.screenshot({ path: filePath, clip: box, timeout: 60000 });
  } else {
    await page.screenshot({ path: filePath, timeout: 60000 });
  }
}

async function main() {
  const wantFemale = MODE !== 'daben';
  const slots = slotsForMode();
  const manifest = { mode: MODE, outDir, slots, shots: [] };

  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(120000);

  await page.goto(`${BASE}/Solid?sandbox=headform&skipPerf=1&_=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 120000,
  });
  await page.waitForFunction(() => Array.isArray(window.customScenes) && window.customScenes.length > 0, null, {
    timeout: 120000,
  });
  await page.waitForFunction(() => !!(window.__solidHost && window.__solidHost.getCamera), null, {
    timeout: 120000,
  });

  // 列出可匹配场景
  const catalog = await page.evaluate(() =>
    (window.customScenes || []).map((s, i) => ({
      i,
      id: s && s.id,
      name: s && s.name,
      slot: s && s.meta && s.meta.slot,
      url: ((((s && s.items) || [])[0] || {}).url) || '',
    }))
  );
  fs.writeFileSync(path.join(outDir, '_catalog.json'), JSON.stringify(catalog, null, 2));

  for (const slot of slots) {
    const idx = await page.evaluate(
      ({ slot, wantFemale }) => {
        const scenes = window.customScenes || [];
        const isF = (s) => {
          const id = String((s && s.id) || '');
          const mid = String((s && s.meta && (s.meta.modelId || s.meta.modelLabel)) || '');
          const url = String((((s && s.items) || [])[0] || {}).url || '');
          return /female_05|女05/i.test(id) || /female_05|女05/i.test(mid) || /女中青年_05|女05/i.test(url);
        };
        const isD = (s) => {
          const url = String((((s && s.items) || [])[0] || {}).url || '');
          if (/大本|蝙蝠侠|布鲁斯/i.test(url)) return true;
          return !isF(s);
        };
        const cands = [];
        for (let i = 0; i < scenes.length; i++) {
          const s = scenes[i];
          if (!s) continue;
          const sl = String((s.meta && s.meta.slot) || '');
          if (sl !== slot) continue;
          if (wantFemale ? isF(s) : isD(s)) cands.push(i);
        }
        // 兜底：按文件名前缀语义——同 slot 多个时 prefer url
        if (cands.length === 1) return cands[0];
        if (cands.length > 1) {
          // 大本优先 URL 含大本；女05 优先 URL 含女
          const scored = cands.map((i) => {
            const url = String((((scenes[i].items || [])[0] || {}).url) || '');
            let score = 0;
            if (wantFemale && /女中青年_05/.test(url)) score += 10;
            if (!wantFemale && /大本|蝙蝠侠/.test(url)) score += 10;
            return { i, score };
          });
          scored.sort((a, b) => b.score - a.score);
          return scored[0].i;
        }
        return -1;
      },
      { slot, wantFemale }
    );

    if (idx < 0) {
      console.warn('MISS', slot);
      manifest.shots.push({ slot, ok: false, error: 'not_found' });
      continue;
    }

    await page.evaluate((i) => {
      window.currentSceneIndex = -1;
      window.switchScene(i);
    }, idx);
    await waitLoaderGone(page);
    // mesh（最多 ~5s）
    for (let t = 0; t < 20; t++) {
      const n = await page.evaluate(() => {
        let c = 0;
        try {
          window.__solidHost.getSceneGroup().traverse((o) => {
            if (o.isMesh) c++;
          });
        } catch (_e) {}
        return c;
      });
      if (n > 0) break;
      await page.waitForTimeout(250);
    }
    await page.waitForTimeout(300);
    await stabilize(page);

    const meta = await page.evaluate(() => {
      const s = (window.customScenes || [])[window.currentSceneIndex] || {};
      const it = (s.items || [])[0] || {};
      return {
        id: s.id,
        name: s.name,
        slot: s.meta && s.meta.slot,
        url: it.url || '',
        ann: (it.annotations || []).map((a) => a.text),
        dash: (it.dashedLines || []).length,
        light: s.light,
        detail: s.meta && s.meta.detail,
        keyPoints: s.meta && s.meta.keyPoints,
      };
    });
    fs.writeFileSync(path.join(outDir, `${slot}_meta.json`), JSON.stringify(meta, null, 2));

    await setAnnotations(page, true);
    await stabilize(page);
    const annoPath = path.join(outDir, `${slot}_anno.png`);
    await shotCropOrFull(page, annoPath);
    console.log('anno', slot, meta.name);

    const isLight = String(slot).startsWith('L');
    let cleanPath = null;
    const wantClean = isLight && process.env.SKIP_CLEAN !== '1';
    if (wantClean) {
      await setAnnotations(page, false);
      await stabilize(page);
      cleanPath = path.join(outDir, `${slot}_clean.png`);
      await shotCropOrFull(page, cleanPath);
      console.log('clean', slot);
      await setAnnotations(page, true);
    }

    manifest.shots.push({
      slot,
      ok: true,
      id: meta.id,
      name: meta.name,
      url: meta.url,
      ann: meta.ann,
      dash: meta.dash,
      anno: path.basename(annoPath),
      clean: cleanPath ? path.basename(cleanPath) : null,
    });
  }

  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
  console.log('OUT', outDir);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
