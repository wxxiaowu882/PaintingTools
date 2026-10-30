/**
 * 简易 KV 限速（正式防刷够用；无 KV 时放行以免本地预览卡死）
 * bucket 例：login:ip:1.2.3.4 / login:phone:138xxxx / admin:ip:…
 */

function kv(env) {
  return env && env.MEMBERSHIP_KV ? env.MEMBERSHIP_KV : null;
}

export function clientIp(request) {
  const cf = request && request.headers && request.headers.get('CF-Connecting-IP');
  if (cf && String(cf).trim()) return String(cf).trim();
  const xff = request && request.headers && request.headers.get('X-Forwarded-For');
  if (xff) {
    const first = String(xff).split(',')[0].trim();
    if (first) return first;
  }
  return 'unknown';
}

/**
 * @returns {{ ok: true, remaining?: number } | { ok: false, error: string, retryAfterSec: number }}
 */
export async function assertRateLimit(env, bucket, limit, windowSec) {
  const store = kv(env);
  if (!store) return { ok: true, skipped: true };
  const key = 'rl:' + String(bucket || '').slice(0, 120);
  if (!bucket) return { ok: true, skipped: true };

  const now = Date.now();
  const winMs = Math.max(30, Number(windowSec) || 900) * 1000;
  const max = Math.max(1, Number(limit) || 10);

  let data = { n: 0, resetAt: now + winMs };
  try {
    const raw = await store.get(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') data = parsed;
    }
  } catch (_e) {}

  if (!data.resetAt || now >= data.resetAt) {
    data = { n: 0, resetAt: now + winMs };
  }

  if (data.n >= max) {
    const retryAfterSec = Math.max(1, Math.ceil((data.resetAt - now) / 1000));
    return {
      ok: false,
      error: '尝试过于频繁，请 ' + retryAfterSec + ' 秒后再试',
      retryAfterSec
    };
  }

  data.n += 1;
  const ttl = Math.max(60, Math.ceil((data.resetAt - now) / 1000) + 30);
  try {
    await store.put(key, JSON.stringify(data), { expirationTtl: ttl });
  } catch (_e) {
    return { ok: true, skipped: true };
  }
  return { ok: true, remaining: Math.max(0, max - data.n) };
}

/** 登录类：仅失败计数时先读、超限再拦（成功不记） */
export async function peekRateLimited(env, bucket, limit, windowSec) {
  const store = kv(env);
  if (!store || !bucket) return { ok: true, skipped: true };
  const key = 'rl:' + String(bucket).slice(0, 120);
  const now = Date.now();
  const winMs = Math.max(30, Number(windowSec) || 900) * 1000;
  const max = Math.max(1, Number(limit) || 10);
  try {
    const raw = await store.get(key);
    if (!raw) return { ok: true };
    const data = JSON.parse(raw);
    if (!data || now >= data.resetAt) return { ok: true };
    if (data.n >= max) {
      const retryAfterSec = Math.max(1, Math.ceil((data.resetAt - now) / 1000));
      return {
        ok: false,
        error: '尝试过于频繁，请 ' + retryAfterSec + ' 秒后再试',
        retryAfterSec
      };
    }
  } catch (_e) {
    return { ok: true, skipped: true };
  }
  return { ok: true };
}

export async function bumpRateLimit(env, bucket, limit, windowSec) {
  return assertRateLimit(env, bucket, limit, windowSec);
}

export function rateLimitHeaders(result) {
  if (!result || result.ok || !result.retryAfterSec) return {};
  return { 'Retry-After': String(result.retryAfterSec) };
}
