/**
 * 学员账号（务实 2C）：手机号+密码，可选微信备注。
 * 设备白名单最多 3 台；同时在线会话最多 2 处（看课+对照场景）。
 * KV：acct:{accountId}、phone:{phone}
 */
import { getSecret } from './session.js';
import { beijingDayKey, bumpDailyStats } from './daily-stats.js';

const MAX_DEVICES = 3;
/** 同时在线会话上限（与设备白名单分开；第 3 处登录踢最老会话，不删白名单） */
const MAX_CONCURRENT_SESSIONS = 2;
/** 购课开通：站内 Pro 覆盖重算天数（与 tiers member_3y 一致） */
const COURSE_PRO_DAYS = 1095;
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

/** 站内显示名（昵称）；登录仍用手机号。2～12 字，去首尾空白。 */
export function normalizeDisplayName(raw) {
  const s = String(raw || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
  if (s.length < 2 || s.length > 12) return '';
  return s;
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

/** 宣传/归因/课包字段兜底（不改已有值） */
export function ensureAccountFields(acct) {
  if (!acct) return acct;
  if (acct.promoCode == null) acct.promoCode = null;
  if (acct.referredByAccountId == null) acct.referredByAccountId = null;
  if (acct.referredByPromoCode == null) acct.referredByPromoCode = null;
  if (acct.referredAt == null) acct.referredAt = null;
  if (acct.referralRewardCountMonth == null) acct.referralRewardCountMonth = 0;
  if (acct.referralRewardMonthKey == null) acct.referralRewardMonthKey = null;
  if (acct.referralRewardTotal == null) acct.referralRewardTotal = 0;
  if (!Array.isArray(acct.coursePacks)) acct.coursePacks = [];
  if (!Array.isArray(acct.activeSessions)) acct.activeSessions = [];
  return acct;
}

/** 归一课包清单（去重；永久可看，与 Pro 到期脱钩） */
export function normalizeCoursePacks(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    const packId = String(
      (item && typeof item === 'object' ? item.packId : item) || ''
    ).trim();
    if (!packId || seen.has(packId)) continue;
    seen.add(packId);
    out.push({
      packId,
      title: String((item && item.title) || '').trim().slice(0, 80),
      grantedAt: Number((item && item.grantedAt) || 0) || Date.now(),
      source: String((item && item.source) || 'admin_grant').trim().slice(0, 40)
    });
  }
  return out;
}

export function accountHasCoursePack(acct, packId) {
  const id = String(packId || '').trim();
  if (!id || !acct) return false;
  return normalizeCoursePacks(acct.coursePacks).some((p) => p.packId === id);
}

function randomInitialPassword(len) {
  const n = Math.min(16, Math.max(6, parseInt(len, 10) || 8));
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const buf = crypto.getRandomValues(new Uint8Array(n));
  let s = '';
  for (let i = 0; i < n; i++) s += chars[buf[i] % chars.length];
  return s;
}

export async function findAccountByPhone(env, phone) {
  const store = kv(env);
  const p = normalizePhone(phone);
  if (!store || !p) return null;
  const id = await store.get(PHONE_PREFIX + p);
  if (!id) return null;
  return loadAccount(env, id);
}

/** 账号最近活跃：各设备 lastSeenAt 取最大；无设备则退回注册时间 */
export function accountLastActiveAt(acct) {
  if (!acct) return null;
  let max = 0;
  const devices = acct.devices || [];
  for (let i = 0; i < devices.length; i++) {
    const t = Number(devices[i] && devices[i].lastSeenAt) || 0;
    if (t > max) max = t;
  }
  if (max > 0) return max;
  const created = Number(acct.createdAt) || 0;
  return created > 0 ? created : null;
}

function publicAccount(acct) {
  if (!acct) return null;
  return {
    accountId: acct.accountId,
    phone: acct.phone,
    displayName: acct.displayName || '',
    wechatNote: acct.wechatNote || '',
    createdAt: acct.createdAt || null,
    lastActiveAt: accountLastActiveAt(acct),
    entitlement: acct.entitlement || null,
    coursePacks: normalizeCoursePacks(acct.coursePacks),
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

/**
 * 刷新同时在线会话；超过 MAX_CONCURRENT_SESSIONS 时踢掉最久未活跃的一处（不删设备白名单）。
 * 首次建立会话表时，用现有设备按 lastSeenAt 预填最多 2 条，避免旧账号一登录就把其它端全踢光。
 * @returns {{ ok, account, kickedSessionDeviceId?, error? }}
 */
export function touchSession(acct, deviceId) {
  const id = String(deviceId || '').trim();
  if (!id || id.length < 8) return { ok: false, error: '设备标识无效' };
  const now = Date.now();
  let sessions = Array.isArray(acct.activeSessions) ? acct.activeSessions.slice() : [];

  if (sessions.length === 0 && Array.isArray(acct.devices) && acct.devices.length) {
    const sorted = acct.devices.slice().sort(function (a, b) {
      return (Number(b.lastSeenAt) || 0) - (Number(a.lastSeenAt) || 0);
    });
    sessions = sorted.slice(0, MAX_CONCURRENT_SESSIONS).map(function (d) {
      return {
        deviceId: d.deviceId,
        lastActiveAt: Number(d.lastSeenAt) || Number(d.boundAt) || now
      };
    });
  }

  let kickedSessionDeviceId = null;
  const idx = sessions.findIndex(function (s) {
    return s && s.deviceId === id;
  });
  if (idx >= 0) {
    sessions[idx].lastActiveAt = now;
  } else {
    if (sessions.length >= MAX_CONCURRENT_SESSIONS) {
      sessions.sort(function (a, b) {
        return (Number(a.lastActiveAt) || 0) - (Number(b.lastActiveAt) || 0);
      });
      const kicked = sessions.shift();
      kickedSessionDeviceId = kicked ? kicked.deviceId : null;
    }
    sessions.push({ deviceId: id, lastActiveAt: now });
  }
  acct.activeSessions = sessions;
  return { ok: true, account: acct, kickedSessionDeviceId: kickedSessionDeviceId };
}

/** 是否仍在同时在线名额内。尚无会话表时放行（兼容旧数据，待下次登录写入）。 */
export function sessionAllowed(acct, deviceId) {
  if (!acct || !deviceId) return false;
  const sessions = acct.activeSessions;
  if (!Array.isArray(sessions) || sessions.length === 0) return true;
  return sessions.some(function (s) {
    return s && s.deviceId === deviceId;
  });
}

export async function registerAccount(env, opts) {
  const store = kv(env);
  if (!store) return { ok: false, error: '未开通存储，无法注册账号' };
  const phone = normalizePhone(opts && opts.phone);
  const password = String((opts && opts.password) || '');
  const displayName = normalizeDisplayName(opts && opts.displayName);
  const wechatNote = String((opts && opts.wechatNote) || '').trim().slice(0, 40);
  const deviceId = String((opts && opts.deviceId) || '').trim();
  if (!phone) return { ok: false, error: '请填写正确的手机号' };
  if (!displayName) return { ok: false, error: '请填写昵称（2～12 个字）' };
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
    displayName,
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
  const sess = touchSession(acct, deviceId);
  if (!sess.ok) return sess;
  acct = sess.account;
  // 注册当日计 注册+登录（同账号日去重标记，与账号同一次写入）
  acct.statsLoginDay = beijingDayKey();
  const saved = await saveAccount(env, acct);
  if (!saved.ok) return saved;
  try {
    await bumpDailyStats(env, { register: 1, login: 1 });
  } catch (_eStat) {}
  return {
    ok: true,
    account: publicAccount(acct),
    kickedDeviceId: touched.kickedDeviceId,
    kickedSessionDeviceId: sess.kickedSessionDeviceId || null
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
  const sess = touchSession(acct, deviceId);
  if (!sess.ok) return sess;
  acct = sess.account;
  const day = beijingDayKey();
  let loginBump = 0;
  if (acct.statsLoginDay !== day) {
    acct.statsLoginDay = day;
    loginBump = 1;
  }
  const saved = await saveAccount(env, acct);
  if (!saved.ok) return saved;
  if (loginBump) {
    try {
      await bumpDailyStats(env, { login: 1 });
    } catch (_eStat) {}
  }
  return {
    ok: true,
    account: publicAccount(acct),
    kickedDeviceId: touched.kickedDeviceId,
    kickedSessionDeviceId: sess.kickedSessionDeviceId || null
  };
}

/**
 * 日活上报：同账号同北京日只 +1。已计过则只读账号、不写 KV（省点数）。
 * 可选刷新已绑定设备的 lastSeen（不借此绑新设备）。
 */
export async function noteDailyActive(env, accountId, opts) {
  let acct = await loadAccount(env, accountId);
  if (!acct) return { ok: false, error: '账号不存在' };
  const day = beijingDayKey();
  if (acct.statsLoginDay === day) {
    return { ok: true, counted: false, account: publicAccount(acct) };
  }
  const deviceId = opts && opts.deviceId ? String(opts.deviceId).trim() : '';
  if (deviceId && deviceAllowed(acct, deviceId)) {
    const touched = touchDevice(acct, deviceId, (opts && opts.deviceLabel) || '');
    if (touched.ok) acct = touched.account;
  }
  acct.statsLoginDay = day;
  const saved = await saveAccount(env, acct);
  if (!saved.ok) return saved;
  try {
    await bumpDailyStats(env, { login: 1 });
  } catch (_eStat) {}
  return { ok: true, counted: true, account: publicAccount(acct) };
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
  const day = beijingDayKey();
  let redeemBump = 0;
  if (acct.statsRedeemDay !== day) {
    acct.statsRedeemDay = day;
    redeemBump = 1;
  }
  const saved = await saveAccount(env, acct);
  if (!saved.ok) return saved;
  if (redeemBump) {
    try {
      await bumpDailyStats(env, { redeem: 1 });
    } catch (_eStat) {}
  }
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
  if (Array.isArray(acct.activeSessions)) {
    acct.activeSessions = acct.activeSessions.filter((s) => s && s.deviceId !== id);
  }
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
 * 宣传奖励与运营台共用。
 */
export async function extendMemberByDays(env, accountId, daysRaw, sourceTag) {
  let acct = await loadAccount(env, accountId);
  if (!acct) return { ok: false, error: '账号不存在' };
  const days = Math.min(3660, Math.max(1, parseInt(daysRaw, 10) || 0));
  if (!days) return { ok: false, error: '延期天数至少 1 天' };
  const ent = Object.assign({}, acct.entitlement || {});
  const now = Date.now();
  let base = now;
  if (ent.level === 'member' && ent.expiresAt && Number(ent.expiresAt) > now) {
    base = Number(ent.expiresAt);
  }
  ent.level = 'member';
  if (!ent.tierId || ent.tierId === 'free') ent.tierId = 'member_3m';
  // 旧测试「永久」档无到期日：延期时落到有期限，便于统一管理
  if (ent.tierId === 'member_forever') ent.tierId = 'member_3y';
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
  // 故意不清 coursePacks：课包永久，与取消高级脱钩
  const saved = await saveAccount(env, acct);
  if (!saved.ok) return saved;
  return { ok: true, account: publicAccount(acct) };
}

/**
 * 运营台：开通学员 = 三年 Pro（开通日起覆盖重算）+ 追加永久课包。
 * 无账号则开户（可指定密码，否则随机生成并在 initialPassword 返回）。
 * opts: { phone, packId, packTitle?, password?, displayName?, wechatNote? }
 */
export async function adminGrantCourseStudent(env, opts) {
  const store = kv(env);
  if (!store) return { ok: false, error: '未开通账号存储（MEMBERSHIP_KV）' };
  const phone = normalizePhone(opts && opts.phone);
  const packId = String((opts && opts.packId) || '').trim();
  const packTitle = String((opts && opts.packTitle) || '').trim().slice(0, 80);
  if (!phone) return { ok: false, error: '请填写正确的手机号' };
  if (!packId) return { ok: false, error: '请选择课包' };

  let acct = await findAccountByPhone(env, phone);
  let created = false;
  let initialPassword = null;

  if (!acct) {
    let password = String((opts && opts.password) || '');
    if (password.length < 6) {
      password = randomInitialPassword(8);
    }
    initialPassword = password;
    const displayName =
      normalizeDisplayName(opts && opts.displayName) ||
      normalizeDisplayName('学员' + phone.slice(-4)) ||
      '学员用户';
    const secret = getSecret(env);
    const pass = await newPassRecord(password, secret);
    acct = {
      accountId: crypto.randomUUID(),
      phone,
      displayName,
      wechatNote: String((opts && opts.wechatNote) || '').trim().slice(0, 40),
      passHash: pass.passHash,
      saltB64: pass.saltB64,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      entitlement: { tierId: 'free', level: 'user', expiresAt: null, source: 'register' },
      devices: [],
      coursePacks: []
    };
    created = true;
  } else if (opts && opts.wechatNote) {
    const note = String(opts.wechatNote || '').trim().slice(0, 40);
    if (note) acct.wechatNote = note;
  }

  ensureAccountFields(acct);
  const now = Date.now();
  const packs = normalizeCoursePacks(acct.coursePacks);
  const alreadyHadPack = packs.some((p) => p.packId === packId);
  if (!alreadyHadPack) {
    packs.push({
      packId,
      title: packTitle,
      grantedAt: now,
      source: 'admin_grant'
    });
  }
  acct.coursePacks = packs;

  const prev = acct.entitlement || {};
  acct.entitlement = {
    tierId: 'member_3y',
    level: 'member',
    expiresAt: now + COURSE_PRO_DAYS * 86400000,
    source: 'course_purchase',
    redeemedAt: now,
    jti: prev.jti || null,
    redeemCode: prev.redeemCode || null,
    lastCoursePackId: packId
  };

  const saved = await saveAccount(env, ensureAccountFields(acct));
  if (!saved.ok) return saved;
  return {
    ok: true,
    created,
    alreadyHadPack,
    initialPassword,
    account: publicAccount(acct)
  };
}

/** 运营台：仅撤销某一课包（不改 Pro） */
export async function adminRevokeCoursePack(env, phoneRaw, packIdRaw) {
  const packId = String(packIdRaw || '').trim();
  if (!packId) return { ok: false, error: '缺少课包 ID' };
  let acct = await findAccountByPhone(env, phoneRaw);
  if (!acct) return { ok: false, error: '未找到该手机号' };
  ensureAccountFields(acct);
  const before = normalizeCoursePacks(acct.coursePacks);
  if (!before.some((p) => p.packId === packId)) {
    return { ok: false, error: '该账号没有此课包' };
  }
  acct.coursePacks = before.filter((p) => p.packId !== packId);
  const saved = await saveAccount(env, acct);
  if (!saved.ok) return saved;
  return { ok: true, account: publicAccount(acct) };
}

export { MAX_DEVICES, MAX_CONCURRENT_SESSIONS, COURSE_PRO_DAYS, publicAccount };
