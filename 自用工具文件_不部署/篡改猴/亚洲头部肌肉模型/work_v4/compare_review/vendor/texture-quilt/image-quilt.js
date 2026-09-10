/**
 * Browser ImageData image quilting (MIT, adapted from patorjk/image-quilter).
 */
import {
  cutGraph,
  dijkstra,
  getGraphPath,
  getOriginalSegmentBorder,
  getOriginalSegmentNodes,
} from "./dijkstra.js";

/** @returns {{ next: () => number }} mulberry32 in [0,1) */
export function createRng(seed) {
  let t = seed >>> 0;
  return {
    next() {
      t += 0x6d2b79f5;
      let r = Math.imul(t ^ (t >>> 15), 1 | t);
      r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
      return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
    },
  };
}

function getPx(img, x, y) {
  const i = (y * img.width + x) * 4;
  const d = img.data;
  return { r: d[i], g: d[i + 1], b: d[i + 2], a: d[i + 3] };
}

function setPx(img, x, y, c) {
  const i = (y * img.width + x) * 4;
  const d = img.data;
  d[i] = c.r;
  d[i + 1] = c.g;
  d[i + 2] = c.b;
  d[i + 3] = c.a;
}

function createMask(blockSize, vVisible = 0, hVisible = 0) {
  const mask = [];
  for (let row = 0; row < blockSize; row++) {
    mask[row] = [];
    for (let col = 0; col < blockSize; col++) {
      mask[row][col] = col < hVisible || row < vVisible ? 1 : 0;
    }
  }
  return mask;
}

function createOverlapMask(cutType, blockSize, overlap) {
  if (cutType === "v") return createMask(blockSize, overlap, 0);
  if (cutType === "h") return createMask(blockSize, 0, overlap);
  if (cutType === "b") return createMask(blockSize, overlap, overlap);
  return createMask(blockSize);
}

function createBlock(inputImage, xOffset, yOffset, blockSize) {
  return {
    xOffset,
    yOffset,
    size: blockSize,
    image: inputImage,
    getPixelColor(x, y) {
      return getPx(inputImage, xOffset + x, yOffset + y);
    },
  };
}

function sumOfSquaredDifferences(block1, block2, overlapMask) {
  if (block1.size !== block2.size) throw new Error("Invalid block comparison");
  let ssd = 0;
  for (let row = 0; row < block1.size; row++) {
    for (let col = 0; col < block1.size; col++) {
      if (!overlapMask[row][col]) continue;
      const c1 = block1.getPixelColor(col, row);
      const c2 = block2.getPixelColor(col, row);
      const diff = Math.abs(c1.r - c2.r) + Math.abs(c1.g - c2.g) + Math.abs(c1.b - c2.b);
      ssd += diff * diff;
    }
  }
  return ssd;
}

function createOverlapGraph(outputImage, xOffset, yOffset, block, overlapMask) {
  const graph = {};
  const weights = {};
  for (let row = 0; row < block.size; row++) {
    for (let col = 0; col < block.size; col++) {
      if (!overlapMask[row][col]) continue;
      const c1 = getPx(outputImage, col + xOffset, row + yOffset);
      const c2 = block.getPixelColor(col, row);
      const diff = Math.abs(c1.r - c2.r) + Math.abs(c1.g - c2.g) + Math.abs(c1.b - c2.b);
      weights[`${row}_${col}`] = { row, col, weight: diff * diff };
    }
  }
  const setEdge = (g, key, row, col) => {
    const w = weights[`${row}_${col}`];
    if (w) g[key][`${row}_${col}`] = w.weight;
  };
  for (const key of Object.keys(weights)) {
    graph[key] = {};
    const { row, col } = weights[key];
    setEdge(graph, key, row - 1, col);
    setEdge(graph, key, row - 1, col - 1);
    setEdge(graph, key, row, col - 1);
    setEdge(graph, key, row + 1, col);
    setEdge(graph, key, row + 1, col - 1);
    setEdge(graph, key, row + 1, col + 1);
    setEdge(graph, key, row, col + 1);
  }
  return graph;
}

