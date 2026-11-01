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
const srcFull = path.join(resRoot, 'mipmap-xxxhdpi/ic_launcher.png');
const srcFg = path.join(resRoot, 'drawable/ic_launcher_foreground.png');
fs.mkdirSync(runs, { recursive: true });

async function contentBBox(buf, w, h, threshold = 14) {
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;
  let found = false;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = buf[i + 3];
      const lum = (buf[i] + buf[i + 1] + buf[i + 2]) / 3;
      if (a > 20 && lum > threshold) {
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
  const left = Math.max(0, minX - pad);
  const top = Math.max(0, minY - pad);
  const right = Math.min(w - 1, maxX + pad);
  const bottom = Math.min(h - 1, maxY + pad);
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

function applyRoundCornersAA(data, size, radiusPx) {
  const r = Math.max(1, radiusPx);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
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
      if (!corner) continue;
      const dist = Math.hypot(x - cx, y - cy);
      if (dist > r + 0.75) data[i + 3] = 0;
      else if (dist > r - 0.75) {
        const t = (r + 0.75 - dist) / 1.5;
        data[i + 3] = Math.round(data[i + 3] * Math.max(0, Math.min(1, t)));
      }
    }
  }
}

async function makeFavicon(size, opts = {}) {
  const fill = opts.fill ?? 0.96;
  const radiusRatio = opts.radiusRatio ?? 0.16;
  const shiftDownRatio = opts.shiftDownRatio ?? 0.055;
  const hi = Math.max(size * 4, 128);
  const meta = await sharp(srcFull).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const bbox = await contentBBox(meta.data, meta.info.width, meta.info.height);
  const crop = await sharp(srcFull)
    .extract(bbox)
    .modulate({ brightness: 1.28, saturation: 1.55 })
    .linear(1.1, 10)
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
  const composed = await sharp({
    create: { width: hi, height: hi, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } },
  })
    .composite([{ input: subject, left, top }])
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  applyRoundCornersAA(composed.data, hi, hi * radiusRatio);
  return sharp(composed.data, { raw: { width: hi, height: hi, channels: 4 } })
    .resize(size, size, { kernel: sharp.kernel.lanczos3 })
    .png();
}

