/**
 * 201h：纠正左右——Solid az0→世界+X；az50≈右前光，环影在 −X 颊
 * 1 亮面（+X）
 * 2 鼻侧环影（−X 鼻翼旁）
 * 3 颊影未接（−X 中颊，勿贴耳）
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-headform-201h`);
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
  fs.writeFileSync(
    path.join(jsonDir, '沙盒_头部造型规律.json'),
    JSON.stringify(files.map((fn) => JSON.parse(fs.readFileSync(path.join(jsonDir, fn), 'utf8')))) + '\n'
  );
}

async function forceRaster(page) {
  await page.evaluate(() => {
    try {
      if (typeof window.stopRender === 'function') window.stopRender();
    } catch (e) {}
    window._solidUserStoppedRender = true;
    window.useAdvancedRender = false;
    window.perfTestDone = true;
    window.isTestingPerformance = false;
    window.isLoadingScene = false;
    const hide = (el) => {
      if (!el) return;
      el.style.display = 'none';
      el.style.visibility = 'hidden';
      el.style.opacity = '0';
    };
    hide(document.getElementById('scene-loader'));
    hide(document.getElementById('perf-test-overlay'));
    document.querySelectorAll('body *').forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      const t = (el.textContent || '').trim();
      if (/^(正在计算光影|首帧渲染中|即将完成)/.test(t) && t.length < 40) hide(el);
    });
  });
}

async function boot(page) {
  await page.goto(`${baseUrl}/Solid.html?sandbox=headform&skipPerf=1&_=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 90000
  });
  await page.waitForTimeout(800);
  await forceRaster(page);
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
    await page.waitForTimeout(200);
  }
  for (let k = 0; k < 6; k++) {
    await forceRaster(page);
    await page.waitForTimeout(350);
  }
}

(async () => {
  const file0 = load201();
  // 略正前侧视：两边颊都看得见环影；光 az50=+X 右前 → 环影落在 −X
  file0.data.camera = {
    pos: [1.15, 0.88, 6.05],
    target: [0.0, 0.82, 0.04],
    zoom: 0.58,
    fov: 14
  };
  file0.data.light = {
    type: 'point',
    azimuth: 48,
    elevation: 32,
    distance: 15,
    temp: 34,
    size: 10,
    intensity: 2.2
  };
  file0.data.env.skyLightScale = 0.45;
  file0.data.crop = {
    display: 'block',
    left: '440px',
    top: '80px',
    width: '760px',
    height: '760px'
  };
  fs.writeFileSync(file0.full, JSON.stringify(file0.data) + '\n');
  rebuild();

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await boot(page);
  await openL01(page);

  const targets = {
    '1': { x: 0.045, y: 0.175, z: 0.055 }, // 亮面 +X
    '2': { x: -0.03, y: 0.125, z: 0.068 }, // 环影 −X 鼻翼旁
    '3': { x: -0.06, y: 0.115, z: 0.025 } // 颊影 −X 中颊
  };
  // 搜索窗（屏坐标粗估：+X 偏右 u大；−X 偏左 u小）
  const boxes = {
    '1': [0.48, 0.62, 0.3, 0.46],
    '2': [0.38, 0.5, 0.44, 0.58],
    '3': [0.3, 0.44, 0.48, 0.62]
  };

  const placed = await page.evaluate(
    ({ targets, boxes }) => {
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

      function scan(target, box) {
        const [u0, u1, v0, v1] = box;
        let best = null;
        let bestD = 1e9;
        for (let v = v0; v <= v1; v += 0.007) {
          for (let u = u0; u <= u1; u += 0.007) {
            raycaster.setFromCamera(new THREE.Vector2(u * 2 - 1, -(v * 2 - 1)), cam);
            const hit = raycaster.intersectObjects(meshes, true)[0];
            if (!hit) continue;
            lp.copy(hit.point);
            root.worldToLocal(lp);
            const d = (lp.x - target.x) ** 2 + (lp.y - target.y) ** 2 + (lp.z - target.z) ** 2;
            if (d < bestD) {
              bestD = d;
              best = { u, v, hit, x: lp.x, y: lp.y, z: lp.z, d: Math.sqrt(d) };
            }
          }
        }
        return best;
      }

      function make(id, best, dx, dy) {
        if (!best) return null;
        const h = best.hit;
        lp.copy(h.point);
        root.worldToLocal(lp);
        let nWorld = new THREE.Vector3(0.2, 0.1, 1);
        if (h.face && h.face.normal) {
          nWorld = h.face.normal.clone().transformDirection(h.object.matrixWorld).normalize();
        }
        const localNormal = root.worldToLocal(h.point.clone().add(nWorld)).sub(lp.clone()).normalize();
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
          labelShape: 'circle',
          _dbg: {
            u: +best.u.toFixed(3),
            v: +best.v.toFixed(3),
            d: +best.d.toFixed(4),
            xyz: [+best.x.toFixed(3), +best.y.toFixed(3), +best.z.toFixed(3)]
          }
        };
      }

      const b1 = scan(targets['1'], boxes['1']);
      const b2 = scan(targets['2'], boxes['2']);
      const b3 = scan(targets['3'], boxes['3']);
      const a1 = make('1', b1, 92, -24);
      const a2 = make('2', b2, -88, 4);
      const a3 = make('3', b3, -110, 36);
      return {
        ok: !!(a1 && a2 && a3),
        annotations: [a1, a2, a3].filter(Boolean),
        dbg: [a1, a2, a3].filter(Boolean).map((a) => ({ text: a.text, dbg: a._dbg }))
      };
    },
    { targets, boxes }
  );

  console.log(JSON.stringify(placed.dbg, null, 2));
  if (!placed.ok) throw new Error('place fail');
  placed.annotations.forEach((a) => delete a._dbg);

  // 校验符号：1 应 +X；2/3 应 −X；且 2 的 |z| 更前
  const [a1, a2, a3] = placed.annotations;
  if (!(a1.localPos[0] > 0 && a2.localPos[0] < 0 && a3.localPos[0] < 0)) {
    throw new Error('sign check fail ' + JSON.stringify(placed.dbg));
  }

  const file = load201();
  file.data.items[0].annotations = placed.annotations;
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

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  await forceRaster(page);
  await page.evaluate(() => {
    if (window.loadJSONData) window.loadJSONData();
  });
  await page.waitForFunction(() => (window.customScenes || []).length > 0, null, { timeout: 90000 });
  await openL01(page);
  await page.evaluate(() => {
    window.showAnnotations = true;
  });
  await forceRaster(page);
  await page.waitForTimeout(1200);
  await forceRaster(page);

  const crop = { x: 440, y: 80, width: 760, height: 710 };
  await page.screenshot({ path: path.join(outDir, 'L01-annotated-full.png') });
  await page.screenshot({ path: path.join(outDir, 'L01-annotated-crop.png'), clip: crop });
  await page.evaluate(() => {
    window.showAnnotations = false;
  });
  await forceRaster(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outDir, 'L01-light-crop.png'), clip: crop });

  console.log('OUT', outDir);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
