/**
 * Offline Matcap slim（头扫）——2026-08-23 起【全面停用】。
 * 路线已改为：Rollback + PBR 预览（见 make-headscan-pbr-preview.js）。
 * 若必须重跑旧 Matcap 流水线：FORCE_MATCAP_OFFLINE=1 node scripts/patch-v930-iris-albedo.js
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

if (process.env.FORCE_MATCAP_OFFLINE !== '1') {
  console.error([
    '[STOPPED] 头扫 Matcap 离线重建已停用（B 路线：Rollback + PBR）。',
    '请打开：E:/模型/0820模型下载/3D Head scan shader testing_CURRENT_推荐打开.glb',
    '或 PBR：E:/模型/0820模型下载/3D Head scan shader testing_PBR_Preview.glb',
    '管理器勾选「强制 PBR 预览」后，摄影棚/曝光按钮会对 model-viewer 生效。',
    '若确需旧脚本：FORCE_MATCAP_OFFLINE=1 node scripts/patch-v930-iris-albedo.js'
  ].join('\n'));
  process.exit(2);
}

const runDir = path.resolve(__dirname, '..', 'runs', '20260821-headscan-v926');
const fullGlb = 'E:/模型/0820模型下载/3D Head scan shader testing_V9.9.26_eyeFix.glb';
const slimOut = process.env.SLIM_OUT || path.join(runDir, '_v1016_slim.glb');
const ultimateOut = process.env.SKIP_ULTIMATE
  ? null
  : 'E:/模型/0820模型下载/3D Head scan shader testing_V9.10.16_Ultimate.glb';

function readGlb(p) {
  const buf = fs.readFileSync(p);
  const jsonLen = buf.readUInt32LE(12);
  const j = JSON.parse(buf.slice(20, 20 + jsonLen).toString('utf8'));
  const binHdr = 20 + jsonLen;
  const binLen = buf.readUInt32LE(binHdr);
  const bin = buf.slice(binHdr + 8, binHdr + 8 + binLen);
  return { j, bin };
}

function getImg(bin, j, nameRe) {
  const i = j.images.findIndex((im) => nameRe.test(im.name || ''));
  if (i < 0) throw new Error('missing ' + nameRe);
  const bv = j.bufferViews[j.images[i].bufferView];
  return bin.slice(bv.byteOffset, bv.byteOffset + bv.byteLength);
}

function readF32Acc(j, bin, accIdx, nc) {
  const acc = j.accessors[accIdx];
  const bv = j.bufferViews[acc.bufferView];
  const off = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  return new Float32Array(bin.buffer, bin.byteOffset + off, acc.count * nc);
}

function readIndexAcc(j, bin, accIdx) {
  const acc = j.accessors[accIdx];
  const bv = j.bufferViews[acc.bufferView];
  const off = (bv.byteOffset || 0) + (acc.byteOffset || 0);
  if (acc.componentType === 5123) {
    return { acc, arr: new Uint16Array(bin.buffer, bin.byteOffset + off, acc.count) };
  }
  if (acc.componentType === 5125) {
    return { acc, arr: new Uint32Array(bin.buffer, bin.byteOffset + off, acc.count) };
  }
  throw new Error('bad index componentType ' + acc.componentType);
}

/** 通用：扫描网格仅按顶点法线翻转绕序错误三角（不用质心，非凸扫描会误翻） */
function fixSfMatcapWinding(full) {
  const { j } = full;
  full.bin = Buffer.from(full.bin);
  const bin = full.bin;
  let flipped = 0, culledDeg = 0;
  j.meshes.forEach((m) => m.primitives.forEach((p) => {
    const mat = j.materials[p.material];
    if (!(mat && mat.extras && mat.extras.sfMatcap)) return;
    if (p.indices == null || p.attributes.POSITION == null || p.attributes.NORMAL == null) return;
    const pos = readF32Acc(j, bin, p.attributes.POSITION, 3);
    const nrm = readF32Acc(j, bin, p.attributes.NORMAL, 3);
    const { acc, arr: idx } = readIndexAcc(j, bin, p.indices);
    const out = [];
    let primFlipped = 0;
    const nTri = Math.floor(idx.length / 3);
    for (let t = 0; t < nTri; t++) {
      let i0 = idx[t * 3], i1 = idx[t * 3 + 1], i2 = idx[t * 3 + 2];
      const ax = pos[i1 * 3] - pos[i0 * 3], ay = pos[i1 * 3 + 1] - pos[i0 * 3 + 1], az = pos[i1 * 3 + 2] - pos[i0 * 3 + 2];
      const bx = pos[i2 * 3] - pos[i0 * 3], by = pos[i2 * 3 + 1] - pos[i0 * 3 + 1], bz = pos[i2 * 3 + 2] - pos[i0 * 3 + 2];
      const fnx = ay * bz - az * by, fny = az * bx - ax * bz, fnz = ax * by - ay * bx;
      const fnl = Math.hypot(fnx, fny, fnz);
      // 退化三角只统计、不剔除：删掉会在扫描网格上撕出大量三角洞（碎屑根因之一）
      if (fnl < 1e-12) { culledDeg++; out.push(i0, i1, i2); continue; }
      let vnx = nrm[i0 * 3] + nrm[i1 * 3] + nrm[i2 * 3];
      let vny = nrm[i0 * 3 + 1] + nrm[i1 * 3 + 1] + nrm[i2 * 3 + 1];
      let vnz = nrm[i0 * 3 + 2] + nrm[i1 * 3 + 2] + nrm[i2 * 3 + 2];
      const vnl = Math.hypot(vnx, vny, vnz);
      if (vnl > 1e-8) {
        vnx /= vnl; vny /= vnl; vnz /= vnl;
        const dot = (fnx * vnx + fny * vny + fnz * vnz) / fnl;
        if (dot < 0) { const tmp = i1; i1 = i2; i2 = tmp; flipped++; primFlipped++; }
      }
      out.push(i0, i1, i2);
    }
    if (primFlipped === 0) return;
    const Typed = idx.constructor;
    const next = new Typed(out);
    const byteBuf = Buffer.from(next.buffer, next.byteOffset, next.byteLength);
    const bv = j.bufferViews[acc.bufferView];
    const dstOff = (bv.byteOffset || 0) + (acc.byteOffset || 0);
    byteBuf.copy(bin, dstOff);
    acc.count = next.length;
    if (byteBuf.length < bv.byteLength) bv.byteLength = byteBuf.length;
  }));
  console.log('fixSfMatcapWinding flipped tris~', flipped, 'degenerate kept~', culledDeg);
}


async function softenNormalJpeg(buf, outPath) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  const b64 = buf.toString('base64');
  const outB64 = await page.evaluate(async (b64) => {
    const bin = atob(b64); const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([u8], { type: 'image/jpeg' }));
    const maxSide = 1024;
    const sc = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * sc));
    const h = Math.max(1, Math.round(bmp.height * sc));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.filter = 'blur(2.0px)';
    x.drawImage(bmp, 0, 0, w, h);
    x.filter = 'none';
    // pull toward flat normal (128,128,255) to cut branch ridges / Matcap 凹腔脏斑
    const id = x.getImageData(0, 0, w, h);
    const d = id.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = Math.round(d[i] * 0.15 + 128 * 0.85);
      d[i + 1] = Math.round(d[i + 1] * 0.15 + 128 * 0.85);
      d[i + 2] = Math.round(d[i + 2] * 0.2 + 255 * 0.8);
      d[i + 3] = 255;
    }
    x.putImageData(id, 0, 0);
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.9));
    const ab = await blob.arrayBuffer();
    const u = new Uint8Array(ab);
    let s = '';
    for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
    return btoa(s);
  }, b64);
  await browser.close();
  const out = Buffer.from(outB64, 'base64');
  require('fs').writeFileSync(outPath, out);
  return out;
}

