/**
 * 106：略俯 · 外轮廓打底
 * - 正面略抬高机位（非顶视）；柔正前光
 * - 左缘钉 1–5 凸 + 关键凹 A（对照平视正面：头顶更大、下颌更厚）
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-headform-106`);
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
  d.name = '【视角】略俯 · 外轮廓';
  // 略俯：机位抬高、略前移，俯角约 25°（非 109 顶视）
  d.camera = {
    pos: [0.04, 2.85, 4.15],
    target: [0.0, 0.86, 0.02],
    zoom: 0.56,
    fov: 16
  };
  d.light = {
    type: 'point',
    azimuth: 90,
    elevation: 28,
    distance: 16,
    temp: 34,
    size: 24,
    intensity: 2.0
  };
  d.env = d.env || {};
  d.env.hasWall = false;
  d.env.defaultMat = 'origin';
  d.env.skyLightScale = 0.85;
  d.env.groundColor = '#bdb8b0';
  d.env.skyColor = '#0d0d0f';
  d.crop = {
    display: 'block',
    left: '500px',
    top: '120px',
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
      '略俯·外轮廓。正面略抬高机位；柔正前光；左缘钉 1–5 凸与关键凹 A；对照平视正面：头顶变大、下颌变厚；不连虚线。',
    keyPoints: '【打底中】略俯：头顶变大、下颌变厚。'
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
    if (i < 0) i = (window.customScenes || []).findIndex((s) => s && String(s.name || '').includes('略俯'));
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

    // 略俯正面：左缘仍取 localX 最负且够靠前（避开耳）
    function faceLeft(v, zMin) {
      let best = null;
      for (let u = 0.26; u <= 0.56; u += 0.005) {
        const hit = hitAt(u, v);
        if (!hit) continue;
        _lp.copy(hit.point);
        root.worldToLocal(_lp);
        if (_lp.x > 0.008) continue;
        if (_lp.z < zMin) continue;
        if (!best || _lp.x < best.x) best = { u, hit, x: _lp.x, y: _lp.y, z: _lp.z, v };
      }
      return best;
    }

    function bestInBand(v0, v1, zMin, mode) {
      let best = null;
      for (let v = v0; v <= v1; v += 0.012) {
        const s = faceLeft(v, zMin);
        if (!s) continue;
        const rec = { ...s, v: +v.toFixed(3) };
        if (!best) best = rec;
        else if (mode === 'mostNegX' && rec.x < best.x) best = rec;
        else if (mode === 'highestY' && rec.y > best.y) best = rec;
        else if (mode === 'chin' && rec.y < best.y && rec.z > 0.015) best = rec;
      }
      return best;
    }

    function midRecess(a, b, zMin) {
      if (!a || !b) return null;
      const v0 = Math.min(a.v, b.v);
      const v1 = Math.max(a.v, b.v);
      let best = null;
      for (let v = v0 + 0.015; v < v1 - 0.015; v += 0.012) {
        const s = faceLeft(v, zMin);
        if (!s) continue;
        if (!best || s.x > best.x) best = { ...s, v: +v.toFixed(3) };
      }
      return best;
    }

    // 略俯：头顶占屏更多，v 带略上移；下颌带加宽强调「变厚」
    const c1 = bestInBand(0.16, 0.26, -0.06, 'highestY');
    const c2 = bestInBand(0.28, 0.36, -0.03, 'mostNegX');
    const c3 = bestInBand(0.4, 0.5, 0.0, 'mostNegX');
    const c4 = bestInBand(0.52, 0.62, 0.0, 'mostNegX');
    let c5 = bestInBand(0.64, 0.76, 0.02, 'chin');
    if (!c5) c5 = bestInBand(0.64, 0.76, 0.0, 'mostNegX');
    const aJaw = midRecess(c4, c5, 0.015);

    function toAnno(text, color, dx, dy, hit, id) {
      const world = hit.point.clone();
      const localPos = root.worldToLocal(world.clone());
      let nWorld = new THREE.Vector3(-1, 0.15, 0.35);
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
      { id: '1', name: '颅顶结节', s: c1, dx: -98, dy: -28 },
      { id: '2', name: '颅侧结节', s: c2, dx: -108, dy: -8 },
      { id: '3', name: '颧骨弓隆起', s: c3, dx: -112, dy: 8 },
      { id: '4', name: '颊转角（下颌外缘变厚感）', s: c4, dx: -110, dy: 22 },
      { id: '5', name: '颏结节', s: c5, dx: -100, dy: 40 }
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
    if (aJaw && aJaw.hit) {
      annotations.push(toAnno('A', '#d6d6d6', -72, 30, aJaw.hit, 'anno_v06_A'));
      placed.push({
        text: 'A',
        name: '角前切迹',
        u: +aJaw.u.toFixed(3),
        v: aJaw.v,
        x: +aJaw.x.toFixed(3),
        y: +aJaw.y.toFixed(3),
        z: +aJaw.z.toFixed(3)
      });
    }

    return {
      ok: annotations.filter((a) => /^[1-5]$/.test(a.text)).length >= 5,
      annotations,
      debug: { placed },
      hitLabels: annotations.map((a) => a.text)
    };
  });
}

async function captureThumb(page) {
  // crop box region if present
  const box = await page.evaluate(() => {
    const el = document.getElementById('crop-box');
    if (!el || el.style.display === 'none') return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  const shotPath = path.join(outDir, 'V06-annotated.png');
  if (box && box.width > 40 && box.height > 40) {
    await page.screenshot({
      path: shotPath,
      clip: {
        x: Math.max(0, box.x),
        y: Math.max(0, box.y),
        width: Math.min(box.width, 1280),
        height: Math.min(box.height, 800)
      }
    });
  } else {
    await page.screenshot({ path: shotPath });
  }
  return shotPath;
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
    '略俯是眼平再抬高一点：不是顶视，但头顶会显得更大，下颌外缘也会显得更厚。请与「正面 · 外轮廓」对照——同一颗头，只换俯角，外轮廓比例就变。如果您不小心转动了视角，请点击重置按钮恢复视角。',
    '本关只看外轮廓：盯画面左缘这条起伏；重点感受「顶变大、颌变厚」，不要当成明暗课。',
    '请看场景中的标注，1–5 是轮廓上的凸起，A 是本视角下较重要的凹陷（不凑数）。',
    '实际中每个人凹凸强弱不同，创作时先有这些点位的框架，再按个体强化、弱化或省略。',
    '',
    '点位名称如下：',
    '1.颅顶结节',
    '2.颅侧结节',
    '3.颧骨弓隆起',
    '4.颊转角（下颌外缘变厚感）',
    '5.颏结节',
    'A.角前切迹（咬肌前切迹）'
  ].join('\n');

  const f = loadFile('106_');
  f.data.items[0].annotations = p.annotations;
  f.data.items[0].dashedLines = [];
  f.data.meta.status = 'wip';
  f.data.meta.detail =
    '略俯·外轮廓。正面略抬高机位；柔正前光；左缘钉 1–5 凸与关键凹 A；对照平视正面：头顶变大、下颌变厚；不连虚线。';
  f.data.meta.keyPoints = keyPoints;
  fs.writeFileSync(f.full, JSON.stringify(f.data) + '\n');
  console.log('merged', rebuildAggregate());

  // reload so labels render from JSON
  await boot(page);
  await openV06(page);
  await page.evaluate(() => {
    window.showAnnotations = true;
  });
  await page.waitForTimeout(1000);
  const shot = await captureThumb(page);
  // also full frame
  await page.screenshot({ path: path.join(outDir, 'V06-annotated-full.png') });
  console.log('OUT', outDir, shot);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
