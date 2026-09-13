/** 204-edge：用 light-only 截图像素梯度钉在视觉明暗交界缘上 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const sharp = require('sharp');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-headform-204-edge`);
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
  { id: '1', text: '1', color: '#bfbfbf', yFrac: 0.24, dx: 36, dy: -28 },
  { id: '2', text: '2', color: '#bfbfbf', yFrac: 0.32, dx: 36, dy: -10 },
  { id: 'A', text: 'A', color: '#197657', yFrac: 0.355, dx: -40, dy: -14, stickMain: true },
  { id: '3', text: '3', color: '#bfbfbf', yFrac: 0.41, dx: 38, dy: 0 },
  { id: 'B', text: 'B', color: '#197657', yFrac: 0.445, dx: -40, dy: 10, stickMain: true },
  { id: '4', text: '4', color: '#bfbfbf', yFrac: 0.50, dx: 36, dy: 6 },
  { id: '5', text: '5', color: '#bfbfbf', yFrac: 0.575, dx: 36, dy: 14 },
  { id: '6', text: '6', color: '#bfbfbf', yFrac: 0.655, dx: 32, dy: 24 },
  { id: '7', text: '7', color: '#bfbfbf', yFrac: 0.74, dx: 28, dy: 42 }
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

function lumAt(data, W, x, y) {
  const i = (y * W + x) * 3;
  return 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
}

/** 找暗→亮交界：取左暗右亮梯度最大处（半影缘），禁止漂进大亮 */
function findEdgeX(data, W, y, preferX) {
  // 脸中带：阴阳对半的交界在中线附近，勿扫到颧弓外侧大亮
  const x0 = Math.max(8, Math.floor(W * 0.36));
  const x1 = Math.min(W - 9, Math.floor(W * 0.58));
  let maxL = 0;
  let minL = 255;
  for (let x = x0; x <= x1; x++) {
    const L = lumAt(data, W, x, y);
    if (L > maxL) maxL = L;
    if (L < minL) minL = L;
  }
  if (maxL - minL < 18) return preferX;

  // 半影目标带：偏暗侧（约 22%–42%），贴可见交界缘，勿漂进大亮
  const aimLo = minL + (maxL - minL) * 0.22;
  const aimHi = minL + (maxL - minL) * 0.42;

  let bestX = preferX != null ? preferX : Math.round((x0 + x1) / 2);
  let bestScore = -1e9;
  const step = 3;
  for (let x = x0 + step; x <= x1 - step; x++) {
    const L = lumAt(data, W, x, y);
    const Lleft = lumAt(data, W, x - step, y);
    const Lright = lumAt(data, W, x + step, y);
    const grad = Lright - Lleft; // 暗→亮为正
    if (grad < 4) continue;
    // 必须仍在半影带内
    if (L < aimLo - 8 || L > aimHi + 6) continue;
    // 左应更暗、右应更亮
    if (!(Lleft < L && L <= Lright + 2)) continue;
    let score = grad * 2.2 - Math.abs(L - (aimLo + aimHi) / 2) * 0.35;
    if (preferX != null) score -= Math.abs(x - preferX) * 0.08;
    if (score > bestScore) {
      bestScore = score;
      bestX = x;
    }
  }

  // 若梯度搜不到：从暗侧扫到首次进入 aimLo
  if (bestScore < 0) {
    for (let x = x0; x <= x1; x++) {
      const L = lumAt(data, W, x, y);
      const Lprev = lumAt(data, W, Math.max(x0, x - 4), y);
      if (L >= aimLo && Lprev < aimLo) {
        bestX = x;
        break;
      }
    }
  }

  // 钳制：若已进大亮，往左退回半影
  let Lnow = lumAt(data, W, bestX, y);
  while (bestX > x0 + 2 && Lnow > aimHi) {
    bestX -= 2;
    Lnow = lumAt(data, W, bestX, y);
  }
  // 太暗且右邻更亮：略右移进半影（只到 aimLo，不到大亮）
  let guard = 0;
  while (guard++ < 24 && bestX < x1 - 2 && Lnow < aimLo) {
    const next = lumAt(data, W, bestX + 2, y);
    if (next <= Lnow) break;
    bestX += 2;
    Lnow = next;
    if (Lnow >= aimLo) break;
  }
  // 再向暗侧收 5px，压在可见交界（半影偏暗缘）
  return Math.max(x0, bestX - 5);
}

