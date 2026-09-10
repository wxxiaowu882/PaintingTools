/**
 * V01：在每一扫描行取「可见点中 localX 最负」的远侧面点（真正远端颊/颞），
 * 而不是屏幕最左（易落到鼻额）。L01：Loop 证据。须 AI 视觉验收。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-headform-v5`);
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:18080';
fs.mkdirSync(outDir, { recursive: true });

function loadSceneFile(num) {
  const f = fs.readdirSync(jsonDir).find((n) => n.startsWith(num + '_') && n.endsWith('.json'));
  const full = path.join(jsonDir, f);
  return { f, full, data: JSON.parse(fs.readFileSync(full, 'utf8')) };
}
function rebuildAggregate() {
  const files = fs
    .readdirSync(jsonDir)
    .filter((f) => /^\d+_.+\.json$/i.test(f))
    .sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));
  const merged = files.map((f) => JSON.parse(fs.readFileSync(path.join(jsonDir, f), 'utf8')));
  fs.writeFileSync(path.join(jsonDir, '沙盒_头部造型规律.json'), JSON.stringify(merged) + '\n');
  return merged.length;
}

async function waitReady(page) {
  await page.waitForFunction(() => {
    const el = document.getElementById('scene-loader');
    if (!el) return true;
    const st = getComputedStyle(el);
    return st.display === 'none' || Number(st.opacity || 1) < 0.05;
  }, null, { timeout: 180000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    const el = document.getElementById('scene-loader');
    if (el) el.style.display = 'none';
    const m = document.getElementById('scene-grid-modal');
    if (m) m.style.display = 'none';
  });
}

async function openScene(page, id) {
  const idx = await page.evaluate((want) => {
    return (window.customScenes || []).findIndex((s) => s && String(s.id) === String(want));
  }, id);
  await page.evaluate((i) => {
    window.currentSceneIndex = -1;
    window.switchScene(i);
  }, idx);
  await waitReady(page);
}

async function pickV01(page) {
  return page.evaluate(() => {
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

    /** 该扫描行：在左侧可见带里，取 localX 最负（远端）的点 */
    function farSideAtV(v) {
      const cands = [];
      for (let u = 0.22; u <= 0.62; u += 0.003) {
        const hit = hitAt(u, v);
        if (!hit) continue;
        _lp.copy(hit.point);
        root.worldToLocal(_lp);
        cands.push({ u, hit, x: _lp.x, y: _lp.y, z: _lp.z });
      }
      if (!cands.length) return null;
      const minU = Math.min(...cands.map((c) => c.u));
      // 只在左缘附近挑，避免选到后脑
      const band = cands.filter((c) => c.u <= minU + 0.12 && c.z > 0.01);
      const pool = band.length ? band : cands.filter((c) => c.u <= minU + 0.15);
      pool.sort((a, b) => a.x - b.x);
      return pool[0] || null;
    }

    const samples = [];
    for (let i = 0; i <= 90; i++) {
      const v = 0.2 + (0.74 - 0.2) * (i / 90);
      const s = farSideAtV(v);
      if (s) samples.push({ v: +v.toFixed(4), u: +s.u.toFixed(4), x: +s.x.toFixed(4), z: +s.z.toFixed(4), hit: s.hit });
    }
    if (samples.length < 8) return { error: 'few samples', n: samples.length };

    // 鼓包：x 更负为外突（远端外鼓）
    const bulges = [];
    for (let i = 3; i < samples.length - 3; i++) {
      const a = samples[i];
      if (a.x <= samples[i - 1].x && a.x <= samples[i + 1].x && a.x <= samples[i - 2].x && a.x <= samples[i + 2].x) {
        if (a.v >= 0.24 && a.v <= 0.62) bulges.push({ v: a.v, u: a.u, x: a.x, z: a.z });
      }
    }
    const uniq = [];
    for (const b of bulges) {
      if (!uniq.length || Math.abs(uniq[uniq.length - 1].v - b.v) > 0.03) uniq.push(b);
    }
    // 上鼓≈眉弓，下鼓≈颧骨（在面中段）
    const mid = uniq.filter((b) => b.v >= 0.26 && b.v <= 0.52);
    mid.sort((a, b) => a.x - b.x);
    const byV = uniq.filter((b) => b.v >= 0.26 && b.v <= 0.52).sort((a, b) => a.v - b.v);
    const brow = byV[0] || null;
    const zyg = byV.find((b) => brow && b.v >= brow.v + 0.06) || byV[1] || null;

    function nearest(vTarget) {
      let best = samples[0];
      let bd = 1e9;
      for (const s of samples) {
        const d = Math.abs(s.v - vTarget);
        if (d < bd) {
          bd = d;
          best = s;
        }
      }
      return best;
    }

    function toAnno(text, dx, dy, hit, id) {
      const world = hit.point.clone();
      const localPos = root.worldToLocal(world.clone());
      let nWorld = new THREE.Vector3(0, 0, 1);
      if (hit.face && hit.face.normal) {
        nWorld = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
      }
      const localNormal = root
        .worldToLocal(world.clone().add(nWorld))
        .sub(localPos.clone())
        .normalize();
      return {
        id,
        annotationKind: 'leader',
        text,
        detailText: '',
        collapsed: false,
        color: '#787878',
        dx,
        dy,
        dxN: 0,
        dyN: 0,
        dxW: 0,
        dyW: 0,
        localPos: [Number(localPos.x.toFixed(4)), Number(localPos.y.toFixed(4)), Number(localPos.z.toFixed(4))],
        localNormal: [
          Number(localNormal.x.toFixed(3)),
          Number(localNormal.y.toFixed(3)),
          Number(localNormal.z.toFixed(3))
        ],
        baseDist: Number(hit.distance.toFixed(4)),
        baseScale: root.scale && root.scale.x ? Number(root.scale.x) : 1,
        occludeDot: -0.35
      };
    }

    const targets = [
      { text: '额缘', v: brow ? Math.max(0.22, brow.v - 0.05) : 0.26, dx: -90, dy: -38 },
      { text: '眉弓凸', v: brow ? brow.v : 0.32, prefer: brow, dx: -100, dy: -8 },
      { text: '颧骨凸', v: zyg ? zyg.v : 0.44, prefer: zyg, dx: -108, dy: 8 },
      { text: '下颌转', v: 0.58, dx: -98, dy: 22 },
      { text: '颏端', v: 0.68, dx: -82, dy: 38 }
    ];

    const annotations = [];
    const placed = [];
    for (let i = 0; i < targets.length; i++) {
      const T = targets[i];
      let hit = null;
      let meta = null;
      if (T.prefer) {
        const s = farSideAtV(T.prefer.v);
        if (s) {
          hit = s.hit;
          meta = { u: s.u, v: T.prefer.v, x: s.x, z: s.z };
        }
      }
      if (!hit) {
        const s = nearest(T.v);
        hit = s.hit;
        meta = { u: s.u, v: s.v, x: s.x, z: s.z };
      }
      if (!hit) continue;
      annotations.push(toAnno(T.text, T.dx, T.dy, hit, 'anno_v01_' + (i + 1)));
      placed.push({ text: T.text, ...meta });
    }

    const pts = [];
    for (let t = 0; t <= 24; t++) {
      const v = 0.22 + (0.72 - 0.22) * (t / 24);
      const s = farSideAtV(v);
      if (!s) continue;
      const world = s.hit.point.clone();
      const localPos = root.worldToLocal(world.clone());
      let nWorld = new THREE.Vector3(0, 1, 0);
      if (s.hit.face && s.hit.face.normal) {
        nWorld = s.hit.face.normal.clone().transformDirection(s.hit.object.matrixWorld).normalize();
      }
      const localNormal = root
        .worldToLocal(world.clone().add(nWorld))
        .sub(localPos.clone())
        .normalize();
      pts.push({
        pos: [Number(localPos.x.toFixed(4)), Number(localPos.y.toFixed(4)), Number(localPos.z.toFixed(4))],
        norm: [
          Number(localNormal.x.toFixed(3)),
          Number(localNormal.y.toFixed(3)),
          Number(localNormal.z.toFixed(3))
        ]
      });
    }

    return {
      ok: annotations.length >= 4,
      annotations,
      dashedLines: pts.length >= 2
        ? [{ id: 'dash_v01_far', color: '#00ffff', points: pts, kind: 'straight', occludeDot: -0.35 }]
        : [],
      debug: { uniq, brow, zyg, placed },
      hitLabels: annotations.map((a) => a.text)
    };
  });
}

