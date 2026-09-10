/**
 * V01 略侧移相机使远端颊轮廓可读，再沿 GLB 左缘鼓包定点；L01 按 Loop 证据重标。
 * 结束后必须对截图做 AI 视觉读图。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-headform-v4`);
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:18080';
fs.mkdirSync(outDir, { recursive: true });

function loadSceneFile(num) {
  const f = fs.readdirSync(jsonDir).find((n) => n.startsWith(num + '_') && n.endsWith('.json'));
  if (!f) throw new Error('no ' + num);
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

// 略更侧的四分之三：让远端颊（眉弓/颧骨鼓包）成为左缘剪影，而不是鼻梁中线
const file101 = loadSceneFile('101');
file101.data.camera = {
  pos: [5.5, 1.2, 3.7],
  target: [0, 0.95, 0],
  zoom: 0.58,
  fov: 16
};
file101.data.meta = file101.data.meta || {};
file101.data.meta.detail =
  '样板关：侧前·远端外轮廓。相机略偏侧以便远端颊部剪影可读；虚线贴远端外缘，钉眉弓凸/颧骨凸。';
file101.data.meta.keyPoints = [
  '侧前（四分之三）是肖像里最常见的头向。',
  '本关只看外轮廓：盯画面左缘那条「远端」剪影怎么起伏。',
  '重点看眉弓凸、颧骨凸——远端轮廓上常见的两处外鼓；转折多落在骨点最外突处。',
  '近侧脸面信息多，但本关不拿近侧当主轮廓课。'
].join('\n');
file101.data.items[0].annotations = [];
file101.data.items[0].dashedLines = [];
fs.writeFileSync(file101.full, JSON.stringify(file101.data, null, 2) + '\n');

const file201 = loadSceneFile('201');
file201.data.meta = file201.data.meta || {};
file201.data.meta.detail = '样板关：环形光（Loop）。钉鼻侧环影、亮面、颊影未接、交界带。';
file201.data.meta.keyPoints = [
  '本关只看光：侧前略高的环形明暗（Loop）。',
  '先找鼻旁那一小圈影——它还没有接到颊上的大阴影（接到了就更像伦勃朗）。',
  '亮面仍大；「颊影未接」是本关和戏剧光的分界。',
  '交界已经钉在头上；你可以轻轻换视角，看这条环影是否还在。'
].join('\n');
file201.data.items[0].annotations = [];
file201.data.items[0].dashedLines = [];
fs.writeFileSync(file201.full, JSON.stringify(file201.data, null, 2) + '\n');
rebuildAggregate();
console.log('camera patched + cleared annos');

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
    function hitAt(u, v) {
      raycaster.setFromCamera(new THREE.Vector2(u * 2 - 1, -(v * 2 - 1)), cam);
      return raycaster.intersectObjects(meshes, true)[0] || null;
    }
    function farEdgeU(v) {
      for (let u = 0.2; u <= 0.65; u += 0.0025) {
        if (hitAt(u, v)) return u;
      }
      return null;
    }

    const samples = [];
    for (let i = 0; i <= 100; i++) {
      const v = 0.18 + (0.78 - 0.18) * (i / 100);
      const u = farEdgeU(v);
      if (u != null) samples.push({ v: +v.toFixed(4), u: +u.toFixed(4) });
    }

    // 鼓包：u 局部最小（更靠左）
    const bulges = [];
    for (let i = 3; i < samples.length - 3; i++) {
      const a = samples[i];
      if (a.u <= samples[i - 1].u && a.u <= samples[i + 1].u && a.u <= samples[i - 2].u && a.u <= samples[i + 2].u) {
        if (a.v >= 0.22 && a.v <= 0.65) bulges.push(a);
      }
    }
    // 去重
    const uniq = [];
    for (const b of bulges) {
      if (!uniq.length || Math.abs(uniq[uniq.length - 1].v - b.v) > 0.028) uniq.push(b);
    }

    // 面区取最上两个外鼓 ≈ 眉弓、颧骨
    const face = uniq.filter((b) => b.v >= 0.24 && b.v <= 0.55);
    const brow = face[0] || null;
    const zyg = face[1] || face[0] || null;

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

    const targets = [
      { text: '额缘', v: Math.max(0.22, (brow ? brow.v : 0.3) - 0.05), dx: -95, dy: -40 },
      { text: '眉弓凸', v: brow ? brow.v : 0.32, u: brow && brow.u, dx: -105, dy: -10 },
      { text: '颧骨凸', v: zyg ? zyg.v : 0.44, u: zyg && zyg.u, dx: -110, dy: 5 },
      { text: '下颌转', v: 0.58, dx: -100, dy: 25 },
      { text: '颏端', v: 0.68, dx: -85, dy: 40 }
    ];

    const annotations = [];
    const placed = [];
    const inward = 0.003;
    for (let i = 0; i < targets.length; i++) {
      const T = targets[i];
      const s = nearest(T.v);
      const edgeU = T.u != null ? T.u : s.u;
      const v = T.u != null ? T.v : s.v;
      const u = edgeU + inward;
      const hit = hitAt(u, v);
      if (!hit) continue;
      annotations.push(toAnno(T.text, T.dx, T.dy, hit, 'anno_v01_' + (i + 1)));
      placed.push({ text: T.text, u: +u.toFixed(3), v: +v.toFixed(3), edgeU: +edgeU.toFixed(3), localX: +root.worldToLocal(hit.point.clone()).x.toFixed(3) });
    }

    const pts = [];
    for (let t = 0; t <= 22; t++) {
      const v = 0.2 + (0.72 - 0.2) * (t / 22);
      const s = nearest(v);
      const hit = hitAt(s.u + 0.002, s.v);
      if (!hit) continue;
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
      debug: { uniq, brow, zyg, placed },
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
    // 近正面 Loop：光在一侧，环影在鼻旁暗侧；交界带贴颊上明暗过渡
    const labels = [
      { text: '鼻侧环影', u: 0.51, v: 0.48, dx: 95, dy: -28 },
      { text: '亮面', u: 0.42, v: 0.40, dx: -95, dy: -48 },
      { text: '颊影未接', u: 0.56, v: 0.50, dx: 110, dy: 8 },
      { text: '交界带', u: 0.54, v: 0.53, dx: 105, dy: 32 }
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

  // clean shots first
  for (const id of ['V01', 'L01']) {
    await openScene(page, id);
    await page.evaluate(() => {
      window.showAnnotations = false;
      ['annotation-layer', 'dashed-line-layer', 'dashed-line-svg'].forEach((lid) => {
        const n = document.getElementById(lid);
        if (n) n.style.display = 'none';
      });
    });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(outDir, `${id}-clean.png`), timeout: 60000 });
  }

  await openScene(page, 'V01');
  const p1 = await pickV01(page);
  fs.writeFileSync(path.join(outDir, 'V01-pick.json'), JSON.stringify(p1, null, 2));
  console.log('V01', p1.hitLabels, 'bulges', (p1.debug && p1.debug.uniq) || []);
  if (p1.ok) {
    const f = loadSceneFile('101');
    f.data.items[0].annotations = p1.annotations;
    f.data.items[0].dashedLines = p1.dashedLines;
    // keep patched camera/meta
    f.data.camera = file101.data.camera;
    f.data.meta.detail = file101.data.meta.detail;
    f.data.meta.keyPoints = file101.data.meta.keyPoints;
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
    f.data.meta.detail = file201.data.meta.detail;
    f.data.meta.keyPoints = file201.data.meta.keyPoints;
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
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(outDir, `${id}-annotated.png`), timeout: 60000 });
  }

  console.log('OUT', outDir);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
