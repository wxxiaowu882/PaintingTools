/** 203-fix2：微调 ④颏唇沟交界、⑤颏底形交界，避免亮面/铸影 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-headform-203-fix2`);
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:18080';
fs.mkdirSync(outDir, { recursive: true });

function load203() {
  const f = fs.readdirSync(jsonDir).find((n) => n.startsWith('203_') && n.endsWith('.json'));
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
  // 下唇下缘 → 颏唇沟暗带的上缘（交界，不是颏球亮面）
  { id: '4', text: '4', color: '#bfbfbf', target: { x: 0.0, y: 0.088, z: 0.086 }, box: [0.45, 0.55, 0.58, 0.66], dx: 72, dy: 18, prefer: 'center', preferZ: 0.075 },
  // 颏底形交界：颏下缘翻进暗部（略后、略下），避免颈上铸影
  { id: '5', text: '5', color: '#bfbfbf', target: { x: 0.0, y: 0.038, z: 0.042 }, box: [0.44, 0.56, 0.72, 0.88], dx: 0, dy: 58, prefer: 'center', preferZ: 0.02 }
];

(async () => {
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
    let i = (window.customScenes || []).findIndex((s) => s && s.id === 'L03');
    if (i < 0) i = (window.customScenes || []).findIndex((s) => s && /蝴蝶/.test(String(s.name || '')));
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
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(2500);
  for (let k = 0; k < 6; k++) {
    await page.evaluate(() => {
      try {
        if (typeof window.stopRender === 'function') window.stopRender();
      } catch (e) {}
      window.useAdvancedRender = false;
      const el = document.getElementById('scene-loader');
      if (el) el.style.display = 'none';
    });
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
    const raycaster = new THREE.Raycaster();
    const lp = new THREE.Vector3();
    function okSide(prefer, x) {
      if (prefer === 'center') return Math.abs(x) < 0.018;
      return true;
    }
    function scan(spec) {
      const [u0, u1, v0, v1] = spec.box;
      let best = null;
      let bestScore = 1e9;
      for (let v = v0; v <= v1; v += 0.004) {
        for (let u = u0; u <= u1; u += 0.004) {
          raycaster.setFromCamera(new THREE.Vector2(u * 2 - 1, -(v * 2 - 1)), cam);
          const hit = raycaster.intersectObjects(meshes, true)[0];
          if (!hit) continue;
          lp.copy(hit.point);
          root.worldToLocal(lp);
          if (!okSide(spec.prefer, lp.x)) continue;
          const t = spec.target;
          let score = (lp.x - t.x) ** 2 + (lp.y - t.y) ** 2 + (lp.z - t.z) ** 2;
          // ⑤偏好更小的 z（颏底翻进）
          if (typeof spec.preferZ === 'number') score += Math.max(0, lp.z - spec.preferZ) * 0.02;
          if (score < bestScore) {
            bestScore = score;
            best = { hit, x: lp.x, y: lp.y, z: lp.z, d: Math.sqrt(score) };
          }
        }
      }
      return best;
    }
    const out = [];
    for (const spec of specs) {
      const best = scan(spec);
      if (!best) {
        out.push({ id: spec.id, ok: false });
        continue;
      }
      lp.copy(best.hit.point);
      root.worldToLocal(lp);
      let nWorld = new THREE.Vector3(0, -0.2, 0.6);
      if (best.hit.face && best.hit.face.normal) {
        nWorld = best.hit.face.normal.clone().transformDirection(best.hit.object.matrixWorld).normalize();
      }
      const localNormal = root.worldToLocal(best.hit.point.clone().add(nWorld)).sub(lp.clone()).normalize();
      out.push({
        id: spec.id,
        ok: true,
        text: spec.text,
        color: spec.color,
        dx: spec.dx,
        dy: spec.dy,
        localPos: [+lp.x.toFixed(4), +lp.y.toFixed(4), +lp.z.toFixed(4)],
        localNormal: [+localNormal.x.toFixed(3), +localNormal.y.toFixed(3), +localNormal.z.toFixed(3)],
        baseDist: +best.hit.distance.toFixed(4),
        dbg: [+best.x.toFixed(3), +best.y.toFixed(3), +best.z.toFixed(3)]
      });
    }
    return out;
  }, SPECS);

  console.log(placed);
  const file = load203();
  for (const p of placed) {
    if (!p.ok) continue;
    const a = (file.data.items[0].annotations || []).find((x) => x.text === p.text);
    if (!a) continue;
    a.localPos = p.localPos;
    a.localNormal = p.localNormal;
    a.baseDist = p.baseDist;
    a.dx = p.dx;
    a.dy = p.dy;
  }
  file.data.id = 'L03';
  fs.writeFileSync(file.full, JSON.stringify(file.data) + '\n');
  rebuild();

  await page.evaluate(() => {
    if (window.loadJSONData) window.loadJSONData();
  });
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    let i = (window.customScenes || []).findIndex((s) => s && s.id === 'L03');
    if (i < 0) i = (window.customScenes || []).findIndex((s) => s && /蝴蝶/.test(String(s.name || '')));
    window.currentSceneIndex = -1;
    window.switchScene(i);
  });
  await page.waitForTimeout(2200);
  for (let k = 0; k < 5; k++) {
    await page.evaluate(() => {
      try {
        if (typeof window.stopRender === 'function') window.stopRender();
      } catch (e) {}
      window.useAdvancedRender = false;
    });
    await page.waitForTimeout(250);
  }
  const crop = await page.evaluate(() => {
    const s = (window.customScenes || []).find((x) => x && x.id === 'L03');
    const c = (s && s.crop) || {};
    return { x: parseFloat(c.left) || 260, y: parseFloat(c.top) || 70, width: 760, height: 720 };
  });
  await page.evaluate(() => {
    if (window.showAnnotations !== true && typeof window.toggleAnnotations === 'function') window.toggleAnnotations();
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outDir, 'L03-annotated-crop.png'), clip: crop });
  await page.evaluate(() => {
    if (window.showAnnotations !== false && typeof window.toggleAnnotations === 'function') window.toggleAnnotations();
  });
  await page.waitForTimeout(300);
  const thumb = await page.screenshot({
    type: 'jpeg',
    quality: 72,
    clip: { x: crop.x + 30, y: crop.y + 30, width: 700, height: 700 }
  });
  const f2 = load203();
  f2.data.thumbnail = 'data:image/jpeg;base64,' + thumb.toString('base64');
  f2.data.id = 'L03';
  fs.writeFileSync(f2.full, JSON.stringify(f2.data) + '\n');
  rebuild();
  console.log('OUT', outDir);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
