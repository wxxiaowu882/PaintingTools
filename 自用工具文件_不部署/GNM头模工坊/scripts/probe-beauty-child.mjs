/**
 * 网格搜索：幼态 / 东亚女性审美 配方
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseContainer, GNMHeadModel } from '../js/vendor/GNMModel.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRESETS = path.join(__dirname, '../data/presets');
const buf = fs.readFileSync(path.join(__dirname, '../data/gnm/gnm_head_web.bin'));
const { meta, sections } = parseContainer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const model = new GNMHeadModel(meta, sections);
const n = model.numVertices;
const cid = model.componentId;
const pos = new Float32Array(n * 3);

function apply(pushes) {
  model.resetIdentity();
  model.resetExpression();
  model.resetPose();
  for (const [k, v] of Object.entries(pushes)) model.setIdentityParam(Number(k), v);
  model.computeVertices(pos);
}

function metrics() {
  let sx0 = 1e9, sx1 = -1e9, sy0 = 1e9, sy1 = -1e9, sz0 = 1e9, sz1 = -1e9;
  let ex0 = 1e9, ex1 = -1e9, ey0 = 1e9, ey1 = -1e9;
  let jx0 = 1e9, jx1 = -1e9;
  let nx = 0, nz = 0, nc = 0;
  let fy0 = 1e9, fy1 = -1e9;
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    if (cid[i] === 0) {
      sx0 = Math.min(sx0, x); sx1 = Math.max(sx1, x);
      sy0 = Math.min(sy0, y); sy1 = Math.max(sy1, y);
      sz0 = Math.min(sz0, z); sz1 = Math.max(sz1, z);
      const sh = sy1 - sy0;
      if (y > sy0 + sh * 0.72) { fy0 = Math.min(fy0, y); fy1 = Math.max(fy1, y); }
      if (y < sy0 + sh * 0.38) { jx0 = Math.min(jx0, x); jx1 = Math.max(jx1, x); }
      if (Math.abs(x) < (sx1 - sx0) * 0.06 && y > sy0 + sh * 0.48 && y < sy0 + sh * 0.62 && z > sz0 + (sz1 - sz0) * 0.55) {
        nx += x; nz += z; nc++;
      }
    } else if (cid[i] === 1 || cid[i] === 2) {
      ex0 = Math.min(ex0, x); ex1 = Math.max(ex1, x);
      ey0 = Math.min(ey0, y); ey1 = Math.max(ey1, y);
    }
  }
  const skinW = sx1 - sx0, skinH = sy1 - sy0, skinD = sz1 - sz0;
  const eyeW = ex1 - ex0, eyeH = ey1 - ey0;
  const jawW = jx1 - jx0;
  const foreheadH = fy1 - fy0;
  const noseZ = nc ? nz / nc : 0;
  return {
    eyeToFace: eyeW / skinW,
    eyeToHead: eyeH / skinH,
    foreheadRatio: foreheadH / skinH,
    jawToFace: jawW / skinW,
    faceIndex: skinH / skinW,
    noseProj: noseZ,
    skinW, skinH,
  };
}

function blendVec(a, b, t) {
  return a.map((v, i) => v * (1 - t) + b[i] * t);
}

function childScore(m, base) {
  return (
    (m.eyeToFace - base.eyeToFace) * 6 +
    (m.eyeToHead - base.eyeToHead) * 4 +
    (m.foreheadRatio - base.foreheadRatio) * 3 +
    (base.jawToFace - m.jawToFace) * 4 +
    (base.faceIndex - m.faceIndex) * 2 +
    (base.noseProj - m.noseProj) * 1.5
  );
}

function femaleScore(m, base) {
  const eye = m.eyeToFace - base.eyeToFace;
  const jawNarrow = base.jawToFace - m.jawToFace;
  const oval = Math.abs(m.faceIndex - 1.32) < 0.08 ? 0.15 : -Math.abs(m.faceIndex - 1.32);
  const cheek = base.skinW - m.skinW > 0 ? 0.05 : 0; // slightly narrower than neutral ok
  return eye * 2.5 + jawNarrow * 4 + oval + cheek + (m.foreheadRatio - base.foreheadRatio) * 0.5;
}

apply({});
const base = metrics();
console.log('BASE', base);

// --- child exhaustive on key dims + teeth ---
const childCands = [];
const childBase = { 1: -3, 3: -2.2, 4: -3, 5: 2, 6: -2, 8: 3, 10: -2.5, 11: 1.2, 12: 1.2, 17: -1.5, 20: -2.2, 2: 0.6, 13: 0.4 };
for (let t10 = -3; t10 <= -1; t10 += 0.5) {
  for (let teeth = -2; teeth <= 0; teeth += 0.5) {
    const p = { ...childBase, 10: t10 };
    for (let ti = 173; ti <= 177; ti++) p[ti] = teeth;
    apply(p);
    const m = metrics();
    childCands.push({ score: childScore(m, base), p, m });
  }
}
childCands.sort((a, b) => b.score - a.score);
console.log('\nTOP CHILD');
for (const c of childCands.slice(0, 5)) {
  console.log('score', c.score.toFixed(3), 'eye', c.m.eyeToFace.toFixed(3), 'jaw', c.m.jawToFace.toFixed(3), 'fore', c.m.foreheadRatio.toFixed(3), JSON.stringify(c.p));
}

// tembrica blends for child
const t03 = JSON.parse(fs.readFileSync(path.join(PRESETS, 'identity-t03-tembrica.json'), 'utf8')).identity;
const childVec = Array(253).fill(0);
apply(childCands[0].p);
childVec.splice(0, model.identityDim, ...model.identity);
for (const t of [0.15, 0.25, 0.35]) {
  const v = blendVec(t03, childVec, t);
  model.setIdentityVector(Float32Array.from(v));
  model.computeVertices(pos);
  const m = metrics();
  console.log('t03+child blend', t, childScore(m, base).toFixed(3), m);
}

// --- female: tembrica bases + pushes ---
const tembrica = ['t01', 't02', 't03', 't04', 't05', 't06'].map((id) => {
  const j = JSON.parse(fs.readFileSync(path.join(PRESETS, `identity-${id}-tembrica.json`), 'utf8'));
  model.setIdentityVector(Float32Array.from(j.identity));
  model.computeVertices(pos);
  return { id, vec: j.identity, m: metrics(), score: femaleScore(metrics(), base) };
});
tembrica.sort((a, b) => b.score - a.score);
console.log('\nTEMBRICA female rank');
for (const t of tembrica) console.log(t.id, t.score.toFixed(3), t.m);

const femalePushes = [
  { name: 'vline', p: { 1: -1.1, 17: 1.2, 5: 0.9, 10: -0.8, 7: 0.6, 3: -0.4, 13: 0.3, 2: 0.4 } },
  { name: 'heart', p: { 1: -0.9, 7: 1.0, 13: 0.8, 10: -0.6, 17: 0.7, 8: -0.5, 3: 0.3, 2: 0.35 } },
  { name: 'oval', p: { 1: -0.7, 17: 0.9, 7: 0.5, 5: -0.3, 10: -0.5, 2: 0.5, 6: -0.4 } },
  { name: 'neotenous', p: { 1: -1.4, 4: -1.0, 8: 1.5, 10: -0.7, 17: 0.8, 3: -0.6, 7: 0.35 } },
  { name: 'classic', p: { 1: -0.55, 7: 0.75, 17: 1.0, 13: 0.5, 10: -0.45, 2: 0.45, 5: -0.25 } },
];

console.log('\nFEMALE blends from', tembrica[0].id);
const baseVec = tembrica[0].vec;
const femaleCands = [];
for (const fp of femalePushes) {
  for (const mix of [0.55, 0.7, 0.85]) {
    apply(fp.p);
    const pushVec = Array.from(model.identity);
    const v = blendVec(baseVec, pushVec, mix);
    model.setIdentityVector(Float32Array.from(v));
    model.computeVertices(pos);
    const m = metrics();
    femaleCands.push({ name: fp.name, mix, score: femaleScore(m, base), m, v });
  }
}
femaleCands.sort((a, b) => b.score - a.score);
for (const c of femaleCands.slice(0, 8)) {
  console.log(c.name, 'mix', c.mix, 'score', c.score.toFixed(3), 'eye', c.m.eyeToFace.toFixed(3), 'jaw', c.m.jawToFace.toFixed(3));
}

fs.writeFileSync(
  path.join(__dirname, '_probe_beauty_child.json'),
  JSON.stringify({ base, bestChild: childCands[0], topFemale: femaleCands.slice(0, 8) }, null, 2)
);
