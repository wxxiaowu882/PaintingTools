/**
 * 欧版显示对比确认页：GLB 管理器（model-viewer PBR） vs 叠显 Three.js
 * Usage: BASE_URL=http://127.0.0.1:18080 node scripts/gnm-euro-display-compare.js
 *
 * 产物：runs/<stamp>-euro-display-compare/index.html（自动打开浏览器）
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { chromium } = require('playwright');
const { execSync } = require('child_process');

const RUNS = path.resolve(__dirname, '../runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(RUNS, `${stamp}-euro-display-compare`);
fs.mkdirSync(outDir, { recursive: true });

const BASE = process.env.BASE_URL || 'http://127.0.0.1:18080';
const ROOT = BASE.replace(/\/$/, '');
const GLB_REF = `${ROOT}/.cursor/browser-automation/fixtures/glb-manager-euro-ref.html`;
const ALIGN =
  ROOT +
  '/%E8%87%AA%E7%94%A8%E5%B7%A5%E5%85%B7%E6%96%87%E4%BB%B6_%E4%B8%8D%E9%83%A8%E7%BD%B2/GNM%E5%A4%B4%E6%A8%A1%E5%B7%A5%E5%9D%8A/align-overlay/?v=20260829-display18';

const EXPECT_REV = '20260829-display18';
const USER_HIST_ID = 'v_1787879035643';

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

function roiRatio(file, roi, isBad) {
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
      n += 1;
      if (isBad(data[i], data[i + 1], data[i + 2])) bad += 1;
    }
  }
  return { bad, n, ratio: bad / n };
}

/** 眼窝内角大块纯黑（display12–14 方块伪影） */
function eyeBlackBlockRatio(file) {
  const left = roiRatio(file, { x0: 0.44, x1: 0.5, y0: 0.26, y1: 0.34 }, (r, g, b) => r + g + b < 8);
  const right = roiRatio(file, { x0: 0.5, x1: 0.56, y0: 0.26, y1: 0.34 }, (r, g, b) => r + g + b < 8);
  return { left, right, ratio: Math.max(left.ratio, right.ratio) };
}

function pupilRoiMean(file, roi) {
  const { width: w, height: h, data } = decodePngRGBA(fs.readFileSync(file));
  const x0 = Math.floor(w * roi.x0);
  const x1 = Math.floor(w * roi.x1);
  const y0 = Math.floor(h * roi.y0);
  const y1 = Math.floor(h * roi.y1);
  let sr = 0;
  let sg = 0;
  let sb = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4;
      sr += data[i];
      sg += data[i + 1];
      sb += data[i + 2];
      n += 1;
    }
  }
  return { r: sr / n, g: sg / n, b: sb / n, n };
}

function isMuscleRedPupil(r, g, b) {
  if (r > 190 && g < 85 && b < 85) return true;
  if (r > 110 && g < 100 && r > g + 28 && r > b + 18) return true;
  return false;
}

function pupilCompareRef(refFile, alignFile) {
  const roiL = { x0: 0.478, x1: 0.494, y0: 0.318, y1: 0.338 };
  const roiR = { x0: 0.518, x1: 0.534, y0: 0.318, y1: 0.338 };
  const refL = pupilRoiMean(refFile, roiL);
  const refR = pupilRoiMean(refFile, roiR);
  const alL = pupilRoiMean(alignFile, roiL);
  const alR = pupilRoiMean(alignFile, roiR);
  const badL = isMuscleRedPupil(alL.r, alL.g, alL.b) || alL.r > refL.r + 30;
  const badR = isMuscleRedPupil(alR.r, alR.g, alR.b) || alR.r > refR.r + 30;
  return { refL, refR, alL, alR, pass: !badL && !badR };
}

function pupilRedRatio(file) {
  const isRed = (r, g, b) => isMuscleRedPupil(r, g, b);
  const left = roiRatio(file, { x0: 0.478, x1: 0.494, y0: 0.318, y1: 0.338 }, isRed);
  const right = roiRatio(file, { x0: 0.518, x1: 0.534, y0: 0.318, y1: 0.338 }, isRed);
  return { left, right, ratio: Math.max(left.ratio, right.ratio) };
}

function muscleVisibleRatio(file) {
  return roiRatio(file, { x0: 0.12, x1: 0.42, y0: 0.34, y1: 0.56 }, (r, g, b) => {
    return r > 90 && r > g + 10 && r > b + 10;
  });
}

