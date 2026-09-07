/**
 * 五官标注：四场景多视角截图，供 AI 视觉定点。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const port = process.env.PORT ? Number(process.env.PORT) : 18080;
const base = process.env.BASE_URL || `http://127.0.0.1:${port}`;
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(__dirname, '..', 'runs', `${stamp}-facial-capture`);

const SCENES = [
  { key: 'ear', file: '01 耳朵详解.json' },
  { key: 'nose', file: '02 鼻子详解.json' },
  { key: 'mouth', file: '03 嘴巴详解.json' },
  { key: 'eye', file: '04 眼眉详解.json' },
];

const VIEWS = [
  { name: 'front', orbit: '0deg 90deg auto', fov: 28 },
  { name: 'oblique', orbit: '35deg 80deg auto', fov: 28 },
  { name: 'side', orbit: '90deg 90deg auto', fov: 28 },
  { name: 'bottom', orbit: '20deg 120deg auto', fov: 30 },
  { name: 'top', orbit: '20deg 55deg auto', fov: 30 },
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
  await page.waitForSelector('#workbench-viewer', { timeout: 20000 });

  for (const scene of SCENES) {
    const jsonPath = path.join(repoRoot, 'docs', 'json', '结构_五官', scene.file);
    await page.setInputFiles('#file-input', jsonPath);
    await page.waitForFunction(
      () => {
        const v = document.querySelector('#workbench-viewer');
        return v && v.getAttribute('src') && v.getAttribute('src').length > 5;
      },
      null,
      { timeout: 120000 }
    );
    await page.waitForTimeout(2500);

    await page.evaluate(() => {
      ['snapshot-panel', 'console-panel', 'debug-log-panel', 'info-display'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.style.visibility = 'hidden';
      });
    });

    // 重置到模型中心
    await page.evaluate(() => {
      const v = document.querySelector('#workbench-viewer');
      v.setAttribute('camera-target', 'auto auto auto');
      v.setAttribute('camera-orbit', '0deg 90deg auto');
      v.setAttribute('field-of-view', '28deg');
    });
    await page.waitForTimeout(800);

    const sceneDir = path.join(outDir, scene.key);
    fs.mkdirSync(sceneDir, { recursive: true });

    for (const view of VIEWS) {
      await page.evaluate(
        ({ orbit, fov }) => {
          const v = document.querySelector('#workbench-viewer');
          v.setAttribute('camera-orbit', orbit);
          v.setAttribute('field-of-view', `${fov}deg`);
        },
        { orbit: view.orbit, fov: view.fov }
      );
      await page.waitForTimeout(700);
      await page.screenshot({ path: path.join(sceneDir, `${view.name}.png`) });
    }

    // 记录模型包围信息粗略目标
    const info = await page.evaluate(() => {
      const v = document.querySelector('#workbench-viewer');
      return {
        src: v.getAttribute('src'),
        orbit: v.getAttribute('camera-orbit'),
        target: v.getAttribute('camera-target'),
        fov: v.getAttribute('field-of-view'),
      };
    });
    fs.writeFileSync(path.join(sceneDir, 'meta.json'), JSON.stringify({ scene, info }, null, 2));
    console.log('captured', scene.key);
  }

  console.log('OUT', outDir);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
