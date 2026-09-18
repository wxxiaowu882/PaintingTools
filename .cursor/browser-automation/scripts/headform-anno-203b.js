/**
 * 203b：核对主光世界坐标 + 微调正前略高，重截蝶影证据
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-headform-203b`);
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:18080';
fs.mkdirSync(outDir, { recursive: true });

function load203() {
  const f = fs.readdirSync(jsonDir).find((n) => n.startsWith('203_') && n.endsWith('.json'));
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

async function forceRaster(page) {
  await page.evaluate(() => {
    try {
      if (typeof window.stopRender === 'function') window.stopRender();
    } catch (e) {}
    window._solidUserStoppedRender = true;
    window.useAdvancedRender = false;
    window.perfTestDone = true;
    window.isLoadingScene = false;
    const el = document.getElementById('scene-loader');
    if (el) {
      el.style.display = 'none';
      el.style.opacity = '0';
    }
  });
}

async function waitMeshes(page) {
  for (let i = 0; i < 120; i++) {
    const n = await page.evaluate(() => {
      let c = 0;
      try {
        window.__solidHost.getSceneGroup().traverse((o) => {
          if (o.isMesh) c++;
        });
      } catch (e) {}
      return c;
    });
    if (n > 0) return n;
    await page.waitForTimeout(400);
  }
  return 0;
}

(async () => {
  // 正前略高：略抬、略柔，利于鼻下对称蝶影
  const chosen = {
    azimuth: Number(process.env.AZ || 90),
    elevation: Number(process.env.EL || 58),
    size: Number(process.env.SIZE || 12),
    intensity: Number(process.env.INT || 2.2),
    distance: 15
  };
  const file = load203();
  Object.assign(file.data.light, chosen);
  file.data.camera = {
    pos: [0.0, 1.05, 6.4],
    target: [0, 0.82, 0.04],
    zoom: 0.58,
    fov: 14
  };
  file.data.env.lightIndicatorEnabled = false;
  file.data.env.skyLightScale = 0.45;
  file.data.id = 'L03';
  file.data.meta = Object.assign({}, file.data.meta, { line: 'light', slot: 'L03', status: 'seeded' });
  fs.writeFileSync(file.full, JSON.stringify(file.data) + '\n');
  rebuild();

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${baseUrl}/Solid.html?sandbox=headform&skipPerf=1&_=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 120000
  });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    window.useAdvancedRender = false;
    window.perfTestDone = true;
    window._solidUserStoppedRender = true;
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
    const scenes = window.customScenes || [];
    let i = scenes.findIndex((s) => s && s.id === 'L03');
    if (i < 0) i = scenes.findIndex((s) => s && /蝴蝶|Butterfly/i.test(String(s.name || '')));
    window.currentSceneIndex = -1;
    window.switchScene(i);
  });
  console.log('meshes', await waitMeshes(page));
  await page.waitForTimeout(2500);
  for (let k = 0; k < 6; k++) {
    await forceRaster(page);
    await page.waitForTimeout(300);
  }

  const probe = await page.evaluate(() => {
    const host = window.__solidHost;
    const sc = (window.customScenes || []).find((s) => s && s.id === 'L03');
    let lightPos = null;
    try {
      const scene = host.getScene && host.getScene();
      scene &&
        scene.traverse((o) => {
          if (!lightPos && o.isLight && o.type !== 'AmbientLight' && o.intensity > 0.2) {
            lightPos = { type: o.type, x: +o.position.x.toFixed(3), y: +o.position.y.toFixed(3), z: +o.position.z.toFixed(3), intensity: o.intensity };
          }
        });
    } catch (e) {}
    return {
      sceneLight: sc && sc.light,
      uiAz: document.getElementById('lightAzimuth') && document.getElementById('lightAzimuth').value,
      uiEl: document.getElementById('lightElevation') && document.getElementById('lightElevation').value,
      lightPos
    };
  });
  console.log('probe', JSON.stringify(probe, null, 2));
  fs.writeFileSync(path.join(outDir, 'probe.json'), JSON.stringify(probe, null, 2));

  await page.evaluate(() => {
    if (window.showAnnotations !== false && typeof window.toggleAnnotations === 'function') window.toggleAnnotations();
  });
  await forceRaster(page);
  await page.waitForTimeout(400);
  const crop = {
    x: parseFloat((file.data.crop && file.data.crop.left) || 457) || 457,
    y: parseFloat((file.data.crop && file.data.crop.top) || 90) || 90,
    width: 760,
    height: 720
  };
  await page.screenshot({ path: path.join(outDir, 'L03-light-only.png'), clip: crop });

  // 重钉 3/4 到鼻翼高度（略抬 y），其余保留
  const placed = await page.evaluate(() => {
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
    const specs = [
      { id: '3', text: '3', color: '#bfbfbf', target: { x: -0.02, y: 0.122, z: 0.09 }, box: [0.38, 0.48, 0.46, 0.56], dx: -80, dy: 10, prefer: 'negX' },
      { id: '4', text: '4', color: '#bfbfbf', target: { x: 0.02, y: 0.122, z: 0.09 }, box: [0.52, 0.62, 0.46, 0.56], dx: 80, dy: 10, prefer: 'posX' }
    ];
    function okSide(prefer, x) {
      if (prefer === 'negX') return x < -0.006;
      if (prefer === 'posX') return x > 0.006;
      return true;
    }
    function scan(spec) {
      const [u0, u1, v0, v1] = spec.box;
      let best = null;
      let bestD = 1e9;
      for (let v = v0; v <= v1; v += 0.005) {
        for (let u = u0; u <= u1; u += 0.005) {
          raycaster.setFromCamera(new THREE.Vector2(u * 2 - 1, -(v * 2 - 1)), cam);
          const hit = raycaster.intersectObjects(meshes, true)[0];
          if (!hit) continue;
          lp.copy(hit.point);
          root.worldToLocal(lp);
          if (!okSide(spec.prefer, lp.x)) continue;
          if (lp.z < 0.04) continue;
          const t = spec.target;
          const dist = (lp.x - t.x) ** 2 + (lp.y - t.y) ** 2 + (lp.z - t.z) ** 2;
          if (dist < bestD) {
            bestD = dist;
            best = { hit, x: lp.x, y: lp.y, z: lp.z, d: Math.sqrt(dist) };
          }
        }
      }
      return best;
    }
    const out = [];
    for (const spec of specs) {
      const best = scan(spec);
      if (!best) {
        out.push({ id: spec.id, ok: false });
        continue;
      }
      lp.copy(best.hit.point);
      root.worldToLocal(lp);
      let nWorld = new THREE.Vector3(0, 0.05, 0.9);
      if (best.hit.face && best.hit.face.normal) {
        nWorld = best.hit.face.normal.clone().transformDirection(best.hit.object.matrixWorld).normalize();
      }
      const localNormal = root.worldToLocal(best.hit.point.clone().add(nWorld)).sub(lp.clone()).normalize();
      out.push({
        id: spec.id,
        ok: true,
        text: spec.text,
        color: spec.color,
        dx: spec.dx,
        dy: spec.dy,
        localPos: [+lp.x.toFixed(4), +lp.y.toFixed(4), +lp.z.toFixed(4)],
        localNormal: [+localNormal.x.toFixed(3), +localNormal.y.toFixed(3), +localNormal.z.toFixed(3)],
        baseDist: +best.hit.distance.toFixed(4),
        dbg: [+best.x.toFixed(3), +best.y.toFixed(3), +best.z.toFixed(3), +best.d.toFixed(3)]
      });
    }
    return out;
  });
  console.log('retarget 3/4', placed);

  const f2 = load203();
  for (const p of placed) {
    if (!p.ok) continue;
    const a = (f2.data.items[0].annotations || []).find((x) => x.text === p.text);
    if (!a) continue;
    a.localPos = p.localPos;
    a.localNormal = p.localNormal;
    a.baseDist = p.baseDist;
    a.dx = p.dx;
    a.dy = p.dy;
  }
  // 重建蝶影翼线 3-2-4
  const by = Object.fromEntries((f2.data.items[0].annotations || []).map((a) => [a.text, a]));
  const dashes = (f2.data.items[0].dashedLines || []).filter(
    (d) => !/wingL|wingR/.test(String(d.id || ''))
  );
  function bez(id, a, b) {
    if (!a || !b) return;
    dashes.unshift({
      id,
      color: '#7a7a7a',
      kind: 'bezier',
      strokeWidth: 2.5,
      capR: 1,
      points: [
        {
          pos: [...a.localPos],
          norm: [...a.localNormal],
          handleOut: [(b.localPos[0] - a.localPos[0]) * 0.2, (b.localPos[1] - a.localPos[1]) * 0.25, (b.localPos[2] - a.localPos[2]) * 0.15]
        },
        {
          pos: [...b.localPos],
          norm: [...b.localNormal],
          handleIn: [(a.localPos[0] - b.localPos[0]) * 0.2, (a.localPos[1] - b.localPos[1]) * 0.25, (a.localPos[2] - b.localPos[2]) * 0.15]
        }
      ]
    });
  }
  bez('dash_l03_wingL', by['3'], by['2']);
  bez('dash_l03_wingR', by['2'], by['4']);
  f2.data.items[0].dashedLines = dashes;
  f2.data.camera = file.data.camera;
  f2.data.light = file.data.light;
  f2.data.id = 'L03';
  fs.writeFileSync(f2.full, JSON.stringify(f2.data) + '\n');
  rebuild();

  await page.evaluate(() => {
    if (window.loadJSONData) window.loadJSONData();
  });
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    const scenes = window.customScenes || [];
    let i = scenes.findIndex((s) => s && s.id === 'L03');
    if (i < 0) i = scenes.findIndex((s) => s && /蝴蝶/.test(String(s.name || '')));
    window.currentSceneIndex = -1;
    window.switchScene(i);
  });
  await waitMeshes(page);
  await page.waitForTimeout(2000);
  for (let k = 0; k < 5; k++) {
    await forceRaster(page);
    await page.waitForTimeout(250);
  }
  await page.evaluate(() => {
    if (window.showAnnotations !== true && typeof window.toggleAnnotations === 'function') window.toggleAnnotations();
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outDir, 'L03-annotated-crop.png'), clip: crop });
  await page.evaluate(() => {
    if (window.showAnnotations !== false && typeof window.toggleAnnotations === 'function') window.toggleAnnotations();
  });
  await page.waitForTimeout(300);
  const thumb = await page.screenshot({
    type: 'jpeg',
    quality: 72,
    clip: { x: crop.x + 20, y: crop.y + 20, width: 700, height: 700 }
  });
  const f3 = load203();
  f3.data.thumbnail = 'data:image/jpeg;base64,' + thumb.toString('base64');
  f3.data.id = 'L03';
  fs.writeFileSync(f3.full, JSON.stringify(f3.data) + '\n');
  rebuild();
  console.log('OUT', outDir, chosen);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
