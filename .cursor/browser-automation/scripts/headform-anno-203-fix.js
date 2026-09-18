/**
 * 203-fix：只标画面上真实可见的明暗交界
 * 保留：鼻下蝶影 3-2-4（重编号）、眶上缘 A/B、下唇下影、颏底影
 * 删除：中线亮面假交界 1/5/6/7 及 2-5-6-7 虚线
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-headform-203-fix`);
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

const DETAIL = '正前略高：鼻下留下对称的蝶形影；脸左右明暗较均衡。';

const KEY_POINTS = `本场景只看正前略高这一档光线下，明暗交界怎么走。交界主要跟「光线和头的夹角」有关，和我们观察的角度无关——你可以转动场景，换几个角度看这些交界，以及圆标钉住的那些结构。

请不要改变当前光线的方向、高低等参数，因为这会影响本场景的教学观感。如有误改，点「重置」把光（和本场景默认状态）恢复即可。

先看表象：光线几乎正对脸、略抬高时，左右颊大体都还亮；真正抢眼的是几条「横着走」的交界——鼻下一块左右对称的影（像蝴蝶），再加上眉弓投下的眶内暗、下唇投下的颏唇沟暗、颏底投下的颈上暗。这就是摄影里常说的「蝴蝶光」。若一侧已经大暗还出现三角亮，更接近「伦勃朗」；若鼻旁小影偏在一侧、未对称，更接近「环形」。

注意：正中的人中、唇珠一带此刻多半仍是亮面，那里没有竖着的明暗交界——本场景不把中线当交界来标。

明暗交界从哪来？圆标钉在交界经过的结构点（或线位）上；曲线只串真实交界。交界出现是因为有结构起伏；看见对称蝶影与眶内暗，也能反推鼻底、眉弓的起伏。

点位(或线位)名称如下：

【主线 · 鼻下蝶影交界】
①.鼻头下缘（蝶影上缘中点）
②.左鼻翼缘（蝶影左翼）
③.右鼻翼缘（蝶影右翼）

【支线1 · 眶】
A.左眶上缘交界（眉弓投下的眶内暗上缘）
B.右眶上缘交界

【支线2 · 下唇下影】
④.颏唇沟交界（下唇投下的暗带上缘）

【支线3 · 颏底】
⑤.颏底交界（颏底投下的颈上暗上缘）

可点击操作面板上的眼睛图标来隐藏标注，更干净地观察明暗交界线。`;

// 只钉真实交界；prefer 控制左右/中
const SPECS = [
  // 蝶影：上缘中与两翼（略偏下贴影缘）
  { id: '1', text: '1', color: '#bfbfbf', target: { x: 0.0, y: 0.118, z: 0.092 }, box: [0.44, 0.56, 0.5, 0.58], dx: 0, dy: 50, prefer: 'center' },
  { id: '2', text: '2', color: '#bfbfbf', target: { x: -0.018, y: 0.12, z: 0.086 }, box: [0.38, 0.48, 0.48, 0.57], dx: -78, dy: 8, prefer: 'negX' },
  { id: '3', text: '3', color: '#bfbfbf', target: { x: 0.018, y: 0.12, z: 0.086 }, box: [0.52, 0.62, 0.48, 0.57], dx: 78, dy: 8, prefer: 'posX' },
  // 眶上缘交界
  { id: 'A', text: 'A', color: '#197657', target: { x: -0.028, y: 0.176, z: 0.068 }, box: [0.36, 0.48, 0.34, 0.46], dx: -72, dy: -18, prefer: 'negX' },
  { id: 'B', text: 'B', color: '#197657', target: { x: 0.028, y: 0.176, z: 0.068 }, box: [0.52, 0.64, 0.34, 0.46], dx: 72, dy: -18, prefer: 'posX' },
  // 颏唇沟交界（下唇下影上缘）
  { id: '4', text: '4', color: '#bfbfbf', target: { x: 0.0, y: 0.078, z: 0.082 }, box: [0.44, 0.56, 0.6, 0.7], dx: 70, dy: 20, prefer: 'center' },
  // 颏底交界
  { id: '5', text: '5', color: '#bfbfbf', target: { x: 0.0, y: 0.045, z: 0.055 }, box: [0.42, 0.58, 0.7, 0.84], dx: 0, dy: 55, prefer: 'center' }
];

async function forceRaster(page) {
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
      if (/^(正在计算光影|首帧渲染中|即将完成|正在加载)/.test(t) && t.length < 40) hide(el);
    });
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
    await page.waitForTimeout(350);
  }
  return 0;
}

function bezSeg(id, a, b, color) {
  if (!a || !b) return null;
  return {
    id,
    color: color || '#7a7a7a',
    kind: 'bezier',
    strokeWidth: 2.5,
    capR: 1,
    points: [
      {
        pos: [...a.localPos],
        norm: [...a.localNormal],
        handleOut: [
          (b.localPos[0] - a.localPos[0]) * 0.22,
          (b.localPos[1] - a.localPos[1]) * 0.22,
          (b.localPos[2] - a.localPos[2]) * 0.15
        ]
      },
      {
        pos: [...b.localPos],
        norm: [...b.localNormal],
        handleIn: [
          (a.localPos[0] - b.localPos[0]) * 0.22,
          (a.localPos[1] - b.localPos[1]) * 0.22,
          (a.localPos[2] - b.localPos[2]) * 0.15
        ]
      }
    ]
  };
}

(async () => {
  const file0 = load203();
  file0.data.id = 'L03';
  file0.data.meta = Object.assign({}, file0.data.meta, {
    line: 'light',
    slot: 'L03',
    status: 'seeded',
    detail: DETAIL,
    keyPoints: KEY_POINTS
  });
  // 先清空错误虚线，保留光/相机/裁切
  file0.data.items[0].dashedLines = [];
  file0.data.items[0].annotations = [];
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
  await page.waitForTimeout(2800);
  for (let k = 0; k < 7; k++) {
    await forceRaster(page);
    await page.waitForTimeout(300);
  }

  const crop = await page.evaluate(() => {
    const s = (window.customScenes || []).find((x) => x && (x.id === 'L03' || /蝴蝶/.test(String(x.name || ''))));
    const c = (s && s.crop) || {};
    return {
      x: parseFloat(c.left) || 260,
      y: parseFloat(c.top) || 70,
      width: Math.min(760, parseFloat(c.width) || 760),
      height: 720
    };
  });

  await page.evaluate(() => {
    if (window.showAnnotations !== false && typeof window.toggleAnnotations === 'function') window.toggleAnnotations();
  });
  await forceRaster(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outDir, 'L03-light-only.png'), clip: crop });

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
      if (prefer === 'negX') return x < -0.006;
      if (prefer === 'posX') return x > 0.006;
      if (prefer === 'center') return Math.abs(x) < 0.02;
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
          if (lp.z < 0.03) continue;
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
      let nWorld = new THREE.Vector3(0, 0.05, 0.9);
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
          xyz: [+best.x.toFixed(3), +best.y.toFixed(3), +best.z.toFixed(3)],
          d: +best.d.toFixed(3),
          uv: [+best.u.toFixed(3), +best.v.toFixed(3)]
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
  const dashedLines = [];
  // 只串蝶影真实交界：2—1—3
  const wL = bezSeg('dash_l03_bfly_L', by['2'], by['1']);
  const wR = bezSeg('dash_l03_bfly_R', by['1'], by['3']);
  if (wL) dashedLines.push(wL);
  if (wR) dashedLines.push(wR);
  // 眶：左右各自短线（用单点不够，加眉弓邻点会过密；先不连假线）
  // 下唇下影 / 颏底：单点指认即可，不强行连成中线

  const file = load203();
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

  await page.evaluate(() => {
    if (window.loadJSONData) window.loadJSONData();
  });
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const scenes = window.customScenes || [];
    let i = scenes.findIndex((s) => s && s.id === 'L03');
    if (i < 0) i = scenes.findIndex((s) => s && /蝴蝶/.test(String(s.name || '')));
    window.currentSceneIndex = -1;
    window.switchScene(i);
  });
  await waitMeshes(page);
  await page.waitForTimeout(2200);
  for (let k = 0; k < 6; k++) {
    await forceRaster(page);
    await page.waitForTimeout(280);
  }
  await page.evaluate(() => {
    if (window.showAnnotations !== true && typeof window.toggleAnnotations === 'function') window.toggleAnnotations();
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outDir, 'L03-annotated-full.png') });
  await page.screenshot({ path: path.join(outDir, 'L03-annotated-crop.png'), clip: crop });

  await page.evaluate(() => {
    if (window.showAnnotations !== false && typeof window.toggleAnnotations === 'function') window.toggleAnnotations();
  });
  await page.waitForTimeout(300);
  const thumb = await page.screenshot({
    type: 'jpeg',
    quality: 72,
    clip: { x: crop.x + 30, y: crop.y + 30, width: 700, height: 700 }
  });
  const f2 = load203();
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
