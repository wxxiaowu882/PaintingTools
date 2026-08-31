/**
 * 用户自定义身份：localStorage 持久化 + JSON 文件导入/导出。
 */

const STORAGE_KEY = 'gnmWorkshop.customIdentities.v1';
const EXPORT_VERSION = 1;

function nowIso() {
  return new Date().toISOString();
}

function newId() {
  return `custom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function loadCustomIdentities() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((x) => x?.id && x?.name && Array.isArray(x.identity));
  } catch (_) {
    return [];
  }
}

function saveAll(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
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

export function updateCustomIdentity(id, patch) {
  const list = loadCustomIdentities();
  const idx = list.findIndex((x) => x.id === id);
  if (idx < 0) throw new Error('找不到该自定义身份');
  const cur = list[idx];
  if (patch.name != null) cur.name = String(patch.name).trim() || cur.name;
  if (patch.identity) cur.identity = Array.from(patch.identity);
  cur.updatedAt = nowIso();
  list[idx] = cur;
  saveAll(list);
  return cur;
}

export function deleteCustomIdentity(id) {
  const list = loadCustomIdentities().filter((x) => x.id !== id);
  saveAll(list);
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
  const merged = [...byId.values()].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  saveAll(merged);
  return { added, updated, total: merged.length };
}
