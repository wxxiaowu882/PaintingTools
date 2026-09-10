/**
 * 视觉抽检：模拟点击列表聚焦关键点位并截图
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const port = process.env.PORT ? Number(process.env.PORT) : 18080;
const base = process.env.BASE_URL || `http://127.0.0.1:${port}`;
const OUT_JSON = path.join(repoRoot, 'docs', 'json', '结构_头骨骨点肌肉', '03 肌肉详解_黄种人女V8.json');

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(__dirname, '..', 'runs', `${stamp}-visual-qa-v8`);

const CHECK = ['额肌', '颞肌', '口轮匝肌', '咬肌', '枕肌', '颧大肌', '提上唇肌', '降眉间肌'];

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageUrl = `${base}/${encodeURI('自用工具文件_不部署/模型标注生产工具.html')}`;
  await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#file-input', { state: 'attached', timeout: 15000 });
  await page.setInputFiles('#file-input', OUT_JSON);
  await page.waitForFunction(
    () => {
      const v = document.querySelector('#workbench-viewer');
      return v && (v.getAttribute('src') || '').includes('黄种人_女_V8') && /23/.test((document.getElementById('point-count') || {}).innerText || '');
    },
    null,
    { timeout: 120000 }
  );
  await page.waitForTimeout(2500);

  // 收起左右面板，便于看清模型
  await page.evaluate(() => {
    const L = document.getElementById('snapshot-panel');
    const R = document.getElementById('console-panel');
    if (L) L.style.opacity = '0.35';
    if (R) R.style.opacity = '0.35';
  });

  const results = [];
  for (const name of CHECK) {
    const clicked = await page.evaluate((text) => {
      const inputs = [...document.querySelectorAll('#points-list .point-text-input')];
      const inp = inputs.find((el) => el.value === text);
      if (!inp) return false;
      const nameEl = inp.parentElement.querySelector('.point-name');
      if (!nameEl) return false;
      nameEl.click();
      return true;
    }, name);
    await page.waitForTimeout(900);
    const safe = name.replace(/[^\w\u4e00-\u9fff]+/g, '_');
    const shot = path.join(outDir, `qa-${safe}.png`);
    await page.screenshot({ path: shot, fullPage: true });
    results.push({ name, clicked, shot: path.relative(repoRoot, shot) });
  }

  await page.evaluate(() => {
    const v = document.querySelector('#workbench-viewer');
    v.setAttribute('camera-orbit', '0deg 90deg auto');
    v.setAttribute('camera-target', '0m 0.22m 0.08m');
    v.setAttribute('field-of-view', '26deg');
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(outDir, 'qa-front-overview.png'), fullPage: true });

  await page.evaluate(() => {
    const v = document.querySelector('#workbench-viewer');
    v.setAttribute('camera-orbit', '-90deg 90deg auto');
  });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(outDir, 'qa-left-overview.png'), fullPage: true });

  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify({ ok: true, results }, null, 2), 'utf8');
  await browser.close();
  console.log(JSON.stringify({ ok: true, outDir: path.relative(repoRoot, outDir), results }, null, 2));
})().catch((e) => {
  console.error('FAIL', e);
  process.exitCode = 1;
});
