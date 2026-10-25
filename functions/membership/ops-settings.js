/**
 * 运营可改的开关（存在 MEMBERSHIP_KV，避免只能改 Cloudflare 环境变量）
 * key: ops:settings
 */
const SETTINGS_KEY = 'ops:settings';

function kv(env) {
  return env && env.MEMBERSHIP_KV ? env.MEMBERSHIP_KV : null;
}

function clampInt(n, min, max, fallback) {
  const v = parseInt(n, 10);
  if (!isFinite(v)) return fallback;
  return Math.min(max, Math.max(min, v));
}

/**
 * @returns {{
 *   allowProbeCodes: boolean,
 *   referralEnabled: boolean,
 *   referralRewardDays: number,
 *   referralMonthlyCap: number,
 *   referralBlockSelf: boolean,
 *   referralBlockSameDevice: boolean,
 *   source: string,
 *   updatedAt: number|null
 * }}
 */
export async function loadOpsSettings(env) {
  const store = kv(env);
  let fromKv = null;
  if (store) {
    try {
      const raw = await store.get(SETTINGS_KEY);
      if (raw) fromKv = JSON.parse(raw);
    } catch (_e) {}
  }
  const envProbe = String((env && env.ALLOW_PROBE_CODES) || '') === '1';
  let allowProbeCodes = envProbe;
  if (fromKv && typeof fromKv.allowProbeCodes === 'boolean') {
    allowProbeCodes = fromKv.allowProbeCodes;
  }

  // 宣传链接奖励：未写入 KV 时默认开启（启动期推广）
  const referralEnabled =
    fromKv && typeof fromKv.referralEnabled === 'boolean' ? fromKv.referralEnabled : true;
  const referralRewardDays = clampInt(
    fromKv && fromKv.referralRewardDays,
    1,
    365,
    90
  );
  // 0 = 不封顶（默认不限制每月次数）
  let referralMonthlyCap = 0;
  if (fromKv && fromKv.referralMonthlyCap != null && fromKv.referralMonthlyCap !== '') {
    referralMonthlyCap = clampInt(fromKv.referralMonthlyCap, 0, 99, 0);
  }
  const referralBlockSelf =
    fromKv && typeof fromKv.referralBlockSelf === 'boolean' ? fromKv.referralBlockSelf : true;
  const referralBlockSameDevice =
    fromKv && typeof fromKv.referralBlockSameDevice === 'boolean'
      ? fromKv.referralBlockSameDevice
      : true;

  return {
    allowProbeCodes,
    referralEnabled,
    referralRewardDays,
    referralMonthlyCap,
    referralBlockSelf,
    referralBlockSameDevice,
    source: fromKv ? 'kv' : 'env',
    updatedAt: (fromKv && fromKv.updatedAt) || null
  };
}

export async function saveOpsSettings(env, patch) {
  const store = kv(env);
  if (!store) {
    return { ok: false, error: '发码记录本未开通，无法在网页里改开关。请先完成 KV 绑定。' };
  }
  const cur = await loadOpsSettings(env);
  const next = {
    allowProbeCodes:
      typeof patch.allowProbeCodes === 'boolean' ? patch.allowProbeCodes : cur.allowProbeCodes,
    referralEnabled:
      typeof patch.referralEnabled === 'boolean' ? patch.referralEnabled : cur.referralEnabled,
    referralRewardDays:
      patch.referralRewardDays != null && patch.referralRewardDays !== ''
        ? clampInt(patch.referralRewardDays, 1, 365, cur.referralRewardDays)
        : cur.referralRewardDays,
    referralMonthlyCap:
      patch.referralMonthlyCap != null && patch.referralMonthlyCap !== ''
        ? clampInt(patch.referralMonthlyCap, 0, 99, cur.referralMonthlyCap)
        : cur.referralMonthlyCap,
    referralBlockSelf:
      typeof patch.referralBlockSelf === 'boolean' ? patch.referralBlockSelf : cur.referralBlockSelf,
    referralBlockSameDevice:
      typeof patch.referralBlockSameDevice === 'boolean'
        ? patch.referralBlockSameDevice
        : cur.referralBlockSameDevice,
    updatedAt: Date.now()
  };
  await store.put(SETTINGS_KEY, JSON.stringify(next));
  return { ok: true, settings: { ...next, source: 'kv' } };
}

export async function isProbeAllowed(env) {
  const s = await loadOpsSettings(env);
  return !!s.allowProbeCodes;
}
