/**
 * 实测 el=0 下 az90 vs az270：光向量是否对跖、点② N·L、截图像素。
 * 页：Solid?sandbox=headform（与生产端共用 SolidLightControlShared / PreviewLighting）
 * PORT=18080 node scripts/terminator-90-270-probe.js
 */
require('./_playwright-browsers-path');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PORT = process.env.PORT || '18080';
const OUT = path.join(__dirname, '..', 'runs', 'terminator-90-270');
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
    () => (window.customScenes || []).length > 0 && window.__solidHost,
    null,
    { timeout: 120000 }
  );

  const scenePick = await page.evaluate(() => {
    const m = document.getElementById('scene-grid-modal');
    if (m) m.style.display = 'none';
    const scenes = window.customScenes || [];
    let i = scenes.findIndex((s) => s && s.id === 'L09_female_05');
    if (i < 0) i = scenes.findIndex((s) => s && s.id === 'L09');
    if (i < 0) {
      i = scenes.findIndex((s) => s && /背面光|背侧交界B|209/.test(String(s.name || '') + String(s.id || '')));
    }
    const s = scenes[i];
    window.currentSceneIndex = -1;
    if (i >= 0) window.switchScene(i);
    return { i, id: s && s.id, name: s && s.name, light: s && s.light, sky: s && s.env && s.env.skyLightScale };
  });
  console.log('scene', scenePick);

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
  await page.waitForTimeout(1500);
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
  });
  await page.waitForTimeout(700);

  // 关天光；用滑条设平行光（Solid 的 state 不在 window 上）
  await page.evaluate(() => {
    window.envSkyLightScale = 0;
    try {
      if (window.SkyEnvLight) {
        if (typeof window.SkyEnvLight.setScale === 'function') window.SkyEnvLight.setScale(0);
        if (typeof window.SkyEnvLight.sync === 'function') window.SkyEnvLight.sync();
      }
    } catch (_e) {}
    // 切平行光
    try {
      const opt = document.querySelector("#light-options .custom-option[onclick*='dir'], #light-options .custom-option");
      // 用 selectCustomOpt 若存在
      const fake = document.createElement('div');
      const parent = document.createElement('div');
      parent.appendChild(fake);
      fake.parentElement.querySelectorAll = () => [];
      if (typeof window.selectCustomOpt === 'function') {
        // light type — find dir option
        const dirOpt = Array.from(document.querySelectorAll('#light-options .custom-option')).find((el) =>
          /平行|dir/i.test(el.textContent + (el.getAttribute('onclick') || ''))
        );
        if (dirOpt && dirOpt.onclick) dirOpt.click();
      }
    } catch (_e2) {}
    const elEl = document.getElementById('lightElevation');
    if (elEl) {
      elEl.value = '0';
      elEl.dispatchEvent(new Event('input', { bubbles: true }));
      elEl.dispatchEvent(new Event('change', { bubbles: true }));
    }
    window.needsUpdate = true;
    window.lightMoved = true;
  });
  await page.waitForTimeout(500);

  async function measure(az) {
    return page.evaluate((azimuth) => {
      const host = window.__solidHost;
      const THREE = host && host.getTHREE ? host.getTHREE() : null;
      if (!THREE) return { err: 'no getTHREE' };

      const elEl = document.getElementById('lightElevation');
      if (elEl) {
        elEl.value = '0';
        elEl.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const elAz = document.getElementById('lightAzimuth');
      if (elAz) {
        elAz.value = String(azimuth);
        elAz.dispatchEvent(new Event('input', { bubbles: true }));
        elAz.dispatchEvent(new Event('change', { bubbles: true }));
      }
      // 预设入口更稳：lightDir
      try {
        if (typeof window.selectCustomOpt === 'function') {
          const fake = document.createElement('div');
          const wrap = document.createElement('div');
          wrap.appendChild(fake);
          fake.classList.add('custom-option');
          window.selectCustomOpt('lightDir', String(azimuth) + ',0', 'qa', fake);
        }
      } catch (_eSel) {}

      window.needsUpdate = true;
      window.lightMoved = true;
      try {
        if (window.__solidPreviewLighting && window.__solidPreviewLighting.draw) {
          window.__solidPreviewLighting.draw();
        }
      } catch (_e) {}

      let mainLight = null;
      const scene = host.getScene ? host.getScene() : window.scene;
      if (scene) {
        scene.traverse((o) => {
          if (!mainLight && o.isDirectionalLight) mainLight = o;
        });
      }

      const elev = parseFloat(document.getElementById('lightElevation').value);
      const azi = parseFloat(document.getElementById('lightAzimuth').value);
      const rEl = document.getElementById('lightDistance');
      const r = rEl ? parseFloat(rEl.value) : 16;
      const phi = THREE.MathUtils.degToRad(90 - elev);
      const theta = THREE.MathUtils.degToRad(azi);
      const px = r * Math.sin(phi) * Math.cos(theta);
      const py = r * Math.cos(phi);
      const pz = r * Math.sin(phi) * Math.sin(theta);
      const formulaL = new THREE.Vector3(px, py - 1, pz).normalize();

      let L = null;
      let lightPos = null;
      if (mainLight) {
        lightPos = mainLight.position.clone();
        const t = mainLight.target ? mainLight.target.position.clone() : new THREE.Vector3(0, 1, 0);
        L = lightPos.clone().sub(t).normalize();
      }

      const sceneData = (window.customScenes || [])[window.currentSceneIndex];
      let anno2 = null;
      if (sceneData && sceneData.items) {
        for (const it of sceneData.items) {
          if (!it.annotations) continue;
          anno2 = it.annotations.find((a) => String(a.text) === '2');
          if (anno2) break;
        }
      }

      let meshRoot = null;
      try {
        host.getSceneGroup().children.forEach((c) => {
          if (c.userData && (c.userData.type === 'glb' || c.userData.url)) meshRoot = c;
        });
      } catch (_e) {}

      let worldPos = null;
      let worldN = null;
      let ndl = null;
      let ndlFormula = null;
      if (anno2 && meshRoot) {
        meshRoot.updateMatrixWorld(true);
        const localP = new THREE.Vector3().fromArray(anno2.localPos);
        const localN = new THREE.Vector3().fromArray(anno2.localNormal);
        worldPos = localP.clone();
        meshRoot.localToWorld(worldPos);
        const nm = new THREE.Matrix3().getNormalMatrix(meshRoot.matrixWorld);
        worldN = localN.clone().applyMatrix3(nm).normalize();
        if (L) ndl = worldN.dot(L);
        ndlFormula = worldN.dot(formulaL);
      }

      let hitNdl = null;
      let hitN = null;
      try {
        const cam = host.getCamera();
        const group = host.getSceneGroup();
        if (cam && worldPos && group) {
          const scr = worldPos.clone().project(cam);
          const rc = new THREE.Raycaster();
          rc.setFromCamera({ x: scr.x, y: scr.y }, cam);
          const hits = rc.intersectObject(group, true);
          if (hits && hits[0] && hits[0].face) {
            const n = hits[0].face.normal.clone();
            const e = hits[0].object;
            const nm2 = new THREE.Matrix3().getNormalMatrix(e.matrixWorld);
            n.applyMatrix3(nm2).normalize();
            hitN = [+n.x.toFixed(4), +n.y.toFixed(4), +n.z.toFixed(4)];
            if (L) hitNdl = +n.dot(L).toFixed(6);
          }
        }
      } catch (_eH) {}

      const lights = [];
      if (scene) {
        scene.traverse((o) => {
          if (o.isLight && o.visible && o.intensity > 0) {
            lights.push({
              type: o.type,
              intensity: o.intensity,
              pos: o.position ? [+o.position.x.toFixed(3), +o.position.y.toFixed(3), +o.position.z.toFixed(3)] : null,
            });
          }
        });
      }

      return {
        azimuth: azi,
        elevation: elev,
        radius: r,
        lightType: mainLight && mainLight.type,
        lightPos: lightPos && [+lightPos.x.toFixed(4), +lightPos.y.toFixed(4), +lightPos.z.toFixed(4)],
        L: L && [+L.x.toFixed(6), +L.y.toFixed(6), +L.z.toFixed(6)],
        formulaL: [+formulaL.x.toFixed(6), +formulaL.y.toFixed(6), +formulaL.z.toFixed(6)],
        L_align: L ? +L.dot(formulaL).toFixed(6) : null,
        anno2: anno2 && {
          localPos: anno2.localPos,
          localNormal: anno2.localNormal,
        },
        worldPos: worldPos && [+worldPos.x.toFixed(4), +worldPos.y.toFixed(4), +worldPos.z.toFixed(4)],
        worldN: worldN && [+worldN.x.toFixed(4), +worldN.y.toFixed(4), +worldN.z.toFixed(4)],
        ndl: ndl != null ? +ndl.toFixed(6) : null,
        ndlFormula: ndlFormula != null ? +ndlFormula.toFixed(6) : null,
        hitN,
        hitNdl,
        lights,
        skyScale: window.envSkyLightScale,
        uiAz: document.getElementById('azimuthVal') && document.getElementById('azimuthVal').innerText,
        uiEl: document.getElementById('elevationVal') && document.getElementById('elevationVal').innerText,
      };
    }, az);
  }

  async function shot(name) {
    await page.evaluate(() => {
      window.showAnnotations = true;
      window.needsUpdate = true;
      window.lightMoved = true;
      try {
        if (typeof window._solidTryRasterPreviewDraw === 'function') window._solidTryRasterPreviewDraw();
      } catch (_e) {}
    });
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(OUT, name) });
  }

  async function sampleNearAnno2() {
    return page.evaluate(() => {
      const canvas = document.querySelector('canvas');
      if (!canvas) return null;
      const host = window.__solidHost;
      const THREE = host.getTHREE();
      if (!THREE) return { err: 'no THREE' };
      const sceneData = (window.customScenes || [])[window.currentSceneIndex];
      let anno2 = null;
      if (sceneData && sceneData.items) {
        for (const it of sceneData.items) {
          if (!it.annotations) continue;
          anno2 = it.annotations.find((a) => String(a.text) === '2');
          if (anno2) break;
        }
      }
      let meshRoot = null;
      try {
        host.getSceneGroup().children.forEach((c) => {
          if (c.userData && (c.userData.type === 'glb' || c.userData.url)) meshRoot = c;
        });
        if (!meshRoot) meshRoot = host.getSceneGroup();
      } catch (_e) {}
      const cam = host.getCamera();
      if (!anno2 || !meshRoot || !cam) return { err: 'no anno/cam' };
      meshRoot.updateMatrixWorld(true);
      const wp = new THREE.Vector3().fromArray(anno2.localPos);
      meshRoot.localToWorld(wp);
      const scr = wp.clone().project(cam);
      const rect = canvas.getBoundingClientRect();
      const cx = (scr.x * 0.5 + 0.5) * rect.width + rect.left;
      const cy = (-scr.y * 0.5 + 0.5) * rect.height + rect.top;
      const c2 = document.createElement('canvas');
      c2.width = canvas.width;
      c2.height = canvas.height;
      const ctx = c2.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(canvas, 0, 0);
      const sx = canvas.width / rect.width;
      const sy = canvas.height / rect.height;
      const px = Math.round((cx - rect.left) * sx);
      const py = Math.round((cy - rect.top) * sy);
      const samples = [];
      for (const [dx, dy] of [
        [0, 0],
        [-6, 0],
        [6, 0],
        [0, -6],
        [0, 6],
        [-14, 0],
        [14, 0],
        [-28, 0],
        [28, 0],
      ]) {
        const x = Math.max(0, Math.min(c2.width - 1, px + Math.round(dx * sx)));
        const y = Math.max(0, Math.min(c2.height - 1, py + Math.round(dy * sy)));
        const d = ctx.getImageData(x, y, 1, 1).data;
        samples.push({
          dx,
          dy,
          rgb: [d[0], d[1], d[2]],
          lum: +(0.2126 * d[0] + 0.7152 * d[1] + 0.0722 * d[2]).toFixed(2),
        });
      }
      return { cx, cy, px, py, samples };
    });
  }

  const m90 = await measure(90);
  await shot('az90_el0.png');
  const s90 = await sampleNearAnno2();

  const m270 = await measure(270);
  await shot('az270_el0.png');
  const s270 = await sampleNearAnno2();

  // 再测：size 尽量硬（若滑条存在）
  await page.evaluate(() => {
    if (window.state) window.state.lightSize = 0.1;
    const el = document.getElementById('lightSize');
    if (el) {
      el.value = '0.1';
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    window.lightMoved = true;
    window.needsUpdate = true;
  });
  await page.waitForTimeout(300);
  const m90hard = await measure(90);
  await shot('az90_el0_hard.png');
  const s90hard = await sampleNearAnno2();
  const m270hard = await measure(270);
  await shot('az270_el0_hard.png');
  const s270hard = await sampleNearAnno2();

  const L90 = m90.L;
  const L270 = m270.L;
  let Ldot = null;
  if (L90 && L270) Ldot = L90[0] * L270[0] + L90[1] * L270[1] + L90[2] * L270[2];

  const report = {
    scenePick,
    antipode: {
      L90_dot_L270: Ldot,
      nearlyAntipodal: Ldot != null && Math.abs(Ldot + 1) < 0.03,
    },
    m90,
    m270,
    ndl: {
      ndl90: m90.ndl,
      ndl270: m270.ndl,
      sum: m90.ndl != null && m270.ndl != null ? +(m90.ndl + m270.ndl).toFixed(6) : null,
      // 对跖时应 sum≈0 且 |ndl| 相等
      note: '若 L 对跖，ndl270 应 ≈ -ndl90，|ndl| 相同；若 |ndl|≫0 则点②本就不在几何交界上',
    },
    sample90: s90,
    sample270: s270,
    hard: {
      m90: m90hard,
      m270: m270hard,
      s90: s90hard,
      s270: s270hard,
    },
  };

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