async function synthInBrowser(specPath, colourPath, matcapPath, outAlbedo, outIris) {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  const specB64 = fs.readFileSync(specPath).toString('base64');
  const colB64 = fs.readFileSync(colourPath).toString('base64');
  const matB64 = fs.readFileSync(matcapPath).toString('base64');
  const result = await page.evaluate(
    async ({ specB64, colB64, matB64 }) => {
      function b64ToBlob(b64, mime) {
        const bin = atob(b64);
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        return new Blob([u8], { type: mime });
      }
      async function blobToB64(blob) {
        const ab = await blob.arrayBuffer();
        const u8 = new Uint8Array(ab);
        let s = '';
        for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
        return btoa(s);
      }
      const colourBlob = b64ToBlob(colB64, 'image/jpeg');
      const matcapBlob = b64ToBlob(matB64, 'image/png');
      const specBlob = b64ToBlob(specB64, 'image/jpeg');

      let cr = 208, cg = 165, cb = 142;
      let colourSoftData = null, colourSharpData = null, colourSoftW = 0, colourSoftH = 0;
      try {
        const imgC = await createImageBitmap(colourBlob);
        const cMax = 768;
        const csc = Math.min(1, cMax / Math.max(imgC.width, imgC.height));
        colourSoftW = Math.max(1, Math.round(imgC.width * csc));
        colourSoftH = Math.max(1, Math.round(imgC.height * csc));
        const ccan = document.createElement('canvas');
        ccan.width = colourSoftW;
        ccan.height = colourSoftH;
        const cctx = ccan.getContext('2d', { willReadFrequently: true });
        cctx.filter = 'blur(28px)';
        cctx.drawImage(imgC, 0, 0, colourSoftW, colourSoftH);
        cctx.filter = 'none';
        colourSoftData = cctx.getImageData(0, 0, colourSoftW, colourSoftH).data;
        cctx.clearRect(0, 0, colourSoftW, colourSoftH);
        cctx.filter = 'blur(3px)';
        cctx.drawImage(imgC, 0, 0, colourSoftW, colourSoftH);
        cctx.filter = 'none';
        colourSharpData = cctx.getImageData(0, 0, colourSoftW, colourSoftH).data;
        let n0 = 0, r0 = 0, g0 = 0, b0 = 0, chromaAcc = 0;
        for (let i = 0; i < colourSoftData.length; i += 16) {
          r0 += colourSoftData[i];
          g0 += colourSoftData[i + 1];
          b0 += colourSoftData[i + 2];
          n0++;
          const m = (colourSoftData[i] + colourSoftData[i + 1] + colourSoftData[i + 2]) / 3;
          chromaAcc += Math.abs(colourSoftData[i] - m) + Math.abs(colourSoftData[i + 1] - m) + Math.abs(colourSoftData[i + 2] - m);
        }
        if (n0) {
          cr = r0 / n0;
          cg = g0 / n0;
          cb = b0 / n0;
          if (chromaAcc / n0 < 12) {
            cr = 214;
            cg = 168;
            cb = 142;
            colourSoftData = null; colourSharpData = null;
          }
        }
      } catch (_e) {}
      try {
        const imgM = await createImageBitmap(matcapBlob);
        const c = document.createElement('canvas');
        c.width = 96;
        c.height = 96;
        const x = c.getContext('2d');
        x.drawImage(imgM, 0, 0, 96, 96);
        const md = x.getImageData(0, 0, 96, 96).data;
        const cx = 47.5, cy = 47.5, R = 47.5;
        let r = 0, g = 0, b = 0, n = 0;
        for (let y = 0; y < 96; y += 2)
          for (let xx = 0; xx < 96; xx += 2) {
            const d = Math.hypot(xx - cx, y - cy) / R;
            if (d < 0.28 || d > 0.62) continue;
            const i = (y * 96 + xx) * 4;
            r += md[i];
            g += md[i + 1];
            b += md[i + 2];
            n++;
          }
        if (n > 8) {
          cr = cr * 0.82 + (r / n) * 0.18;
          cg = cg * 0.82 + (g / n) * 0.18;
          cb = cb * 0.82 + (b / n) * 0.18;
        }
      } catch (_e) {}

      const img = await createImageBitmap(specBlob);
      const maxSide = 2048;
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, w, h);
      const shd = ctx.getImageData(0, 0, w, h).data;
      ctx.clearRect(0, 0, w, h);
      ctx.filter = 'blur(18px)';
      ctx.drawImage(img, 0, 0, w, h);
      ctx.filter = 'none';
      const sd = ctx.getImageData(0, 0, w, h).data;
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
        const px = (i / 4) % w,
          py = Math.floor(i / 4 / w);
        let pr = cr,
          pg = cg,
          pb = cb;
        // v9.9.55: always weak soft Colour tint (general); hair only in soft-dark
        if (colourSoftData && colourSoftW > 0) {
          const cx0 = Math.min(colourSoftW - 1, Math.max(0, Math.round((px / w) * (colourSoftW - 1))));
          const cy0 = Math.min(colourSoftH - 1, Math.max(0, Math.round((py / h) * (colourSoftH - 1))));
          const ci0 = (cy0 * colourSoftW + cx0) * 4;
          pr = cr * 0.82 + colourSoftData[ci0] * 0.18;
          pg = cg * 0.82 + colourSoftData[ci0 + 1] * 0.18;
          pb = cb * 0.82 + colourSoftData[ci0 + 2] * 0.18;
        }
        // v9.9.71: 取消 Colour 软暗铺毛发（易在无关 UV 岛留脏斑；眉睫改由几何近眼喷涂）
        // 仅保留上方弱染色
                if (ySharp <= 0.35) {
          // gutter：近黑贴图外，给中性肤色
          out.data[i] = Math.min(255, 120 + pr * 0.25);
          out.data[i + 1] = Math.min(255, 108 + pg * 0.22);
          out.data[i + 2] = Math.min(255, 100 + pb * 0.20);
          out.data[i + 3] = 255;
          continue;
        }
        // v9.9.37：Spec 只做轻微提亮，不再按暗腔压暗（粗杈主因）
        let tt = (y - p8) / Math.max(1e-3, p92 - p8);
        tt = Math.max(0, Math.min(1, tt));
        tt = tt * tt * (3 - 2 * tt);
        const lum = 0.98 + 0.16 * tt;
        out.data[i] = Math.min(255, pr * lum);
        out.data[i + 1] = Math.min(255, pg * lum);
        out.data[i + 2] = Math.min(255, pb * lum);
        out.data[i + 3] = 255;
      }
      ctx.putImageData(out, 0, 0);
      const albBlob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.92));

      // iris: larger pupil + muted iris + baked catchlight
      const size = 512;
      const ic = document.createElement('canvas');
      ic.width = size;
      ic.height = size;
      const ix = ic.getContext('2d', { willReadFrequently: true });
      const id = ix.createImageData(size, size);
      // 瞳孔中心略上移：开孔里不至于只露出下半虹膜
      const icx = (size - 1) * 0.5, icy = (size - 1) * 0.5, R = size * 0.48;
      // 开孔里多半是虹膜，巩膜只留薄边；盘外必须是眼窝暗色（钳 UV 时灰环的根因）
      const ir = 0.22 * 255, ig = 0.28 * 255, ib = 0.34 * 255;
      const hx = -0.22, hy = -0.24, hr = 0.040;
      for (let y = 0; y < size; y++)
        for (let x = 0; x < size; x++) {
          const dx = (x - icx) / R, dy = (y - icy) / R;
          const d = Math.hypot(dx, dy);
          const i = (y * size + x) * 4;
          const ang = Math.atan2(dy, dx);
          const fiber = 0.82 + 0.18 * Math.sin(ang * 18 + d * 8) * Math.sin(ang * 5);
          let r = 36, g = 26, b = 22;
          if (d > 0.96) {
            r = 38; g = 27; b = 23;
          } else if (d < 0.30) {
            const k = d / 0.30;
            r = 2 + 6 * k; g = 2 + 5 * k; b = 2 + 5 * k;
          } else if (d < 0.78) {
            const tt = (d - 0.30) / 0.48;
            const limbus = tt > 0.82 ? (1 - (tt - 0.82) / 0.18) * 0.45 + 0.55 : 1;
            const shade = (0.82 + 0.24 * fiber) * limbus * (0.90 + 0.16 * (1 - tt));
            r = Math.min(255, ir * shade);
            g = Math.min(255, ig * shade);
            b = Math.min(255, ib * shade * 1.04);
          } else {
            const t = Math.min(1, (d - 0.78) / 0.18);
            const vein = 0.98 + 0.02 * Math.sin(ang * 8 + d * 20);
            // 巩膜压暗：Matcap+Lambert 下白环突兀
            const sr = 58 * vein, sg = 54 * vein, sb = 50 * vein;
            r = sr * (1 - t) + 34 * t;
            g = sg * (1 - t) + 24 * t;
            b = sb * (1 - t) + 21 * t;
          }
          const hd = Math.hypot(dx - hx, dy - hy);
          if (hd < hr && d < 0.72) {
            let w = 1 - hd / hr; w = w * w;
            r = Math.min(255, r + (165 - r) * w * 0.28);
            g = Math.min(255, g + (172 - g) * w * 0.28);
            b = Math.min(255, b + (178 - b) * w * 0.28);
          }
          id.data[i] = r; id.data[i + 1] = g; id.data[i + 2] = b; id.data[i + 3] = 255;
        }
      ix.putImageData(id, 0, 0);
      const irisBlob = await new Promise((res) => ic.toBlob(res, 'image/jpeg', 0.92));

      return { albedo: await blobToB64(albBlob), iris: await blobToB64(irisBlob) };
    },
    { specB64, colB64, matB64 }
  );
  fs.writeFileSync(outAlbedo, Buffer.from(result.albedo, 'base64'));
  fs.writeFileSync(outIris, Buffer.from(result.iris, 'base64'));
  await browser.close();
}

