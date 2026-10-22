import { requireAdmin, jsonResponse } from '../../../membership/admin-auth.js';
import { getSecret } from '../../../membership/session.js';
import { loadPolicy, loadTiers } from '../../../membership/policy.js';

export async function onRequestGet(context) {
  const gate = await requireAdmin(context);
  if (!gate.ok) return gate.response;

  const secret = getSecret(context.env);
  const secretIsDevDefault = secret === 'dev-only-wuxiao-membership-change-me';
  const hasKv = !!(context.env && context.env.MEMBERSHIP_KV);
  const allowProbe = String((context.env && context.env.ALLOW_PROBE_CODES) || '') === '1';
  const hasAdminPwd = !!gate.pwdConfigured;

  const policy = await loadPolicy(context);
  const tiers = await loadTiers(context);

  const resources = policy.resources || {};
  const locked = Object.keys(resources)
    .map((id) => {
      const r = resources[id];
      return {
        id,
        label: r.label || id,
        require: r.require || 'free',
        enabled: r.enabled !== false,
        probe: !!r.probe,
        kind: id.startsWith('scene:') ? 'scene' : id.startsWith('ui:') ? 'ui' : 'feature'
      };
    })
    .filter((x) => x.require === 'member' && x.enabled);

  return jsonResponse({
    ok: true,
    status: {
      secretReady: !secretIsDevDefault,
      secretIsDevDefault,
      canSaveOnline: hasKv,
      allowProbeCodes: allowProbe,
      adminPasswordReady: hasAdminPwd,
      policySource: policy._source || 'file',
      tiersSource: tiers._source || 'file'
    },
    tips: [
      secretIsDevDefault
        ? '还没配置正式密钥 MEMBERSHIP_SECRET，线上请尽快设置，否则不够安全。'
        : '会员密钥已配置。',
      hasKv
        ? '已绑定线上存储：本页改收费项、改价格可直接保存生效。'
        : '未绑定线上存储：本页可发码、可预览；改收费项请用「下载配置」或联系技术绑定 KV 后网页保存。',
      allowProbe
        ? '探针码（PROBE-*）当前开启，正式卖课前请关掉 ALLOW_PROBE_CODES。'
        : '探针码已关闭（正式环境建议保持关闭）。'
    ],
    lockedItems: locked,
    policy,
    tiers
  });
}
