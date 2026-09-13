/** 204-term：按真实光照边际（N·L≈0）重钉全部点位——禁止沉进大暗 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-headform-204-term`);
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

// 高度带 + 屏幕搜索框；最终以 N·L≈0 的受光缘为准
const SPECS = [
  { id: '1', text: '1', color: '#bfbfbf', y: 0.218, yTol: 0.012, box: [0.38, 0.58, 0.18, 0.36], dx: -55, dy: -30 },
  { id: '2', text: '2', color: '#bfbfbf', y: 0.195, yTol: 0.01, box: [0.38, 0.58, 0.28, 0.4], dx: -55, dy: -10 },
  { id: '3', text: '3', color: '#bfbfbf', y: 0.17, yTol: 0.01, box: [0.36, 0.56, 0.34, 0.46], dx: -60, dy: 0 },
  { id: '4', text: '4', color: '#bfbfbf', y: 0.14, yTol: 0.012, box: [0.36, 0.56, 0.42, 0.55], dx: -55, dy: 5 },
  { id: '5', text: '5', color: '#bfbfbf', y: 0.1, yTol: 0.012, box: [0.38, 0.58, 0.52, 0.66], dx: -55, dy: 15 },
  { id: '6', text: '6', color: '#bfbfbf', y: 0.07, yTol: 0.012, box: [0.4, 0.6, 0.62, 0.76], dx: -45, dy: 25 },
  { id: '7', text: '7', color: '#bfbfbf', y: 0.048, yTol: 0.02, box: [0.42, 0.62, 0.7, 0.88], dx: -25, dy: 45 },
  { id: 'A', text: 'A', color: '#197657', y: 0.176, yTol: 0.01, box: [0.4, 0.58, 0.34, 0.44], dx: 50, dy: -18 },
  { id: 'B', text: 'B', color: '#197657', y: 0.162, yTol: 0.01, box: [0.4, 0.58, 0.4, 0.5], dx: 50, dy: 12 }
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
      if (/^(正在计算光影|首帧渲染中|光影探针)/.test(t) && t.length < 50) hide(el);
    });
  });
}

(async () => {
  // 略硬的正侧光：交界利落，圆标才钉得住缘
  const file0 = load204();
  Object.assign(file0.data.light, { azimuth: 10, elevation: 20, size: 6, intensity: 2.35 });
  // 头偏左时把取景框左移，让头更居中
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
  for (let k = 0; k < 7; k++) {
    await scrubUI(page);
    await page.waitForTimeout(280);
  }

  const placed = await page.evaluate((specs) => {
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

    const sc = (window.customScenes || []).find((s) => s && s.id === 'L04') || {};
    const L = sc.light || {};
    const elev = L.elevation != null ? L.elevation : 22;
    const azim = L.azimuth != null ? L.azimuth : 12;
    const rr = L.distance || 15;
    const phi = THREE.MathUtils.degToRad(90 - elev);
    const theta = THREE.MathUtils.degToRad(azim);
    const lightPos = new THREE.Vector3(
      rr * Math.sin(phi) * Math.cos(theta),
      rr * Math.cos(phi),
      rr * Math.sin(phi) * Math.sin(theta)
    );
    const toLight = lightPos.clone().normalize();

    const raycaster = new THREE.Raycaster();
    const lp = new THREE.Vector3();
    const nWorld = new THREE.Vector3();

    // 视觉交界（像素实测）比几何 N·L=0 更靠亮侧；0.40 仍偏暗，提到 0.55
    const TARGET_NDOTL = 0.55;

    function sampleAt(u, v, opts) {
      const minZ = (opts && opts.minZ != null) ? opts.minZ : 0.035;
      raycaster.setFromCamera(new THREE.Vector2(u * 2 - 1, -(v * 2 - 1)), cam);
      const hit = raycaster.intersectObjects(meshes, true)[0];
      if (!hit || !hit.face) return null;
      lp.copy(hit.point);
      root.worldToLocal(lp);
      if (lp.z < minZ) return null;
      nWorld.copy(hit.face.normal).transformDirection(hit.object.matrixWorld).normalize();
      const ndotl = nWorld.dot(toLight);
      return { hit, x: lp.x, y: lp.y, z: lp.z, ndotl };
    }

    function findTermAtY(spec) {
      const isChin = spec.id === '7';
      const minZ = isChin ? 0.012 : 0.035;
      const targetN = isChin ? 0.4 : TARGET_NDOTL;
      // 估计该高度在画面上的 v：先在中线附近取一点
      let vGuess = 0.35 + (0.22 - spec.y) * 2.2;
      if (isChin) vGuess = 0.78;
      vGuess = Math.min(0.9, Math.max(0.16, vGuess));
      for (let k = 0; k < 4; k++) {
        const mid = sampleAt(0.5, vGuess, { minZ });
        if (!mid) break;
        if (mid.y > spec.y + 0.004) vGuess += 0.012;
        else if (mid.y < spec.y - 0.004) vGuess -= 0.012;
        else break;
      }

      let best = null;
      let bestScore = 1e9;
      const vList = isChin
        ? [0.72, 0.74, 0.76, 0.78, 0.8, 0.82, 0.84, 0.86]
        : [vGuess - 0.02, vGuess - 0.01, vGuess, vGuess + 0.01, vGuess + 0.02];
      for (const vv of vList) {
        if (vv < 0.12 || vv > 0.92) continue;
        let prev = null;
        for (let u = 0.4; u <= 0.68; u += 0.004) {
          const s = sampleAt(u, vv, { minZ });
          if (!s) continue;
          // 眼支线也必须贴主交界缘，禁止沉进眶窝大暗
          if ((spec.id === 'A' || spec.id === 'B') && s.x < -0.01) {
            prev = s;
            continue;
          }
          if (Math.abs(s.y - spec.y) > spec.yTol * 1.8) continue;
          if (prev && prev.ndotl < targetN && s.ndotl >= targetN) {
            // 跨越后沿亮侧再走 1～2 步，钉在缘上而非半暗
            let pick = s;
            const u2 = u + 0.008;
            const s2 = sampleAt(u2, vv, { minZ });
            if (s2 && Math.abs(s2.y - spec.y) <= spec.yTol * 1.8 && s2.ndotl < 0.85) pick = s2;
            const score = Math.abs(pick.ndotl - targetN) * 0.35 + Math.abs(pick.y - spec.y) * 2 - 0.2;
            if (score < bestScore) {
              bestScore = score;
              best = { ...pick, score, u: u2, v: vv, cross: true };
            }
          }
          let score2 = Math.abs(s.ndotl - targetN) * 1.2 + Math.abs(s.y - spec.y) * 3;
          score2 += Math.max(0, -0.005 - s.x) * 16;
          score2 += Math.max(0, s.x - 0.045) * 4;
          if (!best || !best.cross) {
            if (score2 < bestScore) {
              bestScore = score2;
              best = { ...s, score: score2, u, v: vv, cross: false };
            }
          }
          prev = s;
        }
      }
      // 颏底兜底：中线附近最近表面
      if (!best && isChin) {
        for (let u = 0.46; u <= 0.54; u += 0.004) {
          for (let v = 0.74; v <= 0.88; v += 0.006) {
            const s = sampleAt(u, v, { minZ: 0.01 });
            if (!s) continue;
            if (s.y < 0.03 || s.y > 0.06) continue;
            const score = Math.abs(s.x) * 5 + Math.abs(s.y - 0.045) * 8 + Math.abs(s.ndotl - 0.1);
            if (score < bestScore) {
              bestScore = score;
              best = { ...s, score, u, v, cross: false };
            }
          }
        }
      }
      return best;
    }

    function make(spec, best) {
      if (!best || !best.hit) return null;
      lp.copy(best.hit.point);
      root.worldToLocal(lp);
      let nw = new THREE.Vector3(-0.1, 0.05, 0.95);
      if (best.hit.face && best.hit.face.normal) {
        nw = best.hit.face.normal.clone().transformDirection(best.hit.object.matrixWorld).normalize();
      }
      const localNormal = root.worldToLocal(best.hit.point.clone().add(nw)).sub(lp.clone()).normalize();
      return {
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
        localPos: [+lp.x.toFixed(4), +lp.y.toFixed(4), +lp.z.toFixed(4)],
        localNormal: [+localNormal.x.toFixed(3), +localNormal.y.toFixed(3), +localNormal.z.toFixed(3)],
        baseDist: +best.hit.distance.toFixed(4),
        baseScale: 5.8,
        occludeDot: -0.35,
        labelShape: 'circle',
        _dbg: {
          xyz: [+best.x.toFixed(3), +best.y.toFixed(3), +best.z.toFixed(3)],
          ndotl: +best.ndotl.toFixed(3),
          score: +best.score.toFixed(3),
          uv: [+best.u.toFixed(3), +best.v.toFixed(3)],
          cross: !!best.cross
        }
      };
    }

    const annotations = [];
    const dbg = [];
    for (const spec of specs) {
      const best = findTermAtY(spec);
      const a = make(spec, best);
      if (!a) {
        dbg.push({ id: spec.id, ok: false });
        continue;
      }
      annotations.push(a);
      dbg.push({ id: spec.id, ok: true, ...a._dbg });
      delete a._dbg;
    }
    return {
      ok: annotations.length === specs.length,
      annotations,
      dbg,
      lightDir: [+toLight.x.toFixed(3), +toLight.y.toFixed(3), +toLight.z.toFixed(3)]
    };
  }, SPECS);

    console.log('lightDir', placed.lightDir);
  console.log(JSON.stringify(placed.dbg, null, 2));
  if (!placed.ok) throw new Error('place incomplete: ' + placed.dbg.filter((x) => !x.ok).map((x) => x.id).join(','));

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
  // 文案强调：圆标钉在交界线上
  file.data.meta = Object.assign({}, file.data.meta, {
    line: 'light',
    slot: 'L04',
    status: 'seeded',
    detail: '正侧光：脸一半亮、一半暗；明暗交界沿着正侧面交界走得很长。',
    keyPoints:
      '本场景只看正侧这一档光线下，明暗交界怎么走。交界主要跟「光线和头的夹角」有关——请转动场景，换角度看这条长交界和关键结构点。请不要在操作面板中改变光线相关的设置，否则会影响本场景的教学观感；若不小心改了光的方向等参数，点「重置」恢复即可。\n\n' +
      '先看表象：光线几乎从正侧面打来时，脸常是一半亮、一半暗——戏剧感很强的「阴阳对半」。交界大致贴着脸的「正面与侧面」交界走，从额侧一直通到颏侧，往往比「环形」「伦勃朗」更长、更直一些。若暗颊上还留着一块三角亮，更接近上一档「伦勃朗」；若鼻旁小影还没接到颊侧大暗，则更接近「环形」。\n\n' +
      '本场景描述的对象就是这条明暗交界线：曲线勾出交界走向；圆标钉在交界线经过的关键结构点上（不是钉在大暗或大亮里）。知识上，正侧交界常经过：额结节外侧 → 眉峰 → 眶外角 → 颧突隆 → 颏结节。交界出现是因为有结构起伏；看见这条长交界怎么拐，也能反推正侧面大面交界。\n\n' +
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
    await page.waitForTimeout(250);
  }

  const crop = await page.evaluate(() => {
    const s = (window.customScenes || []).find((x) => x && x.id === 'L04');
    const c = (s && s.crop) || {};
    return { x: parseFloat(c.left) || 450, y: parseFloat(c.top) || 90, width: 760, height: 720 };
  });

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
