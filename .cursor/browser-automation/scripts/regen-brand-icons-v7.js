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

async function contentBBox(buf, w, h, threshold = 14) {
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  let found = false;
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
  const pad = Math.max(1, Math.round(Math.max(w, h) * 0.01));
  return {
    left: Math.max(0, minX - pad),
    top: Math.max(0, minY - pad),
    width: Math.min(w - 1, maxX + pad) - Math.max(0, minX - pad) + 1,
    height: Math.min(h - 1, maxY + pad) - Math.max(0, minY - pad) + 1,
  };
}

function roundMaskRaw(size, radiusRatio) {
  const data = Buffer.alloc(size * size * 4);
  const r = Math.max(1, size * radiusRatio);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      let cx = x;
      let cy = y;
      let corner = false;
      if (x < r && y < r) {
        cx = r;
        cy = r;
        corner = true;
      } else if (x >= size - r && y < r) {
        cx = size - 1 - r;
        cy = r;
        corner = true;
      } else if (x < r && y >= size - r) {
        cx = r;
        cy = size - 1 - r;
        corner = true;
      } else if (x >= size - r && y >= size - r) {
        cx = size - 1 - r;
        cy = size - 1 - r;
        corner = true;
      }
      if (!corner) {
        data[i + 3] = 255;
        continue;
      }
      const dist = Math.hypot(x - cx, y - cy);
      let a = 255;
      if (dist > r + 0.9) a = 0;
      else if (dist > r - 0.9) {
        a = Math.round(255 * Math.max(0, Math.min(1, (r + 0.9 - dist) / 1.8)));
      }
      data[i + 3] = a;
    }
  }
  return data;
}

async function makeFavicon(size, opts = {}) {
  const fill = opts.fill ?? 0.92;
  const radiusRatio = opts.radiusRatio ?? 0.1;
  const shiftDownRatio = opts.shiftDownRatio ?? 0.125;
  const hi = Math.max(size * 8, 256);
  const meta = await sharp(srcFull).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const bbox = await contentBBox(meta.data, meta.info.width, meta.info.height);
  const crop = await sharp(srcFull)
    .extract(bbox)
    .modulate({ brightness: 1.2, saturation: 1.45 })
    .linear(1.06, 6)
    .png()
    .toBuffer();
  const inner = Math.max(8, Math.round(hi * fill));
  const subject = await sharp(crop)
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 1 } })
    .png()
    .toBuffer();
  const left = Math.round((hi - inner) / 2);
  const top = Math.min(hi - inner, Math.round((hi - inner) / 2) + Math.round(hi * shiftDownRatio));
  const composed = await sharp({
    create: { width: hi, height: hi, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
  })
    .composite([{ input: subject, left, top }])
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const mask = roundMaskRaw(hi, radiusRatio);
  for (let i = 3; i < composed.data.length; i += 4) {
    composed.data[i] = Math.round((composed.data[i] * mask[i]) / 255);
  }
  return sharp(composed.data, { raw: { width: hi, height: hi, channels: 4 } })
    .resize(size, size, { kernel: sharp.kernel.lanczos3 })
    .png();
}

async function makeAppFull(size) {
  const fill = 0.82;
  const shiftDownRatio = 0.11;
  const sat = 1.14;
  const meta = await sharp(srcFull).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const bbox = await contentBBox(meta.data, meta.info.width, meta.info.height);
  const crop = await sharp(srcFull)
    .extract(bbox)
    .modulate({ brightness: 1.05, saturation: sat })
    .png()
    .toBuffer();
  const inner = Math.max(8, Math.round(size * fill));
  const subject = await sharp(crop)
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 1 } })
    .png()
    .toBuffer();
  const left = Math.round((size - inner) / 2);
  const top = Math.min(
    size - inner,
    Math.round((size - inner) / 2) + Math.round(size * shiftDownRatio)
  );
  return sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
  })
    .composite([{ input: subject, left, top }])
    .png();
}

