/**
 * P0：提取头颅面骨身份维（0–169）皮肤位移指纹。
 * - signed：每顶点 (dx,dy,dz)，L2 归一（诊断用；PCA 基近正交，不适合直接聚类）
 * - mag：每顶点 ||d|| 幅度图，L2 归一（主聚类指纹：哪里在动）
 *
 * Usage: node scripts/cluster-identity-similarity-extract.mjs
 * 产出：scripts/_runs/identity-similarity-p0/
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseContainer, GNMHeadModel } from '../js/vendor/GNMModel.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(__dirname, '_runs', 'identity-similarity-p0');
const BIN_PATH = path.join(ROOT, 'data', 'gnm', 'gnm_head_web.bin');

const HEAD_START = 0;
const HEAD_COUNT = 170;
const AMP = 2.0;
const NEG_CHECK_EVERY = 10;

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function l2NormalizeInPlace(arr) {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i] * arr[i];
  const n = Math.sqrt(s);
  if (n < 1e-12) return 0;
  const inv = 1 / n;
  for (let i = 0; i < arr.length; i++) arr[i] *= inv;
  return n;
}

function cosine(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function main() {
  const t0 = Date.now();
  ensureDir(OUT_DIR);

  const buf = fs.readFileSync(BIN_PATH);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const { meta, sections } = parseContainer(ab);
  const model = new GNMHeadModel(meta, sections);
  const nV = model.numVertices;
  const cid = model.componentId;

  const skinIdx = [];
  for (let i = 0; i < nV; i++) {
    if (cid[i] === 0) skinIdx.push(i);
  }
  const skinCount = skinIdx.length;
  const signedDim = skinCount * 3;
  console.log(
    `[extract] vertices=${nV} skin=${skinCount} head=${HEAD_START}..${
      HEAD_START + HEAD_COUNT - 1
    } amp=${AMP}`
  );

  const neutral = new Float32Array(nV * 3);
  const pos = new Float32Array(nV * 3);
  model.resetIdentity();
  model.resetExpression();
  model.resetPose();
  model.computeVertices(neutral);

  const skinXyz = new Float32Array(skinCount * 3);
  for (let s = 0; s < skinCount; s++) {
    const o = skinIdx[s] * 3;
    skinXyz[s * 3] = neutral[o];
    skinXyz[s * 3 + 1] = neutral[o + 1];
    skinXyz[s * 3 + 2] = neutral[o + 2];
  }
  fs.writeFileSync(path.join(OUT_DIR, 'skin_xyz.f32'), Buffer.from(skinXyz.buffer));

  const fpSigned = new Float32Array(HEAD_COUNT * signedDim);
  const fpMag = new Float32Array(HEAD_COUNT * skinCount);
  const normsSigned = new Float32Array(HEAD_COUNT);
  const normsMag = new Float32Array(HEAD_COUNT);
  const negChecks = [];

  for (let k = 0; k < HEAD_COUNT; k++) {
    const idx = HEAD_START + k;
    model.resetIdentity();
    model.resetExpression();
    model.resetPose();
    model.setIdentityParam(idx, AMP);
    model.computeVertices(pos);

    const rowS = fpSigned.subarray(k * signedDim, (k + 1) * signedDim);
    const rowM = fpMag.subarray(k * skinCount, (k + 1) * skinCount);
    let p = 0;
    for (let s = 0; s < skinCount; s++) {
      const o = skinIdx[s] * 3;
      const dx = pos[o] - neutral[o];
      const dy = pos[o + 1] - neutral[o + 1];
      const dz = pos[o + 2] - neutral[o + 2];
      rowS[p++] = dx;
      rowS[p++] = dy;
      rowS[p++] = dz;
      rowM[s] = Math.hypot(dx, dy, dz);
    }
    normsSigned[k] = l2NormalizeInPlace(rowS);
    normsMag[k] = l2NormalizeInPlace(rowM);

    if (k % NEG_CHECK_EVERY === 0) {
      model.resetIdentity();
      model.resetExpression();
      model.resetPose();
      model.setIdentityParam(idx, -AMP);
      model.computeVertices(pos);
      const neg = new Float32Array(signedDim);
      let q = 0;
      for (let s = 0; s < skinCount; s++) {
        const o = skinIdx[s] * 3;
        neg[q++] = pos[o] - neutral[o];
        neg[q++] = pos[o + 1] - neutral[o + 1];
        neg[q++] = pos[o + 2] - neutral[o + 2];
      }
      l2NormalizeInPlace(neg);
      negChecks.push({ idx, cosPosNeg: +cosine(rowS, neg).toFixed(6) });
    }

    if (k % 10 === 0 || k === HEAD_COUNT - 1) {
      console.log(
        `[extract] ${k + 1}/${HEAD_COUNT} id${idx} |d|=${normsSigned[k].toFixed(5)} |mag|=${normsMag[k].toFixed(5)}`
      );
    }
  }

  fs.writeFileSync(path.join(OUT_DIR, 'fingerprints_pos.f32'), Buffer.from(fpSigned.buffer));
  fs.writeFileSync(path.join(OUT_DIR, 'fingerprints_mag.f32'), Buffer.from(fpMag.buffer));
  fs.writeFileSync(path.join(OUT_DIR, 'norms_before.json'), JSON.stringify([...normsSigned]));
  fs.writeFileSync(path.join(OUT_DIR, 'norms_mag_before.json'), JSON.stringify([...normsMag]));
  fs.writeFileSync(path.join(OUT_DIR, 'neg_linearity_checks.json'), JSON.stringify(negChecks, null, 2));

  const metaOut = {
    kind: 'gnmIdentityDisplacementFingerprints',
    version: 2,
    createdAt: new Date().toISOString(),
    sourceBin: 'data/gnm/gnm_head_web.bin',
    headStart: HEAD_START,
    headCount: HEAD_COUNT,
    amp: AMP,
    component: 'skin',
    skinVertexCount: skinCount,
    signedFeatDim: signedDim,
    magFeatDim: skinCount,
    dtype: 'float32',
    files: {
      signedNormalized: 'fingerprints_pos.f32',
      magNormalized: 'fingerprints_mag.f32',
      skinXyz: 'skin_xyz.f32',
    },
    clusteringNote:
      'PCA identity bases are nearly orthogonal in signed displacement space; primary clustering uses per-vertex magnitude maps (where the surface moves) + Ward linkage.',
    notes: [
      'Full skin vertices (no coarse region pooling).',
      'Signed field kept for diagnostics; mag field used for similarity clustering.',
    ],
  };
  fs.writeFileSync(path.join(OUT_DIR, 'meta.json'), JSON.stringify(metaOut, null, 2));

  console.log(`[extract] done in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${OUT_DIR}`);
}

main();
