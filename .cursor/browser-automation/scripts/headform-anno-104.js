/**
 * 104 / V04：全侧面 · 外轮廓
 *
 * 吸取 101–103（含用户手改）：
 * - 正侧面 ≈90°；主课「额—鼻—唇—颏（—喉）」一条剪影
 * - 对齐 103 手改口径：凸 1–6（含上下唇白脊）、凹 A–E（含眼裂/唇缝/颏唇沟）
 * - 颅顶/枕骨等非脸部点位延后（见路线图备忘），本关不钉
 * - skipPerf=1；等 mesh；射线步进宜粗；柔光可读轮廓
 * - 光方位：90=正面光；全侧取景用偏前柔光照亮脸侧剪影
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-headform-104`);
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:18080';
fs.mkdirSync(outDir, { recursive: true });

const MODEL = '/docs/model/石膏头像_男中青年_大本 蝙蝠侠 布鲁斯韦恩_头像_opt.glb';

function load104() {
  const f = fs.readdirSync(jsonDir).find((n) => n.startsWith('104_') && n.endsWith('.json'));
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
  // 正侧面 ≈90°（x 大、z≈0）；略抬相机对准头中
  const r = 6.35;
  data.id = 'V04';
  data.camera = {
    pos: [+r.toFixed(3), 0.72, 0.12],
    target: [-0.02, 0.8, 0.04],
    zoom: 0.58,
    fov: 15
  };
  // 柔光：从「脸前方偏上」照，让剪影起伏可读（勿硬逆光）
  data.light = {
    type: 'point',
    azimuth: 100,
    elevation: 24,
    distance: 16,
    temp: 34,
    size: 25,
    intensity: 2.0
  };
  data.env = {
    ...(data.env || {}),
    hasWall: false,
    defaultMat: 'origin',
    groundColor: '#bdb8b0',
    skyColor: '#0d0d0f',
    skyLightScale: 0.82,
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
    slot: 'V04',
    status: 'wip',
    detail:
      '全侧面·外轮廓。正侧面平视；柔光；主钉额—鼻—唇—颏一条剪影（对齐 103 唇部分细；颅顶/枕骨延后补；不连虚线）。',
    keyPoints:
      '全侧面是认识「侧面像」最干净的视角：头转到正侧，外轮廓几乎合成一条立起的剪影线。如果您不小心转动了视角，请点击重置按钮恢复视角。\n本关只看外轮廓：盯画面左缘这一条额—鼻—唇—颏怎么起伏；侧面像往往就靠这条线说话。\n请看场景中的标注，1–6 是轮廓上的凸起，A–E 是较重要的凹陷（沿用大半侧的细分口径，不凑数到脑颅）。\n实际中每个人凹凸强弱不同，创作时先有这些点位的框架，再按个体强化、弱化或省略。\n\n点位名称如下：\n1.额结节\n2.眉弓\n3.鼻头\n4.上唇白脊线上（唇峰一带）\n5.下唇白脊线上\n6.颏肌\nA.鼻根（眉弓与鼻之间的凹）\nB.眼裂\nC.鼻唇角（鼻底与上唇之间的凹）\nD.唇缝\nE.颏唇沟\n\n（备忘：颅顶结节、枕骨等非脸部点位，等脸部主线做完后再补。）\n'
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

async function openV04(page) {
  await page.evaluate(() => {
    const m = document.getElementById('scene-grid-modal');
    if (m) m.style.display = 'none';
    const i = window.customScenes.findIndex((s) => s && s.id === 'V04');
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
    /** 全侧面左缘 = 脸前缘剪影；偏好 +z（靠前） */
    function sampleLeft(v, zMin) {
      let best = null;
      for (let u = 0.18; u <= 0.58; u += 0.0035) {
        const hit = hitAt(u, v);
        if (!hit) continue;
        _lp.copy(hit.point);
        root.worldToLocal(_lp);
        if (_lp.z < zMin) continue;
        if (!best || u < best.u || (Math.abs(u - best.u) < 0.006 && _lp.z > best.z)) {
          best = { u, v, hit, x: _lp.x, y: _lp.y, z: _lp.z };
        }
      }
      return best;
    }
    function collect(v0, v1, zMin) {
      const arr = [];
      for (let v = v0; v <= v1; v += 0.008) {
        const s = sampleLeft(v, zMin);
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

    // 对齐 103 手改：1额 2眉 3鼻头 4上唇白脊 5下唇白脊 6颏；A鼻根 B眼裂 C鼻唇角 D唇缝 E颏唇沟
    const p1 = pickMax(collect(0.14, 0.24, -0.01), 'y');
    const p2 = pickMin(collect(0.25, 0.33, 0.02), 'u');
    const pA = pickRecess(collect(0.3, 0.38, 0.03));
    const pB = pickMin(collect(0.34, 0.42, 0.03), 'u'); // 眼裂高度带
    const p3 = pickMax(collect(0.4, 0.5, 0.05), 'z');
    const pC = pickRecess(collect(0.48, 0.55, 0.04));
    const p4 = pickMax(collect(0.52, 0.58, 0.04), 'z');
    const pD = pickRecess(collect(0.55, 0.62, 0.04));
    const p5 = pickMax(collect(0.58, 0.64, 0.04), 'z');
    const pE = pickRecess(collect(0.62, 0.7, 0.03));
    const chin = collect(0.66, 0.76, 0.03).filter((s) => s.y > 0.045);
    const p6 = pickMax(chin, 'z') || pickMin(chin, 'u');

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
        _dbg: { u: +sample.u.toFixed(3), v: sample.v, y: +sample.y.toFixed(4), z: +sample.z.toFixed(4) }
      };
    }

    const annos = [
      mk('anno_v04_1', '1', '#00e8e8', p1, -100, -24),
      mk('anno_v04_2', '2', '#00e8e8', p2, -95, -12),
      mk('anno_v04_3', '3', '#00e8e8', p3, -110, -2),
      mk('anno_v04_4', '4', '#00e8e8', p4, -100, 0),
      mk('anno_v04_5', '5', '#00e8e8', p5, -100, 18),
      mk('anno_v04_6', '6', '#00e8e8', p6, -105, 36),
      mk('anno_v04_A', 'A', '#d6d6d6', pA, -52, -16),
      mk('anno_v04_B', 'B', '#e3e3e3', pB, -55, 8),
      mk('anno_v04_C', 'C', '#e8e8e8', pC, -50, 4),
      mk('anno_v04_D', 'D', '#cccccc', pD, -55, 14),
      mk('anno_v04_E', 'E', '#cfcfcf', pE, -58, 28)
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
  const file = load104();
  file.data = seedScene(file.data);
  fs.writeFileSync(file.full, JSON.stringify(file.data, null, 2) + '\n');
  console.log('seeded', file.f, file.data.camera, file.data.light);
  console.log('merged', rebuildAggregate());

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(120000);

  await boot(page);
  await openV04(page);
  const picked = await pick(page);
  console.log('picked', picked.ok, 'meshes', picked.meshCount);
  console.log(JSON.stringify(picked.dbg, null, 2));
  fs.writeFileSync(path.join(outDir, 'pick.json'), JSON.stringify(picked, null, 2));
  if (picked.ok < 8) throw new Error('pick too few: ' + picked.ok);

  const fresh = load104();
  fresh.data.items[0].annotations = picked.annos.map(({ _dbg, ...rest }) => rest);
  fs.writeFileSync(fresh.full, JSON.stringify(fresh.data) + '\n');
  console.log('merged', rebuildAggregate());

  await boot(page);
  await openV04(page);
  await page.evaluate(() => {
    window.showAnnotations = true;
  });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(outDir, 'V04-annotated.png'), timeout: 45000 });
  console.log('OUT', outDir);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
