import {
  getAdminPassword,
  issueAdminCookie,
  clearAdminCookie,
  jsonResponse
} from '../../../membership/admin-auth.js';
import {
  bumpRateLimit,
  clientIp,
  peekRateLimited,
  rateLimitHeaders
} from '../../../membership/rate-limit.js';

/** 运营台：同 IP 口令失败 15 分钟内最多 10 次（链接保密不等于安全） */
const WIN = 15 * 60;
const LIM_IP = 10;

export async function onRequestPost(context) {
  let body;
  try {
    body = await context.request.json();
  } catch (_e) {
    return jsonResponse({ ok: false, error: '请求无效' }, 400);
  }

  const ip = clientIp(context.request);
  const bucket = 'admin:ip:' + ip;
  const gate = await peekRateLimited(context.env, bucket, LIM_IP, WIN);
  if (!gate.ok) {
    return jsonResponse({ ok: false, error: gate.error }, 429, rateLimitHeaders(gate));
  }

  const expected = getAdminPassword(context.env, context.request);
  if (!expected) {
    return jsonResponse({
      ok: false,
      error: '还没设置运营口令。请在 Cloudflare 里添加 Secret：MEMBERSHIP_ADMIN_PASSWORD（至少 6 位）'
    }, 503);
  }
  if (String(body.password || '') !== expected) {
    await bumpRateLimit(context.env, bucket, LIM_IP, WIN);
    return jsonResponse({ ok: false, error: '口令不对' }, 401);
  }
  const cookie = await issueAdminCookie(context.env, context.request);
  return jsonResponse({ ok: true }, 200, { 'Set-Cookie': cookie });
}

export async function onRequestDelete(context) {
  return jsonResponse({ ok: true }, 200, { 'Set-Cookie': clearAdminCookie(context.request) });
}
