/**
 * 兑换码校验与生成
 * - 正式短码：10 位（易读字母数字），存在 MEMBERSHIP_KV
 * - 旧签名码：WXM1.<payload>.<sig>（仍可兑换，兼容过渡）
 * - 探针码：仅当 env.ALLOW_PROBE_CODES === '1'（测试用，正式应关闭）
 * - 短码 kind：pro（时长）| sketch（写生库永久）| course（录播课包+三年 Pro）；缺省=pro
 */
import { getSecret, signPayload, verifySigned } from './session.js';
import { normalizeRedeemKind, SKETCH_PRODUCTS } from './product-unlocks.js';

const PROBE = {
  'PROBE-3M': { kind: 'pro', tierId: 'member_3m', durationDays: 90 },
  'PROBE-1Y': { kind: 'pro', tierId: 'member_1y', durationDays: 365 },
  'PROBE-3Y': { kind: 'pro', tierId: 'member_3y', durationDays: 1095 }
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

function grantFromShortRecord(rec, code) {
  const kind = normalizeRedeemKind(rec.kind);
  const grant = {
    kind,
    source: 'short_code',
    jti: rec.jti || 'short:' + code,
    redeemCode: code
  };
  if (kind === 'sketch') {
    grant.productId = String(rec.productId || '').trim().toLowerCase();
    grant.productName = String(rec.productName || rec.tierName || '').trim();
  } else if (kind === 'course') {
    grant.packId = String(rec.packId || '').trim();
    grant.packTitle = String(rec.packTitle || rec.tierName || '').trim();
  } else {
    grant.tierId = rec.tierId || 'member_3m';
    grant.durationDays = rec.durationDays == null ? null : Number(rec.durationDays);
  }
  return grant;
}

/**
 * 校验短码。默认不核销（consume:false），避免「未登录先验码」烧掉真码。
 * 登录通过后再调 consumeShortRedeemCode。
 */
async function resolveShortCode(code, env, opts) {
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

  const consume = !!(opts && opts.consume);
  if (consume) {
    rec.redeemedAt = now;
    await store.put(CODE_KEY_PREFIX + code, JSON.stringify(rec));
  }

  return { ok: true, grant: grantFromShortRecord(rec, code) };
}

/** 登录校验通过后核销短码；已兑/作废则失败（防并发双兑） */
export async function consumeShortRedeemCode(env, rawCode) {
  const store = kv(env);
  if (!store) return { ok: false, error: '系统还未开通发码记录本' };
  const code = normalizeShortCode(rawCode);
  if (!isShortCodeShape(code)) return { ok: false, error: '兑换码格式不对' };
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
  return { ok: true, record: rec, grant: grantFromShortRecord(rec, code) };
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

/**
 * 解析兑换码。
 * opts.consume：短码/签名码是否立即核销。兑接口应先 false 验码，登录后再核销。
 */
export async function resolveRedeemCode(rawCode, env, opts) {
  const code = String(rawCode || '').trim();
  if (!code) return { ok: false, error: '请输入兑换码' };
  const consume = !!(opts && opts.consume);

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
        kind: 'pro',
        tierId: PROBE[upper].tierId,
        durationDays: PROBE[upper].durationDays,
        source: 'probe',
        jti: 'probe:' + upper + ':' + Date.now()
      }
    };
  }

  const short = normalizeShortCode(code);
  if (isShortCodeShape(short)) {
    return resolveShortCode(short, env, { consume });
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
  if (consume) {
    const used = await consumeJti(env, jti);
    if (!used.ok) return { ok: false, error: used.error };
  }

  return {
    ok: true,
    grant: {
      kind: 'pro',
      tierId: payload.tierId || 'member_3m',
      durationDays: payload.durationDays == null ? null : Number(payload.durationDays),
      source: 'signed_code',
      jti
    }
  };
}

