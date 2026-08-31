/**
 * 烘焙东亚身份预设（幼态 / 美女 / 男性）+ 几何门禁
 * Usage: node scripts/bake-asian-identity-presets.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseContainer, GNMHeadModel } from '../js/vendor/GNMModel.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRESETS_DIR = path.join(__dirname, '../data/presets');

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function addHeadNoise(vec, seed, amp = 0.08) {
  const rnd = mulberry32(seed >>> 0);
  const out = vec.slice();
  for (let i = 30; i < 170; i++) {
    const n = (rnd() - 0.5) * 2 * amp;
    if (Math.abs(n) < 0.04) continue;
    out[i] = Math.max(-2.5, Math.min(2.5, out[i] + n));
  }
  return out;
}

/** 网格搜索最优（无 dim0，避免头缩小导致眼比下降） */
const CHILD_CORE = {
  1: -3,
  2: 0.6,
  3: -2.2,
  4: -3,
  5: 2,
  6: -2,
  8: 3,
  10: -1,
  11: 1.2,
  12: 1.2,
  13: 0.4,
  17: -1.5,
  20: -2.2,
  173: -1.5,
  174: -1.5,
  175: -1.5,
  176: -1.5,
  177: -1.5,
};

/** 幼态鼻头挺：抵消 CHILD_CORE 的扁鼻，强化鼻尖前探 */
const CHILD_NOSE_FIRM = { 11: 1.5, 3: -1.15, 20: 1.5, 4: 0.7, 2: 0.35 };

/** 女性化（非 09 基底时叠加） */
const FEM_CORE = { 1: -0.55, 5: -1.45, 6: -1.05, 10: -0.8, 11: -0.45, 17: 0.55, 20: -0.5 };
/** 09 柔女基底上再压眉弓 */
const FEM_SOFT = { 1: -0.25, 5: -0.85, 6: -0.65, 10: -0.5 };
/** 男性化核心：低颅、阔颌、眉弓加强 */
const MALE_CORE = { 1: 0.55, 5: 0.4, 6: 0.35, 10: 0.2 };

function mergePushes(...parts) {
  const out = {};
  for (const p of parts) {
    if (!p) continue;
    for (const [k, v] of Object.entries(p)) out[k] = (out[k] || 0) + v;
  }
  return out;
}

