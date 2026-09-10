/**
 * headform V01/L01 v6：左缘扫描跳过鼻额（|x|小且 z 高），落到远端颊/颞剪影。
 * 写完必须 AI 视觉读图验收。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-headform-v6`);
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
  await page.waitForTimeout(1400);
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

    function isNoseLike(x, z) {
      return Math.abs(x) < 0.04 && z > 0.06;
    }

    /** 从左扫描：跳过鼻额，取第一个远端颊/颞命中；若无则退回最左 */
    function farContourAtV(v) {
      let leftmost = null;
      let far = null;
      for (let u = 0.18; u <= 0.7; u += 0.0025) {
        const hit = hitAt(u, v);
        if (!hit) continue;
        _lp.copy(hit.point);
        root.worldToLocal(_lp);
        const rec = { u, hit, x: _lp.x, y: _lp.y, z: _lp.z };
        if (!leftmost) leftmost = rec;
        if (!isNoseLike(rec.x, rec.z) && rec.x < -0.02) {
          far = rec;
          break;
        }
      }
      // 面中段优先 far；头顶/颏可退回 leftmost
      return far || leftmost;
    }

    const samples = [];
    for (let i = 0; i <= 100; i++) {
      const v = 0.2 + (0.74 - 0.2) * (i / 100);
      const s = farContourAtV(v);
      if (s) samples.push({ v: +v.toFixed(4), u: +s.u.toFixed(4), x: +s.x.toFixed(4), z: +s.z.toFixed(4), hit: s.hit });
    }
    if (samples.length < 8) return { error: 'few', n: samples.length };

    // 外鼓：x 更负
    const bulges = [];
    for (let i = 3; i < samples.length - 3; i++) {
      const a = samples[i];
      if (a.x <= samples[i - 1].x && a.x <= samples[i + 1].x && a.x <= samples[i - 2].x) {
        if (a.v >= 0.26 && a.v <= 0.58 && a.x < -0.03) bulges.push({ v: a.v, u: a.u, x: a.x, z: a.z });
      }
    }
    const uniq = [];
    for (const b of bulges) {
      if (!uniq.length || Math.abs(uniq[uniq.length - 1].v - b.v) > 0.035) uniq.push(b);
    }
    const byV = uniq.sort((a, b) => a.v - b.v);
    const brow = byV[0] || samples.find((s) => s.v > 0.3 && s.v < 0.38 && s.x < -0.04) || null;
    const zyg =
      byV.find((b) => brow && b.v >= brow.v + 0.07) ||
      samples.filter((s) => s.v > 0.4 && s.v < 0.5 && s.x < -0.045).sort((a, b) => a.x - b.x)[0] ||
      null;

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
      { text: '额缘', v: brow ? Math.max(0.22, brow.v - 0.045) : 0.26, dx: -92, dy: -36 },
      { text: '眉弓凸', prefer: brow, v: 0.34, dx: -102, dy: -6 },
      { text: '颧骨凸', prefer: zyg, v: 0.45, dx: -110, dy: 10 },
      { text: '下颌转', v: 0.58, dx: -100, dy: 24 },
      { text: '颏端', v: 0.69, dx: -84, dy: 40 }
    ];

    const annotations = [];
    const placed = [];
    for (let i = 0; i < targets.length; i++) {
      const T = targets[i];
      let s = null;
      if (T.prefer) {
        s = farContourAtV(T.prefer.v);
        if (s) s = { ...s, v: T.prefer.v };
      }
      if (!s) s = nearest(T.v);
      if (!s || !s.hit) continue;
      // 颏/颌允许略靠中；眉弓颧骨必须够侧
      if ((T.text === '眉弓凸' || T.text === '颧骨凸') && s.x > -0.035) {
        // 强制在该 v 附近找更侧的点
        let best = null;
        for (let dv = -0.04; dv <= 0.04; dv += 0.01) {
          const t = farContourAtV(T.v + dv);
          if (t && (!best || t.x < best.x)) best = { ...t, v: +(T.v + dv).toFixed(3) };
        }
        if (best && best.x < s.x) s = best;
      }
      annotations.push(toAnno(T.text, T.dx, T.dy, s.hit, 'anno_v01_' + (i + 1)));
      placed.push({ text: T.text, u: +s.u.toFixed(3), v: +(s.v != null ? s.v : T.v).toFixed(3), x: +s.x.toFixed(3), z: +s.z.toFixed(3) });
    }

    const pts = [];
    for (let t = 0; t <= 26; t++) {
      const v = 0.22 + (0.72 - 0.22) * (t / 26);
      const s = farContourAtV(v);
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
    // L01：光从观视右侧来 → 亮面在右；环影在鼻旁暗侧（偏左）
    const labels = [
      { text: '亮面', u: 0.60, v: 0.40, dx: 100, dy: -40 },
      { text: '鼻侧环影', u: 0.47, v: 0.49, dx: -105, dy: -15 },
      { text: '颊影未接', u: 0.44, v: 0.53, dx: -115, dy: 20 },
      { text: '交界带', u: 0.52, v: 0.48, dx: 85, dy: 45 }
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
