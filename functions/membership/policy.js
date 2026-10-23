/** 读取 access-policy 并过滤课表（不改磁盘权威 JSON） */

const POLICY_ASSET = '/docs/membership/access-policy.json';

const CATALOG_BY_SANDBOX = {
  geometry: '/docs/json/沙盒_几何体静物/沙盒_几何体静物.json',
  portrait: '/docs/json/沙盒_肖像光影沙盒/沙盒_肖像光影沙盒.json',
  headform: '/docs/json/沙盒_头部造型规律/沙盒_头部造型规律.json'
};

export function catalogAssetPath(sandbox) {
  const key = String(sandbox || 'geometry').toLowerCase();
  return CATALOG_BY_SANDBOX[key] || CATALOG_BY_SANDBOX.geometry;
}

export function isProtectedCatalogPath(pathname) {
  let path = pathname || '';
  try {
    path = decodeURIComponent(path);
  } catch (_e) {}
  const values = Object.values(CATALOG_BY_SANDBOX);
  return values.some((p) => path === p || path.endsWith(p));
}

export function sandboxFromCatalogPath(pathname) {
  let path = pathname || '';
  try {
    path = decodeURIComponent(path);
  } catch (_e) {}
  for (const [sb, p] of Object.entries(CATALOG_BY_SANDBOX)) {
    if (path === p || path.endsWith(p)) return sb;
  }
  return null;
}

/** Worker 隔离内短缓存：避免每次列表/进课都重新 parse 近 2MB 课表 */
const _assetJsonMem = new Map();
const ASSET_JSON_TTL_MS = 60 * 1000;

async function fetchAssetJson(context, assetPath) {
  const now = Date.now();
  const hit = _assetJsonMem.get(assetPath);
  if (hit && hit.data != null && now - hit.at < ASSET_JSON_TTL_MS) return hit.data;
  const url = new URL(assetPath, context.request.url);
  const res = await context.env.ASSETS.fetch(url);
  if (!res.ok) throw new Error('asset ' + assetPath + ' HTTP ' + res.status);
  const data = await res.json();
  try {
    _assetJsonMem.set(assetPath, { at: now, data });
  } catch (_e) {}
  return data;
}

const TIERS_ASSET = '/docs/membership/tiers.json';
const KV_POLICY = 'policy_live';
const KV_TIERS = 'tiers_live';

export async function loadPolicy(context) {
  let base = { version: 0, defaultRequire: 'free', resources: {} };
  try {
    base = await fetchAssetJson(context, POLICY_ASSET);
  } catch (_e) {}
  try {
    const kv = context.env && context.env.MEMBERSHIP_KV;
    if (kv) {
      const raw = await kv.get(KV_POLICY);
      if (raw) {
        const live = JSON.parse(raw);
        if (live && typeof live === 'object') {
          return {
            ...base,
            ...live,
            resources: Object.assign({}, base.resources || {}, live.resources || {}),
            _source: 'kv'
          };
        }
      }
    }
  } catch (_e2) {}
  base._source = 'file';
  return base;
}

export async function loadTiers(context) {
  let base = { version: 0, tiers: [], currency: 'CNY' };
  try {
    base = await fetchAssetJson(context, TIERS_ASSET);
  } catch (_e) {}
  try {
    const kv = context.env && context.env.MEMBERSHIP_KV;
    if (kv) {
      const raw = await kv.get(KV_TIERS);
      if (raw) {
        const live = JSON.parse(raw);
        if (live && typeof live === 'object') {
          return Object.assign({}, base, live, { _source: 'kv' });
        }
      }
    }
  } catch (_e2) {}
  base._source = 'file';
  return base;
}

