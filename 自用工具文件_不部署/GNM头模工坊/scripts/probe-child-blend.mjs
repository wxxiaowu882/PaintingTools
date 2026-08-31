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

function measure() {
  model.computeVertices(pos);
  let sx0 = 1e9, sx1 = -1e9, sy0 = 1e9, sy1 = -1e9;
  let ex0 = 1e9, ex1 = -1e9;
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1];
    if (cid[i] === 0) {
      sx0 = Math.min(sx0, x); sx1 = Math.max(sx1, x);
      sy0 = Math.min(sy0, y); sy1 = Math.max(sy1, y);
    } else if (cid[i] === 1 || cid[i] === 2) {
      ex0 = Math.min(ex0, x); ex1 = Math.max(ex1, x);
    }
  }
  const skinW = sx1 - sx0, skinH = sy1 - sy0;
  return { eyeToFace: (ex1 - ex0) / skinW, skinW, skinH };
}

function setVec(v) {
  model.resetIdentity();
  model.setIdentityVector(Float32Array.from(v));
}

function blend(a, b, t) {
  return a.map((v, i) => v * (1 - t) + b[i] * t);
}

function bake(pushes) {
  model.resetIdentity();
  for (const [k, v] of Object.entries(pushes)) model.setIdentityParam(Number(k), v);
  return Array.from(model.identity);
}

const CHILD = { 1: -3, 3: -2, 4: -3, 5: 2, 6: -2, 8: 3, 10: -2.5, 11: 1.5, 12: 1.5, 17: -1.2, 20: -2, 2: 0.45 };
const childVec = bake(CHILD);
const t03 = JSON.parse(fs.readFileSync(path.join(PRESETS, 'identity-t03-tembrica.json'), 'utf8')).identity;
const t05 = JSON.parse(fs.readFileSync(path.join(PRESETS, 'identity-05-childlike.json'), 'utf8')).identity;

setVec(childVec);
console.log('CHILD', measure());

for (const t of [0.25, 0.35, 0.5]) {
  const v = blend(t03, childVec, 1 - t);
  setVec(v);
  console.log('t03+child t=', t, measure());
}

const v05fix = t05.slice();
v05fix[1] = -2.5; v05fix[4] = -2.5; v05fix[8] = 2.5; v05fix[10] = -2;
setVec(v05fix);
console.log('id05 fixed', measure());

const best = blend(t03, childVec, 0.35);
setVec(best);
console.log('blend best', measure());

fs.writeFileSync(path.join(__dirname, '_child_blend_best.json'), JSON.stringify({ best }, null, 2));
