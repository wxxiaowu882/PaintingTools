require('./_playwright-browsers-path');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const f = fs.readdirSync(jsonDir).find((n) => n.includes('光头亚裔') && n.startsWith('102_'));
const dataPath = path.join(jsonDir, f);
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
const RE = /^(\d+[A-Za-z]?)_(.+)\.json$/i;
const outShot = path.join(repoRoot, '.cursor/browser-automation/runs/bald-V02-handtune-34A.png');

function rebuild() {
  const all = fs.readdirSync(jsonDir).filter((n) => RE.test(n));
  all.sort((a, b) => {
    const ma = a.match(RE);
    const mb = b.match(RE);
    const na = Number((ma[1].match(/\d+/) || [0])[0]);
    const nb = Number((mb[1].match(/\d+/) || [0])[0]);
    if (na !== nb) return na - nb;
    const la = ma[1].replace(/^\d+/, '');
    const lb = mb[1].replace(/^\d+/, '');
    if (la !== lb) return la.localeCompare(lb, 'zh-CN');
    const da = JSON.parse(fs.readFileSync(path.join(jsonDir, a), 'utf8'));
    const db = JSON.parse(fs.readFileSync(path.join(jsonDir, b), 'utf8'));
    const ra = da.meta && da.meta.modelRole === 'reference' ? 0 : 1;
    const rb = db.meta && db.meta.modelRole === 'reference' ? 0 : 1;
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b, 'zh-CN', { numeric: true });
  });
  fs.writeFileSync(
    path.join(jsonDir, '沙盒_头部造型规律.json'),
    JSON.stringify(all.map((n) => JSON.parse(fs.readFileSync(path.join(jsonDir, n), 'utf8'))))
  );
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto('http://127.0.0.1:18080/Solid?sandbox=headform&skipPerf=1&_=' + Date.now(), {
    waitUntil: 'domcontentloaded',
    timeout: 180000
  });
  await page.waitForSelector('#scene-grid-modal', { state: 'visible', timeout: 180000 });
  const idx = await page.evaluate(() => (window.customScenes || []).findIndex((s) => s && s.id === 'V02_male_bald_asian_01'));
  await page.evaluate((i) => {
    window.currentSceneIndex = -1;
    window.switchScene(i);
  }, idx);
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    const el = document.getElementById('scene-loader');
    if (el) el.style.display = 'none';
    const m = document.getElementById('scene-grid-modal');
    if (m) m.style.display = 'none';
  });
  await page.waitForFunction(() => {
    const host = window.__solidHost;
    if (!host || !host.getSceneGroup) return false;
    const g = host.getSceneGroup();
    if (!g) return false;
    let n = 0;
    g.traverse((o) => {
      if (o.isMesh) n++;
    });
    return n > 0;
  }, null, { timeout: 120000 });
  await page.waitForTimeout(800);

  const targets = { 3: 0.38, 4: 0.48, A: 0.54 };
  const updated = await page.evaluate((targets) => {
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
    function hitAt(u, v) {
      raycaster.setFromCamera(new THREE.Vector2(u * 2 - 1, -(v * 2 - 1)), cam);
      return raycaster.intersectObjects(meshes, true)[0] || null;
    }
    let browL = 0.41;
    for (let u = 0.12; u < 0.55; u += 0.002) {
      const h = hitAt(u, 0.28);
      if (!h) continue;
      const lp = root.worldToLocal(h.point.clone());
      if (lp.z < -0.01) continue;
      browL = u;
      break;
    }
    const uFloor = browL - 0.015;
    function headLeft(v, preferZ) {
      let first = null;
      for (let u = Math.max(0.1, uFloor); u <= 0.55; u += 0.002) {
        const h = hitAt(u, v);
        if (!h) continue;
        const lp = root.worldToLocal(h.point.clone());
        if (lp.z < preferZ) continue;
        first = { u, hit: h, lp };
        break;
      }
      if (!first) return null;
      let lo = Math.max(uFloor, first.u - 0.02);
      let hi = first.u;
      let best = first;
      for (let i = 0; i < 14; i++) {
        const mid = (lo + hi) / 2;
        const h = hitAt(mid, v);
        if (!h) {
          lo = mid;
          continue;
        }
        const lp = root.worldToLocal(h.point.clone());
        if (lp.z < preferZ) {
          lo = mid;
          continue;
        }
        best = { u: mid, hit: h, lp };
        hi = mid;
      }
      return best;
    }
    function pack(hit, prev) {
      const localPos = root.worldToLocal(hit.point.clone());
      let nWorld = new THREE.Vector3(-1, 0, 0);
      if (hit.face && hit.face.normal) {
        nWorld = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
      }
      const localNormal = root.worldToLocal(hit.point.clone().add(nWorld)).sub(localPos.clone()).normalize();
      return Object.assign({}, prev, {
        localPos: [+localPos.x.toFixed(4), +localPos.y.toFixed(4), +localPos.z.toFixed(4)],
        localNormal: [+localNormal.x.toFixed(3), +localNormal.y.toFixed(3), +localNormal.z.toFixed(3)],
        baseDist: +hit.distance.toFixed(4),
        baseScale: +Number(root.scale.x).toFixed(4)
      });
    }
    const scene = (window.customScenes || [])[window.currentSceneIndex];
    const annos = (scene.items[0].annotations || []).slice();
    const dbg = [];
    for (let i = 0; i < annos.length; i++) {
      const t = annos[i].text;
      if (!(t in targets)) continue;
      const preferZ = t === '3' ? 0.01 : -0.005;
      const edge = headLeft(targets[t], preferZ);
      if (!edge) {
        dbg.push({ t, ok: false });
        continue;
      }
      annos[i] = pack(edge.hit, annos[i]);
      dbg.push({ t, ok: true, u: +edge.u.toFixed(4), v: targets[t], z: +edge.lp.z.toFixed(4) });
    }
    return { annos, dbg };
  }, targets);

  console.log(updated.dbg);
  data.items[0].annotations = updated.annos;
  data.meta.status = 'v02_handtune_pending_vision';
  fs.writeFileSync(dataPath, JSON.stringify(data));
  rebuild();

  await page.goto('http://127.0.0.1:18080/Solid?sandbox=headform&skipPerf=1&_=' + Date.now(), {
    waitUntil: 'domcontentloaded',
    timeout: 180000
  });
  await page.waitForSelector('#scene-grid-modal', { state: 'visible', timeout: 180000 });
  const idx2 = await page.evaluate(() => (window.customScenes || []).findIndex((s) => s && s.id === 'V02_male_bald_asian_01'));
  await page.evaluate((i) => {
    window.currentSceneIndex = -1;
    window.switchScene(i);
  }, idx2);
  await page.waitForTimeout(3000);
  await page.evaluate(() => {
    const el = document.getElementById('scene-loader');
    if (el) el.style.display = 'none';
  });
  await page.screenshot({ path: outShot });
  console.log('SHOT', outShot);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
