/**
 * Quick rebuild textures then call patch-v930 for slim GLB.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { spawnSync } = require('child_process');

const runDir = path.resolve(__dirname, '..', 'runs', '20260821-headscan-v926');
const full = 'E:/模型/0820模型下载/3D Head scan shader testing_V9.9.26_eyeFix.glb';

function readGlb(p) {
  const buf = fs.readFileSync(p);
  const jsonLen = buf.readUInt32LE(12);
  const j = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
  const binHdr = 20 + jsonLen;
  const bin = buf.slice(binHdr + 8, binHdr + 8 + buf.readUInt32LE(binHdr));
  return { j, bin };
}
function getImg(bin, j, re) {
  const i = j.images.findIndex((im) => re.test(im.name || ''));
  const bv = j.bufferViews[j.images[i].bufferView];
  return bin.slice(bv.byteOffset, bv.byteOffset + bv.byteLength);
}

async function main() {
  const { j, bin } = readGlb(full);
  const specP = path.join(runDir, '_spec_src.jpg');
  const colP = path.join(runDir, '_colour_src.jpg');
  const matP = path.join(runDir, 'matcap.png');
  if (!fs.existsSync(specP) || fs.statSync(specP).size < 1000) fs.writeFileSync(specP, getImg(bin, j, /^Spec\.jpg$/i));
  if (!fs.existsSync(colP) || fs.statSync(colP).size < 1000) fs.writeFileSync(colP, getImg(bin, j, /^Colour/i));
  if (!fs.existsSync(matP)) fs.writeFileSync(matP, getImg(bin, j, /skin_soft/i));

  // Update patch script iris thresholds via running patch after syncing iris code in patch file —
  // simplest: run patch-v930 which already has build; first overwrite its iris synth by calling a local evaluate then patch.
  // Prefer: invoke patch-v930 after we update the iris block in that file.
  const r = spawnSync(process.execPath, [path.join(__dirname, 'patch-v930-iris-albedo.js')], {
    cwd: path.resolve(__dirname, '..'),
    stdio: 'inherit',
    env: process.env
  });
  if (r.status !== 0) process.exit(r.status || 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
