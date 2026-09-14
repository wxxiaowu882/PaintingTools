/**
 * 208 / L08 【光位】底光 · 显凹（打底）
 * - 光：近下方、略偏前底光（权威以用户手调为准，约 az90 / el−74）
 * - 交界短线种子借 206 正脸几何；文案按「底光显凹」改写
 * - 权威以 Create 手调为准（勿擅自把光抬到 −20）
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-headform-208-bottom`);
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

async function bootOpenL08(page) {
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
    const i = window.customScenes.findIndex((s) => s && s.id === 'L08');
    if (i < 0) throw new Error('L08 not found');
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
  await page.waitForTimeout(1200);
  // 强制按场景 JSON 重设光，并读回主光世界坐标
  const lightInfo = await page.evaluate(() => {
    if (typeof window.resetAll === 'function') window.resetAll();
    const host = window.__solidHost;
    let pos = null;
    try {
      const L = host.getMainLight && host.getMainLight();
      if (L) pos = { x: +L.position.x.toFixed(3), y: +L.position.y.toFixed(3), z: +L.position.z.toFixed(3) };
    } catch (e) {}
    // 兜底：从 scene 找主光
    if (!pos) {
      try {
        const sc = host.getScene && host.getScene();
        sc.traverse((o) => {
          if (!pos && o.isLight && o.type !== 'AmbientLight' && o.type !== 'HemisphereLight') {
            pos = { x: +o.position.x.toFixed(3), y: +o.position.y.toFixed(3), z: +o.position.z.toFixed(3), type: o.type };
          }
        });
      } catch (e) {}
    }
    const az = document.getElementById('azimuthVal')?.innerText;
    const el = document.getElementById('elevationVal')?.innerText;
    return { pos, az, el };
  });
  fs.writeFileSync(path.join(outDir, 'light-info.json'), JSON.stringify(lightInfo, null, 2));
  return lightInfo;
}

async function main() {
  const src206 = loadPref('206_');
  const dst = loadPref('208_');

  // 近下方略偏前底光（权威以 Create 手调为准；勿擅自抬到 −20）
  const light = {
    type: 'point',
    azimuth: 90,
    elevation: -74,
    distance: 14,
    temp: 34,
    size: 14,
    intensity: 2.9
  };
  // 正脸略俯：别纯仰视只看见颏底
  const camera = {
    pos: [-0.1, 1.05, 5.15],
    target: [0.02, 0.7, -0.02],
    zoom: 0.56,
    fov: 15
  };

  const keyPoints = [
    '本场景只看底光这一档光线下，脸上「凹处」怎么被照亮、明暗交界怎么走。交界主要跟「光线和头的夹角」有关，和我们观察的角度无关——你可以转动场景，换几个角度看这些交界。',
    '',
    '请不要改变当前光线的方向、高低等参数，因为这会影响本场景的教学观感。如有误改，点「重置」把光（和本场景默认状态）恢复即可。如果您不小心转动了视角，也请点击重置按钮恢复视角。',
    '',
    '先看表象：光线从近下方、略偏前打上来时，额顶、颧顶等「朝上」的面往往偏暗；眶窝、颊凹、鼻底、颏唇沟一类「凹进去」的地方，会相对更清楚——这就是书上说的「底光显凹」。本场景默认约仰角 −74°（比正下方死底光稍靠前），好让正脸上还能读到足够结构。',
    '',
    '本场景的标注用短曲线勾在模型上看得到的明暗交界线上；圆标只是给各段交界编号。交界出现，是因为有结构起伏；看见这些交界怎么拐，也能反推眶窝、颧颊、鼻底与口唇下巴的转折。',
    '',
    '各段交界线名称如下：',
    '',
    '①.眉弓下／眶窝上缘',
    '②.颧骨一带的交界',
    '③.鼻底的交界',
    '④.上唇白脊上方的交界',
    '⑤.下唇白脊交界',
    '⑥.下巴前缘／颏底翻进',
    '⑦.鼻唇沟',
    '',
    '可点击操作面板上的眼睛图标来隐藏标注，更干净地观察明暗交界线。'
  ].join('\n');

  const item0 = JSON.parse(JSON.stringify(src206.data.items[0]));
  dst.data.id = 'L08';
  dst.data.name = '【光位】底光 · 显凹';
  dst.data.camera = camera;
  dst.data.light = light;
  dst.data.env = Object.assign({}, JSON.parse(JSON.stringify(src206.data.env || {})), {
    lightIndicatorEnabled: true,
    skyLightScale: 0.34
  });
  dst.data.crop = JSON.parse(JSON.stringify(src206.data.crop || { display: 'none' }));
  dst.data.items = [item0];
  dst.data.thumbnail = src206.data.thumbnail || dst.data.thumbnail;
  dst.data.meta = {
    line: 'light',
    slot: 'L08',
    status: 'seed',
    detail: '近下方略偏前底光（约 az90 / el-74）。正脸取景，短曲线标眶窝、颧颊、鼻底、唇缘与颏底等显凹交界。',
    keyPoints,
    keyPointsRich: plainToRich(keyPoints)
  };
  fs.writeFileSync(dst.full, JSON.stringify(dst.data) + '\n');
  console.log('wrote', dst.f, 'merged', rebuild());

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const lightInfo = await bootOpenL08(page);
  console.log('lightInfo', lightInfo);
  if (!lightInfo.pos || lightInfo.pos.y >= 0) {
    console.warn('WARN: expected bottom light (y<0), got', lightInfo.pos);
  }

  await page.evaluate(() => {
    window.showAnnotations = false;
  });
  await scrubUI(page);
  await page.waitForTimeout(600);
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
