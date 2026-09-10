/**
 * Random Phase Noise (RPN) texture synthesis — IPOL 2011 / Galerne et al.
 * Preserves Fourier magnitude (texture "type") while randomizing phase per seed.
 * Ideal for "same zebra stripes, different placement" variants.
 */

function createRng(seed) {
  let t = seed >>> 0;
  return {
    next() {
      t += 0x6d2b79f5;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    },
  };
}

function nextPow2(n) {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

function fft1d(re, im, n, invert) {
  for (let i = 0, j = 0; i < n; i++) {
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
    let m = n >> 1;
    while (m >= 1 && j >= m) {
      j -= m;
      m >>= 1;
    }
    j += m;
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (invert ? 2 : -2) * Math.PI / len;
    const wlenRe = Math.cos(ang);
    const wlenIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wr = 1;
      let wi = 0;
      for (let j = 0; j < len / 2; j++) {
        const u = i + j;
        const v = i + j + len / 2;
        const tr = wr * re[v] - wi * im[v];
        const ti = wr * im[v] + wi * re[v];
        re[v] = re[u] - tr;
        im[v] = im[u] - ti;
        re[u] += tr;
        im[u] += ti;
        const nwr = wr * wlenRe - wi * wlenIm;
        wi = wr * wlenIm + wi * wlenRe;
        wr = nwr;
      }
    }
  }
  if (invert) {
    const s = 1 / n;
    for (let i = 0; i < n; i++) {
      re[i] *= s;
      im[i] *= s;
    }
  }
}

function fft2d(re, im, w, h, invert) {
  const rowRe = new Float32Array(w);
  const rowIm = new Float32Array(w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      rowRe[x] = re[y * w + x];
      rowIm[x] = im[y * w + x];
    }
    fft1d(rowRe, rowIm, w, invert);
    for (let x = 0; x < w; x++) {
      re[y * w + x] = rowRe[x];
      im[y * w + x] = rowIm[x];
    }
  }
  const colRe = new Float32Array(h);
  const colIm = new Float32Array(h);
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      colRe[y] = re[y * w + x];
      colIm[y] = im[y * w + x];
    }
    fft1d(colRe, colIm, h, invert);
    for (let y = 0; y < h; y++) {
      re[y * w + x] = colRe[y];
      im[y * w + x] = colIm[y];
    }
  }
}

/** Symmetric random phase θ with θ(0)=0 for real-valued IFFT output. */
function makeSymmetricPhase(w, h, rng) {
  const phase = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x > w / 2 || (x === (w >> 1) && y > (h >> 1))) continue;
      const theta = (rng.next() * 2 - 1) * Math.PI;
      const i = y * w + x;
      const sx = (w - x) % w;
      const sy = (h - y) % h;
      const j = sy * w + sx;
      phase[i] = theta;
      phase[j] = -theta;
    }
  }
  return phase;
}

function blurSeparable(src, w, h, radius) {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const r = Math.max(1, radius | 0);
  const denom = r * 2 + 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) {
        const cx = Math.min(w - 1, Math.max(0, x + k));
        sum += src[y * w + cx];
      }
      tmp[y * w + x] = sum / denom;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let sum = 0;
      for (let k = -r; k <= r; k++) {
        const cy = Math.min(h - 1, Math.max(0, y + k));
        sum += tmp[cy * w + x];
      }
      out[y * w + x] = sum / denom;
    }
  }
  return out;
}

function rpnRealField(signal, w, h, phase) {
  const re = new Float32Array(w * h);
  const im = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) re[i] = signal[i];
  fft2d(re, im, w, h, false);
  for (let i = 0; i < w * h; i++) {
    const mag = Math.hypot(re[i], im[i]) + 1e-12;
    re[i] = mag * Math.cos(phase[i]);
    im[i] = mag * Math.sin(phase[i]);
  }
  fft2d(re, im, w, h, true);
  return re;
}

function embedChannel(rgba, w, h, ch, pw, ph) {
  const out = new Float32Array(pw * ph);
  for (let y = 0; y < ph; y++) {
    const sy = Math.min(h - 1, y);
    for (let x = 0; x < pw; x++) {
      const sx = Math.min(w - 1, x);
      out[y * pw + x] = rgba[(sy * w + sx) * 4 + ch];
    }
  }
  return out;
}

/**
 * High-pass RPN: keep coarse structure, randomize fine detail (muscle fibers / zebra stripes).
 * @param {Uint8ClampedArray} rgba
 * @param {number} w
 * @param {number} h
 * @param {Uint8Array|null} mask local mask length w*h
 * @param {number} seed
 * @param {{ highPassSigma?: number }} opts
 */
export function synthRandomPhaseNoiseRgba(rgba, w, h, mask, seed, opts = {}) {
  const pw = nextPow2(w);
  const ph = nextPow2(h);
  const rng = createRng(seed >>> 0);
  const phase = makeSymmetricPhase(pw, ph, rng);
  const mode = opts.mode || "highpass";
  const blurR = Math.max(1, Math.round((opts.highPassSigma ?? 4) * 0.85));
  const preserveR = Math.max(2, Math.round((opts.preserveLowSigma ?? 6) * 0.9));
  const out = new Uint8ClampedArray(rgba);
  const synth = [];

  for (let ch = 0; ch < 3; ch++) {
    const src = embedChannel(rgba, w, h, ch, pw, ph);
    let merged;
    if (mode === "full") {
      merged = rpnRealField(src, pw, ph, phase);
    } else if (mode === "perturb") {
      const low = blurSeparable(src, pw, ph, preserveR);
      const band = new Float32Array(pw * ph);
      for (let i = 0; i < pw * ph; i++) band[i] = src[i] - low[i];
      const synthBand = rpnRealField(band, pw, ph, phase);
      merged = new Float32Array(pw * ph);
      for (let i = 0; i < pw * ph; i++) merged[i] = low[i] + synthBand[i];
    } else {
      const low = blurSeparable(src, pw, ph, blurR);
      const high = new Float32Array(pw * ph);
      for (let i = 0; i < pw * ph; i++) high[i] = src[i] - low[i];
      const synthHigh = rpnRealField(high, pw, ph, phase);
      merged = new Float32Array(pw * ph);
      for (let i = 0; i < pw * ph; i++) merged[i] = low[i] + synthHigh[i];
    }
    synth.push(merged);
  }

  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const li = row * w + col;
      if (mask && !mask[li]) continue;
      const di = li * 4;
      for (let ch = 0; ch < 3; ch++) {
        const v = synth[ch][row * pw + col];
        out[di + ch] = Math.min(255, Math.max(0, Math.round(v)));
      }
      out[di + 3] = rgba[di + 3] || 255;
    }
  }
  return out;
}

/** RPN on normal-map crop; re-normalize tangent vectors after synthesis. */
export function synthNormalMapRpn(rgba, w, h, mask, seed, opts = {}) {
  const out = synthRandomPhaseNoiseRgba(rgba, w, h, mask, seed, opts);
  for (let i = 0; i < w * h; i++) {
    if (mask && !mask[i]) continue;
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