const RECIPES = [
  // —— 男性 ——
  {
    id: 'identity-as01-male-north',
    name: '东亚男·北方面中',
    note: '偏高颅、鼻区略前；颧颊适中',
    hue: '#5a9',
    seed: 0xa501,
    role: 'male',
    pushes: { 1: -1.05, 4: 0.95, 11: 0.55, 10: 0.55, 5: 0.35, 2: 0.25, 7: 0.25 },
  },
  {
    id: 'identity-as02-male-south',
    name: '东亚男·南方阔面',
    note: '阔颧颊、侧面偏扁',
    hue: '#6b8',
    seed: 0xa502,
    role: 'male',
    pushes: { 7: 1.45, 13: 0.95, 2: 0.85, 6: -0.75, 5: -0.75, 1: 0.45, 3: 0.55, 10: 0.35 },
  },
  {
    id: 'identity-as03-male-jaw',
    name: '东亚男·宽颧方颌',
    note: '颧外扩 + 颏前',
    hue: '#7aa',
    seed: 0xa503,
    role: 'male',
    pushes: { 7: 0.95, 10: 0.95, 4: 0.75, 13: 0.65, 17: -0.85, 2: 0.45, 1: -0.35 },
  },
  // —— 女性：t04 女相 + 09 柔女混合，各档强差异 pushes ——
  {
    id: 'identity-as04-female-soft',
    name: '东亚女·温润鹅蛋',
    note: '瓜子鹅蛋：柔和椭圆',
    hue: '#f8b',
    seed: 0xa504,
    role: 'female',
    baseFile: 'identity-t04-tembrica.json',
    blendBaseFile: 'identity-09-soft-female.json',
    blendT: 0.55,
    pushMode: 'add',
    pushes: { 7: 0.4, 10: -0.55, 17: 0.55, 2: 0.35, 8: 0.85, 1: -0.55, 4: -0.45 },
    gate: 'beauty_classic',
  },
  {
    id: 'identity-as05-female-oval',
    name: '东亚女·初恋清纯',
    note: '初恋脸：阔面留白、低鼻',
    hue: '#eab',
    seed: 0xa505,
    role: 'female',
    baseFile: 'identity-t04-tembrica.json',
    blendBaseFile: 'identity-09-soft-female.json',
    blendT: 0.55,
    pushMode: 'add',
    pushes: { 7: 1.05, 13: 0.85, 20: -0.65, 10: -0.45, 2: 0.25 },
    gate: 'beauty_first',
  },
  {
    id: 'identity-as06-female-youth',
    name: '东亚女·元气幼幼',
    note: '幼幼脸：圆短阔颊、大眼',
    hue: '#f9c',
    seed: 0xa506,
    role: 'female',
    baseFile: 'identity-t02-tembrica.json',
    blendBaseFile: 'identity-09-soft-female.json',
    blendT: 0.32,
    pushMode: 'add',
    pushes: { 1: -1.55, 4: -0.95, 8: 1.15, 7: 0.65, 10: -0.95, 6: -0.55 },
    gate: 'beauty_loli',
  },
  // —— 美女专题 ——
  {
    id: 'identity-as10-female-vline',
    name: '美女·瓜子温润',
    note: '瓜子脸：颏尖椭圆',
    hue: '#f6a',
    seed: 0xa510,
    role: 'female',
    baseFile: 'identity-t04-tembrica.json',
    blendBaseFile: 'identity-09-soft-female.json',
    blendT: 0.55,
    pushMode: 'add',
    pushes: { 17: 0.75, 10: -0.65, 2: 0.45, 7: 0.3, 8: 0.85, 1: -0.55, 4: -0.45 },
    gate: 'beauty_classic',
  },
  {
    id: 'identity-as11-female-heart',
    name: '美女·初恋留白',
    note: '初恋加强：最大面中留白',
    hue: '#f8c',
    seed: 0xa511,
    role: 'female',
    baseFile: 'identity-t04-tembrica.json',
    blendBaseFile: 'identity-09-soft-female.json',
    blendT: 0.55,
    pushMode: 'add',
    pushes: { 7: 1.35, 13: 1.0, 20: -0.75, 10: -0.5, 2: 0.35 },
    gate: 'beauty_first',
  },
  {
    id: 'identity-as12-female-doe-eye',
    name: '美女·丹凤古典',
    note: '丹凤：面略长、眼适中',
    hue: '#e9b',
    seed: 0xa512,
    role: 'female',
    baseFile: 'identity-t04-tembrica.json',
    blendBaseFile: 'identity-09-soft-female.json',
    blendT: 0.55,
    pushMode: 'add',
    pushes: { 2: 0.2, 5: -0.5, 7: 1.38, 13: 1.05, 1: -0.2, 10: -0.28, 8: 0.5, 4: -0.28, 3: 0.0 },
    gate: 'beauty_classic',
  },
  {
    id: 'identity-as13-female-sweet',
    name: '美女·甜美萝莉',
    note: '萝莉：大眼短颏',
    hue: '#fba',
    seed: 0xa513,
    role: 'female',
    baseFile: 'identity-t02-tembrica.json',
    blendBaseFile: 'identity-09-soft-female.json',
    blendT: 0.12,
    pushMode: 'add',
    pushes: { 1: -2.0, 3: -0.6, 4: -1.2, 7: 0.5, 8: 1.52, 10: -1.1, 6: -0.55 },
    gate: 'beauty_loli',
  },
  {
    id: 'identity-as14-female-classic',
    name: '美女·幼幼元气',
    note: '幼幼：短宽圆颊',
    hue: '#fad',
    seed: 0xa514,
    role: 'female',
    baseFile: 'identity-t02-tembrica.json',
    blendBaseFile: 'identity-09-soft-female.json',
    blendT: 0.22,
    pushMode: 'add',
    pushes: { 7: 0.95, 13: 0.85, 1: -0.75, 8: 1.0, 4: -0.55, 10: -0.85, 6: -0.4 },
    gate: 'beauty_yoyou',
  },
  {
    id: 'identity-as15-female-petite',
    name: '美女·漫画大眼',
    note: '漫画：眼最大',
    hue: '#f9e',
    seed: 0xa515,
    role: 'female',
    baseFile: 'identity-t02-tembrica.json',
    blendBaseFile: 'identity-09-soft-female.json',
    blendT: 0.1,
    pushMode: 'add',
    pushes: { 1: -1.65, 4: -0.85, 8: 1.3, 7: 0.55, 10: -1.0, 6: -0.5 },
    gate: 'beauty_loli_max',
  },
  {
    id: 'identity-as16-female-grace',
    name: '美女·温婉古典',
    note: '温婉：鹅蛋柔颊',
    hue: '#f5d',
    seed: 0xa516,
    role: 'female',
    baseFile: 'identity-t04-tembrica.json',
    blendBaseFile: 'identity-09-soft-female.json',
    blendT: 0.55,
    pushMode: 'add',
    pushes: { 7: 0.35, 10: -0.5, 13: 0.4, 2: 0.35, 17: 0.45, 8: 0.55, 1: 0.15, 4: -0.4 },
    gate: 'beauty_classic',
  },
  {
    id: 'identity-as17-female-cool',
    name: '美女·清冷疏朗',
    note: '清冷：长面疏朗、低鼻',
    hue: '#dce',
    seed: 0xa517,
    role: 'female',
    baseFile: 'identity-t04-tembrica.json',
    blendBaseFile: 'identity-09-soft-female.json',
    blendT: 0.55,
    pushMode: 'add',
    pushes: { 2: 2.05, 3: 1.2, 7: -0.7, 13: -0.6, 5: -0.65, 6: -0.65, 10: -0.45, 20: -0.6, 1: -0.35, 8: 0.5, 4: -0.12 },
    gate: 'beauty_classic_long',
  },
  // —— 幼态 ——
  {
    id: 'identity-as07-child-wide',
    name: '幼态·大眼童颜（5–8）',
    note: '幼态极限：颅高↑、小牙、大眼；GNM 成人 PCA 上限',
    hue: '#fc9',
    seed: 0xa507,
    gate: 'child',
    pushes: { ...CHILD_CORE },
  },
  {
    id: 'identity-as08-child-round',
    name: '幼态·圆颅饱满（7–10）',
    note: '更强圆颅：颊外扩 + 颏后收；鼻头略挺',
    hue: '#fdb',
    seed: 0xa508,
    gate: 'child',
    pushes: { ...CHILD_CORE, 10: -1.35, 13: 0.55 },
  },
  {
    id: 'identity-as09-child-tween',
    name: '幼态·少年（11–14）',
    note: '眼仍偏大、颌略长',
    hue: '#fec',
    seed: 0xa509,
    gate: 'tween',
    pushes: {
      1: -2.2,
      3: -1.6,
      4: -2.2,
      5: 1.5,
      6: -1.5,
      8: 2.4,
      10: -1.3,
      11: 1.0,
      12: 1.0,
      20: -1.5,
      2: 0.4,
      173: -0.8,
      174: -0.8,
      175: -0.8,
    },
  },
];

