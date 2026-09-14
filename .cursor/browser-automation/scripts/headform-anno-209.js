/**
 * 209 / L09 【光位】侧背交界光（打底）
 * 钉子：明暗线停在侧面↔背面交界
 * - 光比 207 背面光更偏侧（约 az235）
 * - 点位/曲线种子迁自 207 手调侧背结构，文案改侧背三点口径
 * - 权威以 Create 手调为准
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-headform-209-sideback`);
const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:18080';
fs.mkdirSync(outDir, { recursive: true });

function loadPref(prefix) {
  const f = fs.readdirSync(jsonDir).find((n) => n.startsWith(prefix) && n.endsWith('.json'));
  if (!f) throw new Error('missing ' + prefix);
  const full = path.join(jsonDir, f);
  return { f, full, data: JSON.parse(fs.readFileSync(full, 'utf8')) };
}

function rebuild() {
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
      if (/^【/.test(t) || /^[①②③④⑤⑥⑦⑧⑨]+\./.test(t) || /^\d+\./.test(t)) {
        return '<strong>' + line + '</strong>';
      }
      return line;
    })
    .join('<br>');
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
  });
}

async function bootOpenL09(page) {
  await page.goto(`${baseUrl}/Solid.html?sandbox=headform&skipPerf=1&_=${Date.now()}`, {
    waitUntil: 'domcontentloaded',
    timeout: 90000
  });
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    window.useAdvancedRender = false;
    window.perfTestDone = true;
    if (window.loadJSONData) window.loadJSONData();
  });
  await page.waitForFunction(
    () => (window.customScenes || []).length > 0 && window.__solidHost && window.__solidHost.getCamera(),
    null,
    { timeout: 90000 }
  );
  await page.evaluate(() => {
    const m = document.getElementById('scene-grid-modal');
    if (m) m.style.display = 'none';
    const i = window.customScenes.findIndex((s) => s && s.id === 'L09');
    if (i < 0) throw new Error('L09 not found');
    window.currentSceneIndex = -1;
    window.switchScene(i);
  });
  for (let i = 0; i < 100; i++) {
    const st = await page.evaluate(() => {
      let meshes = 0;
      try {
        window.__solidHost.getSceneGroup().traverse((o) => {
          if (o.isMesh) meshes++;
        });
      } catch (e) {}
      return { meshes, loading: !!window.isLoadingScene };
    });
    if (st.meshes > 0 && !st.loading) break;
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    if (typeof window.resetAll === 'function') window.resetAll();
  });
  await page.waitForTimeout(500);
  return page.evaluate(() => ({
    az: document.getElementById('azimuthVal')?.innerText,
    el: document.getElementById('elevationVal')?.innerText
  }));
}

async function main() {
  const src207 = loadPref('207_');
  const dst = loadPref('209_');

  // 侧后光：介于右侧(180)与背面(270)之间；比 207(az275) 更偏侧
  const light = {
    type: 'point',
    azimuth: 235,
    elevation: 14,
    distance: 15,
    temp: 34,
    size: 8,
    intensity: 2.55
  };
  const camera = JSON.parse(JSON.stringify(src207.data.camera));

  const keyPoints = [
    '本场景只看侧背交界光这一档光线下，明暗交界怎么停在「侧面与背面」交界上。交界主要跟「光线和头的夹角」有关，和我们观察的角度无关——你可以转动场景，换几个角度看这些交界。',
    '',
    '请不要改变当前光线的方向、高低等参数，因为这会影响本场景的教学观感。如有误改，点「重置」把光（和本场景默认状态）恢复即可。如果您不小心转动了视角，也请点击重置按钮恢复视角。',
    '',
    '先看表象：光从侧后方打来时（比上一场景「背面光」更偏侧一点），亮暗分界往往贴着侧↔背那一圈走——上头过颅侧结节一带，往下经耳后／乳突，再落到枕下侧角、斜方肌外缘。对照「背面光 · 背侧交界」：那边更像背侧一条亮边；本场景要盯的是明暗线停在侧背结构交界上。',
    '',
    '本场景的标注用曲线勾在看得见的侧背交界上；圆标只是给各段编号。交界出现，是因为有结构起伏；看见交界怎么拐，也能反推颅侧、耳后与颈肩侧缘的转折。',
    '',
    '各段交界线名称如下：',
    '',
    '①.颅顶结节',
    '②.颅侧结节',
    '③.耳朵（耳后过渡）',
    '④.颞骨乳突',
    '⑤.斜方肌外缘／枕下侧角一带',
    '',
    '可点击操作面板上的眼睛图标来隐藏标注，更干净地观察明暗交界线。'
  ].join('\n');

  const item0 = JSON.parse(JSON.stringify(src207.data.items[0]));
  // 保留 207 主线 1–5；去掉补充 A/B（颌后沟／下颌亮面属背面光补充课）
  item0.annotations = (item0.annotations || []).filter((a) => /^[1-5]$/.test(String(a.text)));
  // 虚线：只留能串 1–5 的（去掉明显只服务 A/B 的短线较难判断，先整表保留再靠手调）
  // 若虚线过多，Create 手调时再删；种子以可读为准

  dst.data.id = 'L09';
  dst.data.name = '【光位】侧背交界光';
  dst.data.camera = camera;
  dst.data.light = light;
  dst.data.env = Object.assign({}, JSON.parse(JSON.stringify(src207.data.env || {})), {
    lightIndicatorEnabled: true
  });
  dst.data.crop = JSON.parse(JSON.stringify(src207.data.crop || { display: 'none' }));
  dst.data.items = [item0];
  dst.data.thumbnail = src207.data.thumbnail || dst.data.thumbnail;
  dst.data.groundAnnotations = src207.data.groundAnnotations || [];
  dst.data.groundNormArrows = src207.data.groundNormArrows || [];
  dst.data.groundPolygon3ds = src207.data.groundPolygon3ds || [];
  dst.data.groundColorSampleAnnotations = src207.data.groundColorSampleAnnotations || [];
  dst.data.meta = {
    line: 'light',
    slot: 'L09',
    status: 'seed',
    detail:
      '侧后光（约 az235 / el14）。侧后取景；明暗停在侧↔背交界：颅顶/颅侧结节→耳后→乳突→斜方肌外缘／枕下侧角。',
    keyPoints,
    keyPointsRich: plainToRich(keyPoints)
  };

  fs.writeFileSync(dst.full, JSON.stringify(dst.data) + '\n');
  console.log('wrote', dst.f, 'annos', item0.annotations.length, 'dashes', (item0.dashedLines || []).length, 'merged', rebuild());

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const lightInfo = await bootOpenL09(page);
  console.log('lightInfo', lightInfo);

  await page.evaluate(() => {
    window.showAnnotations = false;
  });
  await scrubUI(page);
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(outDir, '01-clean.png'), timeout: 45000 });

  await page.evaluate(() => {
    window.showAnnotations = true;
  });
  await scrubUI(page);
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(outDir, '02-annos.png'), timeout: 45000 });

  console.log('OUT', outDir);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
