/**
 * 201b：Loop 标注纠偏——光位已可用，重钉环影/颊影到正确屏幕区域
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-headform-201b`);
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:18080';
fs.mkdirSync(outDir, { recursive: true });

function loadFile(prefix) {
  const f = fs.readdirSync(jsonDir).find((n) => n.startsWith(prefix) && n.endsWith('.json'));
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

function tweakCamLight() {
  const dst = loadFile('201_');
  // 略收正一点，环影更清楚；光略抬、略侧但仍未到伦勃朗
  dst.data.camera = {
    pos: [2.15, 0.92, 5.55],
    target: [-0.01, 0.86, 0.04],
    zoom: 0.58,
    fov: 15
  };
  dst.data.light = {
    type: 'point',
    azimuth: 52,
    elevation: 34,
    distance: 15,
    temp: 34,
    size: 10,
    intensity: 2.2
  };
  dst.data.env.skyLightScale = 0.5;
  fs.writeFileSync(dst.full, JSON.stringify(dst.data) + '\n');
  rebuildAggregate();
  console.log('cam/light', dst.data.camera, dst.data.light);
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

async function openL01(page) {
  await page.evaluate(() => {
    const m = document.getElementById('scene-grid-modal');
    if (m) m.style.display = 'none';
    let i = (window.customScenes || []).findIndex((s) => s && s.id === 'L01');
    if (i < 0) i = (window.customScenes || []).findIndex((s) => s && String(s.name || '').includes('环形'));
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
    if (n > 0) break;
    await page.waitForTimeout(400);
  }
  await page.evaluate(() => {
    const el = document.getElementById('scene-loader');
    if (el) el.style.display = 'none';
    const m = document.getElementById('scene-grid-modal');
    if (m) m.style.display = 'none';
    window.showAnnotations = true;
  });
  await page.waitForTimeout(1600);
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

    function bestInBox(u0, u1, v0, v1, preferFn) {
      let best = null;
      let bestScore = -1e9;
      for (let v = v0; v <= v1; v += 0.01) {
        for (let u = u0; u <= u1; u += 0.008) {
          const hit = hitAt(u, v);
          if (!hit) continue;
          _lp.copy(hit.point);
          root.worldToLocal(_lp);
          const score = preferFn(_lp, u, v);
          if (score == null || Number.isNaN(score)) continue;
          if (score > bestScore) {
            bestScore = score;
            best = { u, v, hit, x: _lp.x, y: _lp.y, z: _lp.z };
          }
        }
      }
      return best;
    }

    // 视觉结论：环影在鼻梁靠画面右侧的颊侧；颊影更靠外但仍在脸前（z 够正）；亮面在额/近侧
    const bright = bestInBox(0.36, 0.5, 0.26, 0.4, (p) => {
      if (p.z < 0.04) return null;
      return p.z * 2 + p.y;
    });
    const loop = bestInBox(0.5, 0.6, 0.4, 0.52, (p) => {
      // 鼻旁环影：靠前、略正 x、高度在鼻中段
      if (p.z < 0.055) return null;
      if (p.y < 0.14 || p.y > 0.2) return null;
      if (p.x < -0.005 || p.x > 0.045) return null;
      return p.z * 4 - Math.abs(p.y - 0.17);
    });
    const cheek = bestInBox(0.58, 0.7, 0.4, 0.54, (p) => {
      // 颊影未接：更外、仍在面前，避开耳（z 不能太负）
      if (p.z < 0.02) return null;
      if (p.x < 0.035) return null;
      if (p.y < 0.12 || p.y > 0.2) return null;
      return p.x * 3 + p.z;
    });

    function toAnno(text, color, dx, dy, hit, id) {
      const world = hit.point.clone();
      const localPos = root.worldToLocal(world.clone());
      let nWorld = new THREE.Vector3(0.2, 0.1, 1);
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
        baseScale: 5.8,
        occludeDot: -0.35,
        labelShape: 'circle'
      };
    }

    const picks = [
      { id: '1', name: '亮面', s: bright, dx: -92, dy: -24 },
      { id: '2', name: '鼻侧环影', s: loop, dx: 78, dy: 4 },
      { id: '3', name: '颊影（未接环影）', s: cheek, dx: 96, dy: 22 }
    ];
    const annotations = [];
    const placed = [];
    for (const c of picks) {
      if (!c.s || !c.s.hit) continue;
      annotations.push(toAnno(c.id, '#00e8e8', c.dx, c.dy, c.s.hit, 'anno_l01_' + c.id));
      placed.push({
        text: c.id,
        name: c.name,
        u: +c.s.u.toFixed(3),
        v: +c.s.v.toFixed(3),
        x: +c.s.x.toFixed(3),
        y: +c.s.y.toFixed(3),
        z: +c.s.z.toFixed(3)
      });
    }
    return { ok: annotations.length >= 3, annotations, debug: { placed }, hitLabels: annotations.map((a) => a.text) };
  });
}

async function main() {
  tweakCamLight();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(120000);
  await boot(page);
  await openL01(page);
  await page.screenshot({ path: path.join(outDir, 'L01-clean.png') });
  const p = await pick(page);
  fs.writeFileSync(path.join(outDir, 'L01-pick.json'), JSON.stringify(p, null, 2));
  console.log('placed', JSON.stringify(p.debug && p.debug.placed, null, 2));
  if (!p.ok) throw new Error('pick fail ' + JSON.stringify(p.hitLabels));

  const f = loadFile('201_');
  f.data.items[0].annotations = p.annotations;
  f.data.meta.detail = '侧前略高的日常光：鼻旁一小圈影，还没接到颊上的大阴影。';
  f.data.meta.keyPoints = [
    '本关只看光：侧前略高的环形明暗（Loop）——日常肖像里很常见的一小圈鼻旁影。如果您不小心转动了视角，请点击重置按钮恢复视角。',
    '先找鼻旁那一小圈影：它还没有接到颊上的大阴影。若接到了，就更接近下一关「伦勃朗」。',
    '请看场景中的标注：1 是仍大的亮面，2 是鼻侧环影，3 是颊上的阴影（与环影分开）。',
    '实际中光再侧一点、再高一点，环影就会变长、变接；本关先认准「未接」这一档。',
    '',
    '点位名称如下：',
    '1.亮面',
    '2.鼻侧环影',
    '3.颊影（未接环影）'
  ].join('\n');
  f.data.meta.status = 'wip';
  fs.writeFileSync(f.full, JSON.stringify(f.data) + '\n');
  console.log('merged', rebuildAggregate());

  await boot(page);
  await openL01(page);
  await page.screenshot({ path: path.join(outDir, 'L01-annotated-full.png') });
  console.log('OUT', outDir);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
