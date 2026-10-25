import { loadFilteredSceneByName } from '../../membership/policy.js';
import { accessLevel, jsonResponse, readEntitlementFromRequest } from '../../membership/session.js';

/** 进课：按 uid / id / 名称取单课全文（不够档则返回已剥离载荷） */
export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const sandbox = (url.searchParams.get('sandbox') || 'geometry').toLowerCase();
  const name = url.searchParams.get('name') || '';
  const uid = url.searchParams.get('uid') || '';
  const id = url.searchParams.get('id') || '';
  const ent = await readEntitlementFromRequest(context.request, context.env);
  const level = accessLevel(ent);

  try {
    const result = await loadFilteredSceneByName(context, sandbox, level, name, { uid, id, name });
    if (!result.ok) {
      return jsonResponse({ ok: false, error: result.error || '场景不可用' }, result.error === '场景不存在' ? 404 : 400);
    }
    return jsonResponse({
      ok: true,
      sandbox,
      accessLevel: level,
      member: level === 'member',
      locked: !!result.locked,
      require: result.require || null,
      scene: result.scene
    });
  } catch (e) {
    return jsonResponse(
      { ok: false, error: '场景加载失败', detail: String(e && e.message ? e.message : e) },
      500
    );
  }
}
