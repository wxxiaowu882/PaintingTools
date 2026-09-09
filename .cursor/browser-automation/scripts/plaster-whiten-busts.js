/**
 * 蓝色女中青年头像 → 略灰石膏色另存（不覆盖原文件）
 * 1A / 2B；支持 Draco：只改 JSON（材质 + 去掉 COLOR_0 引用），不重解压几何
 */
const fs = require('fs');
const path = require('path');

const modelDir = path.resolve(__dirname, '../../../docs/model');
const PLASTER = [0.9, 0.9, 0.88, 1];
const ROUGHNESS = 0.72;
const METAL = 0;

function readGlb(filePath) {
  const buf = fs.readFileSync(filePath);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new Error('not glb');
  const jsonLen = dv.getUint32(12, true);
  const json = JSON.parse(Buffer.from(buf.buffer, buf.byteOffset + 20, jsonLen).toString('utf8'));
  const binStart = 20 + jsonLen;
  let bin = null;
  if (binStart + 8 <= buf.length) {
    const binLen = dv.getUint32(binStart, true);
    const binType = dv.getUint32(binStart + 4, true);
    if (binType === 0x004e4942) {
      bin = Buffer.from(buf.buffer, buf.byteOffset + binStart + 8, binLen);
    }
  }
  return { json, bin };
}

function writeGlb(filePath, json, bin) {
  let jsonStr = JSON.stringify(json);
  const jsonPad = (4 - (jsonStr.length % 4)) % 4;
  jsonStr += ' '.repeat(jsonPad);
  const jsonBuf = Buffer.from(jsonStr, 'utf8');
  const binPad = bin ? (4 - (bin.length % 4)) % 4 : 0;
  const binLen = bin ? bin.length + binPad : 0;
  const total = 12 + 8 + jsonBuf.length + (bin ? 8 + binLen : 0);
  const out = Buffer.alloc(total);
  const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
  dv.setUint32(0, 0x46546c67, true);
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBuf.length, true);
  dv.setUint32(16, 0x4e4f534a, true);
  jsonBuf.copy(out, 20);
  if (bin) {
    const binChunkStart = 20 + jsonBuf.length;
    dv.setUint32(binChunkStart, binLen, true);
    dv.setUint32(binChunkStart + 4, 0x004e4942, true);
    bin.copy(out, binChunkStart + 8);
    // padding zeros already from alloc
  }
  fs.writeFileSync(filePath, out);
}

function processOne(srcName) {
  const src = path.join(modelDir, srcName);
  if (!fs.existsSync(src)) return { name: srcName, ok: false, error: 'missing' };
  const outName = srcName.replace(/\.glb$/i, '_石膏白.glb');
  const dst = path.join(modelDir, outName);
  const { json, bin } = readGlb(src);

  let matN = 0;
  for (const mat of json.materials || []) {
    if (!mat.pbrMetallicRoughness) mat.pbrMetallicRoughness = {};
    const pbr = mat.pbrMetallicRoughness;
    pbr.baseColorFactor = PLASTER.slice();
    pbr.metallicFactor = METAL;
    pbr.roughnessFactor = ROUGHNESS;
    delete pbr.baseColorTexture;
    matN++;
  }

  let color0Cleared = 0;
  for (const mesh of json.meshes || []) {
    for (const prim of mesh.primitives || []) {
      if (prim.attributes && prim.attributes.COLOR_0 != null) {
        delete prim.attributes.COLOR_0;
        color0Cleared++;
      }
      const draco = prim.extensions && prim.extensions.KHR_draco_mesh_compression;
      if (draco && draco.attributes && draco.attributes.COLOR_0 != null) {
        delete draco.attributes.COLOR_0;
      }
    }
  }

  writeGlb(dst, json, bin);
  return {
    name: srcName,
    out: outName,
    ok: true,
    mats: matN,
    color0Cleared,
    bytes: fs.statSync(dst).size,
  };
}

const report = [];
for (let i = 1; i <= 6; i++) {
  const r = processOne(`石膏头像_女中青年_0${i}_opt.glb`);
  report.push(r);
  console.log(r.ok ? `OK ${r.name} -> ${r.out}` : `FAIL ${r.name} ${r.error}`);
}

const outJson = path.join(
  __dirname,
  '..',
  'runs',
  `plaster-whiten-${Date.now()}.json`
);
fs.mkdirSync(path.dirname(outJson), { recursive: true });
fs.writeFileSync(outJson, JSON.stringify({ plaster: PLASTER, report }, null, 2));
console.log('REPORT', outJson);
if (report.some((r) => !r.ok)) process.exit(1);
