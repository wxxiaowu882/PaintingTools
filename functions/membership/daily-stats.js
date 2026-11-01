/**
 * 运营日统计（省 KV）：按北京日增量聚合，禁止扫全账号。
 * KV：stats:day:YYYY-MM-DD → { day, login, register, redeem, updatedAt }
 * 去重靠账号上的 statsLoginDay / statsRedeemDay（与账号同一次 put，不另开登录日志）。
 */
const DAY_PREFIX = 'stats:day:';

function kv(env) {
  return env && env.MEMBERSHIP_KV ? env.MEMBERSHIP_KV : null;
}

/** 北京日历日 YYYY-MM-DD */
export function beijingDayKey(ms) {
  const t = ms == null ? Date.now() : Number(ms);
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(new Date(t));
  } catch (_e) {
    const d = new Date(t + 8 * 3600000);
    return d.toISOString().slice(0, 10);
  }
}

function emptyDay(day) {
  return { day: day, login: 0, register: 0, redeem: 0, updatedAt: Date.now() };
}

/**
 * 增量写入当日计数。fields 如 { login:1, register:1 }，值为增加量。
 * 失败静默（不影响注册/登录/兑码主路径）。
 */
export async function bumpDailyStats(env, fields) {
  const store = kv(env);
  if (!store || !fields || typeof fields !== 'object') return { ok: false };
  const day = beijingDayKey();
  const key = DAY_PREFIX + day;
  try {
    const raw = await store.get(key);
    let obj = emptyDay(day);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          obj.login = Number(parsed.login) || 0;
          obj.register = Number(parsed.register) || 0;
          obj.redeem = Number(parsed.redeem) || 0;
        }
      } catch (_e) {}
    }
    ['login', 'register', 'redeem'].forEach((k) => {
      const n = Number(fields[k]) || 0;
      if (n) obj[k] = (Number(obj[k]) || 0) + n;
    });
    obj.updatedAt = Date.now();
    // 保留约 400 天，避免无限堆积
    await store.put(key, JSON.stringify(obj), { expirationTtl: 86400 * 400 });
    return { ok: true, day: day, stats: obj };
  } catch (_e) {
    return { ok: false };
  }
}

/**
 * 读最近 days 天曲线（含今天）。默认 30；最多 90。
 * 并行 get，不上 list、不扫账号。
 */
export async function loadDailyStatsRange(env, daysRaw) {
  const store = kv(env);
  let days = parseInt(daysRaw, 10);
  if (!Number.isFinite(days) || days <= 0) days = 30;
  days = Math.min(90, Math.max(1, days));
  if (!store) {
    return { ok: true, days: days, series: buildEmptySeries(days), tip: '未开通 MEMBERSHIP_KV' };
  }
  const keys = [];
  const now = Date.now();
  for (let i = days - 1; i >= 0; i--) {
    const ms = now - i * 86400000;
    keys.push(DAY_PREFIX + beijingDayKey(ms));
  }
  let raws;
  try {
    raws = await Promise.all(keys.map((k) => store.get(k)));
  } catch (_e) {
    return { ok: false, error: '读取日统计失败' };
  }
  const series = keys.map((k, idx) => {
    const day = k.slice(DAY_PREFIX.length);
    const raw = raws[idx];
    if (!raw) return emptyDay(day);
    try {
      const parsed = JSON.parse(raw);
      return {
        day: day,
        login: Number(parsed && parsed.login) || 0,
        register: Number(parsed && parsed.register) || 0,
        redeem: Number(parsed && parsed.redeem) || 0,
        updatedAt: Number(parsed && parsed.updatedAt) || null
      };
    } catch (_e) {
      return emptyDay(day);
    }
  });
  return {
    ok: true,
    days: days,
    series: series,
    tip: '按北京日统计；仅功能上线后有数，不做历史回填。日活=当天用过站（账号日去重）；兑换同理。'
  };
}

function buildEmptySeries(days) {
  const series = [];
  const now = Date.now();
  for (let i = days - 1; i >= 0; i--) {
    series.push(emptyDay(beijingDayKey(now - i * 86400000)));
  }
  return series;
}