export async function savePolicyLive(context, policy) {
  const kv = context.env && context.env.MEMBERSHIP_KV;
  if (!kv) return { ok: false, error: '尚未绑定线上存储（MEMBERSHIP_KV），网页保存不可用。可先「下载配置」交给技术发版。' };
  const toSave = Object.assign({}, policy);
  delete toSave._source;
  toSave.updated = new Date().toISOString().slice(0, 10);
  await kv.put(KV_POLICY, JSON.stringify(toSave));
  return { ok: true };
}

export async function saveTiersLive(context, tiersDoc) {
  const kv = context.env && context.env.MEMBERSHIP_KV;
  if (!kv) return { ok: false, error: '尚未绑定线上存储（MEMBERSHIP_KV），网页保存不可用。' };
  const toSave = Object.assign({}, tiersDoc);
  delete toSave._source;
  await kv.put(KV_TIERS, JSON.stringify(toSave));
  return { ok: true };
}

export async function listSceneNames(context, sandbox) {
  const path = catalogAssetPath(sandbox);
  const raw = await fetchAssetJson(context, path);
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.map((s) => ({ name: s && s.name ? String(s.name) : '' })).filter((x) => x.name);
}

export function sceneResourceId(sandbox, scene) {
  const name = scene && (scene.name || scene.title) ? String(scene.name || scene.title).trim() : '';
  if (!name) return null;
  return 'scene:' + String(sandbox || 'geometry').toLowerCase() + ':name:' + name;
}

export function requiresMember(policy, resourceId) {
  if (!resourceId || !policy || !policy.resources) return false;
  const rule = policy.resources[resourceId];
  if (!rule || rule.enabled === false) return false;
  return rule.require === 'member';
}

/**
 * 非会员：保留列表可见字段，去掉可复现课的载荷
 */
export function stripScenePayload(scene) {
  if (!scene || typeof scene !== 'object') return scene;
  const out = {
    name: scene.name,
    thumbnail: scene.thumbnail,
    meta: scene.meta
      ? {
          category: scene.meta.category,
          detail: scene.meta.detail,
          description: scene.meta.description,
          locked: true
        }
      : { locked: true },
    __membershipLocked: true
  };
  return out;
}

/**
 * 列表卡：去掉 items/标注等重字段；dataURL 缩略图默认剥离（约 1MB+），避免课表接口把首屏卡死。
 * includeThumb=true 时保留缩略图（供列表二次补全）。
 */
export function toCatalogListCard(scene, locked, includeThumb) {
  if (!scene || typeof scene !== 'object') return scene;
  let thumb = '';
  if (includeThumb && scene.thumbnail != null) {
    thumb = String(scene.thumbnail);
  } else if (!includeThumb && scene.thumbnail != null) {
    const t = String(scene.thumbnail);
    // 无缩略图模式下仍保留小体积外链，避免列表全灰；dataURL 一律不下发
    if (t && !t.startsWith('data:')) thumb = t;
  }
  // 列表筛选/课线依赖的轻量 meta 必须保留；勿只留 category/detail（headform 无 line/slot 会「暂无课程」）
  const meta = scene.meta
    ? {
        category: scene.meta.category,
        detail: scene.meta.detail,
        description: scene.meta.description,
        line: scene.meta.line,
        slot: scene.meta.slot,
        lessonTabLabel: scene.meta.lessonTabLabel,
        modelLabel: scene.meta.modelLabel,
        modelId: scene.meta.modelId,
        material: scene.meta.material,
        gender: scene.meta.gender,
        age: scene.meta.age,
        region: scene.meta.region
      }
    : {};
  if (locked) meta.locked = true;
  const out = {
    name: scene.name,
    thumbnail: thumb,
    meta: meta,
    __listOnly: true
  };
  if (locked) out.__membershipLocked = true;
  return out;
}

export function filterCatalog(scenes, sandbox, policy, isMemberUser) {
  const list = Array.isArray(scenes) ? scenes : scenes ? [scenes] : [];
  if (isMemberUser) {
    return list.map((s) => {
      if (!s || typeof s !== 'object') return s;
      const copy = Object.assign({}, s);
      delete copy.__membershipLocked;
      return copy;
    });
  }
  return list.map((scene) => {
    const rid = sceneResourceId(sandbox, scene);
    if (rid && requiresMember(policy, rid)) return stripScenePayload(scene);
    return scene;
  });
}

