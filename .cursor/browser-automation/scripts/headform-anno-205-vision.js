/** 205 视觉纠偏：按干净截图微灰交界微调 W 点（尤其 ③④ 前移出大暗） */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-headform-205-vision`);
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:18080';
fs.mkdirSync(outDir, { recursive: true });

function load205() {
  const f = fs.readdirSync(jsonDir).find((n) => n.startsWith('205_') && n.endsWith('.json'));
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

// 视觉读图目标 UV：钉头侧微灰（非脑后大暗、非额鼻唇颏剪影）
const TARGETS = [
  { id: '1', name: '颅顶结节', u: 0.5, v: 0.17, prefer: [-0.02, 0.295, 0.0], dx: 78, dy: -28 },
  { id: '2', name: '颅侧结节', u: 0.42, v: 0.31, prefer: [-0.082, 0.228, -0.03], dx: 88, dy: -8 },
  { id: '3', name: '颧骨弓隆起', u: 0.46, v: 0.45, prefer: [-0.058, 0.155, 0.032], dx: 92, dy: 6 },
  { id: '4', name: '颊转角', u: 0.48, v: 0.57, prefer: [-0.05, 0.1, 0.038], dx: 86, dy: 18 },
  { id: '5', name: '颏结节', u: 0.53, v: 0.69, prefer: [-0.022, 0.058, 0.062], dx: 70, dy: 36 }
];

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
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
    if (m) m.style.display = 'none';
    const i = window.customScenes.findIndex((s) => s && s.id === 'L05');
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
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(1600);
  await page.evaluate(() => {
    const el = document.getElementById('scene-loader');
    if (el) el.style.display = 'none';
  });

  const picked = await page.evaluate((TARGETS) => {
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
    const out = [];
    for (const t of TARGETS) {
      const prefer = new THREE.Vector3(...t.prefer);
      let best = null;
      let bestScore = 1e9;
      for (let dv = -0.02; dv <= 0.02; dv += 0.004) {
        for (let du = -0.03; du <= 0.03; du += 0.004) {
          raycaster.setFromCamera(new THREE.Vector2((t.u + du) * 2 - 1, -((t.v + dv) * 2 - 1)), cam);
          const hits = raycaster.intersectObjects(meshes, true);
          if (!hits.length) continue;
          const hit = hits[0];
          const lp = root.worldToLocal(hit.point.clone());
          if (Math.abs(lp.x) < 0.012 && t.id !== '1') continue;
          if (t.id === '3' || t.id === '4') {
            if (lp.z < 0.0) continue;
            if (lp.x > -0.03) continue;
          }
          if (t.id === '2' && lp.z < -0.07) continue;
          const dist = lp.distanceTo(prefer);
          const score = dist + Math.max(0, 0.025 - Math.abs(lp.x)) * 2;
          if (score < bestScore) {
            bestScore = score;
            let nWorld = new THREE.Vector3(-1, 0, 0);
            if (hit.face && hit.face.normal) {
              nWorld = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
            }
            const localNormal = root
              .worldToLocal(hit.point.clone().add(nWorld))
              .sub(lp.clone())
              .normalize();
            best = {
              id: t.id,
              name: t.name,
              dx: t.dx,
              dy: t.dy,
              localPos: [+lp.x.toFixed(4), +lp.y.toFixed(4), +lp.z.toFixed(4)],
              localNormal: [+localNormal.x.toFixed(3), +localNormal.y.toFixed(3), +localNormal.z.toFixed(3)],
              baseDist: +hit.distance.toFixed(4),
              u: +(t.u + du).toFixed(4),
              v: +(t.v + dv).toFixed(4),
              score: +score.toFixed(4)
            };
          }
        }
      }
      if (!best) {
        best = {
          id: t.id,
          name: t.name,
          dx: t.dx,
          dy: t.dy,
          localPos: t.prefer.map((n) => +n.toFixed(4)),
          localNormal: [-0.9, 0.1, 0.2],
          baseDist: 6.2,
          u: t.u,
          v: t.v,
          score: 999,
          fallback: true
        };
      }
      out.push(best);
    }
    return out;
  }, TARGETS);

  fs.writeFileSync(path.join(outDir, 'pick.json'), JSON.stringify(picked, null, 2));
  console.log(JSON.stringify(picked, null, 2));

  const annos = picked.map((p) => ({
    id: 'anno_l05_' + p.id,
    annotationKind: 'leader',
    text: p.id,
    detailText: '',
    collapsed: false,
    color: '#bfbfbf',
    dx: p.dx,
    dy: p.dy,
    dxN: p.dx * 0.0007,
    dyN: p.dy * 0.0007,
    dxW: p.dx * 0.0025,
    dyW: p.dy * 0.0025,
    localPos: p.localPos,
    localNormal: p.localNormal,
    baseDist: p.baseDist,
    baseScale: 5.8,
    labelShape: 'circle',
    occludeDot: -0.35
  }));
  const byId = Object.fromEntries(annos.map((a) => [a.text.trim(), a]));
  const dashed = [];
  for (let i = 1; i <= 4; i++) {
    const a = byId[String(i)];
    const b = byId[String(i + 1)];
    dashed.push({
      id: 'dash_l05_' + i,
      color: '#9a9a9a',
      kind: 'bezier',
      strokeWidth: 2.2,
      capR: 1,
      opacity: 0.78,
      points: [
        {
          pos: [...a.localPos],
          norm: [...a.localNormal],
          handleOut: [
            (b.localPos[0] - a.localPos[0]) * 0.22,
            (b.localPos[1] - a.localPos[1]) * 0.28,
            (b.localPos[2] - a.localPos[2]) * 0.14
          ]
        },
        {
          pos: [...b.localPos],
          norm: [...b.localNormal],
          handleIn: [
            (a.localPos[0] - b.localPos[0]) * 0.22,
            (a.localPos[1] - b.localPos[1]) * 0.28,
            (a.localPos[2] - b.localPos[2]) * 0.14
          ]
        }
      ]
    });
  }

  const f = load205();
  f.data.items[0].annotations = annos;
  f.data.items[0].dashedLines = dashed;
  f.data.meta.status = 'seeded';
  fs.writeFileSync(f.full, JSON.stringify(f.data) + '\n');
  rebuild();

  await page.goto(`${baseUrl}/Solid.html?sandbox=headform&skipPerf=1&_=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 90000
  });
  await page.waitForTimeout(1000);
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
    if (m) m.style.display = 'none';
    const i = window.customScenes.findIndex((s) => s && s.id === 'L05');
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
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(1600);
  await page.evaluate(() => {
    const el = document.getElementById('scene-loader');
    if (el) el.style.display = 'none';
    window.showAnnotations = true;
    try {
      if (typeof window.stopRender === 'function') window.stopRender();
    } catch (e) {}
  });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(outDir, 'L05-annotated.png'), timeout: 45000 });
  await page.evaluate(() => {
    window.showAnnotations = false;
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outDir, 'L05-clean.png'), timeout: 45000 });
  console.log('OUT', outDir);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
