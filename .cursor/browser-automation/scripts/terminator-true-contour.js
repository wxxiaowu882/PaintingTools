/**
 * 在网格上可视化 N·L=0 真交界（红线），对比 az90/270 是否重合。
 * 同时输出：点②相对真交界的屏幕距离；差分图。
 * PORT=18080 node scripts/terminator-true-contour.js
 */
require('./_playwright-browsers-path');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PORT = process.env.PORT || '18080';
const OUT = path.join(__dirname, '..', 'runs', 'terminator-true-contour');
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
    window.showAnnotations = false;
  });
  await page.waitForTimeout(600);

  // 干净条件 + 固定相机
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

    window.envSkyLightScale = 0;
    try {
      if (window.SkyEnvLight && window.SkyEnvLight._skyRect) {
        host.getScene().remove(window.SkyEnvLight._skyRect);
        window.SkyEnvLight._skyRect = null;
      }
    } catch (_e) {}
    host.getScene().traverse((o) => {
      if (o.isRectAreaLight && o.userData && o.userData.isSkyFillLight) host.getScene().remove(o);
      if (o.isAmbientLight || o.isHemisphereLight) o.intensity = 0;
    });

    const sizeEl = document.getElementById('lightSize');
    if (sizeEl) {
      sizeEl.value = '1';
      sizeEl.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const fake = document.createElement('div');
    document.createElement('div').appendChild(fake);
    const dirOpt = Array.from(document.querySelectorAll('#light-options .custom-option')).find((el) =>
      /平行|dir/i.test(el.textContent + (el.getAttribute('onclick') || ''))
    );
    if (dirOpt) dirOpt.click();
    if (typeof window.selectCustomOpt === 'function') window.selectCustomOpt('lightDir', '90,0', 'qa', fake);

    // 关软交界
    host.getSceneGroup().traverse((obj) => {
      if (!obj.isMesh) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach((m) => {
        if (!m || !m.userData) return;
        if (m.userData.uSolidTermStrength) m.userData.uSolidTermStrength.value = 0;
        if (m.userData.uSolidTermSizeT) m.userData.uSolidTermSizeT.value = 0;
        // 压掉 SH / env 影响（若有）
        try {
          if (m.userData._solidShUni && m.userData._solidShUni.shMix) m.userData._solidShUni.shMix.value = 0;
          if (m.userData.uSolidShMix) m.userData.uSolidShMix.value = 0;
        } catch (_eSh) {}
        if (m.envMapIntensity != null) m.envMapIntensity = 0;
      });
    });
  });

  async function shotWithTrueContour(az, name) {
    const meta = await page.evaluate((azimuth) => {
      const host = window.__solidHost;
      const THREE = host.getTHREE();
      const fake = document.createElement('div');
      document.createElement('div').appendChild(fake);
      if (typeof window.selectCustomOpt === 'function') {
        window.selectCustomOpt('lightDir', String(azimuth) + ',0', 'qa', fake);
      }
      let mainLight = null;
      host.getScene().traverse((o) => {
        if (!mainLight && o.isDirectionalLight) mainLight = o;
      });
      if (mainLight && mainLight.target) {
        mainLight.target.position.set(0, 0, 0);
        mainLight.target.updateMatrixWorld(true);
        mainLight.castShadow = false;
        mainLight.updateMatrixWorld(true);
      }
      // 再关 soft term / sh
      host.getSceneGroup().traverse((obj) => {
        if (!obj.isMesh) return;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m) => {
          if (!m || !m.userData) return;
          if (m.userData.uSolidTermStrength) m.userData.uSolidTermStrength.value = 0;
          if (m.userData.uSolidTermSizeT) m.userData.uSolidTermSizeT.value = 0;
          try {
            if (m.userData._solidShUni && m.userData._solidShUni.shMix) m.userData._solidShUni.shMix.value = 0;
          } catch (_e) {}
        });
      });

      const L = mainLight.position.clone().sub(mainLight.target.position).normalize();
      const cam = host.getCamera();
      const renderer = host.getRenderer();

      // 采样网格：找 N·L≈0 且朝向相机的点，投到屏幕
      const pts = [];
      const normalMat = new THREE.Matrix3();
      const vA = new THREE.Vector3();
      const vB = new THREE.Vector3();
      const vC = new THREE.Vector3();
      const nA = new THREE.Vector3();
      const nB = new THREE.Vector3();
      const nC = new THREE.Vector3();
      const tmpN = new THREE.Vector3();
      const tmpP = new THREE.Vector3();
      const view = new THREE.Vector3();

      host.getSceneGroup().traverse((obj) => {
        if (!obj.isMesh || !obj.geometry) return;
        const geo = obj.geometry;
        const pos = geo.attributes.position;
        const nor = geo.attributes.normal;
        if (!pos || !nor) return;
        obj.updateMatrixWorld(true);
        normalMat.getNormalMatrix(obj.matrixWorld);
        const idx = geo.index;
        const triCount = idx ? idx.count / 3 : pos.count / 3;
        // 降采样
        const step = Math.max(1, Math.floor(triCount / 8000));
        for (let t = 0; t < triCount; t += step) {
          let i0, i1, i2;
          if (idx) {
            i0 = idx.getX(t * 3);
            i1 = idx.getX(t * 3 + 1);
            i2 = idx.getX(t * 3 + 2);
          } else {
            i0 = t * 3;
            i1 = t * 3 + 1;
            i2 = t * 3 + 2;
          }
          vA.fromBufferAttribute(pos, i0);
          vB.fromBufferAttribute(pos, i1);
          vC.fromBufferAttribute(pos, i2);
          obj.localToWorld(vA);
          obj.localToWorld(vB);
          obj.localToWorld(vC);
          nA.fromBufferAttribute(nor, i0).applyMatrix3(normalMat).normalize();
          nB.fromBufferAttribute(nor, i1).applyMatrix3(normalMat).normalize();
          nC.fromBufferAttribute(nor, i2).applyMatrix3(normalMat).normalize();
          const dA = nA.dot(L);
          const dB = nB.dot(L);
          const dC = nC.dot(L);
          // 边穿越 0
          const edges = [
            [vA, vB, dA, dB, nA, nB],
            [vB, vC, dB, dC, nB, nC],
            [vC, vA, dC, dA, nC, nA],
          ];
          for (const [pa, pb, da, db, na, nb] of edges) {
            if (da * db > 0) continue;
            if (Math.abs(da - db) < 1e-8) continue;
            const u = da / (da - db);
            tmpP.copy(pa).lerp(pb, u);
            tmpN.copy(na).lerp(nb, u).normalize();
            // 朝向相机
            view.copy(cam.position).sub(tmpP).normalize();
            if (tmpN.dot(view) < 0.15) continue; // 背向相机的交界丢掉
            // 只要耳上头侧区域（世界 y 高、|z| 不大的侧颅）
            if (tmpP.y < 0.9 || tmpP.y > 1.7) continue;
            const scr = tmpP.clone().project(cam);
            if (scr.z < -1 || scr.z > 1) continue;
            if (Math.abs(scr.x) > 1 || Math.abs(scr.y) > 1) continue;
            pts.push({
              x: scr.x,
              y: scr.y,
              ndl: 0,
              wy: +tmpP.y.toFixed(3),
            });
          }
        }
      });

      // 点②
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
      const wp2 = new THREE.Vector3().fromArray(anno2.localPos);
      meshRoot.localToWorld(wp2);
      const n2 = new THREE.Vector3().fromArray(anno2.localNormal);
      const nm = new THREE.Matrix3().getNormalMatrix(meshRoot.matrixWorld);
      n2.applyMatrix3(nm).normalize();
      const scr2 = wp2.clone().project(cam);

      window.needsUpdate = true;
      window.lightMoved = true;
      try {
        if (typeof window._solidTryRasterPreviewDraw === 'function') window._solidTryRasterPreviewDraw();
      } catch (_e) {}
      // 强制渲染一帧
      try {
        renderer.render(host.getScene(), cam);
      } catch (_e2) {}

      return {
        az: azimuth,
        L: [+L.x.toFixed(4), +L.y.toFixed(4), +L.z.toFixed(4)],
        contourCount: pts.length,
        contour: pts.slice(0, 400),
        anno2: {
          ndl: +n2.dot(L).toFixed(6),
          scr: [+scr2.x.toFixed(4), +scr2.y.toFixed(4)],
        },
      };
    }, az);

    await page.waitForTimeout(400);
    // 截原图
    await page.screenshot({ path: path.join(OUT, `${name}_raw.png`) });

    // 在截图上叠红点（用 page 再画一层）
    await page.evaluate((payload) => {
      const canvas = document.querySelector('canvas');
      const rect = canvas.getBoundingClientRect();
      let ov = document.getElementById('qa-term-overlay');
      if (!ov) {
        ov = document.createElement('canvas');
        ov.id = 'qa-term-overlay';
        ov.style.cssText = 'position:fixed;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:9999;';
        document.body.appendChild(ov);
      }
      ov.width = window.innerWidth;
      ov.height = window.innerHeight;
      const ctx = ov.getContext('2d');
      ctx.clearRect(0, 0, ov.width, ov.height);
      ctx.fillStyle = 'rgba(255,40,40,0.9)';
      for (const p of payload.contour) {
        const x = (p.x * 0.5 + 0.5) * rect.width + rect.left;
        const y = (-p.y * 0.5 + 0.5) * rect.height + rect.top;
        ctx.beginPath();
        ctx.arc(x, y, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      // 点② 黄圈
      const a = payload.anno2.scr;
      const ax = (a[0] * 0.5 + 0.5) * rect.width + rect.left;
      const ay = (-a[1] * 0.5 + 0.5) * rect.height + rect.top;
      ctx.strokeStyle = '#ffe600';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(ax, ay, 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#ffe600';
      ctx.font = 'bold 14px sans-serif';
      ctx.fillText('②', ax + 12, ay - 8);
    }, meta);
    await page.screenshot({ path: path.join(OUT, `${name}_contour.png`) });
    await page.evaluate(() => {
      const ov = document.getElementById('qa-term-overlay');
      if (ov) ov.remove();
    });
    return meta;
  }

  const m90 = await shotWithTrueContour(90, 'az90');
  const m270 = await shotWithTrueContour(270, 'az270');

  // 比较两条真交界的屏幕点云：平均 x / 中位数 x
  function stats(contour) {
    if (!contour.length) return null;
    const xs = contour.map((p) => p.x).sort((a, b) => a - b);
    const ys = contour.map((p) => p.y).sort((a, b) => a - b);
    const mid = (arr) => arr[Math.floor(arr.length / 2)];
    const avg = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;
    return {
      n: contour.length,
      avgX: +avg(xs).toFixed(4),
      midX: +mid(xs).toFixed(4),
      avgY: +avg(ys).toFixed(4),
      midY: +mid(ys).toFixed(4),
    };
  }
  const s90 = stats(m90.contour);
  const s270 = stats(m270.contour);
  const report = {
    m90: { L: m90.L, anno2: m90.anno2, stats: s90, count: m90.contourCount },
    m270: { L: m270.L, anno2: m270.anno2, stats: s270, count: m270.contourCount },
    compare: {
      Ldot:
        m90.L[0] * m270.L[0] + m90.L[1] * m270.L[1] + m90.L[2] * m270.L[2],
      ndlSum: m90.anno2.ndl + m270.anno2.ndl,
      dMidX: s90 && s270 ? +(s90.midX - s270.midX).toFixed(4) : null,
      dAvgX: s90 && s270 ? +(s90.avgX - s270.avgX).toFixed(4) : null,
      // NDC 差 < 0.02 ≈ 很小
      trueContourSame: s90 && s270 && Math.abs(s90.midX - s270.midX) < 0.03 && Math.abs(s90.midY - s270.midY) < 0.05,
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