function blockMaskCoverage(mask, w, h, xOff, yOff, blockSize) {
  if (!mask) return 1;
  let inside = 0;
  const total = blockSize * blockSize;
  for (let row = 0; row < blockSize; row++) {
    for (let col = 0; col < blockSize; col++) {
      const cx = xOff + col;
      const cy = yOff + row;
      if (cx < 0 || cy < 0 || cx >= w || cy >= h) return 0;
      if (mask[cy * w + cx]) inside++;
    }
  }
  return inside / total;
}

function getBlockOffsets(inputImage, blockSize, count, rng, mask = null, minMaskFrac = 0.8) {
  const maxY = inputImage.height - blockSize;
  const maxX = inputImage.width - blockSize;
  if (maxX < 1 || maxY < 1) return [createBlock(inputImage, 0, 0, blockSize)];
  const ret = [];
  const seen = new Set();
  const tries = Math.max(count * 50, 200);
  for (let ii = 0; ii < tries && ret.length < count; ii++) {
    const xOffset = Math.floor(rng.next() * maxX);
    const yOffset = Math.floor(rng.next() * maxY);
    const key = `${xOffset}_${yOffset}`;
    if (seen.has(key)) continue;
    if (blockMaskCoverage(mask, inputImage.width, inputImage.height, xOffset, yOffset, blockSize) < minMaskFrac) {
      continue;
    }
    seen.add(key);
    ret.push(createBlock(inputImage, xOffset, yOffset, blockSize));
  }
  if (!ret.length) {
    let best = null;
    let bestCov = -1;
    const step = Math.max(1, Math.floor(blockSize / 4));
    for (let yOffset = 0; yOffset <= maxY; yOffset += step) {
      for (let xOffset = 0; xOffset <= maxX; xOffset += step) {
        const cov = blockMaskCoverage(mask, inputImage.width, inputImage.height, xOffset, yOffset, blockSize);
        if (cov > bestCov) {
          bestCov = cov;
          best = createBlock(inputImage, xOffset, yOffset, blockSize);
        }
      }
    }
    if (best) ret.push(best);
    else ret.push(createBlock(inputImage, 0, 0, blockSize));
  }
  return ret;
}

function getBlock(blockSet, row, col, blockSize, overlap, outputImage, rng, topK, mask = null, minMaskFrac = 0.8, similarity = 0.7) {
  const poolMasked = mask
    ? blockSet.filter(
        (block) =>
          blockMaskCoverage(mask, outputImage.width, outputImage.height, block.xOffset, block.yOffset, blockSize) >=
          minMaskFrac
      )
    : blockSet;
  const pickRandom = () => {
    const pool = poolMasked.length ? poolMasked : blockSet;
    return pool[Math.floor(rng.next() * pool.length)];
  };
  if (row === 0 && col === 0) return pickRandom();
  const variation = Math.max(0, Math.min(1, 1 - similarity));
  if (variation > 0.35 && rng.next() < variation * 0.85) return pickRandom();
  const cutType = row === 0 ? "h" : col === 0 ? "v" : "b";
  const gridBlockSize = blockSize - overlap;
  const outputAreaBlock = createBlock(
    outputImage,
    gridBlockSize * col,
    gridBlockSize * row,
    blockSize
  );
  const overlapMask = createOverlapMask(cutType, blockSize, overlap);
  const scored = blockSet.map((block) => ({
    block,
    ssd: sumOfSquaredDifferences(block, outputAreaBlock, overlapMask),
    cov: blockMaskCoverage(
      mask,
      outputImage.width,
      outputImage.height,
      block.xOffset,
      block.yOffset,
      blockSize
    ),
  }));
  scored.sort((a, b) => a.ssd - b.ssd);
  const filtered = mask ? scored.filter((s) => s.cov >= minMaskFrac) : scored;
  const pool = filtered.length ? filtered : scored;
  const k = Math.max(1, Math.min(topK, pool.length));
  const pick = Math.floor(rng.next() * k);
  return pool[pick].block;
}

