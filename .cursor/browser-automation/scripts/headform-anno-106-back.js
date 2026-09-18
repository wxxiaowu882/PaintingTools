/**
 * 106：背面 · 外轮廓打底
 * - 正背面；柔光照亮后脑
 * - 左缘钉后脑—耳后—颈后（localZ 偏负）；对照正面前后相离
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-headform-106-back`);
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

function seed106() {
  const src = loadFile('102_');
  const dst = loadFile('106_');
  const d = JSON.parse(JSON.stringify(src.data));
  d.id = 'V06';
  d.name = '【视角】背面 · 外轮廓';
  // 正背面略偏，让左缘剪影更清楚（仍是背面课）
  d.camera = {
    pos: [0.55, 1.02, -5.5],
    target: [0.0, 0.86, -0.02],
    zoom: 0.56,
    fov: 16
  };
  d.light = {
    type: 'point',
    azimuth: 270,
    elevation: 28,
    distance: 16,
    temp: 34,
    size: 24,
    intensity: 2.0
  };
  d.env = d.env || {};
  d.env.hasWall = false;
  d.env.defaultMat = 'origin';
  d.env.skyLightScale = 0.82;
  d.env.groundColor = '#bdb8b0';
  d.env.skyColor = '#0d0d0f';
  d.crop = {
    display: 'block',
    left: '500px',
    top: '110px',
    width: '720px',
    height: '720px'
  };
  if (!d.items || !d.items[0]) {
    d.items = [
      {
        type: 'glb',
        url: '/docs/model/石膏头像_男中青年_大本 蝙蝠侠 布鲁斯韦恩_头像_opt.glb',
        pos: [0, 0, 0],
        rot: [0, 0, 0],
        scale: [5.8, 5.8, 5.8],
        mat: 'origin',
        annotations: []
      }
    ];
  }
  d.items[0].annotations = [];
  d.items[0].dashedLines = [];
  d.meta = {
    line: 'viewpoint',
    slot: 'V06',
    status: 'wip',
    detail:
      '背面·外轮廓。正背面；柔光照后脑；主钉后脑—耳后—颈后；与正面前后相离；不连虚线。',
    keyPoints: '【打底中】背面外轮廓与正面前后相离。'
  };
  fs.writeFileSync(dst.full, JSON.stringify(d) + '\n');
  console.log('seeded', dst.f, d.camera);
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

async function openV06(page) {
  await page.evaluate(() => {
    const m = document.getElementById('scene-grid-modal');
    if (m) m.style.display = 'none';
    let i = (window.customScenes || []).findIndex((s) => s && s.id === 'V06');
    if (i < 0) i = (window.customScenes || []).findIndex((s) => s && String(s.name || '').includes('背面'));
    if (i < 0) throw new Error('V06 not found');
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
  await page.waitForTimeout(1400);
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

    // 背面：取画面左缘（最小 u）且 localZ 偏后，避开脸
    function backLeft(v, zMax) {
      let best = null;
      for (let u = 0.18; u <= 0.55; u += 0.005) {
        const hit = hitAt(u, v);
        if (!hit) continue;
        _lp.copy(hit.point);
        root.worldToLocal(_lp);
        if (_lp.z > zMax) continue;
        if (!best || u < best.u) best = { u, hit, x: _lp.x, y: _lp.y, z: _lp.z, v };
      }
      return best;
    }

    function bestInBand(v0, v1, zMax, mode) {
      let best = null;
      for (let v = v0; v <= v1; v += 0.012) {
        const s = backLeft(v, zMax);
        if (!s) continue;
        const rec = { ...s, v: +v.toFixed(3) };
        if (!best) best = rec;
        else if (mode === 'leftmost' && rec.u < best.u) best = rec;
        else if (mode === 'highestY' && rec.y > best.y) best = rec;
        else if (mode === 'lowestY' && rec.y < best.y) best = rec;
      }
      return best;
    }

    function midRecess(a, b, zMax) {
      if (!a || !b) return null;
      const v0 = Math.min(a.v, b.v);
      const v1 = Math.max(a.v, b.v);
      let best = null;
      for (let v = v0 + 0.02; v < v1 - 0.02; v += 0.012) {
        const s = backLeft(v, zMax);
        if (!s) continue;
        // 凹：比相邻凸更靠内（u 更大）
        if (!best || s.u > best.u) best = { ...s, v: +v.toFixed(3) };
      }
      return best;
    }

    // 略放宽 z，让耳后/下颌角后能进左缘
    const c1 = bestInBand(0.14, 0.26, 0.0, 'highestY');
    const c2 = bestInBand(0.28, 0.4, -0.02, 'leftmost');
    const c3 = bestInBand(0.42, 0.52, 0.02, 'leftmost');
    const c4 = bestInBand(0.54, 0.64, 0.04, 'leftmost');
    const c5 = bestInBand(0.66, 0.8, 0.06, 'lowestY');
    const a1 = midRecess(c1, c2, 0.0);
    const a2 = midRecess(c2, c3, 0.0);
    const a3 = midRecess(c3, c4, 0.03);

    function toAnno(text, color, dx, dy, hit, id) {
      const world = hit.point.clone();
      const localPos = root.worldToLocal(world.clone());
      let nWorld = new THREE.Vector3(-0.4, 0.1, -0.9);
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

    const annotations = [];
    const placed = [];
    const convex = [
      { id: '1', name: '颅顶结节', s: c1, dx: -96, dy: -30 },
      { id: '2', name: '枕后突隆', s: c2, dx: -108, dy: -6 },
      { id: '3', name: '耳后转折', s: c3, dx: -112, dy: 12 },
      { id: '4', name: '下颌角后缘', s: c4, dx: -108, dy: 28 },
      { id: '5', name: '胸锁乳突肌侧缘', s: c5, dx: -100, dy: 46 }
    ];
    convex.forEach((c) => {
      if (!c.s || !c.s.hit) return;
      annotations.push(toAnno(c.id, '#00e8e8', c.dx, c.dy, c.s.hit, 'anno_v06_' + c.id));
      placed.push({
        text: c.id,
        name: c.name,
        u: +c.s.u.toFixed(3),
        v: c.s.v,
        x: +c.s.x.toFixed(3),
        y: +c.s.y.toFixed(3),
        z: +c.s.z.toFixed(3)
      });
    });
    const concave = [
      { id: 'A', name: '顶枕之间内收', s: a1, dx: -72, dy: -18 },
      { id: 'B', name: '枕耳之间内收', s: a2, dx: -74, dy: 4 },
      { id: 'C', name: '耳颌之间内收', s: a3, dx: -76, dy: 20 }
    ];
    concave.forEach((c) => {
      if (!c.s || !c.s.hit) return;
      annotations.push(toAnno(c.id, '#d6d6d6', c.dx, c.dy, c.s.hit, 'anno_v06_' + c.id));
      placed.push({
        text: c.id,
        name: c.name,
        u: +c.s.u.toFixed(3),
        v: c.s.v,
        x: +c.s.x.toFixed(3),
        y: +c.s.y.toFixed(3),
        z: +c.s.z.toFixed(3)
      });
    });

    return {
      ok: annotations.filter((a) => /^[1-5]$/.test(a.text)).length >= 4,
      annotations,
      debug: { placed },
      hitLabels: annotations.map((a) => a.text)
    };
  });
}

async function main() {
  console.log('agg', seed106());
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(120000);
  await boot(page);
  await openV06(page);
  await page.screenshot({ path: path.join(outDir, 'V06-clean.png') });

  const p = await pick(page);
  fs.writeFileSync(path.join(outDir, 'V06-pick.json'), JSON.stringify(p, null, 2));
  console.log('placed', JSON.stringify(p.debug && p.debug.placed, null, 2));
  if (!p.ok) throw new Error('pick fail ' + JSON.stringify(p.hitLabels));

  const keyPoints = [
    '背面是认识「前后相离」的关键一课：同一颗头，正面外轮廓与背面外轮廓不是简单翻面，后脑—耳后—颈后走出另一条线。如果您不小心转动了视角，请点击重置按钮恢复视角。',
    '本关只看外轮廓：盯画面左缘这条后脑剪影怎么走；可与正面对照，体会前后不一样。',
    '请看场景中的标注，1–5 是轮廓上的凸起，A–C 是较重要的凹陷（不凑数）。',
    '实际中每个人凹凸强弱不同，创作时先有这些点位的框架，再按个体强化、弱化或省略。',
    '',
    '点位名称如下：',
    '1.颅顶结节',
    '2.枕后突隆',
    '3.耳后转折',
    '4.下颌角后缘',
    '5.胸锁乳突肌侧缘',
    'A.顶枕之间内收',
    'B.枕耳之间内收',
    'C.耳颌之间内收'
  ].join('\n');

  const f = loadFile('106_');
  f.data.items[0].annotations = p.annotations;
  f.data.items[0].dashedLines = [];
  f.data.meta.status = 'wip';
  f.data.meta.detail =
    '背面·外轮廓。正背面；柔光照后脑；主钉后脑—耳后—颈后；与正面前后相离；不连虚线。';
  f.data.meta.keyPoints = keyPoints;
  fs.writeFileSync(f.full, JSON.stringify(f.data) + '\n');
  console.log('merged', rebuildAggregate());

  await boot(page);
  await openV06(page);
  await page.evaluate(() => {
    window.showAnnotations = true;
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(outDir, 'V06-annotated-full.png') });
  console.log('OUT', outDir);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
