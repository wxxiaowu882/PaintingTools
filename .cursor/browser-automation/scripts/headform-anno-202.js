/**
 * 202：从手调 201 迁模型/相机/结构点；光更侧更高做伦勃朗（鼻侧交界接主交界、暗颊三角亮）
 * 截图验收后写回缩略图
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const runsRoot = path.resolve(__dirname, '..', 'runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(runsRoot, `${stamp}-headform-202`);
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

async function forceRaster(page) {
  await page.evaluate(() => {
    try {
      if (typeof window.stopRender === 'function') window.stopRender();
    } catch (e) {}
    window._solidUserStoppedRender = true;
    window.useAdvancedRender = false;
    window.perfTestDone = true;
    window.isTestingPerformance = false;
    window.isLoadingScene = false;
    const el = document.getElementById('scene-loader');
    if (el) {
      el.style.display = 'none';
      el.style.opacity = '0';
    }
  });
}

async function waitMeshes(page, min = 1) {
  for (let i = 0; i < 150; i++) {
    const n = await page.evaluate(() => {
      let c = 0;
      try {
        const g = window.__solidHost && window.__solidHost.getSceneGroup && window.__solidHost.getSceneGroup();
        if (!g) return 0;
        g.traverse((o) => {
          if (o.isMesh) c++;
        });
      } catch (e) {}
      return c;
    });
    if (n >= min) return n;
    await page.waitForTimeout(400);
  }
  return 0;
}

const DETAIL = '侧前更高：鼻侧交界接到颊侧大交界，暗颊上留出一块三角亮。';

const KEY_POINTS =
  '本关只看光：比上一关「环形」更侧、更高时，明暗交界怎么走。如果您不小心转动了视角，请点击重置按钮恢复视角。\n' +
  '先看表象：头一侧亮、一侧大片暗；鼻旁的影已经接到颊上的大暗——暗颊上常会留下一块三角亮。这就是古典肖像里很常见的「伦勃朗」档。若还没接到，就更接近上一关「环形」。\n' +
  '明暗交界线的形状从哪来？主交界线仍沿着结构点（或线）串起来：颞线→眉峰→眶外角→颧突隆→口轮匝肌侧缘→颏结节。眼部另有两小段交界；鼻侧交界 C 在本关已接到主交界。交界线的出现是因为有结构的变化；看见三角亮与「接到」，也能反推鼻与颊的起伏关系。\n\n' +
  '点位(或线位)名称如下：\n\n' +
  '主交界线：\n1.颞线\n2.眉峰\n3.眶外角\n4.颧突隆\n5.口轮匝肌侧缘\n6.颏结节\n\n' +
  '支线1（眼）：\nA.上眼睑交界\nB.下眼睑上交界\n\n' +
  '支线2（鼻）：\nC.鼻侧交界（已接主交界）';

(async () => {
  const src = loadPref('201_');
  const dst = loadPref('202_');

  const d = JSON.parse(JSON.stringify(src.data));
  d.id = 'L02';
  d.name = '【光位】侧前更高 · 伦勃朗三角（Rembrandt）';
  // 保留 201 手调取景
  d.camera = {
    pos: [...(src.data.camera.pos || [0.26, 1.2, 6.17])],
    target: [...(src.data.camera.target || [0, 0.82, 0.04])],
    zoom: src.data.camera.zoom || 0.58,
    fov: src.data.camera.fov || 14
  };
  // 比 Loop(az58/el30) 更侧更高 → 鼻影接颊影
  d.light = {
    type: 'point',
    azimuth: 40,
    elevation: 44,
    distance: 15,
    temp: 34,
    size: 10,
    intensity: 2.2
  };
  d.env = Object.assign({}, src.data.env || {}, {
    skyLightScale: 0.48,
    lightIndicatorEnabled: false,
    hasWall: false,
    defaultMat: 'origin'
  });
  d.crop = src.data.crop || {
    display: 'block',
    left: '450px',
    top: '90px',
    width: '760px',
    height: '760px'
  };
  const annos = (src.data.items[0].annotations || []).map((a) => {
    const copy = JSON.parse(JSON.stringify(a));
    copy.id = String(copy.id || 'anno').replace(/l01/gi, 'l02');
    if (!/^anno_l02/.test(copy.id)) copy.id = 'anno_l02_' + (copy.text || 'x');
    return copy;
  });
  d.items = [
    {
      type: 'glb',
      url: src.data.items[0].url,
      pos: [0, 0, 0],
      rot: [0, 0, 0],
      scale: [5.8, 5.8, 5.8],
      mat: 'origin',
      annotations: annos,
      dashedLines: []
    }
  ];
  d.groundAnnotations = [];
  d.groundNormArrows = [];
  d.groundPolygon3ds = [];
  d.groundColorSampleAnnotations = [];
  d.meta = {
    line: 'light',
    slot: 'L02',
    status: 'wip',
    detail: DETAIL,
    keyPoints: KEY_POINTS
  };
  d.thumbnail = src.data.thumbnail || d.thumbnail;

  fs.writeFileSync(dst.full, JSON.stringify(d) + '\n');
  console.log('seeded', dst.f, 'n=', rebuild(), 'light', d.light, 'annos', annos.length);

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  async function bootAndOpen(id) {
    await page.goto(`${baseUrl}/Solid.html?sandbox=headform&skipPerf=1&_=${Date.now()}`, {
      waitUntil: 'domcontentloaded',
      timeout: 120000
    });
    await page.waitForTimeout(2000);
    await page.evaluate(() => {
      window.useAdvancedRender = false;
      window.perfTestDone = true;
      window._solidUserStoppedRender = true;
      if (typeof window.stopRender === 'function') {
        try {
          window.stopRender();
        } catch (e) {}
      }
      if (window.loadJSONData) window.loadJSONData();
    });
    await page.waitForFunction(() => (window.customScenes || []).length > 0, null, { timeout: 120000 });
    await page.waitForFunction(() => !!(window.__solidHost && window.__solidHost.getCamera), null, {
      timeout: 120000
    });
    await page.evaluate((want) => {
      const m = document.getElementById('scene-grid-modal');
      if (m) m.style.display = 'none';
      const scenes = window.customScenes || [];
      let i = scenes.findIndex((s) => s && s.id === want);
      if (i < 0 && want === 'L01') {
        i = scenes.findIndex((s) => s && /环形|Loop/i.test(String(s.name || '')));
      }
      if (i < 0 && want === 'L02') {
        i = scenes.findIndex((s) => s && /伦勃朗|Rembrandt/i.test(String(s.name || '')));
      }
      if (i < 0) throw new Error('scene not found ' + want + ' n=' + scenes.length);
      window.currentSceneIndex = -1;
      window.switchScene(i);
    }, id);
    const n = await waitMeshes(page, 1);
    console.log('meshes', id, n);
    await page.waitForTimeout(2500);
    for (let k = 0; k < 6; k++) {
      await forceRaster(page);
      await page.waitForTimeout(400);
    }
    return n;
  }

  // 先拍 201 手调验收图
  let n = await bootAndOpen('L01');
  if (n < 1) throw new Error('L01 no mesh');
  await page.evaluate(() => {
    window.showAnnotations = true;
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(outDir, 'L01-handtuned-full.png') });
  const crop201 = await page.evaluate(() => {
    const s = (window.customScenes || []).find((x) => x && x.id === 'L01');
    const c = (s && s.crop) || {};
    return {
      x: parseFloat(c.left) || 450,
      y: parseFloat(c.top) || 90,
      width: Math.min(760, parseFloat(c.width) || 760),
      height: 720
    };
  });
  await page.screenshot({ path: path.join(outDir, 'L01-handtuned-crop.png'), clip: crop201 });

  // 再开 202
  n = await bootAndOpen('L02');
  if (n < 1) throw new Error('L02 no mesh');
  await page.evaluate(() => {
    window.showAnnotations = false;
  });
  await forceRaster(page);
  await page.waitForTimeout(600);
  const crop202 = await page.evaluate(() => {
    const s = (window.customScenes || []).find((x) => x && x.id === 'L02');
    const c = (s && s.crop) || {};
    return {
      x: parseFloat(c.left) || 450,
      y: parseFloat(c.top) || 90,
      width: Math.min(760, parseFloat(c.width) || 760),
      height: 720
    };
  });
  await page.screenshot({ path: path.join(outDir, 'L02-light-only.png'), clip: crop202 });
  await page.evaluate(() => {
    window.showAnnotations = true;
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(outDir, 'L02-annotated-full.png') });
  await page.screenshot({ path: path.join(outDir, 'L02-annotated-crop.png'), clip: crop202 });
  await page.evaluate(() => {
    window.showAnnotations = false;
  });
  await page.waitForTimeout(400);
  const thumb = await page.screenshot({
    type: 'jpeg',
    quality: 72,
    clip: { x: crop202.x + 20, y: crop202.y + 20, width: 700, height: 700 }
  });

  const f = loadPref('202_');
  f.data.thumbnail = 'data:image/jpeg;base64,' + thumb.toString('base64');
  fs.writeFileSync(f.full, JSON.stringify(f.data) + '\n');
  rebuild();

  console.log('OUT', outDir);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
