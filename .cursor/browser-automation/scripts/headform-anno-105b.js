/**
 * 105b：侧后外轮廓重钉——避开脸侧剪影，优先后脑/耳后/颈（localZ 偏负）
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-headform-105b`);
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:18080';
fs.mkdirSync(outDir, { recursive: true });

function load105() {
  const f = fs.readdirSync(jsonDir).find((n) => n.startsWith('105_') && n.endsWith('.json'));
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
  await page.waitForTimeout(1200);
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

async function openV05(page) {
  await page.evaluate(() => {
    const m = document.getElementById('scene-grid-modal');
    if (m) m.style.display = 'none';
    const i = window.customScenes.findIndex((s) => s && s.id === 'V05');
    window.currentSceneIndex = -1;
    window.switchScene(i);
  });
  for (let i = 0; i < 80; i++) {
    const n = await page.evaluate(() => {
      let c = 0;
      try {
        window.__solidHost.getSceneGroup().traverse((o) => {
          if (o.isMesh) c++;
        });
      } catch (_e) {}
      return c;
    });
    if (n > 0) {
      console.log('glb', n, 'at', i);
      break;
    }
    await page.waitForTimeout(400);
  }
  await page.evaluate(() => {
    const el = document.getElementById('scene-loader');
    if (el) el.style.display = 'none';
    const m = document.getElementById('scene-grid-modal');
    if (m) m.style.display = 'none';
  });
  await page.waitForTimeout(1200);
}

async function main() {
  // 相机再靠后一点，让后脑外缘更主导左缘
  const file0 = load105();
  const r = 6.45;
  const deg = 148;
  const rad = (deg * Math.PI) / 180;
  file0.data.camera = {
    pos: [+(r * Math.sin(rad)).toFixed(3), 0.88, +(r * Math.cos(rad)).toFixed(3)],
    target: [0.0, 0.84, -0.04],
    zoom: 0.56,
    fov: 15
  };
  // 光从侧后偏上，照亮后脑与耳后
  file0.data.light = {
    type: 'point',
    azimuth: 220,
    elevation: 30,
    distance: 16,
    temp: 34,
    size: 24,
    intensity: 2.0
  };
  fs.writeFileSync(file0.full, JSON.stringify(file0.data) + '\n');
  rebuildAggregate();
  console.log('cam', file0.data.camera, 'light', file0.data.light);

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(120000);

  await boot(page);
  await openV05(page);

  const picked = await page.evaluate(() => {
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

    /** 左缘且偏后：z 不宜过大（避开鼻唇） */
    function sampleRearLeft(v, zMax) {
      let best = null;
      for (let u = 0.2; u <= 0.58; u += 0.004) {
        const hit = hitAt(u, v);
        if (!hit) continue;
        _lp.copy(hit.point);
        root.worldToLocal(_lp);
        if (_lp.z > zMax) continue;
        if (!best || u < best.u || (Math.abs(u - best.u) < 0.006 && _lp.z < best.z)) {
          best = { u, v, hit, x: _lp.x, y: _lp.y, z: _lp.z };
        }
      }
      return best;
    }
    function collect(v0, v1, zMax) {
      const arr = [];
      for (let v = v0; v <= v1; v += 0.01) {
        const s = sampleRearLeft(v, zMax);
        if (s) arr.push({ ...s, v: +v.toFixed(3) });
      }
      return arr;
    }
    function pickMax(arr, key) {
      if (!arr.length) return null;
      return arr.reduce((a, b) => (b[key] > a[key] ? b : a));
    }
    function pickMin(arr, key) {
      if (!arr.length) return null;
      return arr.reduce((a, b) => (b[key] < a[key] ? b : a));
    }
    function pickRecess(arr) {
      if (arr.length < 3) return arr[Math.floor(arr.length / 2)] || null;
      let best = null;
      let bestScore = -1e9;
      for (let i = 1; i < arr.length - 1; i++) {
        const prev = arr[i - 1];
        const cur = arr[i];
        const next = arr[i + 1];
        const score = cur.u - (prev.u + next.u) * 0.5;
        if (score > bestScore) {
          bestScore = score;
          best = cur;
        }
      }
      return best;
    }

    // zMax 逐步放宽：顶枕严，耳颈略宽
    const p1 = pickMax(collect(0.12, 0.22, 0.02), 'y'); // 颅顶
    const p2 = pickMin(collect(0.22, 0.34, 0.0), 'z') || pickMin(collect(0.22, 0.34, 0.02), 'u'); // 枕后最靠后
    const pA = pickRecess(collect(0.16, 0.28, 0.02));
    const p3 = pickMin(collect(0.34, 0.46, 0.04), 'u'); // 耳壳外/上（侧后可见）
    const pB = pickRecess(collect(0.32, 0.44, 0.03));
    const p4 = pickMin(collect(0.48, 0.58, 0.02), 'u'); // 下颌后角
    const pC = pickRecess(collect(0.52, 0.66, 0.02));
    const p5 = pickMin(collect(0.6, 0.76, 0.04), 'u'); // 颈侧/胸锁

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
        _dbg: { u: +sample.u.toFixed(3), v: sample.v, y: +_lp.y.toFixed(4), z: +_lp.z.toFixed(4) }
      };
    }

    const annos = [
      mk('anno_v05_1', '1', '#00e8e8', p1, -88, -20),
      mk('anno_v05_2', '2', '#00e8e8', p2, -96, -4),
      mk('anno_v05_3', '3', '#00e8e8', p3, -100, 6),
      mk('anno_v05_4', '4', '#00e8e8', p4, -92, 18),
      mk('anno_v05_5', '5', '#00e8e8', p5, -88, 34),
      mk('anno_v05_A', 'A', '#d6d6d6', pA, -46, -10),
      mk('anno_v05_B', 'B', '#e3e3e3', pB, -48, 8),
      mk('anno_v05_C', 'C', '#e8e8e8', pC, -50, 24)
    ].filter(Boolean);

    return { ok: annos.length, dbg: annos.map((a) => ({ t: a.text.trim(), ...a._dbg })), annos };
  });

  console.log('picked', picked.ok);
  console.log(JSON.stringify(picked.dbg, null, 2));
  fs.writeFileSync(path.join(outDir, 'pick.json'), JSON.stringify(picked, null, 2));
  if (picked.ok < 6) throw new Error('too few');

  const file = load105();
  file.data.items[0].annotations = picked.annos.map(({ _dbg, ...rest }) => rest);
  file.data.meta.status = 'wip';
  fs.writeFileSync(file.full, JSON.stringify(file.data) + '\n');
  console.log('merged', rebuildAggregate());

  await boot(page);
  await openV05(page);
  await page.evaluate(() => {
    window.showAnnotations = true;
  });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(outDir, 'V05-annotated.png'), timeout: 45000 });
  console.log('OUT', outDir);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
