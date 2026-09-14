/** 206 纠偏：拉开 ②颅侧 / ③枕后，加强正顶光可读 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-headform-206-fix`);
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:18080';
fs.mkdirSync(outDir, { recursive: true });

function load206() {
  const f = fs.readdirSync(jsonDir).find((n) => n.startsWith('206_') && n.endsWith('.json'));
  const full = path.join(jsonDir, f);
  return { f, full, data: JSON.parse(fs.readFileSync(full, 'utf8')) };
}
function rebuild() {
  const files = fs
    .readdirSync(jsonDir)
    .filter((fn) => /^\d+[A-Za-z]?_.+\.json$/i.test(fn))
    .sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));
  fs.writeFileSync(
    path.join(jsonDir, '沙盒_头部造型规律.json'),
    JSON.stringify(files.map((fn) => JSON.parse(fs.readFileSync(path.join(jsonDir, fn), 'utf8')))) + '\n'
  );
}
function bezSeg(id, a, b) {
  return {
    id,
    color: '#9a9a9a',
    kind: 'bezier',
    strokeWidth: 2.2,
    capR: 1,
    opacity: 0.78,
    points: [
      {
        pos: [...a.localPos],
        norm: [...a.localNormal],
        handleOut: [
          (b.localPos[0] - a.localPos[0]) * 0.22,
          (b.localPos[1] - a.localPos[1]) * 0.2,
          (b.localPos[2] - a.localPos[2]) * 0.22
        ]
      },
      {
        pos: [...b.localPos],
        norm: [...b.localNormal],
        handleIn: [
          (a.localPos[0] - b.localPos[0]) * 0.22,
          (a.localPos[1] - b.localPos[1]) * 0.2,
          (a.localPos[2] - b.localPos[2]) * 0.22
        ]
      }
    ]
  };
}

async function main() {
  const file = load206();
  Object.assign(file.data.light, { azimuth: 90, elevation: 88, size: 10, intensity: 2.2, distance: 15 });
  file.data.camera = { pos: [-4.55, 1.12, 3.35], target: [0.0, 0.98, -0.04], zoom: 0.56, fov: 15 };
  file.data.env = Object.assign({}, file.data.env, { skyLightScale: 0.35, lightIndicatorEnabled: false });
  fs.writeFileSync(file.full, JSON.stringify(file.data) + '\n');
  rebuild();

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${baseUrl}/Solid.html?sandbox=headform&skipPerf=1&_=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 90000
  });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    window.useAdvancedRender = false;
    window.perfTestDone = true;
    try {
      if (typeof window.stopRender === 'function') window.stopRender();
    } catch (e) {}
    if (window.loadJSONData) window.loadJSONData();
  });
  await page.waitForFunction(
    () => (window.customScenes || []).length > 0 && window.__solidHost && window.__solidHost.getCamera(),
    null,
    { timeout: 90000 }
  );
  await page.evaluate(() => {
    const m = document.getElementById('scene-grid-modal');
    if (m) m.style.display = 'none';
    const i = window.customScenes.findIndex((s) => s && s.id === 'L06');
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
      } catch (e) {}
      return c;
    });
    if (n > 0) break;
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(1800);
  await page.evaluate(() => {
    const el = document.getElementById('scene-loader');
    if (el) el.style.display = 'none';
  });

  const picked = await page.evaluate(() => {
    const host = window.__solidHost;
    const THREE = host.getTHREE();
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
    const samples = [];
    const v = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (const mesh of meshes) {
      const geo = mesh.geometry;
      if (!geo.attributes || !geo.attributes.position) continue;
      const pos = geo.attributes.position;
      const nor = geo.attributes.normal;
      const idx = geo.index;
      const count = idx ? idx.count : pos.count;
      const step = Math.max(1, Math.floor(count / 14000));
      for (let i = 0; i < count; i += step) {
        const vi = idx ? idx.getX(i) : i;
        v.fromBufferAttribute(pos, vi);
        mesh.localToWorld(v);
        root.worldToLocal(v);
        if (nor) {
          n.fromBufferAttribute(nor, vi);
          n.transformDirection(mesh.matrixWorld);
          const q = new THREE.Quaternion();
          root.getWorldQuaternion(q);
          n.applyQuaternion(q.clone().invert());
        } else {
          n.set(-1, 0.3, 0);
        }
        if (v.y < 0.12 || v.y > 0.34) continue;
        if (v.x > 0.01) continue;
        samples.push({ x: v.x, y: v.y, z: v.z, nx: n.x, ny: n.y, nz: n.z });
      }
    }
    function best(fn) {
      let b = null;
      let bs = -1e9;
      for (const s of samples) {
        const sc = fn(s);
        if (sc > bs) {
          bs = sc;
          b = s;
        }
      }
      return b;
    }
    const p1 = best(
      (s) => s.z * 4.0 + s.y * 1.8 - Math.abs(s.x + 0.025) * 1.2 + (s.z > 0.04 ? 2 : 0) + (s.y > 0.24 ? 1 : 0)
    );
    const p2 = best(
      (s) => -s.x * 5.0 + s.y * 0.6 - Math.abs(s.z + 0.035) * 0.8 + (s.y > 0.2 && s.y < 0.28 ? 1 : 0)
    );
    const p3 = best(
      (s) =>
        -s.z * 6.5 +
        (0.24 - s.y) * 2.5 -
        Math.abs(s.x + 0.04) * 0.8 +
        (s.z < -0.08 ? 3 : 0) +
        (s.y < 0.22 ? 1.5 : 0)
    );
    function pack(id, name, s, dx, dy) {
      const len = Math.hypot(s.nx, s.ny, s.nz) || 1;
      return {
        id,
        name,
        dx,
        dy,
        localPos: [+s.x.toFixed(4), +s.y.toFixed(4), +s.z.toFixed(4)],
        localNormal: [+(s.nx / len).toFixed(3), +(s.ny / len).toFixed(3), +(s.nz / len).toFixed(3)]
      };
    }
    return {
      sampleCount: samples.length,
      annos: [
        pack('1', '额结节', p1, 72, -22),
        pack('2', '颅侧结节', p2, 90, 2),
        pack('3', '枕后突隆', p3, 70, 28)
      ]
    };
  });

  console.log(JSON.stringify(picked, null, 2));
  if (picked.annos[2].localPos[2] > picked.annos[1].localPos[2] - 0.03) {
    console.warn('occiput still too forward, force nudge');
    picked.annos[2].localPos[2] = Math.min(picked.annos[2].localPos[2], picked.annos[1].localPos[2] - 0.045);
    picked.annos[2].localPos[1] = Math.min(picked.annos[2].localPos[1], picked.annos[1].localPos[1] - 0.01);
  }

  const annotations = picked.annos.map((p) => ({
    id: 'anno_l06_' + p.id,
    annotationKind: 'leader',
    text: p.id,
    detailText: '',
    collapsed: false,
    color: '#bfbfbf',
    dx: p.dx,
    dy: p.dy,
    dxN: p.dx * 0.0007,
    dyN: p.dy * 0.0007,
    dxW: p.dx * 0.0025,
    dyW: p.dy * 0.0025,
    localPos: p.localPos,
    localNormal: p.localNormal,
    baseDist: 6.2,
    baseScale: 5.8,
    labelShape: 'circle',
    occludeDot: -0.35
  }));
  const byId = Object.fromEntries(annotations.map((a) => [a.text.trim(), a]));
  const dashed = [bezSeg('dash_l06_1', byId['1'], byId['2']), bezSeg('dash_l06_2', byId['2'], byId['3'])];

  const f = load206();
  f.data.items[0].annotations = annotations;
  f.data.items[0].dashedLines = dashed;
  f.data.meta.status = 'seeded';
  fs.writeFileSync(f.full, JSON.stringify(f.data) + '\n');
  rebuild();
  fs.writeFileSync(path.join(outDir, 'pick.json'), JSON.stringify(picked, null, 2));

  await page.goto(`${baseUrl}/Solid.html?sandbox=headform&skipPerf=1&_=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 90000
  });
  await page.waitForTimeout(1000);
  await page.evaluate(() => {
    window.useAdvancedRender = false;
    window.perfTestDone = true;
    if (window.loadJSONData) window.loadJSONData();
  });
  await page.waitForFunction(
    () => (window.customScenes || []).length > 0 && window.__solidHost && window.__solidHost.getCamera(),
    null,
    { timeout: 90000 }
  );
  await page.evaluate(() => {
    const m = document.getElementById('scene-grid-modal');
    if (m) m.style.display = 'none';
    const i = window.customScenes.findIndex((s) => s && s.id === 'L06');
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
      } catch (e) {}
      return c;
    });
    if (n > 0) break;
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(1800);
  await page.evaluate(() => {
    const el = document.getElementById('scene-loader');
    if (el) el.style.display = 'none';
    window.showAnnotations = true;
    try {
      if (typeof window.stopRender === 'function') window.stopRender();
    } catch (e) {}
    document.querySelectorAll('body *').forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      const t = (el.textContent || '').trim();
      if (/^(正在计算光影|首帧渲染中|光影探针)/.test(t) && t.length < 40) el.style.display = 'none';
    });
  });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(outDir, 'L06-annotated.png'), timeout: 45000 });
  await page.evaluate(() => {
    window.showAnnotations = false;
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outDir, 'L06-clean.png'), timeout: 45000 });
  console.log('OUT', outDir);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
