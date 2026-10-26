/**
 * 验收：经典引出线 + 取色引线按相机距离离散三档缩放
 * PORT=18080 PLAYWRIGHT_CHANNEL=msedge node scripts/qa-label-dist-tier-scale.js
 */
require('./_playwright-browsers-path');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PORT = process.env.PORT || '18080';
const BASE = process.env.BASE_URL || `http://127.0.0.1:${PORT}`;
const outDir = path.join(__dirname, '..', 'runs', 'qa-label-dist-tier');

async function waitList(page) {
  await page.waitForFunction(() => {
    const loader = document.getElementById('scene-loader');
    const modal = document.getElementById('scene-grid-modal');
    const loaderGone = !loader || loader.style.display === 'none' || getComputedStyle(loader).display === 'none';
    const modalOn = modal && (modal.style.display === 'flex' || getComputedStyle(modal).display === 'flex');
    return loaderGone && modalOn && document.querySelectorAll('#scene-grid-container .scene-item').length > 0;
  }, null, { timeout: 120000 });
}

async function waitInScene(page) {
  await page.waitForFunction(() => {
    const loader = document.getElementById('scene-loader');
    const modal = document.getElementById('scene-grid-modal');
    const modalOff = !modal || modal.style.display === 'none';
    const loaderGone = !loader || loader.style.display === 'none' || Number(loader.style.opacity || '1') < 0.08;
    return modalOff && Number(window.currentSceneIndex) >= 0 && !window.isLoadingScene && loaderGone;
  }, null, { timeout: 240000 });
  await page.waitForTimeout(1200);
}

async function enterByMatch(page, predSrc) {
  const idx = await page.evaluate((src) => {
    // eslint-disable-next-line no-new-func
    const pred = new Function('s', 'return (' + src + ')(s);');
    const scenes = window.customScenes || [];
    return scenes.findIndex((s) => s && pred(s));
  }, predSrc);
  if (idx < 0) throw new Error('scene not found: ' + predSrc);
  await page.evaluate((i) => {
    if (typeof window.switchScene === 'function') window.switchScene(i);
  }, idx);
  await waitInScene(page);
  return idx;
}

/** 沿相机→锚点方向缩放相机距离（相对 baseDist 的倍数）；不用全局 THREE */
async function setCamDistRatio(page, ratio) {
  return page.evaluate((r) => {
    const cam = window.camera || (window.AnnotationManager && window.AnnotationManager._cachedCamera);
    const list = window.annoDataList || [];
    const data = list.find((a) => a && a.anchorObj && a.baseDist);
    if (!cam || !data) return { ok: false, reason: 'no cam/anno' };
    // Object3D.getWorldPosition 需要带 set 的目标；用 cam.position.clone 作 scratch
    const anchor = cam.position.clone();
    data.anchorObj.getWorldPosition(anchor);
    const base = data.baseDist;
    let dx = cam.position.x - anchor.x;
    let dy = cam.position.y - anchor.y;
    let dz = cam.position.z - anchor.z;
    let len = Math.hypot(dx, dy, dz);
    if (len < 1e-8) { dx = 0; dy = 0; dz = 1; len = 1; }
    dx /= len; dy /= len; dz /= len;
    const d = base * r;
    cam.position.set(anchor.x + dx * d, anchor.y + dy * d, anchor.z + dz * d);
    cam.updateMatrixWorld(true);
    if (window.controls && typeof window.controls.update === 'function') window.controls.update();
    if (window.AnnotationManager && typeof window.AnnotationManager.updateScreenPositions === 'function') {
      window.AnnotationManager.updateScreenPositions(cam);
    }
    if (window.ColorSampleAnnotationManager && typeof window.ColorSampleAnnotationManager.updateScreenPositions === 'function') {
      window.ColorSampleAnnotationManager.updateScreenPositions(cam);
    }
    const actualDist = Math.hypot(
      cam.position.x - anchor.x,
      cam.position.y - anchor.y,
      cam.position.z - anchor.z
    );
    return {
      ok: true,
      targetRatio: r,
      actualDist,
      baseDist: base,
      actualRatio: actualDist / base
    };
  }, ratio);
}

async function sampleScales(page) {
  return page.evaluate(() => {
    const parseScale = (tr) => {
      const m = String(tr || '').match(/scale\(\s*([0-9.]+)\s*\)/i);
      return m ? Number(m[1]) : null;
    };
    const classic = (window.annoDataList || []).slice(0, 8).map((a) => ({
      id: a.id,
      text: String(a.text || '').slice(0, 24),
      tier: a._labelScaleTier,
      baseDist: a.baseDist,
      transformScale: a.domEl ? parseScale(a.domEl.style.transform) : null
    }));
    const cs = (window.colorSampleAnnoList || []).slice(0, 8).map((a) => ({
      id: a.id,
      text: String((a.labelText || a.text || '')).slice(0, 24),
      tier: a._labelScaleTier,
      baseDist: a.baseDist,
      transformScale: a.domLabel ? parseScale(a.domLabel.style.transform) : null,
      endR: a.svgEnd ? Number(a.svgEnd.getAttribute('r')) : null
    }));
    const helperOk = !!(window.AnnotationManager && typeof window.AnnotationManager.resolveDiscreteLabelScale === 'function');
    return { helperOk, classic, cs };
  });
}

async function shot(page, name) {
  const p = path.join(outDir, name);
  await page.screenshot({ path: p, fullPage: false });
  return p;
}

