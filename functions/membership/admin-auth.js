import { getSecret, signPayload, verifySigned, parseCookies, jsonResponse, cookieFlags } from './session.js';

export const ADMIN_COOKIE = 'wuxiao_ops';

/**
 * 运营台登录密码：
 * 1) Cloudflare Secrets / 环境变量 MEMBERSHIP_ADMIN_PASSWORD
 * 2) 仍是开发默认总钥匙时允许 ops-local（仅防未配口令时完全锁死；正式务必设 Secret）
 */
export function getAdminPassword(env, _request) {
  const p = env && env.MEMBERSHIP_ADMIN_PASSWORD;
  if (p && String(p).length >= 6) return String(p);
  const secret = getSecret(env);
  if (secret === 'dev-only-wuxiao-membership-change-me') return 'ops-local';
  return null;
}

export async function issueAdminCookie(env, request) {
  const secret = getSecret(env);
  const token = await signPayload(
    { role: 'ops', exp: Date.now() + 12 * 3600 * 1000 },
    secret + '|ops'
  );
  return `${ADMIN_COOKIE}=${encodeURIComponent(token)}; Path=/; Max-Age=${12 * 3600}${cookieFlags(request)}`;
}

export function clearAdminCookie(request) {
  return `${ADMIN_COOKIE}=; Path=/; Max-Age=0${cookieFlags(request)}`;
}

export async function requireAdmin(context) {
  const env = context.env;
  const pwdConfigured = !!getAdminPassword(env, context.request);
  const cookies = parseCookies(context.request.headers.get('Cookie'));
  const raw = cookies[ADMIN_COOKIE];
  if (!raw) {
    return { ok: false, response: jsonResponse({ ok: false, error: '请先登录运营后台', needLogin: true }, 401) };
  }
  let payload;
  try {
    payload = await verifySigned(decodeURIComponent(raw), getSecret(env) + '|ops');
  } catch (_e) {
    payload = null;
  }
  if (!payload || payload.role !== 'ops' || (payload.exp && payload.exp < Date.now())) {
    return { ok: false, response: jsonResponse({ ok: false, error: '登录已过期，请重新登录', needLogin: true }, 401) };
  }
  return { ok: true, pwdConfigured };
}

export { jsonResponse };
