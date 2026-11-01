const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const repo = path.resolve(__dirname, '..', '..', '..');
const runs = path.join(repo, '.cursor/browser-automation/runs');
const brandDir = path.join(repo, 'docs/img/brand');
const resRoot = path.join(
  repo,
  '自用工具文件_不部署/android-webview-shell/app/src/main/res'
);
const srcFull = path.join(resRoot, 'mipmap-xxxhdpi/ic_launcher.png.bak-before-v2');
const srcFg = path.join(resRoot, 'drawable/ic_launcher_foreground.png.bak-before-v2');
// fallback if bak missing
const srcFullLive = path.join(resRoot, 'mipmap-xxxhdpi/ic_launcher.png');
const srcFgLive = path.join(resRoot, 'drawable/ic_launcher_foreground.png');

fs.mkdirSync(runs, { recursive: true });

async function contentBBox(buf, w, h, threshold = 14) {
  let minX = w,
    minY = h,
    maxX = 0,
    maxY = 0,
    found = false;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (buf[i + 3] > 20 && (buf[i] + buf[i + 1] + buf[i + 2]) / 3 > threshold) {
        found = true;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (!found) return { left: 0, top: 0, width: w, height: h };
  const pad = Math.max(1, Math.round(Math.max(w, h) * 0.01));
  return {
    left: Math.max(0, minX - pad),
    top: Math.max(0, minY - pad),
    width: Math.min(w - 1, maxX + pad) - Math.max(0, minX - pad) + 1,
    height: Math.min(h - 1, maxY + pad) - Math.max(0, minY - pad) + 1,
  };
}

function roundRectSvg(size, r) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
      `<rect x="0" y="0" width="${size}" height="${size}" rx="${r}" ry="${r}" fill="#fff"/>` +
      `</svg>`
  );
}

async function makeFavicon(size, opts = {}) {
  const src = fs.existsSync(srcFull) ? srcFull : srcFullLive;
  const fill = opts.fill ?? 0.94;
  const radiusRatio = opts.radiusRatio ?? 0.11;
  const shiftDownRatio = opts.shiftDownRatio ?? 0.09;
  const hi = Math.max(size * 8, 256);

  const meta = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const bbox = await contentBBox(meta.data, meta.info.width, meta.info.height);
  const crop = await sharp(src)
    .extract(bbox)
    .modulate({ brightness: 1.22, saturation: 1.48 })
    .linear(1.08, 8)
    .png()
    .toBuffer();

  const inner = Math.max(8, Math.round(hi * fill));
  const subject = await sharp(crop)
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 1 } })
    .png()
    .toBuffer();

  const shiftY = Math.round(hi * shiftDownRatio);
  const left = Math.round((hi - inner) / 2);
  const top = Math.min(hi - inner, Math.round((hi - inner) / 2) + shiftY);

  const base = await sharp({
    create: { width: hi, height: hi, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
  })
    .composite([{ input: subject, left, top }])
    .png()
    .toBuffer();

  const r = Math.round(hi * radiusRatio);
  const mask = await sharp(roundRectSvg(hi, r)).resize(hi, hi).ensureAlpha().png().toBuffer();
  const rounded = await sharp(base)
    .ensureAlpha()
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();

  return sharp(rounded).resize(size, size, { kernel: sharp.kernel.lanczos3 }).png();
}

async function makeAppFull(size, opts = {}) {
  const src = fs.existsSync(srcFull) ? srcFull : srcFullLive;
  const fill = opts.fill ?? 0.84;
  const shiftDownRatio = opts.shiftDownRatio ?? 0.08;
  const sat = opts.saturation ?? 1.14;
  const meta = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const bbox = await contentBBox(meta.data, meta.info.width, meta.info.height);
  const crop = await sharp(src)
    .extract(bbox)
    .modulate({ brightness: 1.05, saturation: sat })
    .png()
    .toBuffer();
  const inner = Math.max(8, Math.round(size * fill));
  const subject = await sharp(crop)
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 1 } })
    .png()
    .toBuffer();
  const shiftY = Math.round(size * shiftDownRatio);
  const left = Math.round((size - inner) / 2);
  const top = Math.min(size - inner, Math.round((size - inner) / 2) + shiftY);
  return sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
  })
    .composite([{ input: subject, left, top }])
    .png();
}

async function makeForeground(size) {
  const src = fs.existsSync(srcFg) ? srcFg : srcFgLive;
  const meta = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const bbox = await contentBBox(meta.data, meta.info.width, meta.info.height, 10);
  const crop = await sharp(src)
    .extract(bbox)
    .modulate({ brightness: 1.04, saturation: 1.14 })
    .png()
    .toBuffer();
  const fill = 0.6;
  const inner = Math.round(size * fill);
  const subject = await sharp(crop)
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .png()
    .toBuffer();
  const shiftY = Math.round(size * 0.07);
  const left = Math.round((size - inner) / 2);
  const top = Math.min(size - inner, Math.round((size - inner) / 2) + shiftY);
  return sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: subject, left, top }])
    .png();
}

