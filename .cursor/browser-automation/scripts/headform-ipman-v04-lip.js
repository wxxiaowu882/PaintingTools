/**
 * 叶问 V04：分离 C/3/4（鼻唇角、上下唇）
 */
require('./_playwright-browsers-path');
const fs = require('fs');
const path = require('path');
const lib = require('./headform-vision-place-lib');

process.env.MODEL_ID = 'male_ipman_01';
process.env.MODEL_LABEL = '叶问';
const MID = 'male_ipman_01';

async function meshPick(page, y0, y1, zMin, xMax) {
  return page.evaluate(
    ({ y0, y1, zMin, xMax }) => {
      const host = window.__solidHost;
      const THREE = host.getTHREE();
      const cam = host.getCamera();
      const g = host.getSceneGroup();
      let root = null;
      g.traverse((o) => {
        if (!root && o.userData && o.userData.type === 'glb') root = o;
      });
      if (!root) root = g.children[0];
      const meshes = [];
      root.traverse((o) => {
        if (o.isMesh && o.geometry) meshes.push(o);
      });
      const v = new THREE.Vector3();
      let best = null;
      let bestS = -1e9;
      for (const mesh of meshes) {
        const pos = mesh.geometry && mesh.geometry.attributes && mesh.geometry.attributes.position;
        if (!pos) continue;
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i);
          mesh.localToWorld(v);
          root.worldToLocal(v);
          if (v.y < y0 || v.y > y1) continue;
          if (v.z < zMin) continue;
          if (Math.abs(v.x) > xMax) continue;
          const s = v.z * 10 - Math.abs(v.x) * 2;
          if (s > bestS) {
            bestS = s;
            best = v.clone();
          }
        }
      }
      if (!best) return { ok: false };
      return {
        ok: true,
        localPos: [+best.x.toFixed(4), +best.y.toFixed(4), +best.z.toFixed(4)],
        localNormal: [0, 0, 1],
        baseDist: +cam.position.distanceTo(root.localToWorld(best.clone())).toFixed(4),
        baseScale: +Number(root.scale.x).toFixed(4)
      };
    },
    { y0, y1, zMin, xMax }
  );
}

(async () => {
  const browser = await lib.launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto('http://127.0.0.1:18080/Solid?sandbox=headform', {
    waitUntil: 'domcontentloaded',
    timeout: 120000
  });
  await page.waitForFunction(() => Array.isArray(window.customScenes) && window.customScenes.length > 0, null, {
    timeout: 180000
  });
  const hit = lib.findScene('V04', MID);
  const scenePath = path.join(lib.jsonDir, hit.f);
  const data = JSON.parse(fs.readFileSync(scenePath, 'utf8'));
  await lib.openScene(page, data.id);
  await lib.applyCamera(page, data.camera || null);
  await lib.setAnnosVisible(page, false);

  const tip = (((data.items || [])[0] || {}).annotations || []).find((a) => String(a.text) === '2');
  const tipPos = tip && tip.localPos;

  const upper = await meshPick(page, 0.133, 0.142, 0.078, 0.028);
  const lower = await meshPick(page, 0.114, 0.124, 0.072, 0.028);
  console.log('3', upper);
  console.log('4', lower);
  if (upper.ok) lib.writeLandmark(scenePath, '3', upper, null, 'V04');
  if (lower.ok) lib.writeLandmark(scenePath, '4', lower, null, 'V04');

  // C 鼻唇角：鼻头与上唇之间，略偏下
  if (tipPos && upper.ok) {
    const c = await lib.placeBetweenNeighbors(page, tipPos, upper.localPos, {
      bias: 0.55,
      preferFront: true,
      yNudge: -0.004
    });
    console.log('C', c && c.localPos);
    if (c && c.ok) lib.writeLandmark(scenePath, 'C', c, null, 'V04');
  }

  if (upper.ok && lower.ok) {
    const d = await lib.placeBetweenNeighbors(page, upper.localPos, lower.localPos, {
      bias: 0.5,
      preferFront: true
    });
    console.log('D', d && d.localPos);
    if (d && d.ok) lib.writeLandmark(scenePath, 'D', d, null, 'V04');
  }

  const chin = (((JSON.parse(fs.readFileSync(scenePath, 'utf8')).items || [])[0] || {}).annotations || []).find(
    (a) => String(a.text) === '5'
  );
  if (lower.ok && chin && chin.localPos) {
    const e = await lib.placeBetweenNeighbors(page, lower.localPos, chin.localPos, {
      bias: 0.4,
      preferFront: true
    });
    console.log('E', e && e.localPos);
    if (e && e.ok) lib.writeLandmark(scenePath, 'E', e, null, 'V04');
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.join(__dirname, '..', 'runs', stamp + '-ipman-v04-lip');
  fs.mkdirSync(outDir, { recursive: true });
  const d2 = JSON.parse(fs.readFileSync(scenePath, 'utf8'));
  await lib.openScene(page, d2.id);
  await lib.applyCamera(page, d2.camera || null);
  await lib.setAnnosVisible(page, true);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outDir, 'V04_anno.png') });
  lib.rebuildAggregate();
  await browser.close();
  console.log('V04_LIP_DONE', outDir);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
