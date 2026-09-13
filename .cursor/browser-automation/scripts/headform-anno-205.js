/**
 * 205 / L05：正前光 · 头侧交界（知识库正面视点光照边际）
 *
 * 口径（壹·正面视点）：
 * - 正前光下「光照边际」≈ 外围轮廓经过处；研究交界线本身（非「柔亮少影」观感）
 * - 交界1（W）：颅顶结节→颅侧结节→颧骨弓隆起→颧突隆→颊转角→颏结节
 * - 交界2：颞线→眉峰→眶外角
 * ①② 应在发下头骨；⑤ 在下颌角前咬肌上（非下颌角）
 * 权威点位以 Create 手调 JSON 为准；本脚本仅作打底/重建参考
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-headform-205`);
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:18080';
fs.mkdirSync(outDir, { recursive: true });

const MODEL = '/docs/model/石膏头像_男中青年_大本 蝙蝠侠 布鲁斯韦恩_头像_opt.glb';

/** 102 W 为解剖锚；③④ 经视觉前移出耳后大暗，仍保持头侧身份（待 Create 手调微灰） */
const W_POINTS = [
  {
    id: '1',
    name: '颅顶结节',
    localPos: [-0.0436, 0.2924, 0.0155],
    localNormal: [-0.246, 0.961, 0.123],
    dx: 78,
    dy: -28
  },
  {
    id: '2',
    name: '颅侧结节',
    localPos: [-0.085, 0.2269, -0.0199],
    localNormal: [-0.899, -0.39, -0.201],
    dx: 88,
    dy: -8
  },
  {
    id: '3',
    name: '颧骨弓隆起',
    localPos: [-0.0633, 0.157, 0.0342],
    localNormal: [-0.956, 0.124, 0.266],
    dx: 92,
    dy: 6
  },
  {
    id: '4',
    name: '颊转角',
    localPos: [-0.0538, 0.1072, 0.0399],
    localNormal: [-0.842, -0.135, 0.523],
    dx: 86,
    dy: 18
  },
  {
    id: '5',
    name: '颏结节',
    localPos: [-0.0244, 0.0617, 0.0619],
    localNormal: [-0.711, -0.581, 0.397],
    dx: 70,
    dy: 36
  }
];

function loadFile(prefix) {
  const f = fs.readdirSync(jsonDir).find((n) => n.startsWith(prefix) && n.endsWith('.json'));
  if (!f) throw new Error('missing ' + prefix);
  const full = path.join(jsonDir, f);
  return { f, full, data: JSON.parse(fs.readFileSync(full, 'utf8')) };
}

function rebuildAggregate() {
  const files = fs
    .readdirSync(jsonDir)
    .filter((fn) => /^\d+[A-Za-z]?_.+\.json$/i.test(fn))
    .sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));
  fs.writeFileSync(
    path.join(jsonDir, '沙盒_头部造型规律.json'),
    JSON.stringify(files.map((fn) => JSON.parse(fs.readFileSync(path.join(jsonDir, fn), 'utf8')))) + '\n'
  );
  return files.length;
}

function plainToRich(text) {
  return text
    .split('\n')
    .map((line) => {
      const t = line.trim();
      if (/^[\d]+\./.test(t) || /^【/.test(t)) return '<strong>' + line + '</strong>';
      return line;
    })
    .join('<br>');
}

function bezSeg(id, a, b) {
  return {
    id,
    color: '#9a9a9a',
    kind: 'bezier',
    strokeWidth: 2.2,
    capR: 1,
    opacity: 0.78,
    points: [
      {
        pos: [...a.localPos],
        norm: [...a.localNormal],
        handleOut: [
          (b.localPos[0] - a.localPos[0]) * 0.22,
          (b.localPos[1] - a.localPos[1]) * 0.28,
          (b.localPos[2] - a.localPos[2]) * 0.14
        ]
      },
      {
        pos: [...b.localPos],
        norm: [...b.localNormal],
        handleIn: [
          (a.localPos[0] - b.localPos[0]) * 0.22,
          (a.localPos[1] - b.localPos[1]) * 0.28,
          (a.localPos[2] - b.localPos[2]) * 0.14
        ]
      }
    ]
  };
}

function buildAnnotations() {
  return W_POINTS.map((p) => ({
    id: 'anno_l05_' + p.id,
    annotationKind: 'leader',
    text: p.id,
    detailText: '',
    collapsed: false,
    color: '#bfbfbf',
    dx: p.dx,
    dy: p.dy,
    dxN: p.dx * 0.0007,
    dyN: p.dy * 0.0007,
    dxW: p.dx * 0.0025,
    dyW: p.dy * 0.0025,
    localPos: [...p.localPos],
    localNormal: [...p.localNormal],
    baseDist: 6.2,
    baseScale: 5.8,
    labelShape: 'circle',
    occludeDot: -0.35
  }));
}