function sphericalUVs(pos, nrm) {
  // 通用：近隐无 UV 眼球。朝向取该簇平均法线；软钳 UV 防平铺、盘外贴图眼窝暗色。
  const n = pos.length / 3;
  let c0 = [pos[0], pos[1], pos[2]], c1 = [pos[0], pos[1], pos[2]];
  let maxD = -1;
  for (let i = 0; i < n; i++) {
    const d = Math.hypot(pos[i * 3] - c0[0], pos[i * 3 + 1] - c0[1], pos[i * 3 + 2] - c0[2]);
    if (d > maxD) { maxD = d; c1 = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]; }
  }
  for (let iter = 0; iter < 8; iter++) {
    let s0 = [0, 0, 0], s1 = [0, 0, 0], n0 = 0, n1 = 0;
    for (let i = 0; i < n; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      const d0 = Math.hypot(x - c0[0], y - c0[1], z - c0[2]);
      const d1 = Math.hypot(x - c1[0], y - c1[1], z - c1[2]);
      if (d0 <= d1) { s0[0] += x; s0[1] += y; s0[2] += z; n0++; }
      else { s1[0] += x; s1[1] += y; s1[2] += z; n1++; }
    }
    if (n0) { c0 = [s0[0] / n0, s0[1] / n0, s0[2] / n0]; }
    if (n1) { c1 = [s1[0] / n1, s1[1] / n1, s1[2] / n1]; }
  }
  function fwdOf(c, other) {
    let sx = 0, sy = 0, sz = 0, k = 0;
    for (let i = 0; i < n; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      const d = Math.hypot(x - c[0], y - c[1], z - c[2]);
      const dO = Math.hypot(x - other[0], y - other[1], z - other[2]);
      if (d > dO) continue;
      if (nrm) { sx += nrm[i * 3]; sy += nrm[i * 3 + 1]; sz += nrm[i * 3 + 2]; k++; }
    }
    let fx = sx, fy = sy, fz = sz;
    const fl = Math.hypot(fx, fy, fz);
    if (k < 8 || fl < 1e-6) { fx = 0; fy = 0; fz = 1; }
    else { fx /= fl; fy /= fl; fz /= fl; }
    return [fx, fy, fz];
  }
  function pack(c, other) {
    const fwd = fwdOf(c, other);
    let ux = 0, uy = 1, uz = 0;
    if (Math.abs(fwd[1]) > 0.9) { ux = 1; uy = 0; uz = 0; }
    let rx = uy * fwd[2] - uz * fwd[1], ry = uz * fwd[0] - ux * fwd[2], rz = ux * fwd[1] - uy * fwd[0];
    let rl = Math.hypot(rx, ry, rz) || 1;
    rx /= rl; ry /= rl; rz /= rl;
    ux = fyCross(fwd, [rx, ry, rz])[0];
    uy = fyCross(fwd, [rx, ry, rz])[1];
    uz = fyCross(fwd, [rx, ry, rz])[2];
    const dots = [];
    for (let i = 0; i < n; i++) {
      const x = pos[i * 3] - c[0], y = pos[i * 3 + 1] - c[1], z = pos[i * 3 + 2] - c[2];
      if (Math.hypot(x, y, z) > 0.55) continue;
      dots.push({ i, pr: x * fwd[0] + y * fwd[1] + z * fwd[2] });
    }
    dots.sort((a, b) => b.pr - a.pr);
    const top = dots.slice(0, Math.max(24, Math.floor(dots.length * 0.10)));
    let ox = 0, oy = 0, oz = 0;
    for (const q of top) {
      ox += pos[q.i * 3]; oy += pos[q.i * 3 + 1]; oz += pos[q.i * 3 + 2];
    }
    ox /= top.length; oy /= top.length; oz /= top.length;
    const rs = top.map((q) => {
      const x = pos[q.i * 3] - ox, y = pos[q.i * 3 + 1] - oy, z = pos[q.i * 3 + 2] - oz;
      return Math.hypot(x * rx + y * ry + z * rz, x * ux + y * uy + z * uz);
    }).sort((a, b) => a - b);
    const eyeRad = rs[Math.floor(rs.length * 0.5)] || 0.22;
    // 开孔 ≈ 虹膜盘：过大则 UV 出 [0,1] 平铺；过小则巩膜白环
    const rad = eyeRad * 0.46;
    return { ox, oy, oz, rad, rx, ry, rz, ux, uy, uz, fwd };
  }
  function fyCross(a, b) {
    const x = a[1] * b[2] - a[2] * b[1], y = a[2] * b[0] - a[0] * b[2], z = a[0] * b[1] - a[1] * b[0];
    const L = Math.hypot(x, y, z) || 1;
    return [x / L, y / L, z / L];
  }
  const p0 = pack(c0, c1), p1 = pack(c1, c0);
  const uvs = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    const d0 = Math.hypot(x - c0[0], y - c0[1], z - c0[2]);
    const d1 = Math.hypot(x - c1[0], y - c1[1], z - c1[2]);
    const p = d0 <= d1 ? p0 : p1;
    const dx = x - p.ox, dy = y - p.oy, dz = z - p.oz;
    let ru = (dx * p.rx + dy * p.ry + dz * p.rz) / (2 * p.rad);
    let rv = -(dx * p.ux + dy * p.uy + dz * p.uz) / (2 * p.rad);
    const rd = Math.hypot(ru, rv);
    if (rd > 0.40) { const s = 0.40 / rd; ru *= s; rv *= s; }
    uvs[i * 2] = 0.5 + ru;
    uvs[i * 2 + 1] = 0.5 + rv;
  }
  // 开孔环质心 → (0.5,0.5)，避免虹膜偏到睑缘一角
  function recenterCluster(c, other, fwd) {
    let su = 0, sv = 0, sk = 0;
    for (let i = 0; i < n; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      const d0 = Math.hypot(x - c0[0], y - c0[1], z - c0[2]);
      const d1 = Math.hypot(x - c1[0], y - c1[1], z - c1[2]);
      const inC = (c === c0) ? d0 <= d1 : d1 < d0;
      if (!inC) continue;
      if (nrm) {
        const nd = nrm[i * 3] * fwd[0] + nrm[i * 3 + 1] * fwd[1] + nrm[i * 3 + 2] * fwd[2];
        if (nd < 0.32) continue;
      }
      const u = uvs[i * 2], v = uvs[i * 2 + 1];
      if (Math.hypot(u - 0.5, v - 0.5) > 0.38) continue;
      su += u; sv += v; sk++;
    }
    if (sk < 12) return;
    const du = 0.5 - su / sk, dv = 0.5 - sv / sk;
    for (let i = 0; i < n; i++) {
      const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
      const d0 = Math.hypot(x - c0[0], y - c0[1], z - c0[2]);
      const d1 = Math.hypot(x - c1[0], y - c1[1], z - c1[2]);
      const inC = (c === c0) ? d0 <= d1 : d1 < d0;
      if (!inC) continue;
      uvs[i * 2] += du;
      uvs[i * 2 + 1] += dv;
    }
  }
  recenterCluster(c0, c1, p0.fwd);
  recenterCluster(c1, c0, p1.fwd);
  return Buffer.from(uvs.buffer);
}

