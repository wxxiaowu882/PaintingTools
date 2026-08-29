import fs from 'fs';
import { parseContainer, GNMHeadModel } from '../js/vendor/GNMModel.js';

const buf = fs.readFileSync(new URL('../data/gnm/gnm_head_web.bin', import.meta.url));
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const { meta, sections } = parseContainer(ab);
const model = new GNMHeadModel(meta, sections);
const n = model.numVertices;
const componentId = sections.component_id;
const neutral = new Float32Array(n * 3);
const pos = new Float32Array(n * 3);
model.resetIdentity();
model.resetExpression();
model.resetPose();
model.computeVertices(neutral);

function bboxOf(maskFn, p = neutral) {
  let minX = 1e9,
    minY = 1e9,
    minZ = 1e9,
    maxX = -1e9,
    maxY = -1e9,
    maxZ = -1e9,
    c = 0;
  for (let i = 0; i < n; i++) {
    if (!maskFn(i)) continue;
    const x = p[i * 3],
      y = p[i * 3 + 1],
      z = p[i * 3 + 2];
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
    c++;
  }
  return {
    minX,
    minY,
    minZ,
    maxX,
    maxY,
    maxZ,
    w: maxX - minX,
    h: maxY - minY,
    d: maxZ - minZ,
    c,
  };
}

const skin = (i) => componentId[i] === 0;
const lowerTeeth = (i) => componentId[i] === 4;
const bSkin = bboxOf(skin);
console.log('components', meta.componentNames);
console.log('skin bbox', bSkin);

const lip = (i) => {
  if (!skin(i)) return false;
  const y = neutral[i * 3 + 1],
    z = neutral[i * 3 + 2];
  return (
    z > bSkin.minZ + bSkin.d * 0.55 &&
    y > bSkin.minY + bSkin.h * 0.28 &&
    y < bSkin.minY + bSkin.h * 0.48
  );
};
const brow = (i) => {
  if (!skin(i)) return false;
  const y = neutral[i * 3 + 1],
    z = neutral[i * 3 + 2];
  return (
    z > bSkin.minZ + bSkin.d * 0.5 &&
    y > bSkin.minY + bSkin.h * 0.62 &&
    y < bSkin.minY + bSkin.h * 0.78
  );
};
const cheek = (i) => {
  if (!skin(i)) return false;
  const x = Math.abs(neutral[i * 3]),
    y = neutral[i * 3 + 1];
  return x > bSkin.w * 0.28 && y > bSkin.minY + bSkin.h * 0.4 && y < bSkin.minY + bSkin.h * 0.62;
};
const forehead = (i) => {
  if (!skin(i)) return false;
  const y = neutral[i * 3 + 1],
    z = neutral[i * 3 + 2];
  return y > bSkin.minY + bSkin.h * 0.78 && z > bSkin.minZ + bSkin.d * 0.35;
};
const chinBand = (i) => {
  if (!skin(i)) return false;
  const y = neutral[i * 3 + 1],
    z = neutral[i * 3 + 2];
  return y < bSkin.minY + bSkin.h * 0.32 && z > bSkin.minZ + bSkin.d * 0.45;
};
const noseBand = (i) => {
  if (!skin(i)) return false;
  const x = Math.abs(neutral[i * 3]),
    y = neutral[i * 3 + 1],
    z = neutral[i * 3 + 2];
  return (
    x < bSkin.w * 0.08 &&
    y > bSkin.minY + bSkin.h * 0.45 &&
    y < bSkin.minY + bSkin.h * 0.62 &&
    z > bSkin.minZ + bSkin.d * 0.65
  );
};

function meanDisp(maskFn) {
  let sx = 0,
    sy = 0,
    sz = 0,
    c = 0;
  for (let i = 0; i < n; i++) {
    if (!maskFn(i)) continue;
    sx += pos[i * 3] - neutral[i * 3];
    sy += pos[i * 3 + 1] - neutral[i * 3 + 1];
    sz += pos[i * 3 + 2] - neutral[i * 3 + 2];
    c++;
  }
  return c ? { x: sx / c, y: sy / c, z: sz / c, c } : { x: 0, y: 0, z: 0, c: 0 };
}
function widthOf(maskFn, p) {
  let minX = 1e9,
    maxX = -1e9;
  for (let i = 0; i < n; i++) {
    if (!maskFn(i)) continue;
    minX = Math.min(minX, p[i * 3]);
    maxX = Math.max(maxX, p[i * 3]);
  }
  return maxX - minX;
}
function depthOf(maskFn, p) {
  let minZ = 1e9,
    maxZ = -1e9;
  for (let i = 0; i < n; i++) {
    if (!maskFn(i)) continue;
    minZ = Math.min(minZ, p[i * 3 + 2]);
    maxZ = Math.max(maxZ, p[i * 3 + 2]);
  }
  return maxZ - minZ;
}
function heightOf(maskFn, p) {
  let minY = 1e9,
    maxY = -1e9;
  for (let i = 0; i < n; i++) {
    if (!maskFn(i)) continue;
    minY = Math.min(minY, p[i * 3 + 1]);
    maxY = Math.max(maxY, p[i * 3 + 1]);
  }
  return maxY - minY;
}

