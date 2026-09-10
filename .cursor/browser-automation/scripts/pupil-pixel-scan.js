const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'http://127.0.0.1:18080';
const PAGE =
  BASE.replace(/\/$/, '') +
  '/%E8%87%AA%E7%94%A8%E5%B7%A5%E5%85%B7%E6%96%87%E4%BB%B6_%E4%B8%8D%E9%83%A8%E7%BD%B2/GNM%E5%A4%B4%E6%A8%A1%E5%B7%A5%E5%9D%8A/align-overlay/';

function decodePngRGBA(buf) {
  let pos = 8;
  let width = 0;
  let height = 0;
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
    } else if (type === 'IDAT') idats.push(data);
    else if (type === 'IEND') break;
  }
  const raw = zlib.inflateSync(Buffer.concat(idats));
  const out = Buffer.alloc(width * height * 4);
  let rp = 0;
  let wp = 0;
  const bpp = 4;
  const stride = width * bpp;
  const prev = Buffer.alloc(stride);
  const row = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++];
    for (let x = 0; x < stride; x++) row[x] = raw[rp++];
    if (filter === 1) for (let x = bpp; x < stride; x++) row[x] = (row[x] + row[x - bpp]) & 255;
    else if (filter === 2) for (let x = 0; x < stride; x++) row[x] = (row[x] + prev[x]) & 255;
    else if (filter === 3) for (let x = 0; x < stride; x++) row[x] = (row[x] + ((prev[x] + (x >= bpp ? row[x - bpp] : 0)) >> 1)) & 255;
    else if (filter === 4) {
      for (let x = 0; x < stride; x++) {
        const a = x >= bpp ? row[x - bpp] : 0;
        const b = prev[x];
        const c = x >= bpp ? prev[x - bpp] : 0;
        row[x] = (row[x] + paeth(a, b, c)) & 255;
      }
    }
    row.copy(out, wp);
    wp += stride;
    row.copy(prev);
  }
  return { width, height, rgba: out };
}
function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.addInitScript(() => {
    window.__ALIGN_DISABLE_MV_OVERLAY__ = true;
  });
  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForSelector('#loading', { state: 'hidden', timeout: 240000 });
  await page.evaluate(async (histId) => {
    const ed = window.__alignOverlayApp?.lmEditor;
    const hit = await ed._fetchHistoryEntry({ id: histId });
    ed.applyHistoryEntry(hit, { statusPrefix: 'scan' });
  }, 'v_1787879035643');
  await page.waitForTimeout(800);
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
    app.setView('front');
    app.frameHead();
  });
  await page.waitForTimeout(800);
  const out = path.join(__dirname, '../runs/pupil-scan.png');
  const box = (await page.locator('#viewport-wrap').boundingBox()) || { x: 0, y: 0, width: 1080, height: 746 };
  await page.screenshot({
    path: out,
    clip: { x: box.x, y: box.y, width: box.width, height: box.height },
  });
  const { width, height, rgba } = decodePngRGBA(fs.readFileSync(out));
  const reds = [];
  const darks = [];
  for (let y = Math.floor(height * 0.15); y < Math.floor(height * 0.4); y++) {
    for (let x = Math.floor(width * 0.38); x < Math.floor(width * 0.62); x++) {
      const i = (y * width + x) * 4;
      const r = rgba[i];
      const g = rgba[i + 1];
      const b = rgba[i + 2];
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (r > 65 && r > g + 10 && r > b + 10) reds.push({ x, y, r, g, b, lum });
      if (lum < 40) darks.push({ x, y, r, g, b, lum });
    }
  }
  reds.sort((a, b) => b.r - a.r);
  darks.sort((a, b) => a.lum - b.lum);
  const norm = (p) => ({ x: p.x / width, y: p.y / height, ...p });
  const clusters = [];
  for (const p of reds) {
    let hit = null;
    for (const c of clusters) {
      if (Math.hypot(c.x - p.x, c.y - p.y) < 18) {
        hit = c;
        break;
      }
    }
    if (!hit) clusters.push({ x: p.x, y: p.y, n: 1, r: p.r });
    else {
      hit.x = (hit.x * hit.n + p.x) / (hit.n + 1);
      hit.y = (hit.y * hit.n + p.y) / (hit.n + 1);
      hit.n++;
      hit.r = Math.max(hit.r, p.r);
    }
  }
  clusters.sort((a, b) => a.x - b.x);
  console.log(
    JSON.stringify(
      {
        size: [width, height],
        redClusters: clusters.map((c) => ({ x: c.x / width, y: c.y / height, n: c.n })),
        redTop: reds.slice(0, 5).map(norm),
        darkTop: darks.slice(0, 5).map(norm),
        sampleAtRoiL: sample(0.486, 0.331),
        sampleAtRoiOld: sample(0.486, 0.331),
        sampleAtOccluderL: sample(429 / width, (276 - 0) / height),
      },
      null,
      2
    )
  );
  function sample(nx, ny) {
    const x = Math.min(width - 1, Math.max(0, Math.round(nx * width)));
    const y = Math.min(height - 1, Math.max(0, Math.round(ny * height)));
    const i = (y * width + x) * 4;
    const r = rgba[i];
    const g = rgba[i + 1];
    const b = rgba[i + 2];
    return { x, y, r, g, b, lum: 0.2126 * r + 0.7152 * g + 0.0722 * b };
  }
  await browser.close();
})();
