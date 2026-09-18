/**
 * 201g：按目标 localPos 钉 Loop 证据点 + 强制光栅停渲染再截图
 * 1 亮面（近侧亮颊）
 * 2 鼻侧环影（鼻翼旁小圈，靠前）
 * 3 颊影（与环影分离，仍在颊面、不贴耳）
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-headform-201g`);
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
      el.hidden = true;
    };
    hide(document.getElementById('scene-loader'));
    hide(document.getElementById('perf-test-overlay'));
    document.querySelectorAll('#scene-loader, #perf-test-overlay, .scene-loader').forEach(hide);
    // 清掉「正在计算光影 / 首帧渲染」类浮层
    document.querySelectorAll('body *').forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      const t = (el.textContent || '').trim();
      if (!t) return;
      if (/^(正在计算光影|首帧渲染中|即将完成|系统环境初始化)/.test(t) && t.length < 40) {
        hide(el);
        if (el.parentElement && (el.parentElement.textContent || '').trim().length < 60) hide(el.parentElement);
      }
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
  // 切场景会再开加载/渲染，连停几次
  for (let k = 0; k < 6; k++) {
    await forceRaster(page);
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(800);
  await forceRaster(page);
}

(async () => {
  // 先微调相机：略正一点、头更居中，便于看见环影与颊影分离
  const file0 = load201();
  file0.data.camera = {
    pos: [1.85, 0.9, 5.75],
    target: [0.0, 0.84, 0.04],
    zoom: 0.58,
    fov: 14
  };
  file0.data.light = {
    type: 'point',
    azimuth: 50,
    elevation: 33,
    distance: 15,
    temp: 34,
    size: 10,
    intensity: 2.2
  };
  file0.data.env.skyLightScale = 0.48;
  file0.data.crop = {
    display: 'block',
    left: '460px',
    top: '90px',
    width: '740px',
    height: '740px'
  };
  fs.writeFileSync(file0.full, JSON.stringify(file0.data) + '\n');
  rebuild();

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await boot(page);
  await openL01(page);

  // 目标模型坐标（scale 5.8 局部）：按鼻尖≈(0,0.135,0.10) 估
  const targets = {
    '1': { x: -0.04, y: 0.185, z: 0.055 }, // 亮面：近侧颊/额
    '2': { x: 0.028, y: 0.128, z: 0.07 }, // 环影：鼻翼旁靠前
    '3': { x: 0.058, y: 0.118, z: 0.028 } // 颊影：中颊，与环影分离
  };

  const placed = await page.evaluate((targets) => {
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

    function scan(target, u0, u1, v0, v1) {
      let best = null;
      let bestD = 1e9;
      for (let v = v0; v <= v1; v += 0.008) {
        for (let u = u0; u <= u1; u += 0.008) {
          raycaster.setFromCamera(new THREE.Vector2(u * 2 - 1, -(v * 2 - 1)), cam);
          const hit = raycaster.intersectObjects(meshes, true)[0];
          if (!hit) continue;
          lp.copy(hit.point);
          root.worldToLocal(lp);
          const d =
            (lp.x - target.x) ** 2 + (lp.y - target.y) ** 2 + (lp.z - target.z) ** 2;
          if (d < bestD) {
            bestD = d;
            best = {
              u,
              v,
              hit,
              x: lp.x,
              y: lp.y,
              z: lp.z,
              d: Math.sqrt(d)
            };
          }
        }
      }
      return best;
    }

    function makeAnno(id, best, dx, dy) {
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
        _dbg: { u: +best.u.toFixed(3), v: +best.v.toFixed(3), d: +best.d.toFixed(4), xyz: [+best.x.toFixed(3), +best.y.toFixed(3), +best.z.toFixed(3)] }
      };
    }

    // 屏坐标搜索窗：亮面偏左上；环影鼻旁中；颊影更右略下
    const b1 = scan(targets['1'], 0.34, 0.48, 0.28, 0.42);
    const b2 = scan(targets['2'], 0.48, 0.58, 0.44, 0.56);
    const b3 = scan(targets['3'], 0.54, 0.66, 0.48, 0.62);
    const a1 = makeAnno('1', b1, -96, -20);
    const a2 = makeAnno('2', b2, 78, -6);
    const a3 = makeAnno('3', b3, 108, 30);
    return {
      ok: !!(a1 && a2 && a3),
      annotations: [a1, a2, a3].filter(Boolean),
      dbg: [a1, a2, a3].filter(Boolean).map((a) => ({ text: a.text, dbg: a._dbg }))
    };
  }, targets);

  console.log(JSON.stringify(placed.dbg, null, 2));
  if (!placed.ok) throw new Error('place fail');
  placed.annotations.forEach((a) => delete a._dbg);

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
  await page.waitForTimeout(1000);
  await forceRaster(page);

  const crop = { x: 460, y: 90, width: 740, height: 740 };
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