async function qaOnLight(buf, plate, out) {
  const pad = Math.round(plate * 0.12);
  const iconSize = plate - pad * 2;
  const icon = await sharp(buf).resize(iconSize, iconSize).png().toBuffer();
  await sharp({
    create: {
      width: plate,
      height: plate,
      channels: 3,
      background: { r: 236, g: 232, b: 238 },
    },
  })
    .composite([{ input: icon, left: pad, top: pad }])
    .png()
    .toFile(out);
}

(async () => {
  const favSpecs = [
    [16, 'favicon-16.png', { fill: 0.96, radiusRatio: 0.1, shiftDownRatio: 0.1 }],
    [32, 'favicon-32.png', { fill: 0.94, radiusRatio: 0.11, shiftDownRatio: 0.09 }],
    [48, 'favicon-48.png', { fill: 0.94, radiusRatio: 0.11, shiftDownRatio: 0.09 }],
    [180, 'apple-touch-icon.png', { fill: 0.9, radiusRatio: 0.12, shiftDownRatio: 0.085 }],
    [192, 'favicon-192.png', { fill: 0.9, radiusRatio: 0.12, shiftDownRatio: 0.085 }],
    [512, 'favicon-512.png', { fill: 0.88, radiusRatio: 0.12, shiftDownRatio: 0.08 }],
  ];
  for (const [s, name, opt] of favSpecs) {
    await (await makeFavicon(s, opt)).toFile(path.join(brandDir, name));
  }
  const f32 = await (
    await makeFavicon(32, { fill: 0.94, radiusRatio: 0.11, shiftDownRatio: 0.09 })
  )
    .png()
    .toBuffer();
  fs.writeFileSync(path.join(repo, 'favicon.ico'), f32);
  await (
    await makeFavicon(180, { fill: 0.9, radiusRatio: 0.12, shiftDownRatio: 0.085 })
  ).toFile(path.join(repo, 'apple-touch-icon.png'));

  // cache bump fav3 -> fav4
  const bumpFiles = [
    ...fs.readdirSync(repo).filter((f) => f.endsWith('.html')).map((f) => path.join(repo, f)),
    path.join(repo, 'docs/app/index.html'),
    path.join(repo, 'docs/AboutXStudio.html'),
    path.join(repo, 'games/ChromaWalker.html'),
    path.join(repo, 'docs/js/GlobalMenu.js'),
  ];
  for (const f of bumpFiles) {
    if (!fs.existsSync(f)) continue;
    let t = fs.readFileSync(f, 'utf8');
    const t2 = t
      .replace(/\?v=fav3/g, '?v=fav4')
      .replace(/GlobalMenu\.js\?v=brandicon3/g, 'GlobalMenu.js?v=brandicon4');
    if (t2 !== t) {
      fs.writeFileSync(f, t2);
      console.log('bump', path.relative(repo, f));
    }
  }

  const f64 = await (
    await makeFavicon(64, { fill: 0.94, radiusRatio: 0.11, shiftDownRatio: 0.09 })
  )
    .png()
    .toBuffer();
  const f256 = await (
    await makeFavicon(256, { fill: 0.9, radiusRatio: 0.12, shiftDownRatio: 0.085 })
  )
    .png()
    .toBuffer();
  await qaOnLight(f64, 220, path.join(runs, 'favicon-v6-64-light.png'));
  await qaOnLight(f256, 320, path.join(runs, 'favicon-v6-256-light.png'));
  fs.writeFileSync(path.join(runs, 'favicon-v6-32.png'), f32);

  const dens = [
    ['mipmap-mdpi', 48],
    ['mipmap-hdpi', 72],
    ['mipmap-xhdpi', 96],
    ['mipmap-xxhdpi', 144],
    ['mipmap-xxxhdpi', 192],
  ];
  for (const [dir, size] of dens) {
    const out = path.join(resRoot, dir);
    await (await makeAppFull(size)).toFile(path.join(out, 'ic_launcher.png'));
    const hi = size * 8;
    const fullHi = await (await makeAppFull(hi)).png().toBuffer();
    const mask = await sharp(
      Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${hi}" height="${hi}">` +
          `<circle cx="${hi / 2}" cy="${hi / 2}" r="${hi / 2}" fill="#fff"/></svg>`
      )
    )
      .resize(hi, hi)
      .ensureAlpha()
      .png()
      .toBuffer();
    await sharp(fullHi)
      .ensureAlpha()
      .composite([{ input: mask, blend: 'dest-in' }])
      .resize(size, size, { kernel: sharp.kernel.lanczos3 })
      .png()
      .toFile(path.join(out, 'ic_launcher_round.png'));
  }
  await (await makeForeground(432)).toFile(path.join(resRoot, 'drawable/ic_launcher_foreground.png'));

  const app192 = await fs.promises.readFile(path.join(resRoot, 'mipmap-xxxhdpi/ic_launcher.png'));
  await qaOnLight(app192, 280, path.join(runs, 'appicon-v3-192-light.png'));

  console.log(JSON.stringify({ ok: true, fav: 'v6', radius: 0.11, shift: 0.09 }));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
