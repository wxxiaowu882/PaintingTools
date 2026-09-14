/**
 * 207 / L07：逆光 · 轮廓光（Rim）打底
 *
 * 路线图钉子：外缘一圈亮边 / 逆光镶边。
 * - 光在头后（偏背），正面或侧前取景时脸大体暗，外轮廓一带亮边可读
 * - 短曲线 + 圆标钉在可见亮边经过的结构段（非外轮廓视角主课）
 * - 权威以 Create 手调为准；本脚本只做打底 + 截图供 AI 视觉
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const sharp = require('sharp');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-headform-207`);
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:18080';
fs.mkdirSync(outDir, { recursive: true });

const MODEL = '/docs/model/石膏头像_男中青年_大本 蝙蝠侠 布鲁斯韦恩_头像_opt.glb';
const FILE_NAME = '207_【光位】逆光 · 轮廓光（Rim）.json';

/** 近侧（画面右缘）亮边分段：上→下 —— 本打底光把镶边打在可见的近侧外缘 */
const RIM_SPECS = [
  { id: '1', name: '颅顶亮边', vBand: [0.14, 0.24], color: '#bfbfbf', dx: 72, dy: -18 },
  { id: '2', name: '额颞亮边', vBand: [0.24, 0.34], color: '#bfbfbf', dx: 78, dy: -6 },
  { id: '3', name: '耳上亮边', vBand: [0.34, 0.44], color: '#bfbfbf', dx: 84, dy: 4 },
  { id: '4', name: '耳轮亮边', vBand: [0.44, 0.54], color: '#bfbfbf', dx: 86, dy: 12 },
  { id: '5', name: '下颌后亮边', vBand: [0.54, 0.64], color: '#bfbfbf', dx: 80, dy: 22 },
  { id: '6', name: '颈侧亮边', vBand: [0.64, 0.76], color: '#bfbfbf', dx: 74, dy: 34 }
];

function loadPref(prefix) {
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
  fs.writeFileSync(
    path.join(jsonDir, '沙盒_头部造型规律.json'),
    JSON.stringify(files.map((fn) => JSON.parse(fs.readFileSync(path.join(jsonDir, fn), 'utf8')))) + '\n'
  );
  return files.length;
}

function plainToRich(text) {
  return text
    .split('\n')
    .map((line) => {
      const t = line.trim();
      if (/^【/.test(t) || /^[①②③④⑤⑥⑦⑧⑨]+\./.test(t) || /^\d+\./.test(t)) {
        return '<strong>' + line + '</strong>';
      }
      return line;
    })
    .join('<br>');
}

function bezChain(annos) {
  const lines = [];
  for (let i = 0; i < annos.length - 1; i++) {
    const a = annos[i];
    const b = annos[i + 1];
    lines.push({
      id: 'dash_l07_' + a.text + '_' + b.text,
      color: '#9a9a9a',
      kind: 'bezier',
      strokeWidth: 2.2,
      capR: 1,
      opacity: 0.8,
      points: [
        {
          pos: [...a.localPos],
          norm: [...a.localNormal],
          handleOut: [
            (b.localPos[0] - a.localPos[0]) * 0.22,
            (b.localPos[1] - a.localPos[1]) * 0.2,
            (b.localPos[2] - a.localPos[2]) * 0.22
          ]
        },
        {
          pos: [...b.localPos],
          norm: [...b.localNormal],
          handleIn: [
            (a.localPos[0] - b.localPos[0]) * 0.22,
            (a.localPos[1] - b.localPos[1]) * 0.2,
            (a.localPos[2] - b.localPos[2]) * 0.22
          ]
        }
      ]
    });
  }
  return lines;
}

