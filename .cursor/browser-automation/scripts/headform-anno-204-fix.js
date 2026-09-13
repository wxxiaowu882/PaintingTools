/** 204-fix：补 ③眶外角，并把主线点位往明暗交界缘收（勿沉进大暗） */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-headform-204-fix`);
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:18080';
fs.mkdirSync(outDir, { recursive: true });

function load204() {
  const f = fs.readdirSync(jsonDir).find((n) => n.startsWith('204_') && n.endsWith('.json'));
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

// 正侧交界五点口径：额结节外侧—眉峰—眶外角—颧突隆—颏结节（书 120/121）
// 点须落在侧缘结构上，勿贴中线鼻侧；光略前移后交界更贴侧缘
const SPECS = [
  { id: '1', text: '1', color: '#bfbfbf', target: { x: -0.044, y: 0.216, z: 0.058 }, box: [0.28, 0.44, 0.22, 0.38], dx: -70, dy: -28 },
  { id: '2', text: '2', color: '#bfbfbf', target: { x: -0.048, y: 0.192, z: 0.06 }, box: [0.28, 0.44, 0.3, 0.42], dx: -70, dy: -8 },
  { id: '3', text: '3', color: '#bfbfbf', target: { x: -0.05, y: 0.168, z: 0.055 }, box: [0.28, 0.44, 0.34, 0.48], dx: -75, dy: 5 },
  { id: '4', text: '4', color: '#bfbfbf', target: { x: -0.048, y: 0.138, z: 0.06 }, box: [0.28, 0.44, 0.44, 0.56], dx: -70, dy: 0 },
  { id: '5', text: '5', color: '#bfbfbf', target: { x: -0.038, y: 0.1, z: 0.064 }, box: [0.3, 0.46, 0.54, 0.66], dx: -70, dy: 15 },
  { id: '6', text: '6', color: '#bfbfbf', target: { x: -0.024, y: 0.068, z: 0.066 }, box: [0.34, 0.5, 0.64, 0.76], dx: -65, dy: 25 },
  { id: '7', text: '7', color: '#bfbfbf', target: { x: -0.004, y: 0.048, z: 0.052 }, box: [0.4, 0.58, 0.72, 0.88], dx: -40, dy: 50 },
  { id: 'A', text: 'A', color: '#197657', target: { x: -0.04, y: 0.176, z: 0.072 }, box: [0.32, 0.46, 0.34, 0.46], dx: 55, dy: -20 },
  { id: 'B', text: 'B', color: '#197657', target: { x: -0.038, y: 0.16, z: 0.068 }, box: [0.32, 0.46, 0.4, 0.5], dx: 55, dy: 15 }
];

function bezSeg(id, a, b) {
  if (!a || !b) return null;
  return {
    id,
    color: '#7a7a7a',
    kind: 'bezier',
    strokeWidth: 2.5,
    capR: 1,
    points: [
      {
        pos: [...a.localPos],
        norm: [...a.localNormal],
        handleOut: [
          (b.localPos[0] - a.localPos[0]) * 0.2,
          (b.localPos[1] - a.localPos[1]) * 0.25,
          (b.localPos[2] - a.localPos[2]) * 0.12
        ]
      },
      {
        pos: [...b.localPos],
        norm: [...b.localNormal],
        handleIn: [
          (a.localPos[0] - b.localPos[0]) * 0.2,
          (a.localPos[1] - b.localPos[1]) * 0.25,
          (a.localPos[2] - b.localPos[2]) * 0.12
        ]
      }
    ]
  };
}

async function scrubUI(page) {
  await page.evaluate(() => {
    try {
      if (typeof window.stopRender === 'function') window.stopRender();
    } catch (e) {}
    window.useAdvancedRender = false;
    window.perfTestDone = true;
    const hide = (el) => {
      if (!el) return;
      el.style.display = 'none';
      el.style.opacity = '0';
    };
    hide(document.getElementById('scene-loader'));
    document.querySelectorAll('body *').forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      const t = (el.textContent || '').trim();
      if (/^(正在计算光影|首帧渲染中|光影探针)/.test(t) && t.length < 50) hide(el);
    });
  });
}

(async () => {
  // 比纯侧（az0）略偏前：交界落在眶外角/颧突隆一线，仍读作阴阳对半
  const file0 = load204();
  Object.assign(file0.data.light, { azimuth: 16, elevation: 24, size: 10, intensity: 2.2 });
  file0.data.id = 'L04';
  file0.data.meta = Object.assign({}, file0.data.meta, { line: 'light', slot: 'L04', status: 'seeded' });
  fs.writeFileSync(file0.full, JSON.stringify(file0.data) + '\n');
  rebuild();

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${baseUrl}/Solid.html?sandbox=headform&skipPerf=1&_=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 120000
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
  await page.waitForFunction(() => (window.customScenes || []).length > 0, null, { timeout: 120000 });
  await page.waitForFunction(() => !!(window.__solidHost && window.__solidHost.getCamera), null, {
    timeout: 120000
  });
  await page.evaluate(() => {
    const m = document.getElementById('scene-grid-modal');
    if (m) m.style.display = 'none';
    let i = (window.customScenes || []).findIndex((s) => s && s.id === 'L04');
    if (i < 0) i = (window.customScenes || []).findIndex((s) => s && /阴阳对半|Split/i.test(String(s.name || '')));
    window.currentSceneIndex = -1;
    window.switchScene(i);
  });
  for (let i = 0; i < 100; i++) {
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
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(2500);
  for (let k = 0; k < 7; k++) {
    await scrubUI(page);
    await page.waitForTimeout(280);
  }

  const placed = await page.evaluate((specs) => {
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
    const lp = new THREE.Vector3();

    function scan(spec) {
      const [u0, u1, v0, v1] = spec.box;
      let best = null;
      let bestScore = 1e9;
      for (let v = v0; v <= v1; v += 0.005) {
        for (let u = u0; u <= u1; u += 0.005) {
          raycaster.setFromCamera(new THREE.Vector2(u * 2 - 1, -(v * 2 - 1)), cam);
          const hit = raycaster.intersectObjects(meshes, true)[0];
          if (!hit) continue;
          lp.copy(hit.point);
          root.worldToLocal(lp);
          // 侧缘结构带：过中则贴鼻，过深则沉暗；颏底（7）允许近中线
          const isChin = spec.id === '7';
          if (isChin) {
            if (lp.x > 0.02 || lp.x < -0.04) continue;
            if (lp.z < 0.02 || lp.z > 0.075) continue;
            if (lp.y < 0.035 || lp.y > 0.065) continue;
          } else {
            if (lp.x > -0.012 || lp.x < -0.072) continue;
            if (lp.z < 0.035) continue;
            // 眶外角勿落到颞侧过深 z
            if (spec.id === '3' && lp.z < 0.045) continue;
          }
          const t = spec.target;
          let score = (lp.x - t.x) ** 2 + (lp.y - t.y) ** 2 + (lp.z - t.z) ** 2;
          if (!isChin) {
            score += Math.max(0, 0.05 - lp.z) * 0.025;
            if (lp.x > -0.03) score += (lp.x + 0.03) * 0.08;
          }
          if (score < bestScore) {
            bestScore = score;
            best = { hit, x: lp.x, y: lp.y, z: lp.z, d: Math.sqrt(score) };
          }
        }
      }
      return best;
    }

    function make(spec, best) {
      if (!best) return null;
      lp.copy(best.hit.point);
      root.worldToLocal(lp);
      let nWorld = new THREE.Vector3(-0.45, 0.1, 0.7);
      if (best.hit.face && best.hit.face.normal) {
        nWorld = best.hit.face.normal.clone().transformDirection(best.hit.object.matrixWorld).normalize();
      }
      const localNormal = root.worldToLocal(best.hit.point.clone().add(nWorld)).sub(lp.clone()).normalize();
      return {
        id: 'anno_l04_' + spec.id,
        annotationKind: 'leader',
        text: spec.text,
        detailText: '',
        collapsed: false,
        color: spec.color,
        dx: spec.dx,
        dy: spec.dy,
        dxN: 0,
        dyN: 0,
        dxW: 0,
        dyW: 0,
        localPos: [+lp.x.toFixed(4), +lp.y.toFixed(4), +lp.z.toFixed(4)],
        localNormal: [+localNormal.x.toFixed(3), +localNormal.y.toFixed(3), +localNormal.z.toFixed(3)],
        baseDist: +best.hit.distance.toFixed(4),
        baseScale: 5.8,
        occludeDot: -0.35,
        labelShape: 'circle',
        _dbg: [+best.x.toFixed(3), +best.y.toFixed(3), +best.z.toFixed(3)]
      };
    }

    const annotations = [];
    const dbg = [];
    for (const spec of specs) {
      const best = scan(spec);
      const a = make(spec, best);
      if (!a) {
        dbg.push({ id: spec.id, ok: false });
        continue;
      }
      annotations.push(a);
      dbg.push({ id: spec.id, ok: true, xyz: a._dbg });
      delete a._dbg;
    }
    return { ok: annotations.length === specs.length, annotations, dbg };
  }, SPECS);

  console.log(JSON.stringify(placed.dbg, null, 2));
  if (!placed.ok) throw new Error('place incomplete: ' + placed.dbg.filter((x) => !x.ok).map((x) => x.id).join(','));

  const by = Object.fromEntries(placed.annotations.map((a) => [a.text, a]));
  const chain = ['1', '2', '3', '4', '5', '6', '7'];
  const dashedLines = [];
  for (let i = 0; i < chain.length - 1; i++) {
    const seg = bezSeg('dash_l04_' + chain[i] + '_' + chain[i + 1], by[chain[i]], by[chain[i + 1]]);
    if (seg) dashedLines.push(seg);
  }

  const file = load204();
  file.data.id = 'L04';
  file.data.items[0].annotations = placed.annotations;
  file.data.items[0].dashedLines = dashedLines;
  file.data.meta = Object.assign({}, file.data.meta, { line: 'light', slot: 'L04', status: 'seeded' });
  fs.writeFileSync(file.full, JSON.stringify(file.data) + '\n');
  rebuild();

  await page.evaluate(() => {
    if (window.loadJSONData) window.loadJSONData();
  });
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    let i = (window.customScenes || []).findIndex((s) => s && s.id === 'L04');
    if (i < 0) i = (window.customScenes || []).findIndex((s) => s && /阴阳对半|Split/i.test(String(s.name || '')));
    window.currentSceneIndex = -1;
    window.switchScene(i);
  });
  await page.waitForTimeout(2200);
  for (let k = 0; k < 6; k++) {
    await scrubUI(page);
    await page.waitForTimeout(250);
  }

  const crop = await page.evaluate(() => {
    const s = (window.customScenes || []).find((x) => x && x.id === 'L04');
    const c = (s && s.crop) || {};
    return { x: parseFloat(c.left) || 450, y: parseFloat(c.top) || 90, width: 760, height: 720 };
  });

  await page.evaluate(() => {
    if (window.showAnnotations !== false && typeof window.toggleAnnotations === 'function') window.toggleAnnotations();
  });
  await scrubUI(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outDir, 'L04-light-only.png'), clip: crop });

  await page.evaluate(() => {
    if (window.showAnnotations !== true && typeof window.toggleAnnotations === 'function') window.toggleAnnotations();
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outDir, 'L04-annotated-crop.png'), clip: crop });

  await page.evaluate(() => {
    if (window.showAnnotations !== false && typeof window.toggleAnnotations === 'function') window.toggleAnnotations();
  });
  await page.waitForTimeout(300);
  const thumb = await page.screenshot({
    type: 'jpeg',
    quality: 72,
    clip: { x: crop.x + 20, y: crop.y + 20, width: 700, height: 700 }
  });
  const f2 = load204();
  f2.data.thumbnail = 'data:image/jpeg;base64,' + thumb.toString('base64');
  f2.data.id = 'L04';
  fs.writeFileSync(f2.full, JSON.stringify(f2.data) + '\n');
  rebuild();
  console.log('OUT', outDir);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
