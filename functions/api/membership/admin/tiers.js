import { requireAdmin, jsonResponse } from '../../../membership/admin-auth.js';
import { loadTiers, saveTiersLive } from '../../../membership/policy.js';

export async function onRequestGet(context) {
  const gate = await requireAdmin(context);
  if (!gate.ok) return gate.response;
  return jsonResponse({ ok: true, tiers: await loadTiers(context) });
}

export async function onRequestPut(context) {
  const gate = await requireAdmin(context);
  if (!gate.ok) return gate.response;
  let body;
  try {
    body = await context.request.json();
  } catch (_e) {
    return jsonResponse({ ok: false, error: '请求无效' }, 400);
  }
  const tiers = body.tiers;
  if (!tiers || typeof tiers !== 'object' || !Array.isArray(tiers.tiers)) {
    return jsonResponse({ ok: false, error: '价格配置格式不对' }, 400);
  }
  const saved = await saveTiersLive(context, tiers);
  if (!saved.ok) return jsonResponse(saved, 503);
  return jsonResponse({ ok: true, tiers: await loadTiers(context) });
}