function buildSlim(full, albedoBuf, matcapBuf, normalBuf, irisBuf) {
  const { j, bin } = full;
  // 同 POSITION 的小索引片往往是补洞面（与主片无三角重叠），不可丢，否则成碎三角/胸口黑洞
  const usedBV = new Set();
  const markAcc = (ai) => {
    if (ai == null) return;
    const a = j.accessors[ai];
    if (a && a.bufferView !== undefined) usedBV.add(a.bufferView);
  };
  j.meshes.forEach((m) =>
    m.primitives.forEach((p) => {
      Object.values(p.attributes || {}).forEach(markAcc);
      if (p.indices !== undefined) markAcc(p.indices);
    })
  );

  // Generate spherical UVs for eyeball primitives lacking TEXCOORD
  const eyeUVBuffers = []; // { primRef, buf }
  j.meshes.forEach((m) =>
    m.primitives.forEach((p) => {
      const mat = j.materials[p.material];
      if (!(mat && mat.extras && mat.extras.sfEyeball)) return;
      if (p.attributes.TEXCOORD_0 !== undefined) return;
      const posAcc = j.accessors[p.attributes.POSITION];
      const pbv = j.bufferViews[posAcc.bufferView];
      const pos = new Float32Array(
        bin.buffer,
        bin.byteOffset + pbv.byteOffset + (posAcc.byteOffset || 0),
        posAcc.count * 3
      );
      let nrm = null;
      if (p.attributes.NORMAL != null) {
        const nAcc = j.accessors[p.attributes.NORMAL];
        const nbv = j.bufferViews[nAcc.bufferView];
        nrm = new Float32Array(
          bin.buffer,
          bin.byteOffset + nbv.byteOffset + (nAcc.byteOffset || 0),
          nAcc.count * 3
        );
      }
      eyeUVBuffers.push({ p, buf: sphericalUVs(pos, nrm), count: posAcc.count });
    })
  );

  const sorted = [...usedBV].sort((a, b) => a - b);
  const newBV = [];
  const chunks = [];
  let off = 0;
  const bvMap = {};
  for (const oldI of sorted) {
    const bv = j.bufferViews[oldI];
    const data = bin.slice(bv.byteOffset, bv.byteOffset + bv.byteLength);
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

  const uvAccStart = j.accessors.length;
  const uvAccessors = [];
  eyeUVBuffers.forEach((e, i) => {
    const pad = (4 - (e.buf.length % 4)) % 4;
    const padded = Buffer.concat([e.buf, Buffer.alloc(pad)]);
    const bvIdx = newBV.length;
    newBV.push({ buffer: 0, byteOffset: off, byteLength: e.buf.length, target: 34962 });
    chunks.push(padded);
    off += padded.length;
    const accIdx = uvAccStart + i;
    uvAccessors.push({
      bufferView: bvIdx,
      componentType: 5126,
      count: e.count,
      type: 'VEC2'
    });
    e.p.attributes.TEXCOORD_0 = accIdx;
  });

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
    packImg('synth_albedo_v930.jpg', 'image/jpeg', albedoBuf),
    packImg('skin_soft.png', 'image/png', matcapBuf),
    packImg('Normal_1k.jpg', 'image/jpeg', normalBuf),
    packImg('synth_eyeball_iris.jpg', 'image/jpeg', irisBuf)
  ];
  const newBin = Buffer.concat(chunks);
  const newAcc = j.accessors.map((a) => {
    const na = { ...a };
    if (na.bufferView !== undefined) na.bufferView = bvMap[na.bufferView];
    return na;
  });
  uvAccessors.forEach((a) => newAcc.push(a));

  const newTexs = [{ source: 0 }, { source: 1 }, { source: 2 }, { source: 3 }];
  const mats = j.materials.map((m) => {
    const nm = JSON.parse(JSON.stringify(m));
    const pbr = nm.pbrMetallicRoughness || {};
    if (nm.extras && nm.extras.sfMatcap) {
      pbr.baseColorTexture = { index: 0 };
      nm.emissiveTexture = { index: 1 };
      nm.emissiveFactor = [0, 0, 0];
      nm.extras.sfMatcapTexName = 'skin_soft.png';
      pbr.baseColorFactor = [1, 1, 1, 1];
      pbr.metallicFactor = 0;
      pbr.roughnessFactor = 0.85;
      nm.alphaMode = 'OPAQUE';
      // 扫描网格绕序不一致：与 Sketchfab 一致保持 doubleSided，FrontSide 会满脸三角洞
      nm.doubleSided = true;
      delete nm.alphaCutoff;
      // v9.9.45：法线易在柔光下呈树杈粗纹，先不挂 normal
      delete nm.normalTexture;
    }
    if (nm.extras && nm.extras.sfEyeball) {
      delete nm.emissiveTexture;
      delete nm.normalTexture;
      pbr.baseColorFactor = [1, 1, 1, 1];
      pbr.metallicFactor = 0;
      pbr.roughnessFactor = 0.18;
      pbr.baseColorTexture = { index: 3 };
      nm.extras.sfEyeballIris = true;
      nm.doubleSided = false;
    }
    if (pbr.metallicRoughnessTexture) delete pbr.metallicRoughnessTexture;
    if (nm.occlusionTexture) delete nm.occlusionTexture;
    nm.pbrMetallicRoughness = pbr;
    return nm;
  });
  // 小索引补洞片：标记 sfSparsePatch 供管理器 polygonOffset 叠补（几何保留）
  j.meshes.forEach((m) => {
    m.primitives.forEach((p) => {
      const idxCount = p.indices != null ? j.accessors[p.indices].count : 999999;
      if (idxCount >= 5000) return;
      const base = mats[p.material];
      if (!(base.extras && base.extras.sfMatcap)) return;
      const clone = JSON.parse(JSON.stringify(base));
      clone.extras = { ...(clone.extras || {}), sfSparsePatch: true };
      mats.push(clone);
      p.material = mats.length - 1;
    });
  });

  // Remap TEXCOORD indices: they were absolute newAcc indices
  // When we cloned meshes from j, TEXCOORD_0 was set to uvAccStart+i which equals newAcc index after map...
  // Actually original accessors remapped; uv accessors appended with bufferView already new indices.
  // But TEXCOORD_0 = uvAccStart + i, and uvAccStart = j.accessors.length = newAcc.length before push... 
  // After map, newAcc has same length as j.accessors, then we push uvAccessors. So TEXCOORD_0 values are correct.

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

function collectSfEyeFrames(j, bin) {
  function readF32(accIdx) {
    const acc = j.accessors[accIdx];
    const bv = j.bufferViews[acc.bufferView];
    const off = (bv.byteOffset || 0) + (acc.byteOffset || 0);
    const nc = acc.type === 'VEC3' ? 3 : 2;
    return new Float32Array(bin.buffer, bin.byteOffset + off, acc.count * nc);
  }
  const eyeCenters = [];
  j.meshes.forEach((m) => m.primitives.forEach((p) => {
    const mat = j.materials[p.material];
    if (!(mat && mat.extras && mat.extras.sfEyeball)) return;
    const pos = readF32(p.attributes.POSITION);
    const n = pos.length / 3;
    let c0 = [pos[0], pos[1], pos[2]], c1 = [pos[0], pos[1], pos[2]], maxD = -1;
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(pos[i * 3] - c0[0], pos[i * 3 + 1] - c0[1], pos[i * 3 + 2] - c0[2]);
      if (d > maxD) { maxD = d; c1 = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]; }
    }
    for (let it = 0; it < 8; it++) {
      let s0 = [0, 0, 0], s1 = [0, 0, 0], n0 = 0, n1 = 0;
      for (let i = 0; i < n; i++) {
        const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
        const d0 = Math.hypot(x - c0[0], y - c0[1], z - c0[2]);
        const d1 = Math.hypot(x - c1[0], y - c1[1], z - c1[2]);
        if (d0 <= d1) { s0[0] += x; s0[1] += y; s0[2] += z; n0++; }
        else { s1[0] += x; s1[1] += y; s1[2] += z; n1++; }
      }
      if (n0) c0 = [s0[0] / n0, s0[1] / n0, s0[2] / n0];
      if (n1) c1 = [s1[0] / n1, s1[1] / n1, s1[2] / n1];
    }
    const nrmE = p.attributes.NORMAL != null ? readF32(p.attributes.NORMAL) : null;
    function eyeRad(c, other) {
      const ds = [];
      for (let i = 0; i < n; i++) {
        const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
        const d = Math.hypot(x - c[0], y - c[1], z - c[2]);
        const dO = Math.hypot(x - other[0], y - other[1], z - other[2]);
        if (d <= dO) ds.push(d);
      }
      ds.sort((a, b) => a - b);
      return ds[Math.floor(ds.length * 0.85)] || 0.22;
    }
    function fwdOf(c, other) {
      let sx = 0, sy = 0, sz = 0, k = 0;
      if (nrmE) {
        for (let i = 0; i < n; i++) {
          const d = Math.hypot(pos[i * 3] - c[0], pos[i * 3 + 1] - c[1], pos[i * 3 + 2] - c[2]);
          const dO = Math.hypot(pos[i * 3] - other[0], pos[i * 3 + 1] - other[1], pos[i * 3 + 2] - other[2]);
          if (d > dO) continue;
          sx += nrmE[i * 3]; sy += nrmE[i * 3 + 1]; sz += nrmE[i * 3 + 2]; k++;
        }
      }
      const L = Math.hypot(sx, sy, sz);
      if (k < 8 || L < 1e-6) return [0, 0, 1];
      return [sx / L, sy / L, sz / L];
    }
    eyeCenters.push({ c: c0, r: eyeRad(c0, c1), fwd: fwdOf(c0, c1) });
    eyeCenters.push({ c: c1, r: eyeRad(c1, c0), fwd: fwdOf(c1, c0) });
  }));
  const eyes = [];
  for (const e of eyeCenters) {
    if (eyes.some((o) => Math.hypot(o.c[0] - e.c[0], o.c[1] - e.c[1], o.c[2] - e.c[2]) < 0.12)) continue;
    eyes.push(e);
  }
  return eyes;
}

