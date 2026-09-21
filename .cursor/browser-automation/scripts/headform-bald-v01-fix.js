/**
 * V01 光头亚裔：大本屏幕 v → 头宽左缘；4/5/C/D 用面前搜索防扫肩
 */
require('./_playwright-browsers-path');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-bald-V01-fix`);
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:18080';
fs.mkdirSync(outDir, { recursive: true });
const RE = /^(\d+[A-Za-z]?)_(.+)\.json$/i;

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

function loadPair() {
  let male;
  let target;
  for (const f of fs.readdirSync(jsonDir).filter((n) => RE.test(n))) {
    const d = JSON.parse(fs.readFileSync(path.join(jsonDir, f), 'utf8'));
    if ((d.meta && d.meta.slot) !== 'V01') continue;
    if (f.includes('光头亚裔') || (d.meta && d.meta.modelId) === 'male_bald_asian_01') target = { f, d };
    else if (f.includes('女05')) continue;
    else male = { f, d };
  }
  return { male, target };
}

(async () => {
  const pair = loadPair();
  if (!pair.male || !pair.target) throw new Error('pair missing');
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(300000);

  async function ready() {
    await page
      .waitForFunction(() => {
        const el = document.getElementById('scene-loader');
        if (!el) return true;
        const st = getComputedStyle(el);
        return st.display === 'none' || Number(st.opacity || 1) < 0.05;
      }, null, { timeout: 180000 })
      .catch(() => {});
    await page.waitForTimeout(2000);
    await page.evaluate(() => {
      const el = document.getElementById('scene-loader');
      if (el) el.style.display = 'none';
      const m = document.getElementById('scene-grid-modal');
      if (m) m.style.display = 'none';
    });
    await page.waitForFunction(() => {
      const host = window.__solidHost;
      if (!host || !host.getSceneGroup) return false;
      let n = 0;
      host.getSceneGroup().traverse((o) => {
        if (o.isMesh) n++;
      });
      return n > 0;
    }, null, { timeout: 120000 });
  }

  async function openId(id) {
    const idx = await page.evaluate((sid) => (window.customScenes || []).findIndex((s) => s && String(s.id) === sid), id);
    if (idx < 0) throw new Error('missing ' + id);
    await page.evaluate((i) => {
      window.currentSceneIndex = -1;
      window.switchScene(i);
    }, idx);
    await ready();
  }

  async function applyCam(cam) {
    if (!cam) return;
    await page.evaluate((c) => {
      const host = window.__solidHost;
      const camObj = host.getCamera();
      const controls = host.getControls && host.getControls();
      if (c.pos) camObj.position.set(c.pos[0], c.pos[1], c.pos[2]);
      if (typeof c.fov === 'number') camObj.fov = c.fov;
      if (typeof c.zoom === 'number') camObj.zoom = c.zoom;
      camObj.updateProjectionMatrix();
      if (controls && c.target) {
        controls.target.set(c.target[0], c.target[1], c.target[2]);
        controls.update();
      }
    }, cam);
    await page.waitForTimeout(300);
  }

  await page.goto(`${baseUrl}/Solid?sandbox=headform&skipPerf=1&_=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 180000
  });
  await page.waitForSelector('#scene-grid-modal', { state: 'visible', timeout: 180000 });

  await openId(pair.male.d.id);
  await applyCam(pair.male.d.camera);
  const maleUVs = await page.evaluate((annos) => {
    const host = window.__solidHost;
    const THREE = host.getTHREE();
    const cam = host.getCamera();
    const g = host.getSceneGroup();
    let root = null;
    g.traverse((o) => {
      if (!root && o.userData && o.userData.type === 'glb') root = o;
    });
    if (!root) root = g.children[0];
    return annos.map((a) => {
      const w = new THREE.Vector3(...(a.localPos || [0, 0, 0]));
      root.localToWorld(w);
      const sp = w.project(cam);
      return { text: a.text, id: a.id, u: (sp.x + 1) / 2, v: (1 - sp.y) / 2 };
    });
  }, pair.male.d.items[0].annotations);

  await openId(pair.target.d.id);
  await applyCam(pair.male.d.camera);

  const snapped = await page.evaluate(({ maleUVs, templates }) => {
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
    function lpOf(hit) {
      return root.worldToLocal(hit.point.clone());
    }
    function pack(hit, prev) {
      const localPos = lpOf(hit);
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

    let headLeftAtBrow = 0.42;
    for (let u = 0.12; u < 0.55; u += 0.002) {
      const h = hitAt(u, 0.3);
      if (!h) continue;
      const lp = lpOf(h);
      if (lp.z < -0.01) continue;
      headLeftAtBrow = u;
      break;
    }
    const uFloor = headLeftAtBrow - 0.02;

    function headLeft(v, preferZ) {
      let first = null;
      for (let u = Math.max(0.1, uFloor); u <= 0.58; u += 0.002) {
        const h = hitAt(u, v);
        if (!h) continue;
        const lp = lpOf(h);
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
        const lp = lpOf(h);
        if (lp.z < preferZ) {
          lo = mid;
          continue;
        }
        best = { u: mid, hit: h, lp };
        hi = mid;
      }
      return best;
    }

    // 下颌/颏：面前靠前点（防肩）
    function faceFrontBand(vCenter, wantMoreLeft) {
      let best = null;
      for (let dv = -0.04; dv <= 0.06; dv += 0.004) {
        for (let u = 0.36; u <= 0.52; u += 0.004) {
          const v = Math.min(0.72, Math.max(0.35, vCenter + dv));
          const h = hitAt(u, v);
          if (!h) continue;
          const lp = lpOf(h);
          if (lp.z < 0.02) continue;
          if (Math.abs(lp.x) > 0.1) continue;
          if (wantMoreLeft && lp.x > -0.01) continue;
          const score = lp.z * 3 - Math.abs(v - vCenter) - (wantMoreLeft ? lp.x : Math.abs(lp.x) * 0.3);
          if (!best || score > best.score) best = { u, v, hit: h, lp, score };
        }
      }
      return best;
    }

    const byText = Object.create(null);
    for (const x of maleUVs) byText[x.text] = x;
    const out = [];
    const dbg = [{ headLeftAtBrow, uFloor }];

    // 固定高度修正（侧前）：颧略抬、口轮/颏用面前带
    const vOverride = { 3: 0.4, 4: 0.52, 5: 0.58, C: 0.5, D: 0.55 };

    for (const a of templates) {
      const muv = byText[a.text];
      let edge = null;
      const v = vOverride[a.text] != null ? vOverride[a.text] : muv && muv.v;
      if (a.text === '5' || a.text === '4' || a.text === 'D') {
        edge = faceFrontBand(v || 0.55, true);
      } else if (a.text === 'C') {
        edge = faceFrontBand(v || 0.5, true);
      } else if (muv || v != null) {
        const preferZ = a.text === '3' ? 0.0 : -0.02;
        edge = headLeft(v, preferZ);
      }
      if (!edge || !edge.hit) {
        out.push(a);
        dbg.push({ text: a.text, ok: false });
        continue;
      }
      out.push(pack(edge.hit, a));
      dbg.push({
        text: a.text,
        ok: true,
        u: +edge.u.toFixed(4),
        v: +(edge.v != null ? edge.v : v).toFixed(4),
        z: +edge.lp.z.toFixed(4)
      });
    }
    return { annotations: out, dbg };
  }, { maleUVs, templates: pair.male.d.items[0].annotations });

  fs.writeFileSync(path.join(outDir, 'dbg.json'), JSON.stringify(snapped.dbg, null, 2));
  console.log(JSON.stringify(snapped.dbg, null, 2));

  const data = JSON.parse(fs.readFileSync(path.join(jsonDir, pair.target.f), 'utf8'));
  const oldByText = Object.create(null);
  for (const a of data.items[0].annotations || []) oldByText[a.text] = a;
  data.items[0].annotations = snapped.annotations.map((a) => {
    const old = oldByText[a.text];
    if (!old) return a;
    return Object.assign({}, a, {
      dx: old.dx,
      dy: old.dy,
      dxN: old.dxN,
      dyN: old.dyN,
      dxW: old.dxW,
      dyW: old.dyW,
      color: old.color,
      labelShape: old.labelShape
    });
  });
  data.meta.status = 'v01_headfix_pending_vision';
  fs.writeFileSync(path.join(jsonDir, pair.target.f), JSON.stringify(data));
  rebuild();

  await page.goto(`${baseUrl}/Solid?sandbox=headform&skipPerf=1&_=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 180000
  });
  await page.waitForSelector('#scene-grid-modal', { state: 'visible', timeout: 180000 });
  await openId(pair.target.d.id);
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    if (!window.showAnnotations && typeof window.toggleAnnotations === 'function') window.toggleAnnotations();
  });
  const shot = path.join(outDir, 'V01.png');
  const shot2 = path.join(runsRoot, '2026-09-19T00-46-56-headform-vision-baldasian', 'V01_anno.png');
  await page.screenshot({ path: shot });
  await page.screenshot({ path: shot2 });
  console.log('SHOT', shot);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
