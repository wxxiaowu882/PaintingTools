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

/**
 * 首帧采样 / 着色器编译双保险丝（纯判定，无副作用）。
 * - hold_compiling：编译中，短超时不计；调用方应记下 compileSince
 * - restart_sample_clock：刚离开编译，调用方应把 lastResetAt 拨到 now
 * - fail_compile_timeout / fail_sample_timeout / fail_first_attempt_timeout：应降级回光栅
 * - firstAttemptMode：本页尚未证明能追光时，只用很长总上限（主要靠用户放弃）
 */
export function solidEvalFirstSampleWatchdog(opts = {}) {
  const samples = Number(opts.samples || 0);
  if (!Number.isFinite(samples) || samples > 0) {
    return { action: 'none', clearCompileTracking: true };
  }
  if (opts.disabled === true || opts.isLoadingScene === true) {
    return { action: 'none' };
  }
  const now = Number(opts.now || 0);
  const lastResetAt = Number(opts.lastResetAt || 0);
  if (!Number.isFinite(now) || !Number.isFinite(lastResetAt) || lastResetAt <= 0) {
    return { action: 'none' };
  }

  const compiling = !!opts.isCompiling;
  const compileSinceRaw = Number(opts.compileSince || 0);
  const wasCompiling = !!opts.wasCompiling;
  const firstAttemptMode = !!opts.firstAttemptMode;
  const attemptSinceRaw = Number(opts.attemptSince || 0);
  const attemptSince = (Number.isFinite(attemptSinceRaw) && attemptSinceRaw > 0) ? attemptSinceRaw : lastResetAt;
  const firstLimit = Number(opts.firstAttemptTimeoutMs || 180000);

  if (firstAttemptMode) {
    if (compiling) {
      const compileSince = (Number.isFinite(compileSinceRaw) && compileSinceRaw > 0) ? compileSinceRaw : now;
      if (Number.isFinite(firstLimit) && firstLimit > 0 && (now - attemptSince) > firstLimit) {
        return { action: 'fail_first_attempt_timeout', compileSince };
      }
      return { action: 'hold_compiling', compileSince, markWasCompiling: true };
    }
    if (wasCompiling) {
      return { action: 'restart_sample_clock', clearCompileTracking: true };
    }
    if (Number.isFinite(firstLimit) && firstLimit > 0 && (now - attemptSince) > firstLimit) {
      return { action: 'fail_first_attempt_timeout' };
    }
    return { action: 'none' };
  }

  if (compiling) {
    const compileSince = (Number.isFinite(compileSinceRaw) && compileSinceRaw > 0) ? compileSinceRaw : now;
    const compileLimit = Number(opts.compileTimeoutMs || 60000);
    if (Number.isFinite(compileLimit) && compileLimit > 0 && (now - compileSince) > compileLimit) {
      return { action: 'fail_compile_timeout', compileSince };
    }
    return { action: 'hold_compiling', compileSince, markWasCompiling: true };
  }

  if (wasCompiling) {
    return { action: 'restart_sample_clock', clearCompileTracking: true };
  }

  const sampleLimit = Number(opts.sampleTimeoutMs || 12000);
  if (Number.isFinite(sampleLimit) && sampleLimit > 0 && (now - lastResetAt) > sampleLimit) {
    return { action: 'fail_sample_timeout' };
  }
  return { action: 'none' };
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
 * 根据多点 RGBA 样本判定是否「内容区近黑 / 假进度」。
 * samples: [{r,g,b}...] 或扁平 Uint8Array（每 4 字节一点）。
 *
 * 不要用「四角黑」当证据（聚光灯场景四角本就黑）。
 * 点应采自画面中部（见 solidBlankOutputProbePoints interiorGrid）；
 * 多数点近黑才算（单点碰巧踩进阴影不够格）。
 */
export function solidIsNearBlackSampleSet(samples, opts = {}) {
  const lumaMax = Number(opts.lumaMax != null ? opts.lumaMax : 10);
  const minNear = Number(opts.minNearBlackPoints != null ? opts.minNearBlackPoints : 9);
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

/**
 * 空输出探针采样点。
 * - 默认 / opts.mode==='interiorGrid'：画面中部 N×N 网格（躲开四角黑底）
 * - opts.mode==='corners' 或传入数字 inset：旧版「中心+四角」（易误判，仅兼容）
 * 坐标：backing 像素；WebGL 默认 FBO 原点左下，由调用方按此理解。
 */
export function solidBlankOutputProbePoints(width, height, insetOrOpts = 0.28) {
  const w = Math.max(1, Math.floor(Number(width) || 1));
  const h = Math.max(1, Math.floor(Number(height) || 1));
  let opts = insetOrOpts;
  if (opts == null || typeof opts === 'number') {
    opts = { mode: 'interiorGrid', interiorMargin: opts != null ? opts : 0.28 };
  }
  const mode = opts.mode === 'corners' ? 'corners' : 'interiorGrid';

  if (mode === 'corners') {
    let t = Number(opts.pointInset != null ? opts.pointInset : 0.18);
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

  let margin = Number(opts.interiorMargin != null ? opts.interiorMargin : 0.28);
  if (!Number.isFinite(margin)) margin = 0.28;
  margin = Math.max(0.15, Math.min(0.4, margin));
  let n = Math.floor(Number(opts.gridSize != null ? opts.gridSize : 3));
  if (!Number.isFinite(n)) n = 3;
  n = Math.max(2, Math.min(5, n));
  const pts = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const u = n === 1 ? 0.5 : margin + (1 - 2 * margin) * (i / (n - 1));
      const v = n === 1 ? 0.5 : margin + (1 - 2 * margin) * (j / (n - 1));
      pts.push({
        x: Math.max(0, Math.min(w - 1, Math.floor(w * u))),
        y: Math.max(0, Math.min(h - 1, Math.floor(h * v))),
      });
    }
  }
  return pts;
}
