/**
 * 103c：等 GLB 入场后再拾取额鼻颏剪影
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-headform-103c`);
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:18080';
fs.mkdirSync(outDir, { recursive: true });

function load103() {
  const f = fs.readdirSync(jsonDir).find((n) => n.startsWith('103_') && n.endsWith('.json'));
  const full = path.join(jsonDir, f);
  return { f, full, data: JSON.parse(fs.readFileSync(full, 'utf8')) };
}
function rebuildAggregate() {
  const files = fs
    .readdirSync(jsonDir)
    .filter((fn) => /^\d+_.+\.json$/i.test(fn))
    .sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));
  const merged = files.map((fn) => JSON.parse(fs.readFileSync(path.join(jsonDir, fn), 'utf8')));
  fs.writeFileSync(path.join(jsonDir, '沙盒_头部造型规律.json'), JSON.stringify(merged) + '\n');
  return merged.length;
}

async function boot(page) {
  await page.goto(`${baseUrl}/Solid.html?sandbox=headform&skipPerf=1&_=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 90000
  });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    window.useAdvancedRender = false;
    window.perfTestDone = true;
    window.isTestingPerformance = false;
    if ((!window.customScenes || !window.customScenes.length) && window.loadJSONData) window.loadJSONData();
  });
  await page.waitForFunction(
    () => (window.customScenes || []).length > 0 && window.__solidHost && window.__solidHost.getCamera(),
    null,
    { timeout: 90000 }
  );
}

async function openV03(page) {
  await page.evaluate(() => {
    const m = document.getElementById('scene-grid-modal');
    if (m) m.style.display = 'none';
    const i = window.customScenes.findIndex((s) => s && s.id === 'V03');
    window.currentSceneIndex = -1;
    window.switchScene(i);
  });
  let meshes = 0;
  for (let i = 0; i < 80; i++) {
    meshes = await page.evaluate(() => {
      let n = 0;
      try {
        window.__solidHost.getSceneGroup().traverse((o) => {
          if (o.isMesh) n++;
        });
      } catch (_e) {}
      return n;
    });
    if (i < 3 || i % 10 === 0 || meshes > 0) console.log('wait', i, meshes);
    if (meshes > 0) break;
    await page.waitForTimeout(400);
  }
  if (!meshes) throw new Error('GLB not loaded');
  await page.evaluate(() => {
    const el = document.getElementById('scene-loader');
    if (el) el.style.display = 'none';
    const m = document.getElementById('scene-grid-modal');
    if (m) m.style.display = 'none';
  });
  await page.waitForTimeout(1500);
}

async function pick(page) {
  return page.evaluate(() => {
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
    const _lp = new THREE.Vector3();

    function hitAt(u, v) {
      raycaster.setFromCamera(new THREE.Vector2(u * 2 - 1, -(v * 2 - 1)), cam);
      return raycaster.intersectObjects(meshes, true)[0] || null;
    }
    function leftEdge(v, zMin) {
      let best = null;
      for (let u = 0.18; u <= 0.58; u += 0.004) {
        const hit = hitAt(u, v);
        if (!hit) continue;
        _lp.copy(hit.point);
        root.worldToLocal(_lp);
        if (_lp.z < zMin) continue;
        if (!best || u < best.u || (Math.abs(u - best.u) < 0.006 && _lp.z > best.z)) {
          best = { u, v, hit, x: _lp.x, y: _lp.y, z: _lp.z };
        }
      }
      return best;
    }
    function band(v0, v1, mode, zMin) {
      let best = null;
      for (let v = v0; v <= v1; v += 0.01) {
        const s = leftEdge(v, zMin);
        if (!s) continue;
        const rec = { ...s, v: +v.toFixed(3) };
        if (!best) best = rec;
        else if (mode === 'mostLeft' && rec.u < best.u) best = rec;
        else if (mode === 'mostPosZ' && rec.z > best.z) best = rec;
        else if (mode === 'highestY' && rec.y > best.y) best = rec;
        else if (mode === 'chin' && rec.y < best.y && rec.z > 0.03 && rec.y > 0.04) best = rec;
      }
      return best;
    }

    const p1 = band(0.14, 0.24, 'highestY', -0.02);
    const p2 = band(0.26, 0.34, 'mostLeft', 0.02);
    const pA = band(0.3, 0.38, 'mostLeft', 0.03);
    const p3 = band(0.38, 0.48, 'mostPosZ', 0.05);
    const pB = band(0.48, 0.56, 'mostLeft', 0.04);
    const p4 = band(0.52, 0.62, 'mostPosZ', 0.04);
    const p5 = band(0.62, 0.74, 'chin', 0.03);
    const samples = { p1, p2, p3, p4, p5, pA, pB };

    function localNormal(hit) {
      const n = hit.face.normal.clone();
      const nm = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
      n.applyMatrix3(nm).normalize();
      const q = new THREE.Quaternion();
      root.getWorldQuaternion(q);
      n.applyQuaternion(q.clone().invert()).normalize();
      return n;
    }
    function mk(id, text, color, sample, dx, dy) {
      if (!sample || !sample.hit) return null;
      _lp.copy(sample.hit.point);
      root.worldToLocal(_lp);
      const nLocal = localNormal(sample.hit);
      return {
        id,
        annotationKind: 'leader',
        text,
        detailText: '',
        collapsed: false,
        color,
        dx,
        dy,
        dxN: dx * 0.0007,
        dyN: dy * 0.0007,
        dxW: dx * 0.0025,
        dyW: dy * 0.0025,
        localPos: [+_lp.x.toFixed(4), +_lp.y.toFixed(4), +_lp.z.toFixed(4)],
        localNormal: [+nLocal.x.toFixed(3), +nLocal.y.toFixed(3), +nLocal.z.toFixed(3)],
        baseDist: +cam.position.distanceTo(sample.hit.point).toFixed(4),
        baseScale: 5.8,
        labelShape: 'circle',
        occludeDot: -0.35,
        _dbg: { u: +sample.u.toFixed(3), v: sample.v, y: +sample.y.toFixed(4), z: +sample.z.toFixed(4) }
      };
    }

    const annos = [
      mk('anno_v03_1', '1', '#00e8e8', p1, -86, -26),
      mk('anno_v03_2', '2', '#00e8e8', p2, -90, -10),
      mk('anno_v03_3', '3', '#00e8e8', p3, -100, -4),
      mk('anno_v03_4', '4', '#00e8e8', p4, -92, -6),
      mk('anno_v03_5', '5', '#00e8e8', p5, -88, 12),
      mk('anno_v03_A', 'A', '#e3e3e3', pA, -46, -8),
      mk('anno_v03_B', 'B', '#e8e8e8', pB, -48, -6)
    ].filter(Boolean);

    return {
      meshCount: meshes.length,
      ok: annos.length,
      dbg: annos.map((a) => ({ t: a.text.trim(), ...a._dbg })),
      miss: Object.entries(samples)
        .filter(([, s]) => !s)
        .map(([k]) => k),
      annos
    };
  });
}

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(120000);

  console.log('boot1');
  await boot(page);
  await openV03(page);

  console.log('pick…');
  const picked = await pick(page);
  console.log('picked', picked.ok, 'meshes', picked.meshCount, 'miss', picked.miss);
  console.log(JSON.stringify(picked.dbg, null, 2));
  fs.writeFileSync(path.join(outDir, 'pick.json'), JSON.stringify(picked, null, 2));
  if (picked.ok < 5) throw new Error('pick too few: ' + picked.ok);

  const file = load103();
  file.data.items[0].annotations = picked.annos.map(({ _dbg, ...rest }) => rest);
  fs.writeFileSync(file.full, JSON.stringify(file.data) + '\n');
  console.log('merged', rebuildAggregate());

  // 写盘后再截图（避免首帧截图卡死）
  console.log('shot frame…');
  try {
    await page.screenshot({ path: path.join(outDir, 'V03-frame.png'), timeout: 20000 });
  } catch (e) {
    console.warn('frame shot fail', e.message);
  }

  console.log('boot2');
  await boot(page);
  await openV03(page);
  await page.evaluate(() => {
    window.showAnnotations = true;
  });
  await page.waitForTimeout(2000);
  console.log('shot annotated…');
  await page.screenshot({ path: path.join(outDir, 'V03-annotated.png'), timeout: 45000 });
  console.log('OUT', outDir);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
