/**
 * 兑换码校验与生成
 * - 正式短码：10 位（易读字母数字），存在 MEMBERSHIP_KV
 * - 旧签名码：WXM1.<payload>.<sig>（仍可兑换，兼容过渡）
 * - 探针码：仅当 env.ALLOW_PROBE_CODES === '1'（测试用，正式应关闭）
 */
import { getSecret, signPayload, verifySigned } from './session.js';

const PROBE = {
  'PROBE-3M': { tierId: 'member_3m', durationDays: 90 },
  'PROBE-1Y': { tierId: 'member_1y', durationDays: 365 },
  'PROBE-FOREVER': { tierId: 'member_forever', durationDays: null }
};

/** 去掉易混字符 0/O/1/I */
const SHORT_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SHORT_LEN = 10;
const CODE_KEY_PREFIX = 'code:';

export function buildEntitlementFromGrant(grant) {
  const now = Date.now();
  const durationDays = grant.durationDays == null ? null : Number(grant.durationDays);
  const expiresAt =
    durationDays == null || !isFinite(durationDays)
      ? null
      : now + durationDays * 86400000;
  const jti = grant.jti || null;
  let redeemCode = grant.redeemCode || null;
  if (!redeemCode && jti && String(jti).indexOf('short:') === 0) {
    redeemCode = String(jti).slice(6);
  }
  return {
    tierId: grant.tierId,
    level: 'member',
    expiresAt,
    source: grant.source || 'redeem',
    redeemedAt: now,
    jti,
    redeemCode: redeemCode || null
  };
}

function kv(env) {
  return env && env.MEMBERSHIP_KV ? env.MEMBERSHIP_KV : null;
}

function normalizeShortCode(raw) {
  return String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function isShortCodeShape(code) {
  if (!code || code.length !== SHORT_LEN) return false;
  for (let i = 0; i < code.length; i++) {
    if (SHORT_ALPHABET.indexOf(code[i]) < 0) return false;
  }
  return true;
}

function randomShortCode() {
  const bytes = new Uint8Array(SHORT_LEN);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < SHORT_LEN; i++) {
    out += SHORT_ALPHABET[bytes[i] % SHORT_ALPHABET.length];
  }
  return out;
}

async function consumeJti(env, jti) {
  const store = kv(env);
  if (!jti || !store) return { ok: true, tracked: false };
  const key = 'used:' + jti;
  const existed = await store.get(key);
  if (existed) return { ok: false, error: '兑换码已使用' };
  await store.put(key, String(Date.now()), {
    expirationTtl: 60 * 60 * 24 * 400
  });
  return { ok: true, tracked: true };
}

async function resolveShortCode(code, env) {
  const store = kv(env);
  if (!store) {
    return { ok: false, error: '系统还未开通发码记录本，请联系技术处理后再兑换' };
  }
  const raw = await store.get(CODE_KEY_PREFIX + code);
  if (!raw) return { ok: false, error: '兑换码无效' };
  let rec;
  try {
    rec = JSON.parse(raw);
  } catch (_e) {
    return { ok: false, error: '兑换码无效' };
  }
  const now = Date.now();
  if (rec.disabled) return { ok: false, error: '兑换码已作废' };
  if (rec.redeemedAt) return { ok: false, error: '兑换码已使用' };
  if (rec.codeExpiresAt && Number(rec.codeExpiresAt) < now) {
    return { ok: false, error: '兑换码已过期（超过可兑换期限）' };
  }

  rec.redeemedAt = now;
  await store.put(CODE_KEY_PREFIX + code, JSON.stringify(rec));

  return {
    ok: true,
    grant: {
      tierId: rec.tierId || 'member_3m',
      durationDays: rec.durationDays == null ? null : Number(rec.durationDays),
      source: 'short_code',
      jti: rec.jti || 'short:' + code,
      redeemCode: code
    }
  };
}

/**
 * 兑码成功后补记「兑到谁」（多 1 次 get+put；兑码低频可接受）。
 * 失败不回滚权益，仅影响运营台对账显示。
 */
