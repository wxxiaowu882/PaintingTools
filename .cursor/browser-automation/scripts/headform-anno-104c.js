/**
 * 104c：用用户手调 103 点位作种子，按同高度贴到全侧面左缘剪影
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-headform-104c`);
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:18080';
fs.mkdirSync(outDir, { recursive: true });

function load(prefix) {
  const f = fs.readdirSync(jsonDir).find((n) => n.startsWith(prefix) && n.endsWith('.json'));
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

async function boot(page) {
  await page.goto(`${baseUrl}/Solid.html?sandbox=headform&skipPerf=1&_=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 90000
  });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    window.useAdvancedRender = false;
    window.perfTestDone = true;
    window.isTestingPerformance = false;
    if ((!window.customScenes || !window.customScenes.length) && window.loadJSONData) window.loadJSONData();
  });
  await page.waitForFunction(
    () => (window.customScenes || []).length > 0 && window.__solidHost && window.__solidHost.getCamera(),
    null,
    { timeout: 90000 }
  );
}

async function openId(page, id) {
  await page.evaluate((want) => {
    const m = document.getElementById('scene-grid-modal');
    if (m) m.style.display = 'none';
    const i = window.customScenes.findIndex((s) => s && s.id === want);
    window.currentSceneIndex = -1;
    window.switchScene(i);
  }, id);
  for (let i = 0; i < 80; i++) {
    const n = await page.evaluate(() => {
      let c = 0;
      try {
        window.__solidHost.getSceneGroup().traverse((o) => {
          if (o.isMesh) c++;
        });
      } catch (_e) {}
      return c;
    });
    if (n > 0) break;
    await page.waitForTimeout(400);
  }
  await page.evaluate(() => {
    const el = document.getElementById('scene-loader');
    if (el) el.style.display = 'none';
    const m = document.getElementById('scene-grid-modal');
    if (m) m.style.display = 'none';
  });
  await page.waitForTimeout(1000);
}

async function main() {
  const s103 = load('103_');
  const seeds = (s103.data.items[0].annotations || []).map((a) => ({
    text: String(a.text || '').trim(),
    color: a.color,
    y: a.localPos[1],
    z: a.localPos[2],
    dx: a.dx,
    dy: a.dy
  }));
  console.log(
    'seeds',
    seeds.map((s) => s.text).join(',')
  );

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(120000);

  await boot(page);
  await openId(page, 'V04');

  const snapped = await page.evaluate((seedsIn) => {
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
    const _wp = new THREE.Vector3();

    function hitAt(u, v) {
      raycaster.setFromCamera(new THREE.Vector2(u * 2 - 1, -(v * 2 - 1)), cam);
      return raycaster.intersectObjects(meshes, true)[0] || null;
    }

    /** 在目标 y 附近找左缘最前点 */
    function snapToEdge(targetY, preferZ) {
      let best = null;
      // 先估 v：用包围盒粗映射不够稳，改为稀疏扫
      for (let v = 0.14; v <= 0.8; v += 0.01) {
        for (let u = 0.24; u <= 0.52; u += 0.006) {
          const hit = hitAt(u, v);
          if (!hit) continue;
          _lp.copy(hit.point);
          root.worldToLocal(_lp);
          if (_lp.z < 0.035) continue;
          const dy = Math.abs(_lp.y - targetY);
          if (dy > 0.014) continue;
          const score =
            -u * 3 + _lp.z * 1.4 - dy * 50 + (preferZ != null ? -Math.abs(_lp.z - preferZ) * 2.5 : 0);
          if (!best || score > best.score) {
            best = { u, v, hit, x: _lp.x, y: _lp.y, z: _lp.z, score };
          }
        }
      }
      return best;
    }

    function localNormal(hit) {
      const n = hit.face.normal.clone();
      const nm = new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld);
      n.applyMatrix3(nm).normalize();
      const q = new THREE.Quaternion();
      root.getWorldQuaternion(q);
      n.applyQuaternion(q.clone().invert()).normalize();
      return n;
    }

    const order = ['1', '2', '3', '4', '5', '6', 'A', 'B', 'C', 'D', 'E'];
    const byText = Object.fromEntries(seedsIn.map((s) => [s.text, s]));
    const annos = [];
    for (const t of order) {
      const seed = byText[t];
      if (!seed) continue;
      const s = snapToEdge(seed.y, seed.z);
      if (!s) continue;
      _lp.copy(s.hit.point);
      root.worldToLocal(_lp);
      const nLocal = localNormal(s.hit);
      const isConcave = /^[A-E]$/.test(t);
      annos.push({
        id: 'anno_v04_' + t,
        annotationKind: 'leader',
        text: t,
        detailText: '',
        collapsed: false,
        color: seed.color || (isConcave ? '#e3e3e3' : '#00e8e8'),
        dx: seed.dx,
        dy: seed.dy,
        dxN: seed.dx * 0.0007,
        dyN: seed.dy * 0.0007,
        dxW: seed.dx * 0.0025,
        dyW: seed.dy * 0.0025,
        localPos: [+_lp.x.toFixed(4), +_lp.y.toFixed(4), +_lp.z.toFixed(4)],
        localNormal: [+nLocal.x.toFixed(3), +nLocal.y.toFixed(3), +nLocal.z.toFixed(3)],
        baseDist: +cam.position.distanceTo(s.hit.point).toFixed(4),
        baseScale: 5.8,
        labelShape: 'circle',
        occludeDot: -0.35,
        _dbg: { t, u: +s.u.toFixed(3), v: +s.v.toFixed(3), y: +_lp.y.toFixed(4), z: +_lp.z.toFixed(4), seedY: seed.y }
      });
    }
    return { ok: annos.length, dbg: annos.map((a) => a._dbg), annos };
  }, seeds);

  console.log('snapped', snapped.ok);
  console.log(JSON.stringify(snapped.dbg, null, 2));
  fs.writeFileSync(path.join(outDir, 'pick.json'), JSON.stringify(snapped, null, 2));
  if (snapped.ok < 10) throw new Error('too few ' + snapped.ok);

  const file = load('104_');
  file.data.items[0].annotations = snapped.annos.map(({ _dbg, ...rest }) => rest);
  // keep existing camera/light/meta from seed
  if (!file.data.meta.keyPoints || file.data.meta.keyPoints.includes('首发待制作')) {
    file.data.meta.keyPoints = s103.data.meta.keyPoints
      .replace(/大半侧介于「侧前」与「全侧面」之间[^\n]*/, '全侧面是认识「侧面像」最干净的视角：头转到正侧，外轮廓几乎合成一条立起的剪影线。')
      .replace(/本关只看外轮廓：盯画面左缘这条「立起来的脸侧剪影」；与侧前相比，鼻额颏更像一条线，颧颊起伏退居次要。/, '本关只看外轮廓：盯画面左缘这一条额—鼻—唇—颏怎么起伏；侧面像往往就靠这条线说话。')
      .replace(/沿用大半侧[^\n]*/, '') ;
  }
  // ensure keyPoints mentions defer cranial
  if (!(file.data.meta.keyPoints || '').includes('颅顶结节')) {
    file.data.meta.keyPoints += '\n（备忘：颅顶结节、枕骨等非脸部点位，等脸部主线做完后再补。）\n';
  }
  file.data.meta.detail =
    '全侧面·外轮廓。正侧面平视；柔光；点位种子来自 103 手调，贴全侧剪影；颅顶/枕骨延后补；不连虚线。';
  file.data.meta.status = 'wip';
  fs.writeFileSync(file.full, JSON.stringify(file.data) + '\n');
  console.log('merged', rebuildAggregate());

  await boot(page);
  await openId(page, 'V04');
  await page.evaluate(() => {
    window.showAnnotations = true;
  });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(outDir, 'V04-annotated.png'), timeout: 45000 });
  console.log('OUT', outDir);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
