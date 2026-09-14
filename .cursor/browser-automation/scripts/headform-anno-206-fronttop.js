/**
 * 206 纠偏：偏前顶光 + 正脸视角（用户手调光/相机为准）
 * - 不用正顶光；比 203 蝴蝶光更高、更正（el≈76 vs 58）
 * - 主看正脸明暗交界；标注风格对齐 203（短交界虚线 + 圆标编号）
 * - 种子几何借 203 手调交界，再截图做 AI 视觉验收
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-headform-206-fronttop`);
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
    document.querySelectorAll('body *').forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      const t = (el.textContent || '').trim();
      if (/^(正在计算光影|首帧渲染中|光影探针|即将完成|已进入写生)/.test(t) && t.length < 50) hide(el);
    });
  });
}

async function bootOpenL06(page) {
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
    const i = window.customScenes.findIndex((s) => s && s.id === 'L06');
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
      } catch (e) {}
      return c;
    });
    if (n > 0) break;
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(1800);
  await scrubUI(page);
}

async function main() {
  const src203 = loadPref('203_');
  const dst = loadPref('206_');

  // 保留用户已手调的正前视角 + 偏前顶光（比 203 更高）
  const userCam = JSON.parse(JSON.stringify(dst.data.camera));
  const userLight = JSON.parse(JSON.stringify(dst.data.light));
  const userEnv = JSON.parse(JSON.stringify(dst.data.env || {}));
  const userCrop = JSON.parse(JSON.stringify(dst.data.crop || {}));

  // 若光仍接近正顶（el>=85），钳到偏前顶光
  if ((userLight.elevation || 0) >= 85) userLight.elevation = 76;
  if (userLight.azimuth == null) userLight.azimuth = 90;
  if (userLight.size == null) userLight.size = 10;
  if (userLight.intensity == null) userLight.intensity = 2.2;

  const keyPoints = [
    '本关只看光：正前更高的顶前光——比上一关「蝴蝶光」更顶、更正，但仍是偏前的顶光，不是正顶光。',
    '本场景主看正脸上的明暗交界：眉弓下、眶窝、鼻底蝶影、唇缘、颏唇沟、颏底一圈，以及颧颊一带。交界主要跟「光线和头的夹角」有关——请转动场景换角度看；请不要改光线参数，误改请点「重置」。',
    '',
    '和「蝴蝶光」比：结构起伏会被顶前光压得更清楚——眉弓下更暗、鼻底影更重、颏底翻进更明显；左右颊仍大体受光，但顶面与纵面的转换更醒目。',
    '标注方式对齐蝴蝶光关：用短曲线勾在看得见的明暗交界上，圆标只作各段编号。',
    '',
    '各段交界线名称如下：',
    '',
    '①.眉弓',
    '眶外角 → 眉峰 → 眉头 → 鼻根一侧',
    '',
    '②.下眼睑',
    '下眼睑上的交界线',
    '',
    '③.鼻底／侧交界',
    '鼻底面与鼻侧面的交界（蝶影的关键边缘；本关往往比蝴蝶光更重）',
    '',
    '④.上唇上缘与嘴角上缘',
    '',
    '⑤.颏唇沟上缘与降下唇肌侧面',
    '',
    '⑥.下巴下缘偏上一圈',
    '（颏前亮面翻进颏底暗部的那一圈交界）',
    '',
    '⑦.颧骨上',
    '',
    '⑧.脸颊上',
    '颊凹下缘：颧骨下方到嘴角附近的交界',
    '',
    '可点击操作面板上的眼睛图标隐藏标注，更干净地观察明暗交界线。'
  ].join('\n');

  const item0 = JSON.parse(JSON.stringify(src203.data.items[0]));
  // 清空旧颅顶三点；换用 203 交界标注
  dst.data.id = 'L06';
  dst.data.name = '【光位】正前更高 · 顶前交界';
  dst.data.camera = userCam;
  dst.data.light = userLight;
  dst.data.env = Object.assign({}, userEnv, {
    lightIndicatorEnabled: false,
    skyLightScale: userEnv.skyLightScale != null ? userEnv.skyLightScale : 0.35
  });
  dst.data.crop = Object.assign(
    {
      display: 'block',
      left: '420px',
      top: '70px',
      width: '760px',
      height: '760px'
    },
    userCrop
  );
  dst.data.items = [item0];
  dst.data.meta = {
    line: 'light',
    slot: 'L06',
    status: 'seeded',
    detail:
      '正前更高的顶前光（比蝴蝶光更顶更正，非正顶光）。正脸取景，短曲线标眉弓—眶—鼻底—唇颏—颧颊交界。',
    keyPoints,
    keyPointsRich: plainToRich(keyPoints)
  };

  // 改文件名
  const newName = '206_【光位】正前更高 · 顶前交界.json';
  const newFull = path.join(jsonDir, newName);
  fs.writeFileSync(newFull, JSON.stringify(dst.data) + '\n');
  if (dst.full !== newFull && fs.existsSync(dst.full)) fs.unlinkSync(dst.full);
  console.log('wrote', newName, 'cam', userCam, 'light', userLight);
  console.log('merged', rebuild());

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await bootOpenL06(page);
  await page.evaluate(() => {
    window.showAnnotations = false;
  });
  await scrubUI(page);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(outDir, 'L06-clean.png'), timeout: 45000 });
  await page.evaluate(() => {
    window.showAnnotations = true;
  });
  await scrubUI(page);
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(outDir, 'L06-annotated.png'), timeout: 45000 });
  console.log('OUT', outDir);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
