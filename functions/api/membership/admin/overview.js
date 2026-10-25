import { requireAdmin, jsonResponse } from '../../../membership/admin-auth.js';
import { getSecret } from '../../../membership/session.js';
import { loadPolicy, loadTiers } from '../../../membership/policy.js';
import { loadOpsSettings } from '../../../membership/ops-settings.js';

export async function onRequestGet(context) {
  const gate = await requireAdmin(context);
  if (!gate.ok) return gate.response;

  const secret = getSecret(context.env);
  const secretIsDevDefault =
    secret === 'dev-only-wuxiao-membership-change-me' ||
    secret === 'dev-only-local-membership-secret-change-me';
  const hasKv = !!(context.env && context.env.MEMBERSHIP_KV);
  const opsSettings = await loadOpsSettings(context.env);
  const allowProbe = !!opsSettings.allowProbeCodes;
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
        require: r.require || 'public',
        enabled: r.enabled !== false,
        probe: !!r.probe,
        kind: id.startsWith('scene:') ? 'scene' : id.startsWith('ui:') ? 'ui' : 'feature'
      };
    })
    .filter((x) => x.enabled && (x.require === 'member' || x.require === 'user'));

  // 给前端/排障用；业务页默认不展示生造名词
  const tips = [];
  if (!hasKv) {
    tips.push('当前无法保存发码记录，暂时发不了兑换码。');
  }
  if (secretIsDevDefault) {
    tips.push('当前为开发环境默认配置；正式上线请用 Portal「23」设置运营相关密钥。');
  }
  if (allowProbe) {
    tips.push('开发自测通道仍开启；正式对外卖课前请关闭。');
  }

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
    opsSettings,
    probeCodes: ['PROBE-3M', 'PROBE-1Y', 'PROBE-FOREVER'],
    stampPhrase: secret,
    tips,
    lockedItems: locked,
    policy,
    tiers
  });
}
