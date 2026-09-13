/** 验证 204 标注投影点是否在交界缘 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const sharp = require('sharp');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const outDir = path.resolve(__dirname, '..', 'runs');
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:18080';

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${baseUrl}/Solid.html?sandbox=headform&skipPerf=1&_=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 120000
  });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    window.useAdvancedRender = false;
    window.perfTestDone = true;
    try {
      if (typeof window.stopRender === 'function') window.stopRender();
    } catch (e) {}
    if (window.loadJSONData) window.loadJSONData();
  });
  await page.waitForFunction(() => (window.customScenes || []).length > 0, null, { timeout: 120000 });
  await page.waitForFunction(() => !!(window.__solidHost && window.__solidHost.getCamera), null, {
    timeout: 120000
  });
  await page.evaluate(() => {
    const m = document.getElementById('scene-grid-modal');
    if (m) m.style.display = 'none';
    let i = (window.customScenes || []).findIndex((s) => s && s.id === 'L04');
    window.currentSceneIndex = -1;
    window.switchScene(i);
  });
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    try {
      if (typeof window.stopRender === 'function') window.stopRender();
    } catch (e) {}
    if (window.showAnnotations !== false && typeof window.toggleAnnotations === 'function') {
      window.toggleAnnotations();
    }
  });
  await page.waitForTimeout(500);

  const crop = { x: 320, y: 70, width: 760, height: 760 };
  const shot = path.join(outDir, '_proj_verify.png');
  await page.screenshot({ path: shot, clip: crop });

  const proj = await page.evaluate(() => {
    const host = window.__solidHost;
    const THREE = host.getTHREE();
    const cam = host.getCamera();
    const g = host.getSceneGroup();
    let root = null;
    g.traverse((o) => {
      if (!root && o.userData && o.userData.type === 'glb') root = o;
    });
    if (!root) root = g.children[0];
    root.updateWorldMatrix(true, true);
    const sc = (window.customScenes || []).find((s) => s && s.id === 'L04');
    return sc.items[0].annotations.map((a) => {
      const p = new THREE.Vector3(...a.localPos);
      root.localToWorld(p);
      p.project(cam);
      return {
        t: a.text,
        u: (p.x + 1) / 2,
        v: 1 - (p.y + 1) / 2,
        local: a.localPos,
        dx: a.dx
      };
    });
  });

  const raw = await sharp(shot).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const pix = raw.data;
  const W = raw.info.width;
  const H = raw.info.height;
  const lum = (x, y) => {
    x = Math.max(0, Math.min(W - 1, x | 0));
    y = Math.max(0, Math.min(H - 1, y | 0));
    const i = (y * W + x) * 3;
    return 0.299 * pix[i] + 0.587 * pix[i + 1] + 0.114 * pix[i + 2];
  };

  for (const p of proj) {
    const cx = p.u * 1280 - crop.x;
    const cy = p.v * 800 - crop.y;
    console.log(
      JSON.stringify({
        t: p.t,
        local: p.local,
        dx: p.dx,
        cropXY: [+cx.toFixed(1), +cy.toFixed(1)],
        L: +lum(cx, cy).toFixed(1),
        Lleft: +lum(cx - 12, cy).toFixed(1),
        Lright: +lum(cx + 12, cy).toFixed(1)
      })
    );
  }
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
