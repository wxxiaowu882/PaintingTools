/**
 * headform v7：
 * - V01 相机回到「更正的四分之三」（避免过侧变成鼻梁剪影）
 * - 定点：在左半屏扫描，优先 localX 最负的远端颊/颞点
 * - L01：亮面跟地面投影方向反推（影朝左 → 光在右 → 亮面在右）
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-headform-v7`);
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:18080';
fs.mkdirSync(outDir, { recursive: true });

function loadSceneFile(num) {
  const f = fs.readdirSync(jsonDir).find((n) => n.startsWith(num + '_') && n.endsWith('.json'));
  const full = path.join(jsonDir, f);
  return { f, full, data: JSON.parse(fs.readFileSync(full, 'utf8')) };
}
function rebuildAggregate() {
  const files = fs
    .readdirSync(jsonDir)
    .filter((f) => /^\d+_.+\.json$/i.test(f))
    .sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));
  const merged = files.map((f) => JSON.parse(fs.readFileSync(path.join(jsonDir, f), 'utf8')));
  fs.writeFileSync(path.join(jsonDir, '沙盒_头部造型规律.json'), JSON.stringify(merged) + '\n');
  return merged.length;
}

// 更正的 3/4：远端颊剪影可读，鼻不抢左缘
const f101 = loadSceneFile('101');
f101.data.camera = { pos: [4.0, 1.2, 5.3], target: [0, 0.95, 0], zoom: 0.6, fov: 16 };
f101.data.meta.detail =
  '样板关：侧前·远端外轮廓。四分之三取景；虚线与转折钉在远端颊缘（眉弓凸/颧骨凸），不走鼻梁中线。';
f101.data.meta.keyPoints = [
  '侧前（四分之三）是肖像里最常见的头向。',
  '本关只看外轮廓：盯画面上「远端」那条头模外缘怎么起伏。',
  '重点看眉弓凸、颧骨凸——远端轮廓上常见的两处外鼓；转折多落在骨点最外突处。',
  '近侧脸面信息多，但本关不拿近侧当主轮廓课。'
].join('\n');
f101.data.items[0].annotations = [];
f101.data.items[0].dashedLines = [];
fs.writeFileSync(f101.full, JSON.stringify(f101.data, null, 2) + '\n');

const f201 = loadSceneFile('201');
f201.data.items[0].annotations = [];
f201.data.items[0].dashedLines = [];
fs.writeFileSync(f201.full, JSON.stringify(f201.data, null, 2) + '\n');
rebuildAggregate();
console.log('camera reset + cleared');

async function waitReady(page) {
  await page.waitForFunction(() => {
    const el = document.getElementById('scene-loader');
    if (!el) return true;
    const st = getComputedStyle(el);
    return st.display === 'none' || Number(st.opacity || 1) < 0.05;
  }, null, { timeout: 180000 }).catch(() => {});
  await page.waitForTimeout(1400);
  await page.evaluate(() => {
    const el = document.getElementById('scene-loader');
    if (el) el.style.display = 'none';
    const m = document.getElementById('scene-grid-modal');
    if (m) m.style.display = 'none';
  });
}

async function openScene(page, id) {
  const idx = await page.evaluate((want) => {
    return (window.customScenes || []).findIndex((s) => s && String(s.id) === String(want));
  }, id);
  await page.evaluate((i) => {
    window.currentSceneIndex = -1;
    window.switchScene(i);
  }, idx);
  await waitReady(page);
}

async function pickV01(page) {
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

    /** 该行取 localX 最负且 z 不太贴鼻尖的远端点 */
    function farCheekAtV(v) {
      let best = null;
      for (let u = 0.28; u <= 0.62; u += 0.003) {
        const hit = hitAt(u, v);
        if (!hit) continue;
        _lp.copy(hit.point);
        root.worldToLocal(_lp);
        // 拒绝鼻尖：近中线且很靠前
        if (Math.abs(_lp.x) < 0.03 && _lp.z > 0.07) continue;
        // 只要远端（负 x）
        if (_lp.x > -0.02) continue;
        if (!best || _lp.x < best.x) {
          best = { u, hit, x: _lp.x, y: _lp.y, z: _lp.z };
        }
      }
      return best;
    }

    const samples = [];
    for (let i = 0; i <= 80; i++) {
      const v = 0.22 + (0.72 - 0.22) * (i / 80);
      const s = farCheekAtV(v);
      if (s) samples.push({ v: +v.toFixed(4), u: +s.u.toFixed(4), x: +s.x.toFixed(4), z: +s.z.toFixed(4), hit: s.hit });
    }
    if (samples.length < 6) return { error: 'few far-cheek samples', n: samples.length };

    // 外鼓：x 局部更负
    const bulges = [];
    for (let i = 2; i < samples.length - 2; i++) {
      const a = samples[i];
      if (a.x <= samples[i - 1].x && a.x <= samples[i + 1].x) {
        if (a.v >= 0.28 && a.v <= 0.55) bulges.push(a);
      }
    }
    const uniq = [];
    for (const b of bulges) {
      if (!uniq.length || Math.abs(uniq[uniq.length - 1].v - b.v) > 0.04) uniq.push(b);
    }
    uniq.sort((a, b) => a.v - b.v);
    const brow = uniq[0] || samples.filter((s) => s.v > 0.3 && s.v < 0.4).sort((a, b) => a.x - b.x)[0];
    const zyg =
      uniq.find((b) => brow && b.v >= brow.v + 0.08) ||
      samples.filter((s) => s.v > 0.42 && s.v < 0.52).sort((a, b) => a.x - b.x)[0];

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

    function toAnno(text, dx, dy, hit, id) {
      const world = hit.point.clone();
      const localPos = root.worldToLocal(world.clone());
      let nWorld = new THREE.Vector3(0, 0, 1);
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
        color: '#787878',
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
        occludeDot: -0.35
      };
    }

    const plan = [
      { text: '额缘', v: brow ? brow.v - 0.05 : 0.28, dx: -95, dy: -40 },
      { text: '眉弓凸', sample: brow, dx: -105, dy: -8 },
      { text: '颧骨凸', sample: zyg, dx: -112, dy: 10 },
      { text: '下颌转', v: 0.58, dx: -100, dy: 22 },
      { text: '颏端', v: 0.68, dx: -85, dy: 38 }
    ];

    const annotations = [];
    const placed = [];
    for (let i = 0; i < plan.length; i++) {
      const T = plan[i];
      const s = T.sample || nearest(T.v);
      if (!s || !s.hit) continue;
      annotations.push(toAnno(T.text, T.dx, T.dy, s.hit, 'anno_v01_' + (i + 1)));
      placed.push({ text: T.text, u: s.u, v: s.v, x: s.x, z: s.z });
    }

    const pts = [];
    for (let t = 0; t <= 24; t++) {
      const v = 0.24 + (0.7 - 0.24) * (t / 24);
      const s = farCheekAtV(v);
      if (!s) continue;
      const world = s.hit.point.clone();
      const localPos = root.worldToLocal(world.clone());
      let nWorld = new THREE.Vector3(0, 1, 0);
      if (s.hit.face && s.hit.face.normal) {
        nWorld = s.hit.face.normal.clone().transformDirection(s.hit.object.matrixWorld).normalize();
      }
      const localNormal = root
        .worldToLocal(world.clone().add(nWorld))
        .sub(localPos.clone())
        .normalize();
      pts.push({
        pos: [Number(localPos.x.toFixed(4)), Number(localPos.y.toFixed(4)), Number(localPos.z.toFixed(4))],
        norm: [
          Number(localNormal.x.toFixed(3)),
          Number(localNormal.y.toFixed(3)),
          Number(localNormal.z.toFixed(3))
        ]
      });
    }

    return {
      ok: annotations.length >= 4,
      annotations,
      dashedLines: pts.length >= 2
        ? [{ id: 'dash_v01_far', color: '#00ffff', points: pts, kind: 'straight', occludeDot: -0.35 }]
        : [],
      debug: { uniq: uniq.map((b) => ({ v: b.v, u: b.u, x: b.x })), placed },
      hitLabels: annotations.map((a) => a.text)
    };
  });
}

