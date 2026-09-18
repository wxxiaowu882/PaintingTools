/**
 * 201f：Loop 视觉纠偏
 * - 强制停渲染、藏 loader，避免「首帧渲染中」挡脸
 * - 先拍无标光照图，再按屏坐标重钉：1亮面 / 2鼻侧环影 / 3颊影(未接)
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-headform-201f`);
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:18080';
fs.mkdirSync(outDir, { recursive: true });

function load201() {
  const f = fs.readdirSync(jsonDir).find((n) => n.startsWith('201_') && n.endsWith('.json'));
  const full = path.join(jsonDir, f);
  return { f, full, data: JSON.parse(fs.readFileSync(full, 'utf8')) };
}

function rebuild() {
  const files = fs
    .readdirSync(jsonDir)
    .filter((fn) => /^\d+[A-Za-z]?_.+\.json$/i.test(fn))
    .sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));
  const merged = files.map((fn) => JSON.parse(fs.readFileSync(path.join(jsonDir, fn), 'utf8')));
  fs.writeFileSync(path.join(jsonDir, '沙盒_头部造型规律.json'), JSON.stringify(merged) + '\n');
}

async function killOverlays(page) {
  await page.evaluate(() => {
    window.useAdvancedRender = false;
    window.perfTestDone = true;
    window.isTestingPerformance = false;
    try {
      if (typeof window.stopRender === 'function') window.stopRender();
    } catch (e) {}
    try {
      if (typeof window.toggleRender === 'function' && window.isRendering) window.toggleRender();
    } catch (e) {}
    const stopBtn = document.getElementById('render-stop-btn') || document.querySelector('[data-action="stop-render"]');
    if (stopBtn) stopBtn.click();
    const ids = ['scene-loader', 'render-progress', 'perf-overlay'];
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.style.display = 'none';
        el.style.visibility = 'hidden';
        el.style.opacity = '0';
        el.style.pointerEvents = 'none';
      }
    });
    document.querySelectorAll('.scene-loader, [class*="loader"], [class*="progress"]').forEach((el) => {
      const t = (el.textContent || '') + (el.id || '') + (el.className || '');
      if (/渲染|完成|loader|progress/i.test(t)) {
        el.style.display = 'none';
        el.style.visibility = 'hidden';
      }
    });
  });
}

async function boot(page) {
  await page.goto(`${baseUrl}/Solid.html?sandbox=headform&skipPerf=1&_=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 90000
  });
  await page.waitForTimeout(1000);
  await killOverlays(page);
  await page.evaluate(() => {
    if (window.loadJSONData) window.loadJSONData();
  });
  await page.waitForFunction(
    () => (window.customScenes || []).length > 0 && window.__solidHost && window.__solidHost.getCamera(),
    null,
    { timeout: 90000 }
  );
}

async function openL01(page) {
  await page.evaluate(() => {
    const m = document.getElementById('scene-grid-modal');
    if (m) m.style.display = 'none';
    const i = (window.customScenes || []).findIndex((s) => s && s.id === 'L01');
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
      } catch (e) {}
      return c;
    });
    if (n > 0) break;
    await page.waitForTimeout(250);
  }
  await killOverlays(page);
  await page.waitForTimeout(1200);
  await killOverlays(page);
}

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await boot(page);
  await openL01(page);

  // 先隐藏标注，拍干净光照图
  await page.evaluate(() => {
    window.showAnnotations = false;
  });
  await killOverlays(page);
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(outDir, 'L01-light-only.png'), clip: { x: 500, y: 110, width: 720, height: 720 } });

  // 探针：扫鼻旁/颊区，打印 localPos 便于选点
  const probe = await page.evaluate(() => {
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
    const samples = [];
    const us = [0.38, 0.42, 0.46, 0.5, 0.52, 0.54, 0.56, 0.58, 0.6, 0.62];
    const vs = [0.28, 0.34, 0.4, 0.44, 0.46, 0.48, 0.5, 0.52, 0.54, 0.58];
    for (const u of us) {
      for (const v of vs) {
        raycaster.setFromCamera(new THREE.Vector2(u * 2 - 1, -(v * 2 - 1)), cam);
        const hits = raycaster.intersectObjects(meshes, true);
        if (!hits[0]) continue;
        lp.copy(hits[0].point);
        root.worldToLocal(lp);
        samples.push({
          u: +u.toFixed(3),
          v: +v.toFixed(3),
          x: +lp.x.toFixed(3),
          y: +lp.y.toFixed(3),
          z: +lp.z.toFixed(3)
        });
      }
    }
    return samples;
  });
  fs.writeFileSync(path.join(outDir, 'probe.json'), JSON.stringify(probe, null, 2));

  // 选点策略（模型坐标：鼻尖约 z≈0.10；颊前 z>0；耳 z 负）
  // 1 亮面：负 X、偏前额/颊亮侧
  // 2 环影：鼻翼旁、略下，正 X 小、z 仍靠前（≈0.04~0.07）
  // 3 颊影：正 X、更侧但 z 不可太负（仍在颊面，约 0.00~0.03），与 2 分离
  function pick(pred, prefer) {
    let best = null;
    let bestScore = 1e9;
    for (const s of probe) {
      if (!pred(s)) continue;
      const score = prefer(s);
      if (score < bestScore) {
        bestScore = score;
        best = s;
      }
    }
    return best;
  }

  const p1 =
    pick(
      (s) => s.x < -0.02 && s.z > 0.02 && s.y > 0.18 && s.y < 0.28,
      (s) => Math.abs(s.u - 0.4) + Math.abs(s.v - 0.32)
    ) || pick((s) => s.x < -0.02 && s.z > 0, (s) => Math.abs(s.y - 0.22));

  const p2 =
    pick(
      (s) => s.x > 0.02 && s.x < 0.08 && s.z > 0.03 && s.y > 0.12 && s.y < 0.17,
      (s) => Math.abs(s.u - 0.54) + Math.abs(s.v - 0.48) + Math.abs(s.z - 0.05)
    ) ||
    pick(
      (s) => s.x > 0.015 && s.z > 0.025 && s.y > 0.11 && s.y < 0.18,
      (s) => Math.abs(s.y - 0.145) + Math.abs(s.z - 0.05)
    );

  const p3 =
    pick(
      (s) => s.x > 0.04 && s.x < 0.1 && s.z > -0.005 && s.z < 0.035 && s.y > 0.12 && s.y < 0.18,
      (s) => Math.abs(s.u - 0.61) + Math.abs(s.v - 0.52) + (s.z < 0 ? 0.5 : 0)
    ) ||
    pick(
      (s) => s.x > 0.04 && s.z > -0.01 && s.z < 0.04 && s.y > 0.1 && s.y < 0.19,
      (s) => Math.abs(s.y - 0.145)
    );

  console.log('picked', { p1, p2, p3 });
  if (!p1 || !p2 || !p3) throw new Error('pick failed');

  // 确保 2/3 分离：若过近则把 3 再侧移
  const dist23 = Math.hypot(p2.x - p3.x, p2.y - p3.y, p2.z - p3.z);
  console.log('dist23', dist23);
  let p3final = p3;
  if (dist23 < 0.025) {
    const alt = pick(
      (s) => s.x > p2.x + 0.015 && s.z > -0.01 && s.z < 0.04 && Math.abs(s.y - p2.y) < 0.04,
      (s) => -s.x
    );
    if (alt) p3final = alt;
  }

  const placed = await page.evaluate(
    ({ pts }) => {
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
      function make(u, v, id, dx, dy) {
        raycaster.setFromCamera(new THREE.Vector2(u * 2 - 1, -(v * 2 - 1)), cam);
        const hits = raycaster.intersectObjects(meshes, true);
        if (!hits[0]) return null;
        const h = hits[0];
        lp.copy(h.point);
        root.worldToLocal(lp);
        let nWorld = new THREE.Vector3(0.2, 0.1, 1);
        if (h.face && h.face.normal) {
          nWorld = h.face.normal.clone().transformDirection(h.object.matrixWorld).normalize();
        }
        const localNormal = root
          .worldToLocal(h.point.clone().add(nWorld))
          .sub(lp.clone())
          .normalize();
        return {
          id: 'anno_l01_' + id,
          annotationKind: 'leader',
          text: id,
          detailText: '',
          collapsed: false,
          color: '#00e8e8',
          dx,
          dy,
          dxN: 0,
          dyN: 0,
          dxW: 0,
          dyW: 0,
          localPos: [+lp.x.toFixed(4), +lp.y.toFixed(4), +lp.z.toFixed(4)],
          localNormal: [+localNormal.x.toFixed(3), +localNormal.y.toFixed(3), +localNormal.z.toFixed(3)],
          baseDist: +h.distance.toFixed(4),
          baseScale: 5.8,
          occludeDot: -0.35,
          labelShape: 'circle'
        };
      }
      const a1 = make(pts[0].u, pts[0].v, '1', -92, -28);
      const a2 = make(pts[1].u, pts[1].v, '2', 86, 8);
      const a3 = make(pts[2].u, pts[2].v, '3', 102, 36);
      return { ok: !!(a1 && a2 && a3), annotations: [a1, a2, a3].filter(Boolean) };
    },
    { pts: [p1, p2, p3final] }
  );

  console.log('placed', JSON.stringify(placed, null, 2));
  if (!placed.ok) throw new Error('ray place fail');

  const file = load201();
  file.data.items[0].annotations = placed.annotations;
  file.data.meta = file.data.meta || {};
  file.data.meta.status = 'wip';
  file.data.meta.detail = '侧前略高的日常光：鼻旁一小圈影，还没接到颊上的大阴影。';
  file.data.meta.keyPoints =
    '本关只看光：侧前略高的环形明暗（Loop）——日常肖像里很常见的一小圈鼻旁影。如果您不小心转动了视角，请点击重置按钮恢复视角。\n' +
    '先找鼻旁那一小圈影：它还没有接到颊上的大阴影。若接到了，就更接近下一关「伦勃朗」。\n' +
    '请看场景中的标注：1 是仍大的亮面，2 是鼻侧环影，3 是颊上的阴影（与环影分开）。\n' +
    '实际中光再侧一点、再高一点，环影就会变长、变接；本关先认准「未接」这一档。\n\n' +
    '点位名称如下：\n1.亮面\n2.鼻侧环影\n3.颊影（未接环影）';
  fs.writeFileSync(file.full, JSON.stringify(file.data) + '\n');
  rebuild();

  // 重载验收截图
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await killOverlays(page);
  await page.evaluate(() => {
    if (window.loadJSONData) window.loadJSONData();
  });
  await page.waitForFunction(() => (window.customScenes || []).length > 0, null, { timeout: 90000 });
  await openL01(page);
  await page.evaluate(() => {
    window.showAnnotations = true;
  });
  await killOverlays(page);
  await page.waitForTimeout(800);
  await killOverlays(page);
  await page.screenshot({ path: path.join(outDir, 'L01-annotated-full.png') });
  await page.screenshot({
    path: path.join(outDir, 'L01-annotated-crop.png'),
    clip: { x: 500, y: 110, width: 720, height: 720 }
  });

  // 缩略图：隐藏标注再拍 crop
  await page.evaluate(() => {
    window.showAnnotations = false;
  });
  await killOverlays(page);
  await page.waitForTimeout(400);
  await page.screenshot({
    path: path.join(outDir, 'L01-thumb-src.png'),
    clip: { x: 500, y: 110, width: 720, height: 720 }
  });

  console.log('OUT', outDir);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
