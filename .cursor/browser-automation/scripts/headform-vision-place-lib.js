/**
 * Headform 视觉定点核心库（非 UV 迁模）
 * - 语义卡来自大本 keyPoints + 知识库口径
 * - 候选来自「新模画面」头廓采样（禁耳禁肩）
 * - 落面用 Raycaster；验收必须另截图 + AI 读图
 */
require('./_playwright-browsers-path');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const cards = require('./headform-vision-cards');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const RE = /^(\d+[A-Za-z]?)_(.+)\.json$/i;

const V02_CARDS = cards.V02_CARDS;

function launchBrowser() {
  const preferred = process.env.PLAYWRIGHT_CHANNEL || 'msedge';
  return (async () => {
    try {
      return await chromium.launch({ headless: true, channel: preferred });
    } catch (_e) {
      try {
        return await chromium.launch({ headless: true, channel: 'chrome' });
      } catch (_e2) {
        return chromium.launch({ headless: true });
      }
    }
  })();
}

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

function findScene(slot, modelId) {
  const want = cards.normalizeSlot(slot);
  const midWant = modelId || process.env.MODEL_ID || 'male_bald_asian_01';
  for (const f of fs.readdirSync(jsonDir).filter((n) => RE.test(n))) {
    const d = JSON.parse(fs.readFileSync(path.join(jsonDir, f), 'utf8'));
    const got = cards.normalizeSlot((d.meta && d.meta.slot) || '');
    if (got !== want) continue;
    const mid = (d.meta && d.meta.modelId) || '';
    const url = String((((d.items || [])[0] || {}).url) || '');
    if (midWant === 'reference') {
      if (d.meta && d.meta.modelRole === 'reference') return { f, d };
      if (
        /大本|蝙蝠侠/.test(url) &&
        !f.includes('女05') &&
        !f.includes('光头') &&
        !f.includes('叶问')
      ) {
        return { f, d };
      }
      continue;
    }
    if (midWant === 'male_bald_asian_01') {
      if (mid === midWant || f.includes('光头亚裔') || /光头亚裔|真人头像_男_光头/.test(url)) {
        return { f, d };
      }
      continue;
    }
    if (midWant === 'male_ipman_01') {
      if (mid === midWant || f.includes('叶问') || /IpMan2V|叶问/.test(url)) {
        return { f, d };
      }
      continue;
    }
    if (mid === midWant) return { f, d };
  }
  return null;
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

async function setAnnosVisible(page, on) {
  await page.evaluate((want) => {
    const cur = !!window.showAnnotations;
    if (cur !== !!want && typeof window.toggleAnnotations === 'function') window.toggleAnnotations();
    const disp = want ? '' : 'none';
    ['annotation-layer', 'dashed-line-layer', 'dashed-line-svg'].forEach((id) => {
      const n = document.getElementById(id);
      if (n) n.style.display = disp;
    });
    window.showAnnotations = !!want;
  }, on);
  await page.waitForTimeout(200);
}

/** 在新模上采头廓候选（语义 band，不抄大本 UV） */
async function proposeCandidates(page, landmark, slot) {
  const card = cards.getCard(slot || 'V02', landmark) || V02_CARDS[landmark];
  if (!card) throw new Error('no card ' + (slot || 'V02') + '/' + landmark);
  return page.evaluate((card) => {
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
    const shoulderY = boxW.min.y + sizeYW * 0.22;
    const chinMinY = boxW.min.y + sizeYW * 0.26;

    function hitAt(u, v) {
      raycaster.setFromCamera(new THREE.Vector2(u * 2 - 1, -(v * 2 - 1)), cam);
      return raycaster.intersectObjects(meshes, true)[0] || null;
    }
    function lp(hit) {
      return root.worldToLocal(hit.point.clone());
    }

    // 额高测头左缘，肩更左则剔除
    let browL = 0.42;
    for (let u = 0.12; u < 0.55; u += 0.002) {
      const h = hitAt(u, 0.28);
      if (!h || h.point.y < shoulderY) continue;
      const p = lp(h);
      if (p.z < -0.02) continue;
      browL = u;
      break;
    }
    const uFloor = browL - 0.02;

    function headLeftAtV(v, opts) {
      const ignoreEar = !!(opts && opts.ignoreEar);
      const jawFace = !!(opts && opts.jawFace);
      const preferFaceZ = !!(opts && opts.preferFaceZ);
      const allowBack = !!(opts && opts.allowBack);
      const requireBack = !!(opts && opts.requireBack);
      const zMin = allowBack ? -0.085 : preferFaceZ || ignoreEar ? -0.005 : -0.03;
      const yMin = jawFace ? boxW.min.y + sizeYW * 0.34 : shoulderY;
      const cands = [];
      // jawFace：咬肌前切迹等在颊侧，勿从过左肩扫起；背侧光时 z 阈值放宽
      const uStart = jawFace ? Math.max(0.28, uFloor - 0.06) : Math.max(0.08, uFloor - 0.04);
      const uEnd = jawFace ? 0.56 : 0.58;
      for (let u = uStart; u <= uEnd; u += 0.002) {
        const h = hitAt(u, v);
        if (!h || h.point.y < yMin) continue;
        const p = lp(h);
        if (requireBack && p.z > -0.025) continue;
        if (opts && typeof opts.maxZ === 'number' && p.z > opts.maxZ) continue;
        if (opts && typeof opts.maxX === 'number' && p.x > opts.maxX) continue;
        if (jawFace) {
          // 背侧/正侧光时颊剪影 localZ 常近 0；仍禁颈侧过低/过后
          if (p.z < -0.02) continue;
          if (p.x > 0.005) continue;
          if (p.y < boxW.min.y + sizeYW * 0.36) continue;
        } else if (p.z < zMin) {
          continue;
        }
        if (ignoreEar && p.z < 0.012) continue;
        if (preferFaceZ && p.z < 0.01) continue;
        if (opts && typeof opts.minZ === 'number' && p.z < opts.minZ) continue;
        cands.push({ u, v, hit: h, x: p.x, y: p.y, z: p.z });
        if (jawFace) break;
      }
      if (!cands.length) return null;
      if (jawFace) return cands[0];

      // 勿钉耳：只要扫到前脸点，一律取前脸第一条左缘（宽头耳壳常更左，不能靠 u 差判断）
      let pick = cands[0];
      if (ignoreEar || preferFaceZ) {
        const face = cands.filter((c) => c.z >= 0.015);
        if (face.length) pick = face[0];
      }

      let lo = Math.max(0.05, pick.u - 0.025);
      let hi = pick.u;
      let best = pick;
      const zFloor =
        opts && typeof opts.minZ === 'number'
          ? opts.minZ
          : ignoreEar || preferFaceZ
            ? 0.012
            : zMin;
      for (let i = 0; i < 14; i++) {
        const mid = (lo + hi) / 2;
        const h = hitAt(mid, v);
        if (!h || h.point.y < yMin) {
          lo = mid;
          continue;
        }
        const p = lp(h);
        if (p.z < zFloor) {
          lo = mid;
          continue;
        }
        if (opts && typeof opts.maxZ === 'number' && p.z > opts.maxZ) {
          lo = mid;
          continue;
        }
        best = { u: mid, v, hit: h, x: p.x, y: p.y, z: p.z };
        hi = mid;
      }
      return best;
    }

    /** 颅顶：近中线扫最高点（非左缘） */
    function apexHighest() {
      const pool = [];
      const uLo = typeof band.u0 === 'number' ? band.u0 : 0.44;
      const uHi = typeof band.u1 === 'number' ? band.u1 : 0.56;
      const maxAbsX = typeof band.maxAbsX === 'number' ? band.maxAbsX : 0.08;
      for (let v = band.v0; v <= band.v1; v += 0.006) {
        for (let u = uLo; u <= uHi; u += 0.004) {
          const h = hitAt(u, v);
          if (!h || h.point.y < shoulderY) continue;
          const p = lp(h);
          if (Math.abs(p.x) > maxAbsX) continue;
          if (p.z < -0.08) continue;
          pool.push({ u, v, hit: h, x: p.x, y: p.y, z: p.z, _s: p.y });
        }
      }
      pool.sort((a, b) => b._s - a._s);
      return pool.slice(0, 12);
    }

    const band = card.band;
    let out = [];
    const step = 0.01;

    if (band.side === 'apexHighest') {
      out = apexHighest();
    } else if (band.side === 'farCheekInset') {
      // 鼻抢左缘时：在屏中左颊带密扫（不贴最左缘）
      const chinY = boxW.min.y + sizeYW * 0.36;
      for (let v = band.v0; v <= band.v1; v += step) {
        let best = null;
        for (let u = 0.35; u <= 0.58; u += 0.004) {
          const h = hitAt(u, v);
          if (!h || h.point.y < chinY) continue;
          const p = lp(h);
          if (p.x > -0.015 || p.x < -0.08) continue;
          if (p.z < 0.012 || p.z > 0.07) continue;
          if (p.z > 0.055 && p.x > -0.035) continue; // 鼻翼
          if (p.y < boxW.min.y + sizeYW * 0.34) continue;
          const score = -p.x * 2.4 + (0.045 - Math.abs(p.z - 0.045)) * 1.2;
          if (!best || score > best._s) {
            best = { u, v, hit: h, x: p.x, y: p.y, z: p.z, _s: score };
          }
        }
        if (best) out.push(best);
      }
    } else if (band.side === 'farCheek') {
      // 四分之三远端颊：屏左扫，丢掉鼻尖，取颊区最负 x
      // 下半脸（颊凹/口轮）更靠前、略偏中，鼻翼闸必须比上半脸松，否则候选全空
      const chinY = boxW.min.y + sizeYW * (band.v0 >= 0.42 ? 0.32 : 0.30);
      for (let v = band.v0; v <= band.v1; v += step) {
        let best = null;
        for (let u = 0.08; u <= 0.55; u += 0.003) {
          const h = hitAt(u, v);
          if (!h || h.point.y < chinY) continue;
          const p = lp(h);
          const lower = v >= 0.38;
          if (p.x > (lower ? -0.022 : -0.03)) continue;
          const zHi = v < 0.3 ? 0.07 : v < 0.38 ? 0.058 : 0.068;
          const zLo = v < 0.3 ? -0.01 : v < 0.38 ? -0.005 : -0.012;
          if (p.z < zLo || p.z > zHi) continue;
          // 鼻翼：上半脸严；下半脸只剔「又前又中」的鼻翼/口角
          if (!lower && p.z > 0.048 && p.x > -0.045) continue;
          if (lower && p.z > 0.058 && p.x > -0.032) continue;
          if (v >= 0.42 && p.y < boxW.min.y + sizeYW * 0.36) continue;
          const zTarget = v < 0.38 ? 0.03 : 0.042;
          const score = -p.x * 3.2 + (0.028 - Math.abs(p.z - zTarget)) * 0.8;
          if (!best || score > best._s) {
            best = { u, v, hit: h, x: p.x, y: p.y, z: p.z, _s: score };
          }
        }
        if (best) out.push(best);
      }
    } else if (band.side === 'silLeft' || band.side === 'silRight') {
      const fromRight = band.side === 'silRight';
      for (let v = band.v0; v <= band.v1; v += step) {
        let best = null;
        const u0 = fromRight ? 0.88 : 0.08;
        const u1 = fromRight ? 0.42 : 0.58;
        const du = fromRight ? -0.002 : 0.002;
        for (let u = u0; fromRight ? u >= u1 : u <= u1; u += du) {
          const h = hitAt(u, v);
          if (!h || h.point.y < shoulderY * 0.95) continue;
          const p = lp(h);
          if (band.requireBack && p.z > -0.025) continue;
          if (band.preferFront && p.z < 0.02) continue;
          if (!band.allowBack && !band.requireBack && p.z < -0.05) continue;
          if (band.preferFaceZ && p.z < 0.0) continue;
          if (band.ignoreEar && p.z < 0.012) continue;
          if (typeof band.minZ === 'number' && p.z < band.minZ) continue;
          if (typeof band.maxZ === 'number' && p.z > band.maxZ) continue;
          // preferFront：本行取最高 z（鼻头），勿停在颊侧最左缘
          let _s;
          if (band.preferFront) _s = p.z * 5 - Math.abs(p.x) * 0.4;
          else if (band.requireBack) _s = -p.z * 3 + (fromRight ? p.x : -p.x);
          else _s = fromRight ? p.x : -p.x;
          const cand = { u, v, hit: h, x: p.x, y: p.y, z: p.z, _s };
          if (!best || cand._s > best._s) best = cand;
          // 非 preferFront 时仍取首个剪影缘即可
          if (!band.preferFront && !band.requireBack) break;
        }
        if (best) out.push(best);
      }
    } else if (band.side === 'topFront' || band.side === 'topBack' || band.side === 'topWidest') {
      const pool = [];
      for (let v = band.v0; v <= band.v1; v += 0.008) {
        for (let u = 0.25; u <= 0.75; u += 0.006) {
          const h = hitAt(u, v);
          if (!h) continue;
          const p = lp(h);
          pool.push({ u, v, hit: h, x: p.x, y: p.y, z: p.z });
        }
      }
      if (band.side === 'topFront') {
        pool.sort((a, b) => b.z - a.z);
        out = pool.slice(0, 16);
        out.forEach((c) => (c._s = c.z));
      } else if (band.side === 'topBack') {
        pool.sort((a, b) => a.z - b.z);
        out = pool.slice(0, 16);
        out.forEach((c) => (c._s = -c.z));
      } else {
        // topWidest：左半最负 x；zone front 偏好更大 z
        const left = pool.filter((c) => c.x < -0.01);
        left.sort((a, b) => {
          if (band.zone === 'front') return b.z - a.z || a.x - b.x;
          if (band.zone === 'back') return a.z - b.z || a.x - b.x;
          return a.x - b.x;
        });
        out = left.slice(0, 16);
        out.forEach((c) => (c._s = -c.x + (band.zone === 'front' ? c.z : -c.z) * 0.3));
      }
    } else {
      for (let v = band.v0; v <= band.v1; v += step) {
        if (band.side === 'chinC') {
          // 颏底：高 z 前突 + 偏低 localY（口下颏缘），禁止误落到唇/喉
          let best = null;
          for (let u = 0.46; u <= 0.54; u += 0.004) {
            const h = hitAt(u, v);
            if (!h) continue;
            const p = lp(h);
            if (p.z < 0.05) continue;
            if (Math.abs(p.x) > 0.035) continue;
            if (h.point.y < boxW.min.y + sizeYW * 0.28) continue;
            if (p.y > 0.11) continue; // 拒唇区
            // 前突优先，其次更低（颏底）
            const score = p.z * 5 - p.y * 3;
            if (!best || score > best._s) best = { u, v, hit: h, x: p.x, y: p.y, z: p.z, _s: score };
          }
          if (best) out.push(best);
        } else if (band.side === 'chinL') {
          let best = null;
          for (let u = 0.38; u <= 0.5; u += 0.004) {
            const h = hitAt(u, v);
            if (!h) continue;
            const p = lp(h);
            if (p.z < 0.045) continue;
            if (p.x > -0.005 || p.x < -0.06) continue;
            if (h.point.y < boxW.min.y + sizeYW * 0.28) continue;
            if (p.y > 0.115) continue; // 拒口角高度
            const score = p.z * 2 - p.x - p.y * 2.5;
            if (!best || score > best._s) {
              best = { u, v, hit: h, x: p.x, y: p.y, z: p.z, _s: score };
            }
          }
          if (best) out.push(best);
        } else {
          const e = headLeftAtV(v, {
            ignoreEar: !!band.ignoreEar,
            jawFace: !!band.jawFace,
            preferFaceZ: !!band.preferFaceZ,
            allowBack: !!band.allowBack,
            requireBack: !!band.requireBack,
            maxZ: band.maxZ,
            maxX: band.maxX,
            minZ: band.minZ
          });
          if (e) {
            // 语义分：最宽 / 前脸 / 耳后
            let _s = -e.x;
            if (band.preferWidest) _s = -e.x * 2 - e.z; // 宽且偏后
            if (band.requireBack) _s = -e.z * 3 - e.x; // 耳后/颅后优先
            if (band.preferFaceZ || band.ignoreEar) _s = -e.x + e.z * 1.5;
            e._s = _s;
            out.push(e);
          }
        }
      }
    }

    // 按语义分排序后取最多 8 个（不再均匀稀疏，避免丢掉最宽/最高）
    out.sort((a, b) => (b._s || 0) - (a._s || 0));
    // 去重：屏距过近只留分高者
    const dedup = [];
    for (const c of out) {
      if (dedup.some((d) => Math.hypot(d.u - c.u, d.v - c.v) < 0.012)) continue;
      dedup.push(c);
      if (dedup.length >= 8) break;
    }

    let picked = dedup.map((c, idx) => ({
      i: idx + 1,
      u: +c.u.toFixed(4),
      v: +c.v.toFixed(4),
      z: +c.z.toFixed(4),
      x: +c.x.toFixed(4),
      y: +(c.y != null ? c.y : 0).toFixed(4),
      score: +(c._s || 0).toFixed(4),
      recommend: idx === 0
    }));

    // jawFace 空候选兜底：颊侧密扫（侧光允许 z≈0；禁颈区）
    if (!picked.length && band.jawFace && (band.side === 'left' || !band.side || band.side === 'silLeft')) {
      const fb = [];
      const yFloor = boxW.min.y + sizeYW * 0.36;
      for (let v = Math.max(0.4, band.v0 - 0.02); v <= Math.min(0.56, band.v1 + 0.02); v += 0.008) {
        for (let u = 0.28; u <= 0.56; u += 0.005) {
          const h = hitAt(u, v);
          if (!h || h.point.y < yFloor) continue;
          const p = lp(h);
          if (p.z < -0.025 || p.x > 0.01 || p.y < yFloor) continue;
          fb.push({ u, v, hit: h, x: p.x, y: p.y, z: p.z, _s: -p.x * 2 + p.z + p.y });
        }
      }
      fb.sort((a, b) => b._s - a._s);
      picked = [];
      for (let i = 0; i < fb.length && picked.length < 8; i++) {
        const c = fb[i];
        if (picked.some((d) => Math.hypot(d.u - c.u, d.v - c.v) < 0.012)) continue;
        picked.push({
          i: picked.length + 1,
          u: +c.u.toFixed(4),
          v: +c.v.toFixed(4),
          z: +c.z.toFixed(4),
          x: +c.x.toFixed(4),
          y: +c.y.toFixed(4),
          score: +c._s.toFixed(4),
          recommend: picked.length === 0
        });
      }
    }

    // 颏区兜底：band 空时在颏屏区密扫前突面（高 z，禁喉）
    if (!picked.length && (band.side === 'chinC' || band.side === 'chinL')) {
      const fb = [];
      for (let v = 0.48; v <= 0.58; v += 0.01) {
        const u0 = band.side === 'chinC' ? 0.46 : 0.4;
        const u1 = band.side === 'chinC' ? 0.54 : 0.5;
        for (let u = u0; u <= u1; u += 0.008) {
          const h = hitAt(u, v);
          if (!h) continue;
          const p = lp(h);
          if (p.z < 0.04) continue;
          if (band.side === 'chinC' && Math.abs(p.x) > 0.035) continue;
          if (band.side === 'chinL' && (p.x > -0.005 || p.x < -0.065)) continue;
          fb.push({ u, v, hit: h, x: p.x, y: p.y, z: p.z, _s: p.z * 5 + p.y });
        }
      }
      fb.sort((a, b) => b._s - a._s);
      picked = [];
      for (let i = 0; i < fb.length && picked.length < 8; i++) {
        const c = fb[i];
        if (picked.some((d) => Math.hypot(d.u - c.u, d.v - c.v) < 0.012)) continue;
        picked.push({
          i: picked.length + 1,
          u: +c.u.toFixed(4),
          v: +c.v.toFixed(4),
          z: +c.z.toFixed(4),
          x: +c.x.toFixed(4),
          y: +c.y.toFixed(4),
          score: +c._s.toFixed(4),
          recommend: picked.length === 0
        });
      }
    }

    return {
      browL: +browL.toFixed(4),
      uFloor: +uFloor.toFixed(4),
      candidates: picked,
      cardName: card.name,
      pickHint: card.pickHint || '',
      recommended: picked.find((c) => c.recommend) || null
    };
  }, card);
}

/** 叠加候选编号十字（DOM overlay，不改 JSON） */
async function overlayCandidates(page, candidates) {
  await page.evaluate((cands) => {
    let layer = document.getElementById('vision-place-overlay');
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'vision-place-overlay';
      layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:99999;';
      document.body.appendChild(layer);
    }
    layer.innerHTML = '';
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (const c of cands) {
      const x = c.u * w;
      const y = c.v * h;
      const el = document.createElement('div');
      const rec = !!c.recommend;
      el.style.cssText = `position:absolute;left:${x - 14}px;top:${y - 14}px;width:28px;height:28px;border-radius:50%;background:${rec ? '#0f0' : '#ff0'};border:2px solid #000;color:#000;font:bold 11px/28px sans-serif;text-align:center;box-shadow:${rec ? '0 0 0 3px #0f0' : 'none'};`;
      el.textContent = String(c.i);
      layer.appendChild(el);
    }
  }, candidates);
}

