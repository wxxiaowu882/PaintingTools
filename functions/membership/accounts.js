/**
 * 学员账号（务实 2C）：手机号+密码，可选微信备注；每账号最多 3 台设备。
 * KV：acct:{accountId}、phone:{phone}
 */
import { getSecret } from './session.js';

const MAX_DEVICES = 3;
const ACCT_PREFIX = 'acct:';
const PHONE_PREFIX = 'phone:';

function kv(env) {
  return env && env.MEMBERSHIP_KV ? env.MEMBERSHIP_KV : null;
}

export function normalizePhone(raw) {
  const s = String(raw || '').trim().replace(/[\s-]/g, '');
  if (/^1\d{10}$/.test(s)) return s;
  if (/^\+?\d{8,15}$/.test(s)) return s.replace(/^\+/, '');
  return '';
}

function b64(buf) {
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

async function hashPassword(password, saltB64, secret) {
  const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(String(password) + '|' + String(secret || '')),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return b64(bits);
}

async function newPassRecord(password, secret) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const saltB64 = b64(salt);
  const passHash = await hashPassword(password, saltB64, secret);
  return { saltB64, passHash };
}

export async function loadAccount(env, accountId) {
  const store = kv(env);
  if (!store || !accountId) return null;
  const raw = await store.get(ACCT_PREFIX + accountId);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_e) {
    return null;
  }
}

export async function saveAccountRaw(env, acct) {
  const store = kv(env);
  if (!store) return { ok: false, error: '未开通发码记录本，无法使用账号' };
  acct.updatedAt = Date.now();
  await store.put(ACCT_PREFIX + acct.accountId, JSON.stringify(acct));
  if (acct.phone) {
    await store.put(PHONE_PREFIX + acct.phone, acct.accountId);
  }
  return { ok: true };
}

async function saveAccount(env, acct) {
  return saveAccountRaw(env, acct);
}

/** 宣传/归因相关字段兜底（不改已有值） */
export function ensureAccountFields(acct) {
  if (!acct) return acct;
  if (acct.promoCode == null) acct.promoCode = null;
  if (acct.referredByAccountId == null) acct.referredByAccountId = null;
  if (acct.referredByPromoCode == null) acct.referredByPromoCode = null;
  if (acct.referredAt == null) acct.referredAt = null;
  if (acct.referralRewardCountMonth == null) acct.referralRewardCountMonth = 0;
  if (acct.referralRewardMonthKey == null) acct.referralRewardMonthKey = null;
  if (acct.referralRewardTotal == null) acct.referralRewardTotal = 0;
  return acct;
}

export async function findAccountByPhone(env, phone) {
  const store = kv(env);
  const p = normalizePhone(phone);
  if (!store || !p) return null;
  const id = await store.get(PHONE_PREFIX + p);
  if (!id) return null;
  return loadAccount(env, id);
}

function publicAccount(acct) {
  if (!acct) return null;
  return {
    accountId: acct.accountId,
    phone: acct.phone,
    wechatNote: acct.wechatNote || '',
    entitlement: acct.entitlement || null,
    promoCode: acct.promoCode || null,
    referredByAccountId: acct.referredByAccountId || null,
    devices: (acct.devices || []).map((d) => ({
      deviceId: d.deviceId,
      label: d.label || '',
      boundAt: d.boundAt,
      lastSeenAt: d.lastSeenAt
    }))
  };
}

/**
 * 绑定/刷新设备；超过 3 台时踢掉最早一台（2B）。
 * @returns {{ ok, account, kickedDeviceId? , error? }}
 */