function loadModel() {
  const buf = fs.readFileSync(path.join(__dirname, '../data/gnm/gnm_head_web.bin'));
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const { meta, sections } = parseContainer(ab);
  return new GNMHeadModel(meta, sections);
}

function measure(model, identity) {
  const n = model.numVertices;
  const cid = model.componentId;
  const pos = new Float32Array(n * 3);
  model.resetIdentity();
  model.setIdentityVector(Float32Array.from(identity));
  model.computeVertices(pos);

  let sx0 = 1e9, sx1 = -1e9, sy0 = 1e9, sy1 = -1e9, sz0 = 1e9, sz1 = -1e9;
  let ex0 = 1e9, ex1 = -1e9, ey0 = 1e9, ey1 = -1e9;
  let fy0 = 1e9, fy1 = -1e9;
  let noseTipZ = -1e9;
  let browZ = 0, browN = 0;

  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    if (cid[i] === 0) {
      sx0 = Math.min(sx0, x); sx1 = Math.max(sx1, x);
      sy0 = Math.min(sy0, y); sy1 = Math.max(sy1, y);
      sz0 = Math.min(sz0, z); sz1 = Math.max(sz1, z);
      const sh = sy1 - sy0, sw = sx1 - sx0;
      if (sh > 0.01 && y > sy0 + sh * 0.36 && y < sy0 + sh * 0.54 && Math.abs(x) < sw * 0.14) {
        noseTipZ = Math.max(noseTipZ, z);
      }
      if (y > sy0 + sh * 0.68) { fy0 = Math.min(fy0, y); fy1 = Math.max(fy1, y); }
      if (y > sy0 + sh * 0.78 && Math.abs(x) < (sx1 - sx0) * 0.35) { browZ += z; browN++; }
    } else if (cid[i] === 1 || cid[i] === 2) {
      ex0 = Math.min(ex0, x); ex1 = Math.max(ex1, x);
      ey0 = Math.min(ey0, y); ey1 = Math.max(ey1, y);
    }
  }
  const skinW = sx1 - sx0, skinH = sy1 - sy0;
  const eyeW = ex1 - ex0, eyeH = ey1 - ey0;
  return {
    eyeToFace: +(eyeW / skinW).toFixed(4),
    eyeHRatio: +(eyeH / skinH).toFixed(4),
    foreheadRatio: +((fy1 - fy0) / skinH).toFixed(4),
    faceIndex: +(skinH / skinW).toFixed(4),
    browProj: +(browN ? browZ / browN : 0).toFixed(4),
    noseTipZ: +(noseTipZ > -1e8 ? noseTipZ : 0).toFixed(4),
    skinW: +skinW.toFixed(5),
    skinH: +skinH.toFixed(5),
  };
}