/** 列表专用：全员只返回轻量卡（收费课带 locked），体积远小于全文课表 */
export function filterCatalogList(scenes, sandbox, policy, isMemberUser, includeThumb) {
  const list = Array.isArray(scenes) ? scenes : scenes ? [scenes] : [];
  return list.map((scene) => {
    if (!scene || typeof scene !== 'object') return scene;
    const rid = sceneResourceId(sandbox, scene);
    const locked = !isMemberUser && !!(rid && requiresMember(policy, rid));
    return toCatalogListCard(scene, locked, !!includeThumb);
  });
}

export async function loadFilteredCatalog(context, sandbox, isMemberUser) {
  const path = catalogAssetPath(sandbox);
  const policy = await loadPolicy(context);
  const raw = await fetchAssetJson(context, path);
  return filterCatalog(raw, sandbox, policy, isMemberUser);
}

export async function loadFilteredCatalogList(context, sandbox, isMemberUser, includeThumb) {
  const path = catalogAssetPath(sandbox);
  const policy = await loadPolicy(context);
  const raw = await fetchAssetJson(context, path);
  return filterCatalogList(raw, sandbox, policy, isMemberUser, includeThumb);
}

/**
 * 缩略图分批：只返回 name + thumbnail，供列表渐进补全。
 * offset/limit 相对课表顺序；limit 默认 10、上限 24。
 */
export async function loadCatalogThumbsBatch(context, sandbox, offset, limit) {
  const path = catalogAssetPath(sandbox);
  const raw = await fetchAssetJson(context, path);
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const total = list.length;
  const start = Math.max(0, Number(offset) || 0);
  let lim = Number(limit);
  if (!Number.isFinite(lim) || lim <= 0) lim = 10;
  lim = Math.min(24, Math.max(1, Math.floor(lim)));
  const slice = list.slice(start, start + lim);
  // 必须带绝对 index：headform 等多课同名（不同头模），仅靠 name 会把缩略图串成同一张
  const items = slice.map((s, i) => {
    const meta = (s && s.meta && typeof s.meta === 'object') ? s.meta : {};
    return {
      index: start + i,
      name: s && s.name != null ? String(s.name) : '',
      thumbnail: s && s.thumbnail != null ? String(s.thumbnail) : '',
      modelId: meta.modelId != null ? String(meta.modelId) : '',
      slot: meta.slot != null ? String(meta.slot) : '',
      line: meta.line != null ? String(meta.line) : ''
    };
  }).filter((x) => x.name);
  const nextOffset = start + slice.length;
  return {
    total,
    offset: start,
    limit: lim,
    nextOffset,
    done: nextOffset >= total,
    items
  };
}

/** 进课用：按名称取单课全文（仍按会员过滤；未授权返回 stripped） */
export async function loadFilteredSceneByName(context, sandbox, isMemberUser, sceneName) {
  const want = String(sceneName || '').trim();
  if (!want) return { ok: false, error: '缺少场景名' };
  const path = catalogAssetPath(sandbox);
  const policy = await loadPolicy(context);
  const raw = await fetchAssetJson(context, path);
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const hit = list.find((s) => s && String(s.name || '').trim() === want);
  if (!hit) return { ok: false, error: '场景不存在' };
  const rid = sceneResourceId(sandbox, hit);
  if (!isMemberUser && rid && requiresMember(policy, rid)) {
    return { ok: true, locked: true, scene: stripScenePayload(hit) };
  }
  const copy = Object.assign({}, hit);
  delete copy.__membershipLocked;
  delete copy.__listOnly;
  return { ok: true, locked: false, scene: copy };
}
