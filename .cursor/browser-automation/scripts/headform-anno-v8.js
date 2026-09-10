/**
 * headform v8：V01 用屏幕最左剪影（贴外轮廓）；L01 按画面亮暗侧重标。
 * 必须 AI 视觉验收。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-headform-v8`);
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
  await page.waitForTimeout(1300);
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

    /** 屏幕最左剪影；inward 极小，贴外缘 */
    function leftEdge(v, inward) {
      for (let u = 0.2; u <= 0.7; u += 0.002) {
        const hit = hitAt(u, v);
        if (!hit) continue;
        _lp.copy(hit.point);
        root.worldToLocal(_lp);
        const u2 = Math.min(0.7, u + (inward || 0.002));
        const hit2 = inward ? hitAt(u2, v) || hit : hit;
        _lp.copy(hit2.point);
        root.worldToLocal(_lp);
        return { u: u2, edgeU: u, hit: hit2, x: _lp.x, y: _lp.y, z: _lp.z };
      }
      return null;
    }

    // 采样左缘 u(v)，找外鼓（u 局部最小 = 更靠左）
    const samples = [];
    for (let i = 0; i <= 100; i++) {
      const v = 0.2 + (0.72 - 0.2) * (i / 100);
      const s = leftEdge(v, 0.0015);
      if (s) samples.push({ v: +v.toFixed(4), u: +s.u.toFixed(4), edgeU: +s.edgeU.toFixed(4), x: +s.x.toFixed(4), z: +s.z.toFixed(4), hit: s.hit });
    }

    const bulges = [];
    for (let i = 4; i < samples.length - 4; i++) {
      const a = samples[i];
      let ok = true;
      for (let k = i - 3; k <= i + 3; k++) if (samples[k].edgeU < a.edgeU) ok = false;
      if (ok && a.v >= 0.26 && a.v <= 0.55) bulges.push(a);
    }
    const uniq = [];
    for (const b of bulges) {
      if (!uniq.length || Math.abs(uniq[uniq.length - 1].v - b.v) > 0.035) uniq.push(b);
    }
    // 面区：第一鼓≈眉弓，第二鼓≈颧骨（在鼻鼓之前）
    const face = uniq.filter((b) => b.v < 0.5);
    const brow = face[0] || samples.find((s) => s.v > 0.3 && s.v < 0.36);
    // 颧骨：紧接眉弓后的第二外鼓（勿跳到鼻鼓）
    let zyg = face[1] || null;
    if (!zyg || (brow && zyg.v < brow.v + 0.03)) {
      zyg = samples.filter((s) => s.v > 0.34 && s.v < 0.42).sort((a, b) => a.x - b.x)[0];
    }

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

    const plan = [
      { text: '额缘', v: brow ? Math.max(0.22, brow.v - 0.04) : 0.26, dx: -100, dy: -38 },
      { text: '眉弓凸', s: brow, dx: -108, dy: -6 },
      { text: '颧骨凸', s: zyg, dx: -115, dy: 8 },
      { text: '下颌转', v: 0.58, dx: -102, dy: 20 },
      { text: '颏端', v: 0.69, dx: -88, dy: 36 }
    ];

    const annotations = [];
    const placed = [];
    for (let i = 0; i < plan.length; i++) {
      const T = plan[i];
      const s = T.s || nearest(T.v);
      if (!s || !s.hit) continue;
      annotations.push(toAnno(T.text, T.dx, T.dy, s.hit, 'anno_v01_' + (i + 1)));
      placed.push({ text: T.text, u: s.u, edgeU: s.edgeU, v: s.v, x: s.x, z: s.z });
    }

    const pts = [];
    for (let t = 0; t <= 28; t++) {
      const v = 0.22 + (0.72 - 0.22) * (t / 28);
      const s = leftEdge(v, 0.001);
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
      debug: {
        bulges: uniq.slice(0, 8).map((b) => ({ v: b.v, edgeU: b.edgeU, x: b.x })),
        placed
      },
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
    // 据 v7 L01 画面：左侧亮、右侧暗 → 亮面在左；环影在鼻旁暗侧（偏右）
    const labels = [
      { text: '亮面', u: 0.42, v: 0.40, dx: -100, dy: -45 },
      { text: '鼻侧环影', u: 0.52, v: 0.49, dx: 95, dy: -20 },
      { text: '颊影未接', u: 0.56, v: 0.52, dx: 110, dy: 12 },
      { text: '交界带', u: 0.50, v: 0.51, dx: 80, dy: 40 }
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
  console.log('V01', p1.hitLabels);
  console.log('bulges', JSON.stringify(p1.debug && p1.debug.bulges));
  console.log('placed', JSON.stringify(p1.debug && p1.debug.placed));

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
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(outDir, `${id}-annotated.png`), timeout: 60000 });
  }
  console.log('OUT', outDir);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
