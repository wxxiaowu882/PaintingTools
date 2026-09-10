/**
 * 05 五官综合讲解（加速版）：少视角共享 bounds + 粗网格扫描。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const port = process.env.PORT ? Number(process.env.PORT) : 18080;
const base = process.env.BASE_URL || `http://127.0.0.1:${port}`;
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(__dirname, '..', 'runs', `${stamp}-facial-composite-annotate`);
const jsonPath = path.join(repoRoot, 'docs', 'json', '结构_五官', '05 五官综合讲解.json');
const MODEL = '../docs/model/石膏头像_女中青年_05_opt_石膏白.glb';

const COLORS = [
  '#E53935', '#1E88E5', '#43A047', '#FB8C00', '#8E24AA', '#00BCD4', '#FDD835', '#D81B60',
  '#3949AB', '#795548', '#FF5722', '#009688', '#673AB7', '#FF4081', '#84FFFF', '#AEEA00',
  '#FF6E40', '#1565C0', '#2E7D32', '#EF6C00', '#6A1B9A', '#00838F', '#F9A825', '#AD1457',
  '#283593', '#5D4037', '#D84315', '#00695C', '#4527A0', '#C2185B', '#0277BD', '#558B2F',
  '#FF8F00', '#7B1FA2', '#00ACC1', '#C0CA33', '#E91E63', '#3F51B5', '#8D6E63', '#FF7043',
  '#26A69A', '#7E57C2', '#EC407A', '#42A5F5', '#66BB6A', '#FFA726', '#AB47BC', '#26C6DA',
  '#FFEE58', '#F06292', '#5C6BC0', '#A1887F',
];

/** 共享视角：每组只算一次 bounds */
const VIEWS = {
  ear: { orbit: '90deg 90deg auto', fov: 12 },
  nose: { orbit: '0deg 88deg auto', fov: 13 },
  nose_up: { orbit: '0deg 125deg auto', fov: 13 },
  mouth: { orbit: '0deg 98deg auto', fov: 11 },
  eye: { orbit: '-16deg 86deg auto', fov: 10 },
  brow: { orbit: '-12deg 74deg auto', fov: 12 },
};

/**
 * u/v 相对该视角模型包围盒；眼眉标模型右眼（正视画面左侧）
 */
