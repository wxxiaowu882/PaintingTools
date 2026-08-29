/**
 * 唇下/下颌黑斑视觉门禁：欧版 100% / GNM 0% / 关路标，截图后统计近黑中性像素。
 * 不通过则 exit 1 —— 禁止在未通过时向用户宣称已修好。
 * Usage: BASE_URL=http://127.0.0.1:18080 node scripts/gnm-align-chin-visual-gate.js
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:18080';
const PAGE =
  BASE.replace(/\/$/, '') +
  '/%E8%87%AA%E7%94%A8%E5%B7%A5%E5%85%B7%E6%96%87%E4%BB%B6_%E4%B8%8D%E9%83%A8%E7%BD%B2/GNM%E5%A4%B4%E6%A8%A1%E5%B7%A5%E5%9D%8A/align-overlay/?gate=' +
  Date.now();

const CHIN_MAX_RATIO = 0.002;
const CHIN_MAX_DARK = 8;

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

function chinStats(file) {
  const { width: w, height: h, data } = decodePngRGBA(fs.readFileSync(file));
  const regions = {
    // 唇下沟：用户主诉区
    lip: [0.38, 0.42, 0.62, 0.58],
    // 颏/下颌内侧，避开轮廓线贴背景的锯齿像素
    jaw: [0.36, 0.52, 0.64, 0.68],
  };
  const out = {};
  for (const [name, [xa, ya, xb, yb]] of Object.entries(regions)) {
    const x0 = Math.floor(w * xa);
    const x1 = Math.floor(w * xb);
    const y0 = Math.floor(h * ya);
    const y1 = Math.floor(h * yb);
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
    out[name] = { dark, n, ratio: dark / n };
  }
  return out;
}

async function main() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir = path.join(ROOT, 'runs', `${stamp}-chin-visual-gate`);
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  console.log('goto', PAGE);
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(
    () => document.querySelector('#loading')?.classList.contains('hidden'),
    null,
    { timeout: 240000 }
  );

  const meta = await page.evaluate(() => {
    const app = window.__alignOverlayApp;
    const statics = (app.euroMeshes || []).filter((m) => /static/i.test(m.name || ''));
    const muscles = (app.euroMeshes || []).filter((m) =>
      /deform|skiedras|plastyma/i.test(m.name || '')
    );
    const matInfo = (m) => {
      const mat = Array.isArray(m.material) ? m.material[0] : m.material;
      return {
        name: m.name,
        depthWrite: mat ? mat.depthWrite : null,
        po: mat ? mat.polygonOffsetFactor : null,
        order: m.renderOrder,
      };
    };
    return {
      bg: app.scene.background && app.scene.background.getHexString
        ? app.scene.background.getHexString()
        : null,
      logDepth: !!(app.renderer.capabilities && app.renderer.capabilities.logarithmicDepthBuffer),
      statics: statics.map(matInfo),
      muscles: muscles.map(matInfo),
    };
  });
  console.log('meta', JSON.stringify(meta));

  await page.fill('#op-gnm', '0');
  await page.fill('#op-euro', '100');
  await page.evaluate(() => {
    const chk = document.querySelector('#chk-landmarks');
    chk.checked = false;
    chk.dispatchEvent(new Event('change'));
  });
  await page.waitForTimeout(600);

  const chinPath = path.join(outDir, 'chin.png');
  const fullPath = path.join(outDir, 'full.png');
  await page.screenshot({
    path: chinPath,
    clip: { x: 300, y: 140, width: 480, height: 480 },
  });
  await page.screenshot({ path: fullPath, fullPage: true });

  const stats = chinStats(chinPath);
  console.log('stats', stats);

  const staticOk =
    meta.statics.length > 0 && meta.statics.every((s) => s.depthWrite === false);
  const lipOk = stats.lip.dark <= CHIN_MAX_DARK && stats.lip.ratio < CHIN_MAX_RATIO;
  const jawOk =
    stats.jaw.dark <= CHIN_MAX_DARK * 2 && stats.jaw.ratio < CHIN_MAX_RATIO * 2;
  const ok = lipOk && jawOk && staticOk;

  fs.writeFileSync(
    path.join(outDir, 'report.json'),
    JSON.stringify({ ok, meta, stats, PAGE }, null, 2)
  );
  console.log(ok ? 'CHIN VISUAL GATE PASS' : 'CHIN VISUAL GATE FAIL', outDir);
  await browser.close();
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
