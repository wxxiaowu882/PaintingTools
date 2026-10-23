import { loadFilteredSceneByName } from '../../membership/policy.js';
import { isMember, jsonResponse, readEntitlementFromRequest } from '../../membership/session.js';

/** 进课：按名称取单课全文（会员未授权则返回已剥离载荷） */
export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const sandbox = (url.searchParams.get('sandbox') || 'geometry').toLowerCase();
  const name = url.searchParams.get('name') || '';
  const ent = await readEntitlementFromRequest(context.request, context.env);
  const member = isMember(ent);

  try {
    const result = await loadFilteredSceneByName(context, sandbox, member, name);
    if (!result.ok) {
      return jsonResponse({ ok: false, error: result.error || '场景不可用' }, result.error === '场景不存在' ? 404 : 400);
    }
    return jsonResponse({
      ok: true,
      sandbox,
      member,
      locked: !!result.locked,
      scene: result.scene
    });
  } catch (e) {
    return jsonResponse(
      { ok: false, error: '场景加载失败', detail: String(e && e.message ? e.message : e) },
      500
    );
  }
}
