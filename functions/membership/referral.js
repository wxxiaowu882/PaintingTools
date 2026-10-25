/**
 * 宣传链接归因与兑高级发奖（启动期推广）
 * - 链接：/member?ref=XXXXXXXX（8 位，与 10 位兑码区分）
 * - 被带人首次兑成高级后，给推荐人叠天（默认 90，运营可配）
 */
import { loadOpsSettings } from './ops-settings.js';
import {
  loadAccount,
  saveAccountRaw,
  publicAccount,
  extendMemberByDays,
  ensureAccountFields
} from './accounts.js';

const PROMO_PREFIX = 'promo:';
const AWARD_PREFIX = 'refaward:';
/** 去掉易混 0/O/1/I */
const PROMO_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PROMO_LEN = 8;

function kv(env) {
  return env && env.MEMBERSHIP_KV ? env.MEMBERSHIP_KV : null;
}

export function normalizePromoCode(raw) {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export function isPromoCodeShape(code) {
  return !!code && code.length === PROMO_LEN && /^[A-Z0-9]+$/.test(code);
}

function monthKeyNow() {
  const d = new Date();
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
}

function randomPromoCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(PROMO_LEN));
  let s = '';
  for (let i = 0; i < PROMO_LEN; i++) {
    s += PROMO_ALPHABET[bytes[i] % PROMO_ALPHABET.length];
  }
  return s;
}

/** 解析宣传码 → 推荐人 accountId */
export async function resolvePromoCode(env, rawCode) {
  const store = kv(env);
  const code = normalizePromoCode(rawCode);
  if (!store || !isPromoCodeShape(code)) return { ok: false, error: '宣传码无效' };
  const accountId = await store.get(PROMO_PREFIX + code);
  if (!accountId) return { ok: false, error: '找不到这个宣传码' };
  return { ok: true, code, accountId: String(accountId) };
}

/**
 * 懒生成宣传码（首次 /me 或需要链接时）
 * @returns {{ ok, code?, promoUrl?, error? }}
 */
export async function ensurePromoCode(env, accountId, requestUrl) {
  const store = kv(env);
  if (!store) return { ok: false, error: '未开通存储' };
  let acct = await loadAccount(env, accountId);
  if (!acct) return { ok: false, error: '账号不存在' };
  ensureAccountFields(acct);

  if (acct.promoCode && isPromoCodeShape(acct.promoCode)) {
    return {
      ok: true,
      code: acct.promoCode,
      promoUrl: buildPromoUrl(requestUrl, acct.promoCode)
    };
  }

  let code = '';
  for (let attempt = 0; attempt < 12; attempt++) {
    const candidate = randomPromoCode();
    const existed = await store.get(PROMO_PREFIX + candidate);
    if (!existed) {
      code = candidate;
      break;
    }
  }
  if (!code) return { ok: false, error: '生成宣传码失败，请稍后重试' };

  await store.put(PROMO_PREFIX + code, acct.accountId);
  acct.promoCode = code;
  const saved = await saveAccountRaw(env, acct);
  if (!saved.ok) return saved;
  return { ok: true, code, promoUrl: buildPromoUrl(requestUrl, code) };
}

export function buildPromoUrl(requestUrl, code) {
  let origin = 'https://www.wuxiaoart.com';
  try {
    if (requestUrl) origin = new URL(requestUrl).origin;
  } catch (_e) {}
  return origin + '/member?ref=' + encodeURIComponent(code);
}

/**
 * 归因：账号尚无 referredBy 时绑定推荐人（只写一次）
 * @returns {{ ok, bound?, skipped?, error?, tip? }}
 */
export async function bindReferralOnce(env, inviteeAccountId, rawRef, opts) {
  const settings = await loadOpsSettings(env);
  if (!settings.referralEnabled) {
    return { ok: true, bound: false, skipped: 'disabled' };
  }
  const code = normalizePromoCode(rawRef);
  if (!isPromoCodeShape(code)) {
    return { ok: true, bound: false, skipped: 'no_ref' };
  }
  const resolved = await resolvePromoCode(env, code);
  if (!resolved.ok) return { ok: true, bound: false, skipped: 'bad_ref' };

  let acct = await loadAccount(env, inviteeAccountId);
  if (!acct) return { ok: false, error: '账号不存在' };
  ensureAccountFields(acct);

  if (acct.referredByAccountId) {
    return { ok: true, bound: false, skipped: 'already_bound' };
  }
  if (settings.referralBlockSelf && resolved.accountId === inviteeAccountId) {
    return { ok: true, bound: false, skipped: 'self' };
  }

  acct.referredByAccountId = resolved.accountId;
  acct.referredByPromoCode = code;
  acct.referredAt = Date.now();
  const saved = await saveAccountRaw(env, acct);
  if (!saved.ok) return saved;
  return { ok: true, bound: true, referrerAccountId: resolved.accountId };
}

