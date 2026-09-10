/**
 * 102c：正面外轮廓钉「脸部 W」（排除耳壳最外缘）+ 更柔的近正前光
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-headform-102c`);
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:18080';
fs.mkdirSync(outDir, { recursive: true });

function load102() {
  const f = fs.readdirSync(jsonDir).find((n) => n.startsWith('102_') && n.endsWith('.json'));
  const full = path.join(jsonDir, f);
  return { f, full, data: JSON.parse(fs.readFileSync(full, 'utf8')) };
}
function rebuildAggregate() {
  const files = fs
    .readdirSync(jsonDir)
    .filter((fn) => /^\d+_.+\.json$/i.test(fn))
    .sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));
  const merged = files.map((fn) => JSON.parse(fs.readFileSync(path.join(jsonDir, fn), 'utf8')));
  fs.writeFileSync(path.join(jsonDir, '沙盒_头部造型规律.json'), JSON.stringify(merged) + '\n');
  return merged.length;
}

const file = load102();
file.data.camera = { pos: [0, 0.95, 6.2], target: [0, 0.92, 0], zoom: 0.56, fov: 16 };
// 对齐 101 柔光量感，方位尽量正前
file.data.light = {
  type: 'point',
  azimuth: 0,
  elevation: 28,
  distance: 16,
  temp: 34,
  size: 26,
  intensity: 1.9
};
file.data.env.skyLightScale = 0.95;
file.data.env.hasWall = false;
file.data.items[0].annotations = [];
fs.writeFileSync(file.full, JSON.stringify(file.data, null, 2) + '\n');
rebuildAggregate();

async function waitReady(page) {
  await page.waitForTimeout(2200);
  await page.evaluate(() => {
    const el = document.getElementById('scene-loader');
    if (el) el.style.display = 'none';
    const m = document.getElementById('scene-grid-modal');
    if (m) m.style.display = 'none';
  });
}

async function openV02(page) {
  const idx = await page.evaluate(() => (window.customScenes || []).findIndex((s) => s && s.id === 'V02'));
  await page.evaluate((i) => {
    window.currentSceneIndex = -1;
    window.switchScene(i);
  }, idx);
  await waitReady(page);
}

async function pick(page) {
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

    /**
     * 脸部外缘：在某一 v 上扫描，取 localX 最负且足够靠前的点（避开耳壳）
     * allowBack: 颅顶/颅侧可稍靠后
     */
    function faceLeft(v, zMin) {
      let best = null;
      for (let u = 0.28; u <= 0.58; u += 0.0025) {
        const hit = hitAt(u, v);
        if (!hit) continue;
        _lp.copy(hit.point);
        root.worldToLocal(_lp);
        if (_lp.x > 0.005) continue;
        if (_lp.z < zMin) continue;
        if (!best || _lp.x < best.x) best = { u, hit, x: _lp.x, y: _lp.y, z: _lp.z, v };
      }
      return best;
    }

    function bestInBand(v0, v1, zMin, mode) {
      let best = null;
      for (let v = v0; v <= v1; v += 0.006) {
        const s = faceLeft(v, zMin);
        if (!s) continue;
        const rec = { ...s, v: +v.toFixed(3) };
        if (!best) best = rec;
        else if (mode === 'mostNegX' && rec.x < best.x) best = rec;
        else if (mode === 'highestY' && rec.y > best.y) best = rec;
        else if (mode === 'chin' && rec.y < best.y && rec.z > 0.02) best = rec;
      }
      return best;
    }

    function midRecess(a, b, zMin) {
      if (!a || !b) return null;
      const v0 = Math.min(a.v, b.v);
      const v1 = Math.max(a.v, b.v);
      let best = null;
      for (let v = v0 + 0.015; v < v1 - 0.015; v += 0.006) {
        const s = faceLeft(v, zMin);
        if (!s) continue;
        // 凹：x 没那么负（略内收）
        if (!best || s.x > best.x) best = { ...s, v: +v.toFixed(3) };
      }
      return best;
    }

    // zMin：面中段抬高，避开耳；顶侧稍松
    const c1 = bestInBand(0.2, 0.28, -0.05, 'highestY');
    const c2 = bestInBand(0.3, 0.38, -0.02, 'mostNegX');
    const c3 = bestInBand(0.42, 0.52, 0.0, 'mostNegX'); // 颧弓：必须靠前
    const c4 = bestInBand(0.54, 0.62, 0.0, 'mostNegX');
    let c5 = bestInBand(0.64, 0.72, 0.03, 'chin');
    if (!c5) c5 = bestInBand(0.64, 0.72, 0.0, 'mostNegX');

    const convex = [
      { id: '1', name: '颅顶结节', s: c1 },
      { id: '2', name: '颅侧结节', s: c2 },
      { id: '3', name: '颧骨弓隆起', s: c3 },
      { id: '4', name: '颊转角', s: c4 },
      { id: '5', name: '颏结节', s: c5 }
    ];
    const concave = [
      { id: 'A', s: midRecess(c1, c2, -0.03) },
      { id: 'B', s: midRecess(c2, c3, -0.01) },
      { id: 'C', s: midRecess(c3, c4, 0.0) },
      { id: 'D', s: midRecess(c4, c5, 0.02) }
    ];

    function toAnno(text, color, dx, dy, hit, id) {
      const world = hit.point.clone();
      const localPos = root.worldToLocal(world.clone());
      let nWorld = new THREE.Vector3(-1, 0, 0.3);
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
        color,
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
        occludeDot: -0.35,
        labelShape: 'circle'
      };
    }

    const annotations = [];
    const placed = [];
    convex.forEach((c, i) => {
      if (!c.s || !c.s.hit) return;
      annotations.push(toAnno(c.id, '#00e8e8', -102, -26 + i * 14, c.s.hit, 'anno_v02_' + c.id));
      placed.push({ text: c.id, name: c.name, u: +c.s.u.toFixed(3), v: c.s.v, x: +c.s.x.toFixed(3), y: +c.s.y.toFixed(3), z: +c.s.z.toFixed(3) });
    });
    concave.forEach((c, i) => {
      if (!c.s || !c.s.hit) return;
      annotations.push(toAnno(c.id, '#e8e8e8', -74, -6 + i * 10, c.s.hit, 'anno_v02_' + c.id));
      placed.push({ text: c.id, u: +c.s.u.toFixed(3), v: c.s.v, x: +c.s.x.toFixed(3), y: +c.s.y.toFixed(3), z: +c.s.z.toFixed(3) });
    });

    return { ok: annotations.length >= 7, annotations, dashedLines: [], debug: { placed }, hitLabels: annotations.map((a) => a.text) };
  });
}

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(120000);

  await page.goto(`${baseUrl}/Solid.html?sandbox=headform&_=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 120000
  });
  await page.waitForFunction(() => Array.isArray(window.customScenes) && window.customScenes.length > 0, null, {
    timeout: 120000
  });
  await waitReady(page);
  await openV02(page);
  await page.screenshot({ path: path.join(outDir, 'V02-clean.png'), timeout: 90000 });

  const p = await pick(page);
  fs.writeFileSync(path.join(outDir, 'V02-pick.json'), JSON.stringify(p, null, 2));
  console.log(JSON.stringify(p.debug && p.debug.placed, null, 2));
  if (!p.ok) throw new Error('pick fail');

  const keyPoints = [
    '正面是认识头部左右外轮廓对称的基本视角。如果您不小心转动了视角，请点击重置按钮恢复视角。',
    '本关只看外轮廓：盯画面左右外缘怎么立住；标注钉在左侧脸部外缘（不含耳壳最外突；右侧大致对称，可自行对照）。',
    '请看场景中的标注，1、2、3、4、5 是轮廓上的5个凸起，A、B、C、D是外轮廓上的4个凹陷——合起来就是正面头侧常见的「W」起伏。',
    '特别留意颧宽与颏宽的对比：颧骨弓一带往往更外，颏部相对收。实际中每个人凹凸强弱不同，创作时先有这些点位的框架，再按个体强化、弱化或省略。',
    '',
    '点位名称如下：',
    '1.颅顶结节',
    '2.颅侧结节',
    '3.颧骨弓隆起',
    '4.颊转角',
    '5.颏结节',
    'A.顶侧之间内收',
    'B.侧颧之间内收',
    'C.颧颊之间内收',
    'D.颊颏之间内收'
  ].join('\n');

  const f = load102();
  f.data.items[0].annotations = p.annotations;
  f.data.items[0].dashedLines = [];
  f.data.meta.status = 'wip';
  f.data.meta.detail = '正面·外轮廓。正立石膏头；柔和近正前光；左缘脸部「W」凸凹编号（对齐 101，不连虚线；避开耳壳最外缘）。';
  f.data.meta.keyPoints = keyPoints;
  fs.writeFileSync(f.full, JSON.stringify(f.data, null, 2) + '\n');
  console.log('merged', rebuildAggregate());

  await page.goto(`${baseUrl}/Solid.html?sandbox=headform&_=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 120000
  });
  await page.waitForFunction(() => Array.isArray(window.customScenes) && window.customScenes.length > 0, null, {
    timeout: 120000
  });
  await waitReady(page);
  await openV02(page);
  await page.evaluate(() => {
    window.showAnnotations = true;
  });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: path.join(outDir, 'V02-annotated.png'), timeout: 90000 });
  console.log('OUT', outDir);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
