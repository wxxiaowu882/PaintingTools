/**
 * GNM 播放器门禁：叠显 + 工坊（不含 GLB 管理器）
 * Usage: BASE_URL=http://127.0.0.1:18080 node scripts/gnm-euro-eye-gate.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { chromium } = require('playwright');

const RUNS = path.resolve(__dirname, '../runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(RUNS, `${stamp}-gnm-player-gate`);
fs.mkdirSync(outDir, { recursive: true });

const BASE = process.env.BASE_URL || 'http://127.0.0.1:18080';
const ALIGN =
  BASE.replace(/\/$/, '') +
  '/%E8%87%AA%E7%94%A8%E5%B7%A5%E5%85%B7%E6%96%87%E4%BB%B6_%E4%B8%8D%E9%83%A8%E7%BD%B2/GNM%E5%A4%B4%E6%A8%A1%E5%B7%A5%E5%9D%8A/align-overlay/?v=20260829-display1';
const WORKSHOP =
  BASE.replace(/\/$/, '') +
  '/%E8%87%AA%E7%94%A8%E5%B7%A5%E5%85%B7%E6%96%87%E4%BB%B6_%E4%B8%8D%E9%83%A8%E7%BD%B2/GNM%E5%A4%B4%E6%A8%A1%E5%B7%A5%E5%9D%8A/?v=20260829-display1';

const TEST_DIR = process.env.EURO_TEST_DIR || 'E:/模型/测试';
const BAKED_GLB = path.join(TEST_DIR, '第七次拧_baked (1).glb');

const CHIN_DARK_MAX = 0.008;
const EYE_RED_MAX = 0.01;

function decodePngRGBA(buf) {
  let pos = 8;
  let width = 0;
  let height = 0;
  let colorType = 6;
  const idats = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    pos += 4;
    const type = buf.toString('ascii', pos, pos + 4);
    pos += 4;
    const data = buf.subarray(pos, pos + len);
    pos += len;
    pos += 4;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
    } else if (type === 'IDAT') idats.push(data);
    else if (type === 'IEND') break;
  }
  const raw = zlib.inflateSync(Buffer.concat(idats));
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const rgba = Buffer.alloc(width * height * 4);
  let ip = 0;
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[ip++];
    const row = Buffer.alloc(stride);
    raw.copy(row, 0, ip, ip + stride);
    ip += stride;
    for (let i = 0; i < stride; i++) {
      const x = row[i];
      const a = i >= bpp ? row[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let val = x;
      if (filter === 1) val = (x + a) & 255;
      else if (filter === 2) val = (x + b) & 255;
      else if (filter === 3) val = (x + ((a + b) >> 1)) & 255;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        val = (x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
      row[i] = val;
    }
    for (let x = 0; x < width; x++) {
      const si = x * bpp;
      const di = (y * width + x) * 4;
      rgba[di] = row[si];
      rgba[di + 1] = row[si + 1];
      rgba[di + 2] = row[si + 2];
      rgba[di + 3] = bpp === 4 ? row[si + 3] : 255;
    }
    prev = row;
  }
  return { width, height, data: rgba };
}

function chinDarkRatio(file) {
  const { width: w, height: h, data } = decodePngRGBA(fs.readFileSync(file));
  const x0 = Math.floor(w * 0.42);
  const x1 = Math.floor(w * 0.58);
  const y0 = Math.floor(h * 0.48);
  const y1 = Math.floor(h * 0.62);
  let dark = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const span = Math.max(r, g, b) - Math.min(r, g, b);
      n += 1;
      if (lum < 22 && span < 16) dark += 1;
    }
  }
  return { dark, n, ratio: dark / n };
}

function roiStats(file, roi, isBad) {
  const { width: w, height: h, data } = decodePngRGBA(fs.readFileSync(file));
  const x0 = Math.floor(w * roi.x0);
  const x1 = Math.floor(w * roi.x1);
  const y0 = Math.floor(h * roi.y0);
  const y1 = Math.floor(h * roi.y1);
  let bad = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      n += 1;
      if (isBad(r, g, b)) bad += 1;
    }
  }
  return { bad, n, ratio: bad / n };
}

function cheekThreadRatio(file) {
  return roiStats(file, { x0: 0.2, x1: 0.46, y0: 0.36, y1: 0.54 }, (r, g, b) => {
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const span = Math.max(r, g, b) - Math.min(r, g, b);
    return lum < 18 && span < 12;
  });
}

function eyeRedRatio(file) {
  return roiStats(file, { x0: 0.46, x1: 0.54, y0: 0.29, y1: 0.35 }, (r, g, b) => {
    // 饱和品红肌层透出（非棕色虹膜贴图）
    return r > 190 && g < 85 && b < 85;
  });
}

async function screenshotCanvas(page, filePath) {
  const box = await page.locator('#view-canvas').boundingBox();
  if (box) {
    await page.screenshot({
      path: filePath,
      clip: { x: box.x, y: box.y, width: box.width, height: box.height },
    });
  } else {
    await page.screenshot({ path: filePath });
  }
}

function probeEuroMeshes(rootGetter) {
  return rootGetter().map((m) => {
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    return {
      name: m.name,
      visible: m.visible,
      type: mat?.type || '',
      hasMap: !!mat?.map,
      transparent: !!mat?.transparent,
      opacity: mat?.opacity ?? 1,
      polygonOffset: !!mat?.polygonOffset,
      renderOrder: m.renderOrder ?? 0,
      skipWarp: !!m.userData?._skipEuroWarp,
      junk: !!m.userData?._overlayHiddenJunk,
    };
  });
}

async function main() {
  if (!fs.existsSync(BAKED_GLB)) {
    console.error('缺少烘焙包:', BAKED_GLB);
    process.exit(1);
  }

  const report = { ok: true, checks: [], bakedPath: BAKED_GLB };
  const check = (name, pass, detail) => {
    report.checks.push({ name, pass: !!pass, detail: detail || '' });
    if (!pass) report.ok = false;
    console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  };

  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--ignore-gpu-blocklist'],
  });

  // --- 叠显 ---
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(ALIGN, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForSelector('#loading', { state: 'hidden', timeout: 240000 });
  await page.waitForTimeout(1500);

  const alignMeshes = await page.evaluate(() => {
    const list = window.__alignOverlayApp?.euroMeshes || [];
    return list.map((m) => {
      const mat = Array.isArray(m.material) ? m.material[0] : m.material;
      return {
        name: m.name,
        visible: m.visible,
        type: mat?.type || '',
        hasMap: !!mat?.map,
        transparent: !!mat?.transparent,
        opacity: mat?.opacity ?? 1,
        polygonOffset: !!mat?.polygonOffset,
        depthWrite: mat?.depthWrite !== false,
        renderOrder: m.renderOrder ?? 0,
        skipWarp: !!m.userData?._skipEuroWarp,
        junk: !!m.userData?._overlayHiddenJunk,
      };
    });
  });

  const irisA = alignMeshes.find((m) => /acs_0/i.test(m.name) && !/leca/i.test(m.name));
  const lensA = alignMeshes.find((m) => /acsleca/i.test(m.name));
  const staticA = alignMeshes.find((m) => /static/i.test(m.name));
  check('align lens visible', lensA?.visible);
  check('align melns hidden', alignMeshes.filter((m) => /melns/i.test(m.name)).every((m) => !m.visible));
  check(
    'align iris MeshBasic+map (unlit)',
    irisA?.type === 'MeshBasicMaterial' && irisA?.hasMap,
    JSON.stringify(irisA)
  );
  check('align iris opaque', irisA && !irisA.transparent && irisA.opacity >= 0.99, JSON.stringify(irisA));
  check('align lens transparent', lensA?.transparent && lensA.opacity < 0.9, JSON.stringify(lensA));
  check('align eye skip warp', alignMeshes.filter((m) => /acs/i.test(m.name)).every((m) => m.skipWarp));

  // 用户验收条件：仅欧版 + GNM55/欧版100 + 关路标 + 正视
  await page.evaluate(() => {
    window.__alignOverlayApp?.setModelViewMode?.('euro');
    document.querySelector('#op-gnm').value = '55';
    document.querySelector('#op-euro').value = '100';
    document.querySelector('#op-gnm').dispatchEvent(new Event('input'));
    document.querySelector('#op-euro').dispatchEvent(new Event('input'));
  });
  await page.fill('#op-gnm', '55');
  await page.fill('#op-euro', '100');
  await page.evaluate(() => {
    const chk = document.querySelector('#chk-landmarks');
    if (chk) {
      chk.checked = false;
      chk.dispatchEvent(new Event('change'));
    }
    window.__alignOverlayApp?.setModelViewMode?.('euro');
    window.__alignOverlayApp?.setView?.('front');
    window.__alignOverlayApp?.frameHead?.();
  });
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    window.__alignOverlayApp?.frameHead?.();
  });
  await page.waitForTimeout(800);
  const alignShot = path.join(outDir, 'align-euro-user.png');
  await screenshotCanvas(page, alignShot);
  const alignChin = chinDarkRatio(alignShot);
  const alignEyeRed = eyeRedRatio(alignShot);
  check('align chin dark ratio', alignChin.ratio < CHIN_DARK_MAX, `ratio=${alignChin.ratio.toFixed(4)} dark=${alignChin.dark}`);
  check(
    'align eye muscle-red bleed',
    alignEyeRed.ratio < EYE_RED_MAX,
    `ratio=${alignEyeRed.ratio.toFixed(4)} bad=${alignEyeRed.bad}`
  );

  // --- 工坊 + 用户 baked ---
  const wPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await wPage.goto(WORKSHOP, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await wPage.waitForSelector('#loading-overlay', { state: 'hidden', timeout: 180000 });
  await wPage.waitForTimeout(800);

  await wPage.locator('#bake-pack-files').setInputFiles([BAKED_GLB]);
  await wPage.waitForTimeout(3000);
  await wPage.check('#muscle-enable');
  await wPage.waitForTimeout(800);

  const workshopProbe = await wPage.evaluate(() => {
    const root = window.__gnmMuscleDebug?.root;
    if (!root) return { err: 'no muscle root' };
    const meshes = [];
    root.traverse((m) => {
      if (!m.isMesh) return;
      const mat = Array.isArray(m.material) ? m.material[0] : m.material;
      meshes.push({
        name: m.name,
        visible: m.visible,
        type: mat?.type || '',
        hasMap: !!mat?.map,
        transparent: !!mat?.transparent,
        opacity: mat?.opacity ?? 1,
        polygonOffset: !!mat?.polygonOffset,
        depthWrite: mat?.depthWrite !== false,
        renderOrder: m.renderOrder ?? 0,
      });
    });
    return { meshes, hint: document.querySelector('#muscle-hint')?.textContent || '' };
  });

  check('workshop load baked', /已加载|烘焙/.test(workshopProbe.hint || ''), workshopProbe.hint?.slice(0, 60));
  const irisW = (workshopProbe.meshes || []).find((m) => /acs_0/i.test(m.name) && !/leca/i.test(m.name));
  const lensW = (workshopProbe.meshes || []).find((m) => /acsleca/i.test(m.name));
  check(
    'workshop iris MeshBasic+map',
    irisW?.type === 'MeshBasicMaterial' && irisW?.hasMap,
    JSON.stringify(irisW)
  );
  check('workshop iris opaque at 75% group', irisW && !irisW.transparent && irisW.opacity >= 0.99, JSON.stringify(irisW));
  check('workshop lens visible', lensW?.visible);
  check('workshop muscle loaded', (workshopProbe.meshes || []).length >= 5);

  const wShot = path.join(outDir, 'workshop-bake.png');
  await screenshotCanvas(wPage, wShot);
  const wChin = chinDarkRatio(wShot);
  check('workshop chin dark ratio', wChin.ratio < CHIN_DARK_MAX, `ratio=${wChin.ratio.toFixed(4)}`);

  await browser.close();
  report.stats = {
    align: { chin: alignChin, eyeRed: alignEyeRed, meshes: alignMeshes },
    workshop: { chin: wChin, probe: workshopProbe },
  };
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log('\nGNM PLAYER GATE', report.ok ? 'PASS' : 'FAIL', outDir);
  process.exit(report.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
