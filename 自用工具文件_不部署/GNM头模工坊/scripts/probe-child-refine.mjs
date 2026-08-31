import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
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
  let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9, c = 0;
  for (let i = 0; i < n; i++) {
    if (!maskFn(i)) continue;
    minX = Math.min(minX, p[i * 3]); maxX = Math.max(maxX, p[i * 3]);
    minY = Math.min(minY, p[i * 3 + 1]); maxY = Math.max(maxY, p[i * 3 + 1]);
    c++;
  }
  return { w: maxX - minX, h: maxY - minY, c };
}

model.resetIdentity();
model.computeVertices(neutral);
const skin0 = bbox((i) => cid[i] === 0, neutral);

function childMetrics(p) {
  const skin = bbox((i) => cid[i] === 0, p);
  const eyes = bbox((i) => cid[i] === 1 || cid[i] === 2, p);
  const upper = bbox((i) => cid[i] === 0 && p[i * 3 + 1] > skin.minY + skin.h * 0.55, p);
  const lower = bbox((i) => cid[i] === 0 && p[i * 3 + 1] < skin.minY + skin.h * 0.42, p);
  return {
    eyeToFace: eyes.w / skin.w,
    upperH: upper.h / skin.h,
    lowerH: lower.h / skin.h,
    eyeH: eyes.h / skin.h,
    skinW: skin.w,
    skinH: skin.h,
  };
}

const base = childMetrics(neutral);

function score(m) {
  return (
    (m.eyeToFace - base.eyeToFace) * 4 +
    (m.eyeH - base.eyeH) * 3 +
    (m.upperH - base.upperH) * 2 +
    (base.lowerH - m.lowerH) * 2.5
  );
}

function apply(pushes) {
  model.resetIdentity();
  for (const [k, v] of Object.entries(pushes)) model.setIdentityParam(Number(k), v);
  model.computeVertices(pos);
  const m = childMetrics(pos);
  return { ...m, score: score(m), pushes };
}

const results = [];
// eye 170-172
for (let i = 170; i <= 172; i++) {
  for (const v of [-2.5, -2, -1.5, 1.5, 2, 2.5]) {
    results.push(apply({ [i]: v }));
  }
}
// teeth 173-175 sample
for (let i = 173; i <= 180; i++) {
  for (const v of [-2, 2]) results.push(apply({ [i]: v }));
}

results.sort((a, b) => b.score - a.score);
console.log('base', base);
console.table(results.slice(0, 20).map((r) => ({
  pushes: JSON.stringify(r.pushes),
  score: +r.score.toFixed(4),
  eyeToFace: +r.eyeToFace.toFixed(4),
  eyeH: +r.eyeH.toFixed(4),
  upperH: +r.upperH.toFixed(4),
  lowerH: +r.lowerH.toFixed(4),
})));

// iterative greedy build child recipe
const childBase = {
  1: -2.2, // 颅高↑
  4: -2.0, // 颅高压低颏？实测幼态
  8: 2.0, // 额侧→眼相对大
  3: -1.8, // 面宽+眼
  5: 1.8, // 横向
  6: -1.8, // 颧颊宽
  7: -1.5, // 面中颊 - 负向更大眼？ probe said 7 -2.5 helps
  10: -1.8, // 颏后
  11: 1.5,
  12: 1.5,
  20: -1.5, // from identity-05
  170: -2.0, // probe eyes
  171: -2.0,
  172: 2.0,
};

let best = apply(childBase);
console.log('\ninitial child', best);

// refine eye dims
for (let e0 = -2.5; e0 <= 2.5; e0 += 0.5) {
  for (let e1 = -2.5; e1 <= 2.5; e1 += 0.5) {
    for (let e2 = -2.5; e2 <= 2.5; e2 += 0.5) {
      const p = { ...childBase, 170: e0, 171: e1, 172: e2 };
      const r = apply(p);
      if (r.score > best.score) best = r;
    }
  }
}
console.log('best after eye grid', best);

// compare old as08
const old = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../data/presets/identity-as08-child-round.json'), 'utf8')
);
const oldM = apply(Object.fromEntries(old.identity.map((v, i) => [i, v]).filter(([, v]) => v !== 0)));
console.log('old as08 nonzero only', oldM);

fs.writeFileSync(path.join(__dirname, '_probe_child_best.json'), JSON.stringify({ base, best }, null, 2));
