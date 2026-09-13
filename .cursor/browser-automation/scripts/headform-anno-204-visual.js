/** 204-visual：按截图像素梯度找视觉明暗交界，再射线钉点（禁止沉暗部） */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const sharp = require('sharp');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-headform-204-visual`);
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:18080';
fs.mkdirSync(outDir, { recursive: true });

function load204() {
  const f = fs.readdirSync(jsonDir).find((n) => n.startsWith('204_') && n.endsWith('.json'));
  const full = path.join(jsonDir, f);
  return { f, full, data: JSON.parse(fs.readFileSync(full, 'utf8')) };
}
function rebuild() {
  const files = fs
    .readdirSync(jsonDir)
    .filter((fn) => /^\d+[A-Za-z]?_.+\.json$/i.test(fn))
    .sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));
  fs.writeFileSync(
    path.join(jsonDir, '沙盒_头部造型规律.json'),
    JSON.stringify(files.map((fn) => JSON.parse(fs.readFileSync(path.join(jsonDir, fn), 'utf8')))) + '\n'
  );
}

const SPECS = [
  { id: '1', text: '1', color: '#bfbfbf', yFrac: 0.22, dx: -50, dy: -28 },
  { id: '2', text: '2', color: '#bfbfbf', yFrac: 0.30, dx: -50, dy: -8 },
  { id: '3', text: '3', color: '#bfbfbf', yFrac: 0.38, dx: -55, dy: 0 },
  { id: '4', text: '4', color: '#bfbfbf', yFrac: 0.48, dx: -50, dy: 5 },
  { id: '5', text: '5', color: '#bfbfbf', yFrac: 0.58, dx: -50, dy: 12 },
  { id: '6', text: '6', color: '#bfbfbf', yFrac: 0.68, dx: -40, dy: 22 },
  { id: '7', text: '7', color: '#bfbfbf', yFrac: 0.78, dx: -20, dy: 40 },
  { id: 'A', text: 'A', color: '#197657', yFrac: 0.36, dx: 48, dy: -16, eye: true },
  { id: 'B', text: 'B', color: '#197657', yFrac: 0.42, dx: 48, dy: 12, eye: true }
];

function bezSeg(id, a, b) {
  if (!a || !b) return null;
  return {
    id,
    color: '#7a7a7a',
    kind: 'bezier',
    strokeWidth: 2.5,
    capR: 1,
    points: [
      {
        pos: [...a.localPos],
        norm: [...a.localNormal],
        handleOut: [
          (b.localPos[0] - a.localPos[0]) * 0.2,
          (b.localPos[1] - a.localPos[1]) * 0.25,
          (b.localPos[2] - a.localPos[2]) * 0.12
        ]
      },
      {
        pos: [...b.localPos],
        norm: [...b.localNormal],
        handleIn: [
          (a.localPos[0] - b.localPos[0]) * 0.2,
          (a.localPos[1] - b.localPos[1]) * 0.25,
          (a.localPos[2] - b.localPos[2]) * 0.12
        ]
      }
    ]
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
      el.style.opacity = '0';
    };
    hide(document.getElementById('scene-loader'));
    document.querySelectorAll('body *').forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      const t = (el.textContent || '').trim();
      if (/^(正在计算光影|首帧渲染中|光影探针|已进入写生)/.test(t) && t.length < 50) hide(el);
    });
  });
}

/** 粗估脸在图中的左右范围（非黑背景列） */
function findFaceXRange(raw, W, H) {
  const colBright = new Float32Array(W);
  for (let y = Math.floor(H * 0.15); y < Math.floor(H * 0.85); y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      const l = 0.299 * raw[i] + 0.587 * raw[i + 1] + 0.114 * raw[i + 2];
      colBright[x] += l;
    }
  }
  const rows = Math.floor(H * 0.7);
  let thresh = 0;
  for (let x = 0; x < W; x++) thresh += colBright[x];
  thresh = (thresh / W) * 0.35;
  let left = 0;
  let right = W - 1;
  for (let x = 0; x < W; x++) {
    if (colBright[x] / rows > thresh) {
      left = x;
      break;
    }
  }
  for (let x = W - 1; x >= 0; x--) {
    if (colBright[x] / rows > thresh) {
      right = x;
      break;
    }
  }
  if (right - left < W * 0.15) {
    left = Math.floor(W * 0.2);
    right = Math.floor(W * 0.55);
  }
  return { left, right, mid: (left + right) / 2 };
}

/** 在一行像素里找暗→亮最大梯度（视觉交界）；略偏亮侧 */
function findTerminatorX(row, width, opts) {
  const { x0, x1, eye, preferX } = opts;
  let bestX = -1;
  let bestScore = -1e9;
  for (let x = x0 + 2; x < x1 - 2; x++) {
    const i0 = (x - 2) * 3;
    const i1 = (x + 2) * 3;
    const l0 = 0.299 * row[i0] + 0.587 * row[i0 + 1] + 0.114 * row[i0 + 2];
    const l1 = 0.299 * row[i1] + 0.587 * row[i1 + 1] + 0.114 * row[i1 + 2];
    const g = l1 - l0;
    if (g < 2) continue;
    let score = g;
    if (preferX != null) score -= Math.abs(x - preferX) * 0.12;
    if (score > bestScore) {
      bestScore = score;
      bestX = x;
    }
  }
  if (bestX < 0) return null;
  const push = eye ? 1 : 3;
  return Math.min(x1 - 1, bestX + push);
}

(async () => {
  const file0 = load204();
  // 略收软光，交界更利落，便于钉缘
  Object.assign(file0.data.light, { azimuth: 10, elevation: 20, size: 7, intensity: 2.3 });
  file0.data.id = 'L04';
  file0.data.meta = Object.assign({}, file0.data.meta, { line: 'light', slot: 'L04', status: 'seeded' });
  fs.writeFileSync(file0.full, JSON.stringify(file0.data) + '\n');
  rebuild();

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${baseUrl}/Solid.html?sandbox=headform&skipPerf=1&_=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 120000
  });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    window.useAdvancedRender = false;
    window.perfTestDone = true;
    try {
      if (typeof window.stopRender === 'function') window.stopRender();
    } catch (e) {}
    if (window.loadJSONData) window.loadJSONData();
  });
  await page.waitForFunction(() => (window.customScenes || []).length > 0, null, { timeout: 120000 });
  await page.waitForFunction(() => !!(window.__solidHost && window.__solidHost.getCamera), null, {
    timeout: 120000
  });
  await page.evaluate(() => {
    const m = document.getElementById('scene-grid-modal');
    if (m) m.style.display = 'none';
    let i = (window.customScenes || []).findIndex((s) => s && s.id === 'L04');
    if (i < 0) i = (window.customScenes || []).findIndex((s) => s && /阴阳对半|Split/i.test(String(s.name || '')));
    window.currentSceneIndex = -1;
    window.switchScene(i);
  });
  for (let i = 0; i < 100; i++) {
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
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(2500);
  for (let k = 0; k < 8; k++) {
    await scrubUI(page);
    await page.waitForTimeout(250);
  }

  const crop = await page.evaluate(() => {
    const s = (window.customScenes || []).find((x) => x && x.id === 'L04');
    const c = (s && s.crop) || {};
    const canvas =
      document.querySelector('canvas') ||
      (window.__solidHost && window.__solidHost.getRenderer && window.__solidHost.getRenderer().domElement);
    const r = canvas.getBoundingClientRect();
    return {
      x: Math.round(parseFloat(c.left) || 450),
      y: Math.round(parseFloat(c.top) || 90),
      width: Math.round(parseFloat(c.width) || 760),
      height: Math.round(parseFloat(c.height) || 720),
      canvas: { left: r.left, top: r.top, width: r.width, height: r.height }
    };
  });
  console.log('crop/canvas', crop);

  await page.evaluate(() => {
    if (window.showAnnotations !== false && typeof window.toggleAnnotations === 'function') window.toggleAnnotations();
  });
  await scrubUI(page);
  await page.waitForTimeout(500);
  const lightOnlyPath = path.join(outDir, 'probe-light.png');
  await page.screenshot({ path: lightOnlyPath, clip: crop });

  const { data, info } = await sharp(lightOnlyPath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const face = findFaceXRange(data, W, H);
  console.log('faceX', face);
  const uvHits = [];
  let preferX = Math.round(face.mid);
  for (const spec of SPECS) {
    const y0 = Math.round(spec.yFrac * H);
    const rows = [y0 - 3, y0 - 1, y0, y0 + 1, y0 + 3].filter((y) => y >= 2 && y < H - 2);
    // 只在脸宽内搜交界；主线约在脸中线附近，眼支线略偏暗侧
    const x0 = Math.round(face.left + (face.right - face.left) * (spec.eye ? 0.15 : 0.25));
    const x1 = Math.round(face.left + (face.right - face.left) * (spec.eye ? 0.62 : 0.72));
    const xs = [];
    for (const y of rows) {
      const row = data.subarray(y * W * 3, (y + 1) * W * 3);
      const x = findTerminatorX(row, W, { x0, x1, eye: !!spec.eye, preferX });
      if (x != null) xs.push(x);
    }
    if (!xs.length) {
      if (preferX != null) {
        const pageX = crop.x + preferX + 0.5;
        const pageY = crop.y + y0 + 0.5;
        const u = (pageX - crop.canvas.left) / crop.canvas.width;
        const v = (pageY - crop.canvas.top) / crop.canvas.height;
        uvHits.push({ id: spec.id, ok: true, u, v, px: preferX, py: y0, fallback: true });
        continue;
      }
      uvHits.push({ id: spec.id, ok: false });
      continue;
    }
    xs.sort((a, b) => a - b);
    const x = xs[Math.floor(xs.length / 2)];
    if (!spec.eye) preferX = x;
    const pageX = crop.x + x + 0.5;
    const pageY = crop.y + y0 + 0.5;
    const u = (pageX - crop.canvas.left) / crop.canvas.width;
    const v = (pageY - crop.canvas.top) / crop.canvas.height;
    uvHits.push({ id: spec.id, ok: true, u, v, px: x, py: y0 });
  }
  console.log('uvHits', JSON.stringify(uvHits, null, 2));
  if (uvHits.some((h) => !h.ok)) throw new Error('pixel term miss: ' + uvHits.filter((h) => !h.ok).map((h) => h.id).join(','));

  const placed = await page.evaluate(
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
      const byId = Object.fromEntries(hits.map((h) => [h.id, h]));
      const annotations = [];
      const dbg = [];
      for (const spec of specs) {
        const h = byId[spec.id];
        if (!h || !h.ok) {
          dbg.push({ id: spec.id, ok: false });
          continue;
        }
        // 在像素点附近微扫，取最靠前的命中
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
            if (lp.z < 0.01) continue;
            // 交界应在中线附近偏暗侧，惩罚跑到大亮侧(+X)
            const score = -lp.z * 2 + Math.max(0, lp.x - 0.02) * 8 + Math.abs(du) + Math.abs(dv);
            if (!best || score < best.score) {
              let nw = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
              const localNormal = root.worldToLocal(hit.point.clone().add(nw)).sub(lp.clone()).normalize();
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
          dbg.push({ id: spec.id, ok: false, reason: 'ray' });
          continue;
        }
        annotations.push({
          id: 'anno_l04_' + spec.id,
          annotationKind: 'leader',
          text: spec.text,
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
        dbg.push({ id: spec.id, ok: true, xyz: best.localPos, uv: [h.u, h.v] });
      }
      return { ok: annotations.length === specs.length, annotations, dbg };
    },
    { specs: SPECS, hits: uvHits }
  );

  console.log(JSON.stringify(placed.dbg, null, 2));
  if (!placed.ok) throw new Error('ray incomplete');

  const by = Object.fromEntries(placed.annotations.map((a) => [a.text, a]));
  const chain = ['1', '2', '3', '4', '5', '6', '7'];
  const dashedLines = [];
  for (let i = 0; i < chain.length - 1; i++) {
    const seg = bezSeg('dash_l04_' + chain[i] + '_' + chain[i + 1], by[chain[i]], by[chain[i + 1]]);
    if (seg) dashedLines.push(seg);
  }

  const file = load204();
  file.data.id = 'L04';
  file.data.items[0].annotations = placed.annotations;
  file.data.items[0].dashedLines = dashedLines;
  file.data.meta = Object.assign({}, file.data.meta, {
    line: 'light',
    slot: 'L04',
    status: 'seeded',
    detail: '正侧光：脸一半亮、一半暗；明暗交界沿着正侧面交界走得很长。',
    keyPoints:
      '本场景只看正侧这一档光线下，明暗交界怎么走。交界主要跟「光线和头的夹角」有关——请转动场景，换角度看这条长交界和关键结构点。请不要在操作面板中改变光线相关的设置，否则会影响本场景的教学观感；若不小心改了光的方向等参数，点「重置」恢复即可。\n\n' +
      '先看表象：光线几乎从正侧面打来时，脸常是一半亮、一半暗——戏剧感很强的「阴阳对半」。交界大致贴着脸的「正面与侧面」交界走，从额侧一直通到颏侧，往往比「环形」「伦勃朗」更长、更直一些。若暗颊上还留着一块三角亮，更接近上一档「伦勃朗」；若鼻旁小影还没接到颊侧大暗，则更接近「环形」。\n\n' +
      '本场景描述的对象就是这条明暗交界线：曲线勾出交界走向；圆标钉在交界线经过的关键结构点上（钉在交界缘上，不钉进大暗或大亮里）。知识上，正侧交界常经过：额结节外侧 → 眉峰 → 眶外角 → 颧突隆 → 颏结节。交界出现是因为有结构起伏；看见这条长交界怎么拐，也能反推正侧面大面交界。\n\n' +
      '各点位(或线位)名称如下：\n\n' +
      '【主交界线】（正侧长交界）\n' +
      '①.额结节外侧\n' +
      '②.眉峰\n' +
      '③.眶外角\n' +
      '④.颧突隆\n' +
      '⑤.口轮匝肌侧缘\n' +
      '⑥.颏结节\n' +
      '⑦.颏底\n\n' +
      '【支线 · 眼】\n' +
      'A.上眼睑交界\n' +
      'B.下眼睑上交界\n\n' +
      '可点击操作面板上的眼睛图标来隐藏标注，更干净地观察明暗交界线。'
  });
  fs.writeFileSync(file.full, JSON.stringify(file.data) + '\n');
  rebuild();

  await page.evaluate(() => {
    if (window.loadJSONData) window.loadJSONData();
  });
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    let i = (window.customScenes || []).findIndex((s) => s && s.id === 'L04');
    if (i < 0) i = (window.customScenes || []).findIndex((s) => s && /阴阳对半|Split/i.test(String(s.name || '')));
    window.currentSceneIndex = -1;
    window.switchScene(i);
  });
  await page.waitForTimeout(2200);
  for (let k = 0; k < 6; k++) {
    await scrubUI(page);
    await page.waitForTimeout(220);
  }

  await page.evaluate(() => {
    if (window.showAnnotations !== false && typeof window.toggleAnnotations === 'function') window.toggleAnnotations();
  });
  await scrubUI(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outDir, 'L04-light-only.png'), clip: crop });

  await page.evaluate(() => {
    if (window.showAnnotations !== true && typeof window.toggleAnnotations === 'function') window.toggleAnnotations();
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outDir, 'L04-annotated-crop.png'), clip: crop });

  await page.evaluate(() => {
    if (window.showAnnotations !== false && typeof window.toggleAnnotations === 'function') window.toggleAnnotations();
  });
  await page.waitForTimeout(300);
  const thumb = await page.screenshot({
    type: 'jpeg',
    quality: 72,
    clip: { x: crop.x + 20, y: crop.y + 20, width: 700, height: 700 }
  });
  const f2 = load204();
  f2.data.thumbnail = 'data:image/jpeg;base64,' + thumb.toString('base64');
  f2.data.id = 'L04';
  fs.writeFileSync(f2.full, JSON.stringify(f2.data) + '\n');
  rebuild();
  console.log('OUT', outDir);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
