/**
 * 106b：略俯修正——俯角收一点；标注种子迁自 102 手调局部点（避耳）
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-headform-106b`);
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:18080';
fs.mkdirSync(outDir, { recursive: true });

function loadFile(prefix) {
  const f = fs.readdirSync(jsonDir).find((n) => n.startsWith(prefix) && n.endsWith('.json'));
  const full = path.join(jsonDir, f);
  return { f, full, data: JSON.parse(fs.readFileSync(full, 'utf8')) };
}

function rebuildAggregate() {
  const files = fs
    .readdirSync(jsonDir)
    .filter((fn) => /^\d+[A-Za-z]?_.+\.json$/i.test(fn))
    .sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));
  const merged = files.map((fn) => JSON.parse(fs.readFileSync(path.join(jsonDir, fn), 'utf8')));
  fs.writeFileSync(path.join(jsonDir, '沙盒_头部造型规律.json'), JSON.stringify(merged) + '\n');
  return merged.length;
}

function patch106() {
  const src102 = loadFile('102_');
  const dst = loadFile('106_');
  const byText = {};
  for (const a of src102.data.items[0].annotations || []) {
    byText[a.text] = a;
  }
  // 迁 102 局部点；略俯下标签往左拉开
  const layout = {
    '1': { dx: -92, dy: -36 },
    '2': { dx: -108, dy: -12 },
    '3': { dx: -114, dy: 6 },
    '4': { dx: -110, dy: 24 },
    '5': { dx: -96, dy: 46 },
    A: { dx: -70, dy: 34 }
  };
  const order = ['1', '2', '3', '4', '5', 'A'];
  const annotations = [];
  for (const t of order) {
    const src = byText[t];
    if (!src) continue;
    const L = layout[t] || { dx: -90, dy: 0 };
    annotations.push({
      ...JSON.parse(JSON.stringify(src)),
      id: 'anno_v06_' + t,
      text: t,
      color: t === 'A' ? '#d6d6d6' : '#00e8e8',
      dx: L.dx,
      dy: L.dy,
      dxN: 0,
      dyN: 0,
      dxW: 0,
      dyW: 0,
      labelShape: 'circle',
      occludeDot: -0.35
    });
  }

  dst.data.camera = {
    pos: [0.05, 2.35, 4.45],
    target: [0.0, 0.88, 0.02],
    zoom: 0.56,
    fov: 16
  };
  dst.data.light = {
    type: 'point',
    azimuth: 90,
    elevation: 26,
    distance: 16,
    temp: 34,
    size: 24,
    intensity: 2.0
  };
  dst.data.crop = {
    display: 'block',
    left: '500px',
    top: '110px',
    width: '720px',
    height: '720px'
  };
  dst.data.items[0].annotations = annotations;
  dst.data.items[0].dashedLines = [];
  dst.data.meta = {
    line: 'viewpoint',
    slot: 'V06',
    status: 'wip',
    detail:
      '略俯·外轮廓。正面略抬高机位（约 20°）；柔正前光；标注种子迁自 102 手调局部点；对照平视正面：头顶变大、下颌变厚；不连虚线。',
    keyPoints: [
      '略俯是眼平再抬高一点：不是顶视，但头顶会显得更大，下颌外缘也会显得更厚。请与「正面 · 外轮廓」对照——同一颗头，只换俯角，外轮廓比例就变。如果您不小心转动了视角，请点击重置按钮恢复视角。',
      '本关只看外轮廓：盯画面左缘这条起伏；重点感受「顶变大、颌变厚」，不要当成明暗课。',
      '请看场景中的标注，1–5 是轮廓上的凸起，A 是本视角下较重要的凹陷（不凑数）。',
      '实际中每个人凹凸强弱不同，创作时先有这些点位的框架，再按个体强化、弱化或省略。',
      '',
      '点位名称如下：',
      '1.颅顶结节',
      '2.颅侧结节',
      '3.颧骨弓隆起',
      '4.颊转角（下颌外缘变厚感）',
      '5.颏结节',
      'A.角前切迹（咬肌前切迹）'
    ].join('\n')
  };
  fs.writeFileSync(dst.full, JSON.stringify(dst.data) + '\n');
  console.log('patched', dst.f, 'annos', annotations.map((a) => a.text).join(','));
  return rebuildAggregate();
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

async function openV06(page) {
  await page.evaluate(() => {
    const m = document.getElementById('scene-grid-modal');
    if (m) m.style.display = 'none';
    let i = (window.customScenes || []).findIndex((s) => s && s.id === 'V06');
    if (i < 0) i = (window.customScenes || []).findIndex((s) => s && String(s.name || '').includes('略俯'));
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
  await page.waitForTimeout(1500);
}

async function main() {
  console.log('agg', patch106());
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(120000);
  await boot(page);
  await openV06(page);
  await page.screenshot({ path: path.join(outDir, 'V06-annotated-full.png') });
  const box = await page.evaluate(() => {
    const el = document.getElementById('crop-box');
    if (!el || el.style.display === 'none') return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  if (box && box.width > 40) {
    await page.screenshot({
      path: path.join(outDir, 'V06-annotated.png'),
      clip: {
        x: Math.max(0, box.x),
        y: Math.max(0, box.y),
        width: Math.min(box.width, 1280),
        height: Math.min(box.height, 800)
      }
    });
  }
  console.log('OUT', outDir);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
