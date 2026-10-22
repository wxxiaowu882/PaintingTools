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

async function fetchAssetJson(context, assetPath) {
  const url = new URL(assetPath, context.request.url);
  const res = await context.env.ASSETS.fetch(url);
  if (!res.ok) throw new Error('asset ' + assetPath + ' HTTP ' + res.status);
  return res.json();
}

export async function loadPolicy(context) {
  try {
    return await fetchAssetJson(context, POLICY_ASSET);
  } catch (_e) {
    return { version: 0, defaultRequire: 'free', resources: {} };
  }
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

export async function loadFilteredCatalog(context, sandbox, isMemberUser) {
  const path = catalogAssetPath(sandbox);
  const policy = await loadPolicy(context);
  const raw = await fetchAssetJson(context, path);
  return filterCatalog(raw, sandbox, policy, isMemberUser);
}