async function makeForeground(size) {
  const meta = await sharp(srcFg).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const bbox = await contentBBox(meta.data, meta.info.width, meta.info.height, 10);
  const crop = await sharp(srcFg)
    .extract(bbox)
    .modulate({ brightness: 1.04, saturation: 1.14 })
    .png()
    .toBuffer();
  const inner = Math.round(size * 0.58);
  const subject = await sharp(crop)
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .png()
    .toBuffer();
  const left = Math.round((size - inner) / 2);
  const top = Math.min(size - inner, Math.round((size - inner) / 2) + Math.round(size * 0.1));
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
  if (!fs.existsSync(srcFull) || !fs.existsSync(srcFg)) {
    throw new Error('missing bak sources');
  }
  const favSpecs = [
    [16, 'favicon-16.png', { fill: 0.95, radiusRatio: 0.09, shiftDownRatio: 0.13 }],
    [32, 'favicon-32.png', { fill: 0.92, radiusRatio: 0.1, shiftDownRatio: 0.125 }],
    [48, 'favicon-48.png', { fill: 0.92, radiusRatio: 0.1, shiftDownRatio: 0.12 }],
    [180, 'apple-touch-icon.png', { fill: 0.88, radiusRatio: 0.11, shiftDownRatio: 0.115 }],
    [192, 'favicon-192.png', { fill: 0.88, radiusRatio: 0.11, shiftDownRatio: 0.115 }],
    [512, 'favicon-512.png', { fill: 0.86, radiusRatio: 0.11, shiftDownRatio: 0.11 }],
  ];
  for (const [s, name, opt] of favSpecs) {
    await (await makeFavicon(s, opt)).toFile(path.join(brandDir, name));
  }
  const f32 = await (
    await makeFavicon(32, { fill: 0.92, radiusRatio: 0.1, shiftDownRatio: 0.125 })
  )
    .png()
    .toBuffer();
  fs.writeFileSync(path.join(repo, 'favicon.ico'), f32);
  await (
    await makeFavicon(180, { fill: 0.88, radiusRatio: 0.11, shiftDownRatio: 0.115 })
  ).toFile(path.join(repo, 'apple-touch-icon.png'));

  const f64 = await (
    await makeFavicon(64, { fill: 0.92, radiusRatio: 0.1, shiftDownRatio: 0.125 })
  )
    .png()
    .toBuffer();
  const f256 = await (
    await makeFavicon(256, { fill: 0.88, radiusRatio: 0.11, shiftDownRatio: 0.115 })
  )
    .png()
    .toBuffer();
  await qaOnLight(f64, 220, path.join(runs, 'favicon-v7-64-light.png'));
  await qaOnLight(f256, 320, path.join(runs, 'favicon-v7-256-light.png'));
  await qaOnLight(f32, 160, path.join(runs, 'favicon-v7-32-light.png'));

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
    const hi = size * 4;
    const fullHi = await (await makeAppFull(hi))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const cx = (hi - 1) / 2;
    const cy = (hi - 1) / 2;
    const r = hi / 2 - 0.5;
    for (let y = 0; y < hi; y++) {
      for (let x = 0; x < hi; x++) {
        const i = (y * hi + x) * 4;
        const dist = Math.hypot(x - cx, y - cy);
        if (dist > r + 0.75) fullHi.data[i + 3] = 0;
        else if (dist > r - 0.75) {
          fullHi.data[i + 3] = Math.round(
            fullHi.data[i + 3] * Math.max(0, Math.min(1, (r + 0.75 - dist) / 1.5))
          );
        }
      }
    }
    await sharp(fullHi.data, { raw: { width: hi, height: hi, channels: 4 } })
      .resize(size, size, { kernel: sharp.kernel.lanczos3 })
      .png()
      .toFile(path.join(out, 'ic_launcher_round.png'));
  }
  await (await makeForeground(432)).toFile(path.join(resRoot, 'drawable/ic_launcher_foreground.png'));

  const app192 = await fs.promises.readFile(path.join(resRoot, 'mipmap-xxxhdpi/ic_launcher.png'));
  await qaOnLight(app192, 280, path.join(runs, 'appicon-v4-192-light.png'));

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
      .replace(/\?v=fav5/g, '?v=fav6')
      .replace(/GlobalMenu\.js\?v=brandicon5/g, 'GlobalMenu.js?v=brandicon6');
    if (t2 !== t) {
      fs.writeFileSync(f, t2);
      console.log('bump', path.relative(repo, f));
    }
  }
  console.log(JSON.stringify({ ok: true, ver: 'v7' }));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