async function lightenForwardTorso(full, albedoBuf) {
  // 通用：前向胸口凹区 UV → 抬暗像素下限（Matcap 凹腔不再采成墨斑）
  const { j, bin } = full;
  const eyes = collectSfEyeFrames(j, bin);
  if (!eyes.length) return albedoBuf;
  function readF32(accIdx) {
    const acc = j.accessors[accIdx];
    const bv = j.bufferViews[acc.bufferView];
    const off = (bv.byteOffset || 0) + (acc.byteOffset || 0);
    const nc = acc.type === 'VEC3' ? 3 : 2;
    return new Float32Array(bin.buffer, bin.byteOffset + off, acc.count * nc);
  }
  let avgFwd = [0, 0, 0], eyeY = 0, midX = 0;
  eyes.forEach((e) => {
    avgFwd[0] += e.fwd[0]; avgFwd[1] += e.fwd[1]; avgFwd[2] += e.fwd[2];
    eyeY += e.c[1]; midX += e.c[0];
  });
  avgFwd[0] /= eyes.length; avgFwd[1] /= eyes.length; avgFwd[2] /= eyes.length;
  const fl = Math.hypot(avgFwd[0], avgFwd[1], avgFwd[2]) || 1;
  avgFwd = [avgFwd[0] / fl, avgFwd[1] / fl, avgFwd[2] / fl];
  eyeY /= eyes.length;
  midX /= eyes.length;

  let skinPrim = null;
  j.meshes.forEach((m) => m.primitives.forEach((p) => {
    const mat = j.materials[p.material];
    if (!(mat && mat.extras && mat.extras.sfMatcap)) return;
    const idxCount = p.indices != null ? j.accessors[p.indices].count : 0;
    if (idxCount < 5000) return;
    if (p.attributes.TEXCOORD_0 == null || p.attributes.POSITION == null) return;
    if (!skinPrim || idxCount > skinPrim.idxCount) skinPrim = { p, idxCount };
  }));
  if (!skinPrim) return albedoBuf;
  const pos = readF32(skinPrim.p.attributes.POSITION);
  const uv = readF32(skinPrim.p.attributes.TEXCOORD_0);
  const nrm = skinPrim.p.attributes.NORMAL != null ? readF32(skinPrim.p.attributes.NORMAL) : null;
  const n = pos.length / 3;
  let minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const y = pos[i * 3 + 1];
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const headH = Math.max(0.15, maxY - minY);
  const chestPts = [];
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    if (y > eyeY - headH * 0.06) continue;
    if (y < eyeY - headH * 0.40) continue;
    if (Math.abs(x - midX) > headH * 0.24) continue;
    let nearEye = false;
    for (const e of eyes) {
      if (Math.hypot(x - e.c[0], y - e.c[1], z - e.c[2]) < e.r * 2.6) nearEye = true;
    }
    if (nearEye) continue;
    if (nrm) {
      const nd = nrm[i * 3] * avgFwd[0] + nrm[i * 3 + 1] * avgFwd[1] + nrm[i * 3 + 2] * avgFwd[2];
      if (nd < 0.18) continue;
    }
    chestPts.push({ u: uv[i * 2], v: uv[i * 2 + 1] });
  }
  if (chestPts.length < 12) return albedoBuf;
  const cells = new Map();
  for (const p of chestPts) {
    const key = Math.floor(p.u / 0.014) + ',' + Math.floor(p.v / 0.012);
    if (!cells.has(key)) cells.set(key, p);
  }
  let liftPts = [...cells.values()];
  if (liftPts.length > 96) {
    const step = Math.ceil(liftPts.length / 96);
    liftPts = liftPts.filter((_, i) => i % step === 0);
  }
  console.log('chest liftPts', liftPts.length);

  const { chromium } = require('playwright');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  const b64 = albedoBuf.toString('base64');
  const outB64 = await page.evaluate(async ({ b64, liftPts }) => {
    const bin = atob(b64); const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([u8], { type: 'image/jpeg' }));
    const w = bmp.width, h = bmp.height;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.drawImage(bmp, 0, 0);
    const id = x.getImageData(0, 0, w, h);
    const px = id.data;
    const side = Math.max(w, h);
    function liftAt(u, v, rx, ry, floorL) {
      const cx = u * w, cy = (1 - v) * h;
      const x0 = Math.max(0, Math.floor(cx - rx)), x1 = Math.min(w - 1, Math.ceil(cx + rx));
      const y0 = Math.max(0, Math.floor(cy - ry)), y1 = Math.min(h - 1, Math.ceil(cy + ry));
      for (let py = y0; py <= y1; py++) {
        for (let px0 = x0; px0 <= x1; px0++) {
          const du = (px0 - cx) / rx, dv = (py - cy) / ry;
          if (du * du + dv * dv > 1) continue;
          const fall = 1 - Math.sqrt(du * du + dv * dv);
          const i = (py * w + px0) * 4;
          const L = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
          const target = floorL * fall + L * (1 - fall);
          if (L >= target - 0.5) continue;
          const k = target / Math.max(L, 1);
          px[i] = Math.min(255, Math.round(px[i] * k));
          px[i + 1] = Math.min(255, Math.round(px[i + 1] * k));
          px[i + 2] = Math.min(255, Math.round(px[i + 2] * k));
        }
      }
    }
    for (const o of liftPts) {
      liftAt(o.u, o.v, side * 0.028, side * 0.022, 98);
      liftAt(o.u, o.v, side * 0.016, side * 0.013, 88);
    }
    x.putImageData(id, 0, 0);
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.92));
    const ab = await blob.arrayBuffer();
    const u = new Uint8Array(ab);
    let s = '';
    for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
    return btoa(s);
  }, { b64, liftPts });
  await browser.close();
  return Buffer.from(outB64, 'base64');
}

