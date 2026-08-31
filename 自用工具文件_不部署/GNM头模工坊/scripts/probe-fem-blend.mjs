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

function load(f) {
  return JSON.parse(fs.readFileSync(path.join(PRESETS, f), 'utf8')).identity;
}
function blend(a, b, t) {
  return a.map((v, i) => v * (1 - t) + b[i] * t);
}
function metrics(vec) {
  model.resetIdentity();
  model.setIdentityVector(Float32Array.from(vec));
  model.computeVertices(pos);
  let sx0 = 1e9, sx1 = -1e9, sy0 = 1e9, sy1 = -1e9, sz0 = 1e9, sz1 = -1e9;
  let ex0 = 1e9, ex1 = -1e9, nx = 0, nz = 0, nc = 0, browZ = 0, browN = 0;
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    if (cid[i] === 0) {
      sx0 = Math.min(sx0, x); sx1 = Math.max(sx1, x);
      sy0 = Math.min(sy0, y); sy1 = Math.max(sy1, y);
      sz0 = Math.min(sz0, z); sz1 = Math.max(sz1, z);
      const sh = sy1 - sy0;
      if (Math.abs(x) < (sx1 - sx0) * 0.06 && y > sy0 + sh * 0.48 && y < sy0 + sh * 0.62 && z > sz0 + (sz1 - sz0) * 0.55) {
        nx += x; nz += z; nc++;
      }
      if (y > sy0 + sh * 0.78 && Math.abs(x) < (sx1 - sx0) * 0.35) { browZ += z; browN++; }
    } else if (cid[i] === 1 || cid[i] === 2) ex0 = Math.min(ex0, x), ex1 = Math.max(ex1, x);
  }
  return {
    eyeToFace: +((ex1 - ex0) / (sx1 - sx0)).toFixed(4),
    browProj: +(browN ? browZ / browN : 0).toFixed(4),
    noseProj: +(nc ? nz / nc : 0).toFixed(4),
    skinW: +((sx1 - sx0)).toFixed(5),
    faceIndex: +((sy1 - sy0) / (sx1 - sx0)).toFixed(4),
  };
}

const sf = load('identity-09-soft-female.json');
const t04 = load('identity-t04-tembrica.json');
const FEM = { 5: -0.9, 6: -0.6, 10: -0.5, 17: 0.5, 20: -0.45 };

for (const [name, vec] of [
  ['09', sf],
  ['t04+fem', (() => { model.setIdentityVector(Float32Array.from(t04)); for (const [k,v] of Object.entries(FEM)) model.setIdentityParam(+k, model.identity[+k]+v); return Array.from(model.identity); })()],
  ['09+t04 0.3', blend(sf, t04, 0.3)],
  ['09+t04 0.5', blend(sf, t04, 0.5)],
  ['09 0.7+t04 0.3+fem', (() => { const v = blend(sf, t04, 0.3); model.setIdentityVector(Float32Array.from(v)); for (const [k,val] of Object.entries(FEM)) model.setIdentityParam(+k, model.identity[+k]+val); return Array.from(model.identity); })()],
]) {
  console.log(name, metrics(vec));
}
