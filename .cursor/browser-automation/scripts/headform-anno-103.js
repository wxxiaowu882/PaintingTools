/**
 * 103 / V03：大半侧 · 外轮廓（修订）
 *
 * 吸取 101/102 + 首轮 103 视觉失败：
 * - 大半侧 ≠ 全侧面：约 52–58°，额鼻颏接近剪影但仍略见颧颊
 * - 主课钉「额—鼻—唇—颏」剪影线（与 101 远端颧颊课区分）
 * - 凹点不凑数：只钉鼻根 A、唇上/鼻唇角一带 B
 * - 柔光照亮可见面；正面光方位角=90，勿用 0
 * - 自动化加 skipPerf=1，避免卡在着色器性能测试
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-headform-103b`);
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:18080';
fs.mkdirSync(outDir, { recursive: true });

const MODEL = '/docs/model/石膏头像_男中青年_大本 蝙蝠侠 布鲁斯韦恩_头像_opt.glb';

function load103() {
  const f = fs.readdirSync(jsonDir).find((n) => n.startsWith('103_') && n.endsWith('.json'));
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
  // 101≈35°，全侧≈90°；大半侧取 ~55°
  const r = 6.4;
  const deg = 55;
  const rad = (deg * Math.PI) / 180;
  data.id = 'V03';
  data.camera = {
    pos: [+(r * Math.sin(rad)).toFixed(3), 0.72, +(r * Math.cos(rad)).toFixed(3)],
    target: [-0.04, 0.8, 0.04],
    zoom: 0.58,
    fov: 15
  };
  // 柔侧前偏正：可见面受光，剪影仍清晰
  data.light = {
    type: 'point',
    azimuth: 125,
    elevation: 24,
    distance: 16,
    temp: 34,
    size: 24,
    intensity: 2.0
  };
  data.env = {
    ...(data.env || {}),
    hasWall: true,
    defaultMat: 'origin',
    groundColor: '#bdb8b0',
    skyColor: '#0d0d0f',
    skyLightScale: 0.78,
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
    slot: 'V03',
    status: 'wip',
    detail:
      '大半侧·外轮廓。比侧前更侧、未到全侧；柔光；主钉额—鼻—唇—颏剪影凸凹（与 101 颧颊课区分；不连虚线）。',
    keyPoints:
      '大半侧介于「侧前」与「全侧面」之间：头更侧过来，额—鼻—唇—颏更接近一条剪影线，但仍能略见颧颊。如果您不小心转动了视角，请点击重置按钮恢复视角。\n本关只看外轮廓：盯画面左缘这条「立起来的脸侧剪影」；与侧前相比，鼻额颏更像一条线，颧颊起伏退居次要。\n请看场景中的标注，1、2、3、4、5 是轮廓上的凸起，A、B 是本视角下较重要的凹陷（不凑数）。\n实际中每个人凹凸强弱不同，创作时先有这些点位的框架，再按个体强化、弱化或省略。\n\n点位名称如下：\n1.额结节\n2.眉弓\n3.鼻头\n4.上唇（口轮匝肌）\n5.颏结节\nA.鼻根（眉弓与鼻之间的凹）\nB.鼻唇角（鼻底与上唇之间的凹）\n'
  };
  return data;
}

async function waitReady(page) {
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    try {
      window.useAdvancedRender = false;
      window.isTestingPerformance = false;
      window.perfTestDone = true;
    } catch (_e) {}
    const el = document.getElementById('scene-loader');
    if (el) el.style.display = 'none';
    const m = document.getElementById('scene-grid-modal');
    if (m) m.style.display = 'none';
    const pt = document.getElementById('perf-test-overlay');
    if (pt) pt.style.display = 'none';
  });
}

async function openV03(page) {
  const idx = await page.evaluate(() => (window.customScenes || []).findIndex((s) => s && s.id === 'V03'));
  if (idx < 0) throw new Error('V03 not found');
  console.log('openV03 idx', idx);
  await page.evaluate((i) => {
    const el = document.getElementById('scene-loader');
    if (el) el.style.display = 'none';
    const m = document.getElementById('scene-grid-modal');
    if (m) m.style.display = 'none';
    window.currentSceneIndex = -1;
    window.switchScene(i);
  }, idx);
  // 等 GLB 入场（skipPerf 下约 1–3s）
  for (let i = 0; i < 60; i++) {
    const meshes = await page.evaluate(() => {
      let n = 0;
      try {
        window.__solidHost.getSceneGroup().traverse((o) => {
          if (o.isMesh) n++;
        });
      } catch (_e) {}
      return n;
    });
    if (meshes > 0) {
      console.log('glb meshes', meshes, 'at', i);
      break;
    }
    await page.waitForTimeout(500);
  }
  await waitReady(page);
  await page.waitForTimeout(1200);
}

async function pickProfileEdge(page) {
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

    /** 画面左缘剪影（额鼻颏线）：取该 v 上最左命中，且偏好靠前（+z） */
    function leftEdge(v, u0, u1, zMin) {
      let best = null;
      for (let u = u0; u <= u1; u += 0.0015) {
        const hit = hitAt(u, v);
        if (!hit) continue;
        _lp.copy(hit.point);
        root.worldToLocal(_lp);
        if (_lp.z < zMin) continue;
        if (!best || u < best.u || (Math.abs(u - best.u) < 0.004 && _lp.z > best.z)) {
          best = { u, v, hit, x: _lp.x, y: _lp.y, z: _lp.z };
        }
      }
      return best;
    }

    function band(v0, v1, mode, zMin) {
      let best = null;
      const U0 = 0.22;
      const U1 = 0.55;
      for (let v = v0; v <= v1; v += 0.004) {
        const s = leftEdge(v, U0, U1, zMin);
        if (!s) continue;
        const rec = { ...s, v: +v.toFixed(3) };
        if (!best) best = rec;
        else if (mode === 'mostLeft' && rec.u < best.u) best = rec;
        else if (mode === 'mostPosZ' && rec.z > best.z) best = rec;
        else if (mode === 'highestY' && rec.y > best.y) best = rec;
        else if (mode === 'chin' && rec.y < best.y && rec.z > 0.03) best = rec;
      }
      return best;
    }

    // 大半侧：左缘是额鼻颏；zMin 过滤耳后
    const p1 = band(0.14, 0.24, 'highestY', -0.02); // 额
    const p2 = band(0.26, 0.34, 'mostLeft', 0.02); // 眉弓
    const pA = band(0.3, 0.38, 'mostLeft', 0.03); // 鼻根凹
    const p3 = band(0.38, 0.48, 'mostPosZ', 0.05); // 鼻头（最前）
    const pB = band(0.48, 0.56, 'mostLeft', 0.04); // 鼻唇角凹
    const p4 = band(0.52, 0.62, 'mostPosZ', 0.04); // 上唇
    const p5 = band(0.62, 0.76, 'chin', 0.03); // 颏（勿落到颈）

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
        _dbg: { u: sample.u, v: sample.v, y: +sample.y.toFixed(4), x: +sample.x.toFixed(4), z: +sample.z.toFixed(4) }
      };
    }

    const annos = [
      mk('anno_v03_1', '1', '#00e8e8', p1, -86, -26),
      mk('anno_v03_2', '2', '#00e8e8', p2, -90, -10),
      mk('anno_v03_3', '3', '#00e8e8', p3, -100, -4),
      mk('anno_v03_4', '4', '#00e8e8', p4, -92, -6),
      mk('anno_v03_5', '5', '#00e8e8', p5, -88, 12),
      mk('anno_v03_A', 'A', '#e3e3e3', pA, -46, -8),
      mk('anno_v03_B', 'B', '#e8e8e8', pB, -48, -6)
    ].filter(Boolean);

    return {
      ok: annos.length,
      annos,
      dbg: annos.map((a) => ({ t: a.text.trim(), ...a._dbg }))
    };
  });
}

