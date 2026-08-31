/**
 * 按审美原型网格搜索美女配方（文献：初恋/幼幼/古典/萝莉/瓜子）
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

function loadVec(file) {
  return JSON.parse(fs.readFileSync(path.join(PRESETS, file), 'utf8')).identity;
}

function blend(a, b, t) {
  return a.map((v, i) => v * (1 - t) + b[i] * t);
}

function applyVec(vec, pushes, mode = 'add') {
  model.resetIdentity();
  model.resetExpression();
  model.resetPose();
  model.setIdentityVector(Float32Array.from(vec));
  for (const [k, v] of Object.entries(pushes || {})) {
    const i = Number(k);
    const nv = mode === 'add' ? model.identity[i] + v : v;
    model.setIdentityParam(i, Math.max(-3, Math.min(3, nv)));
  }
  model.computeVertices(pos);
}

function metrics() {
  let sx0 = 1e9, sx1 = -1e9, sy0 = 1e9, sy1 = -1e9, sz0 = 1e9, sz1 = -1e9;
  let ex0 = 1e9, ex1 = -1e9;
  let fy0 = 1e9, fy1 = -1e9;
  let nx = 0, nz = 0, nc = 0;
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    if (cid[i] === 0) {
      sx0 = Math.min(sx0, x); sx1 = Math.max(sx1, x);
      sy0 = Math.min(sy0, y); sy1 = Math.max(sy1, y);
      sz0 = Math.min(sz0, z); sz1 = Math.max(sz1, z);
      const sh = sy1 - sy0;
      if (y > sy0 + sh * 0.68) { fy0 = Math.min(fy0, y); fy1 = Math.max(fy1, y); }
      if (Math.abs(x) < (sx1 - sx0) * 0.06 && y > sy0 + sh * 0.48 && y < sy0 + sh * 0.62 && z > sz0 + (sz1 - sz0) * 0.55) {
        nx += x; nz += z; nc++;
      }
    } else if (cid[i] === 1 || cid[i] === 2) {
      ex0 = Math.min(ex0, x); ex1 = Math.max(ex1, x);
    }
  }
  const skinW = sx1 - sx0, skinH = sy1 - sy0;
  return {
    eyeToFace: +((ex1 - ex0) / skinW).toFixed(4),
    foreheadRatio: +((fy1 - fy0) / skinH).toFixed(4),
    faceIndex: +(skinH / skinW).toFixed(4),
    noseProj: +(nc ? nz / nc : 0).toFixed(4),
    skinW: +skinW.toFixed(5),
  };
}

applyVec(new Array(253).fill(0), {});
const base = metrics();

const ARCHETYPES = {
  first_love: (m) =>
    (m.skinW - base.skinW) * 8 +
    (0.38 - Math.abs(m.eyeToFace - 0.375)) * 3 +
    (m.faceIndex < 1.42 ? 0.2 : -0.15) +
    (base.noseProj - m.noseProj) * 2,
  yoyou: (m) =>
    (m.skinW - base.skinW) * 6 +
    (m.eyeToFace - base.eyeToFace) * 4 +
    (m.faceIndex < 1.55 ? 0.25 : -0.2) +
    (base.noseProj - m.noseProj) * 3,
  classical: (m) =>
    (0.39 - Math.abs(m.eyeToFace - 0.385)) * 4 +
    (Math.abs(m.faceIndex - 1.42) < 0.08 ? 0.3 : -0.2) +
    (m.skinW - base.skinW) * 2,
  loli: (m) =>
    (m.eyeToFace - base.eyeToFace) * 8 +
    (base.noseProj - m.noseProj) * 2 +
    (m.foreheadRatio - base.foreheadRatio) * 2,
  oval: (m) =>
    (Math.abs(m.faceIndex - 1.4) < 0.06 ? 0.35 : -Math.abs(m.faceIndex - 1.4)) +
    (m.eyeToFace - base.eyeToFace) * 2,
};

const CANDIDATES = [
  { archetype: 'first_love', base: 'identity-t01-tembrica.json', pushes: { 7: 0.5, 13: 0.45, 10: -0.35, 1: 0.2, 20: -0.45 } },
  { archetype: 'first_love', base: 'identity-t01-tembrica.json', pushes: { 7: 0.7, 13: 0.6, 10: -0.4, 2: 0.35, 20: -0.55, 17: 0.35 } },
  { archetype: 'yoyou', base: 'identity-t03-tembrica.json', pushes: { 7: 0.9, 13: 0.75, 1: -0.65, 8: 0.85, 10: -0.65, 4: -0.45 } },
  { archetype: 'yoyou', blend: ['identity-t02-tembrica.json', 'identity-t03-tembrica.json', 0.35], pushes: { 7: 0.85, 13: 0.7, 1: -0.55, 8: 0.75, 10: -0.6 } },
  { archetype: 'classical', base: 'identity-t04-tembrica.json', pushes: { 2: 0.45, 7: 0.3, 10: -0.4, 1: 0.25, 20: -0.4, 5: -0.25 } },
  { archetype: 'classical', base: 'identity-t04-tembrica.json', pushes: { 2: 0.35, 10: -0.35, 13: 0.35, 7: 0.2, 1: 0.15 } },
  { archetype: 'loli', base: 'identity-t02-tembrica.json', pushes: { 1: -1.6, 4: -1.0, 8: 1.2, 10: -0.95, 7: 0.45, 3: -0.45, 17: 0.5 } },
  { archetype: 'loli', base: 'identity-t02-tembrica.json', pushes: { 1: -1.85, 4: -1.15, 8: 1.35, 10: -1.05, 7: 0.55, 3: -0.55, 13: 0.4 } },
  { archetype: 'oval', base: 'identity-t04-tembrica.json', pushes: { 2: 0.4, 7: 0.35, 10: -0.45, 17: 0.45 } },
  { archetype: 'oval', base: 'identity-t04-tembrica.json', pushes: { 2: 0.3, 10: -0.35, 7: 0.25 } },
  { archetype: 'loli', blend: ['identity-t02-tembrica.json', 'identity-t03-tembrica.json', 0.25], pushes: { 1: -1.4, 8: 1.1, 10: -0.85, 7: 0.6, 4: -0.7 } },
  { archetype: 'first_love', blend: ['identity-t01-tembrica.json', 'identity-t04-tembrica.json', 0.4], pushes: { 7: 0.55, 13: 0.5, 10: -0.35, 20: -0.4 } },
];

const results = [];
for (const c of CANDIDATES) {
  let vec;
  if (c.blend) {
    const [f1, f2, t] = c.blend;
    vec = blend(loadVec(f1), loadVec(f2), t);
  } else {
    vec = loadVec(c.base);
  }
  applyVec(vec, c.pushes);
  const m = metrics();
  results.push({ ...c, score: ARCHETYPES[c.archetype](m), m });
}

for (const arch of Object.keys(ARCHETYPES)) {
  const top = results.filter((r) => r.archetype === arch).sort((a, b) => b.score - a.score)[0];
  console.log('\n', arch, 'best', top.score.toFixed(3), top.m, JSON.stringify(top.pushes));
}

fs.writeFileSync(path.join(__dirname, '_probe_beauty_archetypes.json'), JSON.stringify({ base, results }, null, 2));