function getCutSegments({ block, blockSize, overlap, outputImage, row, col }) {
  const cutType =
    row === 0 && col !== 0 ? "h" : col === 0 && row !== 0 ? "v" : row === 0 && col === 0 ? null : "b";
  if (cutType === null) return { originalSegment: [], cut: [] };
  const overlapMask = createOverlapMask(cutType, blockSize, overlap);
  const middle = Math.floor(overlap / 2);
  let startPoint;
  let endPoint;
  if (cutType === "h") {
    startPoint = `0_${middle}`;
    endPoint = `${blockSize - 1}_${middle}`;
  } else if (cutType === "v") {
    startPoint = `${middle}_0`;
    endPoint = `${middle}_${blockSize - 1}`;
  } else {
    startPoint = `${blockSize - 1}_${middle}`;
    endPoint = `${middle}_${blockSize - 1}`;
  }
  const origNodes = getOriginalSegmentBorder(cutType, startPoint, endPoint, middle);
  const gridBlockSize = blockSize - overlap;
  const graph = createOverlapGraph(
    outputImage,
    gridBlockSize * col,
    gridBlockSize * row,
    block,
    overlapMask
  );
  const paths = dijkstra(graph, startPoint);
  const cut = getGraphPath(endPoint, paths);
  const remainingGraph = cutGraph(graph, cut);
  let originalSegment = [];
  const remainingNodes = Object.keys(remainingGraph);
  if (remainingNodes.length > 0) {
    const origNodesNotInCut = origNodes.filter((node) => remainingNodes.includes(node));
    const walk = (nodes, acc) => {
      if (!nodes.length) return acc;
      const seg1 = dijkstra(remainingGraph, nodes[0]);
      for (const item of Object.keys(seg1)) {
        if (isFinite(seg1[item].dist)) acc.push(item);
      }
      return walk(
        origNodesNotInCut.filter((item) => !acc.includes(item)),
        acc
      );
    };
    originalSegment = walk(origNodesNotInCut, []);
    if (!originalSegment.length) {
      originalSegment = getOriginalSegmentNodes(paths, origNodes);
    }
  }
  return { originalSegment, cut };
}

function isEmptyPx(c) {
  return c.a === 0 && (c.r | c.g | c.b) === 0;
}

function placeBlock({ block, outputImage, row, col, overlap, blockSize }) {
  const gridBlockSize = blockSize - overlap;
  const { originalSegment = [], cut = [] } = getCutSegments({
    block,
    blockSize,
    overlap,
    outputImage,
    row,
    col,
  });
  const cutSet = new Set(cut);
  const origSet = new Set(originalSegment);
  for (let y = 0; y < blockSize; y++) {
    for (let x = 0; x < blockSize; x++) {
      const outputX = col * gridBlockSize + x;
      const outputY = row * gridBlockSize + y;
      if (outputX >= outputImage.width || outputY >= outputImage.height) continue;
      const lookup = `${y}_${x}`;
      let color = null;
      if (cutSet.has(lookup)) {
        const c1 = block.getPixelColor(x, y);
        const c2 = getPx(outputImage, outputX, outputY);
        color = {
          r: Math.round((c1.r + c2.r) / 2),
          g: Math.round((c1.g + c2.g) / 2),
          b: Math.round((c1.b + c2.b) / 2),
          a: c2.a,
        };
      } else if (!origSet.has(lookup)) {
        color = block.getPixelColor(x, y);
      } else if (isEmptyPx(getPx(outputImage, outputX, outputY))) {
        color = block.getPixelColor(x, y);
      }
      if (color) setPx(outputImage, outputX, outputY, color);
    }
  }
}

