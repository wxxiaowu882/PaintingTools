/**
 * 201：侧前略高 · 环形明暗（Loop）重做
 * 对齐视角关做法：crop、圆标编号、学员向文案、AI 视觉验收环影未接颊影
 * 光位备忘：Solid 90=正前，0=左侧；Loop 取侧前略高（约 az 45–55 / el 30–36）
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-headform-201`);
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:18080';
fs.mkdirSync(outDir, { recursive: true });

function loadFile(prefix) {
  const f = fs.readdirSync(jsonDir).find((n) => n.startsWith(prefix) && n.endsWith('.json'));
  if (!f) throw new Error('missing ' + prefix);
  const full = path.join(jsonDir, f);
  return { f, full, data: JSON.parse(fs.readFileSync(full, 'utf8')) };
}

function rebuildAggregate() {
  const files = fs
    .readdirSync(jsonDir)
    .filter((fn) => /^\d+[A-Za-z]?_.+\.json$/i.test(fn))
    .sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));
  const merged = files.map((fn) => JSON.parse(fs.readFileSync(path.join(jsonDir, fn), 'utf8')));
  fs.writeFileSync(path.join(jsonDir, '沙盒_头部造型规律.json'), JSON.stringify(merged) + '\n');
  return merged.length;
}

function seed201(lightOverride) {
  const src = loadFile('103_'); // 大半侧取景基底，脸侧信息够看环影
  const dst = loadFile('201_');
  const d = JSON.parse(JSON.stringify(src.data));
  d.id = 'L01';
  d.name = '【光位】侧前略高 · 环形明暗（Loop）';
  // 略侧前取景：能看见鼻旁环影与颊影是否相接
  d.camera = {
    pos: [2.85, 0.95, 5.35],
    target: [-0.02, 0.88, 0.04],
    zoom: 0.58,
    fov: 15
  };
  // 左侧前略高：az≈48（0=左 90=正前），el≈32；size 中等——太软看不清环，太硬不像日常
  d.light = Object.assign(
    {
      type: 'point',
      azimuth: 48,
      elevation: 32,
      distance: 15,
      temp: 34,
      size: 11,
      intensity: 2.15
    },
    lightOverride || {}
  );
  d.env = d.env || {};
  d.env.hasWall = false;
  d.env.defaultMat = 'origin';
  d.env.skyLightScale = 0.55; // 略压环境，让主光环影更清楚
  d.env.groundColor = '#bdb8b0';
  d.env.skyColor = '#0d0d0f';
  d.crop = {
    display: 'block',
    left: '500px',
    top: '110px',
    width: '720px',
    height: '720px'
  };
  d.items[0].annotations = [];
  d.items[0].dashedLines = [];
  d.meta = {
    line: 'light',
    slot: 'L01',
    status: 'wip',
    detail: '侧前略高的日常光：鼻旁一小圈影，还没接到颊上的大阴影。',
    keyPoints: '【打底中】'
  };
  fs.writeFileSync(dst.full, JSON.stringify(d) + '\n');
  console.log('seeded', dst.f, d.camera, d.light);
  return rebuildAggregate();
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

async function openL01(page) {
  await page.evaluate(() => {
    const m = document.getElementById('scene-grid-modal');
    if (m) m.style.display = 'none';
    let i = (window.customScenes || []).findIndex((s) => s && s.id === 'L01');
    if (i < 0) i = (window.customScenes || []).findIndex((s) => s && String(s.name || '').includes('环形'));
    if (i < 0) throw new Error('L01 not found');
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
    if (n > 0) break;
    await page.waitForTimeout(400);
  }
  await page.evaluate(() => {
    const el = document.getElementById('scene-loader');
    if (el) el.style.display = 'none';
    const m = document.getElementById('scene-grid-modal');
    if (m) m.style.display = 'none';
    window.showAnnotations = true;
  });
  await page.waitForTimeout(1600);
}

async function pickLoop(page) {
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

    function bestInBox(u0, u1, v0, v1, preferFn) {
      let best = null;
      let bestScore = -1e9;
      for (let v = v0; v <= v1; v += 0.012) {
        for (let u = u0; u <= u1; u += 0.01) {
          const hit = hitAt(u, v);
          if (!hit) continue;
          _lp.copy(hit.point);
          root.worldToLocal(_lp);
          const score = preferFn(_lp, u, v);
          if (score > bestScore) {
            bestScore = score;
            best = { u, v, hit, x: _lp.x, y: _lp.y, z: _lp.z };
          }
        }
      }
      return best;
    }

    // 取景：头略朝左；光从左前 → 环影多在鼻梁右侧（画面中偏右鼻侧）
    const bright = bestInBox(0.38, 0.55, 0.28, 0.42, (p) => p.z * 2 + p.y); // 额/近侧亮面
    const loop = bestInBox(0.48, 0.62, 0.38, 0.52, (p) => p.z * 3 - Math.abs(p.x - 0.02)); // 鼻旁
    const cheek = bestInBox(0.58, 0.72, 0.4, 0.55, (p) => p.x * 2 + p.z); // 远颊暗部（未接环影）

    function toAnno(text, color, dx, dy, hit, id) {
      const world = hit.point.clone();
      const localPos = root.worldToLocal(world.clone());
      let nWorld = new THREE.Vector3(0, 0.2, 1);
      if (hit.face && hit.face.normal) {
        nWorld = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
      }
      const localNormal = root
        .worldToLocal(world.clone().add(nWorld))
        .sub(localPos.clone())
        .normalize();
      return {
        id,
        annotationKind: 'leader',
        text,
        detailText: '',
        collapsed: false,
        color,
        dx,
        dy,
        dxN: 0,
        dyN: 0,
        dxW: 0,
        dyW: 0,
        localPos: [Number(localPos.x.toFixed(4)), Number(localPos.y.toFixed(4)), Number(localPos.z.toFixed(4))],
        localNormal: [
          Number(localNormal.x.toFixed(3)),
          Number(localNormal.y.toFixed(3)),
          Number(localNormal.z.toFixed(3))
        ],
        baseDist: Number(hit.distance.toFixed(4)),
        baseScale: root.scale && root.scale.x ? Number(root.scale.x) : 5.8,
        occludeDot: -0.35,
        labelShape: 'circle'
      };
    }

    const picks = [
      { id: '1', name: '亮面', s: bright, color: '#00e8e8', dx: -88, dy: -28 },
      { id: '2', name: '鼻侧环影', s: loop, color: '#00e8e8', dx: 72, dy: -8 },
      { id: '3', name: '颊影（未接环影）', s: cheek, color: '#00e8e8', dx: 90, dy: 18 }
    ];
    const annotations = [];
    const placed = [];
    for (const c of picks) {
      if (!c.s || !c.s.hit) continue;
      annotations.push(toAnno(c.id, c.color, c.dx, c.dy, c.s.hit, 'anno_l01_' + c.id));
      placed.push({
        text: c.id,
        name: c.name,
        u: +c.s.u.toFixed(3),
        v: +c.s.v.toFixed(3),
        x: +c.s.x.toFixed(3),
        y: +c.s.y.toFixed(3),
        z: +c.s.z.toFixed(3)
      });
    }
    return { ok: annotations.length >= 3, annotations, debug: { placed }, hitLabels: annotations.map((a) => a.text) };
  });
}

async function main() {
  const lightOverride = process.env.LIGHT_JSON ? JSON.parse(process.env.LIGHT_JSON) : null;
  console.log('agg', seed201(lightOverride));

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(120000);
  await boot(page);
  await openL01(page);
  await page.screenshot({ path: path.join(outDir, 'L01-clean.png') });

  const p = await pickLoop(page);
  fs.writeFileSync(path.join(outDir, 'L01-pick.json'), JSON.stringify(p, null, 2));
  console.log('placed', JSON.stringify(p.debug && p.debug.placed, null, 2));
  if (!p.ok) throw new Error('pick fail ' + JSON.stringify(p.hitLabels));

  const keyPoints = [
    '本关只看光：侧前略高的环形明暗（Loop）——日常肖像里很常见的一小圈鼻旁影。如果您不小心转动了视角，请点击重置按钮恢复视角。',
    '先找鼻旁那一小圈影：它还没有接到颊上的大阴影。若接到了，就更接近下一关「伦勃朗」。',
    '请看场景中的标注：1 是仍大的亮面，2 是鼻侧环影，3 是颊上的阴影（与环影分开）。',
    '实际中光再侧一点、再高一点，环影就会变长、变接；本关先认准「未接」这一档。',
    '',
    '点位名称如下：',
    '1.亮面',
    '2.鼻侧环影',
    '3.颊影（未接环影）'
  ].join('\n');

  const f = loadFile('201_');
  f.data.items[0].annotations = p.annotations;
  f.data.items[0].dashedLines = [];
  f.data.meta.status = 'wip';
  f.data.meta.detail = '侧前略高的日常光：鼻旁一小圈影，还没接到颊上的大阴影。';
  f.data.meta.keyPoints = keyPoints;
  fs.writeFileSync(f.full, JSON.stringify(f.data) + '\n');
  console.log('merged', rebuildAggregate());

  await boot(page);
  await openL01(page);
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(outDir, 'L01-annotated-full.png') });
  console.log('OUT', outDir);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
