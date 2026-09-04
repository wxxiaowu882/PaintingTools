/**
 * 浏览器端 GNM IdentitySampler 解码（纯 JS Dense，无 TF.js）。
 * 权重由 scripts/prepare-semantic-identity.mjs 生成。
 */

const META_URL = './data/gnm/semantic_identity_meta.json';
const BIN_URL = './data/gnm/semantic_identity_weights.bin';

export const GENDER = { FEMALE: 0, MALE: 1 };
export const ETHNICITY = {
  MIDDLE_EASTERN: 0,
  ASIAN: 1,
  WHITE: 2,
  BLACK: 3,
};

export const GENDER_LABELS = ['女', '男'];
export const ETHNICITY_LABELS = ['中东', '亚洲', '白人', '黑人'];

/** @type {null | { meta: object, layers: Array<{kernel:Float32Array,kRows:number,kCols:number,bias:Float32Array}> }} */
let runtime = null;
let loadPromise = null;

class SeededNormal {
  constructor(seed) {
    this.state = seed >>> 0;
    this.spare = undefined;
  }

  uniform() {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  normal() {
    if (this.spare !== undefined) {
      const v = this.spare;
      this.spare = undefined;
      return v;
    }
    const u = Math.max(this.uniform(), Number.EPSILON);
    const v = this.uniform();
    const mag = Math.sqrt(-2 * Math.log(u));
    this.spare = mag * Math.sin(2 * Math.PI * v);
    return mag * Math.cos(2 * Math.PI * v);
  }

  fillNormals(out) {
    for (let i = 0; i < out.length; i++) out[i] = this.normal();
  }
}

function matMulBiasRelu(x, rows, cols, kernel, bias, applyRelu) {
  const out = new Float32Array(cols);
  for (let j = 0; j < cols; j++) {
    let sum = bias[j];
    const base = j; // kernel is row-major [rows, cols] → index i*cols+j
    for (let i = 0; i < rows; i++) {
      sum += x[i] * kernel[i * cols + j];
    }
    out[j] = applyRelu && sum < 0 ? 0 : sum;
  }
  return out;
}

function parseLayers(meta, buffer) {
  const view = new Float32Array(buffer);
  let offset = 0;
  const layers = [];
  for (const L of meta.layers) {
    const [kRows, kCols] = L.kernelShape;
    const kCount = kRows * kCols;
    const bCount = L.biasShape[0];
    if (offset + kCount + bCount > view.length) {
      throw new Error('semantic_identity_weights.bin 与 meta 长度不匹配');
    }
    const kernel = view.subarray(offset, offset + kCount);
    offset += kCount;
    const bias = view.subarray(offset, offset + bCount);
    offset += bCount;
    layers.push({ kernel, kRows, kCols, bias });
  }
  return layers;
}

/**
 * @returns {Promise<{ ready: true }>}
 */
export async function loadIdentitySampler() {
  if (runtime) return { ready: true };
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const metaRes = await fetch(`${META_URL}?v=1`);
    if (!metaRes.ok) {
      throw new Error(
        `缺少语义采样权重 meta（HTTP ${metaRes.status}）。请运行: node scripts/prepare-semantic-identity.mjs`
      );
    }
    const meta = await metaRes.json();
    const binRes = await fetch(`${BIN_URL}?v=1`);
    if (!binRes.ok) {
      throw new Error(
        `缺少语义采样权重 bin（HTTP ${binRes.status}）。请运行: node scripts/prepare-semantic-identity.mjs`
      );
    }
    const buf = await binRes.arrayBuffer();
    const layers = parseLayers(meta, buf);
    runtime = { meta, layers };
    return { ready: true };
  })();
  try {
    return await loadPromise;
  } catch (err) {
    loadPromise = null;
    throw err;
  }
}

export function isIdentitySamplerReady() {
  return !!runtime;
}

/**
 * 构建 6 维条件：gender OHE(2) + ethnicity OHE(4)，支持软权重。
 * 与官方 IdentitySampler 一致：Gender.FEMALE=0 → [1,0]，MALE=1 → [0,1]；
 * 族裔 MIDDLE_EASTERN/ASIAN/WHITE/BLACK = 0..3。
 *
 * @param {{ female?: number, male?: number, gender?: number, ethnicity?: number[], ethnicityA?: number, ethnicityB?: number, ethnicityMix?: number, allowExtrapolateGender?: boolean }} opts
 *   gender: 0=女 … 1=男（官方单纯形内）。若 allowExtrapolateGender 且 gender 越界，则写入非归一化 [1-g,g]。
 */
