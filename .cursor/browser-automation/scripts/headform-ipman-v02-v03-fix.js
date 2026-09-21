/**
 * 叶问：修 V02 左缘 3/4/A；修 V03 唇颏链 4/5/6/D/E 分离
 */
require('./_playwright-browsers-path');
const fs = require('fs');
const path = require('path');
const lib = require('./headform-vision-place-lib');

process.env.MODEL_ID = 'male_ipman_01';
process.env.MODEL_LABEL = '叶问';
const MID = 'male_ipman_01';

async function snapLeftSilhouette(page, vTarget, opts) {
  return page.evaluate(
    ({ vTarget, y0, y1, zMin, ignoreEar, preferFaceZ }) => {
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
      const raycaster = new THREE.Raycaster();
      let best = null;
      let bestX = 1e9;
      // 在目标屏幕 v 附近，从左往右扫到剪影
      for (let du = 0; du < 0.55; du += 0.004) {
        const u = du;
        const v = vTarget;
        raycaster.setFromCamera(new THREE.Vector2(u * 2 - 1, -(v * 2 - 1)), cam);
        const hits = raycaster.intersectObjects(meshes, true);
        if (!hits.length) continue;
        const hp = root.worldToLocal(hits[0].point.clone());
        if (hp.y < y0 || hp.y > y1) continue;
        if (hp.z < zMin) continue;
        if (ignoreEar && hp.z < 0.012) continue;
        if (preferFaceZ && hp.z < 0.015) continue;
        if (hp.x < bestX) {
          bestX = hp.x;
          let localNormal = new THREE.Vector3(-1, 0, 0);
          if (hits[0].face && hits[0].face.normal) {
            const nWorld = hits[0].face.normal
              .clone()
              .transformDirection(hits[0].object.matrixWorld)
              .normalize();
            const toCam = cam.position.clone().sub(hits[0].point).normalize();
            if (nWorld.dot(toCam) < -0.05) nWorld.multiplyScalar(-1);
            localNormal = root
              .worldToLocal(hits[0].point.clone().add(nWorld))
              .sub(hp.clone())
              .normalize();
          }
          best = {
            ok: true,
            localPos: [+hp.x.toFixed(4), +hp.y.toFixed(4), +hp.z.toFixed(4)],
            localNormal: [+localNormal.x.toFixed(3), +localNormal.y.toFixed(3), +localNormal.z.toFixed(3)],
            baseDist: +hits[0].distance.toFixed(4),
            baseScale: +Number(root.scale.x).toFixed(4),
            u: +u.toFixed(4),
            v: +v.toFixed(4)
          };
          // 找到左缘即可（继续扫可能更左但易漂）
          break;
        }
      }
      return best || { ok: false, reason: 'no sil' };
    },
    opts
  );
}

