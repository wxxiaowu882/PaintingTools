/**
 * 女05 V02：把已有标注钉到「该高度真实左缘」剪影（步长 0.001）
 * 3 号：若最左是耳（更后且更左），改用忽略耳后的脸廓左缘
 * 写回 + 实机截图
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const femalePath = path.join(jsonDir, '102_女05_【外轮廓规律】正面.json');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-female05-V02-edge-snap`);
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

async function waitReady(page) {
  await page
    .waitForFunction(() => {
      const el = document.getElementById('scene-loader');
      if (!el) return true;
      const st = getComputedStyle(el);
      return st.display === 'none' || Number(st.opacity || 1) < 0.05;
    }, null, { timeout: 420000 })
    .catch(() => {});
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    const el = document.getElementById('scene-loader');
    if (el) el.style.display = 'none';
    const m = document.getElementById('scene-grid-modal');
    if (m) m.style.display = 'none';
  });
}

(async () => {
  console.log('[edge-snap] start', outDir);
  const data = JSON.parse(fs.readFileSync(femalePath, 'utf8'));
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(300000);

  await page.goto(`${baseUrl}/Solid?sandbox=headform&skipPerf=1&_=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 180000
  });
  await page.waitForSelector('#scene-grid-modal', { state: 'visible', timeout: 180000 });
  const idx = await page.evaluate(() => (window.customScenes || []).findIndex((s) => s && s.id === 'V02_female_05'));
  await page.evaluate((i) => {
    window.currentSceneIndex = -1;
    window.switchScene(i);
  }, idx);
  await waitReady(page);
  console.log('[edge-snap] ready');

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
    const _lp = new THREE.Vector3();
    let rayN = 0;

    function hitAt(u, v) {
      rayN++;
      raycaster.setFromCamera(new THREE.Vector2(u * 2 - 1, -(v * 2 - 1)), cam);
      return raycaster.intersectObjects(meshes, true)[0] || null;
    }

    function toLocal(hit) {
      _lp.copy(hit.point);
      root.worldToLocal(_lp);
      return { x: _lp.x, y: _lp.y, z: _lp.z };
    }

    function projectAnno(localPos) {
      const w = new THREE.Vector3(localPos[0], localPos[1], localPos[2]);
      root.localToWorld(w);
      const sp = w.clone().project(cam);
      return { u: (sp.x + 1) / 2, v: (1 - sp.y) / 2 };
    }

    /** 精细左缘：粗扫 + 边界二分 */
    function leftEdge(v, opts) {
      const ignoreEar = !!(opts && opts.ignoreEar);
      const cands = [];
      for (let u = 0.12; u <= 0.55; u += 0.003) {
        const hit = hitAt(u, v);
        if (!hit) continue;
        const lp = toLocal(hit);
        if (lp.x > 0.02) continue;
        cands.push({ u, hit, ...lp });
      }
      if (!cands.length) return null;
      let pick = cands[0];
      if (ignoreEar) {
        const face = cands.filter((c) => c.z >= 0.02);
        if (face.length && face[0].u - cands[0].u >= 0.01 && cands[0].z < face[0].z - 0.012) {
          pick = face[0];
        }
      }
      // 在 pick.u 左侧二分，贴紧剪影
      let lo = Math.max(0.1, pick.u - 0.02);
      let hi = pick.u;
      let best = pick;
      for (let i = 0; i < 14; i++) {
        const mid = (lo + hi) / 2;
        const hit = hitAt(mid, v);
        if (!hit) {
          lo = mid;
          continue;
        }
        const lp = toLocal(hit);
        if (ignoreEar && lp.z < 0.015 && best.z >= 0.02) {
          lo = mid;
          continue;
        }
        if (lp.x > 0.02) {
          lo = mid;
          continue;
        }
        best = { u: mid, hit, ...lp };
        hi = mid;
      }
      return best;
    }

    function toAnnoFields(hit, prev) {
      const world = hit.point.clone();
      const localPos = root.worldToLocal(world.clone());
      let nWorld = new THREE.Vector3(-1, 0, 0);
      if (hit.face && hit.face.normal) {
        nWorld = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
      }
      const localNormal = root.worldToLocal(world.clone().add(nWorld)).sub(localPos.clone()).normalize();
      return Object.assign({}, prev, {
        localPos: [+localPos.x.toFixed(4), +localPos.y.toFixed(4), +localPos.z.toFixed(4)],
        localNormal: [+localNormal.x.toFixed(3), +localNormal.y.toFixed(3), +localNormal.z.toFixed(3)],
        baseDist: +hit.distance.toFixed(4),
        dx: 0,
        dy: 0,
        dxN: 0,
        dyN: 0,
        dxW: 0,
        dyW: 0
      });
    }

    const out = [];
    const debug = [];
    for (const a of annos) {
      const pv = projectAnno(a.localPos);
      // 颏：略降 v，贴颏底左缘
      let v = pv.v;
      if (a.text === '5') v = Math.min(0.82, pv.v + 0.02);
      if (a.text === 'A') v = pv.v;
      const ignoreEar = a.text === '3';
      const edge = leftEdge(v, { ignoreEar });
      if (!edge || !edge.hit) {
        out.push(a);
        debug.push({ text: a.text, error: 'no edge', pv });
        continue;
      }
      out.push(toAnnoFields(edge.hit, a));
      const after = projectAnno(out[out.length - 1].localPos);
      debug.push({
        text: a.text,
        beforeU: +pv.u.toFixed(4),
        afterU: +after.u.toFixed(4),
        edgeU: +edge.u.toFixed(4),
        du: +(after.u - edge.u).toFixed(4),
        z: +edge.z.toFixed(4)
      });
    }
    return { annotations: out, debug, rayN };
  }, data.items[0].annotations || []);

  fs.writeFileSync(path.join(outDir, 'snap.json'), JSON.stringify(snapped.debug, null, 2));
  console.log('[edge-snap] debug', snapped.debug);

  data.items[0].annotations = snapped.annotations;
  data.meta.status = 'vision_pending';
  fs.writeFileSync(femalePath, JSON.stringify(data));
  rebuildAggregate();
  console.log('[edge-snap] wrote json');

  // 重载实机截图
  await page.goto(`${baseUrl}/Solid?sandbox=headform&skipPerf=1&_=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 180000
  });
  await page.waitForSelector('#scene-grid-modal', { state: 'visible', timeout: 180000 });
  const idx2 = await page.evaluate(() => (window.customScenes || []).findIndex((s) => s && s.id === 'V02_female_05'));
  await page.evaluate((i) => {
    window.currentSceneIndex = -1;
    window.switchScene(i);
  }, idx2);
  await waitReady(page);
  await page.waitForTimeout(1200);
  const shot = path.join(outDir, 'female05-V02-solid.png');
  await page.screenshot({ path: shot, fullPage: false });
  console.log('SHOT', shot);
  await browser.close();
  console.log('DONE');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
