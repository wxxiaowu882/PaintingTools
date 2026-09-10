/**
 * 隐藏标注，拍解剖净图（供 AI 估 uv）。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const base = process.env.BASE_URL || 'http://127.0.0.1:18080';
const jsonPath = path.join(repoRoot, 'docs', 'json', '结构_五官', '05 五官综合讲解.json');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(__dirname, '..', 'runs', `${stamp}-facial-composite-clean-views`);

const VIEWS = [
  { name: 'eye_r', orbit: '-22deg 88deg auto', target: '-0.032m 0.162m 0.068m', fov: 9 },
  { name: 'eye_r_tight', orbit: '-18deg 90deg auto', target: '-0.030m 0.160m 0.070m', fov: 7 },
  { name: 'brow_r', orbit: '-18deg 75deg auto', target: '-0.030m 0.185m 0.068m', fov: 10 },
  { name: 'nose', orbit: '0deg 95deg auto', target: '0m 0.155m 0.08m', fov: 12 },
  { name: 'nose_up', orbit: '0deg 128deg auto', target: '0m 0.142m 0.07m', fov: 11 },
  { name: 'mouth', orbit: '0deg 100deg auto', target: '0m 0.130m 0.075m', fov: 10 },
  { name: 'ear_r', orbit: '90deg 90deg auto', target: '0.062m 0.160m 0.01m', fov: 14 },
  { name: 'front', orbit: '0deg 90deg auto', target: '0m 0.155m 0.05m', fov: 22 },
];

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`${base}/${encodeURI('自用工具文件_不部署/模型标注生产工具.html')}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForSelector('#file-input', { state: 'attached' });
  await page.setInputFiles('#file-input', jsonPath);
  await page.waitForFunction(() => {
    const el = document.getElementById('point-count');
    return el && /52/.test(el.innerText || '');
  }, null, { timeout: 180000 });
  await page.waitForTimeout(1000);

  await page.evaluate(() => {
    ['snapshot-panel', 'console-panel', 'debug-log-panel', 'info-display'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.visibility = 'hidden';
    });
    const frame = document.getElementById('anno-mobile-frame-overlay');
    if (frame) frame.hidden = true;
    // hide all hotspot annotations
    document.querySelectorAll('.HotspotAnnotation, .annotation, button[slot="hotspot"]').forEach((el) => {
      el.style.visibility = 'hidden';
      el.style.display = 'none';
    });
    // also try opacity via list toggles
    document.querySelectorAll('#points-list .point-item').forEach((row) => {
      const btn = row.querySelector('button, .visibility, [class*="eye"]');
      // leave; CSS hide above is enough
    });
  });

  for (const v of VIEWS) {
    await page.evaluate(({ orbit, target, fov }) => {
      const viewer = document.querySelector('#workbench-viewer');
      viewer.setAttribute('camera-target', target);
      viewer.setAttribute('camera-orbit', orbit);
      viewer.setAttribute('field-of-view', `${fov}deg`);
    }, v);
    await page.waitForTimeout(450);
    // re-hide hotspots after camera change (model-viewer may recreate)
    await page.evaluate(() => {
      document.querySelectorAll('[slot^="hotspot"], .HotspotAnnotation').forEach((el) => {
        el.style.visibility = 'hidden';
        el.style.opacity = '0';
      });
    });
    const p = path.join(outDir, `clean_${v.name}.png`);
    await page.locator('#workbench-viewer').screenshot({ path: p });
    console.log('SHOT', p);
  }
  console.log(JSON.stringify({ ok: true, outDir }, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