function buildCopy() {
  const keyPoints = [
    '本场景只看逆光这一档光线下，头外缘的「轮廓亮边」怎么走。交界（这里主要是亮边）主要跟「光线和头的夹角」有关，和我们观察的角度无关——你可以转动场景，换几个角度看这条亮边。',
    '',
    '请不要改变当前光线的方向、高低等参数，因为这会影响本场景的教学观感。如有误改，点「重置」把光（和本场景默认状态）恢复即可。如果您不小心转动了视角，也请点击重置按钮恢复视角。',
    '',
    '先看表象：光在头后方（略偏一侧也常见），脸朝我们的一面大体发暗；真正抢眼的是外轮廓一带一圈（或半圈）亮边——影视/摄影里常叫轮廓光、镶边光。亮边贴着形体外缘走，不是脸心再划一条明暗交界。',
    '',
    '本场景的标注用短曲线勾在看得见的亮边上；圆标只是给各段编号。看见亮边怎么拐，也能反推颅顶、颞侧、耳廓与下颌—颈的外缘转折。',
    '',
    '各段亮边名称如下：',
    '',
    '①.颅顶亮边',
    '',
    '②.额颞亮边',
    '',
    '③.耳上亮边',
    '',
    '④.耳轮亮边',
    '',
    '⑤.下颌后亮边',
    '',
    '⑥.颈侧亮边',
    '',
    '可点击操作面板上的眼睛图标来隐藏标注，更干净地观察轮廓亮边。'
  ].join('\n');
  return {
    detail: '逆光轮廓光：脸大体暗，外缘一圈（或半圈）亮边。侧前取景，短曲线标颅顶—额颞—耳—下颌后—颈侧亮边。',
    keyPoints,
    keyPointsRich: plainToRich(keyPoints)
  };
}

function seedBase(from206) {
  const copy = buildCopy();
  return {
    id: 'L07',
    name: '【光位】逆光 · 轮廓光（Rim）',
    thumbnail: from206.thumbnail || '',
    // 侧前取景（同 101 族）：脸朝我们大体暗，远端（画面左）外缘镶边可读
    camera: {
      pos: [3.75, 0.95, 5.45],
      target: [-0.04, 0.82, 0.04],
      zoom: 0.56,
      fov: 15
    },
    // 正后略偏：az270=头后；略偏 285 让远端（画面左缘）镶边更稳
    light: {
      type: 'point',
      azimuth: 285,
      elevation: 22,
      distance: 16,
      temp: 34,
      size: 7,
      intensity: 2.7
    },
    env: {
      ...(from206.env || {}),
      hasWall: false,
      defaultMat: 'origin',
      groundColor: '#8a8885',
      skyColor: '#0d0d0f',
      skyLightScale: 0.18,
      lightIndicatorEnabled: false,
      noInterModelShadow: false
    },
    crop: {
      display: 'block',
      left: '420px',
      top: '60px',
      width: '760px',
      height: '760px'
    },
    items: [
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
    ],
    groundAnnotations: [],
    groundNormArrows: [],
    groundPolygon3ds: [],
    groundColorSampleAnnotations: [],
    meta: {
      line: 'light',
      slot: 'L07',
      status: 'seeded',
      detail: copy.detail,
      keyPoints: copy.keyPoints,
      keyPointsRich: copy.keyPointsRich
    }
  };
}

async function scrubUI(page) {
  await page.evaluate(() => {
    try {
      if (typeof window.stopRender === 'function') window.stopRender();
    } catch (e) {}
    window.useAdvancedRender = false;
    window.perfTestDone = true;
    const hide = (el) => {
      if (!el) return;
      el.style.display = 'none';
      el.style.visibility = 'hidden';
      el.style.opacity = '0';
      el.style.pointerEvents = 'none';
    };
    hide(document.getElementById('scene-loader'));
    hide(document.getElementById('scene-grid-modal'));
    document.querySelectorAll('#scene-grid-modal, .scene-grid-modal, [id*="scene-grid"]').forEach(hide);
    document.querySelectorAll('body *').forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      const t = (el.textContent || '').trim();
      if (/^(正在计算光影|首帧渲染中|光影探针|即将完成|已进入写生|画面渲染中)/.test(t) && t.length < 50) {
        hide(el);
      }
      if (t === '学习场景' && el.children && el.children.length > 2) {
        // 场景选择大面板：藏掉整层祖先
        let p = el;
        for (let i = 0; i < 6 && p; i++) {
          if (p.id === 'scene-grid-modal' || (p.style && p.style.position === 'fixed')) hide(p);
          p = p.parentElement;
        }
      }
    });
  });
}

