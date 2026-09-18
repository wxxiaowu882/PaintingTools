/**
 * 隔离调查：正前90 / 正后270 头侧交界是否应重合。
 * 逐项关掉：天光、大小软化、交界补丁强度；扫描点②高度上的明暗跃迁 x。
 * PORT=18080 node scripts/terminator-frontback-isolate.js
 */
require('./_playwright-browsers-path');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PORT = process.env.PORT || '18080';
const OUT = path.join(__dirname, '..', 'runs', 'terminator-frontback-isolate');
const BASE = `http://127.0.0.1:${PORT}`;

function ensureDir(d) {
  fs.mkdirSync(d, { recursive: true });
}

async function main() {
  ensureDir(OUT);
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(120000);

  await page.goto(`${BASE}/Solid?sandbox=headform&skipPerf=1&_=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 90000,
  });
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    window.useAdvancedRender = false;
    window.perfTestDone = true;
    if (window.loadJSONData) window.loadJSONData();
  });
  await page.waitForFunction(
    () => (window.customScenes || []).length > 0 && window.__solidHost && window.__solidHost.getTHREE,
    null,
    { timeout: 120000 }
  );

  await page.evaluate(() => {
    const m = document.getElementById('scene-grid-modal');
    if (m) m.style.display = 'none';
    const scenes = window.customScenes || [];
    let i = scenes.findIndex((s) => s && s.id === 'L09_female_05');
    if (i < 0) i = scenes.findIndex((s) => s && s.id === 'L09');
    window.currentSceneIndex = -1;
    if (i >= 0) window.switchScene(i);
  });

  for (let k = 0; k < 120; k++) {
    const st = await page.evaluate(() => {
      let n = 0;
      try {
        window.__solidHost.getSceneGroup().traverse((o) => {
          if (o.isMesh) n++;
        });
      } catch (_e) {}
      return { n, loading: !!window.isLoadingScene };
    });
    if (st.n > 0 && !st.loading) break;
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    try {
      if (window.resetAll) window.resetAll();
    } catch (_e) {}
    try {
      if (window.stopRender) window.stopRender();
    } catch (_e2) {}
    window.useAdvancedRender = false;
    const el = document.getElementById('scene-loader');
    if (el) {
      el.style.display = 'none';
      el.style.opacity = '0';
    }
    window.showAnnotations = true;
  });
  await page.waitForTimeout(800);

  // 固定侧视相机（与场景接近的侧视，便于看耳上头侧）
  await page.evaluate(() => {
    const host = window.__solidHost;
    const cam = host.getCamera();
    const controls = host.getControls && host.getControls();
    cam.position.set(18, 2.2, -0.2);
    cam.fov = 5;
    cam.zoom = 0.56;
    cam.updateProjectionMatrix();
    if (controls) {
      controls.target.set(0.05, 0.9, -0.05);
      controls.update();
    }
    cam.lookAt(0.05, 0.9, -0.05);
  });

  async function applyCondition(cond) {
    await page.evaluate((c) => {
      const host = window.__solidHost;
      const THREE = host.getTHREE();

      // 天光
      window.envSkyLightScale = c.sky;
      try {
        if (window.SkyEnvLight) {
          if (window.SkyEnvLight.setScale) window.SkyEnvLight.setScale(c.sky);
          if (window.SkyEnvLight.sync) window.SkyEnvLight.sync(host.getScene());
          // 强关：直接拆掉天顶 Rect
          if (c.sky <= 0 && window.SkyEnvLight._skyRect) {
            const sc = host.getScene();
            sc.remove(window.SkyEnvLight._skyRect);
            window.SkyEnvLight._skyRect = null;
          }
        }
      } catch (_e) {}
      // 再扫一遍场景里的 SkyFill
      try {
        const sc = host.getScene();
        const kill = [];
        sc.traverse((o) => {
          if (o.isRectAreaLight && (o.userData && o.userData.isSkyFillLight || o.name === 'SkyFillRectAreaLight')) kill.push(o);
        });
        kill.forEach((o) => sc.remove(o));
      } catch (_e2) {}

      // 大小
      const sizeEl = document.getElementById('lightSize');
      if (sizeEl) {
        sizeEl.value = String(c.size);
        sizeEl.dispatchEvent(new Event('input', { bubbles: true }));
        sizeEl.dispatchEvent(new Event('change', { bubbles: true }));
      }

      // 平行光 + 球坐标瞄原点（严格对跖）
      const fake = document.createElement('div');
      document.createElement('div').appendChild(fake);
      if (typeof window.selectCustomOpt === 'function') {
        // 先切 dir
        const dirOpt = Array.from(document.querySelectorAll('#light-options .custom-option')).find((el) =>
          /平行|dir/i.test(el.textContent + (el.getAttribute('onclick') || ''))
        );
        if (dirOpt) dirOpt.click();
        window.selectCustomOpt('lightDir', '90,0', 'qa', fake);
      }

      // 强制平行光 target 原点（对跖）
      let mainLight = null;
      host.getScene().traverse((o) => {
        if (!mainLight && o.isDirectionalLight) mainLight = o;
      });
      if (mainLight && mainLight.target) {
        mainLight.target.position.set(0, 0, 0);
        mainLight.target.updateMatrixWorld(true);
        mainLight.updateMatrixWorld(true);
      }

      // 关阴影（排除投影干扰）
      if (c.noShadow && mainLight) {
        mainLight.castShadow = false;
      }

      // 软交界补丁：strength→0
      try {
        const sg = host.getSceneGroup();
        sg.traverse((obj) => {
          if (!obj.isMesh) return;
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach((m) => {
            if (!m || !m.userData) return;
            if (m.userData.uSolidTermStrength) {
              m.userData.uSolidTermStrength.value = c.termStrength;
            }
            if (c.termStrength <= 0 && m.userData.uSolidTermSizeT) {
              m.userData.uSolidTermSizeT.value = 0;
            }
          });
        });
      } catch (_e3) {}

      // 环境光尽量压掉（若有）
      try {
        host.getScene().traverse((o) => {
          if (o.isAmbientLight) o.intensity = c.ambient;
          if (o.isHemisphereLight) o.intensity = c.ambient;
        });
      } catch (_e4) {}

      window.needsUpdate = true;
      window.lightMoved = true;
      try {
        if (window.__solidPreviewLighting && window.__solidPreviewLighting.syncShadows) {
          window.__solidPreviewLighting.syncShadows();
        }
      } catch (_e5) {}
      try {
        if (typeof window._solidTryRasterPreviewDraw === 'function') window._solidTryRasterPreviewDraw();
      } catch (_e6) {}
    }, cond);
    await page.waitForTimeout(400);
  }

  async function setAz(az) {
    await page.evaluate((azimuth) => {
      const host = window.__solidHost;
      const fake = document.createElement('div');
      document.createElement('div').appendChild(fake);
      if (typeof window.selectCustomOpt === 'function') {
        window.selectCustomOpt('lightDir', String(azimuth) + ',0', 'qa', fake);
      } else {
        const elAz = document.getElementById('lightAzimuth');
        const elEl = document.getElementById('lightElevation');
        if (elEl) {
          elEl.value = '0';
          elEl.dispatchEvent(new Event('input', { bubbles: true }));
        }
        if (elAz) {
          elAz.value = String(azimuth);
          elAz.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
      // 再钉 target 原点 + 软交界强度（selectCustomOpt 可能冲掉）
      let mainLight = null;
      host.getScene().traverse((o) => {
        if (!mainLight && o.isDirectionalLight) mainLight = o;
      });
      if (mainLight && mainLight.target) {
        mainLight.target.position.set(0, 0, 0);
        mainLight.target.updateMatrixWorld(true);
        mainLight.updateMatrixWorld(true);
      }
      try {
        const sg = host.getSceneGroup();
        const ts = window.__qaTermStrength;
        if (typeof ts === 'number') {
          sg.traverse((obj) => {
            if (!obj.isMesh) return;
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            mats.forEach((m) => {
              if (m && m.userData && m.userData.uSolidTermStrength) m.userData.uSolidTermStrength.value = ts;
              if (ts <= 0 && m && m.userData && m.userData.uSolidTermSizeT) m.userData.uSolidTermSizeT.value = 0;
            });
          });
        }
      } catch (_e) {}
      window.needsUpdate = true;
      window.lightMoved = true;
      try {
        if (typeof window._solidTryRasterPreviewDraw === 'function') window._solidTryRasterPreviewDraw();
      } catch (_e2) {}
    }, az);
    await page.waitForTimeout(600);
  }

  async function measurePair(tag) {
    const out = { tag, az90: null, az270: null };

    await setAz(90);
    out.az90 = await page.evaluate(() => {
      const host = window.__solidHost;
      const THREE = host.getTHREE();
      const canvas = document.querySelector('canvas');
      const sceneData = (window.customScenes || [])[window.currentSceneIndex];
      let anno2 = null;
      for (const it of sceneData.items || []) {
        anno2 = (it.annotations || []).find((a) => String(a.text) === '2');
        if (anno2) break;
      }
      let meshRoot = null;
      host.getSceneGroup().children.forEach((c) => {
        if (c.userData && (c.userData.type === 'glb' || c.userData.url)) meshRoot = c;
      });
      meshRoot.updateMatrixWorld(true);
      const wp = new THREE.Vector3().fromArray(anno2.localPos);
      meshRoot.localToWorld(wp);
      const cam = host.getCamera();
      const scr = wp.clone().project(cam);
      const rect = canvas.getBoundingClientRect();
      const cx = (scr.x * 0.5 + 0.5) * rect.width;
      const cy = (-scr.y * 0.5 + 0.5) * rect.height;

      // 读 canvas 一行
      const c2 = document.createElement('canvas');
      c2.width = canvas.width;
      c2.height = canvas.height;
      const ctx = c2.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(canvas, 0, 0);
      const sx = canvas.width / rect.width;
      const sy = canvas.height / rect.height;
      const row = Math.round(cy * sy);
      const y = Math.max(0, Math.min(c2.height - 1, row));
      const w = c2.width;
      const data = ctx.getImageData(0, y, w, 1).data;
      const lums = [];
      for (let x = 0; x < w; x++) {
        const i = x * 4;
        lums.push(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
      }
      // 在头侧附近窗口找最大梯度（交界）
      const x0 = Math.max(2, Math.round((cx - 120) * sx));
      const x1 = Math.min(w - 3, Math.round((cx + 120) * sx));
      let bestX = x0;
      let bestG = -1;
      for (let x = x0; x <= x1; x++) {
        const g = Math.abs(lums[x + 2] - lums[x - 2]);
        if (g > bestG) {
          bestG = g;
          bestX = x;
        }
      }
      // 也找 50% 亮度阈值交叉
      let minL = 1e9;
      let maxL = -1;
      for (let x = x0; x <= x1; x++) {
        minL = Math.min(minL, lums[x]);
        maxL = Math.max(maxL, lums[x]);
      }
      const mid = (minL + maxL) * 0.5;
      let crossX = null;
      for (let x = x0; x < x1; x++) {
        if ((lums[x] - mid) * (lums[x + 1] - mid) <= 0) {
          crossX = x;
          break;
        }
      }

      let mainLight = null;
      host.getScene().traverse((o) => {
        if (!mainLight && o.isDirectionalLight) mainLight = o;
      });
      const L = mainLight
        ? mainLight.position.clone().sub(mainLight.target.position).normalize()
        : null;
      const localN = new THREE.Vector3().fromArray(anno2.localNormal);
      const nm = new THREE.Matrix3().getNormalMatrix(meshRoot.matrixWorld);
      const worldN = localN.clone().applyMatrix3(nm).normalize();
      const ndl = L ? worldN.dot(L) : null;

      const lights = [];
      host.getScene().traverse((o) => {
        if (o.isLight && o.visible && o.intensity > 0.001) {
          lights.push({ type: o.type, name: o.name, intensity: +o.intensity.toFixed(3), castShadow: !!o.castShadow });
        }
      });

      return {
        az: 90,
        anno2css: { cx, cy },
        termGradX: bestX / sx,
        termCrossX: crossX != null ? crossX / sx : null,
        grad: +bestG.toFixed(2),
        minL: +minL.toFixed(2),
        maxL: +maxL.toFixed(2),
        lumAt2: +lums[Math.round(cx * sx)].toFixed(2),
        ndl: ndl != null ? +ndl.toFixed(6) : null,
        L: L ? [+L.x.toFixed(4), +L.y.toFixed(4), +L.z.toFixed(4)] : null,
        lights,
        sizeUI: document.getElementById('lightSize') && document.getElementById('lightSize').value,
        sky: window.envSkyLightScale,
      };
    });
    await page.screenshot({ path: path.join(OUT, `${tag}_az90.png`) });

    await setAz(270);
    out.az270 = await page.evaluate(() => {
      const host = window.__solidHost;
      const THREE = host.getTHREE();
      const canvas = document.querySelector('canvas');
      const sceneData = (window.customScenes || [])[window.currentSceneIndex];
      let anno2 = null;
      for (const it of sceneData.items || []) {
        anno2 = (it.annotations || []).find((a) => String(a.text) === '2');
        if (anno2) break;
      }
      let meshRoot = null;
      host.getSceneGroup().children.forEach((c) => {
        if (c.userData && (c.userData.type === 'glb' || c.userData.url)) meshRoot = c;
      });
      meshRoot.updateMatrixWorld(true);
      const wp = new THREE.Vector3().fromArray(anno2.localPos);
      meshRoot.localToWorld(wp);
      const cam = host.getCamera();
      const scr = wp.clone().project(cam);
      const rect = canvas.getBoundingClientRect();
      const cx = (scr.x * 0.5 + 0.5) * rect.width;
      const cy = (-scr.y * 0.5 + 0.5) * rect.height;
      const c2 = document.createElement('canvas');
      c2.width = canvas.width;
      c2.height = canvas.height;
      const ctx = c2.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(canvas, 0, 0);
      const sx = canvas.width / rect.width;
      const sy = canvas.height / rect.height;
      const row = Math.round(cy * sy);
      const y = Math.max(0, Math.min(c2.height - 1, row));
      const w = c2.width;
      const data = ctx.getImageData(0, y, w, 1).data;
      const lums = [];
      for (let x = 0; x < w; x++) {
        const i = x * 4;
        lums.push(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
      }
      const x0 = Math.max(2, Math.round((cx - 120) * sx));
      const x1 = Math.min(w - 3, Math.round((cx + 120) * sx));
      let bestX = x0;
      let bestG = -1;
      for (let x = x0; x <= x1; x++) {
        const g = Math.abs(lums[x + 2] - lums[x - 2]);
        if (g > bestG) {
          bestG = g;
          bestX = x;
        }
      }
      let minL = 1e9;
      let maxL = -1;
      for (let x = x0; x <= x1; x++) {
        minL = Math.min(minL, lums[x]);
        maxL = Math.max(maxL, lums[x]);
      }
      const mid = (minL + maxL) * 0.5;
      let crossX = null;
      for (let x = x0; x < x1; x++) {
        if ((lums[x] - mid) * (lums[x + 1] - mid) <= 0) {
          crossX = x;
          break;
        }
      }
      let mainLight = null;
      host.getScene().traverse((o) => {
        if (!mainLight && o.isDirectionalLight) mainLight = o;
      });
      const L = mainLight
        ? mainLight.position.clone().sub(mainLight.target.position).normalize()
        : null;
      const localN = new THREE.Vector3().fromArray(anno2.localNormal);
      const nm = new THREE.Matrix3().getNormalMatrix(meshRoot.matrixWorld);
      const worldN = localN.clone().applyMatrix3(nm).normalize();
      const ndl = L ? worldN.dot(L) : null;
      const lights = [];
      host.getScene().traverse((o) => {
        if (o.isLight && o.visible && o.intensity > 0.001) {
          lights.push({ type: o.type, name: o.name, intensity: +o.intensity.toFixed(3), castShadow: !!o.castShadow });
        }
      });
      return {
        az: 270,
        anno2css: { cx, cy },
        termGradX: bestX / sx,
        termCrossX: crossX != null ? crossX / sx : null,
        grad: +bestG.toFixed(2),
        minL: +minL.toFixed(2),
        maxL: +maxL.toFixed(2),
        lumAt2: +lums[Math.round(cx * sx)].toFixed(2),
        ndl: ndl != null ? +ndl.toFixed(6) : null,
        L: L ? [+L.x.toFixed(4), +L.y.toFixed(4), +L.z.toFixed(4)] : null,
        lights,
        sizeUI: document.getElementById('lightSize') && document.getElementById('lightSize').value,
        sky: window.envSkyLightScale,
      };
    });
    await page.screenshot({ path: path.join(OUT, `${tag}_az270.png`) });

    const dxGrad = Math.abs(out.az90.termGradX - out.az270.termGradX);
    const dxCross =
      out.az90.termCrossX != null && out.az270.termCrossX != null
        ? Math.abs(out.az90.termCrossX - out.az270.termCrossX)
        : null;
    out.compare = {
      dxGradPx: +dxGrad.toFixed(1),
      dxCrossPx: dxCross != null ? +dxCross.toFixed(1) : null,
      sameLine: dxGrad < 8 || (dxCross != null && dxCross < 8),
      ndlSum: +(out.az90.ndl + out.az270.ndl).toFixed(6),
      Ldot:
        out.az90.L && out.az270.L
          ? +(
              out.az90.L[0] * out.az270.L[0] +
              out.az90.L[1] * out.az270.L[1] +
              out.az90.L[2] * out.az270.L[2]
            ).toFixed(6)
          : null,
    };
    return out;
  }

  const conditions = [
    { id: 'A_baseline', sky: 0.18, size: 7, termStrength: 0.82, noShadow: false, ambient: 0.05 },
    { id: 'B_sizeMin', sky: 0.18, size: 1, termStrength: 0.82, noShadow: false, ambient: 0.05 },
    { id: 'C_sizeMin_sky0', sky: 0, size: 1, termStrength: 0.82, noShadow: false, ambient: 0 },
    { id: 'D_hard_sky0', sky: 0, size: 1, termStrength: 0, noShadow: false, ambient: 0 },
    { id: 'E_hard_sky0_noshadow', sky: 0, size: 1, termStrength: 0, noShadow: true, ambient: 0 },
  ];

  const results = [];
  for (const c of conditions) {
    console.log('COND', c.id);
    await page.evaluate((ts) => {
      window.__qaTermStrength = ts;
    }, c.termStrength);
    await applyCondition(c);
    // 再设一次 strength（apply 里已设，setAz 也会再设）
    const pair = await measurePair(c.id);
    pair.condition = c;
    results.push(pair);
    console.log(JSON.stringify(pair.compare));
  }

  const report = {
    summary: results.map((r) => ({
      id: r.condition.id,
      sameLine: r.compare.sameLine,
      dxGradPx: r.compare.dxGradPx,
      dxCrossPx: r.compare.dxCrossPx,
      Ldot: r.compare.Ldot,
      ndlSum: r.compare.ndlSum,
      lum90: r.az90.lumAt2,
      lum270: r.az270.lumAt2,
      lights90: r.az90.lights,
    })),
    results,
  };
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.summary, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
