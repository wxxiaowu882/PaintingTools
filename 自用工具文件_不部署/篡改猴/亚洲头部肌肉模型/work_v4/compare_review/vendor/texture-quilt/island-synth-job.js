/**
 * Shared island texture shuffle synthesis (main thread + worker).
 */
import {
  createRng,
  imageDataFromRgba,
  inpaintExampleFromMask,
  shuffleTextureBlocks,
  resizeImageDataBilinear,
} from "./image-quilt.js";

const MAX_SYNTH_DIM = 512;
const MIN_BLOCK = 8;
const MAX_BLOCK = 48;

function countMaskDiff(imgData, origRgba, mask, w, h) {
  let diff = 0;
  let total = 0;
  for (let i = 0; i < w * h; i++) {
    if (!mask[i]) continue;
    total++;
    const j = i * 4;
    if (
      imgData[j] !== origRgba[j] ||
      imgData[j + 1] !== origRgba[j + 1] ||
      imgData[j + 2] !== origRgba[j + 2]
    ) {
      diff++;
    }
  }
  return { diff, total };
}

export function synthIslandJob(job) {
  const { exampleRgba, bboxW, bboxH, maskLocal, blockScale, similarity, seed, hardShuffle = false } = job;

  const prepared = inpaintExampleFromMask(exampleRgba, maskLocal, bboxW, bboxH);

  let workW = bboxW;
  let workH = bboxH;
  let workImg = imageDataFromRgba(prepared, bboxW, bboxH);
  let workMask = maskLocal;
  let preparedWork = prepared;
  let scale = 1;
  const maxDim = Math.max(bboxW, bboxH);
  if (maxDim > MAX_SYNTH_DIM) {
    scale = MAX_SYNTH_DIM / maxDim;
    workW = Math.max(16, Math.round(bboxW * scale));
    workH = Math.max(16, Math.round(bboxH * scale));
    workImg = resizeImageDataBilinear(workImg, workW, workH);
    const scaledMask = new Uint8Array(workW * workH);
    const scaledPrepared = new Uint8ClampedArray(workW * workH * 4);
    for (let row = 0; row < workH; row++) {
      for (let col = 0; col < workW; col++) {
        const sx = Math.min(bboxW - 1, Math.floor((col / workW) * bboxW));
        const sy = Math.min(bboxH - 1, Math.floor((row / workH) * bboxH));
        scaledMask[row * workW + col] = maskLocal[sy * bboxW + sx] ? 1 : 0;
        const si = (sy * bboxW + sx) * 4;
        const di = (row * workW + col) * 4;
        scaledPrepared[di] = prepared[si];
        scaledPrepared[di + 1] = prepared[si + 1];
        scaledPrepared[di + 2] = prepared[si + 2];
        scaledPrepared[di + 3] = prepared[si + 3];
      }
    }
    workMask = scaledMask;
    preparedWork = scaledPrepared;
  }

  let blockSize = Math.round(blockScale);
  const stripeCap = hardShuffle
    ? Math.max(18, Math.round(Math.min(workW, workH) / 5))
    : Math.max(10, Math.round(Math.min(workW, workH) / 12));
  blockSize = Math.min(blockSize, stripeCap, MAX_BLOCK);
  blockSize = Math.max(MIN_BLOCK, blockSize);
  if (blockSize >= Math.min(workW, workH)) {
    blockSize = Math.max(MIN_BLOCK, Math.floor(Math.min(workW, workH) / 5));
  }
  let overlap = hardShuffle ? 1 : Math.max(2, Math.floor(blockSize * (0.06 + similarity * 0.1)));
  const simUse = hardShuffle ? Math.min(0.32, similarity) : similarity;

  const runShuffle = (shuffleSeed, shuffleSim, shuffleOverlap) =>
    shuffleTextureBlocks({
      inputImage: workImg,
      blockSize,
      overlap: shuffleOverlap,
      seed: shuffleSeed,
      similarity: shuffleSim,
      mask: workMask,
    });

  let quilted = runShuffle(seed, simUse, overlap);
  let stats = countMaskDiff(quilted.data, preparedWork, workMask, workW, workH);
  if (!hardShuffle && stats.total > 0 && stats.diff / stats.total < 0.55) {
    overlap = Math.max(2, overlap - 3);
    quilted = runShuffle((seed + 0x39ab) >>> 0, Math.max(0.4, similarity - 0.08), overlap);
    stats = countMaskDiff(quilted.data, preparedWork, workMask, workW, workH);
  }
  if (!hardShuffle && stats.total > 0 && stats.diff / stats.total < 0.45) {
    overlap = Math.max(2, overlap - 2);
    quilted = runShuffle((seed + 0x71c3) >>> 0, 0.42, overlap);
  }

  let result = quilted;
  if (scale < 1) {
    result = resizeImageDataBilinear(quilted, bboxW, bboxH);
  }

  const outRgba = new Uint8ClampedArray(exampleRgba);
  for (let row = 0; row < bboxH; row++) {
    for (let col = 0; col < bboxW; col++) {
      const li = row * bboxW + col;
      if (!maskLocal[li]) continue;
      const di = li * 4;
      const si = (row * result.width + col) * 4;
      const sr = result.data[si];
      const sg = result.data[si + 1];
      const sb = result.data[si + 2];
      if (sr === 0 && sg === 0 && sb === 0) {
        outRgba[di] = prepared[di];
        outRgba[di + 1] = prepared[di + 1];
        outRgba[di + 2] = prepared[di + 2];
        outRgba[di + 3] = prepared[di + 3] || 255;
        continue;
      }
      outRgba[di] = sr;
      outRgba[di + 1] = sg;
      outRgba[di + 2] = sb;
      outRgba[di + 3] = result.data[si + 3] || 255;
    }
  }

  stats = countMaskDiff(outRgba, prepared, maskLocal, bboxW, bboxH);

  return { outRgba, bboxW, bboxH, blockSize, overlap, changedRatio: stats.total ? stats.diff / stats.total : 0 };
}
