/** 读取 access-policy 并过滤课表（不改磁盘权威 JSON） */

import { accessLevel, meetsRequire, normalizeRequire } from './session.js';
import { unlockCoversResource } from './product-unlocks.js';

const POLICY_ASSET = '/docs/membership/access-policy.json';

const CATALOG_BY_SANDBOX = {
  geometry: '/docs/json/沙盒_几何体静物/沙盒_几何体静物.json',
  geometrysketch: '/docs/json/沙盒_几何体静物写生/沙盒_几何体静物写生.json',
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
  let base = { version: 0, defaultRequire: 'public', resources: {} };
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
  return list
    .map((s) => ({
      name: s && s.name ? String(s.name) : '',
      uid: s && s.uid != null ? String(s.uid).trim() : ''
    }))
    .filter((x) => x.name || x.uid);
}

/**
 * 权限 ID 主键：模块 + 短号（uid）。
 * 无 uid 时回退 name（解剖/五官等旧课）。
 */
export function sceneResourceId(sandbox, scene) {
  const sb = String(sandbox || 'geometry').toLowerCase();
  const uid = scene && scene.uid != null ? String(scene.uid).trim() : '';
  if (uid) return 'scene:' + sb + ':uid:' + uid;
  const name = scene && (scene.name || scene.title) ? String(scene.name || scene.title).trim() : '';
  if (!name) return null;
  return 'scene:' + sb + ':name:' + name;
}

/** 查询候选：uid 优先，再 name（迁移双读 / 旧客户端） */
export function sceneResourceIds(sandbox, scene) {
  const sb = String(sandbox || 'geometry').toLowerCase();
  const ids = [];
  const uid = scene && scene.uid != null ? String(scene.uid).trim() : '';
  const name = scene && (scene.name || scene.title) ? String(scene.name || scene.title).trim() : '';
  if (uid) ids.push('scene:' + sb + ':uid:' + uid);
  if (name) ids.push('scene:' + sb + ':name:' + name);
  return ids;
}

/** 资源所需档：public | user | member；无规则时用 defaultRequire */
export function resourceRequire(policy, resourceId) {
  if (!resourceId || !policy) return normalizeRequire(policy && policy.defaultRequire);
  const rule = policy.resources && policy.resources[resourceId];
  if (!rule || rule.enabled === false) {
    return normalizeRequire(policy.defaultRequire);
  }
  return normalizeRequire(rule.require != null ? rule.require : policy.defaultRequire);
}

/** 多候选：命中第一条 enabled 规则；皆无则 defaultRequire */
export function resourceRequireAny(policy, resourceIds) {
  const ids = Array.isArray(resourceIds) ? resourceIds.filter(Boolean) : resourceIds ? [resourceIds] : [];
  if (!policy) return normalizeRequire('public');
  for (let i = 0; i < ids.length; i++) {
    const rule = policy.resources && policy.resources[ids[i]];
    if (rule && rule.enabled !== false) {
      return normalizeRequire(rule.require != null ? rule.require : policy.defaultRequire);
    }
  }
  return normalizeRequire(policy.defaultRequire);
}

/** @deprecated 兼容旧调用：是否要求高级会员 */
export function requiresMember(policy, resourceId) {
  return resourceRequire(policy, resourceId) === 'member';
}

/**
 * 当前用户不够档：保留列表可见字段（uid / 筛选 meta），去掉可复现课的载荷（items/标注等）。
 * 注意：勿只留 category/detail——肖像年龄芯片、列表编号、headform 课线都依赖这些轻量字段。
 */
export function stripScenePayload(scene, requireLevel) {
  if (!scene || typeof scene !== 'object') return scene;
  const req = normalizeRequire(requireLevel || 'member');
  const m = scene.meta || {};
  const meta = {
    category: m.category,
    detail: m.detail,
    description: m.description,
    line: m.line,
    slot: m.slot,
    lessonTabLabel: m.lessonTabLabel,
    modelLabel: m.modelLabel,
    modelId: m.modelId,
    material: m.material,
    gender: m.gender,
    age: m.age,
    region: m.region,
    locked: true,
    require: req
  };
  const out = {
    name: scene.name,
    thumbnail: scene.thumbnail,
    meta,
    __membershipLocked: true,
    __require: req
  };
  if (scene.uid != null && String(scene.uid).trim() !== '') out.uid = String(scene.uid).trim();
  if (scene.id != null && String(scene.id).trim() !== '') out.id = String(scene.id).trim();
  return out;
}

/**
 * 列表卡：去掉 items/标注等重字段；dataURL 缩略图默认剥离（约 1MB+），避免课表接口把首屏卡死。
 * includeThumb=true 时保留缩略图（供列表二次补全）。
 */
