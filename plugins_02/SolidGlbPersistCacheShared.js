// 消费端 Solid.html 与生产端 Solid_Portrait_Create 共用：GLB IndexedDB 持久缓存 + ETag/Length 校验。

import { SOLID_GLB_PERSIST_CACHE } from '../Config/PaintingConfig.js';

const DB_NAME = 'SolidGlbPersistCache_v1';
const DB_VERSION = 1;
const STORE_NAME = 'blobs';

function _normEtag(v) {
  if (v == null) return '';
  return String(v).replace(/^W\//, '').replace(/^"|"$/g, '').trim();
}

function _isNonPersistableUrl(url) {
  const s = String(url || '').trim();
  if (!s) return true;
  return /^(https?:|data:|blob:|file:)/i.test(s);
}

/**
 * 任意 GLB 路径写法 → 站点根 canonical key `/docs/model/xxx.glb`。
 * 不可持久化 URL（data/blob/http）原样返回。
 */
export function normalizeSolidGlbCacheKey(url) {
  try {
    const s = String(url || '').trim();
    if (!s) return s;
    if (_isNonPersistableUrl(s)) return s;
    let x = s.replace(/\\/g, '/');
    x = x.replace(/^(\.\.\/)+docs\/model\//i, 'docs/model/');
    x = x.replace(/^\.\//, '');
    if (x.startsWith('/docs/model/')) return x;
    if (x.startsWith('docs/model/')) return '/' + x;
    const idx = x.toLowerCase().indexOf('/docs/model/');
    if (idx >= 0) return x.substring(idx);
    return x;
  } catch (_e) {
    return url;
  }
}

/** 生产端多候选 fetch 路径；消费端 canonical 单 URL 亦可用首项。 */
export function buildSolidGlbFetchCandidates(url) {
  try {
    const s = String(url || '').trim();
    if (!s) return [];
    if (_isNonPersistableUrl(s)) return [s];
    const x = s.replace(/\\/g, '/');
    const out = [];
    const push = (v) => { if (!v) return; if (!out.includes(v)) out.push(v); };
    const cacheKey = normalizeSolidGlbCacheKey(x);
    if (cacheKey.startsWith('/docs/model/')) {
      push(cacheKey);
      const tail = cacheKey.substring(1);
      push('../../' + tail);
      push('./' + tail);
      push(tail);
    } else if (x.startsWith('/docs/model/')) {
      const tail = x.substring(1);
      push('/' + tail);
      push('../../' + tail);
      push('./' + tail);
      push(tail);
    } else if (x.startsWith('docs/model/')) {
      push('/' + x);
      push('../../' + x);
      push('./' + x);
      push(x);
    } else if (x.startsWith('./docs/model/')) {
      const tail = x.substring(2);
      push('/' + tail);
      push('../../' + tail);
      push(tail);
    } else if (x.startsWith('../docs/model/')) {
      const tail = x.substring(3);
      push('/' + tail);
      push('../../' + tail);
      push(tail);
    } else if (x.startsWith('../../docs/model/')) {
      const tail = x.replace(/^(\.\.\/)+/, '');
      push('/' + tail);
      push('./' + tail);
      push(tail);
    } else {
      push(x);
      push('../../' + x.replace(/^\/+/, ''));
    }
    return out.length ? out : [cacheKey];
  } catch (_e) {
    return [url];
  }
}

function _cfg(isMobile) {
  const c = SOLID_GLB_PERSIST_CACHE || {};
  return {
    enabled: c.enabled !== false,
    maxTotalBytes: isMobile
      ? Math.max(0, Number(c.maxTotalBytesMobile) || 150 * 1024 * 1024)
      : Math.max(0, Number(c.maxTotalBytesDesktop) || 400 * 1024 * 1024),
    maxSingleFileBytes: Math.max(0, Number(c.maxSingleFileBytes) || 80 * 1024 * 1024),
  };
}

export function createSolidGlbPersistCache(opts) {
  const isMobile = !!(opts && opts.isMobile);
  const log = typeof (opts && opts.log) === 'function' ? opts.log : (() => {});
  const getEnabled = typeof (opts && opts.getEnabled) === 'function'
    ? opts.getEnabled
    : () => _cfg(isMobile).enabled;

  let dbPromise = null;
  let idbBroken = false;

  function _openDb() {
    if (idbBroken) return Promise.resolve(null);
    if (typeof indexedDB === 'undefined') {
      idbBroken = true;
      return Promise.resolve(null);
    }
    if (!dbPromise) {
      dbPromise = new Promise((resolve) => {
        try {
          const req = indexedDB.open(DB_NAME, DB_VERSION);
          req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
              db.createObjectStore(STORE_NAME, { keyPath: 'cacheKey' });
            }
          };
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => {
            idbBroken = true;
            log('[GlbPersistCache] IDB open failed');
            resolve(null);
          };
          req.onblocked = () => {
            log('[GlbPersistCache] IDB open blocked');
          };
        } catch (_e) {
          idbBroken = true;
          resolve(null);
        }
      });
    }
    return dbPromise;
  }

  async function _idbGet(cacheKey) {
    const db = await _openDb();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(cacheKey);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      } catch (_e) {
        resolve(null);
      }
    });
  }

  async function _idbGetAllMeta() {
    const db = await _openDb();
    if (!db) return [];
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).getAll();
        req.onsuccess = () => {
          const rows = req.result || [];
          resolve(rows.map((r) => ({
            cacheKey: r.cacheKey,
            byteSize: Number(r.byteSize) || 0,
            lastAccessAt: Number(r.lastAccessAt) || 0,
          })));
        };
        req.onerror = () => resolve([]);
      } catch (_e) {
        resolve([]);
      }
    });
  }

  async function _idbDelete(cacheKey) {
    const db = await _openDb();
    if (!db) return;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(cacheKey);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch (_e) {
        resolve();
      }
    });
  }

  async function _idbClear() {
    const db = await _openDb();
    if (!db) return;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch (_e) {
        resolve();
      }
    });
  }

  async function _evictForBytes(needBytes) {
    const cfg = _cfg(isMobile);
    const meta = await _idbGetAllMeta();
    let total = meta.reduce((a, b) => a + (b.byteSize || 0), 0);
    if (total + needBytes <= cfg.maxTotalBytes) return;
    meta.sort((a, b) => (a.lastAccessAt || 0) - (b.lastAccessAt || 0));
    for (let i = 0; i < meta.length && total + needBytes > cfg.maxTotalBytes; i++) {
      await _idbDelete(meta[i].cacheKey);
      total -= meta[i].byteSize || 0;
      log('[GlbPersistCache] LRU evict ' + meta[i].cacheKey);
    }
  }

  async function _idbPut(entry) {
    const cfg = _cfg(isMobile);
    const byteSize = Number(entry.byteSize) || (entry.buffer ? entry.buffer.byteLength : 0);
    if (byteSize > cfg.maxSingleFileBytes) {
      log('[GlbPersistCache] skip put (single file limit): ' + entry.cacheKey);
      return false;
    }
    await _evictForBytes(byteSize);
    const db = await _openDb();
    if (!db) return false;
    const row = {
      cacheKey: entry.cacheKey,
      buffer: entry.buffer,
      etag: entry.etag || '',
      contentLength: entry.contentLength != null ? Number(entry.contentLength) : byteSize,
      fetchedAt: entry.fetchedAt || Date.now(),
      lastAccessAt: entry.lastAccessAt || Date.now(),
      byteSize,
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      const ok = await new Promise((resolve) => {
        try {
          const tx = db.transaction(STORE_NAME, 'readwrite');
          tx.objectStore(STORE_NAME).put(row);
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
        } catch (_e) {
          resolve(false);
        }
      });
      if (ok) return true;
      await _evictForBytes(byteSize);
    }
    log('[GlbPersistCache] put failed (quota?): ' + entry.cacheKey);
    return false;
  }

  async function _touchAccess(cacheKey, row) {
    if (!row) return;
    row.lastAccessAt = Date.now();
    try { await _idbPut(row); } catch (_e) {}
  }

  async function _fetchHeadMeta(fetchUrl) {
    try {
      const res = await fetch(fetchUrl, { method: 'HEAD', cache: 'no-cache' });
      if (!res.ok) return { ok: false, status: res.status };
      const etag = _normEtag(res.headers.get('etag') || res.headers.get('ETag'));
      const cl = res.headers.get('content-length') || res.headers.get('Content-Length');
      return {
        ok: true,
        etag,
        contentLength: cl != null && cl !== '' ? Number(cl) : null,
      };
    } catch (_e) {
      return { ok: false, status: 0 };
    }
  }

  function _metaMatches(row, meta) {
    if (!row || !meta || !meta.ok) return false;
    if (meta.etag && row.etag) return _normEtag(row.etag) === meta.etag;
    if (meta.contentLength != null && row.contentLength != null) {
      return Number(row.contentLength) === Number(meta.contentLength);
    }
    return false;
  }

  async function _fetchGetArrayBuffer(fetchUrl, { etag, onProgress, isStale } = {}) {
    const headers = {};
    if (etag) headers['If-None-Match'] = etag.startsWith('"') ? etag : '"' + etag + '"';
    const res = await fetch(fetchUrl, { method: 'GET', cache: 'no-cache', headers });
    if (res.status === 304) return { notModified: true, fetchUrl, etag, contentLength: null, buffer: null };
    if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + fetchUrl);
    const cl = res.headers.get('content-length') || res.headers.get('Content-Length');
    const total = cl != null && cl !== '' ? Number(cl) : 0;
    if (!res.body || !res.body.getReader || total <= 0) {
      const buffer = await res.arrayBuffer();
      if (typeof isStale === 'function' && isStale()) throw new Error('stale');
      if (onProgress) onProgress({ loaded: buffer.byteLength, total: buffer.byteLength, lengthComputable: true });
      return {
        notModified: false,
        fetchUrl,
        etag: _normEtag(res.headers.get('etag') || res.headers.get('ETag')),
        contentLength: buffer.byteLength,
        buffer,
      };
    }
    const reader = res.body.getReader();
    const chunks = [];
    let loaded = 0;
    while (true) {
      if (typeof isStale === 'function' && isStale()) {
        try { reader.cancel(); } catch (_e) {}
        throw new Error('stale');
      }
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      if (onProgress) onProgress({ loaded, total: total || loaded, lengthComputable: total > 0 });
    }
    const buffer = new Uint8Array(loaded);
    let off = 0;
    for (let i = 0; i < chunks.length; i++) {
      buffer.set(chunks[i], off);
      off += chunks[i].byteLength;
    }
    return {
      notModified: false,
      fetchUrl,
      etag: _normEtag(res.headers.get('etag') || res.headers.get('ETag')),
      contentLength: loaded,
      buffer: buffer.buffer,
    };
  }

  async function _fetchWithCandidates(candidates, opts) {
    let lastErr = null;
    for (let i = 0; i < candidates.length; i++) {
      try {
        return await _fetchGetArrayBuffer(candidates[i], opts);
      } catch (e) {
        lastErr = e;
        if (String(e && e.message) === 'stale') throw e;
      }
    }
    throw lastErr || new Error('GLB fetch failed');
  }

  async function getOrFetchArrayBuffer(url, options) {
    const opts = options || {};
    const isStale = opts.isStale;
    const onProgress = opts.onProgress;
    const tryCandidates = opts.tryCandidates !== false;
    const cacheKey = normalizeSolidGlbCacheKey(url);

    if (_isNonPersistableUrl(cacheKey) || !cacheKey.startsWith('/docs/model/')) {
      const candidates = tryCandidates ? buildSolidGlbFetchCandidates(url) : [url];
      const got = await _fetchWithCandidates(candidates, { onProgress, isStale });
      return { buffer: got.buffer, fromCache: false, fetchUrl: got.fetchUrl, cacheKey };
    }

    const candidates = tryCandidates ? buildSolidGlbFetchCandidates(url) : [cacheKey];
    const primaryFetchUrl = candidates[0] || cacheKey;

    if (!getEnabled()) {
      const got = await _fetchWithCandidates(candidates, { onProgress, isStale });
      return { buffer: got.buffer, fromCache: false, fetchUrl: got.fetchUrl, cacheKey };
    }

    let row = await _idbGet(cacheKey);
    if (typeof isStale === 'function' && isStale()) throw new Error('stale');

    if (row && row.buffer) {
      const headMeta = await _fetchHeadMeta(primaryFetchUrl);
      if (typeof isStale === 'function' && isStale()) throw new Error('stale');
      if (_metaMatches(row, headMeta)) {
        await _touchAccess(cacheKey, row);
        if (onProgress) {
          const sz = row.byteSize || row.buffer.byteLength || 0;
          onProgress({ loaded: sz, total: sz, lengthComputable: true });
        }
        log('[GlbPersistCache] hit ' + cacheKey);
        return { buffer: row.buffer, fromCache: true, fetchUrl: primaryFetchUrl, cacheKey };
      }
      if (headMeta.ok && headMeta.etag && row.etag) {
        log('[GlbPersistCache] stale etag, refetch ' + cacheKey);
      }
    }

    let got = null;
    try {
      got = await _fetchGetArrayBuffer(primaryFetchUrl, {
        etag: row && row.etag ? row.etag : '',
        onProgress,
        isStale,
      });
    } catch (_eHeadGet) {
      got = null;
    }

    if (got && got.notModified && row && row.buffer) {
      await _touchAccess(cacheKey, row);
      if (onProgress) {
        const sz = row.byteSize || row.buffer.byteLength || 0;
        onProgress({ loaded: sz, total: sz, lengthComputable: true });
      }
      return { buffer: row.buffer, fromCache: true, fetchUrl: primaryFetchUrl, cacheKey };
    }

    if (!got || !got.buffer) {
      got = await _fetchWithCandidates(candidates, { onProgress, isStale });
    }

    if (typeof isStale === 'function' && isStale()) throw new Error('stale');

    const byteSize = got.buffer.byteLength;
    await _idbPut({
      cacheKey,
      buffer: got.buffer,
      etag: got.etag || (row && row.etag) || '',
      contentLength: got.contentLength != null ? got.contentLength : byteSize,
      fetchedAt: Date.now(),
      lastAccessAt: Date.now(),
      byteSize,
    });
    log('[GlbPersistCache] stored ' + cacheKey + ' (' + byteSize + ' bytes)');
    return { buffer: got.buffer, fromCache: false, fetchUrl: got.fetchUrl, cacheKey };
  }

  async function invalidate(url) {
    if (url == null || url === '') {
      await _idbClear();
      log('[GlbPersistCache] cleared all');
      return;
    }
    const cacheKey = normalizeSolidGlbCacheKey(url);
    await _idbDelete(cacheKey);
    log('[GlbPersistCache] invalidated ' + cacheKey);
  }

  async function getStats() {
    const meta = await _idbGetAllMeta();
    return {
      count: meta.length,
      totalBytes: meta.reduce((a, b) => a + (b.byteSize || 0), 0),
      idbBroken,
    };
  }

  return {
    getOrFetchArrayBuffer,
    invalidate,
    getStats,
    normalizeSolidGlbCacheKey,
  };
}
