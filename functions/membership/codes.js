/**
 * 兑换码校验
 * - 签名码：WXM1.<payload>.<sig>（由 gen 脚本生成，含档位与时长）
 * - 探针码：仅当 env.ALLOW_PROBE_CODES === '1' 时可用
 * - 可选 KV（MEMBERSHIP_KV）记录 jti 防重复兑换
 */
import { getSecret, signPayload, verifySigned } from './session.js';

const PROBE = {
  'PROBE-3M': { tierId: 'member_3m', durationDays: 90 },
  'PROBE-1Y': { tierId: 'member_1y', durationDays: 365 },
  'PROBE-FOREVER': { tierId: 'member_forever', durationDays: null }
};

export function buildEntitlementFromGrant(grant) {
  const now = Date.now();
  const durationDays = grant.durationDays == null ? null : Number(grant.durationDays);
  const expiresAt =
    durationDays == null || !isFinite(durationDays)
      ? null
      : now + durationDays * 86400000;
  return {
    tierId: grant.tierId,
    level: 'member',
    expiresAt,
    source: grant.source || 'redeem',
    redeemedAt: now,
    jti: grant.jti || null
  };
}

async function consumeJti(env, jti) {
  if (!jti || !env || !env.MEMBERSHIP_KV) return { ok: true, tracked: false };
  const key = 'used:' + jti;
  const existed = await env.MEMBERSHIP_KV.get(key);
  if (existed) return { ok: false, error: '兑换码已使用' };
  await env.MEMBERSHIP_KV.put(key, String(Date.now()), {
    expirationTtl: 60 * 60 * 24 * 400
  });
  return { ok: true, tracked: true };
}

export async function resolveRedeemCode(rawCode, env) {
  const code = String(rawCode || '').trim();
  if (!code) return { ok: false, error: '请输入兑换码' };

  const upper = code.toUpperCase();
  const allowProbe = String((env && env.ALLOW_PROBE_CODES) || '') === '1';
  if (PROBE[upper]) {
    if (!allowProbe) {
      return { ok: false, error: '探针码已关闭，请使用正式兑换码' };
    }
    return {
      ok: true,
      grant: {
        tierId: PROBE[upper].tierId,
        durationDays: PROBE[upper].durationDays,
        source: 'probe',
        jti: 'probe:' + upper + ':' + Date.now()
      }
    };
  }

  if (!code.startsWith('WXM1.')) {
    return { ok: false, error: '兑换码无效' };
  }

  const secret = getSecret(env);
  // token 本体是 payload.sig，前缀 WXM1. 仅作版本标记
  const token = code.slice('WXM1.'.length);
  const payload = await verifySigned(token, secret);
  if (!payload || payload.v !== 1) return { ok: false, error: '兑换码无效或已损坏' };

  const now = Date.now();
  if (payload.nbf && Number(payload.nbf) > now) {
    return { ok: false, error: '兑换码尚未生效' };
  }
  if (payload.exp && Number(payload.exp) < now) {
    return { ok: false, error: '兑换码已过期' };
  }
  if (payload.disabled) return { ok: false, error: '兑换码已作废' };

  const jti = payload.jti ? String(payload.jti) : null;
  const used = await consumeJti(env, jti);
  if (!used.ok) return { ok: false, error: used.error };

  return {
    ok: true,
    grant: {
      tierId: payload.tierId || 'member_3m',
      durationDays: payload.durationDays == null ? null : Number(payload.durationDays),
      source: 'signed_code',
      jti
    }
  };
}

/** 供本机脚本生成码时复用同一签名算法（Node 侧另有实现） */
export async function mintRedeemToken(grant, secret, opts) {
  const now = Date.now();
  const payload = {
    v: 1,
    tierId: grant.tierId,
    durationDays: grant.durationDays == null ? null : grant.durationDays,
    jti: grant.jti || crypto.randomUUID(),
    nbf: opts && opts.nbf != null ? opts.nbf : now,
    exp: opts && opts.exp != null ? opts.exp : now + 30 * 86400000
  };
  const token = await signPayload(payload, secret);
  return 'WXM1.' + token;
}