async function bootL07(page) {
  await page.goto(`${baseUrl}/Solid.html?sandbox=headform&skipPerf=1&_=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 90000
  });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    window.useAdvancedRender = false;
    window.perfTestDone = true;
    if (window.loadJSONData) window.loadJSONData();
  });
  await page.waitForFunction(
    () => (window.customScenes || []).length > 0 && window.__solidHost && window.__solidHost.getCamera(),
    null,
    { timeout: 90000 }
  );
  await page.evaluate(() => {
    const m = document.getElementById('scene-grid-modal');
    if (m) {
      m.style.display = 'none';
      m.style.visibility = 'hidden';
    }
    const i = window.customScenes.findIndex((s) => s && s.id === 'L07');
    window.currentSceneIndex = -1;
    window.switchScene(i);
  });
  for (let i = 0; i < 90; i++) {
    const n = await page.evaluate(() => {
      let c = 0;
      try {
        window.__solidHost.getSceneGroup().traverse((o) => {
          if (o.isMesh) c++;
        });
      } catch (e) {}
      return c;
    });
    if (n > 0) break;
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(2200);
  await scrubUI(page);
}

async function captureCrop(page, name) {
  await scrubUI(page);
  await page.waitForTimeout(200);
  const buf = await page.screenshot({ type: 'png' });
  const fullPath = path.join(outDir, name);
  fs.writeFileSync(fullPath, buf);
  return fullPath;
}

/** 右缘剪影：先找头对黑底的最右像素，再在邻域挑最亮（镶边） */
async function findRimUVs(cleanPng) {
  const { data, info } = await sharp(cleanPng).raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const lum = (x, y) => {
    const i = (y * W + x) * info.channels;
    return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  };
  const hits = [];
  for (const spec of RIM_SPECS) {
    const y0 = Math.floor(spec.vBand[0] * H);
    const y1 = Math.floor(spec.vBand[1] * H);
    let best = null;
    for (let y = y0; y < y1; y += 2) {
      let edgeX = -1;
      for (let x = Math.floor(W * 0.72); x > Math.floor(W * 0.48); x--) {
        if (lum(x, y) > 16) {
          edgeX = x;
          break;
        }
      }
      if (edgeX < 0) continue;
      // 边缘向内 0～18px 找最亮（轮廓光贴外缘）；避开右侧 UI
      for (let dx = 0; dx <= 18; dx++) {
        const x = edgeX - dx;
        if (x < Math.floor(W * 0.45)) break;
        const L = lum(x, y);
        const inward = lum(Math.max(0, x - 10), y);
        if (L < 28) continue;
        const rimScore = L - inward * 0.3 - dx * 1.6;
        if (!best || rimScore > best.rimScore) {
          best = { x, y, L, rimScore, edgeX };
        }
      }
    }
    if (!best) {
      hits.push({ id: spec.id, ok: false });
      continue;
    }
    hits.push({
      id: spec.id,
      ok: true,
      px: best.x,
      py: best.y,
      u: best.x / W,
      v: best.y / H,
      L: +best.L.toFixed(1),
      edgeX: best.edgeX
    });
  }
  // 可视化探针
  const overlay = Buffer.from(data);
  for (const h of hits) {
    if (!h.ok) continue;
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        const xx = h.px + dx;
        const yy = h.py + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const i = (yy * W + xx) * info.channels;
        overlay[i] = 255;
        overlay[i + 1] = 40;
        overlay[i + 2] = 40;
      }
    }
  }
  await sharp(overlay, { raw: { width: W, height: H, channels: info.channels } })
    .png()
    .toFile(path.join(outDir, 'probe-rim-marks.png'));
  return hits;
}

async function placeFromHits(page, hits) {
  return page.evaluate(
    ({ specs, hits }) => {
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
      const lp = new THREE.Vector3();
      const byId = Object.fromEntries(hits.filter((h) => h.ok).map((h) => [h.id, h]));
      const annotations = [];
      const dbg = [];
      for (const spec of specs) {
        const h = byId[spec.id];
        if (!h) {
          dbg.push({ id: spec.id, ok: false, reason: 'no-uv' });
          continue;
        }
        let best = null;
        for (let du = -0.012; du <= 0.012; du += 0.003) {
          for (let dv = -0.01; dv <= 0.01; dv += 0.004) {
            const u = h.u + du;
            const v = h.v + dv;
            raycaster.setFromCamera(new THREE.Vector2(u * 2 - 1, -(v * 2 - 1)), cam);
            const hit = raycaster.intersectObjects(meshes, true)[0];
            if (!hit || !hit.face) continue;
            lp.copy(hit.point);
            root.worldToLocal(lp);
            // 101 侧前 + 背偏右光：近侧镶边在模型 +x
            if (lp.x < 0.01) continue;
            const nw = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
            const localNormal = root.worldToLocal(hit.point.clone().add(nw)).sub(lp.clone()).normalize();
            const score = Math.abs(du) * 12 + Math.abs(dv) * 12 + Math.max(0, 0.09 - lp.x) * 10;
            if (!best || score < best.score) {
              best = {
                score,
                hit,
                localPos: [+lp.x.toFixed(4), +lp.y.toFixed(4), +lp.z.toFixed(4)],
                localNormal: [+localNormal.x.toFixed(3), +localNormal.y.toFixed(3), +localNormal.z.toFixed(3)]
              };
            }
          }
        }
        if (!best) {
          dbg.push({ id: spec.id, ok: false, reason: 'no-hit' });
          continue;
        }
        annotations.push({
          id: 'anno_l07_' + spec.id,
          annotationKind: 'leader',
          text: spec.id,
          detailText: '',
          collapsed: false,
          color: spec.color,
          dx: spec.dx,
          dy: spec.dy,
          dxN: 0,
          dyN: 0,
          dxW: 0,
          dyW: 0,
          localPos: best.localPos,
          localNormal: best.localNormal,
          baseDist: +best.hit.distance.toFixed(4),
          baseScale: 5.8,
          occludeDot: -0.35,
          labelShape: 'circle'
        });
        dbg.push({ id: spec.id, ok: true, localPos: best.localPos });
      }
      return { annotations, dbg };
    },
    { specs: RIM_SPECS, hits }
  );
}

async function main() {
  const from206 = loadPref('206_').data;
  const seeded = seedBase(from206);
  const outPath = path.join(jsonDir, FILE_NAME);
  fs.writeFileSync(outPath, JSON.stringify(seeded) + '\n');
  rebuildAggregate();
  console.log('wrote seed', FILE_NAME);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await bootL07(page);

  // 先关标注拍干净图做镶边探针
  await page.evaluate(() => {
    if (window.showAnnotations !== false && typeof window.toggleAnnotations === 'function') {
      window.toggleAnnotations();
    }
  });
  await page.waitForTimeout(400);
  const cleanPath = await captureCrop(page, 'L07-clean-probe.png');
  const hits = await findRimUVs(cleanPath);
  console.log('rimHits', JSON.stringify(hits, null, 2));

  const placed = await placeFromHits(page, hits);
  console.log('placed', JSON.stringify(placed.dbg, null, 2));

  const data = JSON.parse(fs.readFileSync(outPath, 'utf8'));
  data.id = 'L07';
  data.items[0].annotations = placed.annotations;
  data.items[0].dashedLines = bezChain(placed.annotations);
  const copy = buildCopy();
  data.meta = {
    ...(data.meta || {}),
    line: 'light',
    slot: 'L07',
    status: 'seeded',
    detail: copy.detail,
    keyPoints: copy.keyPoints,
    keyPointsRich: copy.keyPointsRich
  };
  fs.writeFileSync(outPath, JSON.stringify(data) + '\n');
  rebuildAggregate();

  // 热重载再截图
  await page.evaluate(() => {
    if (window.loadJSONData) window.loadJSONData();
  });
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const m = document.getElementById('scene-grid-modal');
    if (m) {
      m.style.display = 'none';
      m.style.visibility = 'hidden';
    }
    const i = window.customScenes.findIndex((s) => s && s.id === 'L07');
    window.currentSceneIndex = -1;
    window.switchScene(i);
  });
  await page.waitForTimeout(2200);
  await scrubUI(page);
  await page.waitForTimeout(300);
  await scrubUI(page);

  await page.evaluate(() => {
    if (window.showAnnotations === false && typeof window.toggleAnnotations === 'function') {
      window.toggleAnnotations();
    }
  });
  await page.waitForTimeout(400);
  await captureCrop(page, 'L07-annotated.png');

  await page.evaluate(() => {
    if (window.showAnnotations !== false && typeof window.toggleAnnotations === 'function') {
      window.toggleAnnotations();
    }
  });
  await page.waitForTimeout(400);
  await captureCrop(page, 'L07-clean.png');

  console.log('out', outDir);
  console.log('annos', placed.annotations.length, 'dashes', data.items[0].dashedLines.length);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
