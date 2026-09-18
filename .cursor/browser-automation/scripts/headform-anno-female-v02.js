/**
 * 女05 V02 修正：对齐大本「忽略耳朵后的外轮廓」
 * - 1/2：颅侧真实最左剪影
 * - 3/4/A：跳过耳后，取脸面最左命中（仍是脸廓剪影，禁止 max-z 吸脸心）
 * - 5：颏底左缘（偏前）
 * 实机重载截图供 AI 视觉验收
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const femalePath = path.join(jsonDir, '102_女05_【外轮廓规律】正面.json');
const malePath = path.join(jsonDir, '102_【外轮廓规律】正面.json');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-female05-V02-noear`);
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
  console.log('[noear] start', outDir);
  const male = JSON.parse(fs.readFileSync(malePath, 'utf8'));
  const data = JSON.parse(fs.readFileSync(femalePath, 'utf8'));
  const maleByText = Object.create(null);
  for (const a of male.items[0].annotations || []) maleByText[a.text] = a;

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
  console.log('[noear] ready, picking');

  // 按大本相对高度带采点（用屏幕 v 比例，不靠旧坏点）
  const pick = await page.evaluate(() => {
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
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const yMin = box.min.y + size.y * 0.42;
    const yMax = box.max.y - size.y * 0.01;
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

    /** 一行命中（左→右），只保留头区 */
    function row(v) {
      const hits = [];
      for (let u = 0.14; u <= 0.56; u += 0.0035) {
        const hit = hitAt(u, v);
        if (!hit) continue;
        if (hit.point.y < yMin || hit.point.y > yMax) continue;
        const lp = toLocal(hit);
        if (lp.x > 0.015) continue;
        hits.push({ u, v, hit, x: lp.x, y: lp.y, z: lp.z });
      }
      return hits;
    }

    /**
     * mode:
     *  - raw: 绝对最左（颅顶/颅侧）
     *  - noear: 若最左是耳（更后），取其后第一张「更靠前」的脸面命中 = 忽略耳的脸廓
     */
    function outline(v, mode) {
      const hits = row(v);
      if (!hits.length) return null;
      const leftmost = hits[0];
      if (mode !== 'noear') return leftmost;
      // 耳判定：最左明显偏后；脸廓 = 比最左更前的命中里最左者
      const faceish = hits.filter((h) => h.z >= leftmost.z + 0.02 || h.z >= 0.025);
      if (!faceish.length) return leftmost;
      const faceLeft = faceish[0];
      if (faceLeft.u - leftmost.u >= 0.008 && leftmost.z < faceLeft.z - 0.01) return faceLeft;
      // 中段默认倾向脸廓（女05 耳常冒出）
      if (v >= 0.38 && v <= 0.62 && faceLeft.z > leftmost.z + 0.008) return faceLeft;
      return leftmost;
    }

    function refine(edge, mode) {
      if (!edge) return null;
      let lo = Math.max(0.1, edge.u - 0.015);
      let hi = edge.u;
      let best = edge;
      for (let i = 0; i < 12; i++) {
        const mid = (lo + hi) / 2;
        const hit = hitAt(mid, edge.v);
        if (!hit) {
          lo = mid;
          continue;
        }
        if (hit.point.y < yMin || hit.point.y > yMax) {
          lo = mid;
          continue;
        }
        const lp = toLocal(hit);
        if (lp.x > 0.015) {
          lo = mid;
          continue;
        }
        if (mode === 'noear' && lp.z < best.z - 0.015 && best.z >= 0.02) {
          lo = mid;
          continue;
        }
        best = { u: mid, v: edge.v, hit, x: lp.x, y: lp.y, z: lp.z };
        hi = mid;
      }
      return best;
    }

    function pickAt(v, mode) {
      return refine(outline(v, mode), mode);
    }

    function toAnno(text, color, hit, id) {
      const world = hit.point.clone();
      const localPos = root.worldToLocal(world.clone());
      let nWorld = new THREE.Vector3(-1, 0, 0);
      if (hit.face && hit.face.normal) {
        nWorld = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
      }
      const localNormal = root.worldToLocal(world.clone().add(nWorld)).sub(localPos.clone()).normalize();
      return {
        id,
        annotationKind: 'leader',
        text,
        detailText: '',
        collapsed: false,
        color,
        dx: 0,
        dy: 0,
        dxN: 0,
        dyN: 0,
        dxW: 0,
        dyW: 0,
        localPos: [+localPos.x.toFixed(4), +localPos.y.toFixed(4), +localPos.z.toFixed(4)],
        localNormal: [+localNormal.x.toFixed(3), +localNormal.y.toFixed(3), +localNormal.z.toFixed(3)],
        baseDist: +hit.distance.toFixed(4),
        baseScale: root.scale && root.scale.x ? +Number(root.scale.x).toFixed(4) : 5.8,
        occludeDot: -0.35,
        labelShape: 'circle'
      };
    }

    // 高度带：对齐大本正面「W」自上而下（头区取景）
    const specs = [
      { text: '1', name: '颅顶结节', v: 0.28, mode: 'raw', color: '#00e8e8' },
      { text: '2', name: '颅侧结节', v: 0.36, mode: 'raw', color: '#00e8e8' },
      { text: '3', name: '颧骨弓隆起', v: 0.44, mode: 'noear', color: '#00e8e8' },
      { text: '4', name: '颊转角', v: 0.56, mode: 'noear', color: '#00e8e8' },
      { text: 'A', name: '角前切迹', v: 0.68, mode: 'noear', color: '#bfbfbf' },
      { text: '5', name: '颏结节', v: 0.78, mode: 'raw', color: '#00e8e8', chin: true }
    ];

    const placed = [];
    const annotations = [];
    for (const sp of specs) {
      let s = pickAt(sp.v, sp.mode);
      if (sp.chin) {
        // 颏：在 0.74–0.82 取偏前的左缘
        let best = s;
        for (let i = 0; i <= 8; i++) {
          const v = 0.74 + (0.82 - 0.74) * (i / 8);
          const t = pickAt(v, 'raw');
          if (!t) continue;
          if (!best || (t.z > best.z + 0.005 && t.v >= 0.74) || (Math.abs(t.z - best.z) <= 0.005 && t.v > best.v)) {
            best = t;
          }
        }
        // 颏结节略靠中：若过左（下颌角），向右微移但仍贴表面
        if (best && best.x < -0.05) {
          for (let u = best.u; u <= best.u + 0.04; u += 0.004) {
            const hit = hitAt(u, best.v);
            if (!hit) continue;
            const lp = toLocal(hit);
            if (lp.z >= 0.03 && lp.x > -0.05 && lp.x < -0.012) {
              best = { u, v: best.v, hit, x: lp.x, y: lp.y, z: lp.z };
              break;
            }
          }
        }
        s = best;
      }
      if (!s || !s.hit) continue;
      placed.push({ text: sp.text, name: sp.name, u: +s.u.toFixed(4), v: +s.v.toFixed(4), x: +s.x.toFixed(4), y: +s.y.toFixed(4), z: +s.z.toFixed(4), mode: sp.mode });
      annotations.push(toAnno(sp.text, sp.color, s.hit, 'anno_v02_f05_' + sp.text));
    }

    // A 夹在 4–5
    const p4 = placed.find((p) => p.text === '4');
    const p5 = placed.find((p) => p.text === '5');
    if (p4 && p5) {
      const vA = p4.v + (p5.v - p4.v) * 0.45;
      const s = pickAt(vA, 'noear');
      if (s && s.hit) {
        const i = placed.findIndex((p) => p.text === 'A');
        const row = { text: 'A', name: '角前切迹', u: +s.u.toFixed(4), v: +s.v.toFixed(4), x: +s.x.toFixed(4), y: +s.y.toFixed(4), z: +s.z.toFixed(4), mode: 'noear' };
        if (i >= 0) placed[i] = row;
        else placed.push(row);
        const ai = annotations.findIndex((a) => a.text === 'A');
        const anno = toAnno('A', '#bfbfbf', s.hit, 'anno_v02_f05_A');
        if (ai >= 0) annotations[ai] = anno;
        else annotations.push(anno);
      }
    }

    const order = ['1', '2', '3', '4', 'A', '5'];
    let orderOk = true;
    for (let i = 1; i < order.length; i++) {
      const a = placed.find((p) => p.text === order[i - 1]);
      const b = placed.find((p) => p.text === order[i]);
      if (!a || !b || !(b.v > a.v + 0.02)) orderOk = false;
    }
    // 3/4/A 必须偏前（不能停在耳后）
    const p3 = placed.find((p) => p.text === '3');
    const pA = placed.find((p) => p.text === 'A');
    const frontOk = p3 && p3.z > 0.01 && p4 && p4.z > 0.01 && pA && pA.z > 0.015;

    return {
      ok: annotations.length >= 6 && orderOk && !!frontOk,
      orderOk,
      frontOk: !!frontOk,
      annotations,
      placed,
      rayN
    };
  });

  fs.writeFileSync(path.join(outDir, 'pick.json'), JSON.stringify({ ...pick, annotations: undefined }, null, 2));
  console.log('[noear] pick', { ok: pick.ok, orderOk: pick.orderOk, frontOk: pick.frontOk, placed: pick.placed, rayN: pick.rayN });
  if (!pick.ok) {
    console.error('PICK_FAIL');
    await browser.close();
    process.exit(1);
  }

  for (const a of pick.annotations) {
    const src = maleByText[a.text];
    if (src && src.color) a.color = src.color;
    a.dx = 0;
    a.dy = 0;
  }

  data.items[0].annotations = pick.annotations;
  data.items[0].dashedLines = [];
  data.meta.status = 'vision_pending';
  const tip =
    '\n\n本场景是同一课的对比个体（女05）。点位框架与参考模（大本）一致：1–5 为左缘凸起，A 为角前切迹；耳朵不参与外轮廓；请对照凹凸强弱与宽窄差异。';
  if (!(data.meta.keyPoints || '').includes('对比个体（女05）')) {
    data.meta.keyPoints = String(male.meta.keyPoints || '') + tip;
    data.meta.keyPointsRich = String(male.meta.keyPointsRich || '') + tip.replace(/\n/g, '<br>');
  }
  fs.writeFileSync(femalePath, JSON.stringify(data));
  rebuildAggregate();
  console.log('[noear] wrote');

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
