import { requireAdmin, jsonResponse } from '../../../membership/admin-auth.js';
import { mintShortRedeemCode, listIssuedCodes, resetShortRedeemCode } from '../../../membership/codes.js';

const TIERS = {
  member_3m: { name: '会员 · 三个月', durationDays: 90 },
  member_1y: { name: '会员 · 一年', durationDays: 365 },
  member_forever: { name: '会员 · 永久', durationDays: null }
};

export async function onRequestGet(context) {
  const gate = await requireAdmin(context);
  if (!gate.ok) return gate.response;

  const url = new URL(context.request.url);
  const limit = parseInt(url.searchParams.get('limit') || '50', 10) || 50;
  const listed = await listIssuedCodes(context.env, limit);
  if (!listed.ok) {
    return jsonResponse({ ok: false, error: listed.error, codes: [] }, 503);
  }
  return jsonResponse({ ok: true, codes: listed.codes });
}

export async function onRequestPost(context) {
  const gate = await requireAdmin(context);
  if (!gate.ok) return gate.response;

  let body;
  try {
    body = await context.request.json();
  } catch (_e) {
    return jsonResponse({ ok: false, error: '请求无效' }, 400);
  }

  // 重置：让已兑过的短码可以再测兑换流程
  if (body && body.action === 'reset') {
    const reset = await resetShortRedeemCode(context.env, body.code);
    if (!reset.ok) return jsonResponse({ ok: false, error: reset.error }, 400);
    return jsonResponse({ ok: true, record: reset.record });
  }

  const tierId = String(body.tierId || 'member_3m');
  const tier = TIERS[tierId];
  if (!tier) return jsonResponse({ ok: false, error: '档位不对' }, 400);

  const count = Math.min(20, Math.max(1, parseInt(body.count, 10) || 1));
  const codeDays = Math.min(365, Math.max(1, parseInt(body.codeDays, 10) || 30));
  const note = String(body.note || '').trim().slice(0, 80);
  const codes = [];
  const records = [];

  for (let i = 0; i < count; i++) {
    const minted = await mintShortRedeemCode(
      context.env,
      {
        tierId,
        tierName: tier.name,
        durationDays: tier.durationDays
      },
      { codeDays, note }
    );
    if (!minted.ok) {
      return jsonResponse({ ok: false, error: minted.error }, 503);
    }
    codes.push(minted.code);
    records.push(minted.record);
  }

  return jsonResponse({
    ok: true,
    tierId,
    tierName: tier.name,
    durationDays: tier.durationDays,
    codeExpiresInDays: codeDays,
    codes,
    records,
    copyText:
      '感谢支持♡\n档位：' +
      tier.name +
      '\n兑换码：\n' +
      codes.join('\n') +
      '\n\n请打开网站「会员 · 兑换」输入兑换码（共 10 位）。\n——童画师吴晓'
  });
}
