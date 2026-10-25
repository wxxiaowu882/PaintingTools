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
    allowProbeCodes:
      typeof body.allowProbeCodes === 'boolean' ? body.allowProbeCodes : undefined,
    referralEnabled:
      typeof body.referralEnabled === 'boolean' ? body.referralEnabled : undefined,
    referralRewardDays: body.referralRewardDays,
    referralMonthlyCap: body.referralMonthlyCap,
    referralBlockSelf:
      typeof body.referralBlockSelf === 'boolean' ? body.referralBlockSelf : undefined,
    referralBlockSameDevice:
      typeof body.referralBlockSameDevice === 'boolean'
        ? body.referralBlockSameDevice
        : undefined
  });
  if (!saved.ok) return jsonResponse({ ok: false, error: saved.error }, 503);
  return jsonResponse({
    ok: true,
    settings: saved.settings,
    tip: '设置已保存'
  });
}
