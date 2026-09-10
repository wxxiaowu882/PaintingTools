/**
 * 原版 vs V8 逐点聚焦对照截图，供视觉验收「是否贴在对应肌肉」。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const port = process.env.PORT ? Number(process.env.PORT) : 18080;
const base = process.env.BASE_URL || `http://127.0.0.1:${port}`;
const SRC_JSON = path.join(repoRoot, 'docs', 'json', '结构_头骨骨点肌肉', '03 肌肉详解.json');
const OUT_JSON = path.join(repoRoot, 'docs', 'json', '结构_头骨骨点肌肉', '03 肌肉详解_黄种人女V8.json');

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(__dirname, '..', 'runs', `${stamp}-dual-muscle-qa`);

async function loadAndShot(page, jsonPath, label, names) {
  await page.setInputFiles('#file-input', jsonPath);
  await page.waitForFunction(
    () => document.querySelectorAll('#points-list .point-text-input').length >= 23,
    null,
    { timeout: 180000 }
  );
  await page.waitForFunction(
    () => {
      const v = document.querySelector('#workbench-viewer');
      return v && v.loaded;
    },
    null,
    { timeout: 180000 }
  ).catch(() => {});
  await page.waitForTimeout(3500);
  await page.evaluate(() => {
    ['snapshot-panel', 'console-panel', 'debug-log-panel', 'info-display'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.visibility = 'hidden';
    });
  });

  // front overview
  await page.evaluate(() => {
    const v = document.querySelector('#workbench-viewer');
    v.setAttribute('camera-orbit', '0deg 90deg 0.75m');
    v.setAttribute('camera-target', '0m 0.22m 0.05m');
    v.setAttribute('field-of-view', '28deg');
  });
  await page.waitForTimeout(800);
  const viewer = page.locator('#workbench-viewer');
  await viewer.screenshot({ path: path.join(outDir, `${label}-00-front.png`) });

  for (const text of names) {
    await page.evaluate((t) => {
      const inp = [...document.querySelectorAll('#points-list .point-text-input')].find(
        (el) => el.value === t
      );
      inp?.parentElement.querySelector('.point-name')?.click();
    }, text);
    await page.waitForTimeout(700);
    const safe = text.replace(/[^\w\u4e00-\u9fff]+/g, '_');
    await viewer.screenshot({ path: path.join(outDir, `${label}-${safe}.png`) });
  }
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const src = JSON.parse(fs.readFileSync(SRC_JSON, 'utf8'));
  const names = src.pointsData.map((p) => p.text);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${base}/${encodeURI('自用工具文件_不部署/模型标注生产工具.html')}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForSelector('#file-input', { state: 'attached' });

  await loadAndShot(page, SRC_JSON, 'euro', names);
  await loadAndShot(page, OUT_JSON, 'v8', names);

  fs.writeFileSync(
    path.join(outDir, 'manifest.json'),
    JSON.stringify({ names, outDir: path.relative(repoRoot, outDir) }, null, 2)
  );
  await browser.close();
  console.log(JSON.stringify({ ok: true, count: names.length, outDir: path.relative(repoRoot, outDir) }, null, 2));
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
