import { loginAccount, normalizePhone } from '../../../membership/accounts.js';
import { bindReferralOnce } from '../../../membership/referral.js';
import {
  bumpRateLimit,
  clientIp,
  peekRateLimited,
  rateLimitHeaders
} from '../../../membership/rate-limit.js';
import {
  buildSessionCookie,
  jsonResponse,
  normalizeEntitlement
} from '../../../membership/session.js';

/** 失败计数：同 IP 15 分钟 20 次；同手机号 15 分钟 10 次 */
const WIN = 15 * 60;
const LIM_IP = 20;
const LIM_PHONE = 10;

export async function onRequestPost(context) {
  let body;
  try {
    body = await context.request.json();
  } catch (_e) {
    return jsonResponse({ ok: false, error: '请求无效' }, 400);
  }

  const ip = clientIp(context.request);
  const phone = normalizePhone(body && body.phone);
  const ipBucket = 'login:ip:' + ip;
  const phoneBucket = phone ? 'login:phone:' + phone : null;

  const gateIp = await peekRateLimited(context.env, ipBucket, LIM_IP, WIN);
  if (!gateIp.ok) {
    return jsonResponse({ ok: false, error: gateIp.error }, 429, rateLimitHeaders(gateIp));
  }
  if (phoneBucket) {
    const gatePhone = await peekRateLimited(context.env, phoneBucket, LIM_PHONE, WIN);
    if (!gatePhone.ok) {
      return jsonResponse({ ok: false, error: gatePhone.error }, 429, rateLimitHeaders(gatePhone));
    }
  }

  const result = await loginAccount(context.env, body);
  if (!result.ok) {
    await bumpRateLimit(context.env, ipBucket, LIM_IP, WIN);
    if (phoneBucket) await bumpRateLimit(context.env, phoneBucket, LIM_PHONE, WIN);
    return jsonResponse({ ok: false, error: result.error }, 400);
  }

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
