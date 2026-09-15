/**
 * 诊断模型标注生产工具贝塞尔：加载五官综合 JSON，建线、选中、投面，截图。
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const PORT = process.env.PORT || '18080';
const ROOT = path.resolve(__dirname, '../../..');
const OUT = path.resolve(__dirname, '../runs');
const TOOL = `http://127.0.0.1:${PORT}/${encodeURI('自用工具文件_不部署/模型标注生产工具.html')}`;
const JSON_PATH = path.join(ROOT, 'docs/json/结构_五官/05 五官综合讲解.json');

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const logs = [];
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

  await page.goto(TOOL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#workbench-viewer', { timeout: 30000 });
  await page.waitForTimeout(800);

  // 探测 model-viewer 内部相机
  const camInfo = await page.evaluate(() => {
    const v = document.querySelector('#workbench-viewer');
    const keys = [];
    const syms = Object.getOwnPropertySymbols(v || {});
    const symNames = syms.map((s) => String(s));
    let hasGetCamera = typeof (v && v.getCamera) === 'function';
    let sceneHint = null;
    try {
      for (const s of syms) {
        const val = v[s];
        if (val && val.camera) { sceneHint = 'symbol.camera'; break; }
        if (val && val.threeRenderer) { sceneHint = 'symbol.threeRenderer'; break; }
      }
    } catch (e) { sceneHint = String(e); }
    return {
      hasViewer: !!v,
      hasGetCamera,
      symNames: symNames.slice(0, 20),
      sceneHint,
      hasBezier: !!window.BezierAnnotation,
      pluginIds: window.AnnotationPluginManager ? Object.keys(window.AnnotationPluginManager.plugins || {}) : []
    };
  });
  console.log('CAM_INFO', JSON.stringify(camInfo, null, 2));

  // 加载档案
  const input = page.locator('#file-input');
  await input.setInputFiles(JSON_PATH);
  await page.waitForTimeout(2500);

  const afterLoad = await page.evaluate(() => {
    const v = document.querySelector('#workbench-viewer');
    return {
      points: (window.pointsData || (typeof pointsData !== 'undefined' ? pointsData : null)) ? 'use_eval' : null,
      count: typeof pointsData !== 'undefined' ? pointsData.length : -1,
      types: typeof pointsData !== 'undefined' ? [...new Set(pointsData.map((p) => p.type))] : []
    };
  });
  // pointsData is page-scope let, need evaluate carefully
  const afterLoad2 = await page.evaluate(() => {
    try {
      return {
        count: pointsData.length,
        types: [...new Set(pointsData.map((p) => p.type))],
        hasBezierPlugin: !!(window.AnnotationPluginManager && window.AnnotationPluginManager.getPlugin('bezier')),
        modeOptions: [...document.querySelectorAll('#tool-mode-select option')].map((o) => o.value)
      };
    } catch (e) {
      return { err: String(e) };
    }
  });
  console.log('AFTER_LOAD', JSON.stringify(afterLoad2, null, 2));

  // 切到贝塞尔模式
  await page.selectOption('#tool-mode-select', 'bezier');
  await page.waitForTimeout(200);

  // 在模型中心附近 Alt+Shift 点两点
  const box = await page.locator('#workbench-viewer').boundingBox();
  const cx = box.x + box.width * 0.48;
  const cy = box.y + box.height * 0.42;

  async function altShiftClick(x, y) {
    await page.keyboard.down('Alt');
    await page.keyboard.down('Shift');
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.waitForTimeout(40);
    await page.mouse.up();
    await page.keyboard.up('Shift');
    await page.keyboard.up('Alt');
    await page.waitForTimeout(200);
  }

  await altShiftClick(cx - 40, cy);
  await altShiftClick(cx + 50, cy + 30);
  await page.waitForTimeout(500); // 等双 rAF + 选中回写

  const afterCreate = await page.evaluate(() => {
    const beziers = pointsData.filter((p) => p.type === 'bezier');
    const last = beziers[beziers.length - 1] || null;
    const svg = document.querySelector('#ink-overlay');
    const paths = svg ? [...svg.querySelectorAll('path')].map((p) => ({
      d: (p.getAttribute('d') || '').slice(0, 120),
      cls: p.getAttribute('class'),
      bezierId: p.getAttribute('data-bezier-id')
    })) : [];
    return {
      bezierCount: beziers.length,
      last: last && {
        id: last.id,
        dots: last.dots && last.dots.length,
        projected: last.projected,
        handles: last.dots && last.dots.map((d) => ({ in: d.handleIn, out: d.handleOut }))
      },
      selectedPointId: typeof selectedPointId !== 'undefined' ? selectedPointId : null,
      toast: (document.getElementById('anno-flash-toast') || {}).textContent || '',
      paths,
      projectBtn: (() => {
        const b = document.getElementById('bezier-project-btn');
        return b ? { text: b.textContent, disabled: b.disabled } : null;
      })()
    };
  });
  console.log('AFTER_CREATE', JSON.stringify(afterCreate, null, 2));

  await page.screenshot({ path: path.join(OUT, 'bezier-diag-create.png'), fullPage: false });

  // 尝试点选曲线
  if (afterCreate.last) {
    await page.evaluate((id) => {
      if (window.BezierAnnotation) window.BezierAnnotation.selectLine(id);
    }, afterCreate.last.id);
    await page.waitForTimeout(300);
  }

  const afterSelect = await page.evaluate(() => {
    const svg = document.querySelector('#ink-overlay');
    return {
      selectedPointId,
      anchors: svg ? svg.querySelectorAll('.bezier-anchor-hit').length : 0,
      handles: svg ? svg.querySelectorAll('.bezier-handle-hit').length : 0,
      projectBtn: (() => {
        const b = document.getElementById('bezier-project-btn');
        return b ? { text: b.textContent.trim(), disabled: b.disabled } : null;
      })(),
      pathSample: svg ? [...svg.querySelectorAll('path[data-bezier-id]')].map((p) => (p.getAttribute('d') || '').slice(0, 200)) : []
    };
  });
  console.log('AFTER_SELECT', JSON.stringify(afterSelect, null, 2));
  await page.screenshot({ path: path.join(OUT, 'bezier-diag-select.png'), fullPage: false });

  // 投到面
  const proj = await page.evaluate(() => {
    if (!window.BezierAnnotation) return { err: 'no plugin' };
    return window.BezierAnnotation.projectSelectedToSurface();
  });
  console.log('PROJECT', JSON.stringify(proj, null, 2));
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, 'bezier-diag-project.png'), fullPage: false });

  fs.writeFileSync(path.join(OUT, 'bezier-diag-log.json'), JSON.stringify({ camInfo, afterLoad2, afterCreate, afterSelect, proj, logs: logs.slice(-40) }, null, 2));
  await browser.close();
  console.log('DONE');
}

main().catch((e) => { console.error(e); process.exit(1); });