/**
 * Quilt a new image from example patches.
 * @param {object} opts
 * @param {ImageData} opts.inputImage - example texture
 * @param {number} opts.outWidth
 * @param {number} opts.outHeight
 * @param {number} opts.blockSize
 * @param {number} opts.overlap - pixels
 * @param {number} opts.seed
 * @param {number} [opts.similarity] 0..1 higher = more like source
 */
/**
 * Spread mask-interior colors into bbox padding so quilting never samples foreign UV texels.
 */
export function inpaintExampleFromMask(rgba, mask, w, h) {
  const out = new Uint8ClampedArray(rgba);
  const filled = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (mask[i]) filled[i] = 1;
  }
  const neighbors = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ];
  let changed = true;
  let guard = 0;
  while (changed && guard++ < Math.max(w, h) * 2) {
    changed = false;
    const next = new Uint8Array(filled);
    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        const i = row * w + col;
        if (filled[i]) continue;
        let sr = 0;
        let sg = 0;
        let sb = 0;
        let sa = 0;
        let n = 0;
        for (const [dc, dr] of neighbors) {
          const nc = col + dc;
          const nr = row + dr;
          if (nc < 0 || nr < 0 || nc >= w || nr >= h) continue;
          const ni = nr * w + nc;
          if (!filled[ni]) continue;
          const j = ni * 4;
          sr += out[j];
          sg += out[j + 1];
          sb += out[j + 2];
          sa += out[j + 3];
          n++;
        }
        if (!n) continue;
        const j = i * 4;
        out[j] = Math.round(sr / n);
        out[j + 1] = Math.round(sg / n);
        out[j + 2] = Math.round(sb / n);
        out[j + 3] = Math.round(sa / n);
        next[i] = 1;
        changed = true;
      }
    }
    filled.set(next);
  }
  return out;
}

function fillQuiltHoles(outputImage, inputImage) {
  const w = outputImage.width;
  const h = outputImage.height;
  const neighbors = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ];
  let changed = true;
  let guard = 0;
  while (changed && guard++ < w * h) {
    changed = false;
    for (let row = 0; row < h; row++) {
      for (let col = 0; col < w; col++) {
        if (!isEmptyPx(getPx(outputImage, col, row))) continue;
        let sr = 0;
        let sg = 0;
        let sb = 0;
        let n = 0;
        for (const [dc, dr] of neighbors) {
          const nc = col + dc;
          const nr = row + dr;
          if (nc < 0 || nr < 0 || nc >= w || nr >= h) continue;
          const cn = getPx(outputImage, nc, nr);
          if (isEmptyPx(cn)) continue;
          sr += cn.r;
          sg += cn.g;
          sb += cn.b;
          n++;
        }
        if (!n) continue;
        setPx(outputImage, col, row, {
          r: Math.round(sr / n),
          g: Math.round(sg / n),
          b: Math.round(sb / n),
          a: 255,
        });
        changed = true;
      }
    }
  }
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      if (!isEmptyPx(getPx(outputImage, col, row))) continue;
      setPx(outputImage, col, row, getPx(inputImage, col, row));
    }
  }
}

/**
 * Reassemble in-mask texture by shuffling example blocks (better for striated muscle).
 */