export async function bindShortCodeToAccount(env, rawCode, opts) {
  const store = kv(env);
  if (!store) return { ok: false, error: '未开通发码记录本' };
  const code = normalizeShortCode(rawCode);
  if (!isShortCodeShape(code)) return { ok: false, error: '兑换码格式不对' };
  const raw = await store.get(CODE_KEY_PREFIX + code);
  if (!raw) return { ok: false, error: '找不到这个兑换码' };
  let rec;
  try {
    rec = JSON.parse(raw);
  } catch (_e) {
    return { ok: false, error: '兑换码记录损坏' };
  }
  const accountId = opts && opts.accountId ? String(opts.accountId) : '';
  const phone = opts && opts.phone ? String(opts.phone).trim() : '';
  rec.redeemedByAccountId = accountId || rec.redeemedByAccountId || null;
  rec.redeemedByPhone = phone || rec.redeemedByPhone || null;
  if (!rec.redeemedAt) rec.redeemedAt = Date.now();
  await store.put(CODE_KEY_PREFIX + code, JSON.stringify(rec));
  return { ok: true, record: rec };
}

export async function resolveRedeemCode(rawCode, env) {
  const code = String(rawCode || '').trim();
  if (!code) return { ok: false, error: '请输入兑换码' };

  const upper = code.toUpperCase();
  const { isProbeAllowed } = await import('./ops-settings.js');
  const allowProbe = await isProbeAllowed(env);
  if (PROBE[upper]) {
    if (!allowProbe) {
      return { ok: false, error: '测试用假码已关闭，请使用正式兑换码' };
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

  const short = normalizeShortCode(code);
  if (isShortCodeShape(short)) {
    return resolveShortCode(short, env);
  }

  if (!code.startsWith('WXM1.')) {
    return { ok: false, error: '兑换码无效' };
  }

  const secret = getSecret(env);
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

/**
 * 生成 10 位短码并写入 KV。无 KV 时返回错误（短码必须落库，否则无法防重复、也做不了发码记录）。
 */
export async function mintShortRedeemCode(env, grant, opts) {
  const store = kv(env);
  if (!store) {
    return {
      ok: false,
      error: '还没开通「发码记录本」（线上小本本）。开通后才能发 10 位短码，并看到发码列表。'
    };
  }

  const now = Date.now();
  const codeDays = opts && opts.codeDays != null ? Number(opts.codeDays) : 30;
  const codeExpiresAt = now + Math.max(1, codeDays) * 86400000;
  const jti = grant.jti || crypto.randomUUID();

  let code = '';
  for (let attempt = 0; attempt < 12; attempt++) {
    const candidate = randomShortCode();
    const existed = await store.get(CODE_KEY_PREFIX + candidate);
    if (!existed) {
      code = candidate;
      break;
    }
  }
  if (!code) return { ok: false, error: '生成兑换码失败，请再试一次' };

  const rec = {
    code,
    tierId: grant.tierId,
    tierName: grant.tierName || grant.tierId,
    durationDays: grant.durationDays == null ? null : Number(grant.durationDays),
    jti,
    createdAt: now,
    codeExpiresAt,
    redeemedAt: null,
    note: (opts && opts.note) || ''
  };
  await store.put(CODE_KEY_PREFIX + code, JSON.stringify(rec));
  return { ok: true, code, record: rec };
}

/** 运营重置：清掉「已兑换」标记，便于反复测试同一码 */
export async function resetShortRedeemCode(env, rawCode) {
  const store = kv(env);
  if (!store) return { ok: false, error: '未开通发码记录本' };
  const code = normalizeShortCode(rawCode);
  if (!isShortCodeShape(code)) return { ok: false, error: '兑换码格式不对' };
  const raw = await store.get(CODE_KEY_PREFIX + code);
  if (!raw) return { ok: false, error: '找不到这个兑换码' };
  let rec;
  try {
    rec = JSON.parse(raw);
  } catch (_e) {
    return { ok: false, error: '兑换码记录损坏' };
  }
  rec.redeemedAt = null;
  rec.redeemedByAccountId = null;
  rec.redeemedByPhone = null;
  rec.disabled = false;
  await store.put(CODE_KEY_PREFIX + code, JSON.stringify(rec));
  return { ok: true, record: rec };
}

/** 列出最近发过的码（发码台账） */
export async function listIssuedCodes(env, limit) {
  const store = kv(env);
  if (!store) return { ok: false, error: '未开通发码记录本', codes: [] };

  const max = Math.min(100, Math.max(1, limit || 50));
  const listed = await store.list({ prefix: CODE_KEY_PREFIX, limit: max });
  const codes = [];
  for (const key of listed.keys || []) {
    const raw = await store.get(key.name);
    if (!raw) continue;
    try {
      codes.push(JSON.parse(raw));
    } catch (_e) {}
  }
  codes.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return { ok: true, codes };
}

/** 旧版长码（本机脚本兼容）；线上运营台改用短码 */
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
