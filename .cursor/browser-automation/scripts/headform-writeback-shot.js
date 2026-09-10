const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const runs = path.join(repoRoot, '.cursor', 'browser-automation', 'runs');

async function main() {
  const dirs = fs.readdirSync(runs).filter((d) => d.includes('headform-v8b')).sort();
  let pickFile = null;
  for (const d of dirs.reverse()) {
    const p = path.join(runs, d, 'V01-pick.json');
    if (fs.existsSync(p)) {
      pickFile = p;
      break;
    }
  }
  // also check any run that has good zygoma x<-0.07 from v8
  if (!pickFile) {
    const all = fs.readdirSync(runs).filter((d) => d.includes('headform-v8')).sort().reverse();
    for (const d of all) {
      const p = path.join(runs, d, 'V01-pick.json');
      if (!fs.existsSync(p)) continue;
      const pk = JSON.parse(fs.readFileSync(p, 'utf8'));
      const zyg = (pk.debug && pk.debug.placed || []).find((x) => x.text === '颧骨凸');
      if (zyg && zyg.x < -0.07) {
        pickFile = p;
        break;
      }
    }
  }
  if (!pickFile) throw new Error('no pick');
  const pick = JSON.parse(fs.readFileSync(pickFile, 'utf8'));
  console.log('using', pickFile);
  console.log('placed', pick.debug && pick.debug.placed);

  // ensure dashed has no kind:straight
  if (pick.dashedLines && pick.dashedLines[0]) {
    delete pick.dashedLines[0].kind;
    pick.dashedLines[0].text = '远端外轮廓';
    pick.dashedLines[0].detailText = '';
  }

  const f = fs.readdirSync(jsonDir).find((n) => n.startsWith('101_') && n.endsWith('.json'));
  const full = path.join(jsonDir, f);
  const data = JSON.parse(fs.readFileSync(full, 'utf8'));
  data.items[0].annotations = pick.annotations;
  data.items[0].dashedLines = pick.dashedLines;
  data.meta.status = 'wip';
  data.meta.detail =
    '样板关：侧前·远端外轮廓。四分之三取景；虚线贴左缘剪影；钉眉弓凸/颧骨凸。';
  data.meta.keyPoints = [
    '侧前（四分之三）是肖像里最常见的头向。',
    '本关只看外轮廓：盯画面左缘「远端」头模外缘怎么起伏。',
    '重点看眉弓凸、颧骨凸——远端轮廓上常见的两处外鼓；转折多落在骨点最外突处。',
    '近侧脸面信息多，但本关不拿近侧当主轮廓课。'
  ].join('\n');
  fs.writeFileSync(full, JSON.stringify(data, null, 2) + '\n');

  const files = fs
    .readdirSync(jsonDir)
    .filter((fn) => /^\d+_.+\.json$/i.test(fn))
    .sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));
  const merged = files.map((fn) => JSON.parse(fs.readFileSync(path.join(jsonDir, fn), 'utf8')));
  fs.writeFileSync(path.join(jsonDir, '沙盒_头部造型规律.json'), JSON.stringify(merged) + '\n');
  console.log('wrote', f, 'merged', merged.length);

  const outDir = path.dirname(pickFile);
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto('http://127.0.0.1:18080/Solid.html?sandbox=headform&_=' + Date.now(), {
    waitUntil: 'domcontentloaded',
    timeout: 90000
  });
  await page.waitForFunction(() => Array.isArray(window.customScenes) && window.customScenes.length > 0, null, {
    timeout: 90000
  });
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    const el = document.getElementById('scene-loader');
    if (el) el.style.display = 'none';
  });
  const idx = await page.evaluate(() => (window.customScenes || []).findIndex((s) => s && s.id === 'V01'));
  await page.evaluate((i) => {
    window.currentSceneIndex = -1;
    window.switchScene(i);
  }, idx);
  await page.waitForTimeout(2800);
  await page.evaluate(() => {
    window.showAnnotations = true;
    const el = document.getElementById('scene-loader');
    if (el) el.style.display = 'none';
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(outDir, 'V01-annotated.png'), timeout: 60000 });

  // also L01 shot
  const idxL = await page.evaluate(() => (window.customScenes || []).findIndex((s) => s && s.id === 'L01'));
  await page.evaluate((i) => {
    window.currentSceneIndex = -1;
    window.switchScene(i);
  }, idxL);
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    window.showAnnotations = true;
    const el = document.getElementById('scene-loader');
    if (el) el.style.display = 'none';
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(outDir, 'L01-annotated.png'), timeout: 60000 });
  console.log('OUT', outDir);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
