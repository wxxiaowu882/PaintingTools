/**
 * 光头亚裔 V 槽：外轮廓左缘吸附（修正宽头屏 UV 打到前脸）
 * 保留原标注屏幕 v，向左扫到剪影；写回 JSON + 截图
 * 用法：SLOTS=V01,V02 node ... 或 ALL=1
 */
require('./_playwright-browsers-path');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-bald-asian-edge-snap`);
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:18080';
const TARGET_ID = 'male_bald_asian_01';
fs.mkdirSync(outDir, { recursive: true });

const DEFAULT_SLOTS = ['V01', 'V02', 'V03', 'V04', 'V05a', 'V05b', 'V06', 'V07'];
const SLOTS = process.env.ALL === '1'
  ? DEFAULT_SLOTS
  : (process.env.SLOTS || DEFAULT_SLOTS.join(','))
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

const RE = /^(\d+[A-Za-z]?)_(.+)\.json$/i;

function listScenes() {
  return fs.readdirSync(jsonDir).filter((n) => RE.test(n));
}

function isTarget(f, d) {
  if ((d.meta && d.meta.modelId) === TARGET_ID) return true;
  if (f.includes('光头亚裔')) return true;
  return /光头亚裔|真人头像_男_光头/i.test(String((((d.items || [])[0] || {}).url) || ''));
}

function isFemale(f, d) {
  if ((d.meta && d.meta.modelId) === 'female_05') return true;
  if (f.includes('女05')) return true;
  return /女中青年_05|女05/i.test(String((((d.items || [])[0] || {}).url) || ''));
}

function isReference(f, d) {
  if (isTarget(f, d) || isFemale(f, d)) return false;
  if (d.meta && d.meta.modelRole === 'reference') return true;
  return /大本|蝙蝠侠|布鲁斯/i.test(String((((d.items || [])[0] || {}).url) || ''));
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

function launchBrowser() {
  const preferred = process.env.PLAYWRIGHT_CHANNEL || 'msedge';
  const fallbacks = [preferred, 'chrome'].filter((c, i, a) => a.indexOf(c) === i);
  return (async () => {
    for (const channel of fallbacks) {
      try {
        const browser = await chromium.launch({ headless: true, channel });
        console.log('[edge] browser', channel);
        return browser;
      } catch (_e) {}
    }
    return chromium.launch({ headless: true });
  })();
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

(async () => {
  console.log('[edge] start', outDir, SLOTS.join(','));
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(300000);
  await page.goto(`${baseUrl}/Solid?sandbox=headform&skipPerf=1&_=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 180000
  });
  await page.waitForSelector('#scene-grid-modal', { state: 'visible', timeout: 180000 });

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