async function clearOverlay(page) {
  await page.evaluate(() => {
    const layer = document.getElementById('vision-place-overlay');
    if (layer) layer.remove();
  });
}

async function rayPlace(page, u, v) {
  return page.evaluate(
    ({ u, v }) => {
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
      raycaster.setFromCamera(new THREE.Vector2(u * 2 - 1, -(v * 2 - 1)), cam);
      const hits = raycaster.intersectObjects(meshes, true);
      if (!hits.length) return { ok: false, reason: 'no hit' };
      const hit = hits[0];
      const localPos = root.worldToLocal(hit.point.clone());
      let nWorld = new THREE.Vector3(0, 0, 1);
      if (hit.face && hit.face.normal) {
        nWorld = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
      }
      const toCam = cam.position.clone().sub(hit.point).normalize();
      const facing = nWorld.dot(toCam);
      if (facing < -0.05) nWorld.multiplyScalar(-1);
      const localNormal = root.worldToLocal(hit.point.clone().add(nWorld)).sub(localPos.clone()).normalize();
      return {
        ok: true,
        localPos: [+localPos.x.toFixed(4), +localPos.y.toFixed(4), +localPos.z.toFixed(4)],
        localNormal: [+localNormal.x.toFixed(3), +localNormal.y.toFixed(3), +localNormal.z.toFixed(3)],
        baseDist: +hit.distance.toFixed(4),
        baseScale: +Number(root.scale.x).toFixed(4),
        facing: +facing.toFixed(3)
      };
    },
    { u, v }
  );
}