async function makeAppFull(size, opts = {}) {
  const fill = opts.fill ?? 0.86;
  const shiftDownRatio = opts.shiftDownRatio ?? 0.05;
  const sat = opts.saturation ?? 1.12;
  const meta = await sharp(srcFull).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const bbox = await contentBBox(meta.data, meta.info.width, meta.info.height);
  const crop = await sharp(srcFull)
    .extract(bbox)
    .modulate({ brightness: 1.06, saturation: sat })
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
  const meta = await sharp(srcFg).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const bbox = await contentBBox(meta.data, meta.info.width, meta.info.height, 10);
  const crop = await sharp(srcFg)
    .extract(bbox)
    .modulate({ brightness: 1.05, saturation: 1.12 })
    .png()
    .toBuffer();
  const fill = 0.62;
  const inner = Math.round(size * fill);
  const subject = await sharp(crop)
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .png()
    .toBuffer();
  const shiftY = Math.round(size * 0.045);
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
  if (!fs.existsSync(srcFull)) throw new Error('missing srcFull ' + srcFull);
  if (!fs.existsSync(srcFg)) throw new Error('missing srcFg ' + srcFg);

  // Backup originals once if not present
  const bakFull = srcFull + '.bak-before-v2';
  const bakFg = srcFg + '.bak-before-v2';
  if (!fs.existsSync(bakFull)) fs.copyFileSync(srcFull, bakFull);
  if (!fs.existsSync(bakFg)) fs.copyFileSync(srcFg, bakFg);

  // Use backups as stable source so re-runs don't compound shifts
  const srcFullStable = bakFull;
  const srcFgStable = bakFg;

  // Patch module-level paths by rebinding via local vars in helpers below
  global.__ICON_SRC_FULL = srcFullStable;
  global.__ICON_SRC_FG = srcFgStable;

  async function makeFavicon2(size, opts = {}) {
    const fill = opts.fill ?? 0.96;
    const radiusRatio = opts.radiusRatio ?? 0.16;
    const shiftDownRatio = opts.shiftDownRatio ?? 0.055;
    const hi = Math.max(size * 4, 128);
    const meta = await sharp(srcFullStable).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const bbox = await contentBBox(meta.data, meta.info.width, meta.info.height);
    const crop = await sharp(srcFullStable)
      .extract(bbox)
      .modulate({ brightness: 1.28, saturation: 1.55 })
      .linear(1.1, 10)
      .png()
      .toBuffer();
    const inner = Math.max(8, Math.round(hi * fill));
    const subject = await sharp(crop)
      .resize(inner, inner, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 1 },
      })
      .png()
      .toBuffer();
    const shiftY = Math.round(hi * shiftDownRatio);
    const left = Math.round((hi - inner) / 2);
    const top = Math.min(hi - inner, Math.round((hi - inner) / 2) + shiftY);
    const composed = await sharp({
      create: {
        width: hi,
        height: hi,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 1 },
      },
    })
      .composite([{ input: subject, left, top }])
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    applyRoundCornersAA(composed.data, hi, hi * radiusRatio);
    return sharp(composed.data, { raw: { width: hi, height: hi, channels: 4 } })
      .resize(size, size, { kernel: sharp.kernel.lanczos3 })
      .png();
  }

  async function makeAppFull2(size, opts = {}) {
    const fill = opts.fill ?? 0.86;
    const shiftDownRatio = opts.shiftDownRatio ?? 0.05;
    const sat = opts.saturation ?? 1.12;
    const meta = await sharp(srcFullStable).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const bbox = await contentBBox(meta.data, meta.info.width, meta.info.height);
    const crop = await sharp(srcFullStable)
      .extract(bbox)
      .modulate({ brightness: 1.06, saturation: sat })
      .png()
      .toBuffer();
    const inner = Math.max(8, Math.round(size * fill));
    const subject = await sharp(crop)
      .resize(inner, inner, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 1 },
      })
      .png()
      .toBuffer();
    const shiftY = Math.round(size * shiftDownRatio);
    const left = Math.round((size - inner) / 2);
    const top = Math.min(size - inner, Math.round((size - inner) / 2) + shiftY);
    return sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 1 },
      },
    })
      .composite([{ input: subject, left, top }])
      .png();
  }

  async function makeForeground2(size) {
    const meta = await sharp(srcFgStable).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const bbox = await contentBBox(meta.data, meta.info.width, meta.info.height, 10);
    const crop = await sharp(srcFgStable)
      .extract(bbox)
      .modulate({ brightness: 1.05, saturation: 1.12 })
      .png()
      .toBuffer();
    const fill = 0.62;
    const inner = Math.round(size * fill);
    const subject = await sharp(crop)
      .resize(inner, inner, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .ensureAlpha()
      .png()
      .toBuffer();
    const shiftY = Math.round(size * 0.045);
    const left = Math.round((size - inner) / 2);
    const top = Math.min(size - inner, Math.round((size - inner) / 2) + shiftY);
    return sharp({
      create: {
        width: size,
        height: size,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([{ input: subject, left, top }])
      .png();
  }

  const favSpecs = [
    [16, 'favicon-16.png', { fill: 0.98, radiusRatio: 0.15, shiftDownRatio: 0.06 }],
    [32, 'favicon-32.png', { fill: 0.96, radiusRatio: 0.16, shiftDownRatio: 0.055 }],
    [48, 'favicon-48.png', { fill: 0.95, radiusRatio: 0.16, shiftDownRatio: 0.055 }],
    [180, 'apple-touch-icon.png', { fill: 0.92, radiusRatio: 0.17, shiftDownRatio: 0.05 }],
    [192, 'favicon-192.png', { fill: 0.92, radiusRatio: 0.17, shiftDownRatio: 0.05 }],
    [512, 'favicon-512.png', { fill: 0.9, radiusRatio: 0.17, shiftDownRatio: 0.05 }],
  ];
  for (const [s, name, opt] of favSpecs) {
    await (await makeFavicon2(s, opt)).toFile(path.join(brandDir, name));
  }
  const f32 = await (
    await makeFavicon2(32, { fill: 0.96, radiusRatio: 0.16, shiftDownRatio: 0.055 })
  )
    .png()
    .toBuffer();
  fs.writeFileSync(path.join(repo, 'favicon.ico'), f32);
  await (
    await makeFavicon2(180, { fill: 0.92, radiusRatio: 0.17, shiftDownRatio: 0.05 })
  ).toFile(path.join(repo, 'apple-touch-icon.png'));

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
      .replace(/\?v=fav2/g, '?v=fav3')
      .replace(/GlobalMenu\.js\?v=brandicon2/g, 'GlobalMenu.js?v=brandicon3');
    if (t2 !== t) {
      fs.writeFileSync(f, t2);
      console.log('bump', path.relative(repo, f));
    }
  }

  const f64 = await (
    await makeFavicon2(64, { fill: 0.96, radiusRatio: 0.16, shiftDownRatio: 0.055 })
  )
    .png()
    .toBuffer();
  const f256 = await (
    await makeFavicon2(256, { fill: 0.92, radiusRatio: 0.17, shiftDownRatio: 0.05 })
  )
    .png()
    .toBuffer();
  await qaOnLight(f64, 220, path.join(runs, 'favicon-v5-64-light.png'));
  await qaOnLight(f256, 320, path.join(runs, 'favicon-v5-256-light.png'));
  fs.writeFileSync(path.join(runs, 'favicon-v5-32.png'), f32);

  const dens = [
    ['mipmap-mdpi', 48],
    ['mipmap-hdpi', 72],
    ['mipmap-xhdpi', 96],
    ['mipmap-xxhdpi', 144],
    ['mipmap-xxxhdpi', 192],
  ];
  for (const [dir, size] of dens) {
    const out = path.join(resRoot, dir);
    await (await makeAppFull2(size)).toFile(path.join(out, 'ic_launcher.png'));
    const hi = size * 4;
    const fullHi = await (await makeAppFull2(hi)).png().toBuffer();
    const { data } = await sharp(fullHi).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const cx = (hi - 1) / 2;
    const cy = (hi - 1) / 2;
    const r = hi / 2 - 0.5;
    for (let y = 0; y < hi; y++) {
      for (let x = 0; x < hi; x++) {
        const i = (y * hi + x) * 4;
        const dist = Math.hypot(x - cx, y - cy);
        if (dist > r + 0.75) data[i + 3] = 0;
        else if (dist > r - 0.75) {
          const t = (r + 0.75 - dist) / 1.5;
          data[i + 3] = Math.round(data[i + 3] * Math.max(0, Math.min(1, t)));
        }
      }
    }
    await sharp(data, { raw: { width: hi, height: hi, channels: 4 } })
      .resize(size, size, { kernel: sharp.kernel.lanczos3 })
      .png()
      .toFile(path.join(out, 'ic_launcher_round.png'));
  }
  await (await makeForeground2(432)).toFile(path.join(resRoot, 'drawable/ic_launcher_foreground.png'));

  const app192 = await fs.promises.readFile(path.join(resRoot, 'mipmap-xxxhdpi/ic_launcher.png'));
  await qaOnLight(app192, 280, path.join(runs, 'appicon-v2-192-light.png'));
  const fg = await fs.promises.readFile(path.join(resRoot, 'drawable/ic_launcher_foreground.png'));
  const fgShow = await sharp({
    create: { width: 280, height: 280, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .composite([
      {
        input: await sharp(fg).resize(280, 280).png().toBuffer(),
        left: 0,
        top: 0,
      },
    ])
    .png()
    .toBuffer();
  await qaOnLight(fgShow, 320, path.join(runs, 'appicon-fg-v2-light.png'));

  console.log(JSON.stringify({ ok: true, fav: 'v5', app: 'shifted+sat' }));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