export function touchDevice(acct, deviceId, label) {
  const id = String(deviceId || '').trim();
  if (!id || id.length < 8) return { ok: false, error: '设备标识无效' };
  const now = Date.now();
  const devices = Array.isArray(acct.devices) ? acct.devices.slice() : [];
  const idx = devices.findIndex((d) => d.deviceId === id);
  let kickedDeviceId = null;
  if (idx >= 0) {
    devices[idx].lastSeenAt = now;
    if (label) devices[idx].label = String(label).slice(0, 40);
  } else {
    if (devices.length >= MAX_DEVICES) {
      devices.sort((a, b) => (a.lastSeenAt || a.boundAt || 0) - (b.lastSeenAt || b.boundAt || 0));
      const kicked = devices.shift();
      kickedDeviceId = kicked ? kicked.deviceId : null;
    }
    devices.push({
      deviceId: id,
      label: String(label || '').slice(0, 40),
      boundAt: now,
      lastSeenAt: now
    });
  }
  acct.devices = devices;
  return { ok: true, account: acct, kickedDeviceId };
}

export function deviceAllowed(acct, deviceId) {
  if (!acct || !deviceId) return false;
  return (acct.devices || []).some((d) => d.deviceId === deviceId);
}

export async function registerAccount(env, opts) {
  const store = kv(env);
  if (!store) return { ok: false, error: '未开通存储，无法注册账号' };
  const phone = normalizePhone(opts && opts.phone);
  const password = String((opts && opts.password) || '');
  const wechatNote = String((opts && opts.wechatNote) || '').trim().slice(0, 40);
  const deviceId = String((opts && opts.deviceId) || '').trim();
  if (!phone) return { ok: false, error: '请填写正确的手机号' };
  if (password.length < 6) return { ok: false, error: '密码至少 6 位' };
  if (await findAccountByPhone(env, phone)) {
    return { ok: false, error: '该手机号已注册，请直接登录' };
  }
  const secret = getSecret(env);
  const pass = await newPassRecord(password, secret);
  const accountId = crypto.randomUUID();
  let acct = {
    accountId,
    phone,
    wechatNote,
    passHash: pass.passHash,
    saltB64: pass.saltB64,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    entitlement: { tierId: 'free', level: 'user', expiresAt: null, source: 'register' },
    devices: []
  };
  const touched = touchDevice(acct, deviceId, opts && opts.deviceLabel);
  if (!touched.ok) return touched;
  acct = touched.account;
  const saved = await saveAccount(env, acct);
  if (!saved.ok) return saved;
  return {
    ok: true,
    account: publicAccount(acct),
    kickedDeviceId: touched.kickedDeviceId
  };
}

export async function loginAccount(env, opts) {
  const phone = normalizePhone(opts && opts.phone);
  const password = String((opts && opts.password) || '');
  const deviceId = String((opts && opts.deviceId) || '').trim();
  if (!phone || password.length < 6) return { ok: false, error: '手机号或密码不对' };
  let acct = await findAccountByPhone(env, phone);
  if (!acct) return { ok: false, error: '账号不存在，请先注册' };
  const secret = getSecret(env);
  const hash = await hashPassword(password, acct.saltB64, secret);
  if (hash !== acct.passHash) return { ok: false, error: '手机号或密码不对' };
  if (opts && opts.wechatNote) {
    acct.wechatNote = String(opts.wechatNote).trim().slice(0, 40);
  }
  const touched = touchDevice(acct, deviceId, opts && opts.deviceLabel);
  if (!touched.ok) return touched;
  acct = touched.account;
  const saved = await saveAccount(env, acct);
  if (!saved.ok) return saved;
  return {
    ok: true,
    account: publicAccount(acct),
    kickedDeviceId: touched.kickedDeviceId
  };
}

/** 把兑换权益写入账号（取更长有效期 / 更高档简单合并：直接覆盖为新 grant） */
export async function applyEntitlementToAccount(env, accountId, entitlement, deviceId) {
  let acct = await loadAccount(env, accountId);
  if (!acct) return { ok: false, error: '账号不存在' };
  if (deviceId && !deviceAllowed(acct, deviceId)) {
    const touched = touchDevice(acct, deviceId, '');
    if (!touched.ok) return touched;
    acct = touched.account;
  }
  acct.entitlement = Object.assign({}, entitlement);
  const saved = await saveAccount(env, acct);
  if (!saved.ok) return saved;
  return { ok: true, account: publicAccount(acct) };
}

