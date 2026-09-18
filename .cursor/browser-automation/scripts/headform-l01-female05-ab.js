/**
 * 女05 L01：按大本屏幕 UV 补 A/B 支线标注（主交界 1–9 已由用户锚点生成）
 * 用法：PLAYWRIGHT_CHANNEL=msedge node headform-l01-female05-ab.js
 */
require('./_playwright-browsers-path');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-female05-L01-AB`);
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:18080';
fs.mkdirSync(outDir, { recursive: true });

function loadPair() {
  let male, female;
  for (const f of fs.readdirSync(jsonDir)) {
    if (!/^201_.*\.json$/i.test(f)) continue;
    const d = JSON.parse(fs.readFileSync(path.join(jsonDir, f), 'utf8'));
    if ((d.meta && d.meta.slot) !== 'L01') continue;
    const isF = (d.meta && d.meta.modelId) === 'female_05' || f.includes('女05');
    if (isF) female = { f, d };
    else male = { f, d };
  }
  return { male, female };
}

function rebuild() {
  const RE = /^(\d+[A-Za-z]?)_(.+)\.json$/i;
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
  fs.writeFileSync(path.join(jsonDir, '沙盒_头部造型规律.json'), JSON.stringify(all.map((n) => JSON.parse(fs.readFileSync(path.join(jsonDir, n), 'utf8')))));
}

async function launchBrowser() {
  const preferred = process.env.PLAYWRIGHT_CHANNEL || 'msedge';
  try {
    const b = await chromium.launch({ headless: true, channel: preferred });
    console.log('[L01-AB] channel', preferred);
    return b;
  } catch (e) {
    console.warn('[L01-AB] channel fail', e.message);
    return chromium.launch({ headless: true });
  }
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

async function openScene(page, id) {
  const idx = await page.evaluate((sid) => (window.customScenes || []).findIndex((s) => s && String(s.id) === sid), id);
  if (idx < 0) throw new Error('scene missing ' + id);
  await page.evaluate((i) => {
    window.currentSceneIndex = -1;
    window.switchScene(i);
  }, idx);
  await waitReady(page);
}

async function applyCamera(page, cam) {
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

(async () => {
  const { male, female } = loadPair();
  if (!male || !female) throw new Error('L01 pair missing');
  const need = ['A', 'B'].map((t) => male.d.items[0].annotations.find((a) => a.text === t)).filter(Boolean);
  if (need.length !== 2) throw new Error('male A/B missing');

  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(300000);

  await page.goto(`${baseUrl}/Solid?sandbox=headform&skipPerf=1&_=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 180000
  });
  await page.waitForSelector('#scene-grid-modal', { state: 'visible', timeout: 180000 });

  const cam = male.d.camera;
  await openScene(page, male.d.id);
  await applyCamera(page, cam);
  const uvs = await page.evaluate((annos) => {
    const host = window.__solidHost;
    const THREE = host.getTHREE();
    const camObj = host.getCamera();
    const g = host.getSceneGroup();
    let root = null;
    g.traverse((o) => {
      if (!root && o.userData && o.userData.type === 'glb') root = o;
    });
    if (!root) root = g.children[0];
    return annos.map((a) => {
      const w = new THREE.Vector3(a.localPos[0], a.localPos[1], a.localPos[2]);
      root.localToWorld(w);
      const sp = w.clone().project(camObj);
      return { text: a.text, u: (sp.x + 1) / 2, v: (1 - sp.y) / 2 };
    });
  }, need);
  console.log('[L01-AB] male UV', uvs);

  await openScene(page, female.d.id);
  await applyCamera(page, cam);
  const snapped = await page.evaluate((uvList) => {
    const host = window.__solidHost;
    const THREE = host.getTHREE();
    const camObj = host.getCamera();
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
    function hit(u, v) {
      raycaster.setFromCamera(new THREE.Vector2(u * 2 - 1, -(v * 2 - 1)), camObj);
      const hits = raycaster.intersectObjects(meshes, true);
      if (!hits.length) return null;
      const h = hits[0];
      const localPos = root.worldToLocal(h.point.clone());
      let nWorld = new THREE.Vector3(0, 1, 0);
      if (h.face && h.face.normal) {
        nWorld = h.face.normal.clone().transformDirection(h.object.matrixWorld).normalize();
      }
      const localNormal = root.worldToLocal(h.point.clone().add(nWorld)).sub(localPos.clone()).normalize();
      return {
        localPos: [+localPos.x.toFixed(4), +localPos.y.toFixed(4), +localPos.z.toFixed(4)],
        localNormal: [+localNormal.x.toFixed(3), +localNormal.y.toFixed(3), +localNormal.z.toFixed(3)],
        baseDist: +h.distance.toFixed(4)
      };
    }
    function snap(u, v) {
      let s = hit(u, v);
      if (s) return s;
      for (const r of [0.02, 0.05, 0.1]) {
        for (let a = 0; a < 8; a++) {
          const ang = (a / 8) * Math.PI * 2;
          s = hit(u + Math.cos(ang) * r, v + Math.sin(ang) * r);
          if (s) return s;
        }
      }
      return null;
    }
    return uvList.map((x) => ({ text: x.text, uv: x, sn: snap(x.u, x.v) }));
  }, uvs);
  console.log('[L01-AB] snapped', snapped);
  fs.writeFileSync(path.join(outDir, 'ab-debug.json'), JSON.stringify(snapped, null, 2));

  const femalePath = path.join(jsonDir, female.f);
  const data = JSON.parse(fs.readFileSync(femalePath, 'utf8'));
  const annos = (data.items[0].annotations || []).filter((a) => a.text !== 'A' && a.text !== 'B');
  for (const row of snapped) {
    if (!row.sn) throw new Error('snap fail ' + row.text);
    const src = need.find((a) => a.text === row.text);
    const a = JSON.parse(JSON.stringify(src));
    a.localPos = row.sn.localPos;
    a.localNormal = row.sn.localNormal;
    a.baseDist = row.sn.baseDist;
    a.id = 'anno_l01_f05_' + row.text + '_' + Date.now().toString(36);
    annos.push(a);
  }
  data.items[0].annotations = annos;
  data.meta.status = 'anchor_labeled_vision_pending';
  data.meta.screenRemapNote = '主交界1–9=用户锚点；A/B=大本同机位屏幕迁移';
  fs.writeFileSync(femalePath, JSON.stringify(data));
  rebuild();

  await page.goto(`${baseUrl}/Solid?sandbox=headform&skipPerf=1&_=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 180000
  });
  await page.waitForSelector('#scene-grid-modal', { state: 'visible', timeout: 180000 });
  await openScene(page, female.d.id);
  await page.waitForTimeout(1000);
  const shot = path.join(outDir, 'female05-L01.png');
  await page.screenshot({ path: shot, fullPage: false });
  console.log('[L01-AB] SHOT', shot);
  await browser.close();
  console.log('[L01-AB] DONE ann', annos.map((a) => a.text).join(','));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
