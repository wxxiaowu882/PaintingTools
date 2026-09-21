/**
 * 叶问收尾：修 V03 唇颏链、V05a 见鼻相机+4/D 分离，再整包外轮廓截图
 */
require('./_playwright-browsers-path');
const fs = require('fs');
const path = require('path');
const lib = require('./headform-vision-place-lib');

process.env.MODEL_ID = 'male_ipman_01';
process.env.MODEL_LABEL = '叶问';

const MID = 'male_ipman_01';
const runsRoot = path.join(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, stamp + '-ipman-finish-pack');
fs.mkdirSync(outDir, { recursive: true });

async function meshPick(page, scoreFn, opts) {
  return page.evaluate(
    ({ scoreSrc, y0, y1, zMin, xMax }) => {
      // eslint-disable-next-line no-new-func
      const scoreFn2 = new Function('v', 'return (' + scoreSrc + ')(v)');
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
      let best = null;
      let bestS = -1e9;
      const v = new THREE.Vector3();
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
          const s = scoreFn2(v);
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
      let localNormal = new THREE.Vector3(best.x, 0, best.z).normalize();
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
    {
      scoreSrc: scoreFn.toString(),
      y0: opts.y0,
      y1: opts.y1,
      zMin: opts.zMin,
      xMax: opts.xMax
    }
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

  // —— V05a：相机略侧前（相对隐鼻），鼻头保持网格尖，4/D 分离 ——
  {
    const hit = lib.findScene('V05a', MID);
    const scenePath = path.join(lib.jsonDir, hit.f);
    const data = JSON.parse(fs.readFileSync(scenePath, 'utf8'));
    data.camera = Object.assign({}, data.camera || {}, {
      pos: [4.05, 1.18, -1.55],
      target: [0.02, 0.8, 0.04],
      zoom: 0.56,
      fov: 15
    });
    fs.writeFileSync(scenePath, JSON.stringify(data));
    lib.rebuildAggregate();

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Array.isArray(window.customScenes) && window.customScenes.length > 0, null, {
      timeout: 180000
    });
    const hit2 = lib.findScene('V05a', MID);
    await lib.openScene(page, hit2.d.id);
    await lib.applyCamera(page, data.camera);
    await lib.setAnnosVisible(page, false);

    const tip = await meshPick(page, (v) => v.z * 12 - Math.abs(v.x) * 4, {
      y0: 0.14,
      y1: 0.17,
      zMin: 0.085,
      xMax: 0.03
    });
    console.log('V05a tip', tip);
    if (tip.ok) lib.writeLandmark(scenePath, '3', tip, null, 'V05a');

    // 4 口轮匝肌/上下唇：鼻头下方略侧前缘
    const lip = await meshPick(page, (v) => v.z * 8 - Math.abs(v.x - 0.035) * 2, {
      y0: 0.125,
      y1: 0.145,
      zMin: 0.055,
      xMax: 0.07
    });
    console.log('V05a 4', lip);
    if (lip.ok) lib.writeLandmark(scenePath, '4', lip, null, 'V05a');

    // D 口轮匝肌下缘：比 4 更低
    const dPt = await meshPick(page, (v) => v.z * 8 - Math.abs(v.x - 0.038) * 2, {
      y0: 0.105,
      y1: 0.125,
      zMin: 0.05,
      xMax: 0.07
    });
    console.log('V05a D', dPt);
    if (dPt.ok) lib.writeLandmark(scenePath, 'D', dPt, null, 'V05a');

    // 5 颏结节
    const chin = await meshPick(page, (v) => v.z * 6 - Math.abs(v.x - 0.035), {
      y0: 0.09,
      y1: 0.115,
      zMin: 0.045,
      xMax: 0.065
    });
    console.log('V05a 5', chin);
    if (chin.ok) lib.writeLandmark(scenePath, '5', chin, null, 'V05a');
  }

  // —— V03：修 4上唇 / 5下唇 / 6颏肌 / D唇缝 / E颏唇沟 ——
  {
    const hit = lib.findScene('V03', MID);
    const scenePath = path.join(lib.jsonDir, hit.f);
    const data = JSON.parse(fs.readFileSync(scenePath, 'utf8'));
    await lib.openScene(page, data.id);
    await lib.applyCamera(page, data.camera || null);
    await lib.setAnnosVisible(page, false);

    const tip = await meshPick(page, (v) => v.z * 12 - Math.abs(v.x) * 2, {
      y0: 0.145,
      y1: 0.165,
      zMin: 0.085,
      xMax: 0.035
    });
    console.log('V03 tip', tip);
    if (tip.ok) lib.writeLandmark(scenePath, '3', tip, null, 'V03');

    const upper = await meshPick(page, (v) => v.z * 10 - Math.abs(v.x) * 1.5, {
      y0: 0.128,
      y1: 0.142,
      zMin: 0.075,
      xMax: 0.03
    });
    console.log('V03 4 upper', upper);
    if (upper.ok) lib.writeLandmark(scenePath, '4', upper, null, 'V03');

    const lower = await meshPick(page, (v) => v.z * 10 - Math.abs(v.x) * 1.5, {
      y0: 0.112,
      y1: 0.126,
      zMin: 0.07,
      xMax: 0.03
    });
    console.log('V03 5 lower', lower);
    if (lower.ok) lib.writeLandmark(scenePath, '5', lower, null, 'V03');

    const mentalis = await meshPick(page, (v) => v.z * 8 - Math.abs(v.x), {
      y0: 0.095,
      y1: 0.11,
      zMin: 0.065,
      xMax: 0.03
    });
    console.log('V03 6 mentalis', mentalis);
    if (mentalis.ok) lib.writeLandmark(scenePath, '6', mentalis, null, 'V03');

    if (upper.ok && lower.ok) {
      const seam = await lib.placeBetweenNeighbors(page, upper.localPos, lower.localPos, {
        bias: 0.45,
        preferFront: true
      });
      console.log('V03 D seam', seam && seam.localPos);
      if (seam && seam.ok) lib.writeLandmark(scenePath, 'D', seam, null, 'V03');
    }
    if (lower.ok && mentalis.ok) {
      const groove = await lib.placeBetweenNeighbors(page, lower.localPos, mentalis.localPos, {
        bias: 0.4,
        preferFront: true
      });
      console.log('V03 E groove', groove && groove.localPos);
      if (groove && groove.ok) lib.writeLandmark(scenePath, 'E', groove, null, 'V03');
    }

    const chinBottom = await meshPick(page, (v) => -v.y * 5 + v.z * 3 - Math.abs(v.x), {
      y0: 0.07,
      y1: 0.09,
      zMin: 0.055,
      xMax: 0.035
    });
    console.log('V03 7 chinBottom', chinBottom);
    if (chinBottom.ok) lib.writeLandmark(scenePath, '7', chinBottom, null, 'V03');
  }

  // —— 整包外轮廓截图 ——
  const slots = ['V01', 'V02', 'V03', 'V04', 'V05a', 'V05b', 'V06', 'V07'];
  for (const slot of slots) {
    const h = lib.findScene(slot, MID);
    const d = JSON.parse(fs.readFileSync(path.join(lib.jsonDir, h.f), 'utf8'));
    d.meta = Object.assign({}, d.meta || {}, {
      status: 'vision_place_pending_qa',
      modelId: MID,
      modelRole: 'contrast',
      modelLabel: '叶问'
    });
    fs.writeFileSync(path.join(lib.jsonDir, h.f), JSON.stringify(d));
    await lib.openScene(page, d.id);
    await lib.applyCamera(page, d.camera || null);
    await lib.setAnnosVisible(page, true);
    await page.waitForTimeout(600);
    const shot = path.join(outDir, slot + '_anno.png');
    await page.screenshot({ path: shot });
    const texts = (((d.items || [])[0] || {}).annotations || []).map((a) => a.text).join(',');
    console.log('shot', slot, texts, shot);
  }

  // L 关确认无标注
  for (const slot of ['L01', 'L02', 'L03', 'L04', 'L05', 'L06', 'L07', 'L08', 'L09']) {
    const h = lib.findScene(slot, MID);
    const d = JSON.parse(fs.readFileSync(path.join(lib.jsonDir, h.f), 'utf8'));
    const n = (((d.items || [])[0] || {}).annotations || []).length;
    const hasKp = !!(d.meta && String(d.meta.keyPoints || '').trim());
    console.log('Lcheck', slot, 'ann', n, 'kp', hasKp, d.meta && d.meta.status);
  }

  lib.rebuildAggregate();
  await browser.close();
  console.log('FINISH_PACK', outDir);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
