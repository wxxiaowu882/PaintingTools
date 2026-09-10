/**
 * Scroll island texture along local fiber direction (from normal map).
 * Toroidal sampling — every masked pixel is rewritten (zebra stripe shift).
 */

function wrapCoord(v, size) {
  return ((v % size) + size) % size;
}

function blockHash(seed, bx, by) {
  return (Math.imul(bx + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(by + (seed | 0), 0xc2b2ae35)) >>> 0;
}

function sampleBilinearWrap(rgba, w, h, x, y, ch) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const tx = x - x0;
  const ty = y - y0;
  const i00 = (wrapCoord(y0, h) * w + wrapCoord(x0, w)) * 4 + ch;
  const i10 = (wrapCoord(y0, h) * w + wrapCoord(x1, w)) * 4 + ch;
  const i01 = (wrapCoord(y1, h) * w + wrapCoord(x0, w)) * 4 + ch;
  const i11 = (wrapCoord(y1, h) * w + wrapCoord(x1, w)) * 4 + ch;
  const v00 = rgba[i00];
  const v10 = rgba[i10];
  const v01 = rgba[i01];
  const v11 = rgba[i11];
  return (1 - tx) * (1 - ty) * v00 + tx * (1 - ty) * v10 + (1 - tx) * ty * v01 + tx * ty * v11;
}

function sampleRgbaBilinearWrap(rgba, w, h, x, y) {
  return [
    sampleBilinearWrap(rgba, w, h, x, y, 0),
    sampleBilinearWrap(rgba, w, h, x, y, 1),
    sampleBilinearWrap(rgba, w, h, x, y, 2),
    sampleBilinearWrap(rgba, w, h, x, y, 3),
  ];
}

/**
 * @param {Uint8ClampedArray} rgba
 * @param {Uint8ClampedArray} orientNormal
 * @param {Uint8Array} maskLocal
 * @param {number} w
 * @param {number} h
 * @param {number} seed
 * @param {number} shiftScale shift in pixels along fiber
 */
export function scrollTextureAlongFiber(rgba, orientNormal, maskLocal, w, h, seed, shiftScale = 28) {
  const out = new Uint8ClampedArray(rgba);
  const seedU = seed >>> 0;
  const shiftMain = shiftScale * (0.65 + (seedU % 41) / 41);
  const shiftCross = shiftScale * (0.12 + ((seedU >>> 8) % 19) / 19);
  const rot = ((seedU % 60) / 60) * Math.PI * 0.7 - Math.PI * 0.35;
  const cosR = Math.cos(rot);
  const sinR = Math.sin(rot);

  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const i = row * w + col;
      if (!maskLocal[i]) continue;
      const di = i * 4;
      let nx = orientNormal[di] / 255 - 0.5;
      let ny = orientNormal[di + 1] / 255 - 0.5;
      const glen = Math.hypot(nx, ny) + 1e-5;
      nx /= glen;
      ny /= glen;
      const fx = nx * cosR - ny * sinR;
      const fy = nx * sinR + ny * cosR;
      const cx = -fy;
      const cy = fx;
      const sx = col - fx * shiftMain - cx * shiftCross;
      const sy = row - fy * shiftMain - cy * shiftCross;
      const [r, g, b, a] = sampleRgbaBilinearWrap(rgba, w, h, sx, sy);
      out[di] = Math.round(r);
      out[di + 1] = Math.round(g);
      out[di + 2] = Math.round(b);
      out[di + 3] = Math.round(a || 255);
    }
  }
  return out;
}

/**
 * Block-wise fiber scroll — each patch shifts independently so block scale / similarity are obvious.
 * @param {number} blockSize patch size in pixels (from UI block scale)
 * @param {number} similarity 0.4–1; lower = more patch-to-patch variation
 */
