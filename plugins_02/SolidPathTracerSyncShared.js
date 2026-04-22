export function createSolidPathTracerSyncController(opts = {}) {
  let rasterPreviewUntil = 0;
  const state = {
    minIntervalMs: Math.max(16, Number(opts.minIntervalMs || 120)),
    debug: !!opts.debug,
    lastAt: 0,
    pending: false,
    reason: '',
    force: false,
  };
  const nowFn = (typeof opts.now === 'function')
    ? opts.now
    : () => ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now());
  const forceReasons = new Set(Array.isArray(opts.forceReasons) && opts.forceReasons.length
    ? opts.forceReasons
    : ['light_moved', 'scene_loaded', 'change_mat']);

  function queueReset(reason) {
    const r = String(reason || '');
    state.pending = true;
    state.reason = r || state.reason || 'unspecified';
    if (forceReasons.has(r)) state.force = true;
  }

  function tryReset(pathTracer) {
    if (!pathTracer || !state.pending) return false;
    const now = nowFn();
    if (!state.force && (now - state.lastAt) < state.minIntervalMs) return false;
    try {
      pathTracer.reset();
    } catch (_e) {
      return false;
    }
    state.lastAt = now;
    state.pending = false;
    state.force = false;
    try { if (typeof opts.onAfterReset === 'function') opts.onAfterReset({ now, reason: state.reason, samples: Number(pathTracer.samples || 0) }); } catch (_e2) {}
    if (state.debug && typeof opts.log === 'function') {
      try { opts.log('[PTReset] reason=' + (state.reason || 'unknown') + ' samples=' + Number(pathTracer.samples || 0)); } catch (_e3) {}
    }
    state.reason = '';
    return true;
  }

  function hasPending() {
    // Anti-regression: pending=true 时外部渲染循环必须阻断继续累计，避免样本污染与黑块回归。
    return !!state.pending;
  }

  function beginRasterPreviewBridge(ms) {
    const dur = Math.max(0, Number(ms || 0));
    rasterPreviewUntil = nowFn() + dur;
    try { if (typeof opts.setRasterPreviewUntil === 'function') opts.setRasterPreviewUntil(rasterPreviewUntil); } catch (_e) {}
  }

  function isInRasterPreviewBridge(now) {
    const t = Number.isFinite(Number(now)) ? Number(now) : nowFn();
    return rasterPreviewUntil > 0 && t < rasterPreviewUntil;
  }

  function markPathTracerDirty(ctx = {}) {
    try { if (typeof ctx.setNeedsUpdate === 'function') ctx.setNeedsUpdate(true); } catch (_e0) {}
    try { if (typeof ctx.setLightMoved === 'function') ctx.setLightMoved(true); } catch (_e1) {}
    let hasPathTracer = false;
    try { hasPathTracer = !!(typeof ctx.hasPathTracer === 'function' ? ctx.hasPathTracer() : ctx.pathTracer); } catch (_e2) { hasPathTracer = false; }
    if (hasPathTracer) queueReset(ctx.reason || 'mark_needs_update');
  }

  function enterAdvancedRenderSequence(ctx = {}) {
    const bridgeMs = Number(ctx.bridgeMs || 260);
    beginRasterPreviewBridge(bridgeMs);
    try { if (typeof ctx.beforeEnter === 'function') ctx.beforeEnter(); } catch (_e0) {}
    try { if (typeof ctx.buildEnvironment === 'function') ctx.buildEnvironment(); } catch (_e1) {}
    let ok = true;
    try { ok = (typeof ctx.ensurePathTracer === 'function') ? !!ctx.ensurePathTracer() : true; } catch (_e2) { ok = false; }
    if (!ok) {
      try { if (typeof ctx.onEnsureFailed === 'function') ctx.onEnsureFailed(); } catch (_e3) {}
      return false;
    }
    let pt = null;
    try { pt = (typeof ctx.getPathTracer === 'function') ? ctx.getPathTracer() : null; } catch (_e4) { pt = null; }
    if (pt) {
      queueReset(ctx.resetReason || 'light_moved');
      tryReset(pt);
      try { if (typeof ctx.onPathTracerReady === 'function') ctx.onPathTracerReady(pt); } catch (_e5) {}
    }
    return true;
  }

  return {
    queueReset,
    tryReset,
    hasPending,
    beginRasterPreviewBridge,
    isInRasterPreviewBridge,
    markPathTracerDirty,
    enterAdvancedRenderSequence,
  };
}
