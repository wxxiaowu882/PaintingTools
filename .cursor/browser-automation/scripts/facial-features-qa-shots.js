/**
 * 五官标注验收：导入已写点位 JSON，亮标签截图。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const port = process.env.PORT ? Number(process.env.PORT) : 18080;
const base = process.env.BASE_URL || `http://127.0.0.1:${port}`;
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(__dirname, '..', 'runs', `${stamp}-facial-qa`);
const jsonDir = path.join(repoRoot, 'docs', 'json', '结构_五官');

const SCENES = [
  { file: '01 耳朵详解.json', key: 'ear', orbit: '20deg 90deg auto', fov: 26 },
  { file: '02 鼻子详解.json', key: 'nose', orbit: '0deg 90deg auto', fov: 28 },
  { file: '03 嘴巴详解.json', key: 'mouth', orbit: '0deg 95deg auto', fov: 26 },
  { file: '04 眼眉详解.json', key: 'eye', orbit: '15deg 85deg auto', fov: 26 },
];

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${base}/${encodeURI('自用工具文件_不部署/模型标注生产工具.html')}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForSelector('#file-input', { state: 'attached' });

  for (const scene of SCENES) {
    const jsonPath = path.join(jsonDir, scene.file);
    await page.evaluate(() => {
      const inp = document.querySelector('#file-input');
      if (inp) inp.value = '';
    });
    await page.setInputFiles('#file-input', jsonPath);
    await page.waitForFunction(
      () => {
        const t = (document.getElementById('point-count') || {}).innerText || '';
        const m = t.match(/(\d+)/);
        return m && Number(m[1]) > 0;
      },
      null,
      { timeout: 120000 }
    );
    await page.waitForTimeout(2800);

    await page.evaluate(({ orbit, fov }) => {
      ['snapshot-panel', 'console-panel', 'debug-log-panel', 'info-display'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.style.visibility = 'hidden';
      });
      const frame = document.getElementById('anno-mobile-frame-overlay');
      if (frame) frame.hidden = true;
      const v = document.querySelector('#workbench-viewer');
      v.setAttribute('camera-orbit', orbit);
      v.setAttribute('field-of-view', `${fov}deg`);
      v.querySelectorAll('.preview-hotspot').forEach((el) => el.classList.add('show-text'));
    }, { orbit: scene.orbit, fov: scene.fov });
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(outDir, `${scene.key}.png`) });
    console.log('qa', scene.key);
  }

  console.log('OUT', outDir);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
