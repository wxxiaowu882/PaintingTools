import { requireAdmin, jsonResponse } from '../../../membership/admin-auth.js';
import { loadPolicy, savePolicyLive, listSceneNames } from '../../../membership/policy.js';

export async function onRequestGet(context) {
  const gate = await requireAdmin(context);
  if (!gate.ok) return gate.response;
  const url = new URL(context.request.url);
  if (url.searchParams.get('scenes') === '1') {
    const sandbox = url.searchParams.get('sandbox') || 'geometry';
    try {
      const scenes = await listSceneNames(context, sandbox);
      const policy = await loadPolicy(context);
      const withLock = scenes.map((s) => {
        const id = 'scene:' + sandbox + ':name:' + s.name;
        const rule = (policy.resources && policy.resources[id]) || null;
        return {
          name: s.name,
          id,
          locked: !!(rule && rule.enabled !== false && rule.require === 'member')
        };
      });
      return jsonResponse({ ok: true, sandbox, scenes: withLock });
    } catch (e) {
      return jsonResponse({ ok: false, error: String(e && e.message) }, 500);
    }
  }
  const policy = await loadPolicy(context);
  return jsonResponse({ ok: true, policy });
}

export async function onRequestPut(context) {
  const gate = await requireAdmin(context);
  if (!gate.ok) return gate.response;
  let body;
  try {
    body = await context.request.json();
  } catch (_e) {
    return jsonResponse({ ok: false, error: '请求无效' }, 400);
  }
  const policy = body.policy;
  if (!policy || typeof policy !== 'object' || !policy.resources) {
    return jsonResponse({ ok: false, error: '配置格式不对' }, 400);
  }
  const saved = await savePolicyLive(context, policy);
  if (!saved.ok) return jsonResponse(saved, 503);
  return jsonResponse({ ok: true, policy: await loadPolicy(context) });
}
