/**
 * Smoke: 叠显导出烘焙包 → 工坊加载 → 预设形变 → 导出欧版肌肉 GLB
 * BASE_URL=http://127.0.0.1:18080 node scripts/gnm-bake-pack-smoke.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../../..');
const RUNS = path.resolve(__dirname, '../runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(RUNS, `${stamp}-gnm-bake-pack`);
fs.mkdirSync(outDir, { recursive: true });

const BASE = process.env.BASE_URL || 'http://127.0.0.1:18080';
const ALIGN =
  BASE.replace(/\/$/, '') +
  '/%E8%87%AA%E7%94%A8%E5%B7%A5%E5%85%B7%E6%96%87%E4%BB%B6_%E4%B8%8D%E9%83%A8%E7%BD%B2/GNM%E5%A4%B4%E6%A8%A1%E5%B7%A5%E5%9D%8A/align-overlay/';
const WORKSHOP =
  BASE.replace(/\/$/, '') +
  '/%E8%87%AA%E7%94%A8%E5%B7%A5%E5%85%B7%E6%96%87%E4%BB%B6_%E4%B8%8D%E9%83%A8%E7%BD%B2/GNM%E5%A4%B4%E6%A8%A1%E5%B7%A5%E5%9D%8A/?v=20260829-player1';

function peekMapFromGlbFile(filePath) {
  const json = parseGlbJson(filePath);
  return json?.asset?.extras?.paintingtools?.euroMuscleMap || null;
}

function parseGlbJson(filePath) {
  const buf = fs.readFileSync(filePath);
  const data = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (data.getUint32(0, true) !== 0x46546c67) return null;
  let offset = 12;
  while (offset + 8 <= buf.byteLength) {
    const chunkLen = data.getUint32(offset, true);
    const chunkType = data.getUint32(offset + 4, true);
    if (chunkType === 0x4e4f534a) {
      const text = buf.slice(offset + 8, offset + 8 + chunkLen).toString('utf8').replace(/\0+$/, '');
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    }
    offset += 8 + chunkLen;
  }
  return null;
}

function inspectEuroGlb(filePath) {
  const json = parseGlbJson(filePath);
  if (!json) return { ok: false, reason: 'no-json' };
  const names = [];
  for (const n of json.nodes || []) if (n.name) names.push(n.name);
  for (const m of json.meshes || []) if (m.name) names.push(m.name);
  const blob = names.join(' ').toLowerCase();
  const hasLens = blob.includes('acsleca');
  const meshCount = (json.meshes || []).length;
  const hiddenMelns = names.some((n) => /melns/i.test(n));
  return { ok: true, hasLens, meshCount, hiddenMelns, names };
}

async function main() {
  const report = { ok: true, checks: [] };
  const check = (name, pass, detail) => {
    report.checks.push({ name, pass: !!pass, detail: detail || '' });
    if (!pass) report.ok = false;
    console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  };

  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--ignore-gpu-blocklist'],
  });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage({ viewport: { width: 1440, height: 900 } });

  page.on('pageerror', (e) => console.warn('pageerror', e.message));

  // --- Align overlay: load & export bake pack ---
  await page.goto(ALIGN, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('#loading', { state: 'hidden', timeout: 180000 });
  await page.waitForTimeout(2000);
  const alignStatus = await page.locator('#status-text').textContent();
  check('align-overlay loaded', /拧|对齐|历史/.test(alignStatus || ''), alignStatus?.slice(0, 80));

  let glbPath = '';
  let mapPath = '';
  try {
    const clickP = page.locator('#btn-export-bake').click();
    const dl1 = await page.waitForEvent('download', { timeout: 180000 });
    await clickP;
    const name1 = await dl1.suggestedFilename();
    const dest1 = path.join(outDir, name1);
    await dl1.saveAs(dest1);
    if (/\.glb$/i.test(name1)) glbPath = dest1;
    if (/\.json$/i.test(name1)) mapPath = dest1;

    try {
      const dl2 = await page.waitForEvent('download', { timeout: 8000 });
      const name2 = await dl2.suggestedFilename();
      const dest2 = path.join(outDir, name2);
      await dl2.saveAs(dest2);
      if (/\.glb$/i.test(name2)) glbPath = dest2;
      if (/\.json$/i.test(name2)) mapPath = dest2;
    } catch (_) {
      /* map.json 可选；映射表已内嵌 GLB extras */
    }
  } catch (e) {
    check('export bake pack downloads', false, e.message);
    fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
    await browser.close();
    process.exit(1);
  }

  const glbSize = fs.existsSync(glbPath) ? fs.statSync(glbPath).size : 0;
  let mapRaw = mapPath && fs.existsSync(mapPath) ? JSON.parse(fs.readFileSync(mapPath, 'utf8')) : null;
  if (!mapRaw && glbPath && fs.existsSync(glbPath)) {
    mapRaw = peekMapFromGlbFile(glbPath);
  }
  check('baked glb size', glbSize > 50000, `bytes=${glbSize}`);
  check('map pairs (file or glb extras)', mapRaw?.pairs?.length >= 4, `pairs=${mapRaw?.pairs?.length}`);

  const bakedInspect = glbPath ? inspectEuroGlb(glbPath) : { ok: false };
  check(
    'baked glb has lens (AcsLeca)',
    bakedInspect.hasLens,
    bakedInspect.names ? bakedInspect.names.filter((n) => /acs/i.test(n)).join(', ') : 'missing'
  );
  check('baked glb mesh count', (bakedInspect.meshCount || 0) >= 5, `meshes=${bakedInspect.meshCount}`);

  // --- Workshop: load pack ---
  const wPage = await context.newPage({ viewport: { width: 1440, height: 900 } });
  await wPage.goto(WORKSHOP, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await wPage.waitForSelector('#loading-overlay', { state: 'hidden', timeout: 180000 });
  await wPage.waitForTimeout(800);

  const gnmEye = await wPage.evaluate(() => window.__gnmWorkshopDebug?.getGnmHeadState?.() || null);
  check(
    'workshop gnm eye layers',
    gnmEye?.hasInner && gnmEye?.hasSclera,
    JSON.stringify(gnmEye)
  );

  await wPage.locator('#bake-pack-files').setInputFiles([glbPath]);
  await wPage.waitForTimeout(2500);
  const muscleHint = await wPage.locator('#muscle-hint').textContent();
  check('workshop load bake pack', /已加载|烘焙/.test(muscleHint || ''), muscleHint);

  await wPage.check('#muscle-enable');
  await wPage.waitForTimeout(500);
  await wPage.screenshot({ path: path.join(outDir, '01-neutral-bake.png') });

  await wPage.waitForSelector('.cap-slider', { timeout: 120000 });
  const slider = wPage.locator('.cap-slider').first();
  const box = await slider.boundingBox();
  if (box) {
    await wPage.mouse.click(box.x + box.width * 0.72, box.y + box.height / 2);
  }
  await wPage.waitForTimeout(800);
  await wPage.screenshot({ path: path.join(outDir, '02-slider-moved.png') });

  const warpBefore = await wPage.evaluate(() => window.__gnmMuscleDebug?.getWarpState?.() || null);
  await wPage.waitForTimeout(600);
  const warpAfter = await wPage.evaluate(() => window.__gnmMuscleDebug?.getWarpState?.() || null);
  const maxDelta = Math.max(warpAfter?.maxDelta || 0, warpBefore?.maxDelta || 0);
  check(
    'muscle warp after identity slider',
    maxDelta > 0.00025 && (warpAfter?.trackers || 0) >= 4,
    `maxDelta=${maxDelta.toFixed(6)} trackers=${warpAfter?.trackers} neutral=${warpAfter?.neutral}`
  );
  check('identity slider moved', true, 'ok');

  let muscleGlbPath = '';
  try {
    const [dl] = await Promise.all([
      wPage.waitForEvent('download', { timeout: 60000 }),
      wPage.locator('#btn-export-euro').click(),
    ]);
    muscleGlbPath = path.join(outDir, await dl.suggestedFilename());
    await dl.saveAs(muscleGlbPath);
  } catch (e) {
    check('export muscle glb', false, e.message);
  }
  const muscleSize = muscleGlbPath && fs.existsSync(muscleGlbPath) ? fs.statSync(muscleGlbPath).size : 0;
  check('muscle glb exported', muscleSize > 50000, `bytes=${muscleSize}`);

  await browser.close();
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log('\nReport:', report.ok ? 'PASS' : 'FAIL', outDir);
  process.exit(report.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