async function meshFront(page, y0, y1, zMin, xMax, scoreSrc) {
  return page.evaluate(
    ({ y0, y1, zMin, xMax, scoreSrc }) => {
      // eslint-disable-next-line no-new-func
      const scoreFn = new Function('v', 'return (' + scoreSrc + ')(v)');
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
          const s = scoreFn(v);
          if (s > bestS) {
            bestS = s;
            best = v.clone();
          }
        }
      }
      if (!best) return { ok: false };
      const world = root.localToWorld(best.clone());
      let localNormal = new THREE.Vector3(0, 0, 1);
      const baseDist = cam.position.distanceTo(world);
      return {
        ok: true,
        localPos: [+best.x.toFixed(4), +best.y.toFixed(4), +best.z.toFixed(4)],
        localNormal: [+localNormal.x.toFixed(3), +localNormal.y.toFixed(3), +localNormal.z.toFixed(3)],
        baseDist: +baseDist.toFixed(4),
        baseScale: +Number(root.scale.x).toFixed(4)
      };
    },
    { y0, y1, zMin, xMax, scoreSrc }
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

  // —— V02：3 颧弓 / 4 颊转角 / A 角前切迹 → 左缘剪影 ——
  {
    const hit = lib.findScene('V02', MID);
    const scenePath = path.join(lib.jsonDir, hit.f);
    const data = JSON.parse(fs.readFileSync(scenePath, 'utf8'));
    await lib.openScene(page, data.id);
    await lib.applyCamera(page, data.camera || null);
    await lib.setAnnosVisible(page, false);

    // 颧弓高度：忽略耳后（zMin 偏正）
    const p3 = await snapLeftSilhouette(page, 0.38, {
      vTarget: 0.38,
      y0: 0.155,
      y1: 0.185,
      zMin: 0.01,
      ignoreEar: true,
      preferFaceZ: true
    });
    console.log('V02-3', p3);
    if (p3.ok) lib.writeLandmark(scenePath, '3', p3, null, 'V02');

    const p4 = await snapLeftSilhouette(page, 0.46, {
      vTarget: 0.46,
      y0: 0.125,
      y1: 0.155,
      zMin: 0.02,
      ignoreEar: true,
      preferFaceZ: true
    });
    console.log('V02-4', p4);
    if (p4.ok) lib.writeLandmark(scenePath, '4', p4, null, 'V02');

    const pA = await snapLeftSilhouette(page, 0.5, {
      vTarget: 0.5,
      y0: 0.115,
      y1: 0.14,
      zMin: 0.025,
      ignoreEar: true,
      preferFaceZ: true
    });
    console.log('V02-A', pA);
    if (pA.ok) lib.writeLandmark(scenePath, 'A', pA, null, 'V02');
  }

  // —— V03：唇颏链拉开 ——
  {
    const hit = lib.findScene('V03', MID);
    const scenePath = path.join(lib.jsonDir, hit.f);
    const data = JSON.parse(fs.readFileSync(scenePath, 'utf8'));
    await lib.openScene(page, data.id);
    await lib.applyCamera(page, data.camera || null);
    await lib.setAnnosVisible(page, false);

    const upper = await meshFront(page, 0.132, 0.142, 0.078, 0.028, '(v)=>v.z*10-Math.abs(v.x)*2');
    console.log('V03-4', upper);
    if (upper.ok) lib.writeLandmark(scenePath, '4', upper, null, 'V03');

    const lower = await meshFront(page, 0.115, 0.125, 0.072, 0.028, '(v)=>v.z*10-Math.abs(v.x)*2');
    console.log('V03-5', lower);
    if (lower.ok) lib.writeLandmark(scenePath, '5', lower, null, 'V03');

    const mentalis = await meshFront(page, 0.098, 0.11, 0.065, 0.028, '(v)=>v.z*8-Math.abs(v.x)');
    console.log('V03-6', mentalis);
    if (mentalis.ok) lib.writeLandmark(scenePath, '6', mentalis, null, 'V03');

    if (upper.ok && lower.ok) {
      const seam = await lib.placeBetweenNeighbors(page, upper.localPos, lower.localPos, {
        bias: 0.5,
        preferFront: true
      });
      console.log('V03-D', seam && seam.localPos);
      if (seam && seam.ok) lib.writeLandmark(scenePath, 'D', seam, null, 'V03');
    }
    if (lower.ok && mentalis.ok) {
      const groove = await lib.placeBetweenNeighbors(page, lower.localPos, mentalis.localPos, {
        bias: 0.45,
        preferFront: true
      });
      console.log('V03-E', groove && groove.localPos);
      if (groove && groove.ok) lib.writeLandmark(scenePath, 'E', groove, null, 'V03');
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.join(__dirname, '..', 'runs', stamp + '-ipman-v02-v03-fix');
  fs.mkdirSync(outDir, { recursive: true });
  for (const slot of ['V02', 'V03', 'V05a', 'V05b']) {
    const h = lib.findScene(slot, MID);
    const d = JSON.parse(fs.readFileSync(path.join(lib.jsonDir, h.f), 'utf8'));
    await lib.openScene(page, d.id);
    await lib.applyCamera(page, d.camera || null);
    await lib.setAnnosVisible(page, true);
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(outDir, slot + '_anno.png') });
    console.log('shot', slot);
  }
  lib.rebuildAggregate();
  await browser.close();
  console.log('V02_V03_FIX_DONE', outDir);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
