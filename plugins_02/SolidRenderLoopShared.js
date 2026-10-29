export function solidIsInRasterPreviewBridge(ptSync, now) {
  if (!ptSync || typeof ptSync.isInRasterPreviewBridge !== 'function') return false;
  return !!ptSync.isInRasterPreviewBridge(now);
}

export function solidShouldBlockSamplingWhenPending(ptSync) {
  if (!ptSync || typeof ptSync.hasPending !== 'function') return false;
  return !!ptSync.hasPending();
}

export function solidShouldContinueSampling(currentSamples, targetSamples) {
  const current = Number(currentSamples || 0);
  const target = Number(targetSamples || 0);
  if (!Number.isFinite(current) || !Number.isFinite(target)) return false;
  return current < target;
}

export function solidShouldAutoStopRender(opts = {}) {
  if (!opts || opts.enabled !== true) return false;
  const threshold = Number(opts.autoStopSamples || 0);
  if (!Number.isFinite(threshold) || threshold <= 0) return false;
  const samples = Number(opts.samples || 0);
  if (!Number.isFinite(samples)) return false;
  return samples >= threshold;
}

/** 是否应做一次「采样在涨但画布近黑」探针（纯门控，无 GL 副作用）。 */
export function solidShouldProbeBlankOutput(opts = {}) {
  if (!opts || opts.enabled !== true) return false;
  if (opts.disabled === true) return false;
  if (opts.alreadyFailed === true) return false;
  if (opts.useAdvancedRender !== true) return false;
  if (opts.isLoadingScene === true) return false;
  if (opts.documentHidden === true) return false;
  if (opts.pageUnloading === true) return false;
  if (opts.orbitInteracting === true) return false;
  if (opts.contextLost === true) return false;
  const samples = Number(opts.samples || 0);
  const minSamples = Number(opts.minSamples || 8);
  if (!Number.isFinite(samples) || !Number.isFinite(minSamples) || samples < minSamples) return false;
  const now = Number(opts.now || 0);
  const lastResetAt = Number(opts.lastResetAt || 0);
  const minMs = Number(opts.minMs || 1500);
  if (!Number.isFinite(now) || !Number.isFinite(lastResetAt) || lastResetAt <= 0) return false;
  if ((now - lastResetAt) < minMs) return false;
  const lastProbeAt = Number(opts.lastProbeAt || 0);
  const intervalMs = Number(opts.intervalMs || 600);
  if (Number.isFinite(lastProbeAt) && lastProbeAt > 0 && Number.isFinite(intervalMs) && (now - lastProbeAt) < intervalMs) return false;
  return true;
}

/** 单点是否近黑（UNSIGNED_BYTE RGBA）。 */
export function solidIsNearBlackRgba(r, g, b, lumaMax = 10) {
  const lim = Number(lumaMax);
  const maxC = Math.max(Number(r) || 0, Number(g) || 0, Number(b) || 0);
  return Number.isFinite(lim) && maxC <= lim;
}

/**
 * 根据多点 RGBA 样本判定是否「整屏近黑」。
 * samples: [{r,g,b}...] 或扁平 Uint8Array（每 4 字节一点）。
 */
export function solidIsNearBlackSampleSet(samples, opts = {}) {
  const lumaMax = Number(opts.lumaMax != null ? opts.lumaMax : 10);
  const minNear = Number(opts.minNearBlackPoints != null ? opts.minNearBlackPoints : 4);
  let list = [];
  if (samples && typeof samples.length === 'number' && samples.length && typeof samples[0] === 'object' && samples[0] != null && 'r' in samples[0]) {
    list = Array.from(samples);
  } else if (samples && typeof samples.length === 'number' && samples.length >= 4) {
    for (let i = 0; i + 3 < samples.length; i += 4) {
      list.push({ r: samples[i], g: samples[i + 1], b: samples[i + 2] });
    }
  }
  if (!list.length) return false;
  let near = 0;
  for (let i = 0; i < list.length; i++) {
    const p = list[i] || {};
    if (solidIsNearBlackRgba(p.r, p.g, p.b, lumaMax)) near++;
  }
  const need = Number.isFinite(minNear) ? Math.min(minNear, list.length) : list.length;
  return near >= need;
}

/** 中心 + 四角内缩的 5 个画布采样点（CSS/backing 像素坐标系，原点左下时由调用方换算）。 */
export function solidBlankOutputProbePoints(width, height, inset = 0.18) {
  const w = Math.max(1, Math.floor(Number(width) || 1));
  const h = Math.max(1, Math.floor(Number(height) || 1));
  let t = Number(inset);
  if (!Number.isFinite(t)) t = 0.18;
  t = Math.max(0.05, Math.min(0.4, t));
  const x0 = Math.max(0, Math.min(w - 1, Math.floor(w * t)));
  const x1 = Math.max(0, Math.min(w - 1, Math.floor(w * (1 - t))));
  const y0 = Math.max(0, Math.min(h - 1, Math.floor(h * t)));
  const y1 = Math.max(0, Math.min(h - 1, Math.floor(h * (1 - t))));
  const cx = Math.max(0, Math.min(w - 1, Math.floor(w * 0.5)));
  const cy = Math.max(0, Math.min(h - 1, Math.floor(h * 0.5)));
  return [
    { x: cx, y: cy },
    { x: x0, y: y0 },
    { x: x1, y: y0 },
    { x: x0, y: y1 },
    { x: x1, y: y1 },
  ];
}