async function paintNearEyeHair(full, albedoBuf) {
  // 通用：近眼球前向顶点 → 按顶点 UV 小戳点（中位数剔离群，避免均值落到胸口岛）
  const { chromium } = require('playwright');
  const { j, bin } = full;
  function readF32(accIdx) {
    const acc = j.accessors[accIdx];
    const bv = j.bufferViews[acc.bufferView];
    const off = (bv.byteOffset || 0) + (acc.byteOffset || 0);
    const nc = acc.type === 'VEC3' ? 3 : 2;
    return new Float32Array(bin.buffer, bin.byteOffset + off, acc.count * nc);
  }
  const eyes = collectSfEyeFrames(j, bin);
  if (!eyes.length) return albedoBuf;

  function eyeFrame(fwd) {
    let up = [0, 1, 0];
    if (Math.abs(fwd[1]) > 0.9) up = [1, 0, 0];
    let rx = up[1] * fwd[2] - up[2] * fwd[1];
    let ry = up[2] * fwd[0] - up[0] * fwd[2];
    let rz = up[0] * fwd[1] - up[1] * fwd[0];
    const rl = Math.hypot(rx, ry, rz) || 1;
    rx /= rl; ry /= rl; rz /= rl;
    let ux = fwd[1] * rz - fwd[2] * ry;
    let uy = fwd[2] * rx - fwd[0] * rz;
    let uz = fwd[0] * ry - fwd[1] * rx;
    const ul = Math.hypot(ux, uy, uz) || 1;
    return { rx, ry, rz, ux: ux / ul, uy: uy / ul, uz: uz / ul };
  }

  function median(arr) {
    const a = arr.slice().sort((x, y) => x - y);
    return a[Math.floor(a.length * 0.5)];
  }
  function clusterPts(raw, cellU, cellV, maxN) {
    if (raw.length < 6) return [];
    const mu = median(raw.map((p) => p.u));
    const mv = median(raw.map((p) => p.v));
    const kept = raw.filter((p) => Math.hypot(p.u - mu, p.v - mv) < 0.04);
    if (kept.length < 6) return [];
    const cells = new Map();
    for (const p of kept) {
      const key = Math.floor(p.u / cellU) + ',' + Math.floor(p.v / cellV);
      if (!cells.has(key)) cells.set(key, p);
    }
    let out = [...cells.values()];
    if (out.length > maxN) {
      const step = Math.ceil(out.length / maxN);
      out = out.filter((_, i) => i % step === 0);
    }
    return out;
  }

  // 按图元计分：只取眉点最多的那一张脸皮（避免身体/衣物误采）
  const primScores = [];
  j.meshes.forEach((m, mi) => m.primitives.forEach((p, pi) => {
    const mat = j.materials[p.material];
    if (mat && mat.extras && mat.extras.sfEyeball) return;
    const idxCount = p.indices != null ? j.accessors[p.indices].count : 999999;
    if (idxCount < 5000) return; // 补洞片不参与眉睫 UV 采样
    if (p.attributes.TEXCOORD_0 == null || p.attributes.POSITION == null) return;
    const pos = readF32(p.attributes.POSITION);
    const uv = readF32(p.attributes.TEXCOORD_0);
    const nrm = p.attributes.NORMAL != null ? readF32(p.attributes.NORMAL) : null;
    const n = pos.length / 3;
    let browHit = 0;
    for (const e of eyes) {
      for (let i = 0; i < n; i++) {
        const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
        const dx = x - e.c[0], dy = y - e.c[1], dz = z - e.c[2];
        const d = Math.hypot(dx, dy, dz);
        if (d > e.r * 2.8 || d < e.r * 0.55) continue;
        const along = dx * e.fwd[0] + dy * e.fwd[1] + dz * e.fwd[2];
        if (along < -e.r * 0.5) continue;
        if (nrm) {
          const nd = nrm[i * 3] * e.fwd[0] + nrm[i * 3 + 1] * e.fwd[1] + nrm[i * 3 + 2] * e.fwd[2];
          if (nd < 0.12) continue;
        }
        const fr = eyeFrame(e.fwd);
        const lat = dx * fr.rx + dy * fr.ry + dz * fr.rz;
        const vert = dx * fr.ux + dy * fr.uy + dz * fr.uz;
        if (vert > e.r * 0.65 && vert < e.r * 1.65 && Math.abs(lat) < e.r * 1.05) browHit++;
      }
    }
    if (browHit >= 8) primScores.push({ mi, pi, browHit, p, pos, uv, nrm, n });
  }));
  primScores.sort((a, b) => b.browHit - a.browHit || a.pi - b.pi);
  // 同网格双材质会各采一遍：只留最高分一张，避免重复戳点
  const best = primScores.slice(0, 1);
  console.log('hair prim scores', primScores.map((s) => ({ mi: s.mi, pi: s.pi, browHit: s.browHit })));

  const browPts = [];
  const lashPts = [];
  const browDense = [];
  const lashDense = [];
  for (const s of best) {
    for (const e of eyes) {
      const brows = [], lashes = [];
      for (let i = 0; i < s.n; i++) {
        const x = s.pos[i * 3], y = s.pos[i * 3 + 1], z = s.pos[i * 3 + 2];
        const dx = x - e.c[0], dy = y - e.c[1], dz = z - e.c[2];
        const d = Math.hypot(dx, dy, dz);
        const u = s.uv[i * 2], v = s.uv[i * 2 + 1];
        if (d > e.r * 2.8 || d < e.r * 0.55) continue;
        const along = dx * e.fwd[0] + dy * e.fwd[1] + dz * e.fwd[2];
        if (along < -e.r * 0.5) continue;
        if (s.nrm) {
          const nd = s.nrm[i * 3] * e.fwd[0] + s.nrm[i * 3 + 1] * e.fwd[1] + s.nrm[i * 3 + 2] * e.fwd[2];
          if (nd < 0.12) continue;
        }
        const fr = eyeFrame(e.fwd);
        const lat = dx * fr.rx + dy * fr.ry + dz * fr.rz;
        const vert = dx * fr.ux + dy * fr.uy + dz * fr.uz;
        if (vert > e.r * 0.62 && vert < e.r * 1.62 && Math.abs(lat) < e.r * 1.05) {
          brows.push({ u, v });
          if (brows.length % 2 === 0) browDense.push({ u, v });
        }
        if (d > e.r * 0.90 && d < e.r * 1.24 && Math.abs(vert) < e.r * 0.32 && Math.abs(lat) < e.r * 0.92) {
          lashes.push({ u, v });
          if (lashes.length % 2 === 0) lashDense.push({ u, v });
        }
      }
      for (const q of clusterPts(brows, 0.010, 0.006, 120)) browPts.push(q);
      for (const q of clusterPts(lashes, 0.008, 0.004, 72)) lashPts.push(q);
    }
  }
  // 通用：同一 UV 若也被远离眼球 / 锁骨以下顶点使用，则跳过（防胸口岛误染）
  const skinRef = best[0];
  let _eyeY = 0, _headH = 0.5;
  if (eyes.length && skinRef) {
    _eyeY = eyes.reduce((s, e) => s + e.c[1], 0) / eyes.length;
    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < skinRef.n; i++) {
      const y = skinRef.pos[i * 3 + 1];
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (minY < maxY) _headH = maxY - minY;
  }
  // dab 半径按纹理边长换算到 UV：安全半径必须 ≥ 实际笔触，否则笔触扫到共用 UV 岛（胸口黑斑）
  function uvSafeForHair(u, v, skin, dabR) {
    const r = dabR || 0.02;
    const chestY = _eyeY - _headH * 0.08;
    for (let i = 0; i < skin.n; i++) {
      const uu = skin.uv[i * 2], vv = skin.uv[i * 2 + 1];
      if (Math.hypot(uu - u, vv - v) > r) continue;
      const x = skin.pos[i * 3], y = skin.pos[i * 3 + 1], z = skin.pos[i * 3 + 2];
      if (y < chestY) return false;
      let near = false;
      for (const e of eyes) {
        if (Math.hypot(x - e.c[0], y - e.c[1], z - e.c[2]) < e.r * 1.95) near = true;
      }
      if (!near) return false;
    }
    return true;
  }
  // 对应下方 dab：browDense≈0.012、brow≈0.010、lash≈0.006（UV 单位）+ 余量
  const safeUvR = { browDense: 0.028, brow: 0.022, lash: 0.014 };
  const safeBrow = skinRef ? browPts.filter((p) => uvSafeForHair(p.u, p.v, skinRef, safeUvR.brow)) : browPts;
  const safeLash = skinRef ? lashPts.filter((p) => uvSafeForHair(p.u, p.v, skinRef, safeUvR.lash)) : lashPts;
  const safeBrowDense = skinRef ? browDense.filter((p) => uvSafeForHair(p.u, p.v, skinRef, safeUvR.browDense)) : browDense;
  const safeLashDense = skinRef ? lashDense.filter((p) => uvSafeForHair(p.u, p.v, skinRef, safeUvR.lash)) : lashDense;
  console.log('browPts', safeBrow.length, 'lashPts', safeLash.length, 'dense', safeBrowDense.length, safeLashDense.length,
    safeBrow.length ? { u0: safeBrow[0].u, v0: safeBrow[0].v } : null);
  if (!safeBrow.length && !safeLash.length) return albedoBuf;

  // 胸口/躯干 UV 戳点列表：喷涂后强制还原，防止滤波/JPEG/邻岛污染成胸口黑斑
  const chestY = _eyeY - _headH * 0.08;
  const chestRestore = [];
  if (skinRef) {
    const cells = new Map();
    for (let i = 0; i < skinRef.n; i++) {
      const y = skinRef.pos[i * 3 + 1];
      if (y >= chestY) continue;
      const u = skinRef.uv[i * 2], v = skinRef.uv[i * 2 + 1];
      const key = (u * 128 | 0) + ',' + (v * 128 | 0);
      if (!cells.has(key)) cells.set(key, { u, v });
    }
    chestRestore.push(...cells.values());
  }
  console.log('chestRestore stamps', chestRestore.length);

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  const b64 = albedoBuf.toString('base64');
  const outB64 = await page.evaluate(async ({ b64, browPts, lashPts, browDense, lashDense, chestRestore }) => {
    const bin = atob(b64); const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([u8], { type: 'image/jpeg' }));
    const w = bmp.width, h = bmp.height;
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.drawImage(bmp, 0, 0);
    const bak = x.getImageData(0, 0, w, h);
    function dab(u, v, rx, ry, rgb, a0) {
      const cx = u * w, cy = (1 - v) * h;
      x.save();
      x.globalCompositeOperation = 'source-over';
      x.translate(cx, cy);
      x.scale(rx, ry);
      const g = x.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0, 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + a0 + ')');
      g.addColorStop(0.5, 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',' + (a0 * 0.5) + ')');
      g.addColorStop(1, 'rgba(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ',0)');
      x.fillStyle = g;
      x.beginPath(); x.arc(0, 0, 1, 0, Math.PI * 2); x.fill();
      x.restore();
    }
    const side = Math.max(w, h);
    x.globalCompositeOperation = 'multiply';
    for (const o of browDense) {
      dab(o.u, o.v, side * 0.012, side * 0.0045, [8, 3, 2], 0.88);
      dab(o.u, o.v, side * 0.007, side * 0.0028, [4, 2, 1], 0.92);
    }
    for (const o of lashDense) {
      dab(o.u, o.v, side * 0.004, side * 0.0014, [28, 10, 8], 0.72);
    }
    x.globalCompositeOperation = 'source-over';
    for (const o of browPts) {
      x.globalCompositeOperation = 'multiply';
      dab(o.u, o.v, side * 0.010, side * 0.004, [10, 4, 2], 0.90);
      x.globalCompositeOperation = 'source-over';
    }
    for (const o of lashPts) {
      x.globalCompositeOperation = 'multiply';
      dab(o.u, o.v, side * 0.006, side * 0.0022, [40, 16, 12], 0.82);
      x.globalCompositeOperation = 'source-over';
    }
    // 还原胸口 texel（含邻域，挡住滤波渗色）
    if (chestRestore && chestRestore.length) {
      const cur = x.getImageData(0, 0, w, h);
      const src = bak.data, dst = cur.data;
      const rad = Math.max(3, Math.round(side * 0.006));
      for (const o of chestRestore) {
        const cx = Math.round(o.u * w), cy = Math.round((1 - o.v) * h);
        for (let dy = -rad; dy <= rad; dy++) {
          for (let dx = -rad; dx <= rad; dx++) {
            if (dx * dx + dy * dy > rad * rad) continue;
            const x0 = cx + dx, y0 = cy + dy;
            if (x0 < 0 || y0 < 0 || x0 >= w || y0 >= h) continue;
            const i = (y0 * w + x0) * 4;
            dst[i] = src[i]; dst[i + 1] = src[i + 1]; dst[i + 2] = src[i + 2]; dst[i + 3] = src[i + 3];
          }
        }
      }
      x.putImageData(cur, 0, 0);
    }
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.92));
    const ab = await blob.arrayBuffer();
    const u = new Uint8Array(ab);
    let s = '';
    for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
    return btoa(s);
  }, { b64, browPts: safeBrow, lashPts: safeLash, browDense: safeBrowDense, lashDense: safeLashDense, chestRestore });
  await browser.close();
  return Buffer.from(outB64, 'base64');
}


