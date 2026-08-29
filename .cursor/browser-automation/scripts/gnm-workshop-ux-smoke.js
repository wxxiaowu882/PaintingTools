/**
 * Smoke: GNM 头模工坊 — 加载、预设、滑条 capture、导出高度约 30cm
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '../../..');
const RUNS = path.resolve(__dirname, '../runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(RUNS, `${stamp}-gnm-workshop-ux`);
fs.mkdirSync(outDir, { recursive: true });

const BASE = process.env.BASE_URL || 'http://127.0.0.1:18080';
const PAGE =
  BASE.replace(/\/$/, '') +
  '/%E8%87%AA%E7%94%A8%E5%B7%A5%E5%85%B7%E6%96%87%E4%BB%B6_%E4%B8%8D%E9%83%A8%E7%BD%B2/GNM%E5%A4%B4%E6%A8%A1%E5%B7%A5%E5%9D%8A/?v=20260828-eye3';

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const report = { ok: true, checks: [] };

  const check = (name, pass, detail) => {
    report.checks.push({ name, pass: !!pass, detail: detail || '' });
    if (!pass) report.ok = false;
    console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  };

  page.on('pageerror', (e) => console.warn('pageerror', e.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.warn('console', msg.text());
  });

  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('#loading-overlay', { state: 'hidden', timeout: 180000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(outDir, '01-loaded.png') });

  const status = await page.locator('#status-text').textContent();
  check('status ready', /身份\s*253/.test(status || '') && /表情\s*383/.test(status || ''), status);

  const cap = await page.locator('#capability-bar').textContent();
  check('capability bar', /身份\s*253/.test(cap || '') && /表情\s*383/.test(cap || ''), (cap || '').trim());

  const gnmEye = await page.evaluate(() => window.__gnmWorkshopDebug?.getGnmHeadState?.() || null);
  check(
    'gnm eye mesh layers (inner+sclera)',
    gnmEye?.hasInner && gnmEye?.hasSclera,
    JSON.stringify(gnmEye)
  );
  check(
    'gnm sclera physical material',
    gnmEye?.scleraMat === 'MeshPhysicalMaterial' && Number(gnmEye?.scleraTransmission) > 0,
    `${gnmEye?.scleraMat} tx=${gnmEye?.scleraTransmission}`
  );

  await page.waitForFunction(
    () => document.querySelectorAll('#preset-rail-body .preset-chip-rail').length >= 8,
    null,
    { timeout: 120000 }
  );

  const idChips = await page.locator('#preset-rail-body .preset-chip-rail').count();
  check('preset chips >= 8', idChips >= 8, `count=${idChips}`);

  // Apply a preset（左侧身份轨；确保在「身份」页签）
  await page.locator('.preset-rail-tab[data-preset-tab="identity"]').click();
  await page.waitForTimeout(200);
  const presetClicked = await page.evaluate(async () => {
    const chips = [...document.querySelectorAll('#preset-rail-body .preset-chip-label')];
    const lab = chips.find((el) => el.textContent.trim() === '均值中性');
    if (!lab) return false;
    lab.closest('button')?.click();
    return true;
  });
  check('preset chip found', presetClicked, '均值中性');
  await page.waitForFunction(
    () =>
      document.querySelector('#preset-rail-body .preset-chip.is-selected .preset-chip-label')
        ?.textContent === '均值中性',
    null,
    { timeout: 15000 }
  );
  check(
    'identity preset selected',
    (await page.locator('#preset-rail-body .preset-chip.is-selected .preset-chip-label').textContent()) ===
      '均值中性',
    '均值中性'
  );

  // Capture slider: drag into viewport and ensure value still changes / slider still exists
  const slider = page.locator('.cap-slider').first();
  await slider.waitFor({ state: 'visible' });
  const box = await slider.boundingBox();
  if (!box) {
    check('slider bbox', false, 'no bbox');
  } else {
    const startX = box.x + box.width * 0.3;
    const y = box.y + box.height / 2;
    await page.mouse.move(startX, y);
    await page.mouse.down();
    // drag across into 3D viewport (left)
    await page.mouse.move(box.x - 120, y + 40, { steps: 12 });
    await page.mouse.move(box.x - 280, y + 80, { steps: 12 });
    const stillThere = await page.locator('.cap-slider').first().count();
    const valDuring = await page.locator('.slider-row').first().locator('.slider-val').textContent();
    await page.mouse.up();
    await page.waitForTimeout(250);
    const valAfter = await page.locator('.slider-row').first().locator('.slider-val').textContent();
    check(
      'slider survives drag into viewport',
      stillThere === 1 && valDuring != null,
      `valDuring=${valDuring} valAfter=${valAfter}`
    );
    check('slider value not stuck at 0 after drag', valAfter !== '0.00', `val=${valAfter}`);
  }

  // Reset one dirty common row (first with non-zero val)
  const resetResult = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#controls-root .slider-row')];
    const dirty = rows.find((r) => {
      const v = parseFloat(r.querySelector('.slider-val')?.textContent || '0');
      return Math.abs(v) > 0.05;
    });
    if (!dirty) return { found: false };
    const before = dirty.querySelector('.slider-val')?.textContent;
    dirty.querySelector('.btn-reset-one')?.click();
    const afterClick = dirty.querySelector('.slider-val')?.textContent;
    return { found: true, before, afterClick };
  });
  await page.waitForTimeout(350);
  check(
    'per-row reset to 0',
    resetResult.found && resetResult.afterClick === '0.00',
    JSON.stringify(resetResult)
  );

  // Height from page status / evaluate normalize
  const heightInfo = await page.evaluate(() => {
    const t = document.querySelector('#status-text')?.textContent || '';
    const m = t.match(/包围盒高\s*([\d.]+)\s*cm/);
    return { status: t, cm: m ? parseFloat(m[1]) : null };
  });
  check(
    'preview height ~30cm',
    heightInfo.cm != null && Math.abs(heightInfo.cm - 30) < 0.05,
    JSON.stringify(heightInfo)
  );

  // Export without download UI: call buildExportRoot + measure bbox in page
  const exportMeasure = await page.evaluate(async () => {
    // Access via canvas parent's module is hard; re-implement measure on mesh positions
    const canvas = document.querySelector('#view-canvas');
    // Hook: expose from window if present — fallback read status only
    return { hasCanvas: !!canvas };
  });

  // Download export via click + wait for download
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 120000 }),
    page.locator('#btn-export').click(),
  ]);
  const glbPath = path.join(outDir, await download.suggestedFilename());
  await download.saveAs(glbPath);
  const glbSize = fs.statSync(glbPath).size;
  check('export glb downloaded', glbSize > 1000, `bytes=${glbSize} path=${path.basename(glbPath)}`);

  // Parse GLB extras for heightCm / align
  const buf = fs.readFileSync(glbPath);
  const extras = peekExtras(buf);
  check(
    'extras heightCm=30 align=bottomCenter',
    extras?.export?.heightCm === 30 && extras?.export?.align === 'bottomCenter',
    JSON.stringify(extras?.export || extras)
  );

  await page.screenshot({ path: path.join(outDir, '02-after-preset.png') });
  await browser.close();

  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log('\nReport:', report.ok ? 'PASS' : 'FAIL', outDir);
  process.exit(report.ok ? 0 : 1);
}

function peekExtras(buffer) {
  const data = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (data.getUint32(0, true) !== 0x46546c67) return null;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkLen = data.getUint32(offset, true);
    const chunkType = data.getUint32(offset + 4, true);
    if (chunkType === 0x4e4f534a) {
      const bytes = buffer.subarray(offset + 8, offset + 8 + chunkLen);
      const text = new TextDecoder().decode(bytes).replace(/\0+$/, '');
      try {
        const json = JSON.parse(text);
        return json?.asset?.extras?.paintingtools?.gnmHead || null;
      } catch {
        return null;
      }
    }
    offset += 8 + chunkLen;
  }
  return null;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
