/**
 * V02 头廓专用：只认「头宽」左缘（宽肩剔除）+ 颏底带
 */
require('./_playwright-browsers-path');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-bald-V02-head-contour`);
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:18080';
fs.mkdirSync(outDir, { recursive: true });
const RE = /^(\d+[A-Za-z]?)_(.+)\.json$/i;

function rebuild() {
  const all = fs.readdirSync(jsonDir).filter((n) => RE.test(n));
  all.sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));
  // keep reference-first order via meta
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
    if ((d.meta && d.meta.slot) !== 'V02') continue;
    if (f.includes('光头亚裔') || (d.meta && d.meta.modelId) === 'male_bald_asian_01') target = { f, d };
    else if (f.includes('女05')) continue;
    else male = { f, d };
  }
  return { male, target };
}

(async () => {
  const pair = loadPair();
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(300000);
  await page.goto(`${baseUrl}/Solid?sandbox=headform&skipPerf=1&_=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 180000
  });
  await page.waitForSelector('#scene-grid-modal', { state: 'visible', timeout: 180000 });

  async function openId(id) {
    const idx = await page.evaluate((sid) => (window.customScenes || []).findIndex((s) => s && String(s.id) === sid), id);
    if (idx < 0) throw new Error('missing ' + id);
    await page.evaluate((i) => {
      window.currentSceneIndex = -1;
      window.switchScene(i);
    }, idx);
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
    if (!root) throw new Error('no glb root on male');
    return annos.map((a) => {
      const w = new THREE.Vector3(...(a.localPos || [0, 0, 0]));
      root.localToWorld(w);
      const sp = w.project(cam);
      return { id: a.id, text: a.text, u: (sp.x + 1) / 2, v: (1 - sp.y) / 2 };
    });
  }, pair.male.d.items[0].annotations);

  await openId(pair.target.d.id);
  await applyCam(pair.male.d.camera);

  const result = await page.evaluate(({ annos, maleUVs }) => {
    const host = window.__solidHost;
    const THREE = host.getTHREE();
    const cam = host.getCamera();
    const g = host.getSceneGroup();
    let root = null;
    g.traverse((o) => {
      if (!root && o.userData && o.userData.type === 'glb') root = o;
    });
    const meshes = [];
    root.traverse((o) => {
      if (o.isMesh && o.geometry) meshes.push(o);
    });
    const raycaster = new THREE.Raycaster();
    const boxW = new THREE.Box3().setFromObject(root);
    const midV = 0.32;
    // 在额中高度测头半宽（左缘 u）
    let headLeftU = 0.45;
    for (let u = 0.1; u < 0.55; u += 0.002) {
      raycaster.setFromCamera(new THREE.Vector2(u * 2 - 1, -(midV * 2 - 1)), cam);
      const hits = raycaster.intersectObjects(meshes, true);
      if (!hits.length) continue;
      const lp = root.worldToLocal(hits[0].point.clone());
      if (lp.z < -0.01) continue;
      headLeftU = u;
      break;
    }
    // 头半宽容差：左缘不应比额部左缘更左超过 ~0.02（肩会更左）
    const uMinHead = headLeftU - 0.025;

    function hitAt(u, v) {
      raycaster.setFromCamera(new THREE.Vector2(u * 2 - 1, -(v * 2 - 1)), cam);
      return raycaster.intersectObjects(meshes, true)[0] || null;
    }
    function toLocal(hit) {
      const lp = root.worldToLocal(hit.point.clone());
      return [lp.x, lp.y, lp.z];
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
    function headLeftEdge(v) {
      const cands = [];
      for (let u = Math.max(0.08, uMinHead); u <= 0.55; u += 0.002) {
        const hit = hitAt(u, v);
        if (!hit) continue;
        const lp = toLocal(hit);
        if (lp[2] < -0.015) continue;
        // 肩：同高度下比头更左的点已通过 uMinHead 排除
        cands.push({ u, hit, lp });
      }
      if (!cands.length) return null;
      let best = cands[0];
      let lo = Math.max(uMinHead, best.u - 0.02);
      let hi = best.u;
      for (let i = 0; i < 14; i++) {
        const mid = (lo + hi) / 2;
        const hit = hitAt(mid, v);
        if (!hit) {
          lo = mid;
          continue;
        }
        const lp = toLocal(hit);
        if (lp[2] < -0.015) {
          lo = mid;
          continue;
        }
        best = { u: mid, hit, lp };
        hi = mid;
      }
      return best;
    }
    function chinPoints() {
      // 在头左缘折线底部找颏：沿 v 扫头左缘，取最下且 z 靠前
      let chain = [];
      for (let v = 0.2; v <= 0.7; v += 0.006) {
        const e = headLeftEdge(v);
        if (e) chain.push({ v, ...e });
      }
      // 颏结节：链上 v 较大且 z 较大的左侧点
      let chinL = null;
      for (const c of chain) {
        if (c.v < 0.48 || c.v > 0.66) continue;
        if (c.lp[2] < 0.005) continue;
        if (!chinL || c.v > chinL.v) chinL = c;
      }
      // 颏底：中线附近最低靠前
      let chinC = null;
      for (let v = 0.5; v <= 0.68; v += 0.004) {
        for (let u = 0.45; u <= 0.55; u += 0.004) {
          const hit = hitAt(u, v);
          if (!hit) continue;
          const lp = toLocal(hit);
          if (lp[2] < 0.02) continue;
          if (Math.abs(lp[0]) > 0.05) continue;
          if (!chinC || hit.point.y < chinC.hit.point.y) chinC = { u, v, hit, lp };
        }
      }
      return { chinL, chinC, chainN: chain.length };
    }

    const uvByText = Object.create(null);
    for (const x of maleUVs) uvByText[x.text] = x;
    const chinInfo = chinPoints();
    const { chinL, chinC, chainN } = chinInfo;
    const out = [];
    const dbg = [{ headLeftU, uMinHead, chainN, chinL: chinL && { v: chinL.v, u: chinL.u, z: chinL.lp[2] }, chinC: chinC && { v: chinC.v, u: chinC.u } }];

    for (const a of annos) {
      const muv = uvByText[a.text];
      let edge = null;
      if (a.text === '5' && chinL) edge = chinL;
      else if (a.text === '6' && chinC) edge = chinC;
      else if (muv) edge = headLeftEdge(muv.v);
      if (!edge || !edge.hit) {
        out.push(a);
        dbg.push({ text: a.text, ok: false });
        continue;
      }
      out.push(pack(edge.hit, a));
      dbg.push({ text: a.text, ok: true, u: +edge.u.toFixed(4), v: +(edge.v || muv.v).toFixed(4), z: +edge.lp[2].toFixed(4) });
    }
    return { annotations: out, dbg };
  }, { annos: pair.target.d.items[0].annotations, maleUVs });

  fs.writeFileSync(path.join(outDir, 'dbg.json'), JSON.stringify(result.dbg, null, 2));
  console.log(JSON.stringify(result.dbg, null, 2));

  const data = JSON.parse(fs.readFileSync(path.join(jsonDir, pair.target.f), 'utf8'));
  data.items[0].annotations = result.annotations;
  data.meta.status = 'head_contour_pending_vision';
  fs.writeFileSync(path.join(jsonDir, pair.target.f), JSON.stringify(data));
  rebuild();

  await page.goto(`${baseUrl}/Solid?sandbox=headform&skipPerf=1&_=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 180000
  });
  await page.waitForSelector('#scene-grid-modal', { state: 'visible', timeout: 180000 });
  const idx = await page.evaluate(() => (window.customScenes || []).findIndex((s) => s && s.id === 'V02_male_bald_asian_01'));
  await page.evaluate((i) => {
    window.currentSceneIndex = -1;
    window.switchScene(i);
  }, idx);
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    const el = document.getElementById('scene-loader');
    if (el) el.style.display = 'none';
  });
  const shot = path.join(outDir, 'V02.png');
  await page.screenshot({ path: shot });
  console.log('SHOT', shot);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
