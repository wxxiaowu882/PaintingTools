/**
 * Self-test: render slim GLB with MeshMatcap + capture Sketchfab embed face crop.
 */
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

const baRoot = path.resolve(__dirname, '..');
const runDir = path.join(baRoot, 'runs', '20260821-headscan-v926');
const profileDir = path.join(baRoot, 'chrome-profile-sketchfab');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:18080';
const previewUrl = `${BASE}/.cursor/browser-automation/runs/20260821-headscan-v926/preview.html`;
const sketchfabEmbed =
  'https://sketchfab.com/models/a93fd43dd1eb485eb8bcb9f5afae50d8/embed?autostart=1&ui_theme=dark&ui_infos=0&ui_controls=0&ui_stop=0&ui_watermark=0&ui_ar=0&ui_help=0&ui_settings=0&ui_inspector=0&ui_vr=0&ui_fullscreen=0&ui_annotations=0';

async function waitReady(page, timeout = 60000) {
  await page.waitForFunction(() => window.__SELFTEST_READY__ === true || window.__SELFTEST_ERR__, null, {
    timeout
  });
  const err = await page.evaluate(() => window.__SELFTEST_ERR__ || null);
  if (err) throw new Error(err);
  const info = await page.evaluate(() => window.__SELFTEST_INFO__);
  return info;
}

async function main() {
  fs.mkdirSync(runDir, { recursive: true });
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: false,
    args: ['--use-gl=angle', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required']
  });

  // 1) Our preview
  const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
  await page.goto(previewUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  const info = await waitReady(page);
  const views = ['front', 'back', 'left', 'right'];
  const scored = [];
  for (const v of views) {
    await page.evaluate((name) => window.__SELFTEST_SET_VIEW__(name), v);
    await page.waitForTimeout(200);
    const shot = path.join(runDir, `ours_${v}.png`);
    await page.screenshot({ path: shot, type: 'png' });
    const buf = fs.readFileSync(shot);
    // crude: larger PNG often = more detailed face vs black hair mass
    const score = await page.evaluate(() => window.__SELFTEST_SCORE__());
    scored.push({ v, shot, sz: fs.statSync(shot).size, ...score });
  }
  // face = highest skin ratio among views that aren't mostly hair silhouette
  scored.sort((a, b) => b.ratio - a.ratio);
  // Prefer the view previously verified as face ("back" in this model's +Z export)
  const preferred = scored.find((s) => s.v === 'back' && s.ratio > 0.25);
  const faceView = preferred ? preferred.v : scored[0].v;
  await page.evaluate((name) => window.__SELFTEST_SET_VIEW__(name), faceView);
  await page.waitForTimeout(200);
  const ours = path.join(runDir, 'ours_front.png');
  await page.screenshot({ path: ours, type: 'png' });
  await page.screenshot({
    path: path.join(runDir, 'ours_eyes.png'),
    type: 'png',
    clip: { x: 270, y: 280, width: 360, height: 240 }
  });
  console.log('ours ok', info, 'faceView', faceView, scored);

  // 2) Sketchfab embed reference
  const ctx = await chromium.launchPersistentContext(profileDir, {
    channel: 'chrome',
    headless: false,
    viewport: { width: 1100, height: 900 },
    args: ['--use-gl=angle', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required']
  });
  const sp = await ctx.newPage();
  await sp.goto(sketchfabEmbed, { waitUntil: 'domcontentloaded', timeout: 120000 });
  // wait until canvas has content (file size heuristic via screenshot growth)
  let best = null;
  for (let i = 0; i < 25; i++) {
    await sp.waitForTimeout(2000);
    const p = path.join(runDir, `_sf_tmp_${i}.png`);
    await sp.screenshot({ path: p, type: 'png' });
    const sz = fs.statSync(p).size;
    if (!best || sz > best.sz) best = { p, sz };
    if (sz > 180000) break;
  }
  const sf = path.join(runDir, 'sketchfab_ref.png');
  fs.copyFileSync(best.p, sf);
  // cleanup temps
  for (const f of fs.readdirSync(runDir)) {
    if (f.startsWith('_sf_tmp_')) fs.unlinkSync(path.join(runDir, f));
  }
  await sp.screenshot({
    path: path.join(runDir, 'sketchfab_eyes.png'),
    type: 'png',
    clip: { x: 360, y: 280, width: 380, height: 240 }
  });
  console.log('sketchfab ok', sf, 'bytes', best.sz);

  await browser.close();
  await ctx.close();
  console.log('DONE');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