async function boot(page) {
  console.log('goto…');
  await page.goto(`${baseUrl}/Solid.html?sandbox=headform&skipPerf=1&_=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 90000
  });
  // 若仍卡性能测试，主动拉配置
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    try {
      window.useAdvancedRender = false;
      window.isTestingPerformance = false;
      window.perfTestDone = true;
      if ((!window.customScenes || !window.customScenes.length) && typeof window.loadJSONData === 'function') {
        window.loadJSONData();
      }
    } catch (_e) {}
  });
  await page.waitForFunction(() => Array.isArray(window.customScenes) && window.customScenes.length > 0, null, {
    timeout: 90000
  });
  await page.waitForFunction(() => !!(window.__solidHost && window.__solidHost.getCamera()), null, {
    timeout: 60000
  });
  await waitReady(page);
  console.log('booted scenes', await page.evaluate(() => window.customScenes.length));
}

async function main() {
  const file = load103();
  file.data = seedScene(file.data);
  fs.writeFileSync(file.full, JSON.stringify(file.data, null, 2) + '\n');
  console.log('seeded', file.f, 'cam', file.data.camera, 'light', file.data.light);
  console.log('merged', rebuildAggregate());

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(120000);

  await boot(page);
  await openV03(page);
  await page.screenshot({ path: path.join(outDir, 'V03-frame.png'), timeout: 60000 });

  const picked = await pickProfileEdge(page);
  console.log('picked', picked.ok, JSON.stringify(picked.dbg, null, 2));
  fs.writeFileSync(path.join(outDir, 'pick.json'), JSON.stringify(picked, null, 2));

  const fresh = load103();
  fresh.data.items[0].annotations = picked.annos.map((a) => {
    const { _dbg, ...rest } = a;
    return rest;
  });
  fs.writeFileSync(fresh.full, JSON.stringify(fresh.data) + '\n');
  console.log('merged', rebuildAggregate());

  await boot(page);
  await openV03(page);
  await page.evaluate(() => {
    window.showAnnotations = true;
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(outDir, 'V03-annotated.png'), timeout: 60000 });
  console.log('OUT', outDir);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