export function buildConditionVector(opts = {}) {
  const cond = new Float32Array(6);
  let f = opts.female;
  let m = opts.male;
  if (f == null && m == null && opts.gender != null) {
    let g = Number(opts.gender);
    if (!Number.isFinite(g)) g = 0;
    if (!opts.allowExtrapolateGender) {
      g = Math.min(1, Math.max(0, g));
      f = 1 - g;
      m = g;
    } else {
      // 允许越界：g=0 → [1,0]，g=1 → [0,1]，g=-0.5 → [1.5,-0.5]
      f = 1 - g;
      m = g;
    }
  }
  if (opts.allowExtrapolateGender && (f != null || m != null)) {
    cond[0] = Number(f) || 0;
    cond[1] = Number(m) || 0;
  } else {
    f = Math.max(0, Number(f) || 0);
    m = Math.max(0, Number(m) || 0);
    const gSum = f + m;
    if (gSum <= 1e-8) {
      f = 1;
      m = 0;
    } else {
      f /= gSum;
      m /= gSum;
    }
    cond[0] = f;
    cond[1] = m;
  }

  if (Array.isArray(opts.ethnicity) && opts.ethnicity.length >= 4) {
    let sum = 0;
    for (let i = 0; i < 4; i++) sum += Math.max(0, Number(opts.ethnicity[i]) || 0);
    if (sum <= 1e-8) {
      cond[2 + ETHNICITY.ASIAN] = 1;
    } else {
      for (let i = 0; i < 4; i++) cond[2 + i] = Math.max(0, Number(opts.ethnicity[i]) || 0) / sum;
    }
  } else {
    const a = Math.min(3, Math.max(0, Number(opts.ethnicityA ?? ETHNICITY.ASIAN) | 0));
    const b = Math.min(3, Math.max(0, Number(opts.ethnicityB ?? a) | 0));
    const mix = Math.min(1, Math.max(0, Number(opts.ethnicityMix) || 0));
    cond[2 + a] += 1 - mix;
    cond[2 + b] += mix;
    let sum = 0;
    for (let i = 0; i < 4; i++) sum += cond[2 + i];
    if (sum > 0) for (let i = 0; i < 4; i++) cond[2 + i] /= sum;
  }
  return cond;
}

function decodeWithCondition(cond, seed) {
  const { meta, layers } = runtime;
  const latentDim = meta.latentDim || 64;
  const input = new Float32Array(latentDim + cond.length);
  new SeededNormal(seed >>> 0).fillNormals(input.subarray(0, latentDim));
  input.set(cond, latentDim);

  let x = input;
  for (let i = 0; i < layers.length; i++) {
    const L = layers[i];
    const applyRelu = i < layers.length - 1;
    if (x.length !== L.kRows) {
      throw new Error(`层 ${i} 输入维 ${x.length} != ${L.kRows}`);
    }
    x = matMulBiasRelu(x, L.kRows, L.kCols, L.kernel, L.bias, applyRelu);
  }
  return x;
}

/**
 * @param {{ seed?: number, gender?: number, female?: number, male?: number, ethnicityA?: number, ethnicityB?: number, ethnicityMix?: number, ethnicity?: number[], genderIntensity?: number }} opts
 *   genderIntensity: 1=官方端点强度；>1 沿女↔男方向在身份空间外推（同种子下相对 (F+M)/2 放大）
 * @returns {Float32Array} length identityDim
 */
export function sampleIdentity(opts = {}) {
  if (!runtime) throw new Error('IdentitySampler 尚未加载');
  const seed = (opts.seed ?? (Math.floor(Math.random() * 1e9) ^ Date.now())) >>> 0;
  const intensity = Math.min(5, Math.max(0.5, Number(opts.genderIntensity) || 1));

  const baseOpts = { ...opts, seed };
  const cond = buildConditionVector(baseOpts);
  let vec = decodeWithCondition(cond, seed);

  // 强度≠1：同种子解码纯女/纯男端点，相对中点放大（官方单纯形外的可控外推；默认不用）
  if (Math.abs(intensity - 1) > 1e-3) {
    const eth = {
      ethnicityA: opts.ethnicityA,
      ethnicityB: opts.ethnicityB,
      ethnicityMix: opts.ethnicityMix,
      ethnicity: opts.ethnicity,
    };
    const fVec = decodeWithCondition(buildConditionVector({ ...eth, gender: 0 }), seed);
    const mVec = decodeWithCondition(buildConditionVector({ ...eth, gender: 1 }), seed);
    const out = new Float32Array(vec.length);
    for (let i = 0; i < vec.length; i++) {
      const mid = (fVec[i] + mVec[i]) * 0.5;
      out[i] = mid + intensity * (vec[i] - mid);
    }
    vec = out;
  }
  return vec;
}

