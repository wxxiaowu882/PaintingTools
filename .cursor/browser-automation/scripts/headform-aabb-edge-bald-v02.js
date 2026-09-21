/**
 * 光头亚裔 V02：AABB 归一化迁点 + 左缘/颏底精修（排除宽肩）
 */
require('./_playwright-browsers-path');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-bald-V02-aabb-edge`);
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:18080';
fs.mkdirSync(outDir, { recursive: true });

const RE = /^(\d+[A-Za-z]?)_(.+)\.json$/i;

function rebuildAggregate() {
  function lessonNum(name) {
    const m = String(name).match(/^(\d+)/);
    return m ? Number(m[1]) : 0;
  }
  const all = fs.readdirSync(jsonDir).filter((n) => RE.test(n));
  all.sort((a, b) => {
    const ma = a.match(RE);
    const mb = b.match(RE);
    const na = lessonNum(ma[1]);
    const nb = lessonNum(mb[1]);
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
    else if ((d.meta && d.meta.modelRole) === 'reference' || /大本/.test((((d.items || [])[0] || {}).url) || '')) male = { f, d };
  }
  return { male, target };
}

async function waitReady(page) {
  await page
    .waitForFunction(() => {
      const el = document.getElementById('scene-loader');
      if (!el) return true;
      const st = getComputedStyle(el);
      return st.display === 'none' || Number(st.opacity || 1) < 0.05;
    }, null, { timeout: 420000 })
    .catch(() => {});
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    const el = document.getElementById('scene-loader');
    if (el) el.style.display = 'none';
    const m = document.getElementById('scene-grid-modal');
    if (m) m.style.display = 'none';
  });
}

async function openId(page, id) {
  const idx = await page.evaluate((sid) => (window.customScenes || []).findIndex((s) => s && String(s.id) === sid), id);
  if (idx < 0) throw new Error('missing ' + id);
  await page.evaluate((i) => {
    window.currentSceneIndex = -1;
    window.switchScene(i);
  }, idx);
  await waitReady(page);
}

async function measureLocalBox(page) {
  return page.evaluate(() => {
    const host = window.__solidHost;
    const THREE = host.getTHREE();
    const g = host.getSceneGroup();
    let root = null;
    g.traverse((o) => {
      if (!root && o.userData && o.userData.type === 'glb') root = o;
    });
    if (!root) root = g.children[0];
    const boxW = new THREE.Box3().setFromObject(root);
    const corners = [
      new THREE.Vector3(boxW.min.x, boxW.min.y, boxW.min.z),
      new THREE.Vector3(boxW.min.x, boxW.min.y, boxW.max.z),
      new THREE.Vector3(boxW.min.x, boxW.max.y, boxW.min.z),
      new THREE.Vector3(boxW.min.x, boxW.max.y, boxW.max.z),
      new THREE.Vector3(boxW.max.x, boxW.min.y, boxW.min.z),
      new THREE.Vector3(boxW.max.x, boxW.min.y, boxW.max.z),
      new THREE.Vector3(boxW.max.x, boxW.max.y, boxW.min.z),
      new THREE.Vector3(boxW.max.x, boxW.max.y, boxW.max.z)
    ];
    const boxL = new THREE.Box3();
    for (const c of corners) {
      root.worldToLocal(c);
      boxL.expandByPoint(c);
    }
    const size = boxL.getSize(new THREE.Vector3());
    return {
      min: [boxL.min.x, boxL.min.y, boxL.min.z],
      max: [boxL.max.x, boxL.max.y, boxL.max.z],
      size: [size.x, size.y, size.z]
    };
  });
}

function mapLocal(malePos, mBox, tBox) {
  const t = [
    mBox.size[0] > 1e-8 ? (malePos[0] - mBox.min[0]) / mBox.size[0] : 0.5,
    mBox.size[1] > 1e-8 ? (malePos[1] - mBox.min[1]) / mBox.size[1] : 0.5,
    mBox.size[2] > 1e-8 ? (malePos[2] - mBox.min[2]) / mBox.size[2] : 0.5
  ];
  return [
    tBox.min[0] + t[0] * tBox.size[0],
    tBox.min[1] + t[1] * tBox.size[1],
    tBox.min[2] + t[2] * tBox.size[2]
  ];
}

(async () => {
  const pair = loadPair();
  if (!pair.male || !pair.target) throw new Error('pair missing');
  const browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(300000);
  await page.goto(`${baseUrl}/Solid?sandbox=headform&skipPerf=1&_=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 180000
  });
  await page.waitForSelector('#scene-grid-modal', { state: 'visible', timeout: 180000 });

  await openId(page, pair.male.d.id);
  const maleBox = await measureLocalBox(page);
  await openId(page, pair.target.d.id);
  const targetBox = await measureLocalBox(page);
  fs.writeFileSync(path.join(outDir, 'boxes.json'), JSON.stringify({ maleBox, targetBox }, null, 2));

  const maleAnnos = pair.male.d.items[0].annotations || [];
  const seeded = maleAnnos.map((a) =>
    Object.assign({}, a, { localPos: mapLocal(a.localPos || [0, 0, 0], maleBox, targetBox).map((n) => +n.toFixed(4)) })
  );

  const snapped = await page.evaluate((annos) => {
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
    const boxW = new THREE.Box3().setFromObject(root);
    const sizeYW = boxW.max.y - boxW.min.y;
    const chinYBand = [boxW.min.y + sizeYW * 0.18, boxW.min.y + sizeYW * 0.42];

    function hitAt(u, v) {
      raycaster.setFromCamera(new THREE.Vector2(u * 2 - 1, -(v * 2 - 1)), cam);
      return raycaster.intersectObjects(meshes, true)[0] || null;
    }
    function toLocal(hit) {
      const lp = root.worldToLocal(hit.point.clone());
      return { x: lp.x, y: lp.y, z: lp.z };
    }
    function project(localPos) {
      const w = new THREE.Vector3(localPos[0], localPos[1], localPos[2]);
      root.localToWorld(w);
      const sp = w.project(cam);
      return { u: (sp.x + 1) / 2, v: (1 - sp.y) / 2 };
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
        baseScale: root.scale && root.scale.x ? +Number(root.scale.x).toFixed(4) : prev.baseScale
      });
    }
    function leftEdge(v, minYW) {
      const cands = [];
      for (let u = 0.1; u <= 0.55; u += 0.002) {
        const hit = hitAt(u, v);
        if (!hit || hit.point.y < minYW) continue;
        const lp = toLocal(hit);
        if (lp.z < -0.02) continue;
        cands.push({ u, hit, ...lp });
      }
      if (!cands.length) return null;
      let pick = cands[0];
      let lo = Math.max(0.08, pick.u - 0.02);
      let hi = pick.u;
      let best = pick;
      for (let i = 0; i < 14; i++) {
        const mid = (lo + hi) / 2;
        const hit = hitAt(mid, v);
        if (!hit || hit.point.y < minYW) {
          lo = mid;
          continue;
        }
        const lp = toLocal(hit);
        if (lp.z < -0.02) {
          lo = mid;
          continue;
        }
        best = { u: mid, hit, ...lp };
        hi = mid;
      }
      return best;
    }
    function snapChin(wantLeft) {
      let best = null;
      for (let v = 0.52; v <= 0.72; v += 0.004) {
        for (let u = 0.35; u <= 0.58; u += 0.004) {
          const hit = hitAt(u, v);
          if (!hit) continue;
          if (hit.point.y < chinYBand[0] || hit.point.y > chinYBand[1]) continue;
          const lp = toLocal(hit);
          if (lp.z < 0.01) continue;
          if (Math.abs(lp.x) > 0.09) continue;
          if (wantLeft && lp.x > -0.01) continue;
          if (!wantLeft && Math.abs(lp.x) > 0.04) continue;
          const score = lp.z * 2 - Math.abs(hit.point.y - (chinYBand[0] + chinYBand[1]) / 2) - (wantLeft ? lp.x : Math.abs(lp.x));
          if (!best || score > best.score) best = { u, v, hit, score, ...lp };
        }
      }
      return best;
    }

    const out = [];
    const dbg = [];
    const minYW = boxW.min.y + sizeYW * 0.2;
    for (const a of annos) {
      const pv = project(a.localPos || [0, 0, 0]);
      let edge = null;
      if (a.text === '6') edge = snapChin(false);
      else if (a.text === '5') edge = snapChin(true);
      else if (a.text === 'A') {
        edge = leftEdge(Math.min(0.62, pv.v), boxW.min.y + sizeYW * 0.22);
      } else if (a.text === '3') {
        // 颧：忽略耳，略抬
        edge = leftEdge(pv.v, boxW.min.y + sizeYW * 0.35);
      } else if (a.text === '4') {
        edge = leftEdge(pv.v, boxW.min.y + sizeYW * 0.28);
      } else {
        edge = leftEdge(pv.v, minYW);
      }
      if (!edge || !edge.hit) {
        // 回退：从 AABB 种子点射线贴面
        const seed = new THREE.Vector3(a.localPos[0], a.localPos[1], a.localPos[2]);
        root.localToWorld(seed);
        const sp = seed.clone().project(cam);
        const u = (sp.x + 1) / 2;
        const v = (1 - sp.y) / 2;
        const hit = hitAt(u, v);
        if (hit) {
          out.push(pack(hit, a));
          dbg.push({ text: a.text, ok: true, mode: 'seed-ray' });
        } else {
          out.push(a);
          dbg.push({ text: a.text, ok: false });
        }
        continue;
      }
      out.push(pack(edge.hit, a));
      const after = project(out[out.length - 1].localPos);
      dbg.push({ text: a.text, ok: true, u: +after.u.toFixed(4), v: +after.v.toFixed(4), z: +edge.z.toFixed(4) });
    }
    return { annotations: out, dbg };
  }, seeded);

  fs.writeFileSync(path.join(outDir, 'dbg.json'), JSON.stringify(snapped.dbg, null, 2));
  console.log(snapped.dbg);

  const data = JSON.parse(fs.readFileSync(path.join(jsonDir, pair.target.f), 'utf8'));
  data.items[0].annotations = snapped.annotations;
  data.meta.status = 'aabb_edge_pending_vision';
  fs.writeFileSync(path.join(jsonDir, pair.target.f), JSON.stringify(data));
  rebuildAggregate();

  await page.goto(`${baseUrl}/Solid?sandbox=headform&skipPerf=1&_=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 180000
  });
  await page.waitForSelector('#scene-grid-modal', { state: 'visible', timeout: 180000 });
  await openId(page, pair.target.d.id);
  await page.waitForTimeout(1000);
  const shot = path.join(outDir, 'V02.png');
  await page.screenshot({ path: shot });
  console.log('SHOT', shot);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