export async function removeDevice(env, accountId, deviceId) {
  let acct = await loadAccount(env, accountId);
  if (!acct) return { ok: false, error: '账号不存在' };
  const id = String(deviceId || '').trim();
  const before = acct.devices || [];
  if (!before.some((d) => d.deviceId === id)) {
    return { ok: false, error: '该账号下没有这台设备' };
  }
  acct.devices = before.filter((d) => d.deviceId !== id);
  const saved = await saveAccount(env, acct);
  if (!saved.ok) return saved;
  return { ok: true, account: publicAccount(acct) };
}

/** 运营台：按手机号查账号 */
export async function adminFindByPhone(env, phoneRaw) {
  const acct = await findAccountByPhone(env, phoneRaw);
  if (!acct) return { ok: false, error: '未找到该手机号' };
  return { ok: true, account: publicAccount(acct) };
}

/**
 * 运营台：列出全部学员账号（KV list prefix acct:）。
 * opts.cursor / opts.limit 分页；默认拉满（多页合并，上限 2000）。
 */
export async function adminListAccounts(env, opts) {
  const store = kv(env);
  if (!store) return { ok: false, error: '未开通账号存储（MEMBERSHIP_KV）' };
  const o = opts && typeof opts === 'object' ? opts : {};
  let limit = Number(o.limit);
  if (!Number.isFinite(limit) || limit <= 0) limit = 200;
  limit = Math.min(200, Math.max(1, Math.floor(limit)));
  const maxTotal = Math.min(2000, Number(o.maxTotal) > 0 ? Math.floor(Number(o.maxTotal)) : 2000);
  const accounts = [];
  let cursor = o.cursor != null && String(o.cursor) ? String(o.cursor) : undefined;
  let pages = 0;
  while (accounts.length < maxTotal && pages < 50) {
    pages++;
    const listOpts = { prefix: ACCT_PREFIX, limit };
    if (cursor) listOpts.cursor = cursor;
    const listed = await store.list(listOpts);
    const keys = (listed && listed.keys) || [];
    for (const k of keys) {
      if (accounts.length >= maxTotal) break;
      const name = k && k.name != null ? String(k.name) : '';
      if (!name.startsWith(ACCT_PREFIX)) continue;
      const raw = await store.get(name);
      if (!raw) continue;
      let acct;
      try {
        acct = JSON.parse(raw);
      } catch (_e) {
        continue;
      }
      if (!acct || typeof acct !== 'object') continue;
      accounts.push(publicAccount(acct));
    }
    const complete = !!(listed && listed.list_complete);
    cursor = listed && listed.cursor != null ? String(listed.cursor) : '';
    if (complete || !cursor) {
      cursor = '';
      break;
    }
    // 单页模式：调用方传了 cursor 且只要一页
    if (o.singlePage) break;
  }
  accounts.sort((a, b) => String(a.phone || '').localeCompare(String(b.phone || ''), 'zh-CN'));
  return {
    ok: true,
    accounts,
    cursor: cursor || null,
    truncated: accounts.length >= maxTotal
  };
}

/** 运营台：人工重置密码（无短信） */
export async function adminResetPassword(env, phoneRaw, newPassword) {
  const password = String(newPassword || '');
  if (password.length < 6) return { ok: false, error: '新密码至少 6 位' };
  let acct = await findAccountByPhone(env, phoneRaw);
  if (!acct) return { ok: false, error: '未找到该手机号' };
  const secret = getSecret(env);
  const pass = await newPassRecord(password, secret);
  acct.passHash = pass.passHash;
  acct.saltB64 = pass.saltB64;
  const saved = await saveAccount(env, acct);
  if (!saved.ok) return saved;
  return { ok: true, account: publicAccount(acct) };
}

