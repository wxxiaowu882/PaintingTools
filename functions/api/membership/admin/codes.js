import { requireAdmin, jsonResponse } from '../../../membership/admin-auth.js';
import {
  mintShortRedeemCode,
  listIssuedCodes,
  resetShortRedeemCode,
  disableShortRedeemCode
} from '../../../membership/codes.js';
import { normalizeRedeemKind, SKETCH_PRODUCTS } from '../../../membership/product-unlocks.js';

const TIERS = {
  member_3m: { name: '高级会员 · 三个月', durationDays: 90 },
  member_1y: { name: '高级会员 · 一年', durationDays: 365 },
  member_3y: { name: '高级会员 · 三年', durationDays: 1095 }
};

/** 淘宝批量：单次最多 100；单条仍 1～100 */
const MAX_MINT_COUNT = 100;

function buildCopyText(kind, label, codes) {
  const lines = ['感谢支持♡'];
  if (kind === 'sketch') {
    lines.push('权益：' + label + '（永久）');
  } else if (kind === 'course') {
    lines.push('权益：' + label + '（录播永久 + 三年高级会员）');
  } else {
    lines.push('档位：' + label);
  }
  lines.push('兑换码：');
  lines.push(codes.join('\n'));
  lines.push('');
  lines.push('请登录网站「会员」→「权益兑换」输入兑换码（共 10 位）。');
  lines.push('——童画师吴晓');
  return lines.join('\n');
}

export async function onRequestGet(context) {
  const gate = await requireAdmin(context);
  if (!gate.ok) return gate.response;

  const url = new URL(context.request.url);
  const limit = parseInt(url.searchParams.get('limit') || '20', 10) || 20;
  const cursor = url.searchParams.get('cursor') || '';
  // 空字段不传进过滤，避免无意义扫描条件
  const code = String(url.searchParams.get('code') || '').trim();
  const phone = String(url.searchParams.get('phone') || '').trim();
  const note = String(url.searchParams.get('note') || '').trim();
  const kind = String(url.searchParams.get('kind') || '').trim().toLowerCase();
  const status = String(url.searchParams.get('status') || '').trim().toLowerCase();
  const listed = await listIssuedCodes(context.env, {
    limit,
    cursor: cursor || undefined,
    code: code || undefined,
    phone: phone || undefined,
    note: note || undefined,
    kind: kind && kind !== 'all' ? kind : undefined,
    status: status && status !== 'all' ? status : undefined
  });
  if (!listed.ok) {
    return jsonResponse(
      { ok: false, error: listed.error, codes: [], cursor: null, listComplete: true },
      503
    );
  }
  return jsonResponse({
    ok: true,
    codes: listed.codes,
    cursor: listed.cursor || null,
    listComplete: !!listed.listComplete,
    mode: listed.mode || 'browse',
    scanned: listed.scanned != null ? listed.scanned : undefined
  });
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

  if (body && body.action === 'reset') {
    const reset = await resetShortRedeemCode(context.env, body.code);
    if (!reset.ok) return jsonResponse({ ok: false, error: reset.error }, 400);
    return jsonResponse({ ok: true, record: reset.record });
  }

  if (body && body.action === 'disable') {
    const disabled = await disableShortRedeemCode(context.env, body.code);
    if (!disabled.ok) return jsonResponse({ ok: false, error: disabled.error }, 400);
    return jsonResponse({ ok: true, record: disabled.record });
  }

  const kind = normalizeRedeemKind(body && body.kind);
  const count = Math.min(
    MAX_MINT_COUNT,
    Math.max(1, parseInt(body.count, 10) || 1)
  );
  const codeDays = Math.min(365, Math.max(1, parseInt(body.codeDays, 10) || 30));
  const note = String(body.note || '').trim().slice(0, 80);

  let grant;
  let label;

  if (kind === 'sketch') {
    const productId = String(body.productId || '')
      .trim()
      .toLowerCase();
    const known = SKETCH_PRODUCTS[productId];
    if (!known) return jsonResponse({ ok: false, error: '写生单品类型不对' }, 400);
    label = known.title;
    grant = { kind: 'sketch', productId, productName: label };
  } else if (kind === 'course') {
    const packId = String(body.packId || '').trim();
    const packTitle = String(body.packTitle || packId).trim().slice(0, 80);
    if (!packId) return jsonResponse({ ok: false, error: '请选择课包' }, 400);
    label = packTitle || packId;
    grant = { kind: 'course', packId, packTitle: label };
  } else {
    const tierId = String(body.tierId || 'member_3m');
    const tier = TIERS[tierId];
    if (!tier) return jsonResponse({ ok: false, error: '档位不对' }, 400);
    label = tier.name;
    grant = {
      kind: 'pro',
      tierId,
      tierName: tier.name,
      durationDays: tier.durationDays
    };
  }

  const codes = [];
  const records = [];

  for (let i = 0; i < count; i++) {
    const minted = await mintShortRedeemCode(context.env, grant, { codeDays, note });
    if (!minted.ok) {
      return jsonResponse({ ok: false, error: minted.error }, 503);
    }
    codes.push(minted.code);
    records.push(minted.record);
  }

  return jsonResponse({
    ok: true,
    kind,
    label,
    tierId: grant.tierId || null,
    productId: grant.productId || null,
    packId: grant.packId || null,
    codeExpiresInDays: codeDays,
    codes,
    records,
    exportText: codes.join('\n'),
    copyText: buildCopyText(kind, label, codes)
  });
}