function bakeVector(model, recipe) {
  model.resetIdentity();
  model.resetExpression();
  model.resetPose();

  let baseVec = null;
  if (recipe.baseFile) {
    const j = JSON.parse(fs.readFileSync(path.join(PRESETS_DIR, recipe.baseFile), 'utf8'));
    baseVec = j.identity.slice();
  }
  if (recipe.blendBaseFile && baseVec) {
    const j2 = JSON.parse(fs.readFileSync(path.join(PRESETS_DIR, recipe.blendBaseFile), 'utf8'));
    const t = recipe.blendT ?? 0.5;
    baseVec = baseVec.map((v, i) => v * (1 - t) + j2.identity[i] * t);
  }
  if (baseVec) model.setIdentityVector(Float32Array.from(baseVec));

  let pushes = recipe.pushes || {};
  if (recipe.role === 'female' && recipe.baseFile === 'identity-09-soft-female.json') {
    pushes = mergePushes(FEM_SOFT, pushes);
  } else if (recipe.role === 'female') {
    pushes = mergePushes(FEM_CORE, pushes);
  }
  if (recipe.role === 'male') pushes = mergePushes(MALE_CORE, pushes);
  if (recipe.gate === 'child' || recipe.gate === 'tween') {
    pushes = mergePushes(pushes, CHILD_NOSE_FIRM);
  }

  for (const [idx, val] of Object.entries(pushes)) {
    const i = Number(idx);
    const v = recipe.pushMode === 'add' ? model.identity[i] + val : val;
    model.setIdentityParam(i, Math.max(-3, Math.min(3, v)));
  }

  const base = Array.from(model.identity);
  const noiseAmp =
    recipe.gate === 'child' || recipe.gate === 'tween'
      ? 0.04
      : recipe.role === 'female' || recipe.gate?.startsWith('beauty')
        ? 0.03
        : 0.06;
  return addHeadNoise(base, recipe.seed, noiseAmp);
}

function assertGate(recipe, m, neutral) {
  if (recipe.gate === 'child') {
    if (m.eyeToFace < 0.465) throw new Error(`${recipe.id}: eyeToFace ${m.eyeToFace} < 0.465`);
    if (m.foreheadRatio < neutral.foreheadRatio * 1.01)
      throw new Error(`${recipe.id}: foreheadRatio ${m.foreheadRatio} low`);
  }
  if (recipe.gate === 'tween') {
    if (m.eyeToFace < 0.41) throw new Error(`${recipe.id}: eyeToFace ${m.eyeToFace} < 0.41`);
  }
  if (recipe.role === 'male' && m.browProj < 0.0465) {
    throw new Error(`${recipe.id}: browProj ${m.browProj} not masculine enough`);
  }
  if (
    recipe.role === 'female' &&
    (recipe.gate === 'beauty_classic' ||
      recipe.gate === 'beauty_first' ||
      recipe.gate === 'beauty_classic_long') &&
    m.browProj > neutral.browProj + 0.003
  ) {
    throw new Error(`${recipe.id}: browProj ${m.browProj} too masculine for female`);
  }
  if (recipe.gate === 'beauty_classic') {
    if (m.eyeToFace < 0.338 || m.eyeToFace > 0.42)
      throw new Error(`${recipe.id}: eyeToFace ${m.eyeToFace} not classic range`);
    if (m.skinW < neutral.skinW * 0.96)
      throw new Error(`${recipe.id}: face too narrow (网红锥子倾向)`);
  }
  if (recipe.gate === 'beauty_loli') {
    if (m.eyeToFace < 0.405)
      throw new Error(`${recipe.id}: eyeToFace ${m.eyeToFace} < 0.405`);
  }
  if (recipe.gate === 'beauty_yoyou') {
    if (m.faceIndex < 1.45)
      throw new Error(`${recipe.id}: faceIndex ${m.faceIndex} not short/wide enough`);
    if (m.eyeToFace < 0.38)
      throw new Error(`${recipe.id}: eyeToFace ${m.eyeToFace} < 0.38`);
  }
  if (recipe.gate === 'beauty_classic_long') {
    if (m.eyeToFace < 0.332 || m.eyeToFace > 0.38)
      throw new Error(`${recipe.id}: eyeToFace ${m.eyeToFace} not long-classic`);
    if (m.faceIndex < 1.26)
      throw new Error(`${recipe.id}: faceIndex ${m.faceIndex} not long enough`);
  }
  if (recipe.gate === 'beauty_loli_max') {
    if (m.eyeToFace < 0.425)
      throw new Error(`${recipe.id}: eyeToFace ${m.eyeToFace} < 0.43`);
  }
  if (recipe.gate === 'beauty_first') {
    if (m.eyeToFace > 0.37)
      throw new Error(`${recipe.id}: eyeToFace ${m.eyeToFace} too large for 初恋脸`);
    if (m.skinW < neutral.skinW * 1.01)
      throw new Error(`${recipe.id}: face not wide enough for 初恋留白`);
  }
}

