import { requireAdmin, jsonResponse } from '../../../membership/admin-auth.js';
import { loadDailyStatsRange } from '../../../membership/daily-stats.js';

/** GET ?days=30 → 日曲线（登录/注册/兑换用户数，账号日去重） */
export async function onRequestGet(context) {
  const gate = await requireAdmin(context);
  if (!gate.ok) return gate.response;
  const url = new URL(context.request.url);
  const days = url.searchParams.get('days') || '30';
  const result = await loadDailyStatsRange(context.env, days);
  if (!result.ok) return jsonResponse(result, 503);
  return jsonResponse(result);
}