/** 同模邻点语义插值再贴面（侧光剪影扫不到颊切迹时用） */
async function placeBetweenNeighbors(page, localA, localB, opts) {
  const bias = (opts && opts.bias) != null ? opts.bias : 0.5;
  const zNudge = (opts && opts.zNudge) != null ? opts.zNudge : 0.01;
  const xNudge = (opts && opts.xNudge) != null ? opts.xNudge : 0;
  const yNudge = (opts && opts.yNudge) != null ? opts.yNudge : 0;
  const preferFar = !!(opts && opts.preferFar);
  const preferFront = !!(opts && opts.preferFront);
  return page.evaluate(
    ({ localA, localB, bias, zNudge, xNudge, yNudge, preferFar, preferFront }) => {
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
      const mid = new THREE.Vector3(
        localA[0] + (localB[0] - localA[0]) * bias + xNudge,
        localA[1] + (localB[1] - localA[1]) * bias + yNudge,
        localA[2] + (localB[2] - localA[2]) * bias + zNudge
      );
      const world = root.localToWorld(mid.clone());
      const ndc = world.clone().project(cam);
      const trials = [];
      const u0 = (ndc.x + 1) / 2;
      const v0 = (1 - ndc.y) / 2;
      for (const [du, dv] of [
        [0, 0],
        [-0.02, 0],
        [-0.03, 0],
        [-0.04, 0],
        [-0.05, 0],
        [-0.06, 0],
        [-0.07, 0.01],
        [-0.08, 0],
        [-0.05, 0.01],
        [-0.055, -0.01],
        [-0.035, -0.01],
        [-0.015, 0.01],
        [-0.015, -0.01],
        [0.01, 0],
        [0.02, 0],
        [0.03, 0],
        [0.04, -0.01],
        [0.05, 0],
        [-0.01, 0],
        [0, 0.01],
        [0, -0.01],
        [0.02, 0.01],
        [-0.025, 0.015],
        [-0.02, -0.015],
        [-0.045, 0.02],
        [-0.065, -0.015]
      ]) {
        trials.push([u0 + du, v0 + dv]);
      }
      const raycaster = new THREE.Raycaster();
      let best = null;
      let bestSoft = null;
      const sameAnchor =
        Math.abs(localA[0] - localB[0]) < 1e-6 &&
        Math.abs(localA[1] - localB[1]) < 1e-6 &&
        Math.abs(localA[2] - localB[2]) < 1e-6;
      for (const [u, v] of trials) {
        if (u < 0.05 || u > 0.95 || v < 0.05 || v > 0.95) continue;
        raycaster.setFromCamera(new THREE.Vector2(u * 2 - 1, -(v * 2 - 1)), cam);
        const hits = raycaster.intersectObjects(meshes, true);
        if (!hits.length) continue;
        const hit = hits[0];
        const localPos = root.worldToLocal(hit.point.clone());
        let nWorld = new THREE.Vector3(0, 0, 1);
        if (hit.face && hit.face.normal) {
          nWorld = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
        }
        const toCam = cam.position.clone().sub(hit.point).normalize();
        if (nWorld.dot(toCam) < -0.05) nWorld.multiplyScalar(-1);
        const localNormal = root.worldToLocal(hit.point.clone().add(nWorld)).sub(localPos.clone()).normalize();
        const cand = {
          ok: true,
          localPos: [+localPos.x.toFixed(4), +localPos.y.toFixed(4), +localPos.z.toFixed(4)],
          localNormal: [+localNormal.x.toFixed(3), +localNormal.y.toFixed(3), +localNormal.z.toFixed(3)],
          baseDist: +hit.distance.toFixed(4),
          baseScale: +Number(root.scale.x).toFixed(4),
          u: +u.toFixed(4),
          v: +v.toFixed(4),
          via: 'betweenNeighbors'
        };
        // 远端颊：硬闸 + soft 回退（硬闸全灭时取最远颊、避开鼻翼极端）
        const xRef = Math.min(localA[0], localB[0]);
        const farScore = -localPos.x * 5 - Math.max(0, localPos.z - 0.048) * 3 - Math.hypot(u - u0, v - v0) * 0.3;
        const softOk =
          localPos.x <= xRef + 0.04 &&
          localPos.z <= 0.072 &&
          !(localPos.z > 0.056 && localPos.x > -0.028);
        if (softOk && (!bestSoft || farScore > bestSoft._s)) {
          bestSoft = Object.assign({}, cand, { _s: farScore, via: 'betweenNeighborsSoft' });
        }
        if (preferFar) {
          const xGate = sameAnchor ? xRef + 0.028 : xRef + 0.018;
          if (localPos.x > xGate) continue;
          if (localPos.z > (sameAnchor ? 0.066 : 0.06)) continue;
        }
        let score = 0;
        if (preferFar) score = farScore;
        else if (preferFront) score = localPos.z * 3 - Math.abs(localPos.x) * 0.5;
        else score = -Math.hypot(u - u0, v - v0) - Math.max(0, localPos.x + 0.03) * 2;
        if (!best || score > best._s) best = Object.assign(cand, { _s: score });
      }
      if (best) {
        delete best._s;
        return best;
      }
      if (preferFar && bestSoft) {
        delete bestSoft._s;
        return bestSoft;
      }
      return { ok: false, reason: 'between miss', u0, v0 };
    },
    { localA, localB, bias, zNudge, xNudge, yNudge, preferFar, preferFront }
  );
}

