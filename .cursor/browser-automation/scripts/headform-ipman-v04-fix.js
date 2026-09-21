/**
 * 叶问 V04 全侧面：按 keyPoints 语义重钉前脸链 + 顶/后点
 */
require('./_playwright-browsers-path');
const fs = require('fs');
const path = require('path');
const lib = require('./headform-vision-place-lib');

process.env.MODEL_ID = 'male_ipman_01';
process.env.MODEL_LABEL = '叶问';
const MID = 'male_ipman_01';

async function meshPick(page, y0, y1, zMin, xMax, scoreSrc, preferMaxZ) {
  return page.evaluate(
    ({ y0, y1, zMin, xMax, scoreSrc, preferMaxZ }) => {
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
          let s = scoreFn(v);
          if (preferMaxZ) s = v.z * 20 - Math.abs(v.x) * 3;
          if (s > bestS) {
            bestS = s;
            best = v.clone();
          }
        }
      }
      if (!best) return { ok: false };
      const world = root.localToWorld(best.clone());
      const ndc = world.clone().project(cam);
      const u = (ndc.x + 1) / 2;
      const vv = (1 - ndc.y) / 2;
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(u * 2 - 1, -(vv * 2 - 1)), cam);
      const hits = raycaster.intersectObjects(meshes, true);
      let localPos = best.clone();
      let localNormal = new THREE.Vector3(0, 0, 1);
      let baseDist = cam.position.distanceTo(world);
      if (hits.length) {
        const hp = root.worldToLocal(hits[0].point.clone());
        if (hp.z >= best.z - 0.02) {
          localPos = hp;
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
    },
    { y0, y1, zMin, xMax, scoreSrc, preferMaxZ: !!preferMaxZ }
  );
}

async function silAtV(page, vTarget, side, opts) {
  return page.evaluate(
    ({ vTarget, side, y0, y1, zMin, zMax, requireBack }) => {
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
      const uStart = side === 'right' ? 0.95 : 0.05;
      const uEnd = side === 'right' ? 0.4 : 0.6;
      const step = side === 'right' ? -0.004 : 0.004;
      let best = null;
      for (let u = uStart; side === 'right' ? u >= uEnd : u <= uEnd; u += step) {
        raycaster.setFromCamera(new THREE.Vector2(u * 2 - 1, -(vTarget * 2 - 1)), cam);
        const hits = raycaster.intersectObjects(meshes, true);
        if (!hits.length) continue;
        const hp = root.worldToLocal(hits[0].point.clone());
        if (hp.y < y0 || hp.y > y1) continue;
        if (hp.z < zMin || hp.z > zMax) continue;
        if (requireBack && hp.z > -0.02) continue;
        let localNormal = new THREE.Vector3(side === 'right' ? 1 : -1, 0, 0);
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
          baseScale: +Number(root.scale.x).toFixed(4)
        };
        break;
      }
      return best || { ok: false };
    },
    Object.assign({ vTarget, side }, opts)
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

  const S = '(v)=>v.z*10-Math.abs(v.x)*2';
  const picks = {
    // 1 眉弓
    1: await meshPick(page, 0.21, 0.235, 0.05, 0.04, S),
    // 2 鼻头
    2: await meshPick(page, 0.145, 0.165, 0.085, 0.03, S, true),
    // 3 上唇
    3: await meshPick(page, 0.128, 0.14, 0.075, 0.03, S),
    // 4 下唇
    4: await meshPick(page, 0.112, 0.126, 0.07, 0.03, S),
    // 5 颏凸隆
    5: await meshPick(page, 0.09, 0.105, 0.065, 0.03, S),
    // 6 颏底
    6: await meshPick(page, 0.068, 0.085, 0.05, 0.035, '(v)=>-v.y*4+v.z*5-Math.abs(v.x)'),
    // 8 颅顶
    8: await meshPick(page, 0.28, 0.32, -0.08, 0.08, '(v)=>v.y*10-Math.abs(v.x)-Math.abs(v.z)*0.3'),
    // 9 发际
    9: await meshPick(page, 0.255, 0.28, 0.02, 0.05, S),
    // A 眉弓上缘
    A: await meshPick(page, 0.235, 0.255, 0.04, 0.04, S),
    // B 鼻根
    B: await meshPick(page, 0.175, 0.2, 0.06, 0.035, S),
    // C 鼻唇角
    C: await meshPick(page, 0.14, 0.155, 0.08, 0.03, S),
    // F 颈点
    F: await meshPick(page, 0.04, 0.06, 0.01, 0.04, '(v)=>v.z*3-Math.abs(v.x)-v.y')
  };

  // 7 枕后 / G 风府：侧视右缘偏后
  picks[7] = await silAtV(page, 0.32, 'right', { y0: 0.18, y1: 0.24, zMin: -0.15, zMax: -0.02, requireBack: true });
  picks.G = await silAtV(page, 0.48, 'right', { y0: 0.09, y1: 0.14, zMin: -0.12, zMax: 0.0, requireBack: false });

  for (const [k, p] of Object.entries(picks)) {
    console.log(k, p && p.ok ? p.localPos : p);
    if (p && p.ok) lib.writeLandmark(scenePath, k, p, null, 'V04');
  }

  // D 唇缝、E 颏唇沟：邻点插值
  if (picks[3] && picks[3].ok && picks[4] && picks[4].ok) {
    const d = await lib.placeBetweenNeighbors(page, picks[3].localPos, picks[4].localPos, {
      bias: 0.5,
      preferFront: true
    });
    console.log('D', d && d.localPos);
    if (d && d.ok) lib.writeLandmark(scenePath, 'D', d, null, 'V04');
  }
  if (picks[4] && picks[4].ok && picks[5] && picks[5].ok) {
    const e = await lib.placeBetweenNeighbors(page, picks[4].localPos, picks[5].localPos, {
      bias: 0.45,
      preferFront: true
    });
    console.log('E', e && e.localPos);
    if (e && e.ok) lib.writeLandmark(scenePath, 'E', e, null, 'V04');
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = path.join(__dirname, '..', 'runs', stamp + '-ipman-v04-fix');
  fs.mkdirSync(outDir, { recursive: true });
  const d2 = JSON.parse(fs.readFileSync(scenePath, 'utf8'));
  d2.meta = Object.assign({}, d2.meta || {}, {
    status: 'vision_place_pending_qa',
    modelId: MID,
    modelRole: 'contrast',
    modelLabel: '叶问'
  });
  fs.writeFileSync(scenePath, JSON.stringify(d2));
  lib.rebuildAggregate();
  await lib.openScene(page, d2.id);
  await lib.applyCamera(page, d2.camera || null);
  await lib.setAnnosVisible(page, true);
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(outDir, 'V04_anno.png') });
  await browser.close();
  console.log('V04_FIX_DONE', outDir);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
