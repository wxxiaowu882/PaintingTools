import { requireAdmin, jsonResponse } from '../../../membership/admin-auth.js';
import { getSecret } from '../../../membership/session.js';
import { mintRedeemToken } from '../../../membership/codes.js';

const TIERS = {
  member_3m: { name: '会员 · 三个月', durationDays: 90 },
  member_1y: { name: '会员 · 一年', durationDays: 365 },
  member_forever: { name: '会员 · 永久', durationDays: null }
};

export async function onRequestPost(context) {
  const gate = await requireAdmin(context);
  if (!gate.ok) return gate.response;

  let body;
  try {
    body = await context.request.json();
  } catch (_e) {
    return jsonResponse({ ok: false, error: '请求无效' }, 400);
  }

  const tierId = String(body.tierId || 'member_3m');
  const tier = TIERS[tierId];
  if (!tier) return jsonResponse({ ok: false, error: '档位不对' }, 400);

  const count = Math.min(20, Math.max(1, parseInt(body.count, 10) || 1));
  const codeDays = Math.min(365, Math.max(1, parseInt(body.codeDays, 10) || 30));
  const secret = getSecret(context.env);
  const now = Date.now();
  const codes = [];

  for (let i = 0; i < count; i++) {
    const code = await mintRedeemToken(
      {
        tierId,
        durationDays: tier.durationDays,
        jti: crypto.randomUUID()
      },
      secret,
      { nbf: now, exp: now + codeDays * 86400000 }
    );
    codes.push(code);
  }

  return jsonResponse({
    ok: true,
    tierId,
    tierName: tier.name,
    durationDays: tier.durationDays,
    codeExpiresInDays: codeDays,
    codes,
    copyText:
      '感谢支持♡\n档位：' +
      tier.name +
      '\n兑换码：\n' +
      codes.join('\n') +
      '\n\n请打开网站「会员 · 兑换」输入兑换码。\n——童画师吴晓'
  });
}
