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
