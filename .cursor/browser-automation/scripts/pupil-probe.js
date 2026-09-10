const { chromium } = require('playwright');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:18080';
const PAGE =
  BASE.replace(/\/$/, '') +
  '/%E8%87%AA%E7%94%A8%E5%B7%A5%E5%85%B7%E6%96%87%E4%BB%B6_%E4%B8%8D%E9%83%A8%E7%BD%B2/GNM%E5%A4%B4%E6%A8%A1%E5%B7%A5%E5%9D%8A/align-overlay/';

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(() => {
    window.__ALIGN_DISABLE_MV_OVERLAY__ = true;
  });
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForSelector('#loading', { state: 'hidden', timeout: 240000 });
  await page.evaluate(async (histId) => {
    const ed = window.__alignOverlayApp?.lmEditor;
    const hit = await ed._fetchHistoryEntry({ id: histId });
    ed.applyHistoryEntry(hit, { statusPrefix: 'probe' });
  }, 'v_1787879035643');
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const app = window.__alignOverlayApp;
    app.setModelViewMode('euro');
    document.querySelector('#op-gnm').value = '55';
    document.querySelector('#op-euro').value = '100';
    document.querySelector('#op-gnm').dispatchEvent(new Event('input'));
    document.querySelector('#op-euro').dispatchEvent(new Event('input'));
    const chk = document.querySelector('#chk-landmarks');
    if (chk) {
      chk.checked = false;
      chk.dispatchEvent(new Event('change'));
    }
    app.setView('front');
    app.frameHead();
  });
  await page.waitForTimeout(800);
  const box = (await page.locator('#viewport-wrap').boundingBox()) || { x: 0, y: 0, width: 1440, height: 900 };
  const info = await page.evaluate(({ vw, vh, vx, vy }) => {
    const app = window.__alignOverlayApp;
    const iris = app.euroMeshes.find((m) => /acs_0/i.test(m.name) && !/leca/i.test(m.name));
    const cam = app.camera;
    const w = vw;
    const h = vh;
    const proj = (wx, wy, wz) => {
      const e = cam.matrixWorldInverse.elements;
      const ex = e[0] * wx + e[4] * wy + e[8] * wz + e[12];
      const ey = e[1] * wx + e[5] * wy + e[9] * wz + e[13];
      const ez = e[2] * wx + e[6] * wy + e[10] * wz + e[14];
      const ew = e[3] * wx + e[7] * wy + e[11] * wz + e[15];
      const cx = ex / ew;
      const cy = ey / ew;
      const cz = ez / ew;
      const pe = cam.projectionMatrix.elements;
      const px = pe[0] * cx + pe[4] * cy + pe[8] * cz + pe[12];
      const py = pe[1] * cx + pe[5] * cy + pe[9] * cz + pe[13];
      const pz = pe[2] * cx + pe[6] * cy + pe[10] * cz + pe[14];
      const pw = pe[3] * cx + pe[7] * cy + pe[11] * cz + pe[15];
      const ndcX = px / pw;
      const ndcY = py / pw;
      return { x: vx + (ndcX * 0.5 + 0.5) * w, y: vy + (-ndcY * 0.5 + 0.5) * h, z: pz / pw };
    };
    const worldPos = (obj) => {
      obj.updateWorldMatrix(true, false);
      const m = obj.matrixWorld.elements;
      return { x: m[12], y: m[13], z: m[14] };
    };
    const map = iris?.material?.map;
    const img = map?.image;
    iris?.updateWorldMatrix(true, true);
    const occluders = (iris?.userData._pupilOccluders || []).map((b) => {
      b.updateWorldMatrix(true, false);
      const wp = worldPos(b);
      return { local: [b.position.x, b.position.y, b.position.z], world: [wp.x, wp.y, wp.z], screen: proj(wp.x, wp.y, wp.z), r: b.geometry?.parameters?.radius };
    });
    const sites = [];
    if (iris?.geometry) {
      const pos = iris.geometry.attributes.position;
      const xs = [];
      for (let i = 0; i < pos.count; i++) xs.push(pos.getX(i));
      xs.sort((a, b) => a - b);
      const med = xs[Math.floor(xs.length / 2)];
      const me = iris.matrixWorld.elements;
      for (const side of [0, 1]) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
        let sx = 0, sy = 0, sz = 0, n = 0;
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i);
          if (side === 0 ? x >= med : x < med) continue;
          const y = pos.getY(i);
          const z = pos.getZ(i);
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
          minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
          sx += x; sy += y; sz += z; n++;
        }
        const cx = sx / n, cy = sy / n, cz = sz / n;
        const wx = me[0] * cx + me[4] * cy + me[8] * cz + me[12];
        const wy = me[1] * cx + me[5] * cy + me[9] * cz + me[13];
        const wz = me[2] * cx + me[6] * cy + me[10] * cz + me[14];
        sites.push({ side, centerScreen: proj(wx, wy, wz), localBox: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] } });
      }
    }
    const rois = [
      { name: 'L', x0: 0.481, x1: 0.491, y0: 0.326, y1: 0.336 },
      { name: 'R', x0: 0.521, x1: 0.531, y0: 0.326, y1: 0.336 },
    ].map((r) => ({ ...r, px: { x0: vx + r.x0 * w, x1: vx + r.x1 * w, y0: vy + r.y0 * h, y1: vy + r.y1 * h } }));
    const uvInfo = [];
    if (iris?.geometry?.attributes?.uv && iris?.geometry?.attributes?.position) {
      const uv = iris.geometry.attributes.uv;
      const pos = iris.geometry.attributes.position;
      const xs2 = [];
      for (let i = 0; i < pos.count; i++) xs2.push(pos.getX(i));
      xs2.sort((a, b) => a - b);
      const med2 = xs2[Math.floor(xs2.length / 2)];
      for (const side of [0, 1]) {
        let u = 0, v = 0, n = 0;
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i);
          if (side === 0 ? x >= med2 : x < med2) continue;
          u += uv.getX(i);
          v += uv.getY(i);
          n++;
        }
        uvInfo.push({ side, avgU: u / n, avgV: v / n });
      }
    }
    return {
      viewport: { vw, vh, vx, vy },
      irisName: iris?.name,
      texSize: img ? [img.width, img.height] : null,
      occluderCount: occluders.length,
      occluders,
      sites,
      rois,
      uvInfo,
      displayRev: app.displayRev,
    };
  }, { vw: box.width, vh: box.height, vx: box.x, vy: box.y });
  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})();
