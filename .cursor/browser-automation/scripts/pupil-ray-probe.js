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
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const app = window.__alignOverlayApp;
    app.setModelViewMode('euro');
    document.querySelector('#op-gnm').value = '55';
    document.querySelector('#op-euro').value = '100';
    document.querySelector('#op-gnm').dispatchEvent(new Event('input'));
    document.querySelector('#op-euro').dispatchEvent(new Event('input'));
    document.querySelector('#chk-landmarks').checked = false;
    document.querySelector('#chk-landmarks').dispatchEvent(new Event('change'));
    app.setView('front');
    app.frameHead();
  });
  await page.waitForTimeout(500);
  const info = await page.evaluate(() => {
    const app = window.__alignOverlayApp;
    const root = app.euroRoot?.children?.[0];
    const occ = root?.userData?._pupilOccluders || [];
    const cam = app.camera;
    const w = 1080;
    const h = 746;
    const proj = (wx, wy, wz) => {
      const e = cam.matrixWorldInverse.elements;
      const ex = e[0] * wx + e[4] * wy + e[8] * wz + e[12];
      const ey = e[1] * wx + e[5] * wy + e[9] * wz + e[13];
      const ez = e[2] * wx + e[6] * wy + e[10] * wz + e[14];
      const ew = e[3] * wx + e[7] * wy + e[11] * wz + e[15];
      const pe = cam.projectionMatrix.elements;
      const px = pe[0] * (ex / ew) + pe[4] * (ey / ew) + pe[8] * (ez / ew) + pe[12];
      const py = pe[1] * (ex / ew) + pe[5] * (ey / ew) + pe[9] * (ez / ew) + pe[13];
      const pw = pe[3] * (ex / ew) + pe[7] * (ey / ew) + pe[11] * (ez / ew) + pe[15];
      const ndcX = px / pw;
      const ndcY = py / pw;
      return { nx: ndcX * 0.5 + 0.5, ny: -ndcY * 0.5 + 0.5 };
    };
    return {
      count: occ.length,
      sprites: occ.map((o) => {
        o.updateWorldMatrix(true, false);
        const m = o.matrixWorld.elements;
        const wp = { x: m[12], y: m[13], z: m[14] };
        return { wp, screen: proj(wp.x, wp.y, wp.z), scale: o.scale.toArray() };
      }),
      targets: [
        { nx: 0.486, ny: 0.331 },
        { nx: 0.526, ny: 0.331 },
      ],
      displayRev: app.displayRev,
    };
  });
  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})();