const POINTS = [
  // ear
  { text: '耳轮脚', view: 'ear', u: 0.42, v: 0.42, prefer: 'lat' },
  { text: '耳轮', view: 'ear', u: 0.58, v: 0.28, prefer: 'lat' },
  { text: '耳垂', view: 'ear', u: 0.52, v: 0.78, prefer: 'lat' },
  { text: '对耳轮', view: 'ear', u: 0.50, v: 0.48, prefer: 'lat' },
  { text: '对耳轮上脚', view: 'ear', u: 0.48, v: 0.30, prefer: 'lat' },
  { text: '对耳轮下脚', view: 'ear', u: 0.44, v: 0.38, prefer: 'lat' },
  { text: '耳屏', view: 'ear', u: 0.30, v: 0.52, prefer: 'lat' },
  { text: '对耳屏', view: 'ear', u: 0.46, v: 0.66, prefer: 'lat' },
  { text: '凹入缺口', view: 'ear', u: 0.36, v: 0.60, prefer: 'lat' },
  { text: '前缺口', view: 'ear', u: 0.32, v: 0.44, prefer: 'lat' },
  { text: '耳甲腔', view: 'ear', u: 0.40, v: 0.54, prefer: 'lat' },
  { text: '耳甲艇', view: 'ear', u: 0.42, v: 0.40, prefer: 'lat' },
  { text: '三角凹', view: 'ear', u: 0.48, v: 0.26, prefer: 'lat' },
  { text: '舟状凹', view: 'ear', u: 0.62, v: 0.38, prefer: 'lat' },
  { text: '耳廓结节', view: 'ear', u: 0.64, v: 0.32, prefer: 'lat' },
  // nose
  { text: '鼻根', view: 'nose', u: 0.50, v: 0.30, prefer: 'front' },
  { text: '鼻梁(鼻背)', view: 'nose', u: 0.50, v: 0.40, prefer: 'front' },
  { text: '鼻头', view: 'nose', u: 0.50, v: 0.52, prefer: 'front' },
  { text: '鼻翼', view: 'nose', u: 0.62, v: 0.54, prefer: 'front' },
  { text: '鼻唇沟起点', view: 'nose', u: 0.64, v: 0.58, prefer: 'front' },
  { text: '鼻底', view: 'nose_up', u: 0.50, v: 0.42, prefer: 'front' },
  { text: '鼻中隔', view: 'nose_up', u: 0.50, v: 0.50, prefer: 'front' },
  { text: '鼻翼脚', view: 'nose_up', u: 0.62, v: 0.52, prefer: 'front' },
  // mouth
  { text: '人中（沟）', view: 'mouth', u: 0.50, v: 0.42, prefer: 'front' },
  { text: '人中脊', view: 'mouth', u: 0.56, v: 0.42, prefer: 'front' },
  { text: '人中切迹', view: 'mouth', u: 0.50, v: 0.50, prefer: 'front' },
  { text: '唇峰', view: 'mouth', u: 0.58, v: 0.52, prefer: 'front' },
  { text: '唇珠', view: 'mouth', u: 0.50, v: 0.56, prefer: 'front' },
  { text: '翼状凹', view: 'mouth', u: 0.62, v: 0.56, prefer: 'front' },
  { text: '下唇圆形隆起', view: 'mouth', u: 0.60, v: 0.66, prefer: 'front' },
  { text: '沟状凹', view: 'mouth', u: 0.50, v: 0.62, prefer: 'front' },
  { text: '白脊（口唇外圈脊状隆起线）', view: 'mouth', u: 0.56, v: 0.51, prefer: 'front' },
  { text: '口角(窝)', view: 'mouth', u: 0.76, v: 0.58, prefer: 'front' },
  { text: '颏唇沟', view: 'mouth', u: 0.50, v: 0.74, prefer: 'front' },
  { text: '白脊（下唇）', view: 'mouth', u: 0.50, v: 0.68, prefer: 'front' },
  // brow / eye
  { text: '眉弓隆起', view: 'brow', u: 0.38, v: 0.32, prefer: 'front' },
  { text: '眉头', view: 'brow', u: 0.34, v: 0.34, prefer: 'front' },
  { text: '眉峰', view: 'brow', u: 0.44, v: 0.32, prefer: 'front' },
  { text: '眉毛最浓处', view: 'brow', u: 0.40, v: 0.34, prefer: 'front' },
  { text: '眼眶上缘+脂肪垫', view: 'brow', u: 0.40, v: 0.26, prefer: 'front' },
  { text: '睑眉沟', view: 'eye', u: 0.42, v: 0.34, prefer: 'front' },
  { text: '睑上沟', view: 'eye', u: 0.44, v: 0.40, prefer: 'front' },
  { text: '上眼睑', view: 'eye', u: 0.44, v: 0.44, prefer: 'front' },
  { text: '下眼睑', view: 'eye', u: 0.44, v: 0.54, prefer: 'front' },
  { text: '内眦', view: 'eye', u: 0.34, v: 0.48, prefer: 'front' },
  { text: '外眦', view: 'eye', u: 0.54, v: 0.48, prefer: 'front' },
  { text: '眼球', view: 'eye', u: 0.46, v: 0.48, prefer: 'front' },
  { text: '虹膜', view: 'eye', u: 0.45, v: 0.48, prefer: 'front' },
  { text: '角膜', view: 'eye', u: 0.46, v: 0.47, prefer: 'front' },
  { text: '巩白', view: 'eye', u: 0.40, v: 0.48, prefer: 'front' },
  { text: '卧蚕', view: 'eye', u: 0.44, v: 0.58, prefer: 'front' },
  { text: '睑下沟', view: 'eye', u: 0.44, v: 0.64, prefer: 'front' },
];

