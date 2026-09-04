/**
 * 头颅面骨身份维效果簇分类（P0 幅度场 Ward 聚类）。
 * 权威源：data/identity-taxonomy.json；改名经 /__api/gnm-identity-taxonomy 写盘。
 */

const STORAGE_KEY = 'gnmWorkshop.identityTaxonomy.v1';
const DISK_API = '/__api/gnm-identity-taxonomy';
const DISK_URL = './data/identity-taxonomy.json';
const EXPORT_VERSION = 1;

/** @type {{ kind?: string, version?: number, updatedAt?: string, source?: object, scope?: object, clusters: Array<object> } | null} */
let taxonomy = null;
const listeners = new Set();
let _diskTimer = null;

function nowIso() {
  return new Date().toISOString();
}

function normalize(data) {
  if (!data || typeof data !== 'object') return null;
  const clusters = Array.isArray(data.clusters)
    ? data.clusters
        .filter((c) => c?.id && Array.isArray(c.indices) && c.indices.length)
        .map((c) => ({
          id: String(c.id),
          name: String(c.name || c.defaultName || c.id).trim() || String(c.id),
          defaultName: String(c.defaultName || c.name || c.id).trim(),
          medoid: c.medoid != null ? Number(c.medoid) : null,
          indices: [...new Set(c.indices.map((x) => Number(x) | 0))].sort((a, b) => a - b),
          meanMagCos: c.meanMagCos,
          regionHint: c.regionHint || '',
        }))
    : [];
  if (!clusters.length) return null;
  return {
    kind: 'gnmWorkshopIdentityTaxonomy',
    version: Number(data.version) || EXPORT_VERSION,
    updatedAt: String(data.updatedAt || nowIso()),
    source: data.source || {},
    scope: data.scope || { groupId: 'head', start: 0, count: 170 },
    clusters,
  };
}

function persistLocal() {
  if (!taxonomy) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(taxonomy));
}

function notify() {
  for (const fn of listeners) fn();
}

async function pushToDisk() {
  if (!taxonomy) return false;
  const payload = { ...taxonomy, updatedAt: taxonomy.updatedAt || nowIso() };
  try {
    const res = await fetch(DISK_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json().catch(() => ({}));
    if (data?.ok === false) throw new Error(data.error || 'write failed');
    return true;
  } catch (e) {
    console.warn('[identity-taxonomy] 无法写入磁盘', e.message || e);
    return false;
  }
}

function scheduleDiskWrite() {
  clearTimeout(_diskTimer);
  _diskTimer = setTimeout(() => {
    pushToDisk();
  }, 250);
}

export async function initIdentityTaxonomy(fallbackUrl = DISK_URL) {
  let fromDisk = null;
  let diskUpdatedAt = '';
  try {
    let res = await fetch(DISK_API, { cache: 'no-store' }).catch(() => null);
    if (!res || !res.ok) res = await fetch(fallbackUrl, { cache: 'no-store' });
    if (res.ok) {
      fromDisk = normalize(await res.json());
      diskUpdatedAt = fromDisk?.updatedAt || '';
    }
  } catch (_) {}

  let fromLocal = null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) fromLocal = normalize(JSON.parse(raw));
  } catch (_) {}

  // 同结构下：名称以较新整表为准；若本地缺簇则以磁盘为准
  if (fromLocal?.updatedAt && diskUpdatedAt && fromLocal.updatedAt >= diskUpdatedAt) {
    // 合并：以磁盘 indices 为准，名称优先本地同 id
    if (fromDisk) {
      const nameById = new Map(fromLocal.clusters.map((c) => [c.id, c.name]));
      taxonomy = {
        ...fromDisk,
        updatedAt: fromLocal.updatedAt,
        clusters: fromDisk.clusters.map((c) => ({
          ...c,
          name: nameById.get(c.id) || c.name,
        })),
      };
    } else {
      taxonomy = fromLocal;
    }
  } else if (fromDisk) {
    taxonomy = fromDisk;
  } else if (fromLocal) {
    taxonomy = fromLocal;
  } else {
    taxonomy = null;
  }

  if (taxonomy) {
    persistLocal();
    await pushToDisk();
  }
  return taxonomy;
}

export function getIdentityTaxonomy() {
  return taxonomy;
}

export function getHeadEffectClusters() {
  return taxonomy?.clusters?.slice() || [];
}

/** @param {string} clusterId @param {string} name */
export async function renameIdentityCluster(clusterId, name) {
  if (!taxonomy) throw new Error('分类尚未加载');
  const c = taxonomy.clusters.find((x) => x.id === clusterId);
  if (!c) throw new Error('找不到该效果簇');
  const next = String(name || '').trim();
  if (!next) throw new Error('名称不能为空');
  c.name = next;
  taxonomy.updatedAt = nowIso();
  persistLocal();
  clearTimeout(_diskTimer);
  await pushToDisk();
  notify();
  return c;
}

export function onIdentityTaxonomyChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
