import { requireAdmin, jsonResponse } from '../../../membership/admin-auth.js';
import { loadOpsSettings, saveOpsSettings } from '../../../membership/ops-settings.js';

export async function onRequestGet(context) {
  const gate = await requireAdmin(context);
  if (!gate.ok) return gate.response;
  const settings = await loadOpsSettings(context.env);
  return jsonResponse({
    ok: true,
    settings,
    probeCodes: ['PROBE-3M', 'PROBE-1Y', 'PROBE-FOREVER']
  });
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
  const saved = await saveOpsSettings(context.env, {
    allowProbeCodes: !!body.allowProbeCodes
  });
  if (!saved.ok) return jsonResponse({ ok: false, error: saved.error }, 503);
  return jsonResponse({
    ok: true,
    settings: saved.settings,
    tip: saved.settings.allowProbeCodes
      ? '开发自测通道已打开（仅供内部调试，勿告诉学员）。'
      : '开发自测通道已关闭。学员只能用你发出的兑换码。'
  });
}
