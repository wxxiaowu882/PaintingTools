/**
 * 头扫 B 路线：从 V9.9.26_eyeFix 源 GLB 做「PBR 预览」包。
 * - 皮肤 baseColor → Colour.jpg（真彩色，非合成 slim）
 * - 保留 Normal.jpg
 * - 去掉 extras.sfMatcap / emissive Matcap，管理器会走 model-viewer PBR
 * - 不跑喷眉睫 / 不写 Ultimate Matcap slim
 *
 * 用法: node scripts/make-headscan-pbr-preview.js
 */
const fs = require('fs');
const path = require('path');

const src = 'E:/模型/0820模型下载/3D Head scan shader testing_V9.9.26_eyeFix.glb';
const outPbr = 'E:/模型/0820模型下载/3D Head scan shader testing_PBR_Preview.glb';
const rollback = 'E:/模型/0820模型下载/3D Head scan shader testing_V9.9.98_Rollback.glb';
const currentRec = 'E:/模型/0820模型下载/3D Head scan shader testing_CURRENT_推荐打开.glb';

function readGlb(p) {
  const buf = fs.readFileSync(p);
  const jsonLen = buf.readUInt32LE(12);
  const j = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
  const binHdr = 20 + jsonLen;
  const binLen = buf.readUInt32LE(binHdr);
  const bin = buf.slice(binHdr + 8, binHdr + 8 + binLen);
  return { j, bin, buf };
}

function writeGlb(j, bin, outPath) {
  let jsonStr = JSON.stringify(j);
  jsonStr += ' '.repeat((4 - (jsonStr.length % 4)) % 4);
  const jsonU8 = Buffer.from(jsonStr, 'utf8');
  const total = 12 + 8 + jsonU8.length + 8 + bin.length;
  const out = Buffer.alloc(total);
  out.write('glTF', 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonU8.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  jsonU8.copy(out, 20);
  const binOff = 20 + jsonU8.length;
  out.writeUInt32LE(bin.length, binOff);
  out.writeUInt32LE(0x004e4942, binOff + 4);
  bin.copy(out, binOff + 8);
  fs.writeFileSync(outPath, out);
}

function findImageIndex(j, re) {
  return (j.images || []).findIndex((im) => re.test(im.name || ''));
}

function ensureTextureForImage(j, imageIndex) {
  if (imageIndex < 0) return -1;
  let ti = (j.textures || []).findIndex((t) => t.source === imageIndex);
  if (ti >= 0) return ti;
  if (!j.textures) j.textures = [];
  j.textures.push({ source: imageIndex });
  return j.textures.length - 1;
}

function main() {
  if (!fs.existsSync(src)) throw new Error('missing source: ' + src);
  const { j, bin } = readGlb(src);
  const colourImg = findImageIndex(j, /^Colour/i);
  const normalImg = findImageIndex(j, /^Normal/i);
  if (colourImg < 0) throw new Error('Colour.jpg not found in source');
  const colourTex = ensureTextureForImage(j, colourImg);
  const normalTex = normalImg >= 0 ? ensureTextureForImage(j, normalImg) : -1;

  let nSkin = 0;
  (j.materials || []).forEach((m) => {
    const extras = m.extras || {};
    if (!extras.sfMatcap) return;
    const pbr = m.pbrMetallicRoughness || (m.pbrMetallicRoughness = {});
    pbr.baseColorTexture = { index: colourTex };
    pbr.baseColorFactor = [1, 1, 1, 1];
    pbr.metallicFactor = 0;
    pbr.roughnessFactor = 0.72;
    if (normalTex >= 0) m.normalTexture = { index: normalTex, scale: 1 };
    delete m.emissiveTexture;
    m.emissiveFactor = [0, 0, 0];
    m.doubleSided = true;
    m.alphaMode = 'OPAQUE';
    delete extras.sfMatcap;
    delete extras.sfMatcapTexName;
    delete extras.sfSparsePatch;
    if (Object.keys(extras).length === 0) delete m.extras;
    else m.extras = extras;
    nSkin++;
  });

  writeGlb(j, bin, outPbr);
  console.log('wrote PBR preview', outPbr, (fs.statSync(outPbr).size / 1e6).toFixed(2) + 'MB', 'skin mats', nSkin);

  // 当前推荐：Rollback（应急已知态）；另存副本避免误开 Ultimate Matcap slim
  if (fs.existsSync(rollback)) {
    fs.copyFileSync(rollback, currentRec);
    console.log('CURRENT_推荐打开 <- Rollback', currentRec);
  } else {
    console.warn('Rollback missing, skip CURRENT copy');
  }
}

main();
