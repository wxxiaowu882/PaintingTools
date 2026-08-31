/**
 * 探测哪些身份维更像「幼态」：大眼、高额、短下颌、圆颊等。
 */
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { parseContainer, GNMHeadModel } from '../js/vendor/GNMModel.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const buf = fs.readFileSync(path.join(__dirname, '../data/gnm/gnm_head_web.bin'));
const { meta, sections } = parseContainer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const model = new GNMHeadModel(meta, sections);
const n = model.numVertices;
const cid = model.componentId;
const pos = new Float32Array(n * 3);
const neutral = new Float32Array(n * 3);

function bbox(maskFn, p) {
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, minZ = 1e9, maxZ = -1e9, c = 0;
  for (let i = 0; i < n; i++) {
    if (!maskFn(i)) continue;
    const x = p[i * 3], y = p[i * 3 + 1], z = p[i * 3 + 2];
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
    c++;
  }
  return { minX, maxX, minY, maxY, minZ, maxZ, w: maxX - minX, h: maxY - minY, d: maxZ - minZ, c };
}

model.resetIdentity();
model.computeVertices(neutral);
const skin0 = bbox((i) => cid[i] === 0, neutral);
const eye0 = bbox((i) => cid[i] === 1 || cid[i] === 2, neutral);

function metrics(p) {
  const skin = bbox((i) => cid[i] === 0, p);
  const eyes = bbox((i) => cid[i] === 1 || cid[i] === 2, p);
  const forehead = bbox((i) => {
    if (cid[i] !== 0) return false;
    const y = p[i * 3 + 1], z = p[i * 3 + 2];
    return y > skin.minY + skin.h * 0.72 && z > skin.minZ + skin.d * 0.35;
  }, p);
  const lower = bbox((i) => {
    if (cid[i] !== 0) return false;
    const y = p[i * 3 + 1];
    return y < skin.minY + skin.h * 0.38;
  }, p);
  const eyeToFace = eyes.w / skin.w;
  const foreheadRatio = forehead.h / skin.h;
  const lowerRatio = lower.h / skin.h;
  return {
    skinW: +skin.w.toFixed(5),
    skinH: +skin.h.toFixed(5),
    eyeW: +eyes.w.toFixed(5),
    eyeToFace: +eyeToFace.toFixed(4),
    foreheadRatio: +foreheadRatio.toFixed(4),
    lowerRatio: +lowerRatio.toFixed(4),
    jawW: +lower.w.toFixed(5),
  };
}

const baseM = metrics(neutral);
console.log('neutral', baseM);

function analyze(kind, idx, amp = 2.5) {
  model.resetIdentity();
  if (kind === 'id') model.setIdentityParam(idx, amp);
  else model.setIdentityParam(idx, amp);
  model.computeVertices(pos);
  const m = metrics(pos);
  const score =
    (m.eyeToFace - baseM.eyeToFace) * 3 +
    (m.foreheadRatio - baseM.foreheadRatio) * 2 +
    (baseM.lowerRatio - m.lowerRatio) * 2 +
    (m.skinW / baseM.skinW - 1) * 0.5;
  return { idx, amp, ...m, childScore: +score.toFixed(4) };
}

const results = [];
for (let i = 0; i < model.identityDim; i++) {
  for (const amp of [1.5, -1.5, 2.5, -2.5]) {
    results.push(analyze('id', i, amp));
  }
}
results.sort((a, b) => b.childScore - a.childScore);
console.log('\n=== TOP child-like (positive score) ===');
console.table(results.slice(0, 25).map((r) => ({
  idx: r.idx,
  amp: r.amp,
  childScore: r.childScore,
  eyeToFace: r.eyeToFace,
  foreheadRatio: r.foreheadRatio,
  lowerRatio: r.lowerRatio,
})));

console.log('\n=== WORST (adult-like) ===');
console.table(results.slice(-10).map((r) => ({
  idx: r.idx,
  amp: r.amp,
  childScore: r.childScore,
  eyeToFace: r.eyeToFace,
})));

// combo: stack best child dims
const bestPos = results.filter((r) => r.childScore > 0).slice(0, 12);
const comboPushes = {};
for (const r of bestPos) {
  const key = r.idx;
  if (comboPushes[key] === undefined || Math.abs(r.amp) > Math.abs(comboPushes[key]))
    comboPushes[key] = r.amp > 0 ? Math.min(2, r.amp) : Math.max(-2, r.amp);
}
console.log('\ncombo pushes', comboPushes);

model.resetIdentity();
for (const [k, v] of Object.entries(comboPushes)) model.setIdentityParam(Number(k), v * 0.55);
model.computeVertices(pos);
console.log('combo metrics', metrics(pos));

fs.writeFileSync(
  path.join(__dirname, '_probe_child_top.json'),
  JSON.stringify({ baseM, bestPos, comboPushes, combo: metrics(pos) }, null, 2)
);
