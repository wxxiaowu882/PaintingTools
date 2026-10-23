import { resolveRedeemCode, buildEntitlementFromGrant } from '../../membership/codes.js';
import { applyEntitlementToAccount } from '../../membership/accounts.js';
import {
  buildSessionCookie,
  jsonResponse,
  normalizeEntitlement,
  readEntitlementFromRequest
} from '../../membership/session.js';

export async function onRequestPost(context) {
  let body;
  try {
    body = await context.request.json();
  } catch (_e) {
    return jsonResponse({ ok: false, error: '请求格式无效' }, 400);
  }

  const resolved = await resolveRedeemCode(body && body.code, context.env);
  if (!resolved.ok) return jsonResponse({ ok: false, error: resolved.error }, 400);

  let entitlement = normalizeEntitlement(buildEntitlementFromGrant(resolved.grant));

  // 已登录账号：权益写入账号，多设备共享；未登录仍允许本机 Cookie 兑码（过渡）
  const current = await readEntitlementFromRequest(context.request, context.env);
  const accountId = current.accountId || null;
  const deviceId = (body && body.deviceId) || current.deviceId || null;

  if (accountId) {
    const applied = await applyEntitlementToAccount(
      context.env,
      accountId,
      entitlement,
      deviceId
    );
    if (!applied.ok) {
      return jsonResponse({ ok: false, error: applied.error }, 400);
    }
    entitlement = normalizeEntitlement(
      Object.assign({}, applied.account.entitlement || entitlement, {
        accountId,
        deviceId
      })
    );
  } else if (deviceId) {
    entitlement.deviceId = deviceId;
  }

  const cookie = await buildSessionCookie(entitlement, context.env, context.request);
  return jsonResponse(
    {
      ok: true,
      entitlement,
      boundToAccount: !!accountId,
      tip: accountId
        ? '已开通并同步到你的账号，其它已登录设备刷新后可用'
        : '已在本浏览器开通。建议注册/登录账号，以便最多 3 台设备共用会员'
    },
    200,
    { 'Set-Cookie': cookie }
  );
}
