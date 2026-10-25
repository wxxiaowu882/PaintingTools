import {
  readEntitlementFromRequest,
  clearSessionCookie,
  jsonResponse,
  accessLevel
} from '../../membership/session.js';
import { loadAccount } from '../../membership/accounts.js';
import { ensurePromoCode, referralSummaryForAdmin } from '../../membership/referral.js';
import { loadOpsSettings } from '../../membership/ops-settings.js';

export async function onRequestGet(context) {
  const entitlement = await readEntitlementFromRequest(context.request, context.env);
  const level = accessLevel(entitlement);
  const out = { ok: true, entitlement, accessLevel: level };

  const accountId = entitlement && entitlement.accountId;
  if (accountId && (level === 'user' || level === 'member')) {
    try {
      const settings = await loadOpsSettings(context.env);
      out.referral = {
        enabled: !!settings.referralEnabled,
        rewardDays: settings.referralRewardDays,
        monthlyCap: settings.referralMonthlyCap
      };
      if (settings.referralEnabled) {
        const promo = await ensurePromoCode(
          context.env,
          accountId,
          context.request.url
        );
        if (promo.ok) {
          out.promoCode = promo.code;
          out.promoUrl = promo.promoUrl;
        }
        const acct = await loadAccount(context.env, accountId);
        if (acct) {
          const sum = referralSummaryForAdmin(acct);
          out.referralStats = {
            rewardCountMonth: sum.referralRewardCountMonth,
            rewardMonthKey: sum.referralRewardMonthKey,
            rewardTotal: sum.referralRewardTotal,
            lastRewardAt: sum.referralLastRewardAt,
            lastRewardDays: sum.referralLastRewardDays
          };
        }
      }
    } catch (_e) {}
  }

  return jsonResponse(out);
}

export async function onRequestDelete(context) {
  return jsonResponse(
    {
      ok: true,
      entitlement: { tierId: 'free', level: 'guest', expiresAt: null, source: 'cleared' },
      accessLevel: 'guest'
    },
    200,
    { 'Set-Cookie': clearSessionCookie(context.request) }
  );
}
