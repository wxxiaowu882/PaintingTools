/**
 * Export Taobao shop decoration static PNGs from render-assets.html
 */
require('./_playwright-browsers-path.js');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '../../..');
const outDir = path.join(repoRoot, '自用工具文件_不部署', '淘宝店铺装修素材_2026-11');
const htmlPath = path.join(outDir, 'render-assets.html');
const base = process.env.LOCAL_HTTP || 'http://127.0.0.1:18080';
const url =
  base.replace(/\/$/, '') +
  '/' +
  encodeURI('自用工具文件_不部署/淘宝店铺装修素材_2026-11/render-assets.html');

const shots = [
  { id: 'banner', file: '01_banner_mobile_750x400.png' },
  { id: 'path1', file: '02_path_1_shape.png' },
  { id: 'path2', file: '03_path_2_face.png' },
  { id: 'path3', file: '04_path_3_system.png' },
  { id: 'path4', file: '05_path_4_custom.png' },
  { id: 'steps', file: '06_steps_750x200.png' },
  { id: 'pc-banner', file: '07_banner_pc_1920x320.png' }
];

async function main() {
  if (!fs.existsSync(htmlPath)) throw new Error('missing ' + htmlPath);
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true
  });
  const page = await browser.newPage({
    viewport: { width: 2000, height: 2400 },
    deviceScaleFactor: 1
  });
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });

  for (const s of shots) {
    const el = page.locator('#' + s.id);
    await el.waitFor({ state: 'visible' });
    const out = path.join(outDir, s.file);
    await el.screenshot({ path: out, type: 'png' });
    console.log('OK', s.file);
  }

  await browser.close();
  console.log('done', outDir);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
