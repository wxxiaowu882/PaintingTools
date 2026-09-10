/**
 * headform 101/201 纠偏 v3：远端剪影鼓包检测 + Loop 证据
 * 写回后必须 AI 视觉读图，不可只看命中日志。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-headform-anno-v3`);
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:18080';
const sceneFilter = (process.env.SCENE_IDS || 'V01,L01')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

fs.mkdirSync(outDir, { recursive: true });

const META = {
  V01: {
    fileNum: '101',
    keyPoints: [
      '侧前（四分之三）是肖像里最常见的头向。',
      '本关只看外轮廓：盯画面上那条「远端」剪影（头朝左时多在画面左缘）怎么起伏。',
      '尤其注意眉弓凸、颧骨凸——远端轮廓上常见的两处外鼓，多半落在骨点最外突处，轮廓才会“站住”。',
      '近侧脸面信息多，但本关不拿近侧当主轮廓课。'
    ].join('\n'),
    detail: '样板关：侧前·远端外轮廓。正立石膏头 + 远端剪影虚线 + 眉弓/颧骨等转折指认。'
  },
  L01: {
    fileNum: '201',
    keyPoints: [
      '本关只看光：侧前略高的环形明暗（Loop）。',
      '先找鼻旁那一小圈影——它还没有接到颊上的大阴影（接到了就更像伦勃朗）。',
      '亮面仍大；「颊影未接」是本关和戏剧光的分界。',
      '交界已经钉在头上；你可以轻轻换视角，看这条环影是否还在。'
    ].join('\n'),
    detail: '样板关：环形光（Loop）。正立石膏头 + 环影/亮面/颊影未接/交界带指认。'
  }
};

async function waitReady(page) {
  await page.waitForFunction(() => {
    const el = document.getElementById('scene-loader');
    if (!el) return true;
    const st = getComputedStyle(el);
    return st.display === 'none' || Number(st.opacity || 1) < 0.05;
  }, null, { timeout: 180000 }).catch(() => {});
  await page.waitForTimeout(1800);
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
  if (idx < 0) throw new Error('missing ' + id);
  await page.evaluate((i) => {
    window.currentSceneIndex = -1;
    window.switchScene(i);
  }, idx);
  await waitReady(page);
}

function loadSceneFile(num) {
  const f = fs.readdirSync(jsonDir).find((n) => n.startsWith(num + '_') && n.endsWith('.json'));
  if (!f) throw new Error('no file ' + num);
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

async function pickV01(page) {
  return page.evaluate(() => {
    const host = window.__solidHost;
    const THREE = host.getTHREE();
    const cam = host.getCamera();
    const g = host.getSceneGroup();
    const meshes = [];
    let root = null;
    g.traverse((o) => {
      if (o.isMesh && o.geometry) meshes.push(o);
      if (!root && o.userData && o.userData.type === 'glb') root = o;
    });
    if (!root) root = g.children.find((c) => c.userData && c.userData.type === 'glb') || g.children[0];
    const raycaster = new THREE.Raycaster();

    function hitAt(u, v) {
      raycaster.setFromCamera(new THREE.Vector2(u * 2 - 1, -(v * 2 - 1)), cam);
      return raycaster.intersectObjects(meshes, true)[0] || null;
    }
    function farEdgeU(v) {
      for (let u = 0.28; u <= 0.58; u += 0.003) {
        if (hitAt(u, v)) return u;
      }
      return null;
    }

    // 采样左缘：u 越小越靠远端剪影外侧
    const samples = [];
    for (let iv = 0; iv <= 80; iv++) {
      const v = 0.24 + (0.74 - 0.24) * (iv / 80);
      const u = farEdgeU(v);
      if (u != null) samples.push({ v: +v.toFixed(4), u: +u.toFixed(4) });
    }
    if (samples.length < 10) return { error: 'edge too short', samples };

    // 鼓包 = 局部更靠左（u 局部极小）
    const bulges = [];
    for (let i = 2; i < samples.length - 2; i++) {
      const a = samples[i];
      if (
        a.u <= samples[i - 1].u &&
        a.u <= samples[i + 1].u &&
        a.u <= samples[i - 2].u &&
        a.u <= samples[i + 2].u
      ) {
        bulges.push(a);
      }
    }
    // 面区鼓包（排除头顶/颈）：v 0.30–0.62
    const faceBulges = bulges
      .filter((b) => b.v >= 0.30 && b.v <= 0.62)
      .sort((a, b) => a.u - b.u);

    // 取最靠外的两个鼓包，再按 v 排序 → 上=眉弓，下=颧骨
    let brow = null;
    let zyg = null;
    const topTwo = faceBulges.slice(0, 6).sort((a, b) => a.v - b.v);
    if (topTwo.length >= 2) {
      // 在面区里找：上半一个、下半一个
      const upper = faceBulges.filter((b) => b.v < 0.44).sort((a, b) => a.u - b.u)[0];
      const lower = faceBulges.filter((b) => b.v >= 0.44).sort((a, b) => a.u - b.u)[0];
      brow = upper || topTwo[0];
      zyg = lower || topTwo[1];
    } else if (topTwo.length === 1) {
      brow = topTwo[0];
    }

    function nearestSample(vTarget) {
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

    const targets = [
      { text: '额缘', v: 0.28, dx: -100, dy: -40 },
      { text: '眉弓凸', v: brow ? brow.v : 0.36, dx: -110, dy: -15, forceU: brow && brow.u },
      { text: '颧骨凸', v: zyg ? zyg.v : 0.48, dx: -115, dy: 0, forceU: zyg && zyg.u },
      { text: '下颌转', v: 0.60, dx: -105, dy: 20 },
      { text: '颏端', v: 0.69, dx: -90, dy: 40 }
    ];

    function toAnno(text, dx, dy, hit, id) {
      const world = hit.point.clone();
      const localPos = root.worldToLocal(world.clone());
      let nWorld = new THREE.Vector3(0, 0, 1);
      if (hit.face && hit.face.normal) {
        nWorld = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
      }
      const nTip = world.clone().add(nWorld);
      const localNormal = root.worldToLocal(nTip).sub(localPos.clone()).normalize();
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

    const annotations = [];
    const debug = { brow, zyg, bulges: faceBulges.slice(0, 8), placed: [] };
    const inward = 0.004;

    for (let i = 0; i < targets.length; i++) {
      const T = targets[i];
      const s = nearestSample(T.v);
      const edgeU = T.forceU != null ? T.forceU : s.u;
      const v = T.forceU != null ? T.v : s.v;
      const u = Math.min(0.62, edgeU + inward);
      const hit = hitAt(u, v);
      if (!hit) continue;
      annotations.push(toAnno(T.text, T.dx, T.dy, hit, 'anno_v01_' + (i + 1)));
      debug.placed.push({ text: T.text, u: +u.toFixed(3), v: +v.toFixed(3), edgeU: +edgeU.toFixed(3) });
    }

    // 虚线：整条远端左缘
    const pts = [];
    for (let t = 0; t <= 20; t++) {
      const v = 0.25 + (0.72 - 0.25) * (t / 20);
      const s = nearestSample(v);
      const u = Math.min(0.62, s.u + 0.003);
      const hit = hitAt(u, s.v);
      if (!hit) continue;
      const world = hit.point.clone();
      const localPos = root.worldToLocal(world.clone());
      let nWorld = new THREE.Vector3(0, 1, 0);
      if (hit.face && hit.face.normal) {
        nWorld = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
      }
      const nTip = world.clone().add(nWorld);
      const localNormal = root.worldToLocal(nTip).sub(localPos.clone()).normalize();
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
      dashedLines:
        pts.length >= 2
          ? [{ id: 'dash_v01_far', color: '#00ffff', points: pts, kind: 'straight', occludeDot: -0.35 }]
          : [],
      debug,
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
    const meshes = [];
    let root = null;
    g.traverse((o) => {
      if (o.isMesh && o.geometry) meshes.push(o);
      if (!root && o.userData && o.userData.type === 'glb') root = o;
    });
    if (!root) root = g.children.find((c) => c.userData && c.userData.type === 'glb') || g.children[0];
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
      const nTip = world.clone().add(nWorld);
      const localNormal = root.worldToLocal(nTip).sub(localPos.clone()).normalize();
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

    // 视觉定点（L01 净图）：环影在鼻影侧；亮面在受光颊额；颊影未接在环影与颊大影之间；交界带在颊上明暗过渡而不是耳深影
    const labels = [
      { text: '鼻侧环影', u: 0.52, v: 0.49, dx: 100, dy: -30 },
      { text: '亮面', u: 0.43, v: 0.40, dx: -100, dy: -50 },
      { text: '颊影未接', u: 0.57, v: 0.51, dx: 115, dy: 5 },
      { text: '交界带', u: 0.55, v: 0.54, dx: 110, dy: 35 }
    ];
    const annotations = [];
    const debug = [];
    for (let i = 0; i < labels.length; i++) {
      const L = labels[i];
      const hit = hitAt(L.u, L.v);
      if (!hit) {
        debug.push({ text: L.text, miss: true });
        continue;
      }
      annotations.push(toAnno(L.text, L.dx, L.dy, hit, 'anno_l01_' + (i + 1)));
      debug.push({ text: L.text, u: L.u, v: L.v });
    }
    return {
      ok: annotations.length >= 3,
      annotations,
      dashedLines: [],
      debug,
      hitLabels: annotations.map((a) => a.text)
    };
  });
}

async function main() {
  const log = [];
  const push = (m) => {
    log.push(m);
    console.log(m);
  };
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(60000);

  try {
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

    for (const id of sceneFilter) {
      await openScene(page, id);
      const pick = id === 'V01' ? await pickV01(page) : await pickL01(page);
      fs.writeFileSync(path.join(outDir, `${id}-pick.json`), JSON.stringify(pick, null, 2));
      push(`${id}: ${(pick.hitLabels || []).join(',') || pick.error}`);
      if (!pick.ok) continue;

      const meta = META[id];
      const file = loadSceneFile(meta.fileNum);
      file.data.items[0].annotations = pick.annotations;
      file.data.items[0].dashedLines = pick.dashedLines || [];
      file.data.meta = file.data.meta || {};
      file.data.meta.status = 'wip';
      file.data.meta.detail = meta.detail;
      file.data.meta.keyPoints = meta.keyPoints;
      fs.writeFileSync(file.full, JSON.stringify(file.data, null, 2) + '\n');
      push('wrote ' + file.f);
    }

    push('merged ' + rebuildAggregate());

    await page.goto(`${baseUrl}/Solid.html?sandbox=headform&_=${Date.now()}`, {
      waitUntil: 'domcontentloaded',
      timeout: 90000
    });
    await page.waitForFunction(() => Array.isArray(window.customScenes) && window.customScenes.length > 0, null, {
      timeout: 90000
    });
    await waitReady(page);

    for (const id of sceneFilter) {
      await openScene(page, id);
      await page.evaluate(() => {
        window.showAnnotations = true;
        const el = document.getElementById('scene-loader');
        if (el) el.style.display = 'none';
      });
      await page.waitForTimeout(1200);
      await page.screenshot({ path: path.join(outDir, `${id}-annotated.png`), timeout: 60000 });
      push('shot ' + id);
    }

    fs.writeFileSync(path.join(outDir, 'log.txt'), log.join('\n') + '\n');
    console.log('OUT', outDir);
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
