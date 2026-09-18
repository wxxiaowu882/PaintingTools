/**
 * 203 蝴蝶光（Butterfly）：正前略高 → 鼻下对称蝶影
 * - 模型/裁剪/取景种子迁自手调 201
 * - 光 az≈90（正前），elevation 试档后落盘
 * - 圆标钉蝶影与正中交界经过的结构点；可选贝塞尔串鼻下蝶影轮廓
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-headform-203`);
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:18080';
fs.mkdirSync(outDir, { recursive: true });

function loadPref(prefix) {
  const f = fs.readdirSync(jsonDir).find((n) => n.startsWith(prefix) && n.endsWith('.json'));
  if (!f) throw new Error('missing ' + prefix);
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
  return files.length;
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
    const el = document.getElementById('scene-loader');
    if (el) {
      el.style.display = 'none';
      el.style.opacity = '0';
    }
  });
}

async function waitMeshes(page) {
  for (let i = 0; i < 150; i++) {
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

const DETAIL = '正前略高：鼻下留下对称的蝶形影；脸左右明暗较均衡。';

const KEY_POINTS = `本场景只看正前略高这一档光线下，明暗交界怎么走。交界主要跟「光线和头的夹角」有关，和我们观察的角度无关——你可以转动场景，换几个角度看这条交界，以及圆标钉住的那些结构。

请不要改变当前光线的方向、高低等参数，因为这会影响本场景的教学观感。如有误改，点「重置」把光（和本场景默认状态）恢复即可。

先看表象：光线几乎正对脸、略抬高时，鼻下常留下一块左右对称的影，形状像蝴蝶——摄影里常叫「蝴蝶光」。左右颊大体都还亮，不像上一场景「伦勃朗」那样一侧大片暗。若一侧已经大暗、还出现三角亮，就更接近「伦勃朗」；若鼻旁小影未对称、偏在一侧，则更接近「环形」。

明暗交界线的形状从哪来？画面上的曲线勾出鼻下蝶影等交界走向；圆标钉在交界经过的结构点（或线位）上。交界出现是因为有结构起伏；看见对称蝶影，也能反推鼻底与唇上区的起伏关系。

点位(或线位)名称如下：

【主线 · 正中与蝶影】
①.眉心
②.鼻头下缘（蝶影上缘中点）
③.左鼻翼缘（蝶影左翼）
④.右鼻翼缘（蝶影右翼）
⑤.唇峰
⑥.颏唇沟
⑦.颏底

【支线 · 眼】
A.左眶上缘交界
B.右眶上缘交界

可点击操作面板上的眼睛图标来隐藏标注，更干净地观察明暗交界线。`;

// 目标局部坐标（石膏头约 y 向上、z 朝前）；正前光偏好 |x| 对称、靠前
const SPECS = [
  { id: '1', text: '1', color: '#bfbfbf', target: { x: 0.0, y: 0.2, z: 0.07 }, box: [0.42, 0.58, 0.28, 0.4], dx: -70, dy: -40, prefer: 'center' },
  { id: '2', text: '2', color: '#bfbfbf', target: { x: 0.0, y: 0.125, z: 0.095 }, box: [0.44, 0.56, 0.48, 0.58], dx: 0, dy: 55, prefer: 'center' },
  { id: '3', text: '3', color: '#bfbfbf', target: { x: -0.018, y: 0.118, z: 0.085 }, box: [0.38, 0.48, 0.48, 0.58], dx: -75, dy: 20, prefer: 'negX' },
  { id: '4', text: '4', color: '#bfbfbf', target: { x: 0.018, y: 0.118, z: 0.085 }, box: [0.52, 0.62, 0.48, 0.58], dx: 75, dy: 20, prefer: 'posX' },
  { id: '5', text: '5', color: '#bfbfbf', target: { x: 0.0, y: 0.095, z: 0.09 }, box: [0.44, 0.56, 0.55, 0.64], dx: 70, dy: 10, prefer: 'center' },
  { id: '6', text: '6', color: '#bfbfbf', target: { x: 0.0, y: 0.07, z: 0.08 }, box: [0.44, 0.56, 0.62, 0.72], dx: -70, dy: 25, prefer: 'center' },
  { id: '7', text: '7', color: '#bfbfbf', target: { x: 0.0, y: 0.04, z: 0.07 }, box: [0.44, 0.56, 0.7, 0.82], dx: 0, dy: 55, prefer: 'center' },
  { id: 'A', text: 'A', color: '#197657', target: { x: -0.03, y: 0.175, z: 0.07 }, box: [0.36, 0.48, 0.36, 0.46], dx: -70, dy: -15, prefer: 'negX' },
  { id: 'B', text: 'B', color: '#197657', target: { x: 0.03, y: 0.175, z: 0.07 }, box: [0.52, 0.64, 0.36, 0.46], dx: 70, dy: -15, prefer: 'posX' }
];

(async () => {
  const chosen = {
    azimuth: Number(process.env.AZ || 90),
    elevation: Number(process.env.EL || 52),
    size: Number(process.env.SIZE || 10),
    intensity: Number(process.env.INT || 2.2)
  };

  const src = loadPref('201_');
  const dst = loadPref('203_');

  const d = JSON.parse(JSON.stringify(src.data));
  d.id = 'L03';
  d.name = '【光位】正前略高 · 蝴蝶光（Butterfly）';
  d.camera = {
    pos: [...(src.data.camera.pos || [-0.042, 1.089, 6.508])],
    target: [...(src.data.camera.target || [0, 0.82, 0.04])],
    zoom: src.data.camera.zoom || 0.58,
    fov: src.data.camera.fov || 14
  };
  // 略正对脸：相机 x 收一点，利于读对称蝶影
  d.camera.pos[0] = 0.02;
  d.light = {
    type: 'point',
    azimuth: chosen.azimuth,
    elevation: chosen.elevation,
    distance: 15,
    temp: 34,
    size: chosen.size,
    intensity: chosen.intensity
  };
  d.env = Object.assign({}, src.data.env, {
    lightIndicatorEnabled: false,
    skyLightScale: 0.5
  });
  d.crop = src.data.crop || {
    display: 'block',
    left: '457.6px',
    top: '90px',
    width: '760px',
    height: '760px'
  };
  d.meta = {
    line: 'light',
    slot: 'L03',
    status: 'seeded',
    detail: DETAIL,
    keyPoints: KEY_POINTS
  };
  d.items[0].annotations = [];
  d.items[0].dashedLines = [];
  // 保留模型 url/scale
  fs.writeFileSync(dst.full, JSON.stringify(d) + '\n');
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
  const nMesh = await waitMeshes(page);
  console.log('meshes', nMesh, 'light', chosen);
  if (nMesh < 1) throw new Error('no mesh');
  await page.waitForTimeout(2500);
  for (let k = 0; k < 6; k++) {
    await forceRaster(page);
    await page.waitForTimeout(300);
  }

  // 先关标注拍光位证据
  await page.evaluate(() => {
    if (window.showAnnotations !== false && typeof window.toggleAnnotations === 'function') {
      window.toggleAnnotations();
    }
  });
  await forceRaster(page);
  await page.waitForTimeout(400);

  const crop = await page.evaluate(() => {
    const s = (window.customScenes || []).find((x) => x && (x.id === 'L03' || /蝴蝶/.test(String(x.name || ''))));
    const c = (s && s.crop) || {};
    return {
      x: parseFloat(c.left) || 450,
      y: parseFloat(c.top) || 90,
      width: Math.min(760, parseFloat(c.width) || 760),
      height: 720
    };
  });
  await page.screenshot({ path: path.join(outDir, 'L03-light-only.png'), clip: crop });

  // 射线钉点
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

    function okSide(prefer, x) {
      if (prefer === 'negX') return x < -0.004;
      if (prefer === 'posX') return x > 0.004;
      if (prefer === 'center') return Math.abs(x) < 0.025;
      return true;
    }

    function scan(spec) {
      const [u0, u1, v0, v1] = spec.box;
      let best = null;
      let bestD = 1e9;
      for (let v = v0; v <= v1; v += 0.006) {
        for (let u = u0; u <= u1; u += 0.006) {
          raycaster.setFromCamera(new THREE.Vector2(u * 2 - 1, -(v * 2 - 1)), cam);
          const hit = raycaster.intersectObjects(meshes, true)[0];
          if (!hit) continue;
          lp.copy(hit.point);
          root.worldToLocal(lp);
          if (!okSide(spec.prefer, lp.x)) continue;
          if (lp.z < 0.02) continue;
          const t = spec.target;
          const dist = (lp.x - t.x) ** 2 + (lp.y - t.y) ** 2 + (lp.z - t.z) ** 2;
          if (dist < bestD) {
            bestD = dist;
            best = { u, v, hit, x: lp.x, y: lp.y, z: lp.z, d: Math.sqrt(dist) };
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
      let nWorld = new THREE.Vector3(0, 0.1, 0.8);
      if (h.face && h.face.normal) {
        nWorld = h.face.normal.clone().transformDirection(h.object.matrixWorld).normalize();
      }
      const localNormal = root.worldToLocal(h.point.clone().add(nWorld)).sub(lp.clone()).normalize();
      return {
        id: 'anno_l03_' + spec.id,
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
      const best = scan(spec);
      const a = make(spec, best);
      if (!a) {
        dbg.push({ id: spec.id, ok: false });
        continue;
      }
      annotations.push(a);
      dbg.push({ id: spec.id, ok: true, dbg: a._dbg });
    }
    return { ok: annotations.length === specs.length, annotations, dbg };
  }, SPECS);

  console.log(JSON.stringify(placed.dbg, null, 2));
  if (!placed.ok) {
    console.warn('place incomplete', placed.dbg.filter((x) => !x.ok).map((x) => x.id).join(','));
  }
  placed.annotations.forEach((a) => delete a._dbg);

  // 简易蝶影轮廓：3→2→4 三段折贝塞尔（锚点取圆标 localPos）
  const byText = Object.fromEntries(placed.annotations.map((a) => [a.text, a]));
  const dashedLines = [];
  function bezSeg(id, a, b, color) {
    if (!a || !b) return;
    dashedLines.push({
      id,
      color: color || '#7a7a7a',
      kind: 'bezier',
      strokeWidth: 2.5,
      capR: 1,
      points: [
        {
          pos: [...a.localPos],
          norm: [...a.localNormal],
          handleOut: [0, (b.localPos[1] - a.localPos[1]) * 0.25, (b.localPos[2] - a.localPos[2]) * 0.15]
        },
        {
          pos: [...b.localPos],
          norm: [...b.localNormal],
          handleIn: [0, (a.localPos[1] - b.localPos[1]) * 0.25, (a.localPos[2] - b.localPos[2]) * 0.15]
        }
      ]
    });
  }
  bezSeg('dash_l03_wingL', byText['3'], byText['2']);
  bezSeg('dash_l03_wingR', byText['2'], byText['4']);
  bezSeg('dash_l03_mid', byText['2'], byText['5']);
  bezSeg('dash_l03_chin', byText['5'], byText['6']);
  bezSeg('dash_l03_chin2', byText['6'], byText['7']);

  const file = loadPref('203_');
  file.data.id = 'L03';
  file.data.items[0].annotations = placed.annotations;
  file.data.items[0].dashedLines = dashedLines;
  file.data.meta = Object.assign({}, file.data.meta, {
    line: 'light',
    slot: 'L03',
    status: 'seeded',
    detail: DETAIL,
    keyPoints: KEY_POINTS
  });
  fs.writeFileSync(file.full, JSON.stringify(file.data) + '\n');
  rebuild();

  // 重载看标注
  await page.evaluate(() => {
    if (window.loadJSONData) window.loadJSONData();
  });
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const scenes = window.customScenes || [];
    let i = scenes.findIndex((s) => s && s.id === 'L03');
    if (i < 0) i = scenes.findIndex((s) => s && /蝴蝶|Butterfly/i.test(String(s.name || '')));
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
    if (window.showAnnotations !== true && typeof window.toggleAnnotations === 'function') {
      window.toggleAnnotations();
    }
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outDir, 'L03-annotated-full.png') });
  await page.screenshot({ path: path.join(outDir, 'L03-annotated-crop.png'), clip: crop });

  await page.evaluate(() => {
    if (window.showAnnotations !== false && typeof window.toggleAnnotations === 'function') {
      window.toggleAnnotations();
    }
  });
  await page.waitForTimeout(300);
  const thumb = await page.screenshot({
    type: 'jpeg',
    quality: 72,
    clip: { x: crop.x + 20, y: crop.y + 20, width: 700, height: 700 }
  });
  const f2 = loadPref('203_');
  f2.data.thumbnail = 'data:image/jpeg;base64,' + thumb.toString('base64');
  f2.data.id = 'L03';
  fs.writeFileSync(f2.full, JSON.stringify(f2.data) + '\n');
  rebuild();

  console.log('OUT', outDir);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