function makeSeed() {
  return {
    version: '1.6.5',
    timestamp: Date.now(),
    mainThumbnail: '',
    modelSrc: MODEL,
    settings: {
      defaultColor: '#1E88E5',
      defaultOpacity: '0.3',
      modelOpacity: '1',
      surfaceGloss: '0.3',
      ambient: '1.4',
      ambientTemp: '6500',
      ambientX: '40',
      ambientY: '25',
      spot: '2.8',
      spotTemp: '4800',
      spotX: '130',
      spotY: '40',
      shadowIntensity: '0.55',
      envRotOffset: 0,
      posterize: '0',
      grayscale: false,
    },
    camera: { orbit: '0deg 85deg auto', target: 'auto auto auto', fov: '26deg' },
    pointsData: [],
    snapshots: [],
  };
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const data = makeSeed();
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2) + '\n', 'utf8');

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(120000);
  await page.goto(`${base}/${encodeURI('自用工具文件_不部署/模型标注生产工具.html')}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForSelector('#file-input', { state: 'attached' });
  await page.waitForSelector('#workbench-viewer', { timeout: 20000 });
  await page.setInputFiles('#file-input', jsonPath);
  await page.waitForFunction(
    () => {
      const v = document.querySelector('#workbench-viewer');
      const s = v && v.getAttribute('src');
      return s && s.includes('石膏');
    },
    null,
    { timeout: 180000 }
  );
  // 等模型可射线
  for (let i = 0; i < 40; i++) {
    const ok = await page.evaluate(() => {
      const v = document.querySelector('#workbench-viewer');
      if (!v || !v.positionAndNormalFromPoint) return false;
      const r = v.getBoundingClientRect();
      return !!v.positionAndNormalFromPoint(r.left + r.width * 0.5, r.top + r.height * 0.4);
    });
    if (ok) break;
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(800);

  await page.evaluate(() => {
    ['snapshot-panel', 'console-panel', 'debug-log-panel', 'info-display'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.visibility = 'hidden';
    });
    const frame = document.getElementById('anno-mobile-frame-overlay');
    if (frame) frame.hidden = true;
  });

  const boundsByView = {};
  async function ensureBounds(viewKey) {
    if (boundsByView[viewKey]) return boundsByView[viewKey];
    const view = VIEWS[viewKey];
    await page.evaluate(
      ({ orbit, fov }) => {
        const v = document.querySelector('#workbench-viewer');
        v.setAttribute('camera-target', 'auto auto auto');
        v.setAttribute('camera-orbit', orbit);
        v.setAttribute('field-of-view', `${fov}deg`);
      },
      view
    );
    await page.waitForTimeout(400);
    const bounds = await page.evaluate(() => {
      const viewer = document.querySelector('#workbench-viewer');
      const rect = viewer.getBoundingClientRect();
      const step = 0.05;
      let minX = 1;
      let minY = 1;
      let maxX = 0;
      let maxY = 0;
      let any = false;
      for (let yy = 0.05; yy <= 0.95; yy += step) {
        for (let xx = 0.05; xx <= 0.95; xx += step) {
          if (viewer.positionAndNormalFromPoint(rect.left + rect.width * xx, rect.top + rect.height * yy)) {
            any = true;
            if (xx < minX) minX = xx;
            if (yy < minY) minY = yy;
            if (xx > maxX) maxX = xx;
            if (yy > maxY) maxY = yy;
          }
        }
      }
      return any ? { minX, minY, maxX, maxY } : null;
    });
    if (!bounds) throw new Error('no bounds for ' + viewKey);
    boundsByView[viewKey] = bounds;
    console.log('bounds', viewKey, bounds);
    return bounds;
  }

  // 预热全部视角
  for (const k of Object.keys(VIEWS)) await ensureBounds(k);

  const points = [];
  const misses = [];
  let nextId = 1;
  let lastView = null;

  for (const spec of POINTS) {
    if (spec.view !== lastView) {
      const view = VIEWS[spec.view];
      await page.evaluate(
        ({ orbit, fov }) => {
          const v = document.querySelector('#workbench-viewer');
          v.setAttribute('camera-orbit', orbit);
          v.setAttribute('field-of-view', `${fov}deg`);
        },
        view
      );
      await page.waitForTimeout(250);
      lastView = spec.view;
    }
    const bounds = boundsByView[spec.view];
    const hit = await page.evaluate(
      ({ u, v, bounds, prefer }) => {
        const viewer = document.querySelector('#workbench-viewer');
        const rect = viewer.getBoundingClientRect();
        const sx = bounds.minX + (bounds.maxX - bounds.minX) * u;
        const sy = bounds.minY + (bounds.maxY - bounds.minY) * v;
        const baseX = rect.left + rect.width * sx;
        const baseY = rect.top + rect.height * sy;
        const offsets = [[0, 0]];
        for (let r = 3; r <= 12; r += 3) {
          for (let a = 0; a < 8; a++) {
            const rad = (a / 8) * Math.PI * 2;
            offsets.push([Math.cos(rad) * r, Math.sin(rad) * r]);
          }
        }
        let best = null;
        for (const [ox, oy] of offsets) {
          const h = viewer.positionAndNormalFromPoint(baseX + ox, baseY + oy);
          if (!h) continue;
          let nx = h.normal.x;
          let ny = h.normal.y;
          let nz = h.normal.z;
          const len = Math.hypot(nx, ny, nz) || 1;
          nx /= len;
          ny /= len;
          nz /= len;
          const score = prefer === 'lat' ? Math.abs(h.position.x) * 2 + Math.abs(nx) : h.position.z * 3 + nz;
          if (!best || score > best.score) {
            best = {
              score,
              pos: `${h.position.x.toFixed(4)}m ${h.position.y.toFixed(4)}m ${h.position.z.toFixed(4)}m`,
              norm: `${nx.toFixed(4)}m ${ny.toFixed(4)}m ${nz.toFixed(4)}m`,
            };
          }
        }
        return best;
      },
      { u: spec.u, v: spec.v, bounds, prefer: spec.prefer || 'front' }
    );

    if (!hit || !hit.pos) {
      misses.push(spec.text);
      console.log('MISS', spec.text);
      continue;
    }
    const group = spec.view.startsWith('nose')
      ? 'nose'
      : spec.view === 'brow' || spec.view === 'eye'
        ? 'eye'
        : spec.view;
    points.push({
      id: nextId,
      type: 'point',
      slot: `hotspot-${nextId}`,
      pos: hit.pos,
      norm: hit.norm,
      text: spec.text,
      color: COLORS[(nextId - 1) % COLORS.length],
      hidden: false,
      showTextOnLoad: true,
      desc: '',
      customData: { group },
    });
    console.log('OK', nextId, spec.text);
    nextId += 1;
  }

  data.pointsData = points;
  data.timestamp = Date.now();
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log('WROTE', jsonPath, 'n=', points.length);

  // 注入并截 QA
  await page.evaluate((pts) => {
    if (typeof pointsData === 'undefined') return;
    pointsData.length = 0;
    pts.forEach((p) => pointsData.push(p));
    if (typeof pointIndex !== 'undefined') pointIndex = pts.length + 1;
    if (typeof renderState === 'function') renderState();
    if (typeof updateSVG === 'function') updateSVG();
  }, points);
  await page.waitForTimeout(1500);

  const qaViews = [
    { name: 'qa_front', orbit: '0deg 85deg auto', fov: 24 },
    { name: 'qa_eye', orbit: '-16deg 84deg auto', fov: 11 },
    { name: 'qa_nose', orbit: '0deg 90deg auto', fov: 12 },
    { name: 'qa_mouth', orbit: '0deg 100deg auto', fov: 11 },
    { name: 'qa_ear', orbit: '90deg 90deg auto', fov: 12 },
  ];
  for (const view of qaViews) {
    await page.evaluate(({ orbit, fov }) => {
      const v = document.querySelector('#workbench-viewer');
      v.setAttribute('camera-orbit', orbit);
      v.setAttribute('field-of-view', `${fov}deg`);
      v.querySelectorAll('.preview-hotspot').forEach((el) => el.classList.add('show-text'));
    }, view);
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(outDir, `${view.name}.png`) });
  }

  const report = { count: points.length, expected: POINTS.length, misses, outDir };
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log('DONE', JSON.stringify(report));
  await browser.close();
  if (misses.length || points.length !== POINTS.length) process.exitCode = 2;
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