async function pickL01(page) {
  return page.evaluate(() => {
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
    function toAnno(text, dx, dy, hit, id) {
      const world = hit.point.clone();
      const localPos = root.worldToLocal(world.clone());
      let nWorld = new THREE.Vector3(0, 0, 1);
      if (hit.face && hit.face.normal) {
        nWorld = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
      }
      const localNormal = root
        .worldToLocal(world.clone().add(nWorld))
        .sub(localPos.clone())
        .normalize();
      return {
        id,
        annotationKind: 'leader',
        text,
        detailText: '',
        collapsed: false,
        color: '#787878',
        dx,
        dy,
        dxN: 0,
        dyN: 0,
        dxW: 0,
        dyW: 0,
        localPos: [Number(localPos.x.toFixed(4)), Number(localPos.y.toFixed(4)), Number(localPos.z.toFixed(4))],
        localNormal: [
          Number(localNormal.x.toFixed(3)),
          Number(localNormal.y.toFixed(3)),
          Number(localNormal.z.toFixed(3))
        ],
        baseDist: Number(hit.distance.toFixed(4)),
        baseScale: root.scale && root.scale.x ? Number(root.scale.x) : 1,
        occludeDot: -0.35
      };
    }
    // L01 近正面：亮面在受光侧（观视偏右上额颊），环影在鼻旁暗侧
    // 据 v4 视觉：先前「亮面」误标到暗部 → 改到画面右侧受光额颊
    const labels = [
      { text: '亮面', u: 0.58, v: 0.38, dx: 95, dy: -45 },
      { text: '鼻侧环影', u: 0.48, v: 0.48, dx: -100, dy: -20 },
      { text: '颊影未接', u: 0.45, v: 0.52, dx: -110, dy: 15 },
      { text: '交界带', u: 0.50, v: 0.50, dx: 90, dy: 40 }
    ];
    const annotations = [];
    for (let i = 0; i < labels.length; i++) {
      const L = labels[i];
      const hit = hitAt(L.u, L.v);
      if (!hit) continue;
      annotations.push(toAnno(L.text, L.dx, L.dy, hit, 'anno_l01_' + (i + 1)));
    }
    return { ok: annotations.length >= 3, annotations, dashedLines: [], hitLabels: annotations.map((a) => a.text) };
  });
}

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${baseUrl}/Solid.html?sandbox=headform&_=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 90000
  });
  await page.waitForFunction(() => Array.isArray(window.customScenes) && window.customScenes.length > 0, null, {
    timeout: 90000
  });
  await page.waitForFunction(() => !!(window.__solidHost && window.__solidHost.getCamera()), null, {
    timeout: 90000
  });
  await waitReady(page);

  await openScene(page, 'V01');
  const p1 = await pickV01(page);
  fs.writeFileSync(path.join(outDir, 'V01-pick.json'), JSON.stringify(p1, null, 2));
  console.log('V01', p1.hitLabels, p1.debug && p1.debug.placed);

  if (p1.ok) {
    const f = loadSceneFile('101');
    f.data.items[0].annotations = p1.annotations;
    f.data.items[0].dashedLines = p1.dashedLines;
    f.data.meta.status = 'wip';
    fs.writeFileSync(f.full, JSON.stringify(f.data, null, 2) + '\n');
  }

  await openScene(page, 'L01');
  const p2 = await pickL01(page);
  fs.writeFileSync(path.join(outDir, 'L01-pick.json'), JSON.stringify(p2, null, 2));
  console.log('L01', p2.hitLabels);
  if (p2.ok) {
    const f = loadSceneFile('201');
    f.data.items[0].annotations = p2.annotations;
    f.data.items[0].dashedLines = [];
    f.data.meta.status = 'wip';
    fs.writeFileSync(f.full, JSON.stringify(f.data, null, 2) + '\n');
  }

  console.log('merged', rebuildAggregate());

  await page.goto(`${baseUrl}/Solid.html?sandbox=headform&_=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 90000
  });
  await page.waitForFunction(() => Array.isArray(window.customScenes) && window.customScenes.length > 0, null, {
    timeout: 90000
  });
  await waitReady(page);
  for (const id of ['V01', 'L01']) {
    await openScene(page, id);
    await page.evaluate(() => {
      window.showAnnotations = true;
      const el = document.getElementById('scene-loader');
      if (el) el.style.display = 'none';
    });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(outDir, `${id}-annotated.png`), timeout: 60000 });
  }
  console.log('OUT', outDir);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