async function pickL01(page) {
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
    function hitAt(u, v) {
      raycaster.setFromCamera(new THREE.Vector2(u * 2 - 1, -(v * 2 - 1)), cam);
      return raycaster.intersectObjects(meshes, true)[0] || null;
    }
    function toAnno(text, dx, dy, hit, id) {
      const world = hit.point.clone();
      const localPos = root.worldToLocal(world.clone());
      let nWorld = new THREE.Vector3(0, 0, 1);
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
        color: '#787878',
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
        occludeDot: -0.35
      };
    }
    // 影朝左 → 光在右：亮面偏右额颊；环影在鼻旁偏暗侧（略左）
    const labels = [
      { text: '亮面', u: 0.58, v: 0.40, dx: 100, dy: -42 },
      { text: '鼻侧环影', u: 0.48, v: 0.49, dx: -100, dy: -18 },
      { text: '颊影未接', u: 0.45, v: 0.52, dx: -110, dy: 18 },
      { text: '交界带', u: 0.51, v: 0.50, dx: 70, dy: 42 }
    ];
    const annotations = [];
    for (let i = 0; i < labels.length; i++) {
      const L = labels[i];
      const hit = hitAt(L.u, L.v);
      if (!hit) continue;
      annotations.push(toAnno(L.text, L.dx, L.dy, hit, 'anno_l01_' + (i + 1)));
    }
    return { ok: annotations.length >= 3, annotations, dashedLines: [], hitLabels: annotations.map((a) => a.text) };
  });
}

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
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

  // clean
  for (const id of ['V01', 'L01']) {
    await openScene(page, id);
    await page.evaluate(() => {
      window.showAnnotations = false;
      ['annotation-layer', 'dashed-line-layer', 'dashed-line-svg'].forEach((lid) => {
        const n = document.getElementById(lid);
        if (n) n.style.display = 'none';
      });
    });
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(outDir, `${id}-clean.png`), timeout: 60000 });
  }

  await openScene(page, 'V01');
  const p1 = await pickV01(page);
  fs.writeFileSync(path.join(outDir, 'V01-pick.json'), JSON.stringify(p1, null, 2));
  console.log('V01', p1.hitLabels || p1.error, JSON.stringify(p1.debug && p1.debug.placed));

  if (p1.ok) {
    const f = loadSceneFile('101');
    f.data.items[0].annotations = p1.annotations;
    f.data.items[0].dashedLines = p1.dashedLines;
    f.data.camera = f101.data.camera;
    f.data.meta.detail = f101.data.meta.detail;
    f.data.meta.keyPoints = f101.data.meta.keyPoints;
    f.data.meta.status = 'wip';
    fs.writeFileSync(f.full, JSON.stringify(f.data, null, 2) + '\n');
  }

  await openScene(page, 'L01');
  const p2 = await pickL01(page);
  fs.writeFileSync(path.join(outDir, 'L01-pick.json'), JSON.stringify(p2, null, 2));
  console.log('L01', p2.hitLabels);
  if (p2.ok) {
    const f = loadSceneFile('201');
    f.data.items[0].annotations = p2.annotations;
    f.data.items[0].dashedLines = [];
    f.data.meta.status = 'wip';
    fs.writeFileSync(f.full, JSON.stringify(f.data, null, 2) + '\n');
  }

  console.log('merged', rebuildAggregate());

  await page.goto(`${baseUrl}/Solid.html?sandbox=headform&_=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 90000
  });
  await page.waitForFunction(() => Array.isArray(window.customScenes) && window.customScenes.length > 0, null, {
    timeout: 90000
  });
  await waitReady(page);
  for (const id of ['V01', 'L01']) {
    await openScene(page, id);
    await page.evaluate(() => {
      window.showAnnotations = true;
      const el = document.getElementById('scene-loader');
      if (el) el.style.display = 'none';
    });
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(outDir, `${id}-annotated.png`), timeout: 60000 });
  }
  console.log('OUT', outDir);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