async function captureMaleUVs(page, annos) {
  return page.evaluate((annos) => {
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
      const w = new THREE.Vector3((a.localPos || [0, 0, 0])[0], (a.localPos || [0, 0, 0])[1], (a.localPos || [0, 0, 0])[2]);
      root.localToWorld(w);
      const sp = w.clone().project(cam);
      return {
        id: a.id,
        text: a.text,
        u: (sp.x + 1) / 2,
        v: (1 - sp.y) / 2
      };
    });
  }, annos);
}

  const summary = [];

  for (const slot of SLOTS) {
    console.log('\n[edge] ===', slot, '===');
    const pair = loadPair(slot);
    if (!pair.male || !pair.target) {
      summary.push({ slot, ok: false, error: 'pair missing' });
      continue;
    }
    const maleAnnos = (pair.male.d.items[0] && pair.male.d.items[0].annotations) || [];
    const tgtAnnos = (pair.target.d.items[0] && pair.target.d.items[0].annotations) || [];
    if (!maleAnnos.length) {
      summary.push({ slot, ok: false, error: 'no male annos' });
      continue;
    }
    // 用大本当前标注作模板（含 dx/dy 等），点位以后面吸附为准
    const templateAnnos = tgtAnnos.length === maleAnnos.length ? tgtAnnos : maleAnnos;
    const cam = pair.male.d.camera;
    const mode = slot === 'V07' ? 'radial' : 'left';

    // 1) 大本：采屏幕 UV（高度以大本为准）
    await openId(page, pair.male.d.id);
    await applyCamera(page, cam);
    const maleUVs = await captureMaleUVs(page, maleAnnos);
    console.log('[edge] male UV sample', maleUVs.slice(0, 3));

    // 2) 光头亚裔：按大本 v（及径向用大本 u,v）贴左缘/外缘
    await openId(page, pair.target.d.id);
    await applyCamera(page, cam);

    const snapped = await page.evaluate(
      ({ annos, maleUVs, mode, slot }) => {
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

        function hitAt(u, v) {
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

        // 世界包围盒：排除底座/肩膀（宽肩在颏高处比头更靠左）
        const boxW = new THREE.Box3().setFromObject(root);
        const sizeYW = boxW.max.y - boxW.min.y;
        const shoulderCutW = boxW.min.y + sizeYW * 0.12;

        function leftEdge(v, opts) {
          const ignoreEar = !!(opts && opts.ignoreEar);
          const minYW = opts && typeof opts.minYW === 'number' ? opts.minYW : shoulderCutW;
          const preferFaceZ = !!(opts && opts.preferFaceZ);
          const cands = [];
          for (let u = 0.08; u <= 0.62; u += 0.0025) {
            const hit = hitAt(u, v);
            if (!hit) continue;
            if (hit.point.y < minYW) continue;
            const lp = toLocal(hit);
            if (preferFaceZ && lp.z < -0.005) continue;
            cands.push({ u, hit, ...lp });
          }
          if (!cands.length) return null;
          let pick = cands[0];
          if (ignoreEar) {
            const face = cands.filter((c) => c.z >= 0.015);
            if (
              face.length &&
              face[0].u - cands[0].u >= 0.008 &&
              cands[0].z < face[0].z - 0.01
            ) {
              pick = face[0];
            }
          }
          let lo = Math.max(0.05, pick.u - 0.025);
          let hi = pick.u;
          let best = pick;
          for (let i = 0; i < 16; i++) {
            const mid = (lo + hi) / 2;
            const hit = hitAt(mid, v);
            if (!hit) {
              lo = mid;
              continue;
            }
            if (hit.point.y < minYW) {
              lo = mid;
              continue;
            }
            const lp = toLocal(hit);
            if (preferFaceZ && lp.z < -0.005) {
              lo = mid;
              continue;
            }
            if (ignoreEar && lp.z < 0.012 && best.z >= 0.015) {
              lo = mid;
              continue;
            }
            best = { u: mid, hit, ...lp };
            hi = mid;
          }
          return best;
        }

        /** 颏底 / 颏结节：在面部下半区找头底，排除宽肩 */
        function chinBottom(u0, v0, opts) {
          const wantLeft = !!(opts && opts.wantLeft);
          let best = null;
          for (let dv = -0.04; dv <= 0.16; dv += 0.003) {
            for (let du = -0.08; du <= 0.08; du += 0.006) {
              const u = u0 + du;
              const v = Math.min(0.92, Math.max(0.35, v0 + dv));
              if (u < 0.25 || u > 0.75) continue;
              const hit = hitAt(u, v);
              if (!hit) continue;
              if (hit.point.y < boxW.min.y + sizeYW * 0.08) continue;
              const lp = toLocal(hit);
              // 只要头前/颏附近：过宽的肩 |x| 大且 z 偏后
              if (Math.abs(lp.x) > 0.11 && lp.z < 0.01) continue;
              if (lp.z < -0.04) continue;
              if (wantLeft && lp.x > -0.005) continue;
              const score = -hit.point.y + (wantLeft ? -lp.x * 0.15 : -Math.abs(lp.x) * 0.05);
              if (!best || score > best.score) {
                best = { u, v, hit, score, ...lp };
              }
            }
          }
          return best;
        }

        function radialEdge(u0, v0) {
          const cx = 0.5;
          const cy = 0.48;
          const ang = Math.atan2(v0 - cy, u0 - cx);
          let best = null;
          for (let r = 0.02; r < 0.45; r += 0.004) {
            const u = cx + Math.cos(ang) * r;
            const v = cy + Math.sin(ang) * r;
            if (u < 0.02 || u > 0.98 || v < 0.02 || v > 0.98) break;
            const hit = hitAt(u, v);
            if (!hit) {
              if (best) {
                const uu = cx + Math.cos(ang) * (r - 0.002);
                const vv = cy + Math.sin(ang) * (r - 0.002);
                const h2 = hitAt(uu, vv);
                if (h2) return { u: uu, v: vv, hit: h2, ...toLocal(h2) };
              }
              break;
            }
            best = { u, v, hit, ...toLocal(hit) };
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
          const localNormal = root
            .worldToLocal(world.clone().add(nWorld))
            .sub(localPos.clone())
            .normalize();
          return Object.assign({}, prev, {
            localPos: [+localPos.x.toFixed(4), +localPos.y.toFixed(4), +localPos.z.toFixed(4)],
            localNormal: [+localNormal.x.toFixed(3), +localNormal.y.toFixed(3), +localNormal.z.toFixed(3)],
            baseDist: +hit.distance.toFixed(4),
            baseScale: root.scale && root.scale.x ? +Number(root.scale.x).toFixed(4) : prev.baseScale
          });
        }

        const uvById = Object.create(null);
        const uvByText = Object.create(null);
        for (const x of maleUVs) {
          uvById[x.id] = x;
          uvByText[x.text] = x;
        }

        const out = [];
        const debug = [];
        for (const a of annos) {
          const muv = uvById[a.id] || uvByText[a.text];
          if (!muv) {
            out.push(a);
            debug.push({ text: a.text, ok: false, reason: 'no male uv' });
            continue;
          }
          let v = muv.v;
          let u = muv.u;
          if (slot === 'V02' && (a.text === '5' || a.text === '6')) v = Math.min(0.9, muv.v + 0.012);
          if (slot === 'V01' && a.text === '5') v = Math.min(0.88, muv.v + 0.008);

          const ignoreEar = a.text === '3' && (slot === 'V02' || slot === 'V01' || slot === 'V07');
          let edge = null;
          if (mode === 'radial') {
            edge = radialEdge(u, v);
          } else if (slot === 'V02' && a.text === '6') {
            edge = chinBottom(u, v, { wantLeft: false });
          } else if (slot === 'V02' && a.text === '5') {
            edge = chinBottom(u, v, { wantLeft: true });
          } else if (slot === 'V02' && a.text === 'A') {
            edge = leftEdge(v, { ignoreEar, preferFaceZ: true, minYW: boxW.min.y + sizeYW * 0.18 });
            if (!edge) edge = chinBottom(u, v, { wantLeft: true });
          } else if (slot === 'V02' && a.text === '4') {
            edge = leftEdge(v, { ignoreEar, preferFaceZ: true, minYW: boxW.min.y + sizeYW * 0.25 });
          } else {
            edge = leftEdge(v, { ignoreEar });
          }
          if (!edge || !edge.hit) {
            out.push(a);
            debug.push({ text: a.text, ok: false, reason: 'no edge', maleV: v });
            continue;
          }
          out.push(toAnnoFields(edge.hit, a));
          const after = projectAnno(out[out.length - 1].localPos);
          debug.push({
            text: a.text,
            ok: true,
            maleU: +muv.u.toFixed(4),
            maleV: +muv.v.toFixed(4),
            afterU: +after.u.toFixed(4),
            afterV: +after.v.toFixed(4),
            z: +edge.z.toFixed(4)
          });
        }
        return { annotations: out, debug };
      },
      { annos: templateAnnos, maleUVs, mode, slot }
    );

    fs.writeFileSync(path.join(outDir, `${slot}-edge-debug.json`), JSON.stringify(snapped.debug, null, 2));
    console.log('[edge] dbg', snapped.debug);

    const miss = snapped.debug.filter((d) => !d.ok);
    const dataPath = path.join(jsonDir, pair.target.f);
    const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    data.items[0].annotations = snapped.annotations;
    data.meta.status = 'edge_snap_pending_vision';
    fs.writeFileSync(dataPath, JSON.stringify(data));
    rebuildAggregate();

    await page.goto(`${baseUrl}/Solid?sandbox=headform&skipPerf=1&_=${Date.now()}`, {
      waitUntil: 'domcontentloaded',
      timeout: 180000
    });
    await page.waitForSelector('#scene-grid-modal', { state: 'visible', timeout: 180000 });
    await openId(page, pair.target.d.id);
    await page.waitForTimeout(1000);
    const shot = path.join(outDir, `bald-edge-${slot}.png`);
    await page.screenshot({ path: shot, fullPage: false });
    console.log('[edge] SHOT', shot);

    summary.push({ slot, ok: miss.length === 0, miss: miss.length, shot });
  }

  fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
  await browser.close();
  console.log('[edge] DONE', summary.filter((s) => s.ok).length, '/', summary.length, outDir);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
