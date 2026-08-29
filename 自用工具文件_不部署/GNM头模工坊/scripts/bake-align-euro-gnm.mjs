/**
 * Bake align_euro_to_gnm_v1.json (Node, no Three).
 * Usage: node align-overlay/../scripts/bake-align-euro-gnm.mjs
 *   or:  node scripts/bake-align-euro-gnm.mjs  (from GNM头模工坊)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseContainer, GNMHeadModel } from '../js/vendor/GNMModel.js';
import {
  sampleGnmFarkasLandmarks,
  pairLandmarks,
  ALIGN_CORE_IDS,
} from '../align-overlay/js/landmarks-gnm.js';
import {
  umeyama,
  applySimilarity,
  applyNormalizePoint,
  computeBottomCenterNormalize,
  composeNormalizeAfterSimilarity,
} from '../align-overlay/js/procrustes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'align-overlay/data/align_euro_to_gnm_v1.json');
const TARGET_HEIGHT_M = 0.3;

const binPath = path.join(ROOT, 'data/gnm/gnm_head_web.bin');
const euroRestPath = path.join(
  ROOT,
  '../篡改猴/亚洲头部肌肉模型/work_v4/compare_review/landmarks/euro_morph_rest.json'
);

const buf = fs.readFileSync(binPath);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const { meta, sections } = parseContainer(ab);
const model = new GNMHeadModel(meta, sections);
model.resetIdentity();
model.resetExpression();
model.resetPose();
const raw = new Float32Array(model.numVertices * 3);
model.computeVertices(raw);

const { points: gnmLmNative } = sampleGnmFarkasLandmarks(raw, model.componentId);
const euroRest = JSON.parse(fs.readFileSync(euroRestPath, 'utf8'));
const euroLm = euroRest.points || {};
const paired = pairLandmarks(euroLm, gnmLmNative, ALIGN_CORE_IDS);
if (paired.src.length < 3) {
  throw new Error(`可配对路标不足: ${paired.used}`);
}
const sim = umeyama(paired.src, paired.dst, paired.weights);
const norm = computeBottomCenterNormalize(raw, TARGET_HEIGHT_M);
const elements = composeNormalizeAfterSimilarity(sim, norm);

const perPoint = paired.used.map((id, i) => {
  const g = applyNormalizePoint(gnmLmNative[id], norm);
  const e = applyNormalizePoint(applySimilarity(euroLm[id], sim), norm);
  const err = Math.hypot(e[0] - g[0], e[1] - g[1], e[2] - g[2]);
  return {
    id,
    errM: err,
    errMm: err * 1000,
    gnm: g,
    euroAligned: e,
    weight: paired.weights[i],
  };
});
const rmsMm =
  Math.sqrt(perPoint.reduce((s, p) => s + p.errM * p.errM, 0) / perPoint.length) * 1000;
const maxMm = Math.max(...perPoint.map((p) => p.errMm));

const report = {
  version: 1,
  createdAt: new Date().toISOString(),
  note: 'Euro muscle → GNM neutral via weighted Umeyama on Farkas-like landmarks; then 30cm bottom-center normalize.',
  targetHeightM: TARGET_HEIGHT_M,
  coreIds: ALIGN_CORE_IDS,
  usedIds: paired.used,
  umeyama: {
    scale: sim.scale,
    R: sim.R,
    t: sim.t,
    rmsM: sim.rms,
    maxErrM: sim.maxErr,
  },
  normalize: {
    scale: norm.scale,
    offset: norm.offset,
    heightCm: norm.heightCm,
  },
  matrix4_columnMajor: elements,
  perPoint,
  summary: { nPoints: perPoint.length, rmsMm, maxMm },
  gnmLandmarksNative: gnmLmNative,
  euroLandmarksNative: Object.fromEntries(paired.used.map((id) => [id, euroLm[id]])),
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log('wrote', OUT);
console.log('summary', report.summary);
console.log(
  'perPoint mm',
  perPoint.map((p) => `${p.id}:${p.errMm.toFixed(1)}`).join(' ')
);
