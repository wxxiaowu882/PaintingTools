/**
 * 叶问：网格鼻尖直接写入（防颊挡射线）；V05a 相机略侧前
 */
require('./_playwright-browsers-path');
const fs = require('fs');
const path = require('path');
const lib = require('./headform-vision-place-lib');

process.env.MODEL_ID = 'male_ipman_01';
process.env.MODEL_LABEL = '叶问';

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

  const hit = lib.findScene('V05a', 'male_ipman_01');
  const scenePath = path.join(lib.jsonDir, hit.f);
  const data = JSON.parse(fs.readFileSync(scenePath, 'utf8'));
  data.camera = Object.assign({}, data.camera || {}, {
    pos: [3.6, 1.35, -1.85],
    target: [0.0, 0.8, 0.05],
    zoom: 0.56,
    fov: 15
  });
  fs.writeFileSync(scenePath, JSON.stringify(data));
  lib.rebuildAggregate();

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Array.isArray(window.customScenes) && window.customScenes.length > 0, null, {
    timeout: 180000
  });
  const hit2 = lib.findScene('V05a', 'male_ipman_01');
  await lib.openScene(page, hit2.d.id);
  await lib.applyCamera(page, data.camera);
  await lib.setAnnosVisible(page, false);

  const placed = await page.evaluate(() => {
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
      const pos = mesh.geometry && mesh.geometry.attributes && mesh.geometry.attributes.position;
      if (!pos) continue;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        mesh.localToWorld(v);
        root.worldToLocal(v);
        if (v.y < 0.12 || v.y > 0.17) continue;
        if (v.z < 0.08) continue;
        if (Math.abs(v.x) > 0.035) continue;
        const s = v.z * 10 - Math.abs(v.x) * 3;
        if (s > tipScore) {
          tipScore = s;
          tipLocal = v.clone();
        }
      }
    }
    if (!tipLocal) return { ok: false, reason: 'no tip' };
    const world = root.localToWorld(tipLocal.clone());
    const ndc = world.clone().project(cam);
    const uTip = (ndc.x + 1) / 2;
    const vTip = (1 - ndc.y) / 2;
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(uTip * 2 - 1, -(vTip * 2 - 1)), cam);
    const hits = raycaster.intersectObjects(meshes, true);
    let localPos = tipLocal.clone();
    let localNormal = new THREE.Vector3(tipLocal.x, 0, tipLocal.z).normalize();
    let baseDist = cam.position.distanceTo(world);
    if (hits.length) {
      const hitPos = root.worldToLocal(hits[0].point.clone());
      if (hitPos.z >= tipLocal.z - 0.015) {
        localPos = hitPos;
        if (hits[0].face && hits[0].face.normal) {
          const nWorld = hits[0].face.normal.clone().transformDirection(hits[0].object.matrixWorld).normalize();
          const toCam = cam.position.clone().sub(hits[0].point).normalize();
          if (nWorld.dot(toCam) < -0.05) nWorld.multiplyScalar(-1);
          localNormal = root.worldToLocal(hits[0].point.clone().add(nWorld)).sub(hitPos.clone()).normalize();
        }
        baseDist = hits[0].distance;
      }
    }
    return {
      ok: true,
      localPos: [+localPos.x.toFixed(4), +localPos.y.toFixed(4), +localPos.z.toFixed(4)],
      localNormal: [+localNormal.x.toFixed(3), +localNormal.y.toFixed(3), +localNormal.z.toFixed(3)],
      baseDist: +baseDist.toFixed(4),
      baseScale: +Number(root.scale.x).toFixed(4),
      tip: [+tipLocal.x.toFixed(4), +tipLocal.y.toFixed(4), +tipLocal.z.toFixed(4)]
    };
  });
  console.log('V05a', placed);
  if (!placed.ok) throw new Error('V05a fail');
  lib.writeLandmark(scenePath, '3', placed, null, 'V05a');

  const hit3 = lib.findScene('V03', 'male_ipman_01');
  const path3 = path.join(lib.jsonDir, hit3.f);
  const d3 = JSON.parse(fs.readFileSync(path3, 'utf8'));
  await lib.openScene(page, d3.id);
  await lib.applyCamera(page, d3.camera || null);
  await lib.setAnnosVisible(page, false);
  const p3 = await page.evaluate(() => {
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
      const pos = mesh.geometry && mesh.geometry.attributes && mesh.geometry.attributes.position;
      if (!pos) continue;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i);
        mesh.localToWorld(v);
        root.worldToLocal(v);
        if (v.y < 0.145 || v.y > 0.18) continue;
        if (v.z < 0.08) continue;
        const s = v.z * 10 - Math.abs(v.x);
        if (s > tipScore) {
          tipScore = s;
          tipLocal = v.clone();
        }
      }
    }
    if (!tipLocal) return { ok: false };
    const world = root.localToWorld(tipLocal.clone());
    const ndc = world.clone().project(cam);
    const u = (ndc.x + 1) / 2;
    const vv = (1 - ndc.y) / 2;
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(u * 2 - 1, -(vv * 2 - 1)), cam);
    const hits = raycaster.intersectObjects(meshes, true);
    let localPos = tipLocal.clone();
    let localNormal = new THREE.Vector3(0, 0, 1);
    let baseDist = cam.position.distanceTo(world);
    if (hits.length) {
      const hp = root.worldToLocal(hits[0].point.clone());
      if (hp.z >= tipLocal.z - 0.012) {
        localPos = hp;
        if (hits[0].face && hits[0].face.normal) {
          const nWorld = hits[0].face.normal.clone().transformDirection(hits[0].object.matrixWorld).normalize();
          const toCam = cam.position.clone().sub(hits[0].point).normalize();
          if (nWorld.dot(toCam) < -0.05) nWorld.multiplyScalar(-1);
          localNormal = root.worldToLocal(hits[0].point.clone().add(nWorld)).sub(hp.clone()).normalize();
        }
        baseDist = hits[0].distance;
      }
    }
    return {
      ok: true,
      localPos: [+localPos.x.toFixed(4), +localPos.y.toFixed(4), +localPos.z.toFixed(4)],
      localNormal: [+localNormal.x.toFixed(3), +localNormal.y.toFixed(3), +localNormal.z.toFixed(3)],
      baseDist: +baseDist.toFixed(4),
      baseScale: +Number(root.scale.x).toFixed(4)
    };
  });
  console.log('V03', p3);
  if (p3.ok) {
    lib.writeLandmark(path3, '3', p3, null, 'V03');
    const lip = await lib.placeBetweenNeighbors(page, p3.localPos, p3.localPos, {
      bias: 0,
      yNudge: -0.028,
      zNudge: -0.014,
      preferFront: true
    });
    if (lip && lip.ok) {
      lib.writeLandmark(path3, '4', lip, null, 'V03');
      console.log('lip', lip.localPos);
    }
  }

  for (const slot of ['V05a', 'V03', 'V02']) {
    const h = lib.findScene(slot, 'male_ipman_01');
    const d = JSON.parse(fs.readFileSync(path.join(lib.jsonDir, h.f), 'utf8'));
    await lib.openScene(page, d.id);
    await lib.applyCamera(page, d.camera || null);
    await lib.setAnnosVisible(page, true);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outDir = path.join(__dirname, '..', 'runs', stamp + '-vision-place-' + slot + '-_');
    fs.mkdirSync(outDir, { recursive: true });
    await page.screenshot({ path: path.join(outDir, 'verify.png') });
    console.log('shot', slot, outDir);
  }
  await browser.close();
  console.log('DIRECT_TIP_DONE');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
