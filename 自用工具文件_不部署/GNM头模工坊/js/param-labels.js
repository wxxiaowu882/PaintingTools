/**
 * 参数显示名称：
 * - 权威源：data/param-labels.json（经本地 serve:repo 的 /__api/gnm-param-labels 自动写入）
 * - 浏览器 localStorage 作镜像；每次改名都会双写
 */

const STORAGE_KEY = 'gnmWorkshop.paramLabels.v1';
const EXPORT_VERSION = 1;
const DISK_API = '/__api/gnm-param-labels';
const DISK_URL = './data/param-labels.json';

const SECTIONS = [
  'identity',
  'expression',
  'pose',
  'commonIdentity',
  'commonExpression',
  'component',
];

/** @type {Record<string, Record<string, string>>} */
let labels = emptySections();
const listeners = new Set();
let _diskTimer = null;
let _diskOk = null; // null=unknown, true/false after first attempt
let _statusEl = null;

function emptySections() {
  return Object.fromEntries(SECTIONS.map((s) => [s, {}]));
}

function normalizePayload(data) {
  const out = emptySections();
  if (!data || typeof data !== 'object') return out;
  for (const s of SECTIONS) {
    const src = data[s];
    if (!src || typeof src !== 'object') continue;
    for (const [k, v] of Object.entries(src)) {
      if (typeof v === 'string' && v.trim()) out[s][k] = v.trim();
    }
  }
  return out;
}

function countLabels(map) {
  return SECTIONS.reduce((n, s) => n + Object.keys(map[s] || {}).length, 0);
}

function mergeMaps(base, over) {
  const out = emptySections();
  for (const s of SECTIONS) {
    out[s] = { ...(base[s] || {}), ...(over[s] || {}) };
  }
  return out;
}

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalizePayload(JSON.parse(raw));
  } catch (_) {}
  return emptySections();
}

function persistLocal() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(labels));
}

function notify() {
  for (const fn of listeners) fn();
}

function setDiskStatus(ok, detail) {
  _diskOk = ok;
  if (!_statusEl) _statusEl = document.getElementById('param-labels-disk-status');
  if (!_statusEl) return;
  if (ok === true) {
    _statusEl.textContent = detail || '名称已自动写入磁盘';
    _statusEl.className = 'param-labels-disk-status is-ok';
  } else if (ok === false) {
    _statusEl.textContent =
      detail || '无法写入磁盘：请用 npm run serve:repo（18080）打开，不要用 Live Server';
    _statusEl.className = 'param-labels-disk-status is-err';
  } else {
    _statusEl.textContent = '';
    _statusEl.className = 'param-labels-disk-status';
  }
}

async function pushToDisk() {
  const payload = {
    kind: 'gnmWorkshopParamLabels',
    version: EXPORT_VERSION,
    updatedAt: new Date().toISOString(),
    ...labels,
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
    const n = countLabels(labels);
    setDiskStatus(true, `名称已写入磁盘（${n} 项）`);
    return true;
  } catch (e) {
    setDiskStatus(false, `无法写入磁盘：${e.message || e}`);
    return false;
  }
}

function scheduleDiskWrite() {
  clearTimeout(_diskTimer);
  _diskTimer = setTimeout(() => {
    pushToDisk();
  }, 250);
}

export async function initParamLabels(url = DISK_URL) {
  let fromDisk = emptySections();
  try {
    // Prefer API (no-cache) when available; fall back to static file
    let res = await fetch(DISK_API, { cache: 'no-store' }).catch(() => null);
    if (!res || !res.ok) res = await fetch(url, { cache: 'no-store' });
    if (res.ok) fromDisk = normalizePayload(await res.json());
  } catch (_) {}

  const fromLocal = loadFromStorage();
  // Disk is authority; local can fill gaps if disk empty/partial after a wipe
  labels = mergeMaps(fromDisk, fromLocal);
  persistLocal();

  // If local had extras not on disk, write merged result back immediately
  if (countLabels(fromLocal) > 0 && countLabels(labels) >= countLabels(fromDisk)) {
    const diskN = countLabels(fromDisk);
    const mergedN = countLabels(labels);
    if (mergedN > diskN) await pushToDisk();
    else if (diskN > 0) setDiskStatus(true, `已从磁盘加载名称（${diskN} 项）`);
    else await pushToDisk();
  } else if (countLabels(fromDisk) > 0) {
    setDiskStatus(true, `已从磁盘加载名称（${countLabels(fromDisk)} 项）`);
  } else {
    // Probe disk write capability once
    await pushToDisk();
  }
}

export function getParamLabel(section, key) {
  const k = String(key);
  return labels[section]?.[k] ?? null;
}

/** @param {string} value 空串或仅空白表示清除自定义名称 */
export function setParamLabel(section, key, value) {
  const k = String(key);
  const text = String(value || '').trim();
  if (!labels[section]) labels[section] = {};
  if (!text) {
    delete labels[section][k];
    if (!Object.keys(labels[section]).length) delete labels[section];
  } else {
    labels[section][k] = text;
  }
  persistLocal();
  scheduleDiskWrite();
  notify();
}

export function onParamLabelsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function exportParamLabelsFile(filename = 'gnm_param_labels.json') {
  const payload = {
    kind: 'gnmWorkshopParamLabels',
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    ...labels,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/**
 * @returns {{ added: number, total: number }}
 */
export async function importParamLabelsFile(file) {
  const text = await file.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('不是有效的 JSON 文件');
  }
  const incoming = normalizePayload(data);
  let added = 0;
  for (const s of SECTIONS) {
    for (const [k, v] of Object.entries(incoming[s] || {})) {
      if (!labels[s]) labels[s] = {};
      if (labels[s][k] !== v) added += 1;
      labels[s][k] = v;
    }
  }
  persistLocal();
  await pushToDisk();
  notify();
  return { added, total: countLabels(labels) };
}

export function getParamLabelsDiskStatus() {
  return _diskOk;
}
