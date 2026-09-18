/**
 * 验证：真交界重合前提下，SH 补光是否造成「肉眼交界」左右漂移。
 * 条件：平行光对跖、size=1、无天光、软交界=0；对比 shMix 开/关。
 * PORT=18080 node scripts/terminator-sh-visual.js
 */
require('./_playwright-browsers-path');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PORT = process.env.PORT || '18080';
const OUT = path.join(__dirname, '..', 'runs', 'terminator-sh-visual');
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
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    try {
      if (window.resetAll) window.resetAll();
    } catch (_e) {}
    try {
      if (window.stopRender) window.stopRender();
    } catch (_e2) {}
    window.useAdvancedRender = false;
    window.showAnnotations = true;
    const el = document.getElementById('scene-loader');
    if (el) {
      el.style.display = 'none';
      el.style.opacity = '0';
    }
  });
  await page.waitForTimeout(800);

  await page.evaluate(() => {
    const host = window.__solidHost;
    const cam = host.getCamera();
    const controls = host.getControls && host.getControls();
    // 更侧的视角，专看耳上头侧
    cam.position.set(16, 1.5, 0.5);
    cam.fov = 6;
    cam.zoom = 0.7;
    cam.updateProjectionMatrix();
    if (controls) {
      controls.target.set(0.02, 1.15, -0.02);
      controls.update();
    }
    window.envSkyLightScale = 0;
    try {
      if (window.SkyEnvLight && window.SkyEnvLight._skyRect) {
        host.getScene().remove(window.SkyEnvLight._skyRect);
        window.SkyEnvLight._skyRect = null;
      }
    } catch (_e) {}
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
  });

  async function setSh(on) {
    await page.evaluate((enabled) => {
      const host = window.__solidHost;
      const mix = enabled ? 0.52 : 0;
      host.getSceneGroup().traverse((obj) => {
        if (!obj.isMesh) return;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m) => {
          if (!m || !m.userData) return;
          if (m.userData.uSolidTermStrength) m.userData.uSolidTermStrength.value = 0;
          if (m.userData.uSolidTermSizeT) m.userData.uSolidTermSizeT.value = 0;
          const u = m.userData._solidShUni;
          if (u) {
            if (u.shMix) u.shMix.value = mix;
            if (u.uSolidShMix) u.uSolidShMix.value = mix;
            // 常见字段名
            Object.keys(u).forEach((k) => {
              if (/mix/i.test(k) && u[k] && typeof u[k].value === 'number') u[k].value = mix;
            });
          }
          if (m.envMapIntensity != null) m.envMapIntensity = enabled ? m.envMapIntensity : 0;
        });
      });
      window.__qaShOn = enabled;
    }, on);
  }

  async function setAz(az) {
    await page.evaluate((azimuth) => {
      const host = window.__solidHost;
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
      // 恢复 sh / term 设定
      const mix = window.__qaShOn ? 0.52 : 0;
      host.getSceneGroup().traverse((obj) => {
        if (!obj.isMesh) return;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m) => {
          if (!m || !m.userData) return;
          if (m.userData.uSolidTermStrength) m.userData.uSolidTermStrength.value = 0;
          if (m.userData.uSolidTermSizeT) m.userData.uSolidTermSizeT.value = 0;
          const u = m.userData._solidShUni;
          if (u && u.shMix) u.shMix.value = mix;
        });
      });
      window.needsUpdate = true;
      window.lightMoved = true;
      try {
        host.getRenderer().render(host.getScene(), host.getCamera());
      } catch (_e) {}
      try {
        if (typeof window._solidTryRasterPreviewDraw === 'function') window._solidTryRasterPreviewDraw();
      } catch (_e2) {}
    }, az);
    await page.waitForTimeout(700);
  }

  async function measureVisualEdge() {
    return page.evaluate(() => {
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

      // 只在「头表面」上找边：用深度/非黑像素，避开纯黑背景
      const c2 = document.createElement('canvas');
      c2.width = canvas.width;
      c2.height = canvas.height;
      const ctx = c2.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(canvas, 0, 0);
      const sx = canvas.width / rect.width;
      const sy = canvas.height / rect.height;
      const y = Math.max(0, Math.min(c2.height - 1, Math.round(cy * sy)));
      const row = ctx.getImageData(0, y, c2.width, 1).data;
      const lums = [];
      for (let x = 0; x < c2.width; x++) {
        const i = x * 4;
        lums.push(0.2126 * row[i] + 0.7152 * row[i + 1] + 0.0722 * row[i + 2]);
      }
      // 头表面区间：亮度 > 3 的连续段
      let left = 0;
      let right = c2.width - 1;
      for (let x = 0; x < c2.width; x++) {
        if (lums[x] > 3) {
          left = x;
          break;
        }
      }
      for (let x = c2.width - 1; x >= 0; x--) {
        if (lums[x] > 3) {
          right = x;
          break;
        }
      }
      // 在表面内找最大梯度（排除外轮廓 8px）
      const x0 = left + 8;
      const x1 = right - 8;
      let bestX = x0;
      let bestG = -1;
      for (let x = x0; x <= x1; x++) {
        const g = Math.abs(lums[x + 3] - lums[x - 3]);
        if (g > bestG) {
          bestG = g;
          bestX = x;
        }
      }
      return {
        annoX: cx,
        edgeX: bestX / sx,
        dAnno: bestX / sx - cx,
        left: left / sx,
        right: right / sx,
        lum2: lums[Math.round(cx * sx)],
        minSurf: Math.min(...lums.slice(x0, x1 + 1)),
        maxSurf: Math.max(...lums.slice(x0, x1 + 1)),
        bestG,
      };
    });
  }

  const results = {};
  for (const shOn of [true, false]) {
    const tag = shOn ? 'shON' : 'shOFF';
    await setSh(shOn);
    await setAz(90);
    const e90 = await measureVisualEdge();
    await page.screenshot({ path: path.join(OUT, `${tag}_az90.png`) });
    await setAz(270);
    const e270 = await measureVisualEdge();
    await page.screenshot({ path: path.join(OUT, `${tag}_az270.png`) });
    results[tag] = {
      e90,
      e270,
      dxEdge: +(Math.abs(e90.edgeX - e270.edgeX)).toFixed(1),
      sameVisualLine: Math.abs(e90.edgeX - e270.edgeX) < 12,
    };
    console.log(tag, results[tag].dxEdge, results[tag].sameVisualLine);
  }

  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
