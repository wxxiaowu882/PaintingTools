/**
 * 光头亚裔 标注迁移（屏幕锚点法）
 * 1) 大本：标注 localPos → 屏幕 UV
 * 2) 光头亚裔同机位：UV 射线贴可见表面
 * 用法：ALL=1 node ... 或 SLOTS=V01,V02 node ...
 */
require('./_playwright-browsers-path');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

function launchBrowser() {
  const preferred = process.env.PLAYWRIGHT_CHANNEL || 'msedge';
  const fallbacks = [preferred, 'chrome'].filter((c, i, a) => a.indexOf(c) === i);
  return (async () => {
    let lastErr;
    for (const channel of fallbacks) {
      try {
        const browser = await chromium.launch({ headless: true, channel });
        console.log('[bald-remap] browser channel', channel);
        return browser;
      } catch (err) {
        lastErr = err;
        console.warn('[bald-remap] channel', channel, 'failed:', err.message);
      }
    }
    console.warn('[bald-remap] fallback bundled chromium');
    return chromium.launch({ headless: true });
  })();
}

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-bald-asian-screen-remap`);
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:18080';
const TARGET_ID = 'male_bald_asian_01';
const TARGET_LABEL = '光头亚裔';

const DEFAULT_SLOTS = [
  'V01', 'V02', 'V03', 'V04', 'V05a', 'V05b', 'V06', 'V07',
  'L01', 'L02', 'L03', 'L04', 'L05', 'L06', 'L07', 'L08', 'L09'
];
const SLOTS = process.env.ALL === '1'
  ? DEFAULT_SLOTS
  : (process.env.SLOTS || DEFAULT_SLOTS.join(','))
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

const RE = /^(\d+[A-Za-z]?)_(.+)\.json$/i;
fs.mkdirSync(outDir, { recursive: true });

function listScenes() {
  return fs.readdirSync(jsonDir).filter((n) => RE.test(n));
}

function isTarget(f, d) {
  if ((d.meta && d.meta.modelId) === TARGET_ID) return true;
  if (f.includes('光头亚裔')) return true;
  const url = String((((d.items || [])[0] || {}).url) || '');
  return /光头亚裔|真人头像_男_光头/i.test(url);
}

function isFemale(f, d) {
  if ((d.meta && d.meta.modelId) === 'female_05') return true;
  if (f.includes('女05')) return true;
  const url = String((((d.items || [])[0] || {}).url) || '');
  return /女中青年_05|女05/i.test(url);
}

function isReference(f, d) {
  if (isTarget(f, d) || isFemale(f, d)) return false;
  if (d.meta && d.meta.modelRole === 'reference') return true;
  const url = String((((d.items || [])[0] || {}).url) || '');
  return /大本|蝙蝠侠|布鲁斯/i.test(url);
}

function loadPair(slot) {
  let male;
  let target;
  for (const f of listScenes()) {
    const d = JSON.parse(fs.readFileSync(path.join(jsonDir, f), 'utf8'));
    if ((d.meta && d.meta.slot) !== slot) continue;
    if (isTarget(f, d)) target = { f, d };
    else if (isReference(f, d)) male = { f, d };
  }
  return { male, target };
}

function rebuildAggregate() {
  function lessonNum(name) {
    const m = String(name).match(/^(\d+)/);
    return m ? Number(m[1]) : 0;
  }
  const all = listScenes();
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

async function captureMaleUVs(page, annos, dashed) {
  return page.evaluate(
    ({ annos, dashed }) => {
      const host = window.__solidHost;
      const THREE = host.getTHREE();
      const cam = host.getCamera();
      const g = host.getSceneGroup();
      let root = null;
      g.traverse((o) => {
        if (!root && o.userData && o.userData.type === 'glb') root = o;
      });
      if (!root) root = g.children[0];

      function toUV(localPos) {
        const w = new THREE.Vector3(localPos[0], localPos[1], localPos[2]);
        root.localToWorld(w);
        const sp = w.clone().project(cam);
        return { u: (sp.x + 1) / 2, v: (1 - sp.y) / 2, ndcZ: sp.z };
      }

      const annoUV = annos.map((a) => ({
        id: a.id,
        text: a.text,
        uv: toUV(a.localPos || [0, 0, 0])
      }));

      const dashUV = dashed.map((line) => ({
        id: line.id,
        points: (line.points || []).map((p, i) => ({
          i,
          uv: toUV(p.pos || [0, 0, 0])
        }))
      }));

      return { annoUV, dashUV };
    },
    { annos, dashed }
  );
}

async function snapTargetAtUVs(page, maleAnnos, maleDashed, uvs) {
  return page.evaluate(
    ({ maleAnnos, maleDashed, uvs }) => {
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
      raycaster.params.Line = { threshold: 0.01 };

      function packHit(hit) {
        const localPos = root.worldToLocal(hit.point.clone());
        let nWorld = new THREE.Vector3(0, 1, 0);
        if (hit.face && hit.face.normal) {
          nWorld = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
        }
        const localNormal = root.worldToLocal(hit.point.clone().add(nWorld)).sub(localPos.clone()).normalize();
        const toCam = cam.position.clone().sub(hit.point).normalize();
        const facing = nWorld.dot(toCam);
        return {
          hit,
          localPos: [+localPos.x.toFixed(4), +localPos.y.toFixed(4), +localPos.z.toFixed(4)],
          localNormal: [+localNormal.x.toFixed(3), +localNormal.y.toFixed(3), +localNormal.z.toFixed(3)],
          baseDist: +hit.distance.toFixed(4),
          facing: +facing.toFixed(3)
        };
      }

      function hitUV(u, v) {
        raycaster.setFromCamera(new THREE.Vector2(u * 2 - 1, -(v * 2 - 1)), cam);
        const hits = raycaster.intersectObjects(meshes, true);
        if (!hits.length) return null;
        return packHit(hits[0]);
      }

      function snapWithFallback(u, v) {
        const tryList = [];
        const push = (uu, vv) => {
          const s = hitUV(uu, vv);
          if (!s) return;
          const du = uu - u;
          const dv = vv - v;
          s.uvDist = Math.sqrt(du * du + dv * dv);
          tryList.push(s);
        };
        push(u, v);
        if (tryList[0] && tryList[0].facing > -0.05) return tryList[0];
        for (const r of [0.012, 0.025, 0.05, 0.08, 0.12, 0.18]) {
          for (let a = 0; a < 8; a++) {
            const ang = (a / 8) * Math.PI * 2;
            push(u + Math.cos(ang) * r, v + Math.sin(ang) * r);
          }
        }
        for (let dv = -0.22; dv <= 0.22; dv += 0.016) {
          push(u, v + dv);
        }
        if (!tryList.length) return null;
        tryList.sort((a, b) => {
          const fa = a.facing > -0.05 ? 1 : 0;
          const fb = b.facing > -0.05 ? 1 : 0;
          if (fa !== fb) return fb - fa;
          if (Math.abs(a.uvDist - b.uvDist) > 1e-6) return a.uvDist - b.uvDist;
          return b.facing - a.facing;
        });
        return tryList[0];
      }

      const uvById = Object.create(null);
      const uvByText = Object.create(null);
      for (const x of uvs.annoUV) {
        uvById[x.id] = x.uv;
        uvByText[x.text] = x.uv;
      }

      const dbg = [];
      const annotations = [];
      for (const a of maleAnnos) {
        const uv = uvById[a.id] || uvByText[a.text];
        if (!uv) {
          dbg.push({ text: a.text, ok: false, reason: 'no uv' });
          continue;
        }
        const sn = snapWithFallback(uv.u, uv.v);
        if (!sn) {
          dbg.push({ text: a.text, ok: false, u: uv.u, v: uv.v });
          continue;
        }
        annotations.push(
          Object.assign({}, a, {
            localPos: sn.localPos,
            localNormal: sn.localNormal,
            baseDist: sn.baseDist,
            baseScale: root.scale && root.scale.x ? +Number(root.scale.x).toFixed(4) : a.baseScale
          })
        );
        dbg.push({ text: a.text, ok: true, u: +uv.u.toFixed(4), v: +uv.v.toFixed(4), z: sn.localPos[2], facing: sn.facing });
      }

      const dashMap = Object.create(null);
      for (const dl of uvs.dashUV) dashMap[dl.id] = dl.points;

      const dashedLines = [];
      for (const line of maleDashed) {
        const ptsUV = dashMap[line.id] || [];
        const points = (line.points || []).map((p, i) => {
          const uvRec = ptsUV.find((x) => x.i === i);
          if (!uvRec) return p;
          const sn = snapWithFallback(uvRec.uv.u, uvRec.uv.v);
          if (!sn) return p;
          return Object.assign({}, p, { pos: sn.localPos, norm: sn.localNormal });
        });
        dashedLines.push(Object.assign({}, line, { points }));
      }

      return {
        ok: annotations.length === maleAnnos.length,
        annotations,
        dashedLines,
        dbg
      };
    },
    { maleAnnos, maleDashed, uvs }
  );
}

(async () => {
  console.log('[bald-remap] start', outDir, 'slots', SLOTS.join(','));
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(300000);

  await page.goto(`${baseUrl}/Solid?sandbox=headform&skipPerf=1&_=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 180000
  });
  await page.waitForSelector('#scene-grid-modal', { state: 'visible', timeout: 180000 });

  const summary = [];

  for (const slot of SLOTS) {
    console.log('\n[bald-remap] ===', slot, '===');
    const pair = loadPair(slot);
    if (!pair.male || !pair.target) {
      summary.push({ slot, ok: false, error: 'pair missing', hasMale: !!pair.male, hasTarget: !!pair.target });
      continue;
    }
    const maleAnnos = pair.male.d.items[0].annotations || [];
    const maleDashed = pair.male.d.items[0].dashedLines || [];
    if (!maleAnnos.length) {
      summary.push({ slot, ok: false, error: 'no male annos' });
      continue;
    }

    const cam = pair.male.d.camera;

    await openScene(page, pair.male.d.id);
    await applyCamera(page, cam);
    const uvs = await captureMaleUVs(page, maleAnnos, maleDashed);
    console.log('[bald-remap] male UV sample', uvs.annoUV.slice(0, 3));

    await openScene(page, pair.target.d.id);
    await applyCamera(page, cam);
    const remapped = await snapTargetAtUVs(page, maleAnnos, maleDashed, uvs);
    fs.writeFileSync(path.join(outDir, `${slot}-debug.json`), JSON.stringify(remapped.dbg, null, 2));
    console.log('[bald-remap] dbg', remapped.dbg);

    const miss = remapped.dbg.filter((d) => !d.ok);
    if (miss.length) console.warn('[bald-remap] miss', miss);
    if (!remapped.ok) {
      summary.push({ slot, ok: false, error: 'snap incomplete', dbg: remapped.dbg });
      continue;
    }

    const targetPath = path.join(jsonDir, pair.target.f);
    const targetData = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
    targetData.items[0].annotations = remapped.annotations;
    targetData.items[0].dashedLines = remapped.dashedLines;
    if (pair.male.d.camera) targetData.camera = JSON.parse(JSON.stringify(pair.male.d.camera));
    if (pair.male.d.light) targetData.light = JSON.parse(JSON.stringify(pair.male.d.light));
    if (pair.male.d.env) {
      targetData.env = Object.assign({}, targetData.env || {}, {
        groundColor: pair.male.d.env.groundColor,
        skyColor: pair.male.d.env.skyColor,
        skyLightScale: pair.male.d.env.skyLightScale,
        lightIndicatorEnabled: false
      });
    }
    targetData.meta = Object.assign({}, targetData.meta || {}, {
      modelId: TARGET_ID,
      modelRole: 'contrast',
      modelLabel: TARGET_LABEL,
      status: 'screen_remap_pending_vision'
    });
    fs.writeFileSync(targetPath, JSON.stringify(targetData));
    rebuildAggregate();

    await page.goto(`${baseUrl}/Solid?sandbox=headform&skipPerf=1&_=${Date.now()}`, {
      waitUntil: 'domcontentloaded',
      timeout: 180000
    });
    await page.waitForSelector('#scene-grid-modal', { state: 'visible', timeout: 180000 });
    await openScene(page, pair.target.d.id);
    await page.waitForTimeout(1000);
    const shot = path.join(outDir, `bald-asian-${slot}.png`);
    await page.screenshot({ path: shot, fullPage: false });
    console.log('[bald-remap] SHOT', shot);

    summary.push({
      slot,
      ok: true,
      ann: remapped.annotations.length,
      dash: remapped.dashedLines.length,
      shot
    });
  }

  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  await browser.close();
  console.log('\n[bald-remap] DONE', summary.filter((s) => s.ok).length, '/', summary.length);
  console.log('[bald-remap] outDir', outDir);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
