import {
  readEntitlementFromRequest,
  clearSessionCookie,
  jsonResponse
} from '../../membership/session.js';

export async function onRequestGet(context) {
  const entitlement = await readEntitlementFromRequest(context.request, context.env);
  return jsonResponse({ ok: true, entitlement });
}

export async function onRequestDelete(context) {
  return jsonResponse(
    { ok: true, entitlement: { tierId: 'free', level: 'free', expiresAt: null, source: 'cleared' } },
    200,
    { 'Set-Cookie': clearSessionCookie(context.request) }
  );
}
