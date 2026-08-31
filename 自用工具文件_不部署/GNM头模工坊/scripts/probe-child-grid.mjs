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

function measure() {
  model.computeVertices(pos);
  let sx0 = 1e9, sx1 = -1e9, sy0 = 1e9, sy1 = -1e9;
  let ex0 = 1e9, ex1 = -1e9, ey0 = 1e9, ey1 = -1e9;
  let fy0 = 1e9, fy1 = -1e9, cy0 = 1e9, cy1 = -1e9;
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1];
    if (cid[i] === 0) {
      sx0 = Math.min(sx0, x); sx1 = Math.max(sx1, x);
      sy0 = Math.min(sy0, y); sy1 = Math.max(sy1, y);
      const sh = sy1 - sy0;
      if (y > sy0 + sh * 0.68) { fy0 = Math.min(fy0, y); fy1 = Math.max(fy1, y); }
      if (y < sy0 + sh * 0.38) { cy0 = Math.min(cy0, y); cy1 = Math.max(cy1, y); }
    } else if (cid[i] === 1 || cid[i] === 2) {
      ex0 = Math.min(ex0, x); ex1 = Math.max(ex1, x);
      ey0 = Math.min(ey0, y); ey1 = Math.max(ey1, y);
    }
  }
  const skinW = sx1 - sx0, skinH = sy1 - sy0;
  const eyeW = ex1 - ex0, eyeH = ey1 - ey0;
  const foreheadH = fy1 - fy0;
  const chinH = cy1 - cy0;
  return {
    eyeToFace: eyeW / skinW,
    eyeToHead: eyeH / skinH,
    foreheadRatio: foreheadH / skinH,
    chinRatio: chinH / skinH,
    skinW,
    skinH,
  };
}

model.resetIdentity();
const base = measure();
console.log('base', base);

function apply(p) {
  model.resetIdentity();
  for (const [k, v] of Object.entries(p)) model.setIdentityParam(Number(k), v);
  return measure();
}

const candidates = [];
for (let a1 = -3; a1 <= -1.5; a1 += 0.5) {
  for (let a4 = -3; a4 <= -1.5; a4 += 0.5) {
    for (let a10 = -3; a10 <= -1; a10 += 0.5) {
      for (let a8 = 1; a8 <= 3; a8 += 0.5) {
        const p = { 1: a1, 4: a4, 10: a10, 8: a8, 3: -2, 5: 2, 6: -2, 11: 1.5, 12: 1.5, 20: -2 };
        const m = apply(p);
        const score =
          (m.eyeToFace - base.eyeToFace) * 5 +
          (m.eyeToHead - base.eyeToHead) * 4 +
          (m.foreheadRatio - base.foreheadRatio) * 3 +
          (base.chinRatio - m.chinRatio) * 2;
        candidates.push({ score, p, m });
      }
    }
  }
}
candidates.sort((a, b) => b.score - a.score);
console.log('\nTOP 8');
for (const c of candidates.slice(0, 8)) {
  console.log('score', c.score.toFixed(4), 'eyeToFace', c.m.eyeToFace.toFixed(4), 'forehead', c.m.foreheadRatio.toFixed(4), 'chin', c.m.chinRatio.toFixed(4), JSON.stringify(c.p));
}

// blend with identity-05
const id05 = JSON.parse(fs.readFileSync(path.join(__dirname, '../data/presets/identity-05-childlike.json'), 'utf8'));
model.resetIdentity();
model.setIdentityVector(Float32Array.from(id05.identity));
const id05m = measure();
console.log('\nidentity-05-childlike', id05m);

// fix id05 dim1 to negative
const fixed05 = id05.identity.slice();
fixed05[1] = -2.2;
fixed05[10] = -2.0;
fixed05[4] = -2.0;
fixed05[8] = 2.0;
model.setIdentityVector(Float32Array.from(fixed05));
console.log('fixed05', measure());

fs.writeFileSync(path.join(__dirname, '_probe_child_grid.json'), JSON.stringify({ base, top: candidates.slice(0, 8) }, null, 2));
