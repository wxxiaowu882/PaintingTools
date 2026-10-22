import { resolveRedeemCode, buildEntitlementFromGrant } from '../../membership/codes.js';
import {
  buildSessionCookie,
  jsonResponse,
  normalizeEntitlement
} from '../../membership/session.js';

export async function onRequestPost(context) {
  let body;
  try {
    body = await context.request.json();
  } catch (_e) {
    return jsonResponse({ ok: false, error: '请求格式无效' }, 400);
  }

  const resolved = await resolveRedeemCode(body && body.code, context.env);
  if (!resolved.ok) return jsonResponse({ ok: false, error: resolved.error }, 400);

  const entitlement = normalizeEntitlement(buildEntitlementFromGrant(resolved.grant));
  const cookie = await buildSessionCookie(entitlement, context.env);

  return jsonResponse({ ok: true, entitlement }, 200, { 'Set-Cookie': cookie });
}
