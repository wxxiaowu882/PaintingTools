/**
 * 叶问 V05a/V03：网格最高 z 钉鼻头；V05a 略前移相机使见鼻可读
 * MODEL_ID=male_ipman_01 node scripts/headform-ipman-nose-fix.js
 */
require('./_playwright-browsers-path');
const fs = require('fs');
const path = require('path');
const lib = require('./headform-vision-place-lib');

process.env.MODEL_ID = process.env.MODEL_ID || 'male_ipman_01';
process.env.MODEL_LABEL = process.env.MODEL_LABEL || '叶问';

async function meshNoseTip(page, y0, y1, minZ) {
  return page.evaluate(
    ({ y0, y1, minZ }) => {
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
      let tipLocal = null;
      let tipScore = -1e9;
      const v = new THREE.Vector3();
      for (const mesh of meshes) {
        const geo = mesh.geometry;
        if (!geo || !geo.attributes || !geo.attributes.position) continue;
        const pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i += 2) {
          v.fromBufferAttribute(pos, i);
          mesh.localToWorld(v);
          root.worldToLocal(v);
          if (v.y < y0 || v.y > y1) continue;
          if (v.z < minZ) continue;
          if (Math.abs(v.x) > 0.05) continue;
          const s = v.z * 8 - Math.abs(v.x) * 2;
          if (s > tipScore) {
            tipScore = s;
            tipLocal = v.clone();
          }
        }
      }
      if (!tipLocal) return { ok: false, reason: 'mesh tip miss' };
      const world = root.localToWorld(tipLocal.clone());
      const ndc = world.clone().project(cam);
      const u0 = (ndc.x + 1) / 2;
      const v0 = (1 - ndc.y) / 2;
      const raycaster = new THREE.Raycaster();
      let best = null;
      for (const [du, dv] of [
        [0, 0],
        [-0.01, 0],
        [0.01, 0],
        [0, -0.01],
        [0, 0.01],
        [-0.02, 0.01],
        [0.015, -0.01],
        [-0.03, 0],
        [0.02, 0]
      ]) {
        const u = u0 + du;
        const vv = v0 + dv;
        if (u < 0.05 || u > 0.95 || vv < 0.05 || vv > 0.95) continue;
        raycaster.setFromCamera(new THREE.Vector2(u * 2 - 1, -(vv * 2 - 1)), cam);
        const hits = raycaster.intersectObjects(meshes, true);
        if (!hits.length) continue;
        const localPos = root.worldToLocal(hits[0].point.clone());
        let nWorld = new THREE.Vector3(0, 0, 1);
        if (hits[0].face && hits[0].face.normal) {
          nWorld = hits[0].face.normal.clone().transformDirection(hits[0].object.matrixWorld).normalize();
        }
        const toCam = cam.position.clone().sub(hits[0].point).normalize();
        if (nWorld.dot(toCam) < -0.05) nWorld.multiplyScalar(-1);
        const localNormal = root
          .worldToLocal(hits[0].point.clone().add(nWorld))
          .sub(localPos.clone())
          .normalize();
        const score = localPos.z * 6 - Math.abs(localPos.x);
        if (!best || score > best._s) {
          best = {
            ok: true,
            localPos: [+localPos.x.toFixed(4), +localPos.y.toFixed(4), +localPos.z.toFixed(4)],
            localNormal: [+localNormal.x.toFixed(3), +localNormal.y.toFixed(3), +localNormal.z.toFixed(3)],
            baseDist: +hits[0].distance.toFixed(4),
            baseScale: +Number(root.scale.x).toFixed(4),
            u: +u.toFixed(4),
            v: +vv.toFixed(4),
            _s: score,
            tipHint: [+tipLocal.x.toFixed(4), +tipLocal.y.toFixed(4), +tipLocal.z.toFixed(4)]
          };
        }
      }
      if (best) delete best._s;
      return best || { ok: false, reason: 'ray miss', tipHint: tipLocal.toArray() };
    },
    { y0, y1, minZ }
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

  // V05a camera nudge + nose
  const hitA = lib.findScene('V05a', 'male_ipman_01');
  const pathA = path.join(lib.jsonDir, hitA.f);
  const dataA = JSON.parse(fs.readFileSync(pathA, 'utf8'));
  dataA.camera = Object.assign({}, dataA.camera || {}, {
    pos: [4.35, 1.42, -2.55],
    target: [0.02, 0.82, 0.04],
    zoom: (dataA.camera && dataA.camera.zoom) || 0.56,
    fov: (dataA.camera && dataA.camera.fov) || 15
  });
  fs.writeFileSync(pathA, JSON.stringify(dataA));
  lib.rebuildAggregate();

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Array.isArray(window.customScenes) && window.customScenes.length > 0, null, {
    timeout: 180000
  });
  const hitA2 = lib.findScene('V05a', 'male_ipman_01');
  await lib.openScene(page, hitA2.d.id);
  await lib.applyCamera(page, dataA.camera);
  await lib.setAnnosVisible(page, false);
  let noseA = await meshNoseTip(page, 0.11, 0.17, 0.055);
  console.log('V05a', noseA);
  if (!noseA || !noseA.ok) {
    noseA = await meshNoseTip(page, 0.1, 0.19, 0.045);
    console.log('V05a retry', noseA);
  }
  if (!noseA || !noseA.ok) throw new Error('V05a nose miss');
  lib.writeLandmark(pathA, '3', noseA, null, 'V05a');

  // V03 nose + lip
  const hit3 = lib.findScene('V03', 'male_ipman_01');
  const path3 = path.join(lib.jsonDir, hit3.f);
  const cam3 = (((hit3.d.items || [])[0] || {}).camera) || hit3.d.camera || null;
  await lib.openScene(page, hit3.d.id);
  await lib.applyCamera(page, cam3);
  await lib.setAnnosVisible(page, false);
  const nose3 = await meshNoseTip(page, 0.145, 0.185, 0.07);
  console.log('V03', nose3);
  if (nose3 && nose3.ok) {
    lib.writeLandmark(path3, '3', nose3, null, 'V03');
    const lip = await lib.placeBetweenNeighbors(page, nose3.localPos, nose3.localPos, {
      bias: 0,
      yNudge: -0.03,
      zNudge: -0.012,
      preferFront: true
    });
    if (lip && lip.ok) {
      lib.writeLandmark(path3, '4', lip, null, 'V03');
      console.log('V03 lip', lip.localPos);
    }
  }

  for (const slot of ['V05a', 'V03', 'V02']) {
    const h = lib.findScene(slot, 'male_ipman_01');
    const d = JSON.parse(fs.readFileSync(path.join(lib.jsonDir, h.f), 'utf8'));
    await lib.openScene(page, d.id);
    await lib.applyCamera(page, d.camera || null);
    await lib.setAnnosVisible(page, true);
    const outDir = path.join(
      __dirname,
      '..',
      'runs',
      `${new Date().toISOString().replace(/[:.]/g, '-')}-vision-place-${slot}-_`
    );
    fs.mkdirSync(outDir, { recursive: true });
    await page.screenshot({ path: path.join(outDir, 'verify.png') });
    const focus = (d.items[0].annotations || []).filter((a) => ['3', '4', '5', '6'].includes(String(a.text)));
    console.log(
      'shot',
      slot,
      outDir,
      focus.map((a) => a.text + ':' + a.localPos.join(','))
    );
  }
  await browser.close();
  console.log('MESH_NOSE_DONE');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
