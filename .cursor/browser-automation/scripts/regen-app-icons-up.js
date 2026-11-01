/**
 * 仅重生 App 桌面图标：色立体略上移（相对上一版），饱和度仍轻微增强。
 * 不改动 favicon（用户已验收）。
 */
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const repo = path.resolve(__dirname, '..', '..', '..');
const runs = path.join(repo, '.cursor/browser-automation/runs');
const resRoot = path.join(
  repo,
  '自用工具文件_不部署/android-webview-shell/app/src/main/res'
);
const bakDir = path.join(repo, '自用工具文件_不部署/android-webview-shell/_icon_bak');
const srcFull = path.join(bakDir, 'ic_launcher.png.bak-before-v2');
const srcFg = path.join(bakDir, 'ic_launcher_foreground.png.bak-before-v2');

async function contentBBox(buf, w, h, threshold = 14) {
  let minX = w,
    minY = h,
    maxX = 0,
    maxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (buf[i + 3] > 20 && (buf[i] + buf[i + 1] + buf[i + 2]) / 3 > threshold) {
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

async function makeAppFull(size) {
  // 比 v8 的 0.13 明显上移：仅略下移一点校正源图偏上
  const fill = 0.84;
  const shiftDownRatio = 0.035;
  const sat = 1.12;
  const meta = await sharp(srcFull).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const bbox = await contentBBox(meta.data, meta.info.width, meta.info.height);
  const crop = await sharp(srcFull)
    .extract(bbox)
    .modulate({ brightness: 1.04, saturation: sat })
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
    .modulate({ brightness: 1.03, saturation: 1.12 })
    .png()
    .toBuffer();
  const inner = Math.round(size * 0.6);
  const subject = await sharp(crop)
    .resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .ensureAlpha()
    .png()
    .toBuffer();
  const left = Math.round((size - inner) / 2);
  const top = Math.min(size - inner, Math.round((size - inner) / 2) + Math.round(size * 0.03));
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
    throw new Error('missing bak in _icon_bak');
  }
  fs.mkdirSync(runs, { recursive: true });
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
  await qaOnLight(app192, 280, path.join(runs, 'appicon-up-192-light.png'));
  console.log(JSON.stringify({ ok: true, shiftDownRatio: 0.035 }));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
