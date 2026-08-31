/**
 * 探测女性化基底与各 Tembrica 差异
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

function load(id) {
  return JSON.parse(fs.readFileSync(path.join(PRESETS, `${id}.json`), 'utf8')).identity;
}

function metrics(vec) {
  model.resetIdentity();
  model.resetExpression();
  model.resetPose();
  model.setIdentityVector(Float32Array.from(vec));
  model.computeVertices(pos);
  let sx0 = 1e9, sx1 = -1e9, sy0 = 1e9, sy1 = -1e9, sz0 = 1e9, sz1 = -1e9;
  let ex0 = 1e9, ex1 = -1e9, jx0 = 1e9, jx1 = -1e9;
  let browZ = 0, browN = 0;
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    if (cid[i] === 0) {
      sx0 = Math.min(sx0, x); sx1 = Math.max(sx1, x);
      sy0 = Math.min(sy0, y); sy1 = Math.max(sy1, y);
      sz0 = Math.min(sz0, z); sz1 = Math.max(sz1, z);
      const sh = sy1 - sy0;
      if (y < sy0 + sh * 0.38) jx0 = Math.min(jx0, x), jx1 = Math.max(jx1, x);
      if (y > sy0 + sh * 0.78 && Math.abs(x) < (sx1 - sx0) * 0.35) { browZ += z; browN++; }
    } else if (cid[i] === 1 || cid[i] === 2) {
      ex0 = Math.min(ex0, x); ex1 = Math.max(ex1, x);
    }
  }
  const skinW = sx1 - sx0, skinH = sy1 - sy0;
  return {
    eyeToFace: +((ex1 - ex0) / skinW).toFixed(4),
    faceIndex: +(skinH / skinW).toFixed(4),
    jawToFace: +((jx1 - jx0) / skinW).toFixed(4),
    browProj: +(browN ? browZ / browN : 0).toFixed(4),
    skinW: +skinW.toFixed(5),
    skinD: +((sz1 - sz0)).toFixed(5),
  };
}

const neutral = metrics(new Array(253).fill(0));
console.log('neutral', neutral);

for (const id of ['identity-t01-tembrica', 'identity-t02-tembrica', 'identity-t03-tembrica', 'identity-t04-tembrica', 'identity-09-soft-female', 'identity-as17-female-cool']) {
  console.log(id, metrics(load(id)));
}

// grid: t04 + feminine pushes
const femPushes = [
  { name: 'femA', p: { 5: -1.0, 6: -0.7, 7: 0.55, 10: -0.5, 17: 0.5 } },
  { name: 'femB', p: { 5: -0.8, 6: -0.55, 7: 0.45, 10: -0.45, 17: 0.55, 20: -0.5 } },
  { name: 'femC', p: { 1: -0.5, 5: -0.9, 6: -0.6, 7: 0.5, 10: -0.55, 17: 0.45, 20: -0.45 } },
];
const t04 = load('identity-t04-tembrica');
for (const fp of femPushes) {
  const v = t04.slice();
  model.resetIdentity();
  model.setIdentityVector(Float32Array.from(v));
  for (const [k, val] of Object.entries(fp.p)) {
    model.setIdentityParam(Number(k), model.identity[Number(k)] + val);
  }
  console.log('t04+' + fp.name, metrics(Array.from(model.identity)));
}
