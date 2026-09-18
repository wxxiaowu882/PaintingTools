/**
 * 104b：全侧面语义重钉（修正 104 初稿：1 勿落颅顶；3=鼻头、4=上唇 等）
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-headform-104b`);
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:18080';
fs.mkdirSync(outDir, { recursive: true });

function load104() {
  const f = fs.readdirSync(jsonDir).find((n) => n.startsWith('104_') && n.endsWith('.json'));
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

async function openV04(page) {
  await page.evaluate(() => {
    const m = document.getElementById('scene-grid-modal');
    if (m) m.style.display = 'none';
    const i = window.customScenes.findIndex((s) => s && s.id === 'V04');
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
    function sampleLeft(v, zMin) {
      let best = null;
      for (let u = 0.2; u <= 0.55; u += 0.003) {
        const hit = hitAt(u, v);
        if (!hit) continue;
        _lp.copy(hit.point);
        root.worldToLocal(_lp);
        if (_lp.z < zMin) continue;
        if (!best || u < best.u || (Math.abs(u - best.u) < 0.005 && _lp.z > best.z)) {
          best = { u, v, hit, x: _lp.x, y: _lp.y, z: _lp.z };
        }
      }
      return best;
    }
    function collect(v0, v1, zMin) {
      const arr = [];
      for (let v = v0; v <= v1; v += 0.006) {
        const s = sampleLeft(v, zMin);
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

    // 脸前缘：强制 z 足够靠前，避开颅顶
    const FACE_Z = 0.045;
    // 1 额结节：额前凸，勿取头顶
    const forehead = collect(0.2, 0.28, FACE_Z).filter((s) => s.y < 0.28 && s.y > 0.18);
    const p1 = pickMax(forehead, 'z') || pickMin(forehead, 'u');
    // 2 眉弓
    const p2 = pickMin(collect(0.28, 0.34, FACE_Z), 'u');
    // A 鼻根凹
    const pA = pickRecess(collect(0.32, 0.4, FACE_Z));
    // B 眼裂高度（眉下鼻上）
    const pB = pickMin(collect(0.36, 0.42, FACE_Z), 'u');
    // 3 鼻头：鼻带最前
    const p3 = pickMax(collect(0.42, 0.5, 0.06), 'z');
    // C 鼻唇角
    const pC = pickRecess(collect(0.5, 0.55, 0.05));
    // 4 上唇白脊：唇上带最前（须低于鼻头）
    const upperLip = collect(0.53, 0.58, 0.05).filter((s) => !p3 || s.y < p3.y - 0.008);
    const p4 = pickMax(upperLip, 'z');
    // D 唇缝
    const pD = pickRecess(collect(0.56, 0.61, 0.045));
    // 5 下唇白脊
    const lowerLip = collect(0.59, 0.64, 0.045);
    const p5 = pickMax(lowerLip, 'z');
    // E 颏唇沟
    const pE = pickRecess(collect(0.63, 0.69, 0.04));
    // 6 颏肌
    const chin = collect(0.68, 0.76, 0.035).filter((s) => s.y > 0.05);
    const p6 = pickMax(chin, 'z');

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
      mk('anno_v04_1', '1', '#00e8e8', p1, -100, -20),
      mk('anno_v04_2', '2', '#00e8e8', p2, -95, -10),
      mk('anno_v04_3', '3', '#00e8e8', p3, -110, -2),
      mk('anno_v04_4', '4', '#00e8e8', p4, -100, 2),
      mk('anno_v04_5', '5', '#00e8e8', p5, -100, 20),
      mk('anno_v04_6', '6', '#00e8e8', p6, -105, 38),
      mk('anno_v04_A', 'A', '#d6d6d6', pA, -52, -14),
      mk('anno_v04_B', 'B', '#e3e3e3', pB, -55, 6),
      mk('anno_v04_C', 'C', '#e8e8e8', pC, -50, 4),
      mk('anno_v04_D', 'D', '#cccccc', pD, -55, 12),
      mk('anno_v04_E', 'E', '#cfcfcf', pE, -58, 26)
    ].filter(Boolean);

    return {
      ok: annos.length,
      dbg: annos.map((a) => ({ t: a.text.trim(), ...a._dbg })),
      annos
    };
  });
}

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(120000);

  await boot(page);
  await openV04(page);
  const picked = await pick(page);
  console.log('picked', picked.ok);
  console.log(JSON.stringify(picked.dbg, null, 2));
  fs.writeFileSync(path.join(outDir, 'pick.json'), JSON.stringify(picked, null, 2));
  if (picked.ok < 8) throw new Error('too few');

  const file = load104();
  file.data.items[0].annotations = picked.annos.map(({ _dbg, ...rest }) => rest);
  fs.writeFileSync(file.full, JSON.stringify(file.data) + '\n');
  console.log('merged', rebuildAggregate());

  await boot(page);
  await openV04(page);
  await page.evaluate(() => {
    window.showAnnotations = true;
  });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(outDir, 'V04-annotated.png'), timeout: 45000 });
  console.log('OUT', outDir);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
