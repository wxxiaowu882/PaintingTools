/**
 * 105 / V05：侧后 · 外轮廓
 *
 * 吸取 101–104（含用户手改）：
 * - 侧后 ≈ 背影转头/过肩：相机在侧后象限（约 125–140°），与 V01 前后相离
 * - 主课：后脑—耳后—颈后外轮廓（本视角颅顶/枕后可进主课）
 * - 圆标；名称在 keyPoints；不强制虚线；凹点不凑数
 * - skipPerf=1；等 mesh；射线宜粗；柔光可读剪影
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-headform-105`);
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:18080';
fs.mkdirSync(outDir, { recursive: true });

const MODEL = '/docs/model/石膏头像_男中青年_大本 蝙蝠侠 布鲁斯韦恩_头像_opt.glb';

function load105() {
  const f = fs.readdirSync(jsonDir).find((n) => n.startsWith('105_') && n.endsWith('.json'));
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

function seedScene(data) {
  // 侧后：比全侧更靠后。101≈35°，104≈80°，侧后取 ~130°
  const r = 6.4;
  const deg = 130;
  const rad = (deg * Math.PI) / 180;
  data.id = 'V05';
  data.camera = {
    pos: [+(r * Math.sin(rad)).toFixed(3), 0.85, +(r * Math.cos(rad)).toFixed(3)],
    target: [0.02, 0.82, -0.02],
    zoom: 0.56,
    fov: 15
  };
  // 柔光：照亮可见的后侧轮廓（勿死逆光）
  data.light = {
    type: 'point',
    azimuth: 200,
    elevation: 28,
    distance: 16,
    temp: 34,
    size: 24,
    intensity: 2.0
  };
  data.env = {
    ...(data.env || {}),
    hasWall: false,
    defaultMat: 'origin',
    groundColor: '#bdb8b0',
    skyColor: '#0d0d0f',
    skyLightScale: 0.8,
    noInterModelShadow: false
  };
  data.crop = {
    display: 'block',
    left: '500px',
    top: '110px',
    width: '720px',
    height: '720px'
  };
  data.items = [
    {
      type: 'glb',
      url: MODEL,
      pos: [0, 0, 0],
      rot: [0, 0, 0],
      scale: [5.8, 5.8, 5.8],
      mat: 'origin',
      annotations: []
    }
  ];
  data.meta = {
    ...(data.meta || {}),
    line: 'viewpoint',
    slot: 'V05',
    status: 'wip',
    detail:
      '侧后·外轮廓。背影转头/过肩取景；柔光；主钉后脑—耳后—颈后剪影（与侧前前后相离）；不连虚线。',
    keyPoints:
      '侧后介于「全侧面」与「背面」之间：像过肩回看或背影转头，后脑、耳后、颈后外轮廓成为主角。如果您不小心转动了视角，请点击重置按钮恢复视角。\n本关只看外轮廓：盯画面外缘这条后侧剪影怎么走；并与侧前（四分之三）对照——前后相离，同一颗头在前后视角下外缘并不一样。\n请看场景中的标注，1–5 是轮廓上的凸起，A–C 是较重要的凹陷（不凑数）。\n实际中每个人凹凸强弱不同，创作时先有这些点位的框架，再按个体强化、弱化或省略。\n\n点位名称如下：\n1.颅顶结节\n2.枕后突隆\n3.耳壳上端\n4.下颌角（后缘）\n5.胸锁乳突肌隆起\nA.颅顶与枕后之间的凹转\nB.耳后凹（耳壳与后脑之间）\nC.下颌后与颈的过渡凹\n'
  };
  return data;
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

async function openV05(page) {
  await page.evaluate(() => {
    const m = document.getElementById('scene-grid-modal');
    if (m) m.style.display = 'none';
    const i = window.customScenes.findIndex((s) => s && s.id === 'V05');
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
  await page.waitForTimeout(1200);
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
    /** 画面左缘剪影（后侧外缘） */
    function sampleLeft(v) {
      let best = null;
      for (let u = 0.18; u <= 0.58; u += 0.004) {
        const hit = hitAt(u, v);
        if (!hit) continue;
        _lp.copy(hit.point);
        root.worldToLocal(_lp);
        if (!best || u < best.u) best = { u, v, hit, x: _lp.x, y: _lp.y, z: _lp.z };
      }
      return best;
    }
    function collect(v0, v1) {
      const arr = [];
      for (let v = v0; v <= v1; v += 0.01) {
        const s = sampleLeft(v);
        if (s) arr.push({ ...s, v: +v.toFixed(3) });
      }
      return arr;
    }
    function pickMax(arr, key) {
      if (!arr.length) return null;
      return arr.reduce((a, b) => (b[key] > a[key] ? b : a));
    }
    function pickMin(arr, key) {
      if (!arr.length) return null;
      return arr.reduce((a, b) => (b[key] < a[key] ? b : a));
    }
    function pickRecess(arr) {
      if (arr.length < 3) return arr[Math.floor(arr.length / 2)] || null;
      let best = null;
      let bestScore = -1e9;
      for (let i = 1; i < arr.length - 1; i++) {
        const prev = arr[i - 1];
        const cur = arr[i];
        const next = arr[i + 1];
        const score = cur.u - (prev.u + next.u) * 0.5;
        if (score > bestScore) {
          bestScore = score;
          best = cur;
        }
      }
      return best;
    }

    // 后侧剪影自上而下
    const top = collect(0.12, 0.22);
    const p1 = pickMax(top, 'y') || pickMin(top, 'u'); // 颅顶
    const occip = collect(0.22, 0.36);
    const p2 = pickMin(occip, 'u'); // 枕后最外
    const pA = pickRecess(collect(0.18, 0.3)); // 顶枕之间凹
    const ear = collect(0.36, 0.48);
    const p3 = pickMin(ear, 'u'); // 耳壳上/外
    const pB = pickRecess(collect(0.34, 0.46)); // 耳后凹
    const jaw = collect(0.48, 0.6);
    const p4 = pickMin(jaw, 'u'); // 下颌角后
    const pC = pickRecess(collect(0.55, 0.68)); // 颌后到颈
    const neck = collect(0.62, 0.78);
    const p5 = pickMin(neck, 'u'); // 胸锁乳突/颈侧

    function localNormal(hit) {
      const n = hit.face.normal.clone();
      const nm = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
      n.applyMatrix3(nm).normalize();
      const q = new THREE.Quaternion();
      root.getWorldQuaternion(q);
      n.applyQuaternion(q.clone().invert()).normalize();
      return n;
    }
    function mk(id, text, color, sample, dx, dy) {
      if (!sample || !sample.hit) return null;
      _lp.copy(sample.hit.point);
      root.worldToLocal(_lp);
      const nLocal = localNormal(sample.hit);
      return {
        id,
        annotationKind: 'leader',
        text,
        detailText: '',
        collapsed: false,
        color,
        dx,
        dy,
        dxN: dx * 0.0007,
        dyN: dy * 0.0007,
        dxW: dx * 0.0025,
        dyW: dy * 0.0025,
        localPos: [+_lp.x.toFixed(4), +_lp.y.toFixed(4), +_lp.z.toFixed(4)],
        localNormal: [+nLocal.x.toFixed(3), +nLocal.y.toFixed(3), +nLocal.z.toFixed(3)],
        baseDist: +cam.position.distanceTo(sample.hit.point).toFixed(4),
        baseScale: 5.8,
        labelShape: 'circle',
        occludeDot: -0.35,
        _dbg: { u: +sample.u.toFixed(3), v: sample.v, y: +_lp.y.toFixed(4), z: +_lp.z.toFixed(4) }
      };
    }

    const annos = [
      mk('anno_v05_1', '1', '#00e8e8', p1, -90, -22),
      mk('anno_v05_2', '2', '#00e8e8', p2, -95, -6),
      mk('anno_v05_3', '3', '#00e8e8', p3, -100, 4),
      mk('anno_v05_4', '4', '#00e8e8', p4, -95, 16),
      mk('anno_v05_5', '5', '#00e8e8', p5, -90, 32),
      mk('anno_v05_A', 'A', '#d6d6d6', pA, -48, -12),
      mk('anno_v05_B', 'B', '#e3e3e3', pB, -50, 6),
      mk('anno_v05_C', 'C', '#e8e8e8', pC, -52, 22)
    ].filter(Boolean);

    return {
      ok: annos.length,
      meshCount: meshes.length,
      dbg: annos.map((a) => ({ t: a.text.trim(), ...a._dbg })),
      annos
    };
  });
}

async function main() {
  const file = load105();
  file.data = seedScene(file.data);
  fs.writeFileSync(file.full, JSON.stringify(file.data, null, 2) + '\n');
  console.log('seeded', file.f, file.data.camera, file.data.light);
  console.log('merged', rebuildAggregate());

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(120000);

  await boot(page);
  await openV05(page);
  const picked = await pick(page);
  console.log('picked', picked.ok, 'meshes', picked.meshCount);
  console.log(JSON.stringify(picked.dbg, null, 2));
  fs.writeFileSync(path.join(outDir, 'pick.json'), JSON.stringify(picked, null, 2));
  if (picked.ok < 6) throw new Error('pick too few: ' + picked.ok);

  const fresh = load105();
  fresh.data.items[0].annotations = picked.annos.map(({ _dbg, ...rest }) => rest);
  fs.writeFileSync(fresh.full, JSON.stringify(fresh.data) + '\n');
  console.log('merged', rebuildAggregate());

  await boot(page);
  await openV05(page);
  await page.evaluate(() => {
    window.showAnnotations = true;
  });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(outDir, 'V05-annotated.png'), timeout: 45000 });
  console.log('OUT', outDir);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
