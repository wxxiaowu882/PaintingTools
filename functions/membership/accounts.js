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

async function saveAccount(env, acct) {
  const store = kv(env);
  if (!store) return { ok: false, error: '未开通发码记录本，无法使用账号' };
  acct.updatedAt = Date.now();
  await store.put(ACCT_PREFIX + acct.accountId, JSON.stringify(acct));
  if (acct.phone) {
    await store.put(PHONE_PREFIX + acct.phone, acct.accountId);
  }
  return { ok: true };
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
    entitlement: { tierId: 'free', level: 'free', expiresAt: null, source: 'register' },
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
  acct.devices = (acct.devices || []).filter((d) => d.deviceId !== deviceId);
  const saved = await saveAccount(env, acct);
  if (!saved.ok) return saved;
  return { ok: true, account: publicAccount(acct) };
}

export { MAX_DEVICES, publicAccount };
