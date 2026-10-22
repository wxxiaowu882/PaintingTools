import {
  getAdminPassword,
  issueAdminCookie,
  clearAdminCookie,
  jsonResponse
} from '../../../membership/admin-auth.js';

export async function onRequestPost(context) {
  let body;
  try {
    body = await context.request.json();
  } catch (_e) {
    return jsonResponse({ ok: false, error: '请求无效' }, 400);
  }
  const expected = getAdminPassword(context.env);
  if (!expected) {
    return jsonResponse({
      ok: false,
      error: '还没设置运营口令。请在 Cloudflare 里添加 Secret：MEMBERSHIP_ADMIN_PASSWORD（至少 6 位）'
    }, 503);
  }
  if (String(body.password || '') !== expected) {
    return jsonResponse({ ok: false, error: '口令不对' }, 401);
  }
  const cookie = await issueAdminCookie(context.env);
  return jsonResponse({ ok: true }, 200, { 'Set-Cookie': cookie });
}

export async function onRequestDelete(context) {
  return jsonResponse({ ok: true }, 200, { 'Set-Cookie': clearAdminCookie() });
}
