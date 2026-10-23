/**
 * 运营可改的开关（存在 MEMBERSHIP_KV，避免只能改 Cloudflare 环境变量）
 * key: ops:settings → { allowProbeCodes: boolean, updatedAt }
 */
const SETTINGS_KEY = 'ops:settings';

function kv(env) {
  return env && env.MEMBERSHIP_KV ? env.MEMBERSHIP_KV : null;
}

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
  // KV 有明确值优先；否则退回环境变量
  let allowProbeCodes = envProbe;
  if (fromKv && typeof fromKv.allowProbeCodes === 'boolean') {
    allowProbeCodes = fromKv.allowProbeCodes;
  }
  return {
    allowProbeCodes,
    source: fromKv && typeof fromKv.allowProbeCodes === 'boolean' ? 'kv' : 'env',
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
    updatedAt: Date.now()
  };
  await store.put(SETTINGS_KEY, JSON.stringify(next));
  return { ok: true, settings: { ...next, source: 'kv' } };
}

export async function isProbeAllowed(env) {
  const s = await loadOpsSettings(env);
  return !!s.allowProbeCodes;
}
