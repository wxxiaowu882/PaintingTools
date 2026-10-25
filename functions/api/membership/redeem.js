import {
  resolveRedeemCode,
  buildEntitlementFromGrant,
  bindShortCodeToAccount
} from '../../membership/codes.js';
import { applyEntitlementToAccount, loadAccount } from '../../membership/accounts.js';
import { tryRewardReferrer } from '../../membership/referral.js';
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

  // 须先登录会员账号，权益写入账号以便多设备共享
  const current = await readEntitlementFromRequest(context.request, context.env);
  const accountId = current.accountId || null;
  const deviceId = (body && body.deviceId) || current.deviceId || null;

  if (!accountId) {
    return jsonResponse({ ok: false, error: '请先注册或登录会员账号再兑换' }, 401);
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
