/**
 * 将大本 headform 标注迁到同 slot 女05：localPos 经屏幕投影 + 射线落到女模表面。
 * 用法：SLOT=V02 node scripts/headform-remap-female05.js
 * 环境：BASE_URL 默认 http://127.0.0.1:18080 ；需先 serve 仓库根。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const SLOT = String(process.env.SLOT || 'V02').trim();
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-female05-${SLOT}`);
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:18080';
fs.mkdirSync(outDir, { recursive: true });

const RE = /^(\d+[A-Za-z]?)_(.+)\.json$/i;

function listScenes() {
  return fs.readdirSync(jsonDir).filter((n) => RE.test(n));
}

function loadBySlot(slot, preferFemale) {
  const files = listScenes();
  const hits = [];
  for (const f of files) {
    const d = JSON.parse(fs.readFileSync(path.join(jsonDir, f), 'utf8'));
    if ((d.meta && d.meta.slot) !== slot) continue;
    const isF = (d.meta && d.meta.modelId) === 'female_05' || f.includes('女05');
    hits.push({ f, d, isF });
  }
  const male = hits.find((h) => !h.isF);
  const female = hits.find((h) => h.isF);
  if (preferFemale) return female;
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
  const arr = all.map((n) => JSON.parse(fs.readFileSync(path.join(jsonDir, n), 'utf8')));
  fs.writeFileSync(path.join(jsonDir, '沙盒_头部造型规律.json'), JSON.stringify(arr));
  return arr.length;
}

async function waitReady(page) {
  await page
    .waitForFunction(() => {
      const el = document.getElementById('scene-loader');
      if (!el) return true;
      const st = getComputedStyle(el);
      return st.display === 'none' || Number(st.opacity || 1) < 0.05;
    }, null, { timeout: 180000 })
    .catch(() => {});
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    const el = document.getElementById('scene-loader');
    if (el) el.style.display = 'none';
    const m = document.getElementById('scene-grid-modal');
    if (m) m.style.display = 'none';
    try {
      if (typeof window.stopRender === 'function') window.stopRender();
    } catch (_e) {}
  });
}

(async () => {
  const pair = loadBySlot(SLOT);
  if (!pair.male || !pair.female) {
    throw new Error(`slot ${SLOT} missing male/female: ${JSON.stringify({ male: !!pair.male, female: !!pair.female })}`);
  }
  const maleAnnos = (pair.male.d.items && pair.male.d.items[0] && pair.male.d.items[0].annotations) || [];
  const maleDashed = (pair.male.d.items && pair.male.d.items[0] && pair.male.d.items[0].dashedLines) || [];
  if (!maleAnnos.length) throw new Error(`male ${SLOT} has no annotations`);

  const femaleId = pair.female.d.id;
  console.log('SLOT', SLOT, 'male', pair.male.f, 'female', pair.female.f, 'ann', maleAnnos.length, 'dash', maleDashed.length);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(120000);
  await page.goto(`${baseUrl}/Solid?sandbox=headform&skipPerf=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#scene-grid-modal', { state: 'visible', timeout: 120000 });
  await page.waitForTimeout(800);

  const idx = await page.evaluate((id) => {
    return (window.customScenes || []).findIndex((s) => s && String(s.id) === id);
  }, femaleId);
  if (idx < 0) throw new Error('female scene not in aggregate: ' + femaleId);
  await page.evaluate((i) => {
    window.currentSceneIndex = -1;
    window.switchScene(i);
  }, idx);
  await waitReady(page);

  const remapped = await page.evaluate(
    ({ annos, dashed }) => {
      const host = window.__solidHost;
      if (!host || typeof host.getTHREE !== 'function') return { error: 'no __solidHost' };
      const THREE = host.getTHREE();
      const cam = host.getCamera();
      const g = host.getSceneGroup();
      let root = null;
      g.traverse((o) => {
        if (!root && o.userData && o.userData.type === 'glb') root = o;
      });
      if (!root) root = g.children.find((c) => c) || g;
      const meshes = [];
      root.traverse((o) => {
        if (o.isMesh && o.geometry) meshes.push(o);
      });
      if (!meshes.length) return { error: 'no meshes' };

      const raycaster = new THREE.Raycaster();
      raycaster.params.Line = { threshold: 0.01 };
      const _ndc = new THREE.Vector3();
      const _world = new THREE.Vector3();
      const _local = new THREE.Vector3();
      const _nWorld = new THREE.Vector3();
      const _tmp = new THREE.Vector3();

      function hitFromNdc(nx, ny) {
        raycaster.setFromCamera(new THREE.Vector2(nx, ny), cam);
        const hits = raycaster.intersectObjects(meshes, true);
        return hits[0] || null;
      }

      function snapLocal(seedLocalArr, seedNormArr) {
        const seedLocal = new THREE.Vector3(seedLocalArr[0], seedLocalArr[1], seedLocalArr[2]);
        root.localToWorld(_world.copy(seedLocal));
        _ndc.copy(_world).project(cam);
        let best = null;
        let bestScore = 1e9;
        // 主射线：投影点
        const primary = hitFromNdc(_ndc.x, _ndc.y);
        const candidates = [];
        if (primary) candidates.push(primary);
        // 邻域搜索
        for (let r = 0.02; r <= 0.18; r += 0.02) {
          for (let a = 0; a < 12; a++) {
            const ang = (a / 12) * Math.PI * 2;
            const hit = hitFromNdc(_ndc.x + Math.cos(ang) * r, _ndc.y + Math.sin(ang) * r);
            if (hit) candidates.push(hit);
          }
        }
        // 沿法线穿模
        const nSeed = new THREE.Vector3(
          (seedNormArr && seedNormArr[0]) || 0,
          (seedNormArr && seedNormArr[1]) || 1,
          (seedNormArr && seedNormArr[2]) || 0
        ).normalize();
        root.localToWorld(_nWorld.copy(seedLocal).add(nSeed));
        _nWorld.sub(_world.copy(seedLocal));
        // rebuild world seed
        root.localToWorld(_world.copy(seedLocal));
        const dir = _nWorld.lengthSq() > 1e-8 ? _nWorld.normalize() : new THREE.Vector3(0, 0, 1);
        for (const sign of [1, -1]) {
          const origin = _world.clone().addScaledVector(dir, sign * 0.35);
          raycaster.set(origin, dir.clone().multiplyScalar(-sign));
          const hits = raycaster.intersectObjects(meshes, true);
          if (hits[0]) candidates.push(hits[0]);
        }

        for (const hit of candidates) {
          _local.copy(hit.point);
          root.worldToLocal(_local);
          const dist = _local.distanceTo(seedLocal);
          // 偏好更近 + 略偏好朝外（与相机同侧）
          const toCam = cam.position.clone().sub(hit.point).normalize();
          let nWorld = new THREE.Vector3(0, 1, 0);
          if (hit.face && hit.face.normal) {
            nWorld = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
          }
          const facing = Math.max(0, nWorld.dot(toCam));
          const score = dist - facing * 0.02;
          if (score < bestScore) {
            bestScore = score;
            best = { hit, local: _local.clone(), nWorld, dist };
          }
        }
        if (!best) return null;
        const localNormal = root
          .worldToLocal(best.hit.point.clone().add(best.nWorld))
          .sub(best.local.clone())
          .normalize();
        return {
          localPos: [+best.local.x.toFixed(4), +best.local.y.toFixed(4), +best.local.z.toFixed(4)],
          localNormal: [+localNormal.x.toFixed(3), +localNormal.y.toFixed(3), +localNormal.z.toFixed(3)],
          baseDist: +best.hit.distance.toFixed(4),
          distToSeed: +best.dist.toFixed(4)
        };
      }

      const outAnnos = [];
      const dbg = [];
      for (const a of annos) {
        const snapped = snapLocal(a.localPos || [0, 0, 0], a.localNormal || [0, 1, 0]);
        if (!snapped) {
          dbg.push({ id: a.id, text: a.text, ok: false });
          continue;
        }
        const copy = Object.assign({}, a, {
          localPos: snapped.localPos,
          localNormal: snapped.localNormal,
          baseDist: snapped.baseDist,
          baseScale: root.scale && root.scale.x ? +Number(root.scale.x).toFixed(4) : a.baseScale
        });
        outAnnos.push(copy);
        dbg.push({ id: a.id, text: a.text, ok: true, distToSeed: snapped.distToSeed, localPos: snapped.localPos });
      }

      const outDash = [];
      for (const line of dashed || []) {
        const pts = (line.points || []).map((p) => {
          const snapped = snapLocal(p.pos || [0, 0, 0], p.norm || [0, 1, 0]);
          if (!snapped) return p;
          const np = Object.assign({}, p, {
            pos: snapped.localPos,
            norm: snapped.localNormal
          });
          // 手柄保留相对偏移量级（模型同尺度）
          return np;
        });
        outDash.push(Object.assign({}, line, { points: pts }));
      }

      return {
        ok: outAnnos.length === annos.length,
        annotations: outAnnos,
        dashedLines: outDash,
        dbg,
        meshCount: meshes.length
      };
    },
    { annos: maleAnnos, dashed: maleDashed }
  );

  fs.writeFileSync(path.join(outDir, 'remap-debug.json'), JSON.stringify(remapped, null, 2));
  if (remapped.error || !remapped.ok) {
    console.error('REMAP_FAIL', remapped.error || remapped.dbg);
    await browser.close();
    process.exit(1);
  }

  // 写回女05 JSON：保留机位灯光；标注与虚线替换；文案对齐大本并注明对比个体
  const femalePath = path.join(jsonDir, pair.female.f);
  const femaleData = JSON.parse(fs.readFileSync(femalePath, 'utf8'));
  if (!femaleData.items || !femaleData.items[0]) throw new Error('female items missing');
  femaleData.items[0].annotations = remapped.annotations;
  femaleData.items[0].dashedLines = remapped.dashedLines;
  if (!femaleData.meta) femaleData.meta = {};
  const maleMeta = pair.male.d.meta || {};
  femaleData.meta.detail = maleMeta.detail || femaleData.meta.detail;
  // 童画师解析：大本正文 + 对比提示
  const kp = String(maleMeta.keyPoints || '');
  const kpr = String(maleMeta.keyPointsRich || '');
  const tip =
    '\n\n本场景是同一课的对比个体（女05）。点位框架与参考模（大本）一致，请对照凹凸强弱与宽窄差异。';
  const tipRich =
    '<br><br>本场景是同一课的对比个体（女05）。点位框架与参考模（大本）一致，请对照凹凸强弱与宽窄差异。';
  femaleData.meta.keyPoints = kp ? kp + tip : tip.trim();
  femaleData.meta.keyPointsRich = kpr ? kpr + tipRich : tipRich.replace(/^<br><br>/, '');
  femaleData.meta.status = 'mapped_pending_vision';
  femaleData.meta.modelId = 'female_05';
  femaleData.meta.modelRole = 'contrast';
  femaleData.meta.modelLabel = '女05';
  if (maleMeta.lessonTabLabel) femaleData.meta.lessonTabLabel = maleMeta.lessonTabLabel;
  if (maleMeta.line) femaleData.meta.line = maleMeta.line;
  if (maleMeta.slot) femaleData.meta.slot = maleMeta.slot;

  fs.writeFileSync(femalePath, JSON.stringify(femaleData));
  const nAgg = rebuildAggregate();
  console.log('wrote', pair.female.f, 'ann', remapped.annotations.length, 'dash', remapped.dashedLines.length, 'agg', nAgg);

  // 重新加载页面截图做视觉验收
  await page.goto(`${baseUrl}/Solid?sandbox=headform&skipPerf=1`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#scene-grid-modal', { state: 'visible', timeout: 120000 });
  await page.waitForTimeout(600);
  const idx2 = await page.evaluate((id) => {
    return (window.customScenes || []).findIndex((s) => s && String(s.id) === id);
  }, femaleId);
  await page.evaluate((i) => {
    window.currentSceneIndex = -1;
    window.switchScene(i);
  }, idx2);
  await waitReady(page);
  await page.waitForTimeout(1500);
  const shot = path.join(outDir, `female05-${SLOT}.png`);
  await page.screenshot({ path: shot, fullPage: false });
  console.log('SHOT', shot);
  console.log('DBG', JSON.stringify(remapped.dbg, null, 2));
  await browser.close();
  console.log('DONE');
})().catch((e) => {
  console.error('FAIL', e);
  process.exit(1);
});