export function shuffleTextureBlocks({
  inputImage,
  blockSize,
  overlap,
  seed,
  similarity = 0.7,
  mask = null,
}) {
  const w = inputImage.width;
  const h = inputImage.height;
  const outputImage = new ImageData(w, h);
  const writeCount = new Uint16Array(w * h);
  const accum = new Float32Array(w * h * 3);
  const rng = createRng(seed || 1);
  const minMaskFrac = 0.65;
  const gridBlockSize = Math.max(1, blockSize - overlap);
  const gridW = Math.ceil(w / gridBlockSize);
  const gridH = Math.ceil(h / gridBlockSize);
  const candidates = getBlockOffsets(inputImage, blockSize, 80, rng, mask, minMaskFrac);

  const cellTouchesMask = (ox, oy) => {
    if (!mask) return true;
    for (let y = 0; y < blockSize; y++) {
      for (let x = 0; x < blockSize; x++) {
        const px = ox + x;
        const py = oy + y;
        if (px >= w || py >= h) continue;
        if (mask[py * w + px]) return true;
      }
    }
    return false;
  };

  const pickBlock = (ox = 0, oy = 0) => {
    if (!candidates.length) return createBlock(inputImage, 0, 0, blockSize);
    const minDist = Math.max(6, Math.floor(blockSize * (0.35 + similarity * 0.45)));
    const k = Math.max(1, Math.min(candidates.length, Math.round((1 - similarity) * 18) + 2));
    for (let t = 0; t < 48; t++) {
      const block = candidates[Math.floor(rng.next() * k)];
      const dist = Math.abs(block.xOffset - ox) + Math.abs(block.yOffset - oy);
      if (dist >= minDist) return block;
    }
    return candidates[Math.floor(rng.next() * k)];
  };

  for (let gy = 0; gy < gridH; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      const ox = gx * gridBlockSize;
      const oy = gy * gridBlockSize;
      if (!cellTouchesMask(ox, oy)) continue;
      const block = pickBlock(ox, oy);
      for (let y = 0; y < blockSize; y++) {
        for (let x = 0; x < blockSize; x++) {
          const px = ox + x;
          const py = oy + y;
          if (px >= w || py >= h) continue;
          const mi = py * w + px;
          if (mask && !mask[mi]) continue;
          const c = block.getPixelColor(x, y);
          const ai = mi * 3;
          accum[ai] += c.r;
          accum[ai + 1] += c.g;
          accum[ai + 2] += c.b;
          writeCount[mi]++;
        }
      }
    }
  }

  for (let i = 0; i < w * h; i++) {
    if (!writeCount[i]) continue;
    const di = i * 4;
    const ai = i * 3;
    const n = writeCount[i];
    outputImage.data[di] = Math.round(accum[ai] / n);
    outputImage.data[di + 1] = Math.round(accum[ai + 1] / n);
    outputImage.data[di + 2] = Math.round(accum[ai + 2] / n);
    outputImage.data[di + 3] = inputImage.data[di + 3] || 255;
  }

  if (mask) {
    for (let i = 0; i < w * h; i++) {
      if (!mask[i] || writeCount[i]) continue;
      const col = i % w;
      const row = (i / w) | 0;
      const block = pickBlock(col, row);
      const bx = Math.min(block.size - 1, Math.floor(rng.next() * block.size));
      const by = Math.min(block.size - 1, Math.floor(rng.next() * block.size));
      const c = block.getPixelColor(bx, by);
      const di = i * 4;
      outputImage.data[di] = c.r;
      outputImage.data[di + 1] = c.g;
      outputImage.data[di + 2] = c.b;
      outputImage.data[di + 3] = c.a || 255;
      writeCount[i] = 1;
    }
    const neighbors = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ];
    let changed = true;
    let guard = 0;
    while (changed && guard++ < w * h) {
      changed = false;
      for (let row = 0; row < h; row++) {
        for (let col = 0; col < w; col++) {
          const i = row * w + col;
          if (!mask[i] || writeCount[i]) continue;
          let sr = 0;
          let sg = 0;
          let sb = 0;
          let n = 0;
          for (const [dc, dr] of neighbors) {
            const nc = col + dc;
            const nr = row + dr;
            if (nc < 0 || nr < 0 || nc >= w || nr >= h) continue;
            const ni = nr * w + nc;
            if (!writeCount[ni]) continue;
            const di = ni * 4;
            sr += outputImage.data[di];
            sg += outputImage.data[di + 1];
            sb += outputImage.data[di + 2];
            n++;
          }
          if (!n) continue;
          const di = i * 4;
          outputImage.data[di] = Math.round(sr / n);
          outputImage.data[di + 1] = Math.round(sg / n);
          outputImage.data[di + 2] = Math.round(sb / n);
          outputImage.data[di + 3] = inputImage.data[di + 3] || 255;
          writeCount[i] = 1;
          changed = true;
        }
      }
    }
  }

  return outputImage;
}

