import { registerAccount } from '../../../membership/accounts.js';
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
  const result = await registerAccount(context.env, body);
  if (!result.ok) return jsonResponse({ ok: false, error: result.error }, 400);

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
