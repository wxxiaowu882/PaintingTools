/**
 * 女05 标注迁移（屏幕锚点法，修正 AABB 前后脸错乱）
 * 1) 大本场景：标注 localPos → 屏幕 (u,v)
 * 2) 女05 同机位：从 (u,v) 射线贴可见表面
 * 用法：SLOTS=V04,L01 node ... 或 ALL=1
 */
require('./_playwright-browsers-path');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

/** 优先用本机 Edge/Chrome，避免再下载 Playwright 自带 Chromium 占盘（本机 Chrome 通道曾秒退，Edge 可用） */
function launchBrowser() {
  const preferred = process.env.PLAYWRIGHT_CHANNEL || 'msedge';
  const fallbacks = [preferred, 'chrome'].filter((c, i, a) => a.indexOf(c) === i);
  return (async () => {
    let lastErr;
    for (const channel of fallbacks) {
      try {
        const browser = await chromium.launch({ headless: true, channel });
        console.log('[screen-remap] browser channel', channel);
        return browser;
      } catch (err) {
        lastErr = err;
        console.warn('[screen-remap] channel', channel, 'failed:', err.message);
      }
    }
    console.warn('[screen-remap] fallback bundled chromium');
    return chromium.launch({ headless: true });
  })();
}

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-female05-screen-remap`);
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:18080';

const DEFAULT_SLOTS = ['V04', 'V05a', 'V05b', 'V06', 'V07', 'L01', 'L02', 'L03', 'L04', 'L05', 'L06', 'L07', 'L08', 'L09'];
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

function loadPair(slot) {
  let male;
  let female;
  for (const f of listScenes()) {
    const d = JSON.parse(fs.readFileSync(path.join(jsonDir, f), 'utf8'));
    if ((d.meta && d.meta.slot) !== slot) continue;
    const isF = (d.meta && d.meta.modelId) === 'female_05' || f.includes('女05');
    if (isF) female = { f, d };
    else male = { f, d };
  }
  return { male, female };
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

/** 在大本场景采集屏幕 UV */
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

/** 女05：按 UV 射线贴面（只取相机可见首命中） */
async function snapFemaleAtUVs(page, maleAnnos, maleDashed, uvs) {
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
        // 先取主射线；命中且朝向相机则直接用（背面关勿偏好前脸 z）
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
  console.log('[screen-remap] start', outDir, 'slots', SLOTS.join(','));
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
    console.log('\n[screen-remap] ===', slot, '===');
    const pair = loadPair(slot);
    if (!pair.male || !pair.female) {
      summary.push({ slot, ok: false, error: 'pair missing' });
      continue;
    }
    const maleAnnos = pair.male.d.items[0].annotations || [];
    const maleDashed = pair.male.d.items[0].dashedLines || [];
    if (!maleAnnos.length) {
      summary.push({ slot, ok: false, error: 'no male annos' });
      continue;
    }

    const cam = pair.male.d.camera;

    // 1) 大本采 UV
    await openScene(page, pair.male.d.id);
    await applyCamera(page, cam);
    const uvs = await captureMaleUVs(page, maleAnnos, maleDashed);
    console.log('[screen-remap] male UV sample', uvs.annoUV.slice(0, 3));

    // 2) 女05 贴面
    await openScene(page, pair.female.d.id);
    await applyCamera(page, cam);
    const remapped = await snapFemaleAtUVs(page, maleAnnos, maleDashed, uvs);
    fs.writeFileSync(path.join(outDir, `${slot}-debug.json`), JSON.stringify(remapped.dbg, null, 2));
    console.log('[screen-remap] dbg', remapped.dbg);

    const miss = remapped.dbg.filter((d) => !d.ok);
    if (miss.length) {
      console.warn('[screen-remap] miss', miss);
    }
    if (!remapped.ok) {
      summary.push({ slot, ok: false, error: 'snap incomplete', dbg: remapped.dbg });
      continue;
    }

    const femalePath = path.join(jsonDir, pair.female.f);
    const femaleData = JSON.parse(fs.readFileSync(femalePath, 'utf8'));
    femaleData.items[0].annotations = remapped.annotations;
    femaleData.items[0].dashedLines = remapped.dashedLines;
    if (pair.male.d.camera) femaleData.camera = JSON.parse(JSON.stringify(pair.male.d.camera));
    if (pair.male.d.light) femaleData.light = JSON.parse(JSON.stringify(pair.male.d.light));
    if (pair.male.d.env) {
      femaleData.env = Object.assign({}, femaleData.env || {}, {
        groundColor: pair.male.d.env.groundColor,
        skyColor: pair.male.d.env.skyColor,
        skyLightScale: pair.male.d.env.skyLightScale,
        lightIndicatorEnabled: false
      });
    }
    femaleData.meta.status = 'screen_remap_pending_vision';
    fs.writeFileSync(femalePath, JSON.stringify(femaleData));
    rebuildAggregate();

    // 3) 重载截图
    await page.goto(`${baseUrl}/Solid?sandbox=headform&skipPerf=1&_=${Date.now()}`, {
      waitUntil: 'domcontentloaded',
      timeout: 180000
    });
    await page.waitForSelector('#scene-grid-modal', { state: 'visible', timeout: 180000 });
    await openScene(page, pair.female.d.id);
    await page.waitForTimeout(1000);
    const shot = path.join(outDir, `female05-${slot}.png`);
    await page.screenshot({ path: shot, fullPage: false });
    console.log('[screen-remap] SHOT', shot);

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
  console.log('\n[screen-remap] DONE', summary.filter((s) => s.ok).length, '/', summary.length);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