/**
 * 被带人首次兑成高级后，尝试给推荐人叠天。
 * 失败不影响兑码成功。
 */
export async function tryRewardReferrer(env, inviteeAccountId, deviceId) {
  const settings = await loadOpsSettings(env);
  if (!settings.referralEnabled) {
    return { ok: true, rewarded: false, reason: 'disabled' };
  }

  const store = kv(env);
  if (!store) return { ok: true, rewarded: false, reason: 'no_kv' };

  const awardKey = AWARD_PREFIX + inviteeAccountId;
  const existed = await store.get(awardKey);
  if (existed) {
    return { ok: true, rewarded: false, reason: 'already_awarded' };
  }

  let invitee = await loadAccount(env, inviteeAccountId);
  if (!invitee || !invitee.referredByAccountId) {
    return { ok: true, rewarded: false, reason: 'no_referrer' };
  }

  const referrerId = invitee.referredByAccountId;
  if (settings.referralBlockSelf && referrerId === inviteeAccountId) {
    return { ok: true, rewarded: false, reason: 'self' };
  }

  let referrer = await loadAccount(env, referrerId);
  if (!referrer) {
    return { ok: true, rewarded: false, reason: 'referrer_missing' };
  }
  ensureAccountFields(referrer);

  if (settings.referralBlockSameDevice && deviceId) {
    const onReferrer = (referrer.devices || []).some((d) => d.deviceId === deviceId);
    if (onReferrer) {
      return { ok: true, rewarded: false, reason: 'same_device' };
    }
  }

  const mk = monthKeyNow();
  if (referrer.referralRewardMonthKey !== mk) {
    referrer.referralRewardMonthKey = mk;
    referrer.referralRewardCountMonth = 0;
  }
  const cap = settings.referralMonthlyCap;
  if (cap > 0 && (referrer.referralRewardCountMonth || 0) >= cap) {
    return { ok: true, rewarded: false, reason: 'monthly_cap' };
  }

  const ent = referrer.entitlement || {};
  if (
    ent.tierId === 'member_forever' &&
    ent.level === 'member' &&
    !ent.expiresAt
  ) {
    await store.put(
      awardKey,
      JSON.stringify({
        referrerId,
        rewardedAt: Date.now(),
        days: 0,
        skipped: 'forever'
      })
    );
    return { ok: true, rewarded: false, reason: 'forever' };
  }

  const days = settings.referralRewardDays || 90;
  const extended = await extendMemberByDays(env, referrerId, days, 'referral_reward');
  if (!extended.ok) {
    return { ok: false, rewarded: false, error: extended.error, reason: 'extend_failed' };
  }

  // 刷新推荐人月计数（extend 已写账号，再读一次防覆盖）
  referrer = await loadAccount(env, referrerId);
  if (referrer) {
    ensureAccountFields(referrer);
    if (referrer.referralRewardMonthKey !== mk) {
      referrer.referralRewardMonthKey = mk;
      referrer.referralRewardCountMonth = 0;
    }
    referrer.referralRewardCountMonth = (referrer.referralRewardCountMonth || 0) + 1;
    referrer.referralRewardTotal = (referrer.referralRewardTotal || 0) + 1;
    referrer.referralLastRewardAt = Date.now();
    referrer.referralLastRewardDays = days;
    await saveAccountRaw(env, referrer);
  }

  await store.put(
    awardKey,
    JSON.stringify({
      referrerId,
      inviteeAccountId,
      rewardedAt: Date.now(),
      days
    })
  );

  return {
    ok: true,
    rewarded: true,
    days,
    referrerAccountId: referrerId,
    tip: '宣传奖励已发放：推荐人高级会员 +' + days + ' 天'
  };
}

/** 运营台只读摘要 */
export function referralSummaryForAdmin(acct) {
  if (!acct) return null;
  return {
    promoCode: acct.promoCode || null,
    referredByAccountId: acct.referredByAccountId || null,
    referredByPromoCode: acct.referredByPromoCode || null,
    referredAt: acct.referredAt || null,
    referralRewardCountMonth: acct.referralRewardCountMonth || 0,
    referralRewardMonthKey: acct.referralRewardMonthKey || null,
    referralRewardTotal: acct.referralRewardTotal || 0,
    referralLastRewardAt: acct.referralLastRewardAt || null,
    referralLastRewardDays: acct.referralLastRewardDays || null
  };
}

export { publicAccount };
