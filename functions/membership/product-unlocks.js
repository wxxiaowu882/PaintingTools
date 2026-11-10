/**
 * 单品永久权益（写生库等）与资源门禁盖过。
 * productId 约定：sandbox:{sandboxId} → 盖过该沙盒下 scene:* 的档位要求（≠ 整站 Pro）。
 */

export const SKETCH_PRODUCTS = {
  'sandbox:geometrysketch': {
    kind: 'sketch',
    title: '静物写生台',
    sandbox: 'geometrysketch'
  },
  'sandbox:portrait': {
    kind: 'sketch',
    title: '肖像写生台',
    sandbox: 'portrait'
  }
};

export function normalizeRedeemKind(raw) {
  const k = String(raw || '')
    .trim()
    .toLowerCase();
  if (k === 'sketch' || k === 'course' || k === 'pro') return k;
  return 'pro';
}

export function normalizeProductUnlocks(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    const productId = String(
      (item && typeof item === 'object' ? item.productId : item) || ''
    )
      .trim()
      .toLowerCase();
    if (!productId || seen.has(productId)) continue;
    seen.add(productId);
    const known = SKETCH_PRODUCTS[productId];
    out.push({
      productId,
      title: String((item && item.title) || (known && known.title) || productId)
        .trim()
        .slice(0, 80),
      grantedAt: Number((item && item.grantedAt) || 0) || Date.now(),
      source: String((item && item.source) || 'redeem').trim().slice(0, 40)
    });
  }
  return out;
}

export function accountHasProductUnlock(acctOrList, productId) {
  const id = String(productId || '')
    .trim()
    .toLowerCase();
  if (!id) return false;
  const list = Array.isArray(acctOrList)
    ? normalizeProductUnlocks(acctOrList)
    : normalizeProductUnlocks(acctOrList && acctOrList.productUnlocks);
  return list.some((p) => p.productId === id);
}

export function productIdForSandbox(sandbox) {
  const sb = String(sandbox || '')
    .trim()
    .toLowerCase();
  if (!sb) return null;
  return 'sandbox:' + sb;
}

/** 单品是否盖过该资源（仅 scene:{sandbox}:…） */
export function unlockCoversResource(unlocks, resourceId) {
  const rid = String(resourceId || '');
  const m = /^scene:([a-z0-9_-]+):/i.exec(rid);
  if (!m) return false;
  const want = 'sandbox:' + String(m[1] || '').toLowerCase();
  return normalizeProductUnlocks(unlocks).some((p) => p.productId === want);
}

export function sketchProductLabel(productId) {
  const id = String(productId || '')
    .trim()
    .toLowerCase();
  const known = SKETCH_PRODUCTS[id];
  return (known && known.title) || id;
}
