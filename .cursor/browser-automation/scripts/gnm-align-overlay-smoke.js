/**
 * Smoke: GNM × 欧版对齐叠显 — 渲染黑斑门禁 + 工具按钮二次退出
 * Usage: BASE_URL=http://127.0.0.1:18080 node scripts/gnm-align-overlay-smoke.js
 *
 * 黑斑门禁：欧版 100% / GNM 0% / 路标关，颏下 ROI 近黑像素比例必须低于阈值。
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { chromium } = require('playwright');

const RUNS = path.resolve(__dirname, '../runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(RUNS, `${stamp}-gnm-align-overlay`);
fs.mkdirSync(outDir, { recursive: true });

const BASE = process.env.BASE_URL || 'http://127.0.0.1:18080';
const PAGE =
  BASE.replace(/\/$/, '') +
  '/%E8%87%AA%E7%94%A8%E5%B7%A5%E5%85%B7%E6%96%87%E4%BB%B6_%E4%B8%8D%E9%83%A8%E7%BD%B2/GNM%E5%A4%B4%E6%A8%A1%E5%B7%A5%E5%9D%8A/align-overlay/';

/** 颏下 ROI 近黑像素上限（历史坏例 ~2.5%，修后目标 <0.5%） */
const CHIN_DARK_MAX = 0.005;

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
  // 唇下沟槽紧 ROI：宽 ROI 会把下颌轮廓暗边算进去，误报黑斑
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
      // 近黑且接近中性灰（背景洞/z-fight），排除深色肌肉贴图
      if (lum < 22 && span < 16) dark += 1;
      n += 1;
    }
  }
  return { ratio: dark / n, dark, n };
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const report = { ok: true, checks: [], consoleErrors: [], failedUrls: [] };

  const check = (name, pass, detail) => {
    report.checks.push({ name, pass: !!pass, detail: detail || '' });
    if (!pass) report.ok = false;
    console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  };

  page.on('pageerror', (e) => {
    report.consoleErrors.push(e.message);
    console.warn('pageerror', e.message);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      report.consoleErrors.push(msg.text());
      console.warn('console', msg.text());
    }
  });
  page.on('response', (res) => {
    if (res.status() >= 400) {
      report.failedUrls.push({ url: res.url(), status: res.status() });
    }
  });

  console.log('goto', PAGE);
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(
    () => {
      const el = document.querySelector('#loading');
      if (!el) return true;
      if (el.classList.contains('hidden')) return true;
      if (el.classList.contains('is-error')) return 'error';
      return false;
    },
    null,
    { timeout: 240000 }
  );

  const loadState = await page.evaluate(() => {
    const el = document.querySelector('#loading');
    const app = window.__alignOverlayApp;
    const bg = app?.scene?.background;
    const bgHex = bg && bg.isColor ? bg.getHex() : null;
    return {
      hidden: !el || el.classList.contains('hidden'),
      isError: !!(el && el.classList.contains('is-error')),
      status: document.querySelector('#status-text')?.textContent || '',
      euroVal: document.querySelector('#op-euro-val')?.textContent || '',
      lmRows: document.querySelectorAll('#lm-list .lm-row').length,
      names: [...document.querySelectorAll('#lm-list .lm-name')]
        .slice(0, 5)
        .map((el) => el.textContent.trim()),
      hasEnv: !!(app && app.scene.environment),
      tone: app?.renderer?.toneMapping,
      exposure: app?.renderer?.toneMappingExposure,
      euroMeshCount: app?.euroMeshes?.length || 0,
      bgHex,
      logDepth: !!app?.renderer?.capabilities?.logarithmicDepthBuffer,
    };
  });

  await page.screenshot({ path: path.join(outDir, '01-after-load.png'), fullPage: true });

  check('loading finished without error', loadState.hidden && !loadState.isError, JSON.stringify(loadState));
  check(
    'status has align rms',
    /对齐\s*\d+\s*点/.test(loadState.status) && /RMS/.test(loadState.status),
    loadState.status
  );
  check('euro opacity default 100%', loadState.euroVal === '100%', loadState.euroVal);
  check('landmark list has pairs', loadState.lmRows >= 3, `rows=${loadState.lmRows}`);
  check(
    'landmark names are Chinese',
    loadState.names.length >= 3 && loadState.names.every((n) => /[\u4e00-\u9fff]/.test(n)),
    loadState.names.join(',')
  );
  check('no scene environment (compare_review path)', !loadState.hasEnv, `hasEnv=${loadState.hasEnv}`);
  check(
    'LinearToneMapping exposure≈1.35',
    loadState.tone === 1 && Math.abs(Number(loadState.exposure) - 1.35) < 0.05,
    `tone=${loadState.tone} exp=${loadState.exposure}`
  );
  check('euro meshes loaded', loadState.euroMeshCount >= 5, `n=${loadState.euroMeshCount}`);

  if (loadState.isError) {
    fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
    await browser.close();
    console.error('SMOKE FAIL', outDir);
    process.exit(1);
  }

  // —— 黑斑门禁：欧版单独、正视、关路标 ——
  await page.fill('#op-gnm', '0');
  await page.fill('#op-euro', '100');
  await page.evaluate(() => {
    document.querySelector('#chk-landmarks').checked = false;
    document.querySelector('#chk-landmarks').dispatchEvent(new Event('change'));
  });
  await page.waitForTimeout(500);
  const chinPath = path.join(outDir, '02-euro-chin-gate.png');
  await page.screenshot({
    path: chinPath,
    clip: { x: 320, y: 180, width: 420, height: 420 },
  });
  const chin = chinDarkRatio(chinPath);
  check(
    `chin darkRatio < ${CHIN_DARK_MAX}`,
    chin.ratio < CHIN_DARK_MAX,
    `ratio=${chin.ratio.toFixed(4)} dark=${chin.dark}/${chin.n}`
  );
  await page.screenshot({ path: path.join(outDir, '03-euro-only-full.png'), fullPage: true });

  // 叠显场景也截一张（不对黑斑做门禁，避免 GNM 半透明干扰）
  await page.fill('#op-gnm', '55');
  await page.fill('#op-euro', '100');
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(outDir, '04-overlay-55-100.png'), fullPage: true });

  // —— GNM 眼球分层：body + 虹膜瞳孔 + 半透明巩膜 ——
  const eyeParts = await page.evaluate(() => {
    const app = window.__alignOverlayApp;
    const kinds = (app?.gnmHead?.parts || []).map((p) => p.kind);
    return {
      kinds,
      hasInner: kinds.includes('eyeInner'),
      hasSclera: kinds.includes('eyeSclera'),
      innerMat: app?.gnmHead?.eyeInnerMesh?.material?.type || '',
      scleraMat: app?.gnmHead?.eyeScleraMesh?.material?.type || '',
      scleraTransmission: app?.gnmHead?.eyeScleraMesh?.material?.transmission ?? null,
    };
  });
  check(
    'gnm eye mesh layers (inner+sclera)',
    eyeParts.hasInner && eyeParts.hasSclera,
    JSON.stringify(eyeParts)
  );
  check(
    'gnm sclera uses physical material',
    eyeParts.scleraMat === 'MeshPhysicalMaterial' && Number(eyeParts.scleraTransmission) > 0,
    `${eyeParts.scleraMat} tx=${eyeParts.scleraTransmission}`
  );

  await page.evaluate(() => {
    const app = window.__alignOverlayApp;
    app.setModelViewMode('gnm');
    document.querySelector('#op-gnm').value = '100';
    document.querySelector('#op-euro').value = '0';
    document.querySelector('#op-gnm').dispatchEvent(new Event('input'));
    document.querySelector('#op-euro').dispatchEvent(new Event('input'));
  });
  await page.waitForTimeout(500);
  const eyeShot = path.join(outDir, '05-gnm-eye-front.png');
  await page.screenshot({
    path: eyeShot,
    clip: { x: 520, y: 200, width: 400, height: 220 },
  });

  function eyeContrastRatio(file) {
    const { width: w, height: h, data } = decodePngRGBA(fs.readFileSync(file));
    let dark = 0;
    let bright = 0;
    let mid = 0;
    let n = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        if (lum < 35) dark += 1;
        else if (lum > 120) bright += 1;
        else mid += 1;
        n += 1;
      }
    }
    return { dark: dark / n, bright: bright / n, mid: mid / n, n };
  }
  const eyeContrast = eyeContrastRatio(eyeShot);
  check(
    'gnm eye ROI has dark pixels (pupil)',
    eyeContrast.dark > 0.008,
    `dark=${eyeContrast.dark.toFixed(4)} bright=${eyeContrast.bright.toFixed(4)}`
  );
  check(
    'gnm eye ROI has bright pixels (sclera/skin)',
    eyeContrast.bright > 0.05,
    `dark=${eyeContrast.dark.toFixed(4)} bright=${eyeContrast.bright.toFixed(4)}`
  );

  // —— 空闲直拖：无「移动」按钮；空闲可旋转；工具仍可二次退出 ——
  check('no move button', (await page.locator('#lm-move').count()) === 0);
  // 恢复路标与双侧显示，便于点选/拖动
  await page.check('#chk-landmarks');
  await page.evaluate(() => {
    const app = window.__alignOverlayApp;
    app.setModelViewMode('both');
    document.querySelector('#op-gnm').value = '55';
    document.querySelector('#op-euro').value = '100';
    document.querySelector('#op-gnm').dispatchEvent(new Event('input'));
    document.querySelector('#op-euro').dispatchEvent(new Event('input'));
  });
  await page.waitForTimeout(200);
  check(
    'orbit on in idle',
    await page.evaluate(() => window.__alignOverlayApp?.controls?.enabled === true)
  );

  const dragOk = await page.evaluate(() => {
    const app = window.__alignOverlayApp;
    const ed = app.lmEditor;
    const pt = ed.points.find((p) => p.side === 'gnm');
    if (!pt) return { ok: false, reason: 'no gnm point' };
    ed.setMode('idle');
    ed.select(pt.uid);
    const mesh = ed.markerByUid.get(pt.uid);
    if (!mesh || !mesh.visible) return { ok: false, reason: 'marker hidden' };
    const before = pt.pos.slice();
    // 直接走拖动 API：锁 orbit → 沿法向邻域挪一点
    ed._dragging = true;
    ed._dragSide = 'gnm';
    ed._setOrbitEnabled(false);
    const orbitDuring = app.controls.enabled;
    const world = ed.worldPosFor(pt).clone();
    world.x += 0.004;
    world.y += 0.002;
    const fakeHit = { point: world };
    ed._moveSelectedToHit(fakeHit, 'gnm');
    ed._dragging = false;
    ed._dragSide = null;
    ed._setOrbitEnabled(true);
    const moved =
      Math.hypot(pt.pos[0] - before[0], pt.pos[1] - before[1], pt.pos[2] - before[2]) > 1e-8;
    return {
      ok: moved && orbitDuring === false && app.controls.enabled === true && ed.selectedUid === pt.uid,
      orbitDuring,
      orbitAfter: app.controls.enabled,
      moved,
      selected: ed.selectedUid === pt.uid,
    };
  });
  check('idle drag moves point & locks orbit', !!dragOk.ok, JSON.stringify(dragOk));

  // 空白处点击：取消选中（用编辑器 API 对齐 pointer 空白分支）
  await page.evaluate(() => {
    const ed = window.__alignOverlayApp.lmEditor;
    ed.setMode('idle');
    // 模拟未点中 marker 的 blank 分支
    if (ed.selectedUid) ed.clearSelection();
    ed._setOrbitEnabled(true);
  });
  check(
    'click blank clears selection',
    await page.evaluate(() => window.__alignOverlayApp.lmEditor.selectedUid == null)
  );
  check(
    'orbit on after blank click',
    await page.evaluate(() => window.__alignOverlayApp.controls.enabled === true)
  );

  // 真·空白 pointerdown（视口角落）
  await page.evaluate(() => {
    const app = window.__alignOverlayApp;
    const ed = app.lmEditor;
    const pt = ed.points[0];
    if (pt) ed.select(pt.uid);
  });
  await page.mouse.click(40, 120);
  check(
    'real blank pointer clears selection',
    await page.evaluate(() => window.__alignOverlayApp.lmEditor.selectedUid == null)
  );

  await page.click('#lm-add-gnm');
  check('add-gnm activates', (await page.locator('#lm-add-gnm.is-active').count()) === 1);
  check(
    'orbit stays on in add mode (idle/add 可旋转)',
    await page.evaluate(() => window.__alignOverlayApp?.controls?.enabled === true)
  );
  await page.click('#lm-add-euro');
  check(
    'switch to add-euro',
    (await page.locator('#lm-add-euro.is-active').count()) === 1 &&
      (await page.locator('#lm-add-gnm.is-active').count()) === 0
  );
  await page.click('#lm-add-euro');
  check('add-euro toggles off', (await page.locator('#lm-add-euro.is-active').count()) === 0);

  await page.click('#lm-pair');
  check('pair activates', (await page.locator('#lm-pair.is-active').count()) === 1);
  await page.click('#lm-pair');
  check('pair toggles off', (await page.locator('#lm-pair.is-active').count()) === 0);

  check(
    'no pageerrors',
    report.consoleErrors.filter((e) => !/favicon/i.test(e)).length === 0,
    JSON.stringify(report.consoleErrors.slice(0, 5))
  );

  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();

  if (!report.ok) {
    console.error('SMOKE FAIL', outDir);
    process.exit(1);
  }
  console.log('SMOKE PASS', outDir);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
