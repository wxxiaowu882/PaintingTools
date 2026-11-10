import {
  resolveRedeemCode,
  buildEntitlementFromGrant,
  bindShortCodeToAccount,
  consumeShortRedeemCode,
  consumeSignedRedeemJti
} from '../../membership/codes.js';
import {
  applyEntitlementToAccount,
  applyCourseRedeemToAccount,
  applyProductUnlockToAccount,
  loadAccount,
  normalizeCoursePacks,
  normalizeProductUnlocks
} from '../../membership/accounts.js';
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
  readEntitlementFromRequest,
  accessLevel
} from '../../membership/session.js';
import { normalizeRedeemKind, sketchProductLabel } from '../../membership/product-unlocks.js';

/** 同 IP 15 分钟 20 次；已登录账号再限 15 次（防猜码） */
const WIN = 15 * 60;
const LIM_IP = 20;
const LIM_ACCT = 15;

async function bindCodeQuiet(env, grant, accountId) {
  try {
    const codeHint = (grant && grant.redeemCode) || '';
    if (codeHint && grant && grant.source === 'short_code') {
      const acct = await loadAccount(env, accountId);
      await bindShortCodeToAccount(env, codeHint, {
        accountId,
        phone: acct && acct.phone
      });
    }
  } catch (_eBind) {}
}

function sessionFromAccount(acct, accountId, deviceId) {
  return normalizeEntitlement(
    Object.assign({}, (acct && acct.entitlement) || {}, {
      accountId,
      deviceId: deviceId || null
    })
  );
}

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

  // 先只读验码（不核销），再要求登录，最后再核销——避免未登录把真码烧掉
  const resolved = await resolveRedeemCode(body && body.code, context.env, {
    consume: false
  });
  if (!resolved.ok) return jsonResponse({ ok: false, error: resolved.error }, 400);

  let grant = resolved.grant || {};
  const kind = normalizeRedeemKind(grant.kind);

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

  if (grant.source === 'short_code') {
    const consumed = await consumeShortRedeemCode(context.env, grant.redeemCode || body.code);
    if (!consumed.ok) {
      return jsonResponse({ ok: false, error: consumed.error }, 400);
    }
    grant = consumed.grant || grant;
  } else if (grant.source === 'signed_code' && grant.jti) {
    const used = await consumeSignedRedeemJti(context.env, grant.jti);
    if (!used.ok) {
      return jsonResponse({ ok: false, error: used.error }, 400);
    }
  }

  let entitlement;
  let tip = '';
  let alreadyOwned = false;
  let accountPublic = null;
  let referralTip = null;

  if (kind === 'sketch') {
    const applied = await applyProductUnlockToAccount(context.env, accountId, {
      productId: grant.productId,
      productName: grant.productName,
      deviceId
    });
    if (!applied.ok) {
      return jsonResponse({ ok: false, error: applied.error }, 400);
    }
    alreadyOwned = !!applied.alreadyOwned;
    accountPublic = applied.account;
    entitlement = sessionFromAccount(applied.account, accountId, deviceId);
    const label = applied.productTitle || sketchProductLabel(grant.productId);
    tip = alreadyOwned
      ? '您已拥有「' + label + '」，无需重复开通'
      : '已开通「' + label + '」（永久），其它已登录设备刷新后可用';
    await bindCodeQuiet(context.env, grant, accountId);
  } else if (kind === 'course') {
    const applied = await applyCourseRedeemToAccount(context.env, accountId, {
      packId: grant.packId,
      packTitle: grant.packTitle,
      redeemCode: grant.redeemCode,
      deviceId
    });
    if (!applied.ok) {
      return jsonResponse({ ok: false, error: applied.error }, 400);
    }
    alreadyOwned = !!applied.alreadyOwned;
    accountPublic = applied.account;
    entitlement = sessionFromAccount(applied.account, accountId, deviceId);
    const label = String(grant.packTitle || grant.packId || '录播课包').trim();
    tip = alreadyOwned
      ? '您已拥有「' + label + '」，无需重复开通'
      : '已开通「' + label + '」（永久）并同步三年高级会员，其它已登录设备刷新后可用';
    await bindCodeQuiet(context.env, grant, accountId);

    if (!alreadyOwned) {
      try {
        const reward = await tryRewardReferrer(context.env, accountId, deviceId);
        if (reward && reward.rewarded && reward.tip) referralTip = reward.tip;
      } catch (_eRef) {}
    }
  } else {
    // pro（默认 / 旧码）
    entitlement = normalizeEntitlement(buildEntitlementFromGrant(grant));
    const applied = await applyEntitlementToAccount(
      context.env,
      accountId,
      entitlement,
      deviceId
    );
    if (!applied.ok) {
      return jsonResponse({ ok: false, error: applied.error }, 400);
    }
    accountPublic = applied.account;
    entitlement = normalizeEntitlement(
      Object.assign({}, applied.account.entitlement || entitlement, {
        accountId,
        deviceId
      })
    );
    tip = '已开通高级会员并同步到你的账号，其它已登录设备刷新后可用';
    await bindCodeQuiet(context.env, grant, accountId);

    try {
      const reward = await tryRewardReferrer(context.env, accountId, deviceId);
      if (reward && reward.rewarded && reward.tip) referralTip = reward.tip;
    } catch (_eRef) {}
  }

  if (referralTip) tip = tip + '。' + referralTip;

  const cookie = await buildSessionCookie(entitlement, context.env, context.request);
  const packs = normalizeCoursePacks(accountPublic && accountPublic.coursePacks);
  const unlocks = normalizeProductUnlocks(accountPublic && accountPublic.productUnlocks);

  return jsonResponse(
    {
      ok: true,
      kind,
      alreadyOwned: !!alreadyOwned,
      entitlement,
      accessLevel: accessLevel(entitlement),
      coursePacks: packs,
      productUnlocks: unlocks,
      boundToAccount: true,
      tip
    },
    200,
    { 'Set-Cookie': cookie }
  );
}
