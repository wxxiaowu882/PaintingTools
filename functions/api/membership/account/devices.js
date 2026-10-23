import { loadAccount, removeDevice, publicAccount } from '../../../membership/accounts.js';
import {
  readEntitlementFromRequest,
  buildSessionCookie,
  jsonResponse,
  normalizeEntitlement
} from '../../../membership/session.js';

export async function onRequestGet(context) {
  const ent = await readEntitlementFromRequest(context.request, context.env);
  if (!ent.accountId) {
    return jsonResponse({ ok: false, error: '请先登录账号', needAccount: true }, 401);
  }
  const acct = await loadAccount(context.env, ent.accountId);
  if (!acct) return jsonResponse({ ok: false, error: '账号不存在' }, 404);
  return jsonResponse({ ok: true, account: publicAccount(acct) });
}

export async function onRequestDelete(context) {
  const ent = await readEntitlementFromRequest(context.request, context.env);
  if (!ent.accountId) {
    return jsonResponse({ ok: false, error: '请先登录账号', needAccount: true }, 401);
  }
  let body = {};
  try {
    body = await context.request.json();
  } catch (_e) {}
  const deviceId = String((body && body.deviceId) || '').trim();
  if (!deviceId) return jsonResponse({ ok: false, error: '缺少 deviceId' }, 400);

  const result = await removeDevice(context.env, ent.accountId, deviceId);
  if (!result.ok) return jsonResponse({ ok: false, error: result.error }, 400);

  // 若踢的是当前设备，降级 Cookie
  let nextEnt = normalizeEntitlement(
    Object.assign({}, result.account.entitlement || {}, {
      accountId: result.account.accountId,
      deviceId: ent.deviceId
    })
  );
  if (deviceId === ent.deviceId) {
    nextEnt = normalizeEntitlement({
      tierId: 'free',
      level: 'free',
      source: 'device_removed',
      accountId: result.account.accountId
    });
  }
  const cookie = await buildSessionCookie(nextEnt, context.env, context.request);
  return jsonResponse({ ok: true, account: result.account, entitlement: nextEnt }, 200, {
    'Set-Cookie': cookie
  });
}