export function toCatalogListCard(scene, locked, includeThumb, requireLevel) {
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
  const req = normalizeRequire(requireLevel || 'public');
  if (req !== 'public') meta.require = req;
  if (locked) meta.locked = true;
  const out = {
    name: scene.name,
    thumbnail: thumb,
    meta: meta,
    __listOnly: true
  };
  // 收藏/进课索引：必须带回唯一键（headform 多头模同名；uid 为三位数权威编号）
  if (scene.uid != null && String(scene.uid).trim() !== '') out.uid = String(scene.uid).trim();
  if (scene.id != null && String(scene.id).trim() !== '') out.id = String(scene.id).trim();
  if (locked) {
    out.__membershipLocked = true;
    out.__require = req;
  }
  return out;
}

function resourceUnlocked(level, req, resourceId, productUnlocks) {
  if (meetsRequire(level, req)) return true;
  return unlockCoversResource(productUnlocks, resourceId);
}

/** userLevel：guest|user|member，或传入 entitlement 对象；productUnlocks 可盖过 scene:{sandbox}:* */
export function filterCatalog(scenes, sandbox, policy, userLevel, productUnlocks) {
  const list = Array.isArray(scenes) ? scenes : scenes ? [scenes] : [];
  const level = typeof userLevel === 'string' ? userLevel : accessLevel(userLevel);
  return list.map((scene) => {
    if (!scene || typeof scene !== 'object') return scene;
    const ids = sceneResourceIds(sandbox, scene);
    const rid = ids[0] || sceneResourceId(sandbox, scene);
    const req = ids.length ? resourceRequireAny(policy, ids) : normalizeRequire(policy && policy.defaultRequire);
    if (!resourceUnlocked(level, req, rid, productUnlocks)) return stripScenePayload(scene, req);
    const copy = Object.assign({}, scene);
    delete copy.__membershipLocked;
    delete copy.__require;
    return copy;
  });
}

/** 列表专用：全员只返回轻量卡（不够档带 locked + require），体积远小于全文课表 */
export function filterCatalogList(scenes, sandbox, policy, userLevel, includeThumb, productUnlocks) {
  const list = Array.isArray(scenes) ? scenes : scenes ? [scenes] : [];
  const level = typeof userLevel === 'string' ? userLevel : accessLevel(userLevel);
  return list.map((scene) => {
    if (!scene || typeof scene !== 'object') return scene;
    const ids = sceneResourceIds(sandbox, scene);
    const rid = ids[0] || sceneResourceId(sandbox, scene);
    const req = ids.length ? resourceRequireAny(policy, ids) : normalizeRequire(policy && policy.defaultRequire);
    const locked = !resourceUnlocked(level, req, rid, productUnlocks);
    return toCatalogListCard(scene, locked, !!includeThumb, req);
  });
}

export async function loadFilteredCatalog(context, sandbox, userLevel, productUnlocks) {
  const path = catalogAssetPath(sandbox);
  const policy = await loadPolicy(context);
  const raw = await fetchAssetJson(context, path);
  return filterCatalog(raw, sandbox, policy, userLevel, productUnlocks);
}

export async function loadFilteredCatalogList(context, sandbox, userLevel, includeThumb, productUnlocks) {
  const path = catalogAssetPath(sandbox);
  const policy = await loadPolicy(context);
  const raw = await fetchAssetJson(context, path);
  return filterCatalogList(raw, sandbox, policy, userLevel, includeThumb, productUnlocks);
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
      uid: s && s.uid != null ? String(s.uid) : '',
      id: s && s.id != null ? String(s.id) : '',
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

/**
 * 进课用：按 uid / id / 名称取单课全文（按访问档过滤；未授权返回 stripped）。
 * headform 多头模同名时必须优先 uid 或 id，勿仅靠 name。
 */
export async function loadFilteredSceneByName(context, sandbox, userLevel, sceneName, opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  const wantUid = String(o.uid || '').trim();
  const wantId = String(o.id || '').trim();
  const want = String(sceneName || o.name || '').trim();
  if (!wantUid && !wantId && !want) return { ok: false, error: '缺少场景标识' };
  const path = catalogAssetPath(sandbox);
  const policy = await loadPolicy(context);
  const raw = await fetchAssetJson(context, path);
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  let hit = null;
  if (wantUid) hit = list.find((s) => s && String(s.uid || '').trim() === wantUid) || null;
  if (!hit && wantId) hit = list.find((s) => s && String(s.id || '').trim() === wantId) || null;
  if (!hit && want) hit = list.find((s) => s && String(s.name || '').trim() === want) || null;
  if (!hit) return { ok: false, error: '场景不存在' };
  const level = typeof userLevel === 'string' ? userLevel : accessLevel(userLevel);
  const ids = sceneResourceIds(sandbox, hit);
  const rid = ids[0] || sceneResourceId(sandbox, hit);
  const req = ids.length ? resourceRequireAny(policy, ids) : normalizeRequire(policy.defaultRequire);
  const unlocks = o.productUnlocks;
  if (!resourceUnlocked(level, req, rid, unlocks)) {
    return { ok: true, locked: true, require: req, scene: stripScenePayload(hit, req) };
  }
  const copy = Object.assign({}, hit);
  delete copy.__membershipLocked;
  delete copy.__require;
  delete copy.__listOnly;
  return { ok: true, locked: false, require: req, scene: copy };
}