export function scrollTextureAlongFiberBlocked(
  rgba,
  orientNormal,
  maskLocal,
  w,
  h,
  seed,
  shiftScale = 28,
  blockSize = 24,
  similarity = 0.7
) {
  const out = new Uint8ClampedArray(rgba);
  const seedU = seed >>> 0;
  const bs = Math.max(6, Math.round(blockSize));
  const sim = Math.max(0.4, Math.min(1, similarity));
  const patchSpread = 0.35 + (1 - sim) * 2.45;
  const baseShift = shiftScale * (1.1 + bs * 0.08);
  const globalRot = ((seedU % 72) / 72) * Math.PI * 0.85 - Math.PI * 0.425;

  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const i = row * w + col;
      if (!maskLocal[i]) continue;
      const di = i * 4;
      let nx = orientNormal[di] / 255 - 0.5;
      let ny = orientNormal[di + 1] / 255 - 0.5;
      const glen = Math.hypot(nx, ny) + 1e-5;
      nx /= glen;
      ny /= glen;

      const bx = (col / bs) | 0;
      const by = (row / bs) | 0;
      const bh = blockHash(seedU, bx, by);
      const blockShift = baseShift * (0.15 + ((bh % 113) / 113) * patchSpread * 2.6);
      const blockRot = globalRot + (((bh >>> 8) % 48) / 48 - 0.5) * Math.PI * 1.25 * patchSpread;
      const cosR = Math.cos(blockRot);
      const sinR = Math.sin(blockRot);
      const fx = nx * cosR - ny * sinR;
      const fy = nx * sinR + ny * cosR;
      const cx = -fy;
      const cy = fx;
      const crossAmt = blockShift * (0.18 + patchSpread * 0.42);
      const sx = col - fx * blockShift - cx * crossAmt;
      const sy = row - fy * blockShift - cy * crossAmt;
      const [r, g, b, a] = sampleRgbaBilinearWrap(rgba, w, h, sx, sy);
      out[di] = Math.round(r);
      out[di + 1] = Math.round(g);
      out[di + 2] = Math.round(b);
      out[di + 3] = Math.round(a || 255);
    }
  }
  return out;
}

export function renormalizeNormalPixels(rgba, maskLocal, w, h) {
  const out = new Uint8ClampedArray(rgba);
  for (let i = 0; i < w * h; i++) {
    if (!maskLocal[i]) continue;
    const di = i * 4;
    let nx = (out[di] / 255) * 2 - 1;
    let ny = (out[di + 1] / 255) * 2 - 1;
    let nz = (out[di + 2] / 255) * 2 - 1;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len;
    ny /= len;
    nz /= len;
    out[di] = Math.min(255, Math.max(0, Math.round((nx * 0.5 + 0.5) * 255)));
    out[di + 1] = Math.min(255, Math.max(0, Math.round((ny * 0.5 + 0.5) * 255)));
    out[di + 2] = Math.min(255, Math.max(0, Math.round((nz * 0.5 + 0.5) * 255)));
    out[di + 3] = 255;
  }
  return out;
}

/** 平滑局部纤维走向，避免逐像素方向抖动变成噪点。 */
function smoothTangentField(orientNormal, maskLocal, w, h, radius = 3) {
  const fx = new Float32Array(w * h);
  const fy = new Float32Array(w * h);
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const i = row * w + col;
      if (!maskLocal[i]) continue;
      let sx = 0;
      let sy = 0;
      let n = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const cc = col + dx;
          const rr = row + dy;
          if (cc < 0 || cc >= w || rr < 0 || rr >= h) continue;
          const j = rr * w + cc;
          if (!maskLocal[j]) continue;
          const dj = j * 4;
          let nx = orientNormal[dj] / 255 - 0.5;
          let ny = orientNormal[dj + 1] / 255 - 0.5;
          const glen = Math.hypot(nx, ny) + 1e-5;
          sx += nx / glen;
          sy += ny / glen;
          n++;
        }
      }
      if (n) {
        const glen = Math.hypot(sx, sy) + 1e-5;
        fx[i] = sx / glen;
        fy[i] = sy / glen;
      }
    }
  }
  return { fx, fy };
}

/**
 * 沿纤维方向平移法线贴图：只改丝条相位/位置，不改截面轮廓（保原样式）。
 * 参考：oriented texture synthesis / guidance vector field（Kopf et al., Heeger-Bergen）。
 */
function bandSeedHash(seed, band) {
  return (Math.imul(band + 0x9e3779b9, 0x85ebca6b) ^ Math.imul(seed | 0, 0xc2b2ae35)) >>> 0;
}

function smoothBandT(t) {
  return t * t * (3 - 2 * t);
}

/**
 * 沿平滑纤维场从原范例重采样：带间相位/横向偏移变化，保持整体走向、避免轴对齐碎块。
 */
