/**
 * 对比模 vs 大本：世界 AABB 头高推算 scale
 * MODEL_ID=female_euro_02 SLOT=V02 node scripts/headform-probe-scale-contrast.js
 */
require('./_playwright-browsers-path');
const fs = require('fs');
const path = require('path');
const lib = require('./headform-vision-place-lib');

const MODEL_ID = process.env.MODEL_ID;
const SLOT = process.env.SLOT || 'V02';
const port = process.env.PORT ? Number(process.env.PORT) : 18080;
if (!MODEL_ID) {
  console.error('Need MODEL_ID');
  process.exit(1);
}

async function aabbY(page) {
  return page.evaluate(() => {
    const THREE = (window.__solidHost && window.__solidHost.getTHREE && window.__solidHost.getTHREE()) || window.THREE;
    if (!THREE || !THREE.Box3) return { err: 'no THREE' };
    const host = window.__solidHost;
    const g = host && host.getSceneGroup && host.getSceneGroup();
    const box = new THREE.Box3();
    let ok = false;
    if (g) {
      g.traverse((o) => {
        if (!o.isMesh || !o.geometry) return;
        const b = new THREE.Box3().setFromObject(o);
        if (b.isEmpty()) return;
        if (!ok) {
          box.copy(b);
          ok = true;
        } else box.union(b);
      });
    }
    if (!ok) return null;
    return {
      minY: box.min.y,
      maxY: box.max.y,
      h: box.max.y - box.min.y,
      minX: box.min.x,
      maxX: box.max.x,
      minZ: box.min.z,
      maxZ: box.max.z
    };
  });
}

(async () => {
  const ref = lib.findScene(SLOT, 'reference');
  const hit = lib.findScene(SLOT, MODEL_ID);
  if (!ref || !hit) {
    console.error('missing scenes', !!ref, !!hit);
    process.exit(1);
  }
  const browser = await lib.launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`http://127.0.0.1:${port}/Solid?sandbox=headform`, {
    waitUntil: 'domcontentloaded',
    timeout: 120000
  });
  await page.waitForFunction(
    () => !!(window.__solidHost && typeof window.switchScene === 'function'),
    null,
    { timeout: 180000 }
  );
  await page.waitForTimeout(1000);

  await lib.openSceneData(page, ref.d);
  const refBox = await aabbY(page);

  await lib.openSceneData(page, hit.d);
  const curBox = await aabbY(page);
  const curScale = ((((hit.d.items || [])[0] || {}).scale) || [5.8])[0] || 5.8;
  const ratio = refBox && curBox && curBox.h > 1e-6 ? refBox.h / curBox.h : null;
  const suggested = ratio ? Number((curScale * ratio).toFixed(4)) : null;
  const out = { MODEL_ID, SLOT, refBox, curBox, curScale, ratio, suggested };
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
  if (suggested) {
    process.stdout.write(`\nSUGGESTED_SCALE=${suggested}\n`);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
