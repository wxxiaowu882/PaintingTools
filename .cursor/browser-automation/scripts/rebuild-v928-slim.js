/**
 * Offline rebuild: re-synthesize albedo (v9.9.28 rules) into slim GLB for self-test.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const runDir = path.resolve(__dirname, '..', 'runs', '20260821-headscan-v926');
const fullGlb = 'E:/模型/0820模型下载/3D Head scan shader testing_V9.9.26_eyeFix.glb';
const slimOut = path.join(runDir, '_v928_slim.glb');

function readGlb(p) {
  const buf = fs.readFileSync(p);
  const jsonLen = buf.readUInt32LE(12);
  const j = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
  const binHdr = 20 + jsonLen;
  const binLen = buf.readUInt32LE(binHdr);
  const bin = buf.slice(binHdr + 8, binHdr + 8 + binLen);
  return { buf, j, bin, jsonLen };
}

function getImg(bin, j, nameRe) {
  const i = j.images.findIndex((im) => nameRe.test(im.name || ''));
  if (i < 0) throw new Error('missing image ' + nameRe);
  const bv = j.bufferViews[j.images[i].bufferView];
  return {
    idx: i,
    name: j.images[i].name,
    mime: j.images[i].mimeType || 'image/jpeg',
    data: bin.slice(bv.byteOffset, bv.byteOffset + bv.byteLength)
  };
}

async function synthInBrowser(specPath, colourPath, matcapPath, outJpg) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  const specB64 = fs.readFileSync(specPath).toString('base64');
  const colB64 = fs.readFileSync(colourPath).toString('base64');
  const matB64 = fs.readFileSync(matcapPath).toString('base64');
  const resultB64 = await page.evaluate(
    async ({ specB64, colB64, matB64 }) => {
      function b64ToBlob(b64, mime) {
        const bin = atob(b64);
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        return new Blob([u8], { type: mime });
      }
      async function loadBlobToImageData(blob, maxSide) {
        const img = await createImageBitmap(blob);
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, w, h);
        const id = ctx.getImageData(0, 0, w, h);
        return { data: id.data, w, h };
      }
      const colourBlob = b64ToBlob(colB64, 'image/jpeg');
      const matcapBlob = b64ToBlob(matB64, 'image/png');
      const specBlob = b64ToBlob(specB64, 'image/jpeg');
      let cr = 208,
        cg = 165,
        cb = 142;
      try {
        const small = await loadBlobToImageData(colourBlob, 48);
        let n0 = 0,
          r0 = 0,
          g0 = 0,
          b0 = 0,
          chromaAcc = 0;
        for (let i = 0; i < small.data.length; i += 4) {
          r0 += small.data[i];
          g0 += small.data[i + 1];
          b0 += small.data[i + 2];
          n0++;
          const m = (small.data[i] + small.data[i + 1] + small.data[i + 2]) / 3;
          chromaAcc += Math.abs(small.data[i] - m) + Math.abs(small.data[i + 1] - m) + Math.abs(small.data[i + 2] - m);
        }
        if (n0) {
          cr = r0 / n0;
          cg = g0 / n0;
          cb = b0 / n0;
          if (chromaAcc / n0 < 18) {
            cr = 214;
            cg = 168;
            cb = 142;
          } else {
            const y = 0.299 * cr + 0.587 * cg + 0.114 * cb;
            cr = Math.min(255, y + (cr - y) * 1.2 + 5);
            cg = Math.min(255, y + (cg - y) * 1.12 + 2);
            cb = Math.min(255, y + (cb - y) * 1.05);
          }
        }
      } catch (_e) {}
      try {
        const mid = await loadBlobToImageData(matcapBlob, 96);
        const md = mid.data,
          mw = mid.w,
          mh = mid.h,
          cx = (mw - 1) * 0.5,
          cy = (mh - 1) * 0.5,
          R = Math.min(cx, cy);
        let r = 0,
          g = 0,
          b = 0,
          n = 0;
        for (let y = 0; y < mh; y += 2)
          for (let x = 0; x < mw; x += 2) {
            const d = Math.hypot(x - cx, y - cy) / Math.max(1e-3, R);
            if (d < 0.28 || d > 0.62) continue;
            const i = (y * mw + x) * 4;
            r += md[i];
            g += md[i + 1];
            b += md[i + 2];
            n++;
          }
        if (n > 8) {
          cr = cr * 0.75 + (r / n) * 0.25;
          cg = cg * 0.75 + (g / n) * 0.25;
          cb = cb * 0.75 + (b / n) * 0.25;
        }
      } catch (_e) {}
      const img = await createImageBitmap(specBlob);
      const maxSide = 1536;
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, w, h);
      const sharp = ctx.getImageData(0, 0, w, h);
      const shd = sharp.data;
      ctx.clearRect(0, 0, w, h);
      ctx.filter = 'blur(12px)';
      ctx.drawImage(img, 0, 0, w, h);
      ctx.filter = 'none';
      const soft = ctx.getImageData(0, 0, w, h);
      const sd = soft.data;
      const ys = [];
      for (let i = 0; i < sd.length; i += 4) {
        const y = 0.299 * sd[i] + 0.587 * sd[i + 1] + 0.114 * sd[i + 2];
        const ys0 = 0.299 * shd[i] + 0.587 * shd[i + 1] + 0.114 * shd[i + 2];
        if (ys0 > 4) ys.push(y);
      }
      ys.sort((a, b) => a - b);
      const p8 = ys[Math.floor(ys.length * 0.08)] || 8;
      const p92 = ys[Math.floor(ys.length * 0.92)] || 55;
      const out = ctx.createImageData(w, h);
      for (let i = 0; i < sd.length; i += 4) {
        const ySharp = 0.299 * shd[i] + 0.587 * shd[i + 1] + 0.114 * shd[i + 2];
        const y = 0.299 * sd[i] + 0.587 * sd[i + 1] + 0.114 * sd[i + 2];
        // UV 外：近黑不透明（不做 alpha 打洞）
        if (ySharp <= 1.2) {
          out.data[i] = 16;
          out.data[i + 1] = 12;
          out.data[i + 2] = 10;
          out.data[i + 3] = 255;
          continue;
        }
        // Spec 暗腔：全图分位压暗（非五官坐标）
        if (y < p8) {
          const k = Math.max(0.18, y / Math.max(6, p8));
          out.data[i] = Math.min(255, 22 + cr * k * 0.48);
          out.data[i + 1] = Math.min(255, 16 + cg * k * 0.42);
          out.data[i + 2] = Math.min(255, 12 + cb * k * 0.36);
          out.data[i + 3] = 255;
          continue;
        }
        let t = (y - p8) / Math.max(1e-3, p92 - p8);
        t = Math.max(0, Math.min(1, t));
        t = t * t * (3 - 2 * t);
        const lum = 0.86 + 0.14 * t;
        out.data[i] = Math.min(255, cr * lum);
        out.data[i + 1] = Math.min(255, cg * lum);
        out.data[i + 2] = Math.min(255, cb * lum);
        out.data[i + 3] = 255;
      }
      ctx.putImageData(out, 0, 0);
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.92));
      const ab = await blob.arrayBuffer();
      const u8 = new Uint8Array(ab);
      let s = '';
      for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
      return btoa(s);
    },
    { specB64, colB64, matB64 }
  );
  fs.writeFileSync(outJpg, Buffer.from(resultB64, 'base64'));
  await browser.close();
}

function buildSlim(j, oldBin, albedoBuf, matcapBuf, normalBuf, eyeMatcapBuf) {
  // keep geometry BVs + pack new images
  const usedBV = new Set();
  const markAcc = (ai) => {
    if (ai === undefined || ai === null) return;
    const a = j.accessors[ai];
    if (!a) return;
    if (a.bufferView !== undefined) usedBV.add(a.bufferView);
  };
  j.meshes.forEach((m) =>
    m.primitives.forEach((p) => {
      Object.values(p.attributes || {}).forEach(markAcc);
      if (p.indices !== undefined) markAcc(p.indices);
    })
  );
  const sorted = [...usedBV].sort((a, b) => a - b);
  const newBV = [];
  const chunks = [];
  let off = 0;
  const bvMap = {};
  for (const oldI of sorted) {
    const bv = j.bufferViews[oldI];
    const data = oldBin.slice(bv.byteOffset, bv.byteOffset + bv.byteLength);
    const pad = (4 - (data.length % 4)) % 4;
    const padded = Buffer.concat([data, Buffer.alloc(pad)]);
    bvMap[oldI] = newBV.length;
    newBV.push({
      buffer: 0,
      byteOffset: off,
      byteLength: bv.byteLength,
      ...(bv.target !== undefined ? { target: bv.target } : {}),
      ...(bv.byteStride !== undefined ? { byteStride: bv.byteStride } : {})
    });
    chunks.push(padded);
    off += padded.length;
  }
  const packImg = (name, mime, data) => {
    const pad = (4 - (data.length % 4)) % 4;
    const padded = Buffer.concat([data, Buffer.alloc(pad)]);
    const bvIdx = newBV.length;
    newBV.push({ buffer: 0, byteOffset: off, byteLength: data.length });
    chunks.push(padded);
    off += padded.length;
    return { name, mimeType: mime, bufferView: bvIdx };
  };
  const newImgs = [
    packImg('synth_albedo_v928.jpg', 'image/jpeg', albedoBuf),
    packImg('skin_soft.png', 'image/png', matcapBuf),
    packImg('Normal_1k.jpg', 'image/jpeg', normalBuf),
    packImg('metal.png', 'image/png', eyeMatcapBuf)
  ];
  const newBin = Buffer.concat(chunks);
  const newAcc = j.accessors.map((a) => {
    const na = { ...a };
    if (na.bufferView !== undefined) na.bufferView = bvMap[na.bufferView];
    return na;
  });
  const newTexs = [{ source: 0 }, { source: 1 }, { source: 2 }, { source: 3 }];
  const mats = j.materials.map((m) => {
    const nm = JSON.parse(JSON.stringify(m));
    const pbr = nm.pbrMetallicRoughness || {};
    if (nm.extras && nm.extras.sfMatcap) {
      pbr.baseColorTexture = { index: 0 };
      nm.emissiveTexture = { index: 1 };
      nm.emissiveFactor = [0, 0, 0];
      nm.extras.sfMatcapTexName = 'skin_soft.png';
      if (pbr.baseColorFactor) pbr.baseColorFactor = [1, 1, 1, 1];
      nm.alphaMode = 'OPAQUE';
      delete nm.alphaCutoff;
      nm.normalTexture = { index: 2, scale: 1.0 };
    }
    if (nm.extras && nm.extras.sfEyeball) {
      delete pbr.baseColorTexture;
      delete nm.normalTexture;
      pbr.baseColorFactor = [0.22, 0.2, 0.19, 1];
      pbr.metallicFactor = 0;
      pbr.roughnessFactor = 0.16;
      nm.emissiveTexture = { index: 3 };
      nm.emissiveFactor = [0, 0, 0];
      nm.extras.sfEyeballMatcap = true;
      nm.extras.sfEyeballMatcapTexName = 'metal.png';
    }
    if (pbr.metallicRoughnessTexture) delete pbr.metallicRoughnessTexture;
    if (nm.occlusionTexture) delete nm.occlusionTexture;
    return nm;
  });
  const outJ = {
    asset: j.asset,
    scene: j.scene,
    scenes: j.scenes,
    nodes: j.nodes,
    meshes: j.meshes,
    materials: mats,
    accessors: newAcc,
    bufferViews: newBV,
    buffers: [{ byteLength: newBin.length }],
    images: newImgs,
    textures: newTexs
  };
  if (j.samplers) outJ.samplers = j.samplers;
  let jsonStr = JSON.stringify(outJ);
  jsonStr += ' '.repeat((4 - (jsonStr.length % 4)) % 4);
  const jsonU8 = Buffer.from(jsonStr, 'utf8');
  const total = 12 + 8 + jsonU8.length + 8 + newBin.length;
  const out = Buffer.alloc(total);
  out.write('glTF', 0);
  out.writeUInt32LE(2, 4);
  out.writeUInt32LE(total, 8);
  out.writeUInt32LE(jsonU8.length, 12);
  out.writeUInt32LE(0x4e4f534a, 16);
  jsonU8.copy(out, 20);
  const binOff = 20 + jsonU8.length;
  out.writeUInt32LE(newBin.length, binOff);
  out.writeUInt32LE(0x004e4942, binOff + 4);
  newBin.copy(out, binOff + 8);
  return out;
}

async function main() {
  const { j, bin } = readGlb(fullGlb);
  const spec = getImg(bin, j, /^Spec\.jpg$/i);
  const colour = getImg(bin, j, /^Colour/i);
  const matcap = getImg(bin, j, /skin_soft/i);
  const specP = path.join(runDir, '_spec_src.jpg');
  const colP = path.join(runDir, '_colour_src.jpg');
  const matP = path.join(runDir, 'matcap.png');
  fs.writeFileSync(specP, spec.data);
  fs.writeFileSync(colP, colour.data);
  if (!fs.existsSync(matP)) fs.writeFileSync(matP, matcap.data);
  const albedoP = path.join(runDir, 'albedo_v928.jpg');
  console.log('synth albedo…');
  await synthInBrowser(specP, colP, matP, albedoP);
  console.log('albedo bytes', fs.statSync(albedoP).size);
  const slim = buildSlim(
    j,
    bin,
    fs.readFileSync(albedoP),
    fs.readFileSync(matP),
    fs.readFileSync(path.join(runDir, 'normal_1k.jpg')),
    fs.readFileSync(path.join(runDir, '_matcap_metal.png'))
  );
  fs.writeFileSync(slimOut, slim);
  console.log('wrote', slimOut, (slim.length / 1e6).toFixed(2) + 'MB');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