function writeLandmark(scenePath, landmark, placed, templateFromMale, slot) {
  const data = JSON.parse(fs.readFileSync(scenePath, 'utf8'));
  const item = data.items[0];
  let annos = item.annotations || [];
  const card = cards.getCard(slot || 'V02', landmark) || V02_CARDS[landmark] || { name: String(landmark) };
  const lm = String(landmark);
  // 同名只留一条，避免 fix/auto 叠出重复编号
  const matches = [];
  annos.forEach((a, i) => {
    if (String(a.text) === lm) matches.push(i);
  });
  const idx = matches.length ? matches[0] : -1;
  if (matches.length > 1) {
    annos = annos.filter((_, i) => !matches.slice(1).includes(i));
  }
  const base =
    idx >= 0
      ? annos[idx]
      : templateFromMale || {
          id: `anno_vision_${landmark}_${Date.now()}`,
          annotationKind: 'leader',
          text: lm,
          detailText: '',
          collapsed: false,
          color: landmark === 'A' || /[A-Z]/.test(String(landmark)) ? '#e8e8e8' : '#00e8e8',
          dx: -80,
          dy: 0,
          labelShape: 'circle'
        };
  const next = Object.assign({}, base, {
    text: lm,
    localPos: placed.localPos,
    localNormal: placed.localNormal,
    baseDist: placed.baseDist,
    baseScale: placed.baseScale
  });
  if (idx >= 0) annos[idx] = next;
  else annos.push(next);
  item.annotations = annos;
  const mid = process.env.MODEL_ID || (data.meta && data.meta.modelId) || 'male_bald_asian_01';
  const label =
    process.env.MODEL_LABEL ||
    (data.meta && data.meta.modelLabel) ||
    (mid === 'male_ipman_01' ? '叶问' : mid === 'male_bald_asian_01' ? '光头亚裔' : mid);
  data.meta = Object.assign({}, data.meta || {}, {
    status: 'vision_place_in_progress',
    modelId: mid,
    modelRole: 'contrast',
    modelLabel: label
  });
  fs.writeFileSync(scenePath, JSON.stringify(data));
  rebuildAggregate();
  return { name: card.name, count: annos.length };
}

module.exports = {
  repoRoot,
  jsonDir,
  V02_CARDS,
  cards,
  getCard: cards.getCard,
  listLandmarks: cards.listLandmarks,
  normalizeSlot: cards.normalizeSlot,
  launchBrowser,
  rebuildAggregate,
  findScene,
  waitReady,
  openScene,
  applyCamera,
  setAnnosVisible,
  proposeCandidates,
  overlayCandidates,
  clearOverlay,
  rayPlace,
  placeBetweenNeighbors,
  writeLandmark
};
