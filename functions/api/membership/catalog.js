import { loadFilteredCatalog } from '../../membership/policy.js';
import { isMember, jsonResponse, readEntitlementFromRequest } from '../../membership/session.js';

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const sandbox = (url.searchParams.get('sandbox') || 'geometry').toLowerCase();
  const ent = await readEntitlementFromRequest(context.request, context.env);
  const member = isMember(ent);

  try {
    const data = await loadFilteredCatalog(context, sandbox, member);
    return jsonResponse({
      ok: true,
      sandbox,
      member,
      scenes: data
    });
  } catch (e) {
    return jsonResponse(
      { ok: false, error: '课表加载失败', detail: String(e && e.message ? e.message : e) },
      500
    );
  }
}