(async () => {
  const file0 = load204();
  Object.assign(file0.data.light, { azimuth: 10, elevation: 20, size: 6, intensity: 2.35 });
  file0.data.crop = {
    display: 'block',
    left: '320px',
    top: '70px',
    width: '760px',
    height: '760px'
  };
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
    await page.waitForTimeout(220);
  }

  const crop = await page.evaluate(() => {
    const s = (window.customScenes || []).find((x) => x && x.id === 'L04');
    const c = (s && s.crop) || {};
    const canvas =
      document.querySelector('canvas') ||
      (window.__solidHost && window.__solidHost.getRenderer && window.__solidHost.getRenderer().domElement);
    const r = canvas.getBoundingClientRect();
    return {
      x: Math.round(parseFloat(c.left) || 320),
      y: Math.round(parseFloat(c.top) || 70),
      width: Math.round(parseFloat(c.width) || 760),
      height: Math.round(parseFloat(c.height) || 760),
      canvas: { left: r.left, top: r.top, width: r.width, height: r.height }
    };
  });

  await page.evaluate(() => {
    if (window.showAnnotations !== false && typeof window.toggleAnnotations === 'function') window.toggleAnnotations();
  });
  await scrubUI(page);
  await page.waitForTimeout(500);
  const probePath = path.join(outDir, 'probe-light.png');
  await page.screenshot({ path: probePath, clip: crop });

  const { data, info } = await sharp(probePath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  let preferX = Math.round(W * 0.48);
  // 用中脸交界做种子（比额头稳）
  {
    const ySeed = Math.round(0.48 * H);
    const seed = findEdgeX(data, W, ySeed, preferX);
    if (seed != null) preferX = seed;
    console.log('seedX', preferX, 'at y', ySeed, 'L', +lumAt(data, W, preferX, ySeed).toFixed(1));
  }
  const uvHits = [];
  for (const spec of SPECS) {
    const y0 = Math.round(spec.yFrac * H);
    const ys = [y0 - 2, y0, y0 + 2].filter((y) => y >= 4 && y < H - 4);
    const xs = [];
    for (const y of ys) {
      const x = findEdgeX(data, W, y, preferX);
      if (x != null) xs.push(x);
    }
    xs.sort((a, b) => a - b);
    let x = xs.length ? xs[Math.floor(xs.length / 2)] : preferX;
    // 软连续：跳距过大时靠拢，但不得把点拖进大亮（相对 prefer 的右偏硬限）
    let Ltry = lumAt(data, W, x, y0);
    if (!spec.stickMain && preferX != null && Math.abs(x - preferX) > 30) {
      const pulled = preferX + Math.sign(x - preferX) * 22;
      // 只允许向暗侧（更小 x）多拉；向亮侧少拉
      x = x > preferX ? Math.min(x, preferX + 14) : pulled;
      Ltry = lumAt(data, W, x, y0);
    }
    // 眶窝暗坑：仅右移进半影，封顶到「本行 max 的一半」
    {
      const x0 = Math.max(8, Math.floor(W * 0.36));
      const x1 = Math.min(W - 9, Math.floor(W * 0.58));
      let maxL = 0;
      let minL = 255;
      for (let xx = x0; xx <= x1; xx++) {
        const L = lumAt(data, W, xx, y0);
        if (L > maxL) maxL = L;
        if (L < minL) minL = L;
      }
      const aimLo = minL + (maxL - minL) * 0.22;
      const aimHi = minL + (maxL - minL) * 0.42;
      let guard = 0;
      while (guard++ < 20 && Ltry < aimLo && x < x1 - 2) {
        x += 2;
        Ltry = lumAt(data, W, x, y0);
      }
      while (guard++ < 40 && Ltry > aimHi && x > x0 + 2) {
        x -= 2;
        Ltry = lumAt(data, W, x, y0);
      }
    }
    // 眼支线：贴主线；若进眶窝大暗则贴主线 x（半影钳制已处理）
    if (spec.stickMain && preferX != null) {
      x = preferX;
    }
    if (!spec.stickMain) preferX = x;
    const pageX = crop.x + x + 0.5;
    const pageY = crop.y + y0 + 0.5;
    const u = (pageX - crop.canvas.left) / crop.canvas.width;
    const v = (pageY - crop.canvas.top) / crop.canvas.height;
    const L = lumAt(data, W, x, y0);
    const Lleft = lumAt(data, W, Math.max(0, x - 8), y0);
    const Lright = lumAt(data, W, Math.min(W - 1, x + 8), y0);
    uvHits.push({
      id: spec.id,
      u,
      v,
      px: x,
      py: y0,
      L: +L.toFixed(1),
      Lleft: +Lleft.toFixed(1),
      Lright: +Lright.toFixed(1)
    });
  }
  console.log('uvHits', JSON.stringify(uvHits, null, 2));

  // 调试：在 probe 上画交界点，供视觉核对
  {
    const overlay = Buffer.from(data);
    for (const h of uvHits) {
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const xx = h.px + dx;
          const yy = h.py + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const i = (yy * W + xx) * 3;
          overlay[i] = 255;
          overlay[i + 1] = 40;
          overlay[i + 2] = 40;
        }
      }
    }
    await sharp(overlay, { raw: { width: W, height: H, channels: 3 } })
      .png()
      .toFile(path.join(outDir, 'probe-edge-marks.png'));
  }

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
        let best = null;
        // 只允许极小邻域；禁止用 |x| 往中线（暗侧）拽
        for (let du = -0.004; du <= 0.004; du += 0.002) {
          for (let dv = -0.004; dv <= 0.004; dv += 0.002) {
            const u = h.u + du;
            const v = h.v + dv;
            raycaster.setFromCamera(new THREE.Vector2(u * 2 - 1, -(v * 2 - 1)), cam);
            const hit = raycaster.intersectObjects(meshes, true)[0];
            if (!hit || !hit.face) continue;
            lp.copy(hit.point);
            root.worldToLocal(lp);
            if (lp.z < (spec.id === '7' ? 0.008 : 0.018)) continue;
            // 紧贴像素交界 UV；略偏好更大 z（脸前）
            const score = Math.abs(du) * 20 + Math.abs(dv) * 20 + Math.max(0, 0.05 - lp.z) * 2;
            if (!best || score < best.score) {
              const nw = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
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
          // 任意点兜底：用 prefer 邻点 u
          const fallbackU = (annotations.length ? byId[annotations[annotations.length - 1].text]?.u : null) || h.u;
          for (let du = -0.02; du <= 0.02; du += 0.004) {
            for (let dv = -0.015; dv <= 0.015; dv += 0.005) {
              const u = fallbackU + du;
              const v = h.v + dv;
              raycaster.setFromCamera(new THREE.Vector2(u * 2 - 1, -(v * 2 - 1)), cam);
              const hit = raycaster.intersectObjects(meshes, true)[0];
              if (!hit || !hit.face) continue;
              lp.copy(hit.point);
              root.worldToLocal(lp);
              if (lp.z < 0.02) continue;
              const nw = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
              const localNormal = root.worldToLocal(hit.point.clone().add(nw)).sub(lp.clone()).normalize();
              best = {
                score: 0,
                hit,
                localPos: [+lp.x.toFixed(4), +lp.y.toFixed(4), +lp.z.toFixed(4)],
                localNormal: [+localNormal.x.toFixed(3), +localNormal.y.toFixed(3), +localNormal.z.toFixed(3)]
              };
              break;
            }
            if (best) break;
          }
        }
        if (!best) {
          // 颏部兜底：沿用上一成功点的 u，略降 v 再扫
          if ((spec.id === '6' || spec.id === '7') && annotations.length) {
            const prevA = annotations[annotations.length - 1];
            const prevH = byId[prevA.text] || h;
            for (let dv = 0; dv <= 0.06; dv += 0.004) {
              const u = prevH.u;
              const v = Math.min(0.92, h.v + dv * (spec.id === '7' ? 1 : 0.3));
              raycaster.setFromCamera(new THREE.Vector2(u * 2 - 1, -(v * 2 - 1)), cam);
              const hit = raycaster.intersectObjects(meshes, true)[0];
              if (!hit || !hit.face) continue;
              lp.copy(hit.point);
              root.worldToLocal(lp);
              if (lp.z < 0.006) continue;
              if (spec.id === '6' && (lp.y < 0.04 || lp.y > 0.08)) continue;
              if (spec.id === '7' && (lp.y < 0.01 || lp.y > 0.055)) continue;
              const nw = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
              const localNormal = root.worldToLocal(hit.point.clone().add(nw)).sub(lp.clone()).normalize();
              best = {
                score: 0,
                hit,
                localPos: [+lp.x.toFixed(4), +lp.y.toFixed(4), +lp.z.toFixed(4)],
                localNormal: [+localNormal.x.toFixed(3), +localNormal.y.toFixed(3), +localNormal.z.toFixed(3)]
              };
              break;
            }
          }
        }
        if (!best) {
          dbg.push({ id: spec.id, ok: false });
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
        dbg.push({ id: spec.id, ok: true, xyz: best.localPos, uv: [+h.u.toFixed(3), +h.v.toFixed(3)], L: h.L });
      }
      return { ok: annotations.length === specs.length, annotations, dbg };
    },
    { specs: SPECS, hits: uvHits }
  );

  console.log(JSON.stringify(placed.dbg, null, 2));
  if (!placed.ok) throw new Error('ray incomplete: ' + placed.dbg.filter((d) => !d.ok).map((d) => d.id).join(','));

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
    await page.waitForTimeout(200);
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
