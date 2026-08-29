/**
 * 叠显页浏览器验收（对齐用户截图条件）
 * Usage: BASE_URL=http://127.0.0.1:18080 node scripts/gnm-align-browser-acceptance.js
 *
 * 条件：仅欧版 · GNM55/欧版100 · 关路标 · 正视+斜侧 · 自动加载历史
 * 未通过 exit 1，截图在 runs/<stamp>-align-browser-accept/
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { chromium } = require('playwright');

const RUNS = path.resolve(__dirname, '../runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(RUNS, `${stamp}-align-browser-accept`);
fs.mkdirSync(outDir, { recursive: true });

const BASE = process.env.BASE_URL || 'http://127.0.0.1:18080';
/** 与用户截图一致：不带版本 query */
const PAGE =
  BASE.replace(/\/$/, '') +
  '/%E8%87%AA%E7%94%A8%E5%B7%A5%E5%85%B7%E6%96%87%E4%BB%B6_%E4%B8%8D%E9%83%A8%E7%BD%B2/GNM%E5%A4%B4%E6%A8%A1%E5%B7%A5%E5%9D%8A/align-overlay/';

const EXPECT_REV = '20260829-display18';
/** 与用户截图一致：历史 v_1787879035643（104点，未拧） */
const USER_HIST_ID = 'v_1787879035643';
const CHIN_DARK_MAX = 0.008;
const EYE_RED_MAX = 0.015;
const PUPIL_RED_MAX = 0.06;
const PUPIL_LUM_MAX = 45;
const MUSCLE_RED_MIN = 0.012;
const EYE_BLACK_ARTIFACT_MAX = 0.008;
const MOUTH_DARK_MAX = 0.012;

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

const chinDark = (file) =>
  roiRatio(file, { x0: 0.42, x1: 0.58, y0: 0.48, y1: 0.62 }, (r, g, b) => {
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const span = Math.max(r, g, b) - Math.min(r, g, b);
    return lum < 22 && span < 16;
  });

const eyeRed = (file) =>
  roiRatio(file, { x0: 0.46, x1: 0.54, y0: 0.28, y1: 0.36 }, (r, g, b) => {
    return r > 190 && g < 85 && b < 85;
  });

/** 瞳孔：不得有肌层品红/红褐渗出 */
function pupilBad(r, g, b) {
  if (r > 190 && g < 85 && b < 85) return true;
  if (r > 110 && g < 100 && r > g + 28 && r > b + 18) return true;
  return false;
}

function pupilGate(file) {
  const center = (roi) => roiRatio(file, roi, pupilBad);
  const left = center({ x0: 0.481, x1: 0.491, y0: 0.326, y1: 0.336 });
  const right = center({ x0: 0.521, x1: 0.531, y0: 0.326, y1: 0.336 });
  const ratio = Math.max(left.ratio, right.ratio);
  const avgLum = (left.bad + right.bad) / Math.max(1, left.n + right.n);
  return { left, right, ratio, avgLum };
}

const mouthDark = (file) =>
  roiRatio(file, { x0: 0.38, x1: 0.62, y0: 0.42, y1: 0.52 }, (r, g, b) => {
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const span = Math.max(r, g, b) - Math.min(r, g, b);
    return lum < 28 && span < 20;
  });

const muscleVisible = (file) =>
  roiRatio(file, { x0: 0.12, x1: 0.42, y0: 0.34, y1: 0.56 }, (r, g, b) => {
    return r > 90 && r > g + 10 && r > b + 10;
  });

const eyeBlackArtifact = (file) => {
  const isBlk = (r, g, b) => r + g + b < 8;
  const center = roiRatio(file, { x0: 0.47, x1: 0.53, y0: 0.28, y1: 0.32 }, isBlk);
  const left = roiRatio(file, { x0: 0.44, x1: 0.5, y0: 0.26, y1: 0.34 }, isBlk);
  const right = roiRatio(file, { x0: 0.5, x1: 0.56, y0: 0.26, y1: 0.34 }, isBlk);
  const ratio = Math.max(center.ratio, left.ratio, right.ratio);
  return { center, left, right, ratio };
};

const FACE_THREAD_MAX = 0.01;

/** 亮肌色面上的 z-fight 近黑丝 */
function faceThreadRatio(file) {
  return roiRatio(file, { x0: 0.15, x1: 0.45, y0: 0.22, y1: 0.48 }, (r, g, b) => {
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const span = Math.max(r, g, b) - Math.min(r, g, b);
    return lum > 40 && lum < 190 && lum < 26 && span < 14;
  });
}