function expectTier(samples, wantTier, wantScale) {
  const rows = (samples.classic || []).filter((r) => r.transformScale != null);
  if (!rows.length) return { ok: false, reason: 'no classic labels' };
  const bad = rows.filter((r) => r.tier !== wantTier || Math.abs(r.transformScale - wantScale) > 0.02);
  return {
    ok: bad.length === 0,
    n: rows.length,
    sample: rows[0],
    bad: bad.slice(0, 3)
  };
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true
  });
  const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
  page.setDefaultTimeout(120000);
  const out = { shots: {}, cams: {}, samples: {} };

  await page.goto(`${BASE}/Solid?sandbox=geometry`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await waitList(page);
  out.geoIdx = await enterByMatch(
    page,
    "s => /球体/.test(String(s.name||'')) && /最[深暗]处探讨/.test(String(s.name||''))"
  );

  // 近：ratio≈1 → tier0 scale1
  out.cams.near = await setCamDistRatio(page, 1.0);
  await page.waitForTimeout(200);
  out.samples.near = await sampleScales(page);
  out.shots.near = await shot(page, '01-classic-near.png');
  out.checkNear = expectTier(out.samples.near, 0, 1.0);

  // 中：越过 ENTER[0]=1.22
  out.cams.mid = await setCamDistRatio(page, 1.35);
  await page.waitForTimeout(200);
  out.samples.mid = await sampleScales(page);
  out.shots.mid = await shot(page, '02-classic-mid.png');
  out.checkMid = expectTier(out.samples.mid, 1, 0.84);

  // 远：越过 ENTER[1]=1.50
  out.cams.far = await setCamDistRatio(page, 1.75);
  await page.waitForTimeout(200);
  out.samples.far = await sampleScales(page);
  out.shots.far = await shot(page, '03-classic-far.png');
  out.checkFar = expectTier(out.samples.far, 2, 0.7);

  // 滞回：从远拉回 1.42（仍应留在远档，EXIT far=1.38）
  out.cams.hystFar = await setCamDistRatio(page, 1.42);
  await page.waitForTimeout(150);
  out.samples.hystFar = await sampleScales(page);
  out.checkHystFar = expectTier(out.samples.hystFar, 2, 0.7);

  // 再拉到 1.30 → 中档
  out.cams.hystMid = await setCamDistRatio(page, 1.30);
  await page.waitForTimeout(150);
  out.samples.hystMid = await sampleScales(page);
  out.checkHystMid = expectTier(out.samples.hystMid, 1, 0.84);

  // 取色引线：几何沙盒色彩课（如同色三性）
  out.csIdx = await enterByMatch(page, "s => /同色三性/.test(String(s.name||''))");
  await page.waitForTimeout(400);
  out.csCount = await page.evaluate(() => (window.colorSampleAnnoList || []).length);
  // 用 CS 自身锚点设远距（不依赖经典 list）
  out.cams.csFar = await page.evaluate(() => {
    const cam = window.AnnotationManager && window.AnnotationManager._cachedCamera;
    const list = window.colorSampleAnnoList || [];
    const data = list.find((a) => a && a.anchorObj);
    if (!cam || !data) return { ok: false, reason: 'no cs', n: list.length };
    const anchor = cam.position.clone();
    data.anchorObj.getWorldPosition(anchor);
    if (!data.baseDist) {
      data.baseDist = Math.max(Math.hypot(
        cam.position.x - anchor.x,
        cam.position.y - anchor.y,
        cam.position.z - anchor.z
      ), 0.1);
      data.baseScale = data.anchorObj.parent ? data.anchorObj.parent.scale.x : 1;
    }
    const base = data.baseDist;
    let dx = cam.position.x - anchor.x;
    let dy = cam.position.y - anchor.y;
    let dz = cam.position.z - anchor.z;
    let len = Math.hypot(dx, dy, dz) || 1;
    dx /= len; dy /= len; dz /= len;
    const d = base * 1.75;
    cam.position.set(anchor.x + dx * d, anchor.y + dy * d, anchor.z + dz * d);
    cam.updateMatrixWorld(true);
    if (window.controls) window.controls.update();
    if (window.ColorSampleAnnotationManager) {
      window.ColorSampleAnnotationManager.updateScreenPositions(cam);
    }
    return { ok: true, n: list.length, baseDist: base, actualRatio: 1.75 };
  });
  await page.waitForTimeout(200);
  out.samples.csFar = await sampleScales(page);
  out.shots.csFar = await shot(page, '04-cs-far.png');
  {
    const END_R = 19;
    const csRows = (out.samples.csFar.cs || []).filter((r) => r.transformScale != null);
    out.checkCsFar = {
      ok: csRows.length > 0 && csRows.every((r) =>
        r.tier === 2
        && Math.abs(r.transformScale - 0.7) < 0.02
        && r.endR != null
        && Math.abs(r.endR - END_R * 0.7) < 0.05
      ),
      n: csRows.length,
      sample: csRows[0] || null
    };
  }

  out.ok = !!(
    out.samples.near && out.samples.near.helperOk
    && out.checkNear && out.checkNear.ok
    && out.checkMid && out.checkMid.ok
    && out.checkFar && out.checkFar.ok
    && out.checkHystFar && out.checkHystFar.ok
    && out.checkHystMid && out.checkHystMid.ok
    && out.checkCsFar && out.checkCsFar.ok
  );

  await browser.close();
  console.log(JSON.stringify(out, null, 2));
  if (!out.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
