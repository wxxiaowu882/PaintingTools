/** 会员会话：HMAC 签名 Cookie，防止伪造 */

export const COOKIE_NAME = 'wuxiao_member';
const MAX_AGE_FOREVER = 60 * 60 * 24 * 365 * 10;

function b64urlFromBytes(buf) {
  let s = '';
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function b64urlFromText(text) {
  return btoa(unescape(encodeURIComponent(text)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function textFromB64url(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  return decodeURIComponent(escape(atob(b64 + pad)));
}

function bytesFromB64url(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function getSecret(env) {
  const s = (env && (env.MEMBERSHIP_SECRET || env.MEMBERSHIP_HMAC_SECRET)) || '';
  if (s && String(s).length >= 16) return String(s);
  // 未配置时的开发回退（生产务必在 Pages 设置 Secrets）
  return 'dev-only-wuxiao-membership-change-me';
}

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export async function signPayload(obj, secret) {
  const body = b64urlFromText(JSON.stringify(obj));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  return body + '.' + b64urlFromBytes(sig);
}

export async function verifySigned(token, secret) {
  if (!token || typeof token !== 'string' || token.indexOf('.') < 0) return null;
  const i = token.lastIndexOf('.');
  const body = token.slice(0, i);
  const sigPart = token.slice(i + 1);
  if (!body || !sigPart) return null;
  try {
    const key = await hmacKey(secret);
    const ok = await crypto.subtle.verify(
      'HMAC',
      key,
      bytesFromB64url(sigPart),
      new TextEncoder().encode(body)
    );
    if (!ok) return null;
    return JSON.parse(textFromB64url(body));
  } catch (_e) {
    return null;
  }
}

/** 策略 require：public（兼容 free）| user | member */
export function normalizeRequire(req) {
  const r = String(req == null ? 'public' : req).toLowerCase().trim();
  if (r === 'member' || r === 'premium') return 'member';
  if (r === 'user' || r === 'registered') return 'user';
  return 'public'; // free / public / 空 / 其它
}

/**
 * 归一权益。level：guest | user | member（旧 free → guest；有 accountId 的非付费 → user）
 */
export function normalizeEntitlement(ent) {
  if (!ent || typeof ent !== 'object') {
    return { tierId: 'free', level: 'guest', expiresAt: null, source: 'default' };
  }
  const accountId = ent.accountId || null;
  const deviceId = ent.deviceId || null;
  let level = String(ent.level || '').toLowerCase();
  if (level === 'free') level = accountId ? 'user' : 'guest';
  if (level !== 'member' && level !== 'user' && level !== 'guest') {
    level = accountId ? 'user' : 'guest';
  }
  if (level === 'guest' && accountId) level = 'user';

  const expiresAt = ent.expiresAt == null ? null : Number(ent.expiresAt);
  let redeemCode = ent.redeemCode || null;
  if (!redeemCode && ent.jti && String(ent.jti).indexOf('short:') === 0) {
    redeemCode = String(ent.jti).slice(6);
  }
  // 过期：降为会员档，但保留 redeemCode 便于运营对账（不另开 KV）
  if (level === 'member' && expiresAt != null && expiresAt > 0 && expiresAt < Date.now()) {
    return {
      tierId: 'free',
      level: accountId ? 'user' : 'guest',
      expiresAt: null,
      source: 'expired',
      redeemedAt: ent.redeemedAt || null,
      jti: ent.jti || null,
      redeemCode: redeemCode || null,
      accountId,
      deviceId
    };
  }
  return {
    tierId: ent.tierId || (level === 'member' ? 'member_3m' : 'free'),
    level,
    expiresAt: expiresAt && expiresAt > 0 ? expiresAt : null,
    source: ent.source || 'server',
    redeemedAt: ent.redeemedAt || null,
    jti: ent.jti || null,
    redeemCode: redeemCode || null,
    accountId,
    deviceId
  };
}

/** 访问档：guest | user | member */
export function accessLevel(ent) {
  const e = normalizeEntitlement(ent);
  if (e.level === 'member') return 'member';
  if (e.level === 'user' || e.accountId) return 'user';
  return 'guest';
}

/** 用户档是否满足策略 require */
export function meetsRequire(levelOrEnt, require) {
  const level =
    typeof levelOrEnt === 'string' ? String(levelOrEnt).toLowerCase() : accessLevel(levelOrEnt);
  const req = normalizeRequire(require);
  if (req === 'public') return true;
  if (req === 'user') return level === 'user' || level === 'member';
  if (req === 'member') return level === 'member';
  return true;
}

/** 是否高级会员（付费有效期内） */
export function isMember(ent) {
  return accessLevel(ent) === 'member';
}

export function parseCookies(header) {
  const out = {};
  String(header || '')
    .split(';')
    .forEach((part) => {
      const idx = part.indexOf('=');
      if (idx < 0) return;
      out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
    });
  return out;
}

export async function readEntitlementFromRequest(request, env) {
  const cookies = parseCookies(request.headers.get('Cookie'));
  const raw = cookies[COOKIE_NAME];
  if (!raw) return normalizeEntitlement(null);
  const secret = getSecret(env);
  const payload = await verifySigned(decodeURIComponent(raw), secret);
  let ent = normalizeEntitlement(payload);
  // 已挂账号：以 KV 账号权益为准，并校验设备仍在名额内
  if (ent.accountId) {
    try {
      const { loadAccount, deviceAllowed } = await import('./accounts.js');
      const acct = await loadAccount(env, ent.accountId);
      if (!acct) {
        return normalizeEntitlement({ tierId: 'free', level: 'guest', source: 'account_missing' });
      }
      if (ent.deviceId && !deviceAllowed(acct, ent.deviceId)) {
        return normalizeEntitlement({
          tierId: 'free',
          level: 'guest',
          source: 'device_kicked'
        });
      }
      const ae = normalizeEntitlement(acct.entitlement || null);
      ae.accountId = acct.accountId;
      ae.deviceId = ent.deviceId || null;
      ae.source = ae.source || 'account';
      return ae;
    } catch (_e) {
      return ent;
    }
  }
  return ent;
}

/** http://127.0.0.1 本地预览不能带 Secure，否则浏览器不存 Cookie */
export function cookieFlags(request) {
  let secure = false;
  try {
    if (request && new URL(request.url).protocol === 'https:') secure = true;
  } catch (_e) {}
  return secure ? '; SameSite=Lax; Secure; HttpOnly' : '; SameSite=Lax; HttpOnly';
}

export async function buildSessionCookie(entitlement, env, request) {
  const ent = normalizeEntitlement(entitlement);
  const secret = getSecret(env);
  const token = await signPayload(ent, secret);
  const maxAge =
    ent.expiresAt == null
      ? MAX_AGE_FOREVER
      : Math.max(60, Math.floor((ent.expiresAt - Date.now()) / 1000));
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}${cookieFlags(request)}`;
}

export function clearSessionCookie(request) {
  return `${COOKIE_NAME}=; Path=/; Max-Age=0${cookieFlags(request)}`;
}

export function jsonResponse(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign(
      {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      },
      headers || {}
    )
  });
}
