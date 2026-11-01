import { noteDailyActive } from '../../../membership/accounts.js';
import {
  readEntitlementFromRequest,
  jsonResponse,
  accessLevel
} from '../../../membership/session.js';

/**
 * POST：已登录用户日活上报（挂登录态打开网站）。
 * 服务端按账号×北京日去重；客户端应用 localStorage 跳过同日二次请求。
 */
export async function onRequestPost(context) {
  const ent = await readEntitlementFromRequest(context.request, context.env);
  const level = accessLevel(ent);
  if (!ent.accountId || (level !== 'user' && level !== 'member')) {
    return jsonResponse({ ok: false, error: '请先登录会员账号', needAccount: true }, 401);
  }
  let body = {};
  try {
    body = await context.request.json();
  } catch (_e) {}
  const result = await noteDailyActive(context.env, ent.accountId, {
    deviceId: (body && body.deviceId) || ent.deviceId || '',
    deviceLabel: (body && body.deviceLabel) || ''
  });
  if (!result.ok) return jsonResponse(result, 400);
  return jsonResponse({
    ok: true,
    counted: !!result.counted,
    tip: result.counted ? '已记今日活跃' : '今日已记过'
  });
}