function analyze(kind, idx, amp = 2.5) {
  model.resetIdentity();
  model.resetExpression();
  model.resetPose();
  if (kind === 'id') model.setIdentityParam(idx, amp);
  else model.setExpressionParam(idx, amp);
  model.computeVertices(pos);
  const lipD = meanDisp(lip);
  const browD = meanDisp(brow);
  const cheekD = meanDisp(cheek);
  const foreD = meanDisp(forehead);
  const chinD = meanDisp(chinBand);
  const noseD = meanDisp(noseBand);
  const teethD = meanDisp(lowerTeeth);
  const dw = widthOf(skin, pos) - widthOf(skin, neutral);
  const dh = heightOf(skin, pos) - heightOf(skin, neutral);
  const dd = depthOf(skin, pos) - depthOf(skin, neutral);
  const cheekW = widthOf(cheek, pos) - widthOf(cheek, neutral);
  const lipGap = heightOf(lip, pos) - heightOf(lip, neutral);
  return {
    idx,
    dw: +dw.toFixed(4),
    dh: +dh.toFixed(4),
    dd: +dd.toFixed(4),
    cheekW: +cheekW.toFixed(4),
    lipGap: +lipGap.toFixed(4),
    lip: [lipD.x, lipD.y, lipD.z].map((v) => +v.toFixed(4)),
    brow: [browD.x, browD.y, browD.z].map((v) => +v.toFixed(4)),
    cheek: [cheekD.x, cheekD.y, cheekD.z].map((v) => +v.toFixed(4)),
    fore: [foreD.x, foreD.y, foreD.z].map((v) => +v.toFixed(4)),
    chin: [chinD.x, chinD.y, chinD.z].map((v) => +v.toFixed(4)),
    nose: [noseD.x, noseD.y, noseD.z].map((v) => +v.toFixed(4)),
    teethY: +teethD.y.toFixed(4),
    teethZ: +teethD.z.toFixed(4),
  };
}

function labelId(r) {
  const scores = [
    ['整体宽深缩放', Math.abs(r.dw) + Math.abs(r.dd)],
    ['头颅高度', Math.abs(r.dh)],
    ['前后厚度', Math.abs(r.dd)],
    ['面宽颧颊', Math.abs(r.cheekW)],
    ['额部', Math.hypot(r.fore[1], r.fore[2])],
    ['眉弓区', Math.hypot(...r.brow)],
    ['鼻区', Math.hypot(...r.nose)],
    ['颏区', Math.hypot(...r.chin)],
    ['口唇区', Math.hypot(...r.lip)],
  ];
  scores.sort((a, b) => b[1] - a[1]);
  return scores.slice(0, 3);
}

const out = { identity: [], mouth: [], smile: [], eye: [] };

console.log('=== Identity 0-35 ===');
for (let i = 0; i <= 35; i++) {
  const r = analyze('id', i, 2.5);
  const labs = labelId(r);
  out.identity.push({ ...r, labs });
  console.log(
    String(i).padStart(2),
    'dw/dh/dd',
    r.dw,
    r.dh,
    r.dd,
    'cheekW',
    r.cheekW,
    'noseZ',
    r.nose[2],
    'chinZ',
    r.chin[2],
    'browZ',
    r.brow[2],
    '=>',
    labs.map((l) => l[0] + '(' + l[1].toFixed(4) + ')').join(' | ')
  );
}

console.log('=== Mouth-open candidates (ex 200-349) ===');
const mouthCands = [];
for (let i = 200; i < 350; i++) {
  const r = analyze('ex', i, 2.5);
  mouthCands.push({
    i,
    teethY: r.teethY,
    lipGap: r.lipGap,
    lipY: r.lip[1],
    lipZ: r.lip[2],
    chinY: r.chin[1],
  });
}
mouthCands.sort((a, b) => a.teethY - b.teethY);
console.log('lower teeth DOWN:');
console.table(mouthCands.slice(0, 15));
out.mouth = mouthCands.slice(0, 15);

mouthCands.sort((a, b) => b.lipGap - a.lipGap);
console.log('lipGap up:');
console.table(mouthCands.slice(0, 12));

mouthCands.sort((a, b) => b.lipZ - a.lipZ);
console.log('lip forward (smile-ish?):');
console.table(mouthCands.slice(0, 10));

console.log('=== Left eye 0-20 ===');
for (let i = 0; i <= 20; i++) {
  const r = analyze('ex', i, 2.5);
  out.eye.push({ i, brow: r.brow, lip: r.lip });
  console.log(i, 'brow', r.brow.join(','), 'rms-ish brow', Math.hypot(...r.brow).toFixed(4));
}

fs.writeFileSync(
  new URL('./_probe_param_labels.json', import.meta.url),
  JSON.stringify(out, null, 2)
);
console.log('wrote _probe_param_labels.json');
