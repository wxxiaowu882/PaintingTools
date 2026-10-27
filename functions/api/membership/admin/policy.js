import { requireAdmin, jsonResponse } from '../../../membership/admin-auth.js';
import { loadPolicy, savePolicyLive, listSceneNames, resourceRequire } from '../../../membership/policy.js';
import { normalizeRequire } from '../../../membership/session.js';

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
        const require = resourceRequire(policy, id);
        return {
          name: s.name,
          id,
          require,
          // 兼容旧运营台：locked = 需要高级会员
          locked: require === 'member'
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

  // 涂色单点：{ set: { id, require, label? } } —— 只改一条，避免整表往返
  if (body && body.set && body.set.id) {
    const id = String(body.set.id || '').trim();
    if (!id) return jsonResponse({ ok: false, error: '缺少资源 id' }, 400);
    const req = normalizeRequire(body.set.require);
    const policy = await loadPolicy(context);
    const next = Object.assign({}, policy);
    delete next._source;
    next.resources = Object.assign({}, policy.resources || {});
    const prev = next.resources[id] || {};
    next.resources[id] = Object.assign({}, prev, {
      require: req,
      enabled: true,
      label: body.set.label != null ? String(body.set.label) : (prev.label || id)
    });
    // 涂色写入的业务档，去掉探针标记，避免与验收探针混淆
    if (next.resources[id].probe) delete next.resources[id].probe;
    const saved = await savePolicyLive(context, next);
    if (!saved.ok) return jsonResponse(saved, 503);
    return jsonResponse({ ok: true, policy: await loadPolicy(context), set: { id, require: req } });
  }

  const policy = body.policy;
  if (!policy || typeof policy !== 'object' || !policy.resources) {
    return jsonResponse({ ok: false, error: '配置格式不对' }, 400);
  }
  // 归一 require：free → public
  if (policy.defaultRequire != null) {
    policy.defaultRequire = normalizeRequire(policy.defaultRequire);
  }
  Object.keys(policy.resources || {}).forEach((k) => {
    const r = policy.resources[k];
    if (r && r.require != null) r.require = normalizeRequire(r.require);
  });
  const saved = await savePolicyLive(context, policy);
  if (!saved.ok) return jsonResponse(saved, 503);
  return jsonResponse({ ok: true, policy: await loadPolicy(context) });
}