async function flattenMatcapJpeg(buf) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();
  const b64 = buf.toString('base64');
  const outB64 = await page.evaluate(async (b64) => {
    const bin = atob(b64); const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([u8]));
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    const x = c.getContext('2d');
    x.drawImage(bmp, 0, 0);
    const id = x.getImageData(0, 0, c.width, c.height);
    const d = id.data;
    // 压平 Matcap：保留少量体积感，胸口/凹腔不再采成墨斑
    for (let i = 0; i < d.length; i += 4) {
      const L = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const t = 0.10 + 0.90 * Math.min(1, L / 240);
      const base = 216;
      d[i] = Math.round(d[i] * t + base * (1 - t));
      d[i + 1] = Math.round(d[i + 1] * t + base * (1 - t));
      d[i + 2] = Math.round(d[i + 2] * t + base * (1 - t));
    }
    x.putImageData(id, 0, 0);
    const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
    const ab = await blob.arrayBuffer();
    const u = new Uint8Array(ab);
    let s = '';
    for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
    return btoa(s);
  }, b64);
  await browser.close();
  return Buffer.from(outB64, 'base64');
}

async function lightenMatcapJpeg(buf) {
  return flattenMatcapJpeg(buf);
}

async function main() {
  const full = readGlb(fullGlb);
  fixSfMatcapWinding(full);
  const specP = path.join(runDir, '_spec_src.jpg');
  const colP = path.join(runDir, '_colour_src.jpg');
  const matP = path.join(runDir, 'matcap.png');
  if (!fs.existsSync(specP)) fs.writeFileSync(specP, getImg(full.bin, full.j, /^Spec\.jpg$/i));
  if (!fs.existsSync(colP)) fs.writeFileSync(colP, getImg(full.bin, full.j, /^Colour/i));
  if (!fs.existsSync(matP)) fs.writeFileSync(matP, getImg(full.bin, full.j, /skin_soft/i));
  const albedoP = path.join(runDir, 'albedo_v930.jpg');
  const irisP = path.join(runDir, 'iris_v930.jpg');
  console.log('synth albedo + iris…');
  await synthInBrowser(specP, colP, matP, albedoP, irisP);
  let albBuf = fs.readFileSync(albedoP);
  if (!process.env.SKIP_HAIR) {
    albBuf = await paintNearEyeHair(full, albBuf);
  }
  if (!process.env.SKIP_TORSO_LIFT) {
    albBuf = await lightenForwardTorso(full, albBuf);
  }
  fs.writeFileSync(albedoP, albBuf);
  console.log('albedo', albBuf.length, 'iris', fs.statSync(irisP).size);
  const nrmRaw = fs.existsSync(path.join(runDir, 'normal_1k.jpg'))
    ? fs.readFileSync(path.join(runDir, 'normal_1k.jpg'))
    : getImg(full.bin, full.j, /Normal/i);
  const nrmSoftP = path.join(runDir, 'normal_soft_v938.jpg');
  console.log('soften normal…');
  let nrmSoft;
  if (fs.existsSync(nrmSoftP) && fs.statSync(nrmSoftP).size > 1000) {
    nrmSoft = fs.readFileSync(nrmSoftP);
    console.log('reuse', nrmSoftP, nrmSoft.length);
  } else {
    nrmSoft = await softenNormalJpeg(nrmRaw, nrmSoftP);
  }
  console.log('lift matcap dark rim…');
  const matSoft = await flattenMatcapJpeg(fs.readFileSync(matP));
  const slim = buildSlim(
    full,
    albBuf,
    matSoft,
    nrmSoft,
    fs.readFileSync(irisP)
  );
  fs.writeFileSync(slimOut, slim);
  console.log('wrote', slimOut, (slim.length / 1e6).toFixed(2) + 'MB');
  if (ultimateOut) {
    fs.writeFileSync(ultimateOut, slim);
    console.log('wrote', ultimateOut, (slim.length / 1e6).toFixed(2) + 'MB');
  }
  try { fs.unlinkSync(specP); fs.unlinkSync(colP); } catch (_) {}
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