export function synthOrientedFiberExemplar(
  rgba,
  orientNormal,
  maskLocal,
  w,
  h,
  seed,
  similarity = 0.7,
  blockScale = 24
) {
  const out = new Uint8ClampedArray(rgba);
  const seedU = seed >>> 0;
  const sim = Math.max(0.4, Math.min(1, similarity));
  const blk = Math.max(14, Math.min(56, blockScale));
  const bandW = blk * 1.25;
  const { fx, fy } = smoothTangentField(orientNormal, maskLocal, w, h, 12);
  const globalPhase = ((seedU % 360) / 360) * blk * (0.35 + (1 - sim) * 1.6);
  const phaseSpan = blk * (0.55 + (1 - sim) * 2.4);
  const crossSpan = bandW * (0.25 + (1 - sim) * 0.95);
  const maxBands = Math.ceil(Math.hypot(w, h) / Math.max(10, bandW)) + 6;
  const bandPhase = new Float32Array(maxBands);
  const bandCross = new Float32Array(maxBands);
  for (let b = 0; b < maxBands; b++) {
    const hsh = bandSeedHash(seedU, b);
    bandPhase[b] = globalPhase + ((hsh % 2048) / 2048 - 0.5) * phaseSpan * 2;
    bandCross[b] = ((hsh >>> 11) % 2048) / 2048 * crossSpan;
  }

  const sampleAt = (su, sv, tx, ty) => {
    const sc = su * tx - sv * ty;
    const sr = su * ty + sv * tx;
    return sampleRgbaBilinearWrap(rgba, w, h, sc, sr);
  };

  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const i = row * w + col;
      if (!maskLocal[i]) continue;
      const di = i * 4;
      let tx = fx[i];
      let ty = fy[i];
      if (Math.abs(tx) + Math.abs(ty) < 1e-4) {
        tx = orientNormal[di] / 255 - 0.5;
        ty = orientNormal[di + 1] / 255 - 0.5;
        const glen = Math.hypot(tx, ty) + 1e-5;
        tx /= glen;
        ty /= glen;
      }
      const fu = col * tx + row * ty;
      const fv = -col * ty + row * tx;
      const fvn = fv / bandW;
      const b0 = Math.floor(fvn);
      const t = smoothBandT(fvn - b0);
      const b0i = ((b0 % maxBands) + maxBands) % maxBands;
      const b1i = (b0i + 1) % maxBands;
      const [r0, g0, b0c, a0] = sampleAt(fu + bandPhase[b0i], fv + bandCross[b0i], tx, ty);
      const [r1, g1, b1c, a1] = sampleAt(fu + bandPhase[b1i], fv + bandCross[b1i], tx, ty);
      out[di] = Math.round(r0 * (1 - t) + r1 * t);
      out[di + 1] = Math.round(g0 * (1 - t) + g1 * t);
      out[di + 2] = Math.round(b0c * (1 - t) + b1c * t);
      out[di + 3] = Math.round((a0 || 255) * (1 - t) + (a1 || 255) * t);
    }
  }
  return out;
}

export function scrollNormalFibersOnly(
  rgba,
  orientNormal,
  maskLocal,
  w,
  h,
  seed,
  blockScale = 24,
  similarity = 0.7
) {
  const out = new Uint8ClampedArray(rgba);
  const seedU = seed >>> 0;
  const sim = Math.max(0.4, Math.min(1, similarity));
  const blk = Math.max(8, Math.min(48, blockScale));
  const { fx: ffx, fy: ffy } = smoothTangentField(orientNormal, maskLocal, w, h, 3);
  const shiftMain =
    blk * (0.1 + (1 - sim) * 0.4) * (0.72 + ((seedU % 53) / 53) * 0.56);
  const rot = ((seedU % 20) / 20) * Math.PI * 0.06 - Math.PI * 0.03;
  const cosR = Math.cos(rot);
  const sinR = Math.sin(rot);

  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const i = row * w + col;
      if (!maskLocal[i]) continue;
      const di = i * 4;
      let fx = ffx[i];
      let fy = ffy[i];
      if (!fx && !fy) {
        let nx = orientNormal[di] / 255 - 0.5;
        let ny = orientNormal[di + 1] / 255 - 0.5;
        const glen = Math.hypot(nx, ny) + 1e-5;
        fx = nx / glen;
        fy = ny / glen;
      }
      const rfx = fx * cosR - fy * sinR;
      const rfy = fx * sinR + fy * cosR;
      const sx = col - rfx * shiftMain;
      const sy = row - rfy * shiftMain;
      const [r, g, b, a] = sampleRgbaBilinearWrap(rgba, w, h, sx, sy);
      out[di] = Math.round(r);
      out[di + 1] = Math.round(g);
      out[di + 2] = Math.round(b);
      out[di + 3] = Math.round(a || 255);
    }
  }
  return out;
}
