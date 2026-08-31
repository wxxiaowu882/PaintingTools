/**
 * 截图验收东亚身份预设
 * BASE_URL=http://127.0.0.1:18080 node scripts/gnm-asian-presets-verify.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const RUNS = path.resolve(__dirname, '../runs');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = path.join(RUNS, `${stamp}-asian-presets-verify`);
fs.mkdirSync(outDir, { recursive: true });

const BASE = process.env.BASE_URL || 'http://127.0.0.1:18080';
const PAGE =
  BASE.replace(/\/$/, '') +
  '/%E8%87%AA%E7%94%A8%E5%B7%A5%E5%85%B7%E6%96%87%E4%BB%B6_%E4%B8%8D%E9%83%A8%E7%BD%B2/GNM%E5%A4%B4%E6%A8%A1%E5%B7%A5%E5%9D%8A/?v=20260831-asian11';

const BAKE_REPORT = path.resolve(
  __dirname,
  '../../../自用工具文件_不部署/GNM头模工坊/scripts/_bake_asian_report.json'
);
const bakeReport = fs.existsSync(BAKE_REPORT)
  ? JSON.parse(fs.readFileSync(BAKE_REPORT, 'utf8'))
  : null;

const PRESETS = [
  { label: '均值中性', gate: 'neutral', id: 'identity-01-mean' },
  { label: '东亚男·北方面中', gate: 'adult', id: 'identity-as01-male-north' },
  { label: '东亚男·南方阔面', gate: 'adult', id: 'identity-as02-male-south' },
  { label: '东亚男·宽颧方颌', gate: 'adult', id: 'identity-as03-male-jaw' },
  { label: '东亚女·温润鹅蛋', gate: 'adult', id: 'identity-as04-female-soft' },
  { label: '东亚女·初恋清纯', gate: 'beauty_first', id: 'identity-as05-female-oval' },
  { label: '东亚女·元气幼幼', gate: 'beauty_loli', id: 'identity-as06-female-youth' },
  { label: '美女·瓜子温润', gate: 'beauty_classic', id: 'identity-as10-female-vline' },
  { label: '美女·初恋留白', gate: 'beauty_first', id: 'identity-as11-female-heart' },
  { label: '美女·丹凤古典', gate: 'beauty_classic', id: 'identity-as12-female-doe-eye' },
  { label: '美女·甜美萝莉', gate: 'beauty_loli', id: 'identity-as13-female-sweet' },
  { label: '美女·幼幼元气', gate: 'beauty_yoyou', id: 'identity-as14-female-classic' },
  { label: '美女·漫画大眼', gate: 'beauty_loli', id: 'identity-as15-female-petite' },
  { label: '美女·温婉古典', gate: 'beauty_classic', id: 'identity-as16-female-grace' },
  { label: '美女·清冷疏朗', gate: 'beauty_classic_long', id: 'identity-as17-female-cool' },
  { label: '幼态·大眼童颜（5–8）', gate: 'child', id: 'identity-as07-child-wide' },
  { label: '幼态·圆颅饱满（7–10）', gate: 'child', id: 'identity-as08-child-round' },
  { label: '幼态·少年（11–14）', gate: 'tween', id: 'identity-as09-child-tween' },
];

function analyzePngBuffer(buf) {
  // minimal PNG IHDR parse + raw RGBA scan (only for our screenshots)
  if (buf[0] !== 0x89) return null;
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  // decompress: use zlib from node
  const zlib = require('zlib');
  let raw;
  try {
    const idat = [];
    let p = 8;
    while (p < buf.length) {
      const len = buf.readUInt32BE(p);
      const type = buf.toString('ascii', p + 4, p + 8);
      if (type === 'IDAT') idat.push(buf.subarray(p + 8, p + 8 + len));
      p += 12 + len;
    }
    raw = zlib.inflateSync(Buffer.concat(idat));
  } catch {
    return { mode: 'png-decode-fail' };
  }
  const stride = 1 + w * 4;
  let minX = w, maxX = 0, minY = h, maxY = 0;
  let eyeDark = 0, eyeTotal = 0;
  for (let y = 0; y < h; y++) {
    const row = y * stride + 1;
    for (let x = 0; x < w; x++) {
      const i = row + x * 4;
      const r = raw[i], g = raw[i + 1], b = raw[i + 2];
      const lum = (r + g + b) / 3;
      if (lum > 30 && lum < 235) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  const bw = maxX - minX;
  const bh = maxY - minY;
  if (bw <= 0 || bh <= 0) return { mode: 'empty', w, h };
  const y0 = minY + bh * 0.36;
  const y1 = minY + bh * 0.56;
  for (let y = Math.floor(y0); y < Math.floor(y1); y++) {
    const row = y * stride + 1;
    for (let x = minX; x <= maxX; x++) {
      eyeTotal++;
      const i = row + x * 4;
      const lum = (raw[i] + raw[i + 1] + raw[i + 2]) / 3;
      if (lum < 55) eyeDark++;
    }
  }
  return {
    mode: 'png',
    aspect: +(bw / bh).toFixed(4),
    eyeDarkRatio: +(eyeDark / (eyeTotal || 1)).toFixed(4),
    headHratio: +(bh / h).toFixed(4),
  };
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const report = { ok: true, presets: [], outDir, neutralEyeToFace: bakeReport?.neutral?.eyeToFace ?? null };

  await page.goto(PAGE, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForSelector('#loading-overlay', { state: 'hidden', timeout: 180000 });
  await page.waitForTimeout(1200);

  await page.evaluate(() => {
    const cb = document.getElementById('muscle-enable');
    if (cb?.checked) cb.click();
    const op = document.getElementById('muscle-opacity');
    if (op) {
      op.value = '0';
      op.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await page.locator('.preset-rail-tab[data-preset-tab="identity"]').click();
  await page.waitForTimeout(300);

  for (const preset of PRESETS) {
    const clicked = await page.evaluate((label) => {
      const chips = [...document.querySelectorAll('#preset-rail-body .preset-chip-label')];
      const el = chips.find((c) => c.textContent.trim() === label);
      if (!el) return false;
      el.closest('button')?.click();
      return true;
    }, preset.label);

    await page.waitForTimeout(1000);
    const status = await page.locator('#status-text').textContent();
    const slug = preset.label.replace(/[^\w\u4e00-\u9fff]+/g, '_').slice(0, 40);
    const shot = path.join(outDir, `${slug}.png`);
    await page.locator('#viewport-wrap').screenshot({ path: shot });
    const metrics = analyzePngBuffer(fs.readFileSync(shot));

    const baked = bakeReport?.baked?.find((b) => b.id === preset.id);
    const geo = baked?.metrics || null;

    let pass = clicked && /预设|就绪/.test(status || '');
    if (preset.gate === 'child') {
      pass = pass && geo && geo.eyeToFace >= 0.465;
      if (geo) metrics.geoEyeToFace = geo.eyeToFace;
    }
    if (preset.gate === 'tween') {
      pass = pass && geo && geo.eyeToFace >= 0.4;
      if (geo) metrics.geoEyeToFace = geo.eyeToFace;
    }
    if (preset.gate === 'beauty_classic' && geo) {
      pass = pass && geo.eyeToFace >= 0.338 && geo.eyeToFace <= 0.42;
      metrics.geoEyeToFace = geo.eyeToFace;
    }
    if (preset.gate === 'beauty_classic_long' && geo) {
      pass = pass && geo.eyeToFace >= 0.332 && geo.eyeToFace <= 0.38;
      pass = pass && geo.faceIndex >= 1.26;
      metrics.geoEyeToFace = geo.eyeToFace;
      metrics.geoFaceIndex = geo.faceIndex;
    }
    if (preset.gate === 'beauty_loli' && geo) {
      pass = pass && geo.eyeToFace >= 0.405;
      metrics.geoEyeToFace = geo.eyeToFace;
    }
    if (preset.gate === 'beauty_yoyou' && geo) {
      pass = pass && geo.eyeToFace >= 0.38 && geo.faceIndex >= 1.45;
      metrics.geoEyeToFace = geo.eyeToFace;
      metrics.geoFaceIndex = geo.faceIndex;
    }
    if (preset.gate === 'beauty_first' && geo) {
      pass = pass && geo.eyeToFace <= 0.38;
      metrics.geoEyeToFace = geo.eyeToFace;
    }
    if (preset.gate === 'neutral' && geo) metrics.geoEyeToFace = geo.eyeToFace;

    if (!pass) report.ok = false;
    report.presets.push({
      label: preset.label,
      gate: preset.gate,
      ok: pass,
      status: (status || '').trim(),
      screenshot: shot,
      metrics,
    });
    console.log(pass ? '✓' : '✗', preset.label, metrics);
  }

  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  await browser.close();
  console.log('\nOUT', outDir);
  process.exit(report.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