/** 运营台：改微信备注 */
export async function adminUpdateNote(env, phoneRaw, wechatNote) {
  let acct = await findAccountByPhone(env, phoneRaw);
  if (!acct) return { ok: false, error: '未找到该手机号' };
  acct.wechatNote = String(wechatNote || '').trim().slice(0, 40);
  const saved = await saveAccount(env, acct);
  if (!saved.ok) return saved;
  return { ok: true, account: publicAccount(acct) };
}

/** 运营台：踢设备（单账号 1 读 1 写） */
export async function adminRemoveDevice(env, phoneRaw, deviceId) {
  let acct = await findAccountByPhone(env, phoneRaw);
  if (!acct) return { ok: false, error: '未找到该手机号' };
  const id = String(deviceId || '').trim();
  if (!id) return { ok: false, error: '缺少设备 ID' };
  const result = await removeDevice(env, acct.accountId, id);
  if (!result.ok) return result;
  return { ok: true, account: result.account };
}

/**
 * 按账号 ID 延期高级会员（天）。已是高级则在现到期日上加；否则从今天起算并升高级。
 * forever 档返回错误。宣传奖励与运营台共用。
 */
export async function extendMemberByDays(env, accountId, daysRaw, sourceTag) {
  let acct = await loadAccount(env, accountId);
  if (!acct) return { ok: false, error: '账号不存在' };
  const days = Math.min(3660, Math.max(1, parseInt(daysRaw, 10) || 0));
  if (!days) return { ok: false, error: '延期天数至少 1 天' };
  const ent = Object.assign({}, acct.entitlement || {});
  const now = Date.now();
  const tierId = ent.tierId || 'member_3m';
  if (tierId === 'member_forever' && ent.level === 'member' && !ent.expiresAt) {
    return { ok: false, error: '永久档无需延期' };
  }
  let base = now;
  if (ent.level === 'member' && ent.expiresAt && Number(ent.expiresAt) > now) {
    base = Number(ent.expiresAt);
  }
  ent.level = 'member';
  if (!ent.tierId || ent.tierId === 'free') ent.tierId = 'member_3m';
  ent.expiresAt = base + days * 86400000;
  // 宣传奖励改写来源；运营延期尽量保留原兑码来源便于对账
  if (sourceTag === 'referral_reward') ent.source = 'referral_reward';
  else if (!ent.source) ent.source = sourceTag || 'admin_extend';
  acct.entitlement = ent;
  const saved = await saveAccount(env, acct);
  if (!saved.ok) return saved;
  return { ok: true, account: publicAccount(acct) };
}

/**
 * 运营台：延期高级会员（天）。
 */
export async function adminExtendMember(env, phoneRaw, daysRaw) {
  let acct = await findAccountByPhone(env, phoneRaw);
  if (!acct) return { ok: false, error: '未找到该手机号' };
  return extendMemberByDays(env, acct.accountId, daysRaw, 'admin_extend');
}

/** 运营台：取消高级权益（退回注册会员档）。保留 redeemCode 便于对账。 */
export async function adminRevokeMember(env, phoneRaw) {
  let acct = await findAccountByPhone(env, phoneRaw);
  if (!acct) return { ok: false, error: '未找到该手机号' };
  const prev = acct.entitlement || {};
  acct.entitlement = {
    tierId: 'free',
    level: 'user',
    expiresAt: null,
    source: 'admin_revoke',
    redeemedAt: prev.redeemedAt || null,
    jti: prev.jti || null,
    redeemCode: prev.redeemCode || null
  };
  const saved = await saveAccount(env, acct);
  if (!saved.ok) return saved;
  return { ok: true, account: publicAccount(acct) };
}

export { MAX_DEVICES, publicAccount };
