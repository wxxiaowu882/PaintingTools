/**
 * 用户自定义身份：整表时间戳较新者胜出（避免「删除后刷新又回来」）；
 * 磁盘 API 可用时双写；localStorage 为会话镜像。
 */

const STORAGE_KEY = 'gnmWorkshop.customIdentities.v1';
const EXPORT_VERSION = 1;
const DISK_API = '/__api/gnm-custom-identities';
const DISK_URL = './data/custom-identities.json';

/** @type {Array<{id:string,name:string,identity:number[],createdAt?:string,updatedAt?:string}>} */
let cache = [];
/** 整表修订时间：删除/增改都会刷新，用于与磁盘比新 */
let listUpdatedAt = '';
let _diskTimer = null;

function nowIso() {
  return new Date().toISOString();
}

function newId() {
  return `custom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeList(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((x) => x?.id && x?.name && Array.isArray(x.identity))
    .map((x) => ({
      id: String(x.id),
      name: String(x.name).trim() || '未命名',
      identity: x.identity.slice(),
      createdAt: x.createdAt || nowIso(),
      updatedAt: x.updatedAt || nowIso(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { sensitivity: 'base', numeric: true }));
}

function loadLocalBundle() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { updatedAt: '', identities: [] };
    const data = JSON.parse(raw);
    // 兼容旧版：纯数组
    if (Array.isArray(data)) {
      const identities = normalizeList(data);
      const updatedAt = identities.reduce((m, x) => ((x.updatedAt || '') > m ? x.updatedAt : m), '');
      return { updatedAt, identities };
    }
    return {
      updatedAt: String(data.updatedAt || ''),
      identities: normalizeList(data.identities),
    };
  } catch (_) {
    return { updatedAt: '', identities: [] };
  }
}

function persistLocal() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      kind: 'gnmWorkshopCustomIdentities',
      version: EXPORT_VERSION,
      updatedAt: listUpdatedAt || nowIso(),
      identities: cache,
    })
  );
}

async function pushToDisk() {
  const payload = {
    kind: 'gnmWorkshopCustomIdentities',
    version: EXPORT_VERSION,
    updatedAt: listUpdatedAt || nowIso(),
    identities: cache,
  };
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
    console.warn('[custom-identities] 无法写入磁盘', e.message || e);
    return false;
  }
}

function scheduleDiskWrite() {
  clearTimeout(_diskTimer);
  _diskTimer = setTimeout(() => {
    pushToDisk();
  }, 250);
}

function saveAll(list, opts = {}) {
  cache = normalizeList(list);
  listUpdatedAt = opts.updatedAt || nowIso();
  persistLocal();
  if (opts.immediateDisk) {
    clearTimeout(_diskTimer);
    return pushToDisk();
  }
  scheduleDiskWrite();
  return Promise.resolve(true);
}

export async function initCustomIdentities() {
  let diskUpdatedAt = '';
  let fromDisk = [];
  let diskOk = false;
  try {
    let res = await fetch(DISK_API, { cache: 'no-store' }).catch(() => null);
    if (!res || !res.ok) res = await fetch(DISK_URL, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      fromDisk = normalizeList(Array.isArray(data) ? data : data?.identities);
      diskUpdatedAt = String((!Array.isArray(data) && data?.updatedAt) || '');
      if (!diskUpdatedAt && fromDisk.length) {
        diskUpdatedAt = fromDisk.reduce((m, x) => ((x.updatedAt || '') > m ? x.updatedAt : m), '');
      }
      diskOk = true;
    }
  } catch (_) {}

  const local = loadLocalBundle();

  // 整表较新者胜出（删除会刷新 listUpdatedAt，不会被旧磁盘并集复活）
  if (local.updatedAt && diskUpdatedAt && local.updatedAt >= diskUpdatedAt) {
    cache = local.identities;
    listUpdatedAt = local.updatedAt;
  } else if (diskOk && (diskUpdatedAt || fromDisk.length)) {
    cache = fromDisk;
    listUpdatedAt = diskUpdatedAt || nowIso();
  } else if (local.identities.length) {
    cache = local.identities;
    listUpdatedAt = local.updatedAt || nowIso();
  } else {
    cache = [];
    listUpdatedAt = nowIso();
  }

  persistLocal();
  if (diskOk) await pushToDisk();
}

export function loadCustomIdentities() {
  if (!cache.length && !listUpdatedAt) {
    const local = loadLocalBundle();
    cache = local.identities;
    listUpdatedAt = local.updatedAt || '';
  }
  return cache.slice();
}

export function createCustomIdentity(name, identityVector) {
  const list = loadCustomIdentities();
  const entry = {
    id: newId(),
    name: String(name || '未命名').trim() || '未命名',
    identity: Array.from(identityVector),
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  list.unshift(entry);
  saveAll(list);
  return entry;
}

export async function updateCustomIdentity(id, patch) {
  const list = loadCustomIdentities();
  const idx = list.findIndex((x) => x.id === id);
  if (idx < 0) throw new Error('找不到该自定义身份');
  const cur = list[idx];
  if (patch.name != null) cur.name = String(patch.name).trim() || cur.name;
  if (patch.identity) cur.identity = Array.from(patch.identity);
  cur.updatedAt = nowIso();
  list[idx] = cur;
  // 改名/覆盖保存立即写盘，保证 data/custom-identities.json 为权威源
  await saveAll(list, { immediateDisk: true });
  return cur;
}

export async function deleteCustomIdentity(id) {
  const list = loadCustomIdentities().filter((x) => x.id !== id);
  await saveAll(list, { immediateDisk: true });
}

export function getCustomIdentity(id) {
  return loadCustomIdentities().find((x) => x.id === id) || null;
}

/** 导出全部自定义身份为 JSON 文件 */
export function exportCustomIdentitiesFile(filename = 'gnm_custom_identities.json') {
  const payload = {
    kind: 'gnmWorkshopCustomIdentities',
    version: EXPORT_VERSION,
    exportedAt: nowIso(),
    updatedAt: listUpdatedAt || nowIso(),
    identities: loadCustomIdentities(),
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/**
 * 从 JSON 文件导入（合并：同 id 覆盖，新 id 追加）。
 * @returns {{ added: number, updated: number, total: number }}
 */
export async function importCustomIdentitiesFile(file) {
  const text = await file.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('不是有效的 JSON 文件');
  }
  const incoming = Array.isArray(data)
    ? data
    : Array.isArray(data?.identities)
      ? data.identities
      : null;
  if (!incoming?.length) throw new Error('文件中没有可导入的身份数据');

  const list = loadCustomIdentities();
  const byId = new Map(list.map((x) => [x.id, x]));
  let added = 0;
  let updated = 0;
  for (const raw of incoming) {
    if (!raw?.name || !Array.isArray(raw.identity)) continue;
    const id = raw.id || newId();
    const entry = {
      id,
      name: String(raw.name).trim() || '未命名',
      identity: raw.identity.slice(),
      createdAt: raw.createdAt || nowIso(),
      updatedAt: nowIso(),
    };
    if (byId.has(id)) {
      byId.set(id, entry);
      updated += 1;
    } else {
      byId.set(id, entry);
      added += 1;
    }
  }
  const merged = [...byId.values()];
  await saveAll(merged, { immediateDisk: true });
  return { added, updated, total: merged.length };
}