/** 签名长码：登录后再占 jti */
export async function consumeSignedRedeemJti(env, jti) {
  return consumeJti(env, jti);
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

  const kind = normalizeRedeemKind(grant && grant.kind);
  const rec = {
    code,
    kind,
    jti,
    createdAt: now,
    codeExpiresAt,
    redeemedAt: null,
    note: (opts && opts.note) || ''
  };

  if (kind === 'sketch') {
    const productId = String((grant && grant.productId) || '')
      .trim()
      .toLowerCase();
    const known = SKETCH_PRODUCTS[productId];
    if (!known) return { ok: false, error: '写生单品类型不对' };
    rec.productId = productId;
    rec.productName = String((grant && grant.productName) || known.title).trim().slice(0, 80);
    rec.tierName = rec.productName;
    rec.tierId = productId;
    rec.durationDays = null;
  } else if (kind === 'course') {
    const packId = String((grant && grant.packId) || '').trim();
    if (!packId) return { ok: false, error: '缺少课包 ID' };
    rec.packId = packId;
    rec.packTitle = String((grant && grant.packTitle) || packId)
      .trim()
      .slice(0, 80);
    rec.tierName = rec.packTitle;
    rec.tierId = 'course:' + packId;
    rec.durationDays = null;
  } else {
    rec.tierId = (grant && grant.tierId) || 'member_3m';
    rec.tierName = (grant && grant.tierName) || rec.tierId;
    rec.durationDays =
      grant && grant.durationDays == null ? null : Number(grant.durationDays);
  }

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

/** 运营作废：未兑码可标 disabled；已兑码不可作废（权益已落账号） */
export async function disableShortRedeemCode(env, rawCode) {
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
  if (rec.redeemedAt) {
    return { ok: false, error: '该码已兑换，无法作废（权益已挂在账号上）' };
  }
  rec.disabled = true;
  await store.put(CODE_KEY_PREFIX + code, JSON.stringify(rec));
  return { ok: true, record: rec };
}

function normalizeCodeKind(rec) {
  const k = String((rec && rec.kind) || 'pro').toLowerCase();
  if (k === 'sketch' || k === 'course') return k;
  return 'pro';
}

/** status: pending | redeemed | disabled | expired */
function matchCodeStatus(rec, status) {
  const st = String(status || '').toLowerCase();
  if (!st || st === 'all') return true;
  const now = Date.now();
  const disabled = !!(rec && rec.disabled);
  const redeemed = !!(rec && rec.redeemedAt);
  const expired =
    !redeemed &&
    !disabled &&
    !!(rec && rec.codeExpiresAt) &&
    Number(rec.codeExpiresAt) < now;
  if (st === 'disabled') return disabled;
  if (st === 'redeemed') return redeemed && !disabled;
  if (st === 'expired') return expired;
  if (st === 'pending') return !disabled && !redeemed && !expired;
  return true;
}

function hasCodeSearchFilters(o) {
  return !!(
    (o.code && String(o.code).trim()) ||
    (o.phone && String(o.phone).trim()) ||
    (o.note && String(o.note).trim()) ||
    (o.kind && String(o.kind).trim() && String(o.kind).toLowerCase() !== 'all') ||
    (o.status && String(o.status).trim() && String(o.status).toLowerCase() !== 'all')
  );
}

function codeRecordMatches(rec, o) {
  if (!rec || typeof rec !== 'object') return false;
  const codeQ = o.code != null ? String(o.code).trim().toUpperCase() : '';
  if (codeQ) {
    if (String(rec.code || '').toUpperCase() !== codeQ) return false;
  }
  const phoneQ = o.phone != null ? String(o.phone).trim() : '';
  if (phoneQ) {
    if (String(rec.redeemedByPhone || '').indexOf(phoneQ) < 0) return false;
  }
  const noteQ = o.note != null ? String(o.note).trim() : '';
  if (noteQ) {
    if (String(rec.note || '').indexOf(noteQ) < 0) return false;
  }
  const kindQ = o.kind != null ? String(o.kind).trim().toLowerCase() : '';
  if (kindQ && kindQ !== 'all') {
    if (normalizeCodeKind(rec) !== kindQ) return false;
  }
  if (!matchCodeStatus(rec, o.status)) return false;
  return true;
}

/**
 * 列出发过的码（发码台账）。
 * limitOrOpts: number | { limit?, cursor?, code?, phone?, note?, kind?, status? }
 * 空检索字段不参与过滤。仅填兑换码时走单键读取。
 * KV list 按键名分页；无过滤时同页内按 createdAt 新→旧；有过滤时按扫描顺序凑满一页。
 */
export async function listIssuedCodes(env, limitOrOpts) {
  const store = kv(env);
  if (!store) {
    return { ok: false, error: '未开通发码记录本', codes: [], cursor: null, listComplete: true };
  }

  const o =
    limitOrOpts && typeof limitOrOpts === 'object'
      ? limitOrOpts
      : { limit: limitOrOpts };
  const max = Math.min(100, Math.max(1, Number(o.limit) || 20));
  const codeExact = o.code != null ? String(o.code).trim().toUpperCase() : '';

  // 精确短码：只读 1 次，其它条件仍可收窄（空条件忽略）
  if (codeExact && !String(o.cursor || '').trim()) {
    const raw = await store.get(CODE_KEY_PREFIX + codeExact);
    if (!raw) {
      return { ok: true, codes: [], cursor: null, listComplete: true, mode: 'exact' };
    }
    let rec;
    try {
      rec = JSON.parse(raw);
    } catch (_e) {
      return { ok: true, codes: [], cursor: null, listComplete: true, mode: 'exact' };
    }
    const hit = codeRecordMatches(rec, Object.assign({}, o, { code: codeExact }))
      ? [rec]
      : [];
    return { ok: true, codes: hit, cursor: null, listComplete: true, mode: 'exact' };
  }

  const filtering = hasCodeSearchFilters(o);
  // 有过滤时一次请求最多扫这么多键，避免拖垮单次 Worker / KV
  const scanBudget = filtering ? Math.min(300, Math.max(max * 6, 80)) : max;
  const codes = [];
  let cursor = o.cursor != null && String(o.cursor) ? String(o.cursor) : '';
  let listComplete = false;
  let scanned = 0;

  while (codes.length < max && scanned < scanBudget && !listComplete) {
    const batchLimit = Math.min(100, scanBudget - scanned, filtering ? 50 : max);
    const listOpts = { prefix: CODE_KEY_PREFIX, limit: batchLimit };
    if (cursor) listOpts.cursor = cursor;
    const listed = await store.list(listOpts);
    const keys = (listed && listed.keys) || [];
    if (!keys.length) {
      listComplete = true;
      cursor = '';
      break;
    }
    for (const key of keys) {
      if (codes.length >= max || scanned >= scanBudget) break;
      scanned++;
      const raw = await store.get(key.name);
      if (!raw) continue;
      let rec;
      try {
        rec = JSON.parse(raw);
      } catch (_e) {
        continue;
      }
      if (filtering) {
        if (!codeRecordMatches(rec, o)) continue;
        codes.push(rec);
      } else {
        codes.push(rec);
      }
    }
    listComplete = !!(listed && listed.list_complete);
    cursor =
      listComplete || !(listed && listed.cursor) ? '' : String(listed.cursor);
    if (!filtering) break;
    // 有过滤：未凑满且还有游标则继续扫；扫预算用尽则带着 cursor 给前端「下一页」续扫
    if (codes.length >= max || listComplete || !cursor) break;
  }

  if (!filtering) {
    codes.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }
  const nextCursor = listComplete || !cursor ? null : cursor;
  return {
    ok: true,
    codes,
    cursor: nextCursor,
    listComplete: !!listComplete || !nextCursor,
    mode: filtering ? 'filter' : 'browse',
    scanned
  };
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
