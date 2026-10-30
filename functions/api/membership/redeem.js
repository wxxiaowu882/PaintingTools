import {
  resolveRedeemCode,
  buildEntitlementFromGrant,
  bindShortCodeToAccount
} from '../../membership/codes.js';
import { applyEntitlementToAccount, loadAccount } from '../../membership/accounts.js';
import { tryRewardReferrer } from '../../membership/referral.js';
import {
  assertRateLimit,
  clientIp,
  rateLimitHeaders
} from '../../membership/rate-limit.js';
import {
  buildSessionCookie,
  jsonResponse,
  normalizeEntitlement,
  readEntitlementFromRequest
} from '../../membership/session.js';

/** 同 IP 15 分钟 20 次；已登录账号再限 15 次（防猜码） */
const WIN = 15 * 60;
const LIM_IP = 20;
const LIM_ACCT = 15;

export async function onRequestPost(context) {
  let body;
  try {
    body = await context.request.json();
  } catch (_e) {
    return jsonResponse({ ok: false, error: '请求格式无效' }, 400);
  }

  const ip = clientIp(context.request);
  const gateIp = await assertRateLimit(context.env, 'redeem:ip:' + ip, LIM_IP, WIN);
  if (!gateIp.ok) {
    return jsonResponse({ ok: false, error: gateIp.error }, 429, rateLimitHeaders(gateIp));
  }

  // 先校验码（含探针开关），再要求登录——避免「假码已关」被登录提示盖住
  const resolved = await resolveRedeemCode(body && body.code, context.env);
  if (!resolved.ok) return jsonResponse({ ok: false, error: resolved.error }, 400);

  let entitlement = normalizeEntitlement(buildEntitlementFromGrant(resolved.grant));

  const current = await readEntitlementFromRequest(context.request, context.env);
  const accountId = current.accountId || null;
  const deviceId = (body && body.deviceId) || current.deviceId || null;

  if (!accountId) {
    return jsonResponse({ ok: false, error: '请先注册或登录会员账号再兑换' }, 401);
  }

  const gateAcct = await assertRateLimit(
    context.env,
    'redeem:acct:' + accountId,
    LIM_ACCT,
    WIN
  );
  if (!gateAcct.ok) {
    return jsonResponse({ ok: false, error: gateAcct.error }, 429, rateLimitHeaders(gateAcct));
  }

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

  // 补记码↔账号（短码；失败不影响学员已开通）
  try {
    const codeHint = entitlement.redeemCode || (body && body.code) || '';
    if (codeHint && entitlement.source === 'short_code') {
      const acct = applied.account || (await loadAccount(context.env, accountId));
      await bindShortCodeToAccount(context.env, codeHint, {
        accountId,
        phone: acct && acct.phone
      });
    }
  } catch (_eBind) {}

  // 宣传链接：被带人首次兑高级 → 给推荐人叠天（失败不影响已兑）
  let referralTip = null;
  try {
    const reward = await tryRewardReferrer(context.env, accountId, deviceId);
    if (reward && reward.rewarded && reward.tip) referralTip = reward.tip;
  } catch (_eRef) {}

  const cookie = await buildSessionCookie(entitlement, context.env, context.request);
  const tipParts = ['已开通并同步到你的账号，其它已登录设备刷新后可用'];
  if (referralTip) tipParts.push(referralTip);
  return jsonResponse(
    {
      ok: true,
      entitlement,
      boundToAccount: true,
      tip: tipParts.join('。')
    },
    200,
    { 'Set-Cookie': cookie }
  );
}
