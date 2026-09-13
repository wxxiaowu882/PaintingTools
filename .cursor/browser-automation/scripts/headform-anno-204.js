/**
 * 204 正侧 · 阴阳对半（Split）
 * - 风格仿 202：一条较长主交界 + 圆标钉结构点 + 贝塞尔串线
 * - 知识库正侧交界：额结节外侧—眉峰—眶外角—颧突隆—颏结节（书页约 120/121）
 * - 光近正侧（az≈0–15），正面取景读「一半亮一半暗」
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-headform-204`);
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
}

async function scrubUI(page) {
  await page.evaluate(() => {
    try {
      if (typeof window.stopRender === 'function') window.stopRender();
    } catch (e) {}
    window._solidUserStoppedRender = true;
    window.useAdvancedRender = false;
    window.perfTestDone = true;
    window.isLoadingScene = false;
    const hide = (el) => {
      if (!el) return;
      el.style.display = 'none';
      el.style.opacity = '0';
      el.style.visibility = 'hidden';
    };
    hide(document.getElementById('scene-loader'));
    hide(document.getElementById('perf-test-overlay'));
    document.querySelectorAll('body *').forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      const t = (el.textContent || '').trim();
      if (/^(正在计算光影|首帧渲染中|即将完成|正在加载|光影探针)/.test(t) && t.length < 50) hide(el);
    });
  });
}

async function waitMeshes(page) {
  for (let i = 0; i < 140; i++) {
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
    await page.waitForTimeout(350);
  }
  return 0;
}

const DETAIL = '正侧光：脸一半亮、一半暗；明暗交界沿着正侧面交界走得很长。';

const KEY_POINTS = `本场景只看正侧这一档光线下，明暗交界怎么走。交界主要跟「光线和头的夹角」有关——请转动场景，换角度看这条长交界和关键结构点。请不要在操作面板中改变光线相关的设置，否则会影响本场景的教学观感；若不小心改了光的方向等参数，点「重置」恢复即可。

先看表象：光线几乎从正侧面打来时，脸常是一半亮、一半暗——戏剧感很强的「阴阳对半」。交界大致贴着脸的「正面与侧面」交界走，从额侧一直通到颏侧，往往比「环形」「伦勃朗」更长、更直一些。若暗颊上还留着一块三角亮，更接近上一档「伦勃朗」；若鼻旁小影还没接到颊侧大暗，则更接近「环形」。

明暗交界线沿着重要结构点（或线）串起来；曲线勾出走向。知识上，正侧交界常经过：额结节外侧 → 眉峰 → 眶外角 → 颧突隆 → 颏结节。交界出现是因为有结构起伏；看见这条长交界怎么拐，也能反推正侧面大面交界。

各点位(或线位)名称如下：

【主交界线】（正侧长交界）
①.额结节外侧
②.眉峰
③.眶外角
④.颧突隆
⑤.口轮匝肌侧缘
⑥.颏结节
⑦.颏底

【支线 · 眼】
A.上眼睑交界
B.下眼睑上交界

可点击操作面板上的眼睛图标来隐藏标注，更干净地观察明暗交界线。`;

// 暗侧 −X：正侧交界结构点（比 202 更贴侧缘，不走鼻中）
const SPECS = [
  { id: '1', text: '1', color: '#bfbfbf', target: { x: -0.055, y: 0.22, z: 0.045 }, box: [0.28, 0.42, 0.22, 0.36], dx: -70, dy: -30, prefer: 'negX' },
  { id: '2', text: '2', color: '#bfbfbf', target: { x: -0.052, y: 0.195, z: 0.055 }, box: [0.28, 0.42, 0.3, 0.4], dx: -70, dy: -10, prefer: 'negX' },
  { id: '3', text: '3', color: '#bfbfbf', target: { x: -0.055, y: 0.17, z: 0.045 }, box: [0.26, 0.4, 0.36, 0.46], dx: -75, dy: 5, prefer: 'negX' },
  { id: '4', text: '4', color: '#bfbfbf', target: { x: -0.05, y: 0.14, z: 0.055 }, box: [0.28, 0.42, 0.44, 0.54], dx: -70, dy: 0, prefer: 'negX' },
  { id: '5', text: '5', color: '#bfbfbf', target: { x: -0.042, y: 0.1, z: 0.055 }, box: [0.3, 0.44, 0.54, 0.66], dx: -70, dy: 15, prefer: 'negX' },
  { id: '6', text: '6', color: '#bfbfbf', target: { x: -0.028, y: 0.065, z: 0.06 }, box: [0.34, 0.48, 0.64, 0.76], dx: -65, dy: 25, prefer: 'negX' },
  { id: '7', text: '7', color: '#bfbfbf', target: { x: -0.012, y: 0.045, z: 0.055 }, box: [0.38, 0.52, 0.72, 0.86], dx: -40, dy: 50, prefer: 'negX' },
  { id: 'A', text: 'A', color: '#197657', target: { x: -0.04, y: 0.175, z: 0.07 }, box: [0.32, 0.46, 0.34, 0.46], dx: 55, dy: -20, prefer: 'negX' },
  { id: 'B', text: 'B', color: '#197657', target: { x: -0.038, y: 0.16, z: 0.07 }, box: [0.32, 0.46, 0.4, 0.5], dx: 55, dy: 15, prefer: 'negX' }
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

(async () => {
  const chosen = {
    azimuth: Number(process.env.AZ || 10),
    elevation: Number(process.env.EL || 24),
    size: Number(process.env.SIZE || 10),
    intensity: Number(process.env.INT || 2.2),
    distance: 15
  };

  const src = loadPref('201_');
  const dst = loadPref('204_');
  const d = JSON.parse(JSON.stringify(src.data));
  d.id = 'L04';
  d.name = '【光位】正侧 · 阴阳对半（Split）';
  d.camera = {
    pos: [...(src.data.camera.pos || [-0.042, 1.089, 6.508])],
    target: [...(src.data.camera.target || [0, 0.82, 0.04])],
    zoom: src.data.camera.zoom || 0.58,
    fov: src.data.camera.fov || 14
  };
  d.camera.pos[0] = 0.02;
  d.light = {
    type: 'point',
    azimuth: chosen.azimuth,
    elevation: chosen.elevation,
    distance: chosen.distance,
    temp: 34,
    size: chosen.size,
    intensity: chosen.intensity
  };
  d.env = Object.assign({}, src.data.env, {
    lightIndicatorEnabled: false,
    skyLightScale: 0.45
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
    slot: 'L04',
    status: 'seeded',
    detail: DETAIL,
    keyPoints: KEY_POINTS
  };
  d.items[0].annotations = [];
  d.items[0].dashedLines = [];
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
    let i = scenes.findIndex((s) => s && s.id === 'L04');
    if (i < 0) i = scenes.findIndex((s) => s && /阴阳对半|Split/i.test(String(s.name || '')));
    window.currentSceneIndex = -1;
    window.switchScene(i);
  });
  console.log('meshes', await waitMeshes(page), 'light', chosen);
  await page.waitForTimeout(2800);
  for (let k = 0; k < 7; k++) {
    await scrubUI(page);
    await page.waitForTimeout(300);
  }

  const crop = await page.evaluate(() => {
    const s = (window.customScenes || []).find(
      (x) => x && (x.id === 'L04' || /阴阳对半|Split/i.test(String(x.name || '')))
    );
    const c = (s && s.crop) || {};
    return {
      x: parseFloat(c.left) || 450,
      y: parseFloat(c.top) || 90,
      width: Math.min(760, parseFloat(c.width) || 760),
      height: 720
    };
  });

  await page.evaluate(() => {
    if (window.showAnnotations !== false && typeof window.toggleAnnotations === 'function') window.toggleAnnotations();
  });
  await scrubUI(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outDir, 'L04-light-only.png'), clip: crop });

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
      if (prefer === 'negX') return x < -0.008;
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
          if (lp.z < 0.01) continue;
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
      let nWorld = new THREE.Vector3(-0.5, 0.1, 0.6);
      if (h.face && h.face.normal) {
        nWorld = h.face.normal.clone().transformDirection(h.object.matrixWorld).normalize();
      }
      const localNormal = root.worldToLocal(h.point.clone().add(nWorld)).sub(lp.clone()).normalize();
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
        baseDist: +h.distance.toFixed(4),
        baseScale: 5.8,
        occludeDot: -0.35,
        labelShape: 'circle',
        _dbg: {
          id: spec.id,
          xyz: [+best.x.toFixed(3), +best.y.toFixed(3), +best.z.toFixed(3)],
          d: +best.d.toFixed(3)
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
    console.warn(
      'incomplete',
      placed.dbg.filter((x) => !x.ok).map((x) => x.id)
    );
  }
  placed.annotations.forEach((a) => delete a._dbg);

  const by = Object.fromEntries(placed.annotations.map((a) => [a.text, a]));
  const chain = ['1', '2', '3', '4', '5', '6', '7'];
  const dashedLines = [];
  for (let i = 0; i < chain.length - 1; i++) {
    const seg = bezSeg('dash_l04_' + chain[i] + '_' + chain[i + 1], by[chain[i]], by[chain[i + 1]]);
    if (seg) dashedLines.push(seg);
  }
  // 眼支线 A/B 只钉点，不强行连线（避免假交界）

  const file = loadPref('204_');
  file.data.id = 'L04';
  file.data.items[0].annotations = placed.annotations;
  file.data.items[0].dashedLines = dashedLines;
  file.data.meta = Object.assign({}, file.data.meta, {
    line: 'light',
    slot: 'L04',
    status: 'seeded',
    detail: DETAIL,
    keyPoints: KEY_POINTS
  });
  fs.writeFileSync(file.full, JSON.stringify(file.data) + '\n');
  rebuild();

  await page.evaluate(() => {
    if (window.loadJSONData) window.loadJSONData();
  });
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const scenes = window.customScenes || [];
    let i = scenes.findIndex((s) => s && s.id === 'L04');
    if (i < 0) i = scenes.findIndex((s) => s && /阴阳对半|Split/i.test(String(s.name || '')));
    window.currentSceneIndex = -1;
    window.switchScene(i);
  });
  await waitMeshes(page);
  await page.waitForTimeout(2200);
  for (let k = 0; k < 6; k++) {
    await scrubUI(page);
    await page.waitForTimeout(280);
  }
  await page.evaluate(() => {
    if (window.showAnnotations !== true && typeof window.toggleAnnotations === 'function') window.toggleAnnotations();
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outDir, 'L04-annotated-full.png') });
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
  const f2 = loadPref('204_');
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
