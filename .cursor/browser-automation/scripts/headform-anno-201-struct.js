/**
 * 201-struct：光位关按「明暗交界经过的结构点」重钉（非亮面/环影现象名）
 * 主线 1–6：颞线、眉峰、眶外角、颧突隆、口轮匝肌侧缘、颏结节
 * 支线 A/B：上眼睑交界、下眼睑上交界
 * 支线 C：鼻侧交界（钉在线上）
 * 光：侧前略高 Loop（az≈58）；环影未接仍作表象钉子写在文案
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-headform-201-struct`);
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:18080';
fs.mkdirSync(outDir, { recursive: true });

function load201() {
  const f = fs.readdirSync(jsonDir).find((n) => n.startsWith('201_') && n.endsWith('.json'));
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
    window.isTestingPerformance = false;
    window.isLoadingScene = false;
    const hide = (el) => {
      if (!el) return;
      el.style.display = 'none';
      el.style.visibility = 'hidden';
      el.style.opacity = '0';
    };
    hide(document.getElementById('scene-loader'));
    hide(document.getElementById('perf-test-overlay'));
    document.querySelectorAll('body *').forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      const t = (el.textContent || '').trim();
      if (/^(正在计算光影|首帧渲染中|即将完成)/.test(t) && t.length < 40) hide(el);
    });
  });
}

async function boot(page) {
  await page.goto(`${baseUrl}/Solid.html?sandbox=headform&skipPerf=1&_=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 90000
  });
  await page.waitForTimeout(800);
  await forceRaster(page);
  await page.evaluate(() => {
    if (window.loadJSONData) window.loadJSONData();
  });
  await page.waitForFunction(
    () => (window.customScenes || []).length > 0 && window.__solidHost && window.__solidHost.getCamera(),
    null,
    { timeout: 90000 }
  );
}

async function openL01(page) {
  await page.evaluate(() => {
    const m = document.getElementById('scene-grid-modal');
    if (m) m.style.display = 'none';
    const i = (window.customScenes || []).findIndex((s) => s && s.id === 'L01');
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
    await page.waitForTimeout(200);
  }
  for (let k = 0; k < 6; k++) {
    await forceRaster(page);
    await page.waitForTimeout(300);
  }
}

const DETAIL = '侧前略高：脸侧明暗交界清楚；鼻旁还有一小段交界，还没接到颊侧大交界。';

const KEY_POINTS =
  '本关只看光：侧前略高时，明暗交界怎么走。如果您不小心转动了视角，请点击重置按钮恢复视角。\n' +
  '先看表象：一侧仍亮、一侧转入暗；鼻旁常有一小段影，但还没接到颊上的大片暗——日常肖像里很常见的「环形」档。若接到了，就更接近下一关「伦勃朗」。\n' +
  '这些形状从哪来？主交界线沿着结构转角串起来：颞线→眉峰→眶外角→颧突隆→口轮匝肌侧缘→颏结节。眼部另有两小段交界；鼻侧也有一段交界（本关只钉在线上）。结构转角在，交界才会在这些位置拐；反过来，看见交界怎么拐，也能反推这里有结构。\n\n' +
  '点位名称如下：\n' +
  '主交界线：\n1.颞线\n2.眉峰\n3.眶外角\n4.颧突隆\n5.口轮匝肌侧缘\n6.颏结节\n' +
  '支线1（眼）：\nA.上眼睑交界\nB.下眼睑上交界\n' +
  '支线2（鼻）：\nC.鼻侧交界';

(async () => {
  const file0 = load201();
  file0.data.camera = {
    pos: [1.05, 0.86, 6.1],
    target: [0, 0.82, 0.04],
    zoom: 0.58,
    fov: 14
  };
  file0.data.light = {
    type: 'point',
    azimuth: 58,
    elevation: 30,
    distance: 15,
    temp: 34,
    size: 11,
    intensity: 2.15
  };
  file0.data.env = file0.data.env || {};
  file0.data.env.skyLightScale = 0.55;
  file0.data.env.lightIndicatorEnabled = true;
  file0.data.crop = {
    display: 'block',
    left: '430px',
    top: '70px',
    width: '760px',
    height: '760px'
  };
  fs.writeFileSync(file0.full, JSON.stringify(file0.data) + '\n');
  rebuild();

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await boot(page);
  await openL01(page);

  // 暗侧在 −X（az≈58→光在 +X）；目标为局部坐标粗锚，再按屏窗扫描吸附
  const specs = [
    { id: '1', text: '1', color: '#00e8e8', target: { x: -0.055, y: 0.235, z: 0.02 }, box: [0.28, 0.42, 0.18, 0.34], dx: -100, dy: -30 },
    { id: '2', text: '2', color: '#00e8e8', target: { x: -0.048, y: 0.195, z: 0.055 }, box: [0.3, 0.44, 0.3, 0.42], dx: -95, dy: -10 },
    { id: '3', text: '3', color: '#00e8e8', target: { x: -0.055, y: 0.175, z: 0.05 }, box: [0.3, 0.44, 0.36, 0.48], dx: -100, dy: 8 },
    { id: '4', text: '4', color: '#00e8e8', target: { x: -0.062, y: 0.145, z: 0.03 }, box: [0.28, 0.42, 0.44, 0.56], dx: -105, dy: 20 },
    { id: '5', text: '5', color: '#00e8e8', target: { x: -0.04, y: 0.1, z: 0.055 }, box: [0.34, 0.48, 0.52, 0.64], dx: -90, dy: 36 },
    { id: '6', text: '6', color: '#00e8e8', target: { x: -0.028, y: 0.055, z: 0.07 }, box: [0.36, 0.5, 0.62, 0.74], dx: -80, dy: 50 },
    { id: 'A', text: 'A', color: '#9aa3ad', target: { x: -0.035, y: 0.178, z: 0.072 }, box: [0.36, 0.48, 0.36, 0.46], dx: 78, dy: -18 },
    { id: 'B', text: 'B', color: '#9aa3ad', target: { x: -0.032, y: 0.162, z: 0.075 }, box: [0.36, 0.48, 0.4, 0.5], dx: 82, dy: 12 },
    { id: 'C', text: 'C', color: '#9aa3ad', target: { x: -0.022, y: 0.125, z: 0.07 }, box: [0.4, 0.52, 0.48, 0.58], dx: 70, dy: 28 }
  ];

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

    function scan(target, box) {
      const [u0, u1, v0, v1] = box;
      let best = null;
      let bestD = 1e9;
      for (let v = v0; v <= v1; v += 0.007) {
        for (let u = u0; u <= u1; u += 0.007) {
          raycaster.setFromCamera(new THREE.Vector2(u * 2 - 1, -(v * 2 - 1)), cam);
          const hit = raycaster.intersectObjects(meshes, true)[0];
          if (!hit) continue;
          lp.copy(hit.point);
          root.worldToLocal(lp);
          // 偏好暗侧 −X、略靠前
          if (lp.x > 0.02) continue;
          const d = (lp.x - target.x) ** 2 + (lp.y - target.y) ** 2 + (lp.z - target.z) ** 2;
          if (d < bestD) {
            bestD = d;
            best = { u, v, hit, x: lp.x, y: lp.y, z: lp.z, d: Math.sqrt(d) };
          }
        }
      }
      return best;
    }

    function make(spec, best) {
      if (!best) return null;
      const h = best.hit;
      lp.copy(h.point);
      root.worldToLocal(lp);
      let nWorld = new THREE.Vector3(-0.4, 0.1, 0.6);
      if (h.face && h.face.normal) {
        nWorld = h.face.normal.clone().transformDirection(h.object.matrixWorld).normalize();
      }
      const localNormal = root.worldToLocal(h.point.clone().add(nWorld)).sub(lp.clone()).normalize();
      return {
        id: 'anno_l01_' + spec.id,
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
        baseDist: +h.distance.toFixed(4),
        baseScale: 5.8,
        occludeDot: -0.35,
        labelShape: 'circle',
        _dbg: {
          id: spec.id,
          u: +best.u.toFixed(3),
          v: +best.v.toFixed(3),
          d: +best.d.toFixed(4),
          xyz: [+best.x.toFixed(3), +best.y.toFixed(3), +best.z.toFixed(3)]
        }
      };
    }

    const annotations = [];
    const dbg = [];
    for (const spec of specs) {
      const best = scan(spec.target, spec.box);
      const a = make(spec, best);
      if (!a) {
        dbg.push({ id: spec.id, ok: false });
        continue;
      }
      annotations.push(a);
      dbg.push({ id: spec.id, ok: true, dbg: a._dbg });
    }
    return { ok: annotations.length === specs.length, annotations, dbg };
  }, specs);

  console.log(JSON.stringify(placed.dbg, null, 2));
  if (!placed.ok) throw new Error('place incomplete ' + placed.dbg.filter((d) => !d.ok).map((d) => d.id).join(','));
  placed.annotations.forEach((a) => delete a._dbg);

  const file = load201();
  file.data.items[0].annotations = placed.annotations;
  file.data.items[0].dashedLines = file.data.items[0].dashedLines || [];
  file.data.meta.status = 'wip';
  file.data.meta.line = 'light';
  file.data.meta.slot = 'L01';
  file.data.meta.detail = DETAIL;
  file.data.meta.keyPoints = KEY_POINTS;
  fs.writeFileSync(file.full, JSON.stringify(file.data) + '\n');
  rebuild();

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await forceRaster(page);
  await page.evaluate(() => {
    if (window.loadJSONData) window.loadJSONData();
  });
  await page.waitForFunction(() => (window.customScenes || []).length > 0, null, { timeout: 90000 });
  await openL01(page);
  await page.evaluate(() => {
    window.showAnnotations = true;
  });
  await forceRaster(page);
  await page.waitForTimeout(1200);
  await forceRaster(page);

  const crop = { x: 430, y: 70, width: 760, height: 720 };
  await page.screenshot({ path: path.join(outDir, 'L01-annotated-full.png') });
  await page.screenshot({ path: path.join(outDir, 'L01-annotated-crop.png'), clip: crop });
  await page.evaluate(() => {
    window.showAnnotations = false;
  });
  await forceRaster(page);
  await page.waitForTimeout(400);
  const thumbBuf = await page.screenshot({ type: 'jpeg', quality: 72, clip: { x: 450, y: 90, width: 720, height: 720 } });
  await page.screenshot({ path: path.join(outDir, 'L01-light-crop.png'), clip: crop });

  const f2 = load201();
  f2.data.thumbnail = 'data:image/jpeg;base64,' + thumbBuf.toString('base64');
  fs.writeFileSync(f2.full, JSON.stringify(f2.data) + '\n');
  rebuild();

  console.log('OUT', outDir);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
