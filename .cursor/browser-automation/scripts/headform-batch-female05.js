/**
 * 女05 全 slot 批量：大本标注/虚线 → AABB 归一化 + 稀疏射线贴女模表面
 * 目标：经典框架先落上，供手调；每关截图供 AI 视觉粗验
 * 用法：node scripts/headform-batch-female05.js
 * 可选：SLOTS=V01,V02 或 SKIP_SHOT=1
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-female05-batch`);
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:18080';
const SKIP_SHOT = process.env.SKIP_SHOT === '1';
fs.mkdirSync(outDir, { recursive: true });

const RE = /^(\d+[A-Za-z]?)_(.+)\.json$/i;
const ALL_SLOTS = ['V01', 'V02', 'V03', 'V04', 'V05a', 'V05b', 'V06', 'V07', 'L01', 'L02', 'L03', 'L04', 'L05', 'L06', 'L07', 'L08', 'L09'];
const SLOTS = (process.env.SLOTS || ALL_SLOTS.join(','))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function listScenes() {
  return fs.readdirSync(jsonDir).filter((n) => RE.test(n));
}

function loadPair(slot) {
  let male;
  let female;
  for (const f of listScenes()) {
    const d = JSON.parse(fs.readFileSync(path.join(jsonDir, f), 'utf8'));
    if ((d.meta && d.meta.slot) !== slot) continue;
    const isF = (d.meta && d.meta.modelId) === 'female_05' || f.includes('女05');
    if (isF) female = { f, d };
    else male = { f, d };
  }
  return { male, female };
}

function rebuildAggregate() {
  function lessonNum(name) {
    const m = String(name).match(/^(\d+)/);
    return m ? Number(m[1]) : 0;
  }
  const all = listScenes();
  all.sort((a, b) => {
    const ma = a.match(RE);
    const mb = b.match(RE);
    const na = lessonNum(ma[1]);
    const nb = lessonNum(mb[1]);
    if (na !== nb) return na - nb;
    const la = ma[1].replace(/^\d+/, '');
    const lb = mb[1].replace(/^\d+/, '');
    if (la !== lb) return la.localeCompare(lb, 'zh-CN');
    const da = JSON.parse(fs.readFileSync(path.join(jsonDir, a), 'utf8'));
    const db = JSON.parse(fs.readFileSync(path.join(jsonDir, b), 'utf8'));
    const ra = da.meta && da.meta.modelRole === 'reference' ? 0 : 1;
    const rb = db.meta && db.meta.modelRole === 'reference' ? 0 : 1;
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b, 'zh-CN', { numeric: true });
  });
  fs.writeFileSync(
    path.join(jsonDir, '沙盒_头部造型规律.json'),
    JSON.stringify(all.map((n) => JSON.parse(fs.readFileSync(path.join(jsonDir, n), 'utf8'))))
  );
}

async function waitReady(page) {
  await page
    .waitForFunction(() => {
      const el = document.getElementById('scene-loader');
      if (!el) return true;
      const st = getComputedStyle(el);
      return st.display === 'none' || Number(st.opacity || 1) < 0.05;
    }, null, { timeout: 420000 })
    .catch(() => {});
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    const el = document.getElementById('scene-loader');
    if (el) el.style.display = 'none';
    const m = document.getElementById('scene-grid-modal');
    if (m) m.style.display = 'none';
  });
  await page
    .waitForFunction(() => {
      const host = window.__solidHost;
      if (!host || !host.getSceneGroup) return false;
      let n = 0;
      host.getSceneGroup().traverse((o) => {
        if (o.isMesh && o.geometry) n++;
      });
      return n > 0;
    }, null, { timeout: 120000 })
    .catch(() => {});
}

async function openId(page, id) {
  const idx = await page.evaluate((sid) => (window.customScenes || []).findIndex((s) => s && String(s.id) === sid), id);
  if (idx < 0) throw new Error('missing scene ' + id);
  await page.evaluate((i) => {
    window.currentSceneIndex = -1;
    window.switchScene(i);
  }, idx);
  await waitReady(page);
  await page.waitForTimeout(600);
  return idx;
}

async function measureLocalBox(page) {
  return page.evaluate(() => {
    const host = window.__solidHost;
    const THREE = host.getTHREE();
    const g = host.getSceneGroup();
    let root = null;
    g.traverse((o) => {
      if (!root && o.userData && o.userData.type === 'glb') root = o;
    });
    if (!root) root = g.children[0];
    // 用未变换的 geometry 合并本地包围盒更稳：退化为世界盒再转回 local
    const boxW = new THREE.Box3().setFromObject(root);
    const corners = [
      new THREE.Vector3(boxW.min.x, boxW.min.y, boxW.min.z),
      new THREE.Vector3(boxW.min.x, boxW.min.y, boxW.max.z),
      new THREE.Vector3(boxW.min.x, boxW.max.y, boxW.min.z),
      new THREE.Vector3(boxW.min.x, boxW.max.y, boxW.max.z),
      new THREE.Vector3(boxW.max.x, boxW.min.y, boxW.min.z),
      new THREE.Vector3(boxW.max.x, boxW.min.y, boxW.max.z),
      new THREE.Vector3(boxW.max.x, boxW.max.y, boxW.min.z),
      new THREE.Vector3(boxW.max.x, boxW.max.y, boxW.max.z)
    ];
    const boxL = new THREE.Box3();
    for (const c of corners) {
      root.worldToLocal(c);
      boxL.expandByPoint(c);
    }
    const size = boxL.getSize(new THREE.Vector3());
    return {
      min: [boxL.min.x, boxL.min.y, boxL.min.z],
      max: [boxL.max.x, boxL.max.y, boxL.max.z],
      size: [size.x, size.y, size.z]
    };
  });
}

function mapLocal(malePos, mBox, fBox) {
  const t = [
    mBox.size[0] > 1e-8 ? (malePos[0] - mBox.min[0]) / mBox.size[0] : 0.5,
    mBox.size[1] > 1e-8 ? (malePos[1] - mBox.min[1]) / mBox.size[1] : 0.5,
    mBox.size[2] > 1e-8 ? (malePos[2] - mBox.min[2]) / mBox.size[2] : 0.5
  ];
  return [
    fBox.min[0] + t[0] * fBox.size[0],
    fBox.min[1] + t[1] * fBox.size[1],
    fBox.min[2] + t[2] * fBox.size[2]
  ];
}

(async () => {
  console.log('[batch] start', outDir, 'slots', SLOTS.join(','));
  const summary = [];

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(300000);

  await page.goto(`${baseUrl}/Solid?sandbox=headform&skipPerf=1&_=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 180000
  });
  await page.waitForSelector('#scene-grid-modal', { state: 'visible', timeout: 180000 });

  // 测男/女本地包围盒（各载一次）
  const pair0 = loadPair('V02');
  console.log('[batch] measure male box');
  await openId(page, pair0.male.d.id);
  const maleBox = await measureLocalBox(page);
  console.log('[batch] maleBox', maleBox);
  console.log('[batch] measure female box');
  await openId(page, pair0.female.d.id);
  const femaleBox = await measureLocalBox(page);
  console.log('[batch] femaleBox', femaleBox);
  fs.writeFileSync(path.join(outDir, 'boxes.json'), JSON.stringify({ maleBox, femaleBox }, null, 2));

  for (const slot of SLOTS) {
    const t0 = Date.now();
    console.log('\n[batch] ===', slot, '===');
    const pair = loadPair(slot);
    if (!pair.male || !pair.female) {
      summary.push({ slot, ok: false, error: 'pair missing' });
      continue;
    }
    const maleAnnos = (pair.male.d.items[0] && pair.male.d.items[0].annotations) || [];
    const maleDashed = (pair.male.d.items[0] && pair.male.d.items[0].dashedLines) || [];
    if (!maleAnnos.length) {
      summary.push({ slot, ok: false, error: 'male no annos' });
      continue;
    }

    // 预映射种子
    const seeds = maleAnnos.map((a) => ({
      text: a.text,
      id: a.id,
      seed: mapLocal(a.localPos || [0, 0, 0], maleBox, femaleBox),
      norm: a.localNormal || [0, 1, 0],
      raw: a
    }));
    const dashSeeds = maleDashed.map((line) => ({
      line,
      points: (line.points || []).map((p) => ({
        raw: p,
        seed: mapLocal(p.pos || [0, 0, 0], maleBox, femaleBox),
        norm: p.norm || [0, 1, 0]
      }))
    }));

    await openId(page, pair.female.d.id);

    // 套用大本机位，便于对照
    if (pair.male.d.camera) {
      await page.evaluate((cam) => {
        const host = window.__solidHost;
        const c = host.getCamera();
        const controls = host.getControls && host.getControls();
        if (cam.pos) c.position.set(cam.pos[0], cam.pos[1], cam.pos[2]);
        if (typeof cam.fov === 'number') c.fov = cam.fov;
        if (typeof cam.zoom === 'number') c.zoom = cam.zoom;
        c.updateProjectionMatrix();
        if (controls && cam.target) {
          controls.target.set(cam.target[0], cam.target[1], cam.target[2]);
          controls.update();
        }
      }, pair.male.d.camera);
      await page.waitForTimeout(200);
    }

    const remapped = await page.evaluate(
      ({ seeds, dashSeeds }) => {
        const host = window.__solidHost;
        const THREE = host.getTHREE();
        const cam = host.getCamera();
        const g = host.getSceneGroup();
        let root = null;
        g.traverse((o) => {
          if (!root && o.userData && o.userData.type === 'glb') root = o;
        });
        if (!root) root = g.children[0];
        const all = [];
        root.traverse((o) => {
          if (o.isMesh && o.geometry) {
            const n = o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3;
            all.push({ o, n });
          }
        });
        all.sort((a, b) => b.n - a.n);
        const meshes = all.slice(0, 3).map((x) => x.o);
        const raycaster = new THREE.Raycaster();
        let rayN = 0;
        const _world = new THREE.Vector3();
        const _ndc = new THREE.Vector3();
        const _local = new THREE.Vector3();

        function hitNdc(nx, ny) {
          rayN++;
          raycaster.setFromCamera(new THREE.Vector2(nx, ny), cam);
          return raycaster.intersectObjects(meshes, false)[0] || null;
        }

        function snap(seedArr, normArr) {
          const seed = new THREE.Vector3(seedArr[0], seedArr[1], seedArr[2]);
          root.localToWorld(_world.copy(seed));
          _ndc.copy(_world).project(cam);
          const cands = [];
          const primary = hitNdc(_ndc.x, _ndc.y);
          if (primary) cands.push(primary);
          // 稀疏邻域：4 向 × 2 环
          for (const r of [0.03, 0.08]) {
            for (let a = 0; a < 4; a++) {
              const ang = (a / 4) * Math.PI * 2;
              const h = hitNdc(_ndc.x + Math.cos(ang) * r, _ndc.y + Math.sin(ang) * r);
              if (h) cands.push(h);
            }
          }
          // 沿种子法线短穿
          const nSeed = new THREE.Vector3(normArr[0] || 0, normArr[1] || 1, normArr[2] || 0).normalize();
          const nW = root.localToWorld(seed.clone().add(nSeed)).sub(root.localToWorld(seed.clone())).normalize();
          for (const sign of [1, -1]) {
            rayN++;
            const origin = _world.clone().addScaledVector(nW, sign * 0.25);
            raycaster.set(origin, nW.clone().multiplyScalar(-sign));
            const h = raycaster.intersectObjects(meshes, false)[0];
            if (h) cands.push(h);
          }
          if (!cands.length) return null;
          let best = null;
          let bestScore = 1e9;
          for (const hit of cands) {
            _local.copy(hit.point);
            root.worldToLocal(_local);
            const dist = _local.distanceTo(seed);
            if (dist < bestScore) {
              bestScore = dist;
              let nWorld = new THREE.Vector3(-1, 0, 0);
              if (hit.face && hit.face.normal) {
                nWorld = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
              }
              const localNormal = root.worldToLocal(hit.point.clone().add(nWorld)).sub(_local.clone()).normalize();
              best = {
                localPos: [+_local.x.toFixed(4), +_local.y.toFixed(4), +_local.z.toFixed(4)],
                localNormal: [+localNormal.x.toFixed(3), +localNormal.y.toFixed(3), +localNormal.z.toFixed(3)],
                baseDist: +hit.distance.toFixed(4),
                distToSeed: +dist.toFixed(4)
              };
            }
          }
          return best;
        }

        const annotations = [];
        const dbg = [];
        for (const s of seeds) {
          const sn = snap(s.seed, s.norm);
          if (!sn) {
            dbg.push({ text: s.text, ok: false });
            // 失败则保留映射种子，至少有点
            const copy = Object.assign({}, s.raw, {
              localPos: s.seed.map((n) => +Number(n).toFixed(4)),
              baseScale: root.scale && root.scale.x ? +Number(root.scale.x).toFixed(4) : s.raw.baseScale
            });
            annotations.push(copy);
            continue;
          }
          annotations.push(
            Object.assign({}, s.raw, {
              localPos: sn.localPos,
              localNormal: sn.localNormal,
              baseDist: sn.baseDist,
              baseScale: root.scale && root.scale.x ? +Number(root.scale.x).toFixed(4) : s.raw.baseScale
            })
          );
          dbg.push({ text: s.text, ok: true, distToSeed: sn.distToSeed });
        }

        const dashedLines = [];
        for (const ds of dashSeeds) {
          const points = ds.points.map((p) => {
            const sn = snap(p.seed, p.norm);
            if (!sn) return Object.assign({}, p.raw, { pos: p.seed.map((n) => +Number(n).toFixed(4)) });
            return Object.assign({}, p.raw, { pos: sn.localPos, norm: sn.localNormal });
          });
          dashedLines.push(Object.assign({}, ds.line, { points }));
        }

        return {
          ok: annotations.length === seeds.length,
          annotations,
          dashedLines,
          dbg,
          rayN
        };
      },
      { seeds, dashSeeds }
    );

    fs.writeFileSync(path.join(outDir, `${slot}-remap.json`), JSON.stringify({ dbg: remapped.dbg, rayN: remapped.rayN }, null, 2));

    const femalePath = path.join(jsonDir, pair.female.f);
    const femaleData = JSON.parse(fs.readFileSync(femalePath, 'utf8'));
    femaleData.items[0].annotations = remapped.annotations;
    femaleData.items[0].dashedLines = remapped.dashedLines || [];
    // 机位灯光跟大本，便于对照手调
    if (pair.male.d.camera) femaleData.camera = JSON.parse(JSON.stringify(pair.male.d.camera));
    if (pair.male.d.light) femaleData.light = JSON.parse(JSON.stringify(pair.male.d.light));
    if (pair.male.d.env) {
      femaleData.env = Object.assign({}, femaleData.env || {}, {
        groundColor: pair.male.d.env.groundColor,
        skyColor: pair.male.d.env.skyColor,
        skyLightScale: pair.male.d.env.skyLightScale,
        lightIndicatorEnabled: false
      });
    }
    const maleMeta = pair.male.d.meta || {};
    femaleData.meta = femaleData.meta || {};
    femaleData.meta.detail = maleMeta.detail || femaleData.meta.detail;
    const tip =
      '\n\n本场景是同一课的对比个体（女05）。点位框架与参考模（大本）一致，请对照凹凸强弱与宽窄差异；本版为自动映射打底，可再手调。';
    const tipRich =
      '<br><br>本场景是同一课的对比个体（女05）。点位框架与参考模（大本）一致，请对照凹凸强弱与宽窄差异；本版为自动映射打底，可再手调。';
    const kp = String(maleMeta.keyPoints || '');
    const kpr = String(maleMeta.keyPointsRich || '');
    femaleData.meta.keyPoints = kp.includes('对比个体（女05）') ? kp : kp + tip;
    femaleData.meta.keyPointsRich = kpr.includes('对比个体（女05）') ? kpr : kpr + tipRich;
    femaleData.meta.status = 'mapped_vision_pending';
    femaleData.meta.modelId = 'female_05';
    femaleData.meta.modelRole = 'contrast';
    femaleData.meta.modelLabel = '女05';
    if (maleMeta.lessonTabLabel) femaleData.meta.lessonTabLabel = maleMeta.lessonTabLabel;
    if (maleMeta.line) femaleData.meta.line = maleMeta.line;
    if (maleMeta.slot) femaleData.meta.slot = maleMeta.slot;
    fs.writeFileSync(femalePath, JSON.stringify(femaleData));
    rebuildAggregate();

    let shot = null;
    if (!SKIP_SHOT) {
      // 同会话再切一次以加载新标注（同 GLB 通常有缓存）
      await openId(page, pair.female.d.id);
      await page.waitForTimeout(800);
      shot = path.join(outDir, `female05-${slot}.png`);
      await page.screenshot({ path: shot, fullPage: false });
      console.log('[batch] SHOT', shot);
    }

    const row = {
      slot,
      ok: !!remapped.ok,
      ann: remapped.annotations.length,
      dash: (remapped.dashedLines || []).length,
      rayN: remapped.rayN,
      ms: Date.now() - t0,
      shot,
      file: pair.female.f
    };
    summary.push(row);
    console.log('[batch] done', row);
  }

  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  await browser.close();
  console.log('\n[batch] ALL DONE', outDir);
  console.log(JSON.stringify(summary, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