export function quiltImage({
  inputImage,
  outWidth,
  outHeight,
  blockSize,
  overlap,
  seed,
  similarity = 0.7,
  mask = null,
}) {
  const rng = createRng(seed || 1);
  const outputImage = new ImageData(outWidth, outHeight);
  const gridBlockSize = Math.max(1, blockSize - overlap);
  const gridWidth = Math.ceil(outWidth / gridBlockSize);
  const gridHeight = Math.ceil(outHeight / gridBlockSize);
  const candidateCount = 50;
  const topK = Math.max(1, Math.round((1 - similarity) * 20) + 1);
  const minMaskFrac = 0.65;

  for (let col = 0; col < gridWidth; col++) {
    for (let row = 0; row < gridHeight; row++) {
      const blockSet = getBlockOffsets(
        inputImage,
        blockSize,
        candidateCount,
        rng,
        mask,
        minMaskFrac
      );
      const block = getBlock(
        blockSet,
        row,
        col,
        blockSize,
        overlap,
        outputImage,
        rng,
        topK,
        mask,
        minMaskFrac,
        similarity
      );
      placeBlock({ block, outputImage, row, col, overlap, blockSize });
    }
  }
  fillQuiltHoles(outputImage, inputImage);
  return outputImage;
}

export function imageDataFromRgba(rgba, width, height) {
  const img = new ImageData(width, height);
  img.data.set(rgba);
  return img;
}

export function cropImageData(src, x, y, w, h) {
  const out = new ImageData(w, h);
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const si = ((y + row) * src.width + (x + col)) * 4;
      const di = (row * w + col) * 4;
      out.data[di] = src.data[si];
      out.data[di + 1] = src.data[si + 1];
      out.data[di + 2] = src.data[si + 2];
      out.data[di + 3] = src.data[si + 3];
    }
  }
  return out;
}

export function resizeImageDataNearest(src, newW, newH) {
  const out = new ImageData(newW, newH);
  for (let y = 0; y < newH; y++) {
    for (let x = 0; x < newW; x++) {
      const sx = Math.min(src.width - 1, Math.floor((x / newW) * src.width));
      const sy = Math.min(src.height - 1, Math.floor((y / newH) * src.height));
      const si = (sy * src.width + sx) * 4;
      const di = (y * newW + x) * 4;
      out.data[di] = src.data[si];
      out.data[di + 1] = src.data[si + 1];
      out.data[di + 2] = src.data[si + 2];
      out.data[di + 3] = src.data[si + 3];
    }
  }
  return out;
}

export function resizeImageDataBilinear(src, newW, newH) {
  const out = new ImageData(newW, newH);
  for (let y = 0; y < newH; y++) {
    for (let x = 0; x < newW; x++) {
      const gx = ((x + 0.5) / newW) * src.width - 0.5;
      const gy = ((y + 0.5) / newH) * src.height - 0.5;
      const x0 = Math.max(0, Math.floor(gx));
      const y0 = Math.max(0, Math.floor(gy));
      const x1 = Math.min(src.width - 1, x0 + 1);
      const y1 = Math.min(src.height - 1, y0 + 1);
      const tx = gx - x0;
      const ty = gy - y0;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (const [cx, cy, w] of [
        [x0, y0, (1 - tx) * (1 - ty)],
        [x1, y0, tx * (1 - ty)],
        [x0, y1, (1 - tx) * ty],
        [x1, y1, tx * ty],
      ]) {
        const i = (cy * src.width + cx) * 4;
        r += src.data[i] * w;
        g += src.data[i + 1] * w;
        b += src.data[i + 2] * w;
        a += src.data[i + 3] * w;
      }
      const di = (y * newW + x) * 4;
      out.data[di] = Math.round(r);
      out.data[di + 1] = Math.round(g);
      out.data[di + 2] = Math.round(b);
      out.data[di + 3] = Math.round(a);
    }
  }
  return out;
}
