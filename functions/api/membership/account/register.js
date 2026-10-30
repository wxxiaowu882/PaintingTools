import { registerAccount } from '../../../membership/accounts.js';
import { bindReferralOnce } from '../../../membership/referral.js';
import {
  assertRateLimit,
  clientIp,
  rateLimitHeaders
} from '../../../membership/rate-limit.js';
import {
  buildSessionCookie,
  jsonResponse,
  normalizeEntitlement
} from '../../../membership/session.js';

/** 同 IP 每小时最多 8 次注册尝试（含失败） */
const WIN = 60 * 60;
const LIM_IP = 8;

export async function onRequestPost(context) {
  let body;
  try {
    body = await context.request.json();
  } catch (_e) {
    return jsonResponse({ ok: false, error: '请求无效' }, 400);
  }

  const ip = clientIp(context.request);
  const gate = await assertRateLimit(context.env, 'register:ip:' + ip, LIM_IP, WIN);
  if (!gate.ok) {
    return jsonResponse({ ok: false, error: gate.error }, 429, rateLimitHeaders(gate));
  }

  const result = await registerAccount(context.env, body);
  if (!result.ok) return jsonResponse({ ok: false, error: result.error }, 400);

  // 宣传链接归因（只绑一次；失败不影响注册）
  try {
    if (body && body.ref) {
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