export function defaultSampleName(opts) {
  const g = opts.gender != null ? Number(opts.gender) : opts.male >= opts.female ? 1 : 0;
  const intensity = Number(opts.genderIntensity) || 1;
  let gLabel = g >= 0.5 ? GENDER_LABELS[1] : GENDER_LABELS[0];
  if (intensity > 1.05) gLabel = `强${gLabel}`;
  const a = opts.ethnicityA ?? ETHNICITY.ASIAN;
  const b = opts.ethnicityB ?? a;
  const mix = Number(opts.ethnicityMix) || 0;
  let eLabel = ETHNICITY_LABELS[a] || '亚洲';
  if (mix > 0.15 && b !== a) {
    eLabel = `${ETHNICITY_LABELS[a]}↔${ETHNICITY_LABELS[b]}`;
  }
  return `采样·${gLabel}·${eLabel}`;
}

/** 同种子官方纯女/纯男身份向量欧氏距离（越大性别差越明显；常见约 4–10） */
export function genderContrastDistance(opts = {}) {
  if (!runtime) throw new Error('IdentitySampler 尚未加载');
  const seed = (opts.seed ?? 0) >>> 0;
  const base = {
    ethnicityA: opts.ethnicityA,
    ethnicityB: opts.ethnicityB,
    ethnicityMix: opts.ethnicityMix,
    ethnicity: opts.ethnicity,
    seed,
    genderIntensity: 1,
  };
  const f = sampleIdentity({ ...base, gender: 0 });
  const m = sampleIdentity({ ...base, gender: 1 });
  let s = 0;
  for (let i = 0; i < f.length; i++) {
    const d = f[i] - m[i];
    s += d * d;
  }
  return { dist: Math.sqrt(s), female: f, male: m };
}

/**
 * 自动换种子，直到同种子女↔男身份距离 ≥ minDist，或用尽尝试次数（取最佳）。
 * 距离为程序可算的客观量（身份向量欧氏距离），不是肉眼打分。
 */
export function pickSeedWithGenderContrast(opts = {}) {
  if (!runtime) throw new Error('IdentitySampler 尚未加载');
  const minDist = Number(opts.minDist) > 0 ? Number(opts.minDist) : 7.0;
  const maxAttempts = Math.max(1, Math.min(64, Number(opts.maxAttempts) || 24));
  let seed = (opts.seed != null ? Number(opts.seed) : (Math.floor(Math.random() * 1e9) ^ Date.now())) >>> 0;

  let best = null;
  for (let i = 0; i < maxAttempts; i++) {
    const cur = genderContrastDistance({ ...opts, seed });
    const pack = { seed, dist: cur.dist, female: cur.female, male: cur.male, attempts: i + 1 };
    if (!best || pack.dist > best.dist) best = pack;
    if (pack.dist >= minDist) {
      return { ...pack, met: true, minDist, maxAttempts };
    }
    seed = (Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) + (i + 1) * 0x27d4eb2d) >>> 0;
    if (seed === 0) seed = 1;
  }
  return { ...best, met: best.dist >= minDist, minDist, maxAttempts };
}

/** 调试用：当前条件 one-hot 文本 */
export function describeCondition(opts = {}) {
  const c = buildConditionVector(opts);
  return {
    vector: c,
    text: `女${c[0].toFixed(2)} 男${c[1].toFixed(2)} | 中东${c[2].toFixed(2)} 亚${c[3].toFixed(2)} 白${c[4].toFixed(2)} 黑${c[5].toFixed(2)}`,
  };
}

/** 程序判定「性别差够大」的默认阈值（身份空间欧氏距离） */
export const DEFAULT_MIN_GENDER_DIST = 7.0;