function writeCompareHtml(report) {
  const checks = report.checks
    .map((c) => `<li class="${c.pass ? 'pass' : 'fail'}">${c.pass ? '✓' : '✗'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}</li>`)
    .join('\n');
  const html = `<!doctype html>
<meta charset="utf-8">
<title>欧版显示对比确认 · ${EXPECT_REV}</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;font-family:"Microsoft YaHei","PingFang SC",sans-serif;background:#0a0a0f;color:#e8e8ef}
  header{padding:16px 20px;border-bottom:1px solid #2a2a38}
  h1{font-size:18px;margin:0 0 6px}
  .meta{font-size:13px;color:#9aa0b4}
  .ok{color:#6fdc8c}.bad{color:#ff7b7b}
  main{padding:16px 20px 32px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  figure{margin:0;background:#050508;border:1px solid #2a2a38;border-radius:8px;overflow:hidden}
  figcaption{padding:10px 12px;font-size:13px;background:#12121a;border-top:1px solid #2a2a38}
  img{display:block;width:100%;height:auto;background:#050508}
  ul{margin:12px 0 0;padding-left:20px;font-size:14px;line-height:1.7}
  .pass{color:#6fdc8c}.fail{color:#ff7b7b}
  .note{margin-top:16px;padding:12px 14px;background:#14141f;border-radius:8px;font-size:13px;color:#b8bdd0;line-height:1.6}
</style>
<header>
  <h1>欧版显示对比确认</h1>
  <p class="meta">构建 <strong>${report.displayRev}</strong> · 历史 ${USER_HIST_ID} · 仅欧版 · GNM55/欧版100 · 关路标 · 正视</p>
  <p class="meta ${report.ok ? 'ok' : 'bad'}">${report.ok ? '自动化门禁：通过（请仍肉眼核对下图）' : '自动化门禁：未通过 — 请勿交付用户'}</p>
</header>
<main>
  <div class="grid">
    <figure>
      <img src="01-glb-manager-ref.png" alt="GLB 管理器参考">
      <figcaption>左：GLB 管理器（model-viewer · neutral · exposure=1）— 正确参考</figcaption>
    </figure>
    <figure>
      <img src="02-align-overlay.png" alt="叠显页">
      <figcaption>右：叠显页 Three.js（${EXPECT_REV}）</figcaption>
    </figure>
  </div>
  <ul>${checks}</ul>
  <div class="note">
    说明：左侧为 GLB 管理器同款 PBR 参考；右侧为叠显页在用户条件下的截图。
    若右眼窝出现大块黑方块、瞳孔发红、肌肉被头骨盖住，整体验收 FAIL。
    生成时间：${new Date().toLocaleString('zh-CN')}
  </div>
</main>`;
  fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf8');
}

