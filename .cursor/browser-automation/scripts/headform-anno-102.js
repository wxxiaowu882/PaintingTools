/**
 * 102 正面·外轮廓：对齐 101 样例（圆标编号凸/凹，不连虚线）
 * 知识库正面头侧「W」：颅顶结节→颅侧结节→颧骨弓→颊转角→颏结节
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-headform-102`);
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:18080';
fs.mkdirSync(outDir, { recursive: true });

const MODEL = '/docs/model/石膏头像_男中青年_大本 蝙蝠侠 布鲁斯韦恩_头像_opt.glb';

function load102() {
  const f = fs.readdirSync(jsonDir).find((n) => n.startsWith('102_') && n.endsWith('.json'));
  const full = path.join(jsonDir, f);
  return { f, full, data: JSON.parse(fs.readFileSync(full, 'utf8')) };
}

function rebuildAggregate() {
  const files = fs
    .readdirSync(jsonDir)
    .filter((fn) => /^\d+_.+\.json$/i.test(fn))
    .sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));
  const merged = files.map((fn) => JSON.parse(fs.readFileSync(path.join(jsonDir, fn), 'utf8')));
  fs.writeFileSync(path.join(jsonDir, '沙盒_头部造型规律.json'), JSON.stringify(merged) + '\n');
  return merged.length;
}

// 先写入正面取景 + 模型（无标注），供页面加载
const file = load102();
file.data.camera = { pos: [0.05, 0.98, 6.1], target: [0, 0.92, 0], zoom: 0.58, fov: 16 };
file.data.light = {
  type: 'point',
  azimuth: 10,
  elevation: 26,
  distance: 16,
  temp: 34,
  size: 20,
  intensity: 2.1
};
file.data.env = {
  hasWall: false,
  defaultMat: 'origin',
  posterizeLevel: 0,
  wallColor: '#cccccc',
  groundColor: '#bdb8b0',
  skyColor: '#0d0d0f',
  skyLightScale: 0.7,
  atmosphere: { enabled: false, density: 0.02, type: 'basic', color: '#ffffff', p1: 0, p2: 0 },
  dof: { enabled: false, aperture: 2.8, focusDistance: 10 },
  lightIndicatorEnabled: false
};
file.data.crop = { display: 'none' };
file.data.items = [
  {
    type: 'glb',
    url: MODEL,
    pos: [0, 0, 0],
    rot: [0, 0, 0],
    scale: [5.8, 5.8, 5.8],
    mat: 'origin',
    annotations: [],
    dashedLines: []
  }
];
file.data.meta = {
  line: 'viewpoint',
  slot: 'V02',
  status: 'wip',
  detail: '正面·外轮廓。正立石膏头；左缘「W」转折凸凹编号（对齐 101 样例，不连虚线）。',
  keyPoints: '制作中…'
};
fs.writeFileSync(file.full, JSON.stringify(file.data, null, 2) + '\n');
rebuildAggregate();
console.log('framed', file.f);

async function waitReady(page) {
  await page.waitForFunction(() => {
    const el = document.getElementById('scene-loader');
    if (!el) return true;
    const st = getComputedStyle(el);
    return st.display === 'none' || Number(st.opacity || 1) < 0.05;
  }, null, { timeout: 180000 }).catch(() => {});
  await page.waitForTimeout(1600);
  await page.evaluate(() => {
    const el = document.getElementById('scene-loader');
    if (el) el.style.display = 'none';
    const m = document.getElementById('scene-grid-modal');
    if (m) m.style.display = 'none';
  });
}

async function openV02(page) {
  const idx = await page.evaluate(() => {
    return (window.customScenes || []).findIndex((s) => s && String(s.id) === 'V02');
  });
  if (idx < 0) throw new Error('V02 missing');
  await page.evaluate((i) => {
    window.currentSceneIndex = -1;
    window.switchScene(i);
  }, idx);
  await waitReady(page);
}

async function pickFront(page) {
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

    /** 正面左缘剪影（屏幕最左命中） */
    function leftEdge(v) {
      for (let u = 0.15; u <= 0.7; u += 0.002) {
        const hit = hitAt(u, v);
        if (!hit) continue;
        _lp.copy(hit.point);
        root.worldToLocal(_lp);
        // 偏好左侧（负 x）
        if (_lp.x > 0.02) continue;
        return { u, hit, x: _lp.x, y: _lp.y, z: _lp.z };
      }
      // 放宽：不要求负 x
      for (let u = 0.15; u <= 0.7; u += 0.002) {
        const hit = hitAt(u, v);
        if (!hit) continue;
        _lp.copy(hit.point);
        root.worldToLocal(_lp);
        return { u, hit, x: _lp.x, y: _lp.y, z: _lp.z };
      }
      return null;
    }

    const samples = [];
    for (let i = 0; i <= 100; i++) {
      const v = 0.16 + (0.78 - 0.16) * (i / 100);
      const s = leftEdge(v);
      if (s) samples.push({ v: +v.toFixed(4), u: +s.u.toFixed(4), x: +s.x.toFixed(4), y: +s.y.toFixed(4), z: +s.z.toFixed(4), hit: s.hit });
    }
    if (samples.length < 10) return { error: 'few samples', n: samples.length };

    // 外鼓：u 局部最小（更靠左）
    const bulges = [];
    for (let i = 4; i < samples.length - 4; i++) {
      const a = samples[i];
      let ok = true;
      for (let k = i - 3; k <= i + 3; k++) if (samples[k].u < a.u) ok = false;
      if (ok && a.v >= 0.2 && a.v <= 0.72) bulges.push(a);
    }
    const uniq = [];
    for (const b of bulges) {
      if (!uniq.length || Math.abs(uniq[uniq.length - 1].v - b.v) > 0.035) uniq.push(b);
    }

    function nearest(vTarget) {
      let best = samples[0];
      let bd = 1e9;
      for (const s of samples) {
        const d = Math.abs(s.v - vTarget);
        if (d < bd) {
          bd = d;
          best = s;
        }
      }
      return best;
    }

    function between(va, vb) {
      return nearest((va + vb) / 2);
    }

    // W 五凸：尽量取鼓包；不足则按高度带取左缘
    const bands = [
      { id: '1', name: '颅顶结节', v0: 0.2, v1: 0.3 },
      { id: '2', name: '颅侧结节', v0: 0.3, v1: 0.4 },
      { id: '3', name: '颧骨弓隆起', v0: 0.4, v1: 0.5 },
      { id: '4', name: '颊转角', v0: 0.52, v1: 0.62 },
      { id: '5', name: '颏结节', v0: 0.64, v1: 0.74 }
    ];
    const convex = [];
    for (const b of bands) {
      const fromUniq = uniq.filter((u) => u.v >= b.v0 && u.v <= b.v1).sort((a, c) => a.u - c.u)[0];
      const s = fromUniq || samples.filter((u) => u.v >= b.v0 && u.v <= b.v1).sort((a, c) => a.u - c.u)[0] || nearest((b.v0 + b.v1) / 2);
      convex.push({ ...b, sample: s });
    }

    const concaveIds = ['A', 'B', 'C', 'D'];
    const concave = [];
    for (let i = 0; i < 4; i++) {
      const va = convex[i].sample.v;
      const vb = convex[i + 1].sample.v;
      // 凹：两凸之间，取 u 较大（略内收）的左缘点
      const midV = (va + vb) / 2;
      const candidates = samples.filter((s) => s.v > va + 0.01 && s.v < vb - 0.01);
      let s = candidates.sort((a, c) => c.u - a.u)[0] || between(va, vb);
      concave.push({ id: concaveIds[i], sample: s });
    }

    function toAnno(text, color, dx, dy, hit, id) {
      const world = hit.point.clone();
      const localPos = root.worldToLocal(world.clone());
      let nWorld = new THREE.Vector3(-1, 0, 0);
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
        baseScale: root.scale && root.scale.x ? Number(root.scale.x) : 1,
        occludeDot: -0.35,
        labelShape: 'circle'
      };
    }

    const annotations = [];
    const placed = [];
    const cyan = '#00e8e8';
    const gray = '#e8e8e8';

    convex.forEach((c, i) => {
      const s = c.sample;
      if (!s || !s.hit) return;
      const dx = -95 - i * 2;
      const dy = -30 + i * 12;
      annotations.push(toAnno(c.id, cyan, dx, dy, s.hit, 'anno_v02_c' + c.id));
      placed.push({ text: c.id, name: c.name, u: s.u, v: s.v, x: s.x, y: s.y, z: s.z });
    });
    concave.forEach((c, i) => {
      const s = c.sample;
      if (!s || !s.hit) return;
      annotations.push(toAnno(c.id, gray, -70, -10 + i * 8, s.hit, 'anno_v02_d' + c.id));
      placed.push({ text: c.id, u: s.u, v: s.v, x: s.x, y: s.y, z: s.z });
    });

    return {
      ok: annotations.length >= 7,
      annotations,
      dashedLines: [],
      debug: { uniq: uniq.slice(0, 10).map((u) => ({ v: u.v, u: u.u, x: u.x })), placed },
      hitLabels: annotations.map((a) => a.text)
    };
  });
}

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(60000);

  await page.goto(`${baseUrl}/Solid.html?sandbox=headform&_=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 90000
  });
  await page.waitForFunction(() => Array.isArray(window.customScenes) && window.customScenes.length > 0, null, {
    timeout: 90000
  });
  await page.waitForFunction(() => !!(window.__solidHost && window.__solidHost.getCamera()), null, {
    timeout: 90000
  });
  await waitReady(page);

  await openV02(page);
  await page.evaluate(() => {
    window.showAnnotations = false;
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(outDir, 'V02-clean.png'), timeout: 60000 });

  const pick = await pickFront(page);
  fs.writeFileSync(path.join(outDir, 'V02-pick.json'), JSON.stringify(pick, null, 2));
  console.log('pick', pick.hitLabels || pick.error);
  console.log('placed', JSON.stringify(pick.debug && pick.debug.placed, null, 2));

  if (!pick.ok) throw new Error('pick failed');

  const keyPoints = [
    '正面是认识头部左右外轮廓对称的基本视角。如果您不小心转动了视角，请点击重置按钮恢复视角。',
    '本关只看外轮廓：盯画面左右外缘怎么立住；本关标注钉在左侧外缘（右侧大致对称，可自行对照）。',
    '请看场景中的标注，1、2、3、4、5 是轮廓上的5个凸起，A、B、C、D是外轮廓上的4个凹陷——合起来就是正面头侧常见的「W」起伏。',
    '这个视角下，特别留意颧宽与颏宽的对比：颧骨弓一带往往更外，颏部相对收。实际中每个人凹凸强弱不同，创作时先有这些点位的框架，再按个体强化、弱化或省略。',
    '',
    '点位名称如下：',
    '1.颅顶结节',
    '2.颅侧结节',
    '3.颧骨弓隆起',
    '4.颊转角',
    '5.颏结节',
    'A.顶侧之间内收',
    'B.侧颧之间内收',
    'C.颧颊之间内收',
    'D.颊颏之间内收'
  ].join('\n');

  const f = load102();
  f.data.items[0].annotations = pick.annotations;
  f.data.items[0].dashedLines = [];
  f.data.meta.status = 'wip';
  f.data.meta.detail = '正面·外轮廓。正立石膏头；左缘「W」凸凹编号（对齐 101，不连虚线）。';
  f.data.meta.keyPoints = keyPoints;
  // 保持已写入的 camera/light
  fs.writeFileSync(f.full, JSON.stringify(f.data, null, 2) + '\n');
  console.log('merged', rebuildAggregate());

  await page.goto(`${baseUrl}/Solid.html?sandbox=headform&_=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 90000
  });
  await page.waitForFunction(() => Array.isArray(window.customScenes) && window.customScenes.length > 0, null, {
    timeout: 90000
  });
  await waitReady(page);
  await openV02(page);
  await page.evaluate(() => {
    window.showAnnotations = true;
    const el = document.getElementById('scene-loader');
    if (el) el.style.display = 'none';
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(outDir, 'V02-annotated.png'), timeout: 60000 });
  console.log('OUT', outDir);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