async function shotViewport(page, name) {
  const p = path.join(outDir, name);
  const box = await page.locator('#viewport-wrap').boundingBox();
  if (box) {
    await page.screenshot({ path: p, clip: { x: box.x, y: box.y, width: box.width, height: box.height } });
  } else {
    await page.screenshot({ path: p });
  }
  return p;
}

async function main() {
  const report = { ok: true, checks: [], page: PAGE, outDir };
  const check = (name, pass, detail) => {
    report.checks.push({ name, pass: !!pass, detail: detail || '' });
    if (!pass) report.ok = false;
    console.log(`${pass ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  };

  const browser = await chromium.launch({
    headless: true,
    channel: process.env.PW_CHROME ? 'chrome' : 'chrome',
    args: ['--use-gl=angle', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(() => {
    window.__ALIGN_DISABLE_MV_OVERLAY__ = true;
  });

  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const t = msg.text();
      if (/favicon/i.test(t)) return;
      if (/Failed to load resource/i.test(t)) return;
      errors.push(t);
    }
  });
  page.on('response', (res) => {
    if (res.status() >= 400 && !/favicon\.ico/i.test(res.url())) {
      errors.push(`${res.status()} ${res.url()}`);
    }
  });

  console.log('goto', PAGE);
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForSelector('#loading', { state: 'hidden', timeout: 240000 });
  await page.waitForTimeout(2000);

  // 与用户截图一致：加载 v_1787879035643（104点，未拧）
  const histLoad = await page.evaluate(async (histId) => {
    const ed = window.__alignOverlayApp?.lmEditor;
    const hit = await ed._fetchHistoryEntry({ id: histId });
    const msg = ed.applyHistoryEntry(hit, { statusPrefix: '验收加载' });
    return {
      msg,
      warped: !!window.__alignOverlayApp._euroWarped,
      status: document.querySelector('#status-text')?.textContent || '',
    };
  }, USER_HIST_ID);
  await page.waitForTimeout(800);

  const probe = await page.evaluate((expectRev) => {
    const app = window.__alignOverlayApp;
    const iris = app?.euroMeshes?.find((m) => /acs_0/i.test(m.name) && !/leca/i.test(m.name));
    const mat = iris?.material;
    const melns = (app?.euroMeshes || []).filter((m) => /melns/i.test(m.name));
    return {
      hasApp: !!app,
      displayRev: app?.displayRev || '',
      irisType: mat?.type || '',
      irisHasMap: !!mat?.map,
      irisTransparent: !!mat?.transparent,
      irisOpacity: mat?.opacity ?? 1,
      melnsVisible: melns.some((m) => m.visible),
      hasEnv: !!app?.scene?.environment,
      status: document.querySelector('#status-text')?.textContent || '',
      euroCount: app?.euroMeshes?.length || 0,
      warped: !!app?._euroWarped,
      muscleMeshes: (app?.euroMeshes || []).filter((m) => /plastyma|deform|skiedras/i.test(m.name)).map((m) => ({
        name: m.name,
        visible: m.visible,
        renderOrder: m.renderOrder,
      })),
      pupilOccluder: (app?.scene?.userData?._pupilOccluders?.length || 0) >= 2,
      sceneSprites: app?.scene?.userData?._pupilOccluders?.length || 0,
    };
  }, EXPECT_REV);

  check('app loaded', probe.hasApp && probe.euroCount >= 5, JSON.stringify(probe));
  check('user history loaded', histLoad.msg && !histLoad.warped, JSON.stringify(histLoad));
  check('display rev', probe.displayRev === EXPECT_REV, `got=${probe.displayRev}`);
  check('iris PBR+map (like GLB mgr)', probe.irisType.includes('Standard') && probe.irisHasMap, JSON.stringify(probe));
  check(
    'muscle layers visible',
    probe.muscleMeshes?.length >= 2 && probe.muscleMeshes.every((m) => m.visible),
    JSON.stringify(probe.muscleMeshes)
  );
  check('melns hidden', !probe.melnsVisible);
  check('euro not warped', !probe.warped, `warped=${probe.warped}`);
  check('scene IBL env', probe.hasEnv);
  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

  await page.evaluate(() => {
    const app = window.__alignOverlayApp;
    app.setModelViewMode('euro');
    document.querySelector('#op-gnm').value = '55';
    document.querySelector('#op-euro').value = '100';
    document.querySelector('#op-gnm').dispatchEvent(new Event('input'));
    document.querySelector('#op-euro').dispatchEvent(new Event('input'));
    const chk = document.querySelector('#chk-landmarks');
    if (chk) {
      chk.checked = false;
      chk.dispatchEvent(new Event('change'));
    }
  });
  await page.waitForTimeout(500);

  await page.evaluate(() => {
    const app = window.__alignOverlayApp;
    app.setView('front');
    app.frameHead();
  });
  await page.waitForTimeout(800);

  const postFrame = await page.evaluate(() => ({
    sceneSprites: window.__alignOverlayApp?.scene?.userData?._pupilOccluders?.length || 0,
  }));
  check('no pupil sprites', postFrame.sceneSprites === 0, `sprites=${postFrame.sceneSprites}`);

  const front = await shotViewport(page, '01-front-euro-only.png');
  const frontChin = chinDark(front);
  const frontEye = eyeRed(front);
  const frontThread = faceThreadRatio(front);
  const frontMouth = mouthDark(front);
  const frontPupil = pupilGate(front);
  const frontMuscle = muscleVisible(front);
  const frontBlackArt = eyeBlackArtifact(front);
  check('front chin dark', frontChin.ratio < CHIN_DARK_MAX, `ratio=${frontChin.ratio.toFixed(4)}`);
  check('front mouth dark', frontMouth.ratio < MOUTH_DARK_MAX, `ratio=${frontMouth.ratio.toFixed(4)}`);
  check('front eye red bleed', frontEye.ratio < EYE_RED_MAX, `ratio=${frontEye.ratio.toFixed(4)}`);
  check(
    'front muscle visible',
    frontMuscle.ratio >= MUSCLE_RED_MIN,
    `ratio=${frontMuscle.ratio.toFixed(4)}`
  );
  check(
    'front no eye black squares',
    frontBlackArt.ratio < EYE_BLACK_ARTIFACT_MAX,
    `ratio=${frontBlackArt.ratio.toFixed(4)}`
  );
  check(
    'front pupil black (not red)',
    frontPupil.ratio < PUPIL_RED_MAX,
    `ratio=${frontPupil.ratio.toFixed(4)} L=${frontPupil.left.ratio.toFixed(3)} R=${frontPupil.right.ratio.toFixed(3)}`
  );
  check('front face thread', frontThread.ratio < FACE_THREAD_MAX, `ratio=${frontThread.ratio.toFixed(4)}`);

  await page.evaluate(() => {
    const app = window.__alignOverlayApp;
    const c = app.getHeadCenterWorld();
    app.controls.target.set(c.x, c.y, c.z);
    app.camera.position.set(c.x + 0.42, c.y + 0.05, c.z + 0.38);
    app.controls.update();
  });
  await page.waitForTimeout(800);
  const oblique = await shotViewport(page, '02-oblique-euro-only.png');
  const oblChin = chinDark(oblique);
  const oblEye = eyeRed(oblique);
  const oblThread = faceThreadRatio(oblique);
  const oblMouth = mouthDark(oblique);
  check('oblique chin dark', oblChin.ratio < CHIN_DARK_MAX, `ratio=${oblChin.ratio.toFixed(4)}`);
  check('oblique mouth dark', oblMouth.ratio < MOUTH_DARK_MAX, `ratio=${oblMouth.ratio.toFixed(4)}`);
  check('oblique eye red bleed', oblEye.ratio < EYE_RED_MAX, `ratio=${oblEye.ratio.toFixed(4)}`);
  check('oblique face thread', oblThread.ratio < FACE_THREAD_MAX, `ratio=${oblThread.ratio.toFixed(4)} bad=${oblThread.bad}`);

  report.stats = {
    histLoad,
    front: { chin: frontChin, mouth: frontMouth, eye: frontEye, pupil: frontPupil, muscle: frontMuscle, blackArt: frontBlackArt, thread: frontThread },
    oblique: { chin: oblChin, mouth: oblMouth, eye: oblEye, thread: oblThread },
    probe,
  };
  const aiEval = [
    '# 叠显浏览器验收 · AI 视觉评估',
    '',
    `构建：${probe.displayRev || '?'}`,
    `历史：${USER_HIST_ID}（104点，未拧）`,
    `条件：仅欧版 · GNM55/欧版100 · 关路标`,
    '',
    '## 截图',
    '- 01-front-euro-only.png',
    '- 02-oblique-euro-only.png',
    '',
    '## 像素门禁',
    ...report.checks.map((c) => `- ${c.pass ? 'PASS' : 'FAIL'} ${c.name}${c.detail ? ': ' + c.detail : ''}`),
    '',
    '## 人工/AI 看图结论（必看）',
    '请打开上述 PNG，重点检查：肌肉层是否可见、瞳孔是否发黑且无方块伪影、下巴/口周是否有黑斑。',
    '像素门禁仅作辅助；若截图肉眼可见瑕疵，整体验收 FAIL。',
  ].join('\n');
  fs.writeFileSync(path.join(outDir, 'ai-eval.md'), aiEval);
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();

  console.log('\nALIGN BROWSER ACCEPT', report.ok ? 'PASS' : 'FAIL', outDir);
  process.exit(report.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
