/**
 * 107：顶视 · 外轮廓打底
 * 经验（来自 106 手调）：远摄收紧；点位宜少；场景说明面向学员（不写虚线/柔光等制作备注）
 * 主课：顶视看见颅顶最大范围（常近似前窄后宽的五边形感）
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-headform-107`);
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

function seed107() {
  const src = loadFile('102_');
  const dst = loadFile('107_');
  const d = JSON.parse(JSON.stringify(src.data));
  d.id = 'V07';
  d.name = '【视角】顶视 · 外轮廓';
  // 真顶视：高机位 + 远摄收紧（对齐 106 手调习惯）
  d.camera = {
    pos: [0.12, 12.8, 0.35],
    target: [0.0, 0.95, 0.0],
    zoom: 0.56,
    fov: 6
  };
  d.light = {
    type: 'point',
    azimuth: 90,
    elevation: 55,
    distance: 18,
    temp: 34,
    size: 26,
    intensity: 2.0
  };
  d.env = d.env || {};
  d.env.hasWall = false;
  d.env.defaultMat = 'origin';
  d.env.skyLightScale = 0.88;
  d.env.groundColor = '#bdb8b0';
  d.env.skyColor = '#0d0d0f';
  d.crop = {
    display: 'block',
    left: '500px',
    top: '100px',
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
    slot: 'V07',
    status: 'wip',
    detail: '顶视一眼看见颅顶最大范围：前窄后宽，左右颅侧最外。盯外缘怎么围成一圈。',
    keyPoints: '【打底中】'
  };
  // clear 102 thumbnail until we capture
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

async function openV07(page) {
  await page.evaluate(() => {
    const m = document.getElementById('scene-grid-modal');
    if (m) m.style.display = 'none';
    let i = (window.customScenes || []).findIndex((s) => s && s.id === 'V07');
    if (i < 0) i = (window.customScenes || []).findIndex((s) => s && String(s.name || '').includes('顶视'));
    if (i < 0) throw new Error('V07 not found');
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

    // 顶视：外轮廓 = 画面上最外缘命中（按方向取）
    function rimAtAngle(deg, u0, v0, steps) {
      const rad = (deg * Math.PI) / 180;
      const du = Math.cos(rad);
      const dv = -Math.sin(rad); // screen v down
      let best = null;
      for (let t = 0.02; t < 0.48; t += 0.006) {
        const u = u0 + du * t;
        const v = v0 + dv * t;
        if (u < 0.05 || u > 0.95 || v < 0.05 || v > 0.95) break;
        const hit = hitAt(u, v);
        if (!hit) {
          if (best) break;
          continue;
        }
        _lp.copy(hit.point);
        root.worldToLocal(_lp);
        best = { u, v, hit, x: _lp.x, y: _lp.y, z: _lp.z, t };
      }
      return best;
    }

    // 中心大致在头顶
    const u0 = 0.5;
    const v0 = 0.48;
    // 1 前额缘（朝 +z / 画面偏下或上？顶视时脸朝下侧常在画面下方）
    // 先探测：比较若干方向的 y（头顶高）与 z
    const probes = [];
    for (let deg = 0; deg < 360; deg += 15) {
      const s = rimAtAngle(deg, u0, v0);
      if (s) probes.push({ deg, ...s });
    }
    if (probes.length < 4) {
      return { ok: false, annotations: [], debug: { probes }, hitLabels: [] };
    }

    // 按 local：前缘取高 y 且偏前（避开鼻尖），后=最小 z，左/右=最外 x
    const high = probes.filter((p) => p.y >= 0.2);
    function extreme(list, scoreFn) {
      let best = null;
      for (const p of list) {
        if (!best || scoreFn(p) > scoreFn(best)) best = p;
      }
      return best;
    }
    const front = extreme(high.length ? high : probes, (p) => p.z + p.y * 0.35);
    const back = extreme(probes, (p) => -p.z);
    const left = extreme(probes, (p) => -p.x);
    const right = extreme(probes, (p) => p.x);

    // 少点口径（对齐 106）：前、左颅侧、右颅侧、枕后 —— 一眼看出最大范围
    const picks = [
      { id: '1', name: '额结节（前缘）', s: front, dx: 0, dy: 78 },
      { id: '2', name: '颅侧结节（左）', s: left, dx: -108, dy: -8 },
      { id: '3', name: '颅侧结节（右）', s: right, dx: 96, dy: -8 },
      { id: '4', name: '枕后突隆', s: back, dx: 0, dy: -86 }
    ];

    function toAnno(text, color, dx, dy, hit, id) {
      const world = hit.point.clone();
      const localPos = root.worldToLocal(world.clone());
      let nWorld = new THREE.Vector3(0, 1, 0);
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
    const used = new Set();
    for (const c of picks) {
      if (!c.s || !c.s.hit) continue;
      const key = c.s.u.toFixed(3) + ',' + c.s.v.toFixed(3);
      if (used.has(key)) continue;
      used.add(key);
      annotations.push(toAnno(c.id, '#00e8e8', c.dx, c.dy, c.s.hit, 'anno_v07_' + c.id));
      placed.push({
        text: c.id,
        name: c.name,
        deg: c.s.deg,
        u: +c.s.u.toFixed(3),
        v: +c.s.v.toFixed(3),
        x: +c.s.x.toFixed(3),
        y: +c.s.y.toFixed(3),
        z: +c.s.z.toFixed(3)
      });
    }

    return {
      ok: annotations.length >= 3,
      annotations,
      debug: {
        placed,
        probeCount: probes.length,
        extremes: {
          front: front && { z: +front.z.toFixed(3), deg: front.deg },
          back: back && { z: +back.z.toFixed(3), deg: back.deg },
          left: left && { x: +left.x.toFixed(3), deg: left.deg },
          right: right && { x: +right.x.toFixed(3), deg: right.deg }
        }
      },
      hitLabels: annotations.map((a) => a.text)
    };
  });
}

async function main() {
  console.log('agg', seed107());
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(120000);
  await boot(page);
  await openV07(page);
  await page.screenshot({ path: path.join(outDir, 'V07-clean.png') });

  const p = await pick(page);
  fs.writeFileSync(path.join(outDir, 'V07-pick.json'), JSON.stringify(p, null, 2));
  console.log('placed', JSON.stringify(p.debug, null, 2));
  if (!p.ok) throw new Error('pick fail ' + JSON.stringify(p.hitLabels));

  const keyPoints = [
    '顶视是认识颅顶「最大范围」的视角：从上往下看，头的外缘常接近前窄后宽的一圈（书里常说近似五边形感）。如果您不小心转动了视角，请点击重置按钮恢复视角。',
    '本关只看外轮廓：盯画面外缘这一圈怎么围住——前额、两侧最宽处、后枕，各在什么位置。',
    '请看场景中的标注，1–4 是轮廓上的重要点位。',
    '实际中每个人宽窄前后略有不同，创作时先有这些点位的框架，再按个体强化、弱化或省略。',
    '',
    '点位名称如下：',
    '1.额结节（前缘）',
    '2.颅侧结节（左）',
    '3.颅侧结节（右）',
    '4.枕后突隆'
  ].join('\n');

  const f = loadFile('107_');
  f.data.items[0].annotations = p.annotations;
  f.data.items[0].dashedLines = [];
  f.data.meta.status = 'wip';
  f.data.meta.detail = '顶视一眼看见颅顶最大范围：前窄后宽，左右颅侧最外。盯外缘怎么围成一圈。';
  f.data.meta.keyPoints = keyPoints;
  fs.writeFileSync(f.full, JSON.stringify(f.data) + '\n');
  console.log('merged', rebuildAggregate());

  await boot(page);
  await openV07(page);
  await page.evaluate(() => {
    window.showAnnotations = true;
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(outDir, 'V07-annotated-full.png') });
  console.log('OUT', outDir);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
