/**
 * 05 五官综合：石膏头像多视角截图，供 AI 视觉定点。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const port = process.env.PORT ? Number(process.env.PORT) : 18080;
const base = process.env.BASE_URL || `http://127.0.0.1:${port}`;
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(__dirname, '..', 'runs', `${stamp}-facial-composite-capture`);

const MODEL = '../docs/model/石膏头像_女中青年_05_opt_石膏白.glb';
const SEED = {
  version: '1.6.5',
  timestamp: Date.now(),
  mainThumbnail: '',
  modelSrc: MODEL,
  settings: {
    defaultColor: '#1E88E5',
    defaultOpacity: '0.35',
    modelOpacity: '1',
    surfaceGloss: '0.35',
    ambient: '1.2',
    ambientTemp: '6500',
    ambientX: '45',
    ambientY: '20',
    spot: '2.5',
    spotTemp: '5000',
    spotX: '135',
    spotY: '45',
    shadowIntensity: '0.6',
    envRotOffset: 0,
    posterize: '0',
    grayscale: false,
  },
  camera: {
    orbit: '0deg 85deg auto',
    target: 'auto auto auto',
    fov: '28deg',
  },
  pointsData: [],
  snapshots: [],
};

const VIEWS = [
  { name: 'front', orbit: '0deg 85deg auto', fov: 26 },
  { name: 'front_close', orbit: '0deg 88deg auto', fov: 18 },
  { name: 'oblique_r', orbit: '35deg 82deg auto', fov: 24 },
  { name: 'oblique_l', orbit: '-35deg 82deg auto', fov: 24 },
  { name: 'side_r', orbit: '80deg 90deg auto', fov: 24 },
  { name: 'side_l', orbit: '-80deg 90deg auto', fov: 24 },
  { name: 'bottom', orbit: '10deg 120deg auto', fov: 26 },
  { name: 'top', orbit: '10deg 55deg auto', fov: 28 },
  { name: 'eye_r_close', orbit: '18deg 82deg auto', fov: 12 },
  { name: 'mouth_close', orbit: '0deg 98deg auto', fov: 12 },
  { name: 'nose_close', orbit: '0deg 92deg auto', fov: 12 },
  { name: 'nose_bottom', orbit: '5deg 128deg auto', fov: 14 },
  { name: 'ear_r_close', orbit: '90deg 90deg auto', fov: 14 },
];

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const seedPath = path.join(outDir, '_seed.json');
  fs.writeFileSync(seedPath, JSON.stringify(SEED, null, 2));

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${base}/${encodeURI('自用工具文件_不部署/模型标注生产工具.html')}`, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForSelector('#file-input', { state: 'attached' });
  await page.waitForSelector('#workbench-viewer', { timeout: 20000 });

  await page.setInputFiles('#file-input', seedPath);
  await page.waitForFunction(
    () => {
      const v = document.querySelector('#workbench-viewer');
      return v && v.getAttribute('src') && v.getAttribute('src').length > 5;
    },
    null,
    { timeout: 180000 }
  );
  await page.waitForTimeout(3500);

  await page.evaluate(() => {
    ['snapshot-panel', 'console-panel', 'debug-log-panel', 'info-display'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.style.visibility = 'hidden';
    });
    const frame = document.getElementById('anno-mobile-frame-overlay');
    if (frame) frame.hidden = true;
  });

  for (const view of VIEWS) {
    await page.evaluate(
      ({ orbit, fov }) => {
        const v = document.querySelector('#workbench-viewer');
        v.setAttribute('camera-target', 'auto auto auto');
        v.setAttribute('camera-orbit', orbit);
        v.setAttribute('field-of-view', `${fov}deg`);
      },
      { orbit: view.orbit, fov: view.fov }
    );
    await page.waitForTimeout(900);
    const shot = path.join(outDir, `${view.name}.png`);
    await page.screenshot({ path: shot });
    console.log('shot', view.name);
  }

  console.log('OUT', outDir);
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