function syncManifest(baked) {
  const manifestPath = path.join(PRESETS_DIR, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const byId = new Map((manifest.identities || []).map((x) => [x.id, x]));

  for (const b of baked) {
    byId.set(b.id, {
      id: b.id,
      name: b.name,
      note: b.note,
      hue: b.hue,
      file: b.file,
    });
  }

  const order = [
    'identity-01-mean',
    ...['t01', 't02', 't03', 't04', 't05', 't06'].map((t) => `identity-${t}-tembrica`),
    'identity-as01-male-north',
    'identity-as02-male-south',
    'identity-as03-male-jaw',
    'identity-as04-female-soft',
    'identity-as05-female-oval',
    'identity-as06-female-youth',
    'identity-as10-female-vline',
    'identity-as11-female-heart',
    'identity-as12-female-doe-eye',
    'identity-as13-female-sweet',
    'identity-as14-female-classic',
    'identity-as15-female-petite',
    'identity-as16-female-grace',
    'identity-as17-female-cool',
    'identity-as07-child-wide',
    'identity-as08-child-round',
    'identity-as09-child-tween',
  ];

  const identities = [];
  for (const id of order) {
    if (byId.has(id)) identities.push(byId.get(id));
  }
  for (const [id, entry] of byId) {
    if (!order.includes(id)) identities.push(entry);
  }

  manifest.identities = identities;
  manifest.disclaimer =
    '身份含 Tembrica、东亚男/女/美女/幼态配方；女相 t04+09 混合+FEM_CORE。均非真人。';
  const tembricaNotes = {
    'identity-t01-tembrica': '偏长男相（勿作美女基底）',
    'identity-t02-tembrica': '大眼窄面（萝莉/幼幼）',
    'identity-t03-tembrica': '圆短阔面（幼幼）',
    'identity-t04-tembrica': '温润椭圆女相（美女默认基底）',
    'identity-t05-tembrica': '阔面偏钝',
    'identity-t06-tembrica': '窄长偏老',
  };
  for (const entry of identities) {
    if (tembricaNotes[entry.id]) entry.note = tembricaNotes[entry.id];
  }
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}

function main() {
  const model = loadModel();
  const neutral = measure(model, new Float32Array(model.identityDim));
  console.log('neutral', neutral);

  const baked = [];
  for (const recipe of RECIPES) {
    const identity = bakeVector(model, recipe);
    const m = measure(model, identity);
    assertGate(recipe, m, neutral);
    const file = `${recipe.id}.json`;
    const doc = {
      id: recipe.id,
      type: 'identity',
      name: recipe.name,
      note: recipe.note,
      hue: recipe.hue,
      disclaimer: '按文献倾向与实测维烘焙；统计原型，非真人',
      identity,
    };
    fs.writeFileSync(path.join(PRESETS_DIR, file), JSON.stringify(doc));
    baked.push({ ...recipe, file, metrics: m });
    console.log(
      recipe.id,
      recipe.gate || 'adult',
      'eye',
      m.eyeToFace,
      'fore',
      m.foreheadRatio,
      'Δeye',
      (m.eyeToFace - neutral.eyeToFace).toFixed(4)
    );
  }

  syncManifest(baked);
  fs.writeFileSync(
    path.join(__dirname, '_bake_asian_report.json'),
    JSON.stringify({ neutral, baked }, null, 2)
  );
  console.log('OK', baked.length, 'presets');
}

main();
