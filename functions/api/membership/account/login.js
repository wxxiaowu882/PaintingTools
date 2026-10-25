import { loginAccount } from '../../../membership/accounts.js';
import { bindReferralOnce } from '../../../membership/referral.js';
import {
  buildSessionCookie,
  jsonResponse,
  normalizeEntitlement
} from '../../../membership/session.js';

export async function onRequestPost(context) {
  let body;
  try {
    body = await context.request.json();
  } catch (_e) {
    return jsonResponse({ ok: false, error: '请求无效' }, 400);
  }
  const result = await loginAccount(context.env, body);
  if (!result.ok) return jsonResponse({ ok: false, error: result.error }, 400);

  // 尚无归因时可用 ref 补绑一次（已绑不改）
  try {
    if (body && body.ref && result.account && result.account.accountId) {
      await bindReferralOnce(context.env, result.account.accountId, body.ref, {
        deviceId: body.deviceId || null
      });
    }
  } catch (_eRef) {}

  const ent = normalizeEntitlement(
    Object.assign({}, result.account.entitlement || {}, {
      accountId: result.account.accountId,
      deviceId: body.deviceId || null
    })
  );
  const cookie = await buildSessionCookie(ent, context.env, context.request);
  return jsonResponse(
    {
      ok: true,
      account: result.account,
      entitlement: ent,
      kickedDeviceId: result.kickedDeviceId || null,
      tip: result.kickedDeviceId ? '已超过 3 台设备，已自动退出最早一台' : null
    },
    200,
    { 'Set-Cookie': cookie }
  );
}
