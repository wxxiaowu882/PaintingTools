/**
 * Solid shared shader-compile pipeline.
 * Goals:
 * - One stable `onBeforeCompile` tail per material (avoid re-arm fights).
 * - Deterministic patch order (stable shader source + cache key).
 * - Stable `customProgramCacheKey` that depends only on patch variants/revisions.
 */
export function solidInstallOnBeforeCompilePatch(material, patch) {
  if (!material || !patch || !patch.id || typeof patch.apply !== 'function') return false;
  if (!material.userData) material.userData = {};
  const ud = material.userData;
  if (!ud._solidCompile) ud._solidCompile = {};
  const st = ud._solidCompile;

  if (!st.patches) st.patches = new Map();
  if (!st.patchOrder) st.patchOrder = [];

  const id = String(patch.id);
  const prev = st.patches.get(id);
  const ver = (patch.ver != null) ? String(patch.ver) : '1';
  const variant = (patch.variant != null) ? String(patch.variant) : '';
  const prevVer = prev ? String(prev.ver) : '';
  const prevVariant = prev ? String(prev.variant || '') : '';
  const patchChanged = (!prev) || prevVer !== ver || prevVariant !== variant;
  st.patches.set(id, { id, ver, variant, apply: patch.apply });
  if (!prev) {
    st.patchOrder.push(id);
    st.patchOrder.sort();
  }

  // Capture current chain head (may be overwritten by other systems later).
  // We will always call whatever is currently assigned as the "external head"
  // BEFORE applying Solid patches, but keep our wrapper stable.
  const current = (typeof material.onBeforeCompile === 'function') ? material.onBeforeCompile : null;
  if (!st.externalHead || st.externalHead !== current) st.externalHead = current;
  const hadWrapper = material.onBeforeCompile === st.wrapper;

  if (!st.wrapper) {
    st.wrapper = function (shader) {
      try {
        const ex = (ud && ud._solidCompile) ? ud._solidCompile.externalHead : null;
        if (typeof ex === 'function') ex(shader);
      } catch (_e) {}
      try {
        const s = (ud && ud._solidCompile) ? ud._solidCompile : null;
        if (!s || !s.patches || !s.patchOrder) return;
        for (let i = 0; i < s.patchOrder.length; i++) {
          const pid = s.patchOrder[i];
          const p = s.patches.get(pid);
          if (p && typeof p.apply === 'function') {
            try { p.apply(shader); } catch (_e2) {}
          }
        }
      } catch (_e3) {}
    };
  }
  material.onBeforeCompile = st.wrapper;
  const wrapperChanged = !hadWrapper && material.onBeforeCompile === st.wrapper;

  // Stable program cache key: only depends on registered patch ids + versions + variants.
  const prevKey = (typeof st.origCacheKey === 'function')
    ? st.origCacheKey
    : (typeof material.customProgramCacheKey === 'function' ? material.customProgramCacheKey : null);
  if (typeof st.origCacheKey !== 'function' && typeof material.customProgramCacheKey === 'function') {
    st.origCacheKey = material.customProgramCacheKey;
  }
  const prevPatchSignature = st.patchSignature || '';
  material.customProgramCacheKey = function () {
    const base = (typeof prevKey === 'function') ? String(prevKey.call(this)) : '';
    try {
      const s = (ud && ud._solidCompile) ? ud._solidCompile : null;
      if (!s || !s.patches || !s.patchOrder) return base + '_solidC0';
      let k = '';
      for (let i = 0; i < s.patchOrder.length; i++) {
        const pid = s.patchOrder[i];
        const p = s.patches.get(pid);
        if (!p) continue;
        k += pid + 'v' + p.ver + (p.variant ? ('_' + p.variant) : '') + ';';
      }
      return base + '_solidC1_' + k;
    } catch (_e) {
      return base + '_solidC0';
    }
  };
  let nextPatchSignature = '';
  try {
    const s = (ud && ud._solidCompile) ? ud._solidCompile : null;
    if (s && s.patches && s.patchOrder) {
      for (let i = 0; i < s.patchOrder.length; i++) {
        const pid = s.patchOrder[i];
        const p = s.patches.get(pid);
        if (!p) continue;
        nextPatchSignature += pid + 'v' + p.ver + (p.variant ? ('_' + p.variant) : '') + ';';
      }
    }
  } catch (_e) {}
  st.patchSignature = nextPatchSignature;

  if (patchChanged || wrapperChanged || prevPatchSignature !== nextPatchSignature) {
    try { material.needsUpdate = true; } catch (_e) {}
  }
  return true;
}

export function solidSyncOnBeforeCompileExternalHead(material) {
  if (!material || !material.userData) return false;
  const ud = material.userData;
  const st = ud._solidCompile;
  if (!st) return false;
  const current = (typeof material.onBeforeCompile === 'function') ? material.onBeforeCompile : null;
  // If someone overwrote our wrapper, reattach it but keep their fn as external head.
  if (st.wrapper && current !== st.wrapper) {
    st.externalHead = current;
    material.onBeforeCompile = st.wrapper;
    try { material.needsUpdate = true; } catch (_e) {}
    return true;
  }
  return false;
}

