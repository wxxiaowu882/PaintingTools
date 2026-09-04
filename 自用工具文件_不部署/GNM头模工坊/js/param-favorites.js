/**
 * 参数收藏：磁盘 JSON 权威 + localStorage 镜像；收藏/取消后自动写入磁盘。
 */

const STORAGE_KEY = 'gnmWorkshop.paramFavorites.v1';
const DISK_API = '/__api/gnm-param-favorites';
const DISK_URL = './data/param-favorites.json';

/** @type {string[]} */
let cache = [];
let _diskTimer = null;
let _inited = false;

function normalizeList(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  const seen = new Set();
  for (const k of arr) {
    if (typeof k !== 'string' || !k.includes(':') || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return normalizeList(JSON.parse(raw));
  } catch (_) {
    return [];
  }
}

function persistLocal() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
}

function mergeLists(disk, local) {
  const seen = new Set();
  const out = [];
  for (const k of [...disk, ...local]) {
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

async function pushToDisk() {
  const payload = {
    kind: 'gnmWorkshopParamFavorites',
    version: 1,
    updatedAt: new Date().toISOString(),
    favorites: cache,
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
    console.warn('[param-favorites] 无法写入磁盘', e.message || e);
    return false;
  }
}

function scheduleDiskWrite() {
  clearTimeout(_diskTimer);
  _diskTimer = setTimeout(() => {
    pushToDisk();
  }, 250);
}

function saveList(list) {
  cache = normalizeList(list);
  persistLocal();
  scheduleDiskWrite();
}

export async function initParamFavorites() {
  let fromDisk = [];
  try {
    let res = await fetch(DISK_API, { cache: 'no-store' }).catch(() => null);
    if (!res || !res.ok) res = await fetch(DISK_URL, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      fromDisk = normalizeList(Array.isArray(data) ? data : data?.favorites);
    }
  } catch (_) {}

  const fromLocal = loadFromStorage();
  cache = mergeLists(fromDisk, fromLocal);
  persistLocal();
  _inited = true;

  if (cache.length) await pushToDisk();
}

function ensureLoaded() {
  if (!_inited && !cache.length) cache = loadFromStorage();
}

export function loadFavoriteKeys() {
  ensureLoaded();
  return cache.slice();
}

export function isFavorite(key) {
  ensureLoaded();
  return cache.includes(key);
}

/** @returns {boolean} 收藏后是否为已收藏状态 */
export function toggleFavorite(key) {
  ensureLoaded();
  const list = cache.slice();
  const i = list.indexOf(key);
  if (i >= 0) {
    list.splice(i, 1);
    saveList(list);
    return false;
  }
  list.push(key);
  saveList(list);
  return true;
}

export function makeFavoriteKey(kind, ...parts) {
  return `${kind}:${parts.join(':')}`;
}
