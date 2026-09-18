/**
 * 评估验证：平行光 target→原点（L=normalize(灯位)=球坐标单位向量）
 * 对比改前/改后 el=0 时 az90/270 的 N·L 与点②亮度。
 * PORT=18080 node scripts/terminator-sph-unit-test.js
 */
require('./_playwright-browsers-path');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PORT = process.env.PORT || '18080';
const OUT = path.join(__dirname, '..', 'runs', 'terminator-sph-unit');
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
    window.envSkyLightScale = 0;
    try {
      if (window.SkyEnvLight && window.SkyEnvLight.setScale) window.SkyEnvLight.setScale(0);
    } catch (_e3) {}
  });
  await page.waitForTimeout(600);

  // 注入：可切换平行光瞄准点；并暴露一次测量
  await page.evaluate(() => {
    window.__qaDirTargetMode = 'legacy'; // legacy=(0,1,0) | sph=(0,0,0)
    window.__qaApplyDirTarget = function() {
      const host = window.__solidHost;
      const scene = host.getScene();
      let mainLight = null;
      scene.traverse((o) => {
        if (!mainLight && o.isDirectionalLight) mainLight = o;
      });
      if (!mainLight || !mainLight.target) return null;
      if (window.__qaDirTargetMode === 'sph') {
        mainLight.target.position.set(0, 0, 0);
      } else {
        mainLight.target.position.set(0, 1, 0);
      }
      mainLight.target.updateMatrixWorld(true);
      mainLight.updateMatrixWorld(true);
      try {
        if (window.__solidPreviewLighting && window.__solidPreviewLighting.syncShadows) {
          window.__solidPreviewLighting.syncShadows();
        }
      } catch (_e) {}
      window.needsUpdate = true;
      window.lightMoved = true;
      return {
        mode: window.__qaDirTargetMode,
        target: [mainLight.target.position.x, mainLight.target.position.y, mainLight.target.position.z],
      };
    };
  });

  async function setAzEl(az, el) {
    await page.evaluate(
      ({ azimuth, elevation }) => {
        const fake = document.createElement('div');
        const wrap = document.createElement('div');
        wrap.appendChild(fake);
        if (typeof window.selectCustomOpt === 'function') {
          window.selectCustomOpt('lightDir', String(azimuth) + ',' + String(elevation), 'qa', fake);
        } else {
          const elAz = document.getElementById('lightAzimuth');
          const elEl = document.getElementById('lightElevation');
          if (elEl) {
            elEl.value = String(elevation);
            elEl.dispatchEvent(new Event('input', { bubbles: true }));
          }
          if (elAz) {
            elAz.value = String(azimuth);
            elAz.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
        // selectCustomOpt 会把 target 写回 (0,1,0)，再按当前模式重套
        if (typeof window.__qaApplyDirTarget === 'function') window.__qaApplyDirTarget();
        window.needsUpdate = true;
        window.lightMoved = true;
        try {
          if (typeof window._solidTryRasterPreviewDraw === 'function') window._solidTryRasterPreviewDraw();
        } catch (_e) {}
      },
      { azimuth: az, elevation: el }
    );
    await page.waitForTimeout(500);
  }

  async function measure() {
    return page.evaluate(() => {
      const host = window.__solidHost;
      const THREE = host.getTHREE();
      const scene = host.getScene();
      let mainLight = null;
      scene.traverse((o) => {
        if (!mainLight && o.isDirectionalLight) mainLight = o;
      });
      const elev = parseFloat(document.getElementById('lightElevation').value);
      const azi = parseFloat(document.getElementById('lightAzimuth').value);
      const r = parseFloat(document.getElementById('lightDistance').value);

      const t = mainLight.target.position.clone();
      const lp = mainLight.position.clone();
      const L = lp.clone().sub(t).normalize();

      // 球坐标单位向量（提案）
      const phi = THREE.MathUtils.degToRad(90 - elev);
      const theta = THREE.MathUtils.degToRad(azi);
      const Lsph = new THREE.Vector3(
        Math.sin(phi) * Math.cos(theta),
        Math.cos(phi),
        Math.sin(phi) * Math.sin(theta)
      ).normalize();

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
      host.getSceneGroup().children.forEach((c) => {
        if (c.userData && (c.userData.type === 'glb' || c.userData.url)) meshRoot = c;
      });
      meshRoot.updateMatrixWorld(true);
      const localP = new THREE.Vector3().fromArray(anno2.localPos);
      const localN = new THREE.Vector3().fromArray(anno2.localNormal);
      const worldPos = localP.clone();
      meshRoot.localToWorld(worldPos);
      const nm = new THREE.Matrix3().getNormalMatrix(meshRoot.matrixWorld);
      const worldN = localN.clone().applyMatrix3(nm).normalize();

      const ndl = worldN.dot(L);
      const ndlSph = worldN.dot(Lsph);

      // 像素
      const cam = host.getCamera();
      const canvas = document.querySelector('canvas');
      const scr = worldPos.clone().project(cam);
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
      const d = ctx.getImageData(
        Math.max(0, Math.min(c2.width - 1, px)),
        Math.max(0, Math.min(c2.height - 1, py)),
        1,
        1
      ).data;
      const lum = 0.2126 * d[0] + 0.7152 * d[1] + 0.0722 * d[2];

      return {
        mode: window.__qaDirTargetMode,
        azimuth: azi,
        elevation: elev,
        radius: r,
        target: [t.x, t.y, t.z],
        lightPos: [+lp.x.toFixed(4), +lp.y.toFixed(4), +lp.z.toFixed(4)],
        L: [+L.x.toFixed(6), +L.y.toFixed(6), +L.z.toFixed(6)],
        Lsph: [+Lsph.x.toFixed(6), +Lsph.y.toFixed(6), +Lsph.z.toFixed(6)],
        L_dot_Lsph: +L.dot(Lsph).toFixed(6),
        worldN: [+worldN.x.toFixed(4), +worldN.y.toFixed(4), +worldN.z.toFixed(4)],
        ndl: +ndl.toFixed(6),
        ndlSph: +ndlSph.toFixed(6),
        lum: +lum.toFixed(2),
        rgb: [d[0], d[1], d[2]],
      };
    });
  }

  async function shot(name) {
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(OUT, name) });
  }

  // —— 基线 legacy ——
  await page.evaluate(() => {
    window.__qaDirTargetMode = 'legacy';
    window.__qaApplyDirTarget();
  });
  await setAzEl(90, 0);
  const leg90 = await measure();
  await shot('legacy_az90.png');
  await setAzEl(270, 0);
  const leg270 = await measure();
  await shot('legacy_az270.png');

  // —— 提案 sph（target 原点）——
  await page.evaluate(() => {
    window.__qaDirTargetMode = 'sph';
    window.__qaApplyDirTarget();
  });
  await setAzEl(90, 0);
  const sph90 = await measure();
  await shot('sph_az90.png');
  await setAzEl(270, 0);
  const sph270 = await measure();
  await shot('sph_az270.png');

  function pairStats(a, b, key) {
    const va = a[key];
    const vb = b[key];
    return {
      a: va,
      b: vb,
      sum: +(va + vb).toFixed(6),
      absDiff: +Math.abs(Math.abs(va) - Math.abs(vb)).toFixed(6),
      antipodalNdl: Math.abs(va + vb) < 0.02 && Math.abs(Math.abs(va) - Math.abs(vb)) < 0.02,
    };
  }

  const report = {
    legacy: {
      az90: leg90,
      az270: leg270,
      L_dot: leg90.L[0] * leg270.L[0] + leg90.L[1] * leg270.L[1] + leg90.L[2] * leg270.L[2],
      ndl: pairStats(leg90, leg270, 'ndl'),
      lum: { az90: leg90.lum, az270: leg270.lum, ratio: +(leg270.lum / Math.max(leg90.lum, 0.01)).toFixed(2) },
    },
    sph: {
      az90: sph90,
      az270: sph270,
      L_dot: sph90.L[0] * sph270.L[0] + sph90.L[1] * sph270.L[1] + sph90.L[2] * sph270.L[2],
      ndl: pairStats(sph90, sph270, 'ndl'),
      ndlSphPure: pairStats(sph90, sph270, 'ndlSph'),
      lum: { az90: sph90.lum, az270: sph270.lum, ratio: +(sph270.lum / Math.max(sph90.lum, 0.01)).toFixed(2) },
      L_aligns_unit: Math.abs(sph90.L_dot_Lsph - 1) < 0.001 && Math.abs(sph270.L_dot_Lsph - 1) < 0.001,
    },
    verdict: null,
  };

  const solved =
    report.sph.ndl.antipodalNdl &&
    report.sph.L_aligns_unit &&
    Math.abs(report.sph.L_dot + 1) < 0.02 &&
    // 亮度应对称：两边都在交界附近，比值不应再差到 5 倍以上
    report.sph.lum.ratio < 2.5 &&
    report.legacy.lum.ratio > 3;

  report.verdict = {
    solved,
    note: solved
      ? '球坐标单位向量（target→原点）使 el=0 时 L 对跖、点② N·L 对跖，亮度差明显收敛'
      : '未完全达标，见 ndl/lum 细节',
  };

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
  process.exitCode = solved ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
