/**
 * 扫 UV 网格，找当前关头像的屏幕命中范围（调试用）
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-uv-probe`);
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:18080';
const sceneId = process.env.SCENE_ID || 'V01';
fs.mkdirSync(outDir, { recursive: true });

async function waitLoaderGone(page) {
  await page.waitForFunction(() => {
    const el = document.getElementById('scene-loader');
    if (!el) return true;
    const st = getComputedStyle(el);
    return st.display === 'none' || Number(st.opacity || 1) < 0.05;
  }, null, { timeout: 180000 }).catch(() => {});
  await page.waitForTimeout(2500);
}

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${baseUrl}/Solid.html?sandbox=headform&_=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 90000
  });
  await page.waitForFunction(() => Array.isArray(window.customScenes) && window.customScenes.length > 0, null, {
    timeout: 90000
  });
  await page.waitForFunction(() => !!(window.__solidHost && window.__solidHost.getCamera()), null, {
    timeout: 90000
  });
  await waitLoaderGone(page);
  const idx = await page.evaluate((want) => {
    return (window.customScenes || []).findIndex((s) => s && String(s.id) === String(want));
  }, sceneId);
  await page.evaluate((i) => {
    window.currentSceneIndex = -1;
    window.switchScene(i);
  }, idx);
  await waitLoaderGone(page);
  await page.evaluate(() => {
    const m = document.getElementById('scene-grid-modal');
    if (m) m.style.display = 'none';
    const l = document.getElementById('scene-loader');
    if (l) l.style.display = 'none';
  });

  const hits = await page.evaluate(() => {
    const host = window.__solidHost;
    const THREE = host.getTHREE();
    const cam = host.getCamera();
    const g = host.getSceneGroup();
    const meshes = [];
    g.traverse((o) => {
      if (o.isMesh && o.geometry) meshes.push(o);
    });
    const raycaster = new THREE.Raycaster();
    const out = [];
    for (let iu = 0; iu <= 40; iu++) {
      for (let iv = 0; iv <= 40; iv++) {
        const u = iu / 40;
        const v = iv / 40;
        raycaster.setFromCamera(new THREE.Vector2(u * 2 - 1, -(v * 2 - 1)), cam);
        const hs = raycaster.intersectObjects(meshes, true);
        if (hs.length) out.push({ u: +u.toFixed(3), v: +v.toFixed(3), d: +hs[0].distance.toFixed(3) });
      }
    }
    let minU = 1,
      maxU = 0,
      minV = 1,
      maxV = 0;
    out.forEach((p) => {
      minU = Math.min(minU, p.u);
      maxU = Math.max(maxU, p.u);
      minV = Math.min(minV, p.v);
      maxV = Math.max(maxV, p.v);
    });
    return { count: out.length, minU, maxU, minV, maxV, sample: out.filter((_, i) => i % 17 === 0).slice(0, 40) };
  });

  fs.writeFileSync(path.join(outDir, `${sceneId}-uv.json`), JSON.stringify(hits, null, 2));
  await page.screenshot({ path: path.join(outDir, `${sceneId}.png`), timeout: 60000 });
  console.log(JSON.stringify(hits, null, 2));
  console.log('OUT', outDir);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