async function shotGlbRef(page) {
  await page.goto(GLB_REF, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(3000);
  const mv = page.locator('model-viewer');
  await mv.waitFor({ state: 'visible', timeout: 60000 });
  const box = await mv.boundingBox();
  const out = path.join(outDir, '01-glb-manager-ref.png');
  if (box) {
    await page.screenshot({ path: out, clip: box });
  } else {
    await page.screenshot({ path: out, fullPage: true });
  }
  return out;
}

async function shotAlign(page) {
  await page.addInitScript(() => {
    window.__ALIGN_DISABLE_MV_OVERLAY__ = true;
  });
  await page.goto(ALIGN, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForSelector('#loading', { state: 'hidden', timeout: 240000 });
  await page.waitForTimeout(1500);
  await page.evaluate(async (histId) => {
    const ed = window.__alignOverlayApp?.lmEditor;
    const hit = await ed._fetchHistoryEntry({ id: histId });
    ed.applyHistoryEntry(hit, { statusPrefix: '对比确认' });
  }, USER_HIST_ID);
  await page.waitForTimeout(600);
  await page.evaluate(() => {
    window.__alignOverlayApp.setModelViewMode('euro');
    document.querySelector('#op-gnm').value = '55';
    document.querySelector('#op-euro').value = '100';
    document.querySelector('#op-gnm').dispatchEvent(new Event('input'));
    document.querySelector('#op-euro').dispatchEvent(new Event('input'));
    const chk = document.querySelector('#chk-landmarks');
    if (chk) {
      chk.checked = false;
      chk.dispatchEvent(new Event('change'));
    }
    window.__alignOverlayApp.setView('front');
    window.__alignOverlayApp.frameHead();
  });
  await page.waitForTimeout(1000);
  const out = path.join(outDir, '02-align-overlay.png');
  const box = await page.locator('#viewport-wrap').boundingBox();
  if (box) {
    await page.screenshot({ path: out, clip: box });
  } else {
    await page.screenshot({ path: out });
  }
  const probe = await page.evaluate((expectRev) => ({
    displayRev: window.__alignOverlayApp?.displayRev || '',
    irisType:
      window.__alignOverlayApp?.euroMeshes?.find((m) => /acs_0/i.test(m.name) && !/leca/i.test(m.name))?.material
        ?.type || '',
    pupilDiscs:
      window.__alignOverlayApp?.euroMeshes
        ?.find((m) => /acs_0/i.test(m.name) && !/leca/i.test(m.name))
        ?.children?.filter((c) => c.userData?._euroPupilDisc)?.length || 0,
    muscleMeshes: (window.__alignOverlayApp?.euroMeshes || [])
      .filter((m) => /plastyma|deform|skiedras/i.test(m.name))
      .map((m) => ({ name: m.name, visible: m.visible, renderOrder: m.renderOrder })),
  }), EXPECT_REV);
  return { out, probe };
}

function openInBrowser(fileUrl) {
  const url = fileUrl.replace(/\\/g, '/');
  if (process.platform === 'win32') {
    execSync(`cmd.exe /c start "" "${url}"`, { stdio: 'inherit' });
  } else if (process.platform === 'darwin') {
    execSync(`open "${url}"`, { stdio: 'inherit' });
  } else {
    execSync(`xdg-open "${url}"`, { stdio: 'inherit' });
  }
}

async function main() {
  const report = { ok: true, checks: [], displayRev: EXPECT_REV, outDir };
  const check = (name, pass, detail) => {
    report.checks.push({ name, pass: !!pass, detail: detail || '' });
    if (!pass) report.ok = false;
    console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  };

  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

  console.log('GLB ref:', GLB_REF);
  await shotGlbRef(page);

  console.log('Align:', ALIGN);
  const { probe } = await shotAlign(page);
  await browser.close();

  const refShot = path.join(outDir, '01-glb-manager-ref.png');
  const alignShot = path.join(outDir, '02-align-overlay.png');
  const black = eyeBlackBlockRatio(alignShot);
  const red = pupilRedRatio(alignShot);
  const muscle = muscleVisibleRatio(alignShot);
  const pupilCmp = pupilCompareRef(refShot, alignShot);

  check('display rev', probe.displayRev === EXPECT_REV, `got=${probe.displayRev}`);
  check(
    'iris PBR (like model-viewer)',
    /Standard|Physical/.test(probe.irisType),
    probe.irisType
  );
  check('iris pupil hole discs', probe.pupilDiscs >= 2, `discs=${probe.pupilDiscs}`);
  check(
    'muscle layers visible',
    probe.muscleMeshes?.length >= 2 && probe.muscleMeshes.every((m) => m.visible),
    JSON.stringify(probe.muscleMeshes)
  );
  check('no eye black blocks', black.ratio < 0.006, `L=${black.left.ratio.toFixed(4)} R=${black.right.ratio.toFixed(4)}`);
  check('no pupil red bleed', red.ratio < 0.02, `L=${red.left.ratio.toFixed(4)} R=${red.right.ratio.toFixed(4)}`);
  check(
    'pupil color vs GLB ref',
    pupilCmp.pass,
    `L ref=${pupilCmp.refL.r.toFixed(1)} align=${pupilCmp.alL.r.toFixed(1)} · R ref=${pupilCmp.refR.r.toFixed(1)} align=${pupilCmp.alR.r.toFixed(1)}`
  );
  check('muscle visible in viewport', muscle.ratio >= 0.012, `ratio=${muscle.ratio.toFixed(4)}`);

  report.stats = { probe, black, red, muscle, pupilCmp };
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  writeCompareHtml(report);

  const indexPath = path.join(outDir, 'index.html');
  const fileUrl = `file:///${indexPath.replace(/\\/g, '/')}`;
  console.log('\nCOMPARE PAGE', report.ok ? 'PASS' : 'FAIL', outDir);
  console.log('Opening:', fileUrl);
  openInBrowser(fileUrl);
  process.exit(report.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
