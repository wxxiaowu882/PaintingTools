/**
 * 仅负责：打开档案 → 逐点点击聚焦 → 出图给 AI 视觉核查
 * 不自动改坐标。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const port = process.env.PORT ? Number(process.env.PORT) : 18080;
const base = process.env.BASE_URL || `http://127.0.0.1:${port}`;
const OUT_JSON = path.join(repoRoot, 'docs', 'json', '结构_头骨骨点肌肉', '03 肌肉详解_黄种人女V8.json');

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(__dirname, '..', 'runs', `${stamp}-vision-audit`);

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const data = JSON.parse(fs.readFileSync(OUT_JSON, 'utf8'));
  const names = data.pointsData.map((p) => ({ id: p.id, text: p.text }));

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${base}/${encodeURI('自用工具文件_不部署/模型标注生产工具.html')}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForSelector('#file-input', { state: 'attached' });
  await page.setInputFiles('#file-input', OUT_JSON);
  await page.waitForFunction(
    () => /23/.test((document.getElementById('point-count') || {}).innerText || ''),
    null,
    { timeout: 120000 }
  );
  await page.waitForTimeout(2800);

  // 半透明面板，模型更清楚
  await page.evaluate(() => {
    ['snapshot-panel', 'console-panel', 'debug-log-panel'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.opacity = '0.3';
    });
  });

  // 总览
  await page.evaluate(() => {
    const v = document.querySelector('#workbench-viewer');
    v.setAttribute('camera-orbit', '0deg 90deg auto');
    v.setAttribute('camera-target', '0m 0.2m 0.08m');
    v.setAttribute('field-of-view', '28deg');
  });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(outDir, '00-front.png'), fullPage: true });

  await page.evaluate(() => {
    const v = document.querySelector('#workbench-viewer');
    v.setAttribute('camera-orbit', '-55deg 90deg auto');
  });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(outDir, '00-oblique.png'), fullPage: true });

  const manifest = [];
  for (let i = 0; i < names.length; i++) {
    const { id, text } = names[i];
    const clicked = await page.evaluate((t) => {
      const inp = [...document.querySelectorAll('#points-list .point-text-input')].find(
        (el) => el.value === t
      );
      if (!inp) return false;
      inp.parentElement.querySelector('.point-name')?.click();
      return true;
    }, text);
    await page.waitForTimeout(850);
    const safe = `${String(i + 1).padStart(2, '0')}-id${id}-${text.replace(/[^\w\u4e00-\u9fff]+/g, '_')}`;
    const shot = path.join(outDir, `${safe}.png`);
    await page.screenshot({ path: shot, fullPage: true });
    manifest.push({ i: i + 1, id, text, clicked, shot: path.relative(repoRoot, shot) });
  }

  fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify({ outDir: path.relative(repoRoot, outDir), manifest }, null, 2), 'utf8');
  await browser.close();
  console.log(JSON.stringify({ ok: true, count: manifest.length, outDir: path.relative(repoRoot, outDir) }, null, 2));
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