function seed205(data) {
  data.id = 'L05';
  data.name = '【光位】正前光 · 头侧交界';
  // 左侧大半侧：正对 -x 侧 W；略开于全侧，避免当成脸侧剪影课
  data.camera = {
    pos: [-4.2, 0.82, 3.85],
    target: [0.0, 0.84, 0.02],
    zoom: 0.58,
    fov: 15
  };
  // 正前光（az90）；交界课不以「柔亮少影」命名
  data.light = {
    type: 'point',
    azimuth: 90,
    elevation: 20,
    distance: 16,
    temp: 34,
    size: 26,
    intensity: 2.0
  };
  data.env = {
    ...(data.env || {}),
    hasWall: false,
    defaultMat: 'origin',
    groundColor: '#bdb8b0',
    skyColor: '#0d0d0f',
    skyLightScale: 0.82,
    lightIndicatorEnabled: false,
    noInterModelShadow: false
  };
  data.crop = {
    display: 'block',
    left: '420px',
    top: '90px',
    width: '760px',
    height: '760px'
  };

  const annotations = buildAnnotations();
  const byId = {};
  annotations.forEach((a) => {
    byId[a.text.trim()] = a;
  });
  const dashedLines = [];
  for (let i = 1; i <= 4; i++) {
    dashedLines.push(bezSeg('dash_l05_' + i, byId[String(i)], byId[String(i + 1)]));
  }

  const keyPoints = [
    '本关只看光：正前光下，明暗交界会贴着头侧关键转折走——本场景研究的就是这条交界，而不是「看起来柔不柔、影多不多」。',
    '如果您不小心转动了视角，请点击重置按钮恢复视角。请不要在操作面板中改变光线相关的设置；若不小心改了，点「重置」即可。',
    '',
    '【交界1 · 头侧主线（W）】①颅顶结节（发下头骨）②颅侧结节（发下头骨）③颧骨弓隆起④颧突隆⑤颊转角（咬肌上、非下颌角）⑥颏结节',
    '【交界2 · 颞—眉—眶】⑦→⑧颞线（⑧眉峰）⑨眶外角',
    '',
    '（打底脚本；权威点位与文案以 Create 手调 JSON 为准。）'
  ].join('\n');

  data.items = [
    {
      type: 'glb',
      url: MODEL,
      pos: [0, 0, 0],
      rot: [0, 0, 0],
      scale: [5.8, 5.8, 5.8],
      mat: 'origin',
      annotations,
      dashedLines
    }
  ];
  data.meta = {
    line: 'light',
    slot: 'L05',
    status: 'seeded',
    detail:
      '正前光：头侧明暗交界。交界1 为颅顶—颅侧—颧弓—颧突—颊转—颏；交界2 为颞线→眉峰→眶外角。（打底参考；以手调为准。）',
    keyPoints,
    keyPointsRich: plainToRich(keyPoints)
  };
  return data;
}

async function scrubUI(page) {
  await page.evaluate(() => {
    try {
      if (typeof window.stopRender === 'function') window.stopRender();
    } catch (e) {}
    window.useAdvancedRender = false;
    window.perfTestDone = true;
    const hide = (el) => {
      if (!el) return;
      el.style.display = 'none';
      el.style.opacity = '0';
    };
    hide(document.getElementById('scene-loader'));
    document.querySelectorAll('body *').forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      const t = (el.textContent || '').trim();
      if (/^(正在计算光影|首帧渲染中|光影探针|已进入写生)/.test(t) && t.length < 50) hide(el);
    });
  });
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

async function openL05(page) {
  await page.evaluate(() => {
    const m = document.getElementById('scene-grid-modal');
    if (m) m.style.display = 'none';
    let i = (window.customScenes || []).findIndex((s) => s && s.id === 'L05');
    if (i < 0) i = (window.customScenes || []).findIndex((s) => s && String(s.name || '').includes('平光'));
    if (i < 0) throw new Error('L05 not found');
    window.currentSceneIndex = -1;
    window.switchScene(i);
  });
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
    window.showAnnotations = true;
  });
  await page.waitForTimeout(1800);
}

async function main() {
  const file = loadFile('205_');
  file.data = seed205(file.data);
  fs.writeFileSync(file.full, JSON.stringify(file.data) + '\n');
  console.log('seeded', file.f, file.data.camera, file.data.light);
  console.log(
    'W',
    file.data.items[0].annotations.map((a) => ({ t: a.text, pos: a.localPos }))
  );
  console.log('merged', rebuildAggregate());

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(120000);
  await boot(page);
  await openL05(page);
  for (let k = 0; k < 6; k++) {
    await scrubUI(page);
    await page.waitForTimeout(160);
  }
  await page.evaluate(() => {
    window.showAnnotations = false;
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outDir, 'L05-clean.png'), timeout: 45000 });
  await page.evaluate(() => {
    window.showAnnotations = true;
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(outDir, 'L05-annotated.png'), timeout: 45000 });
  console.log('OUT', outDir);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
