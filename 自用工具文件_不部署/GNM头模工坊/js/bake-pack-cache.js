/**
 * 上次加载的烘焙包：GLB 存 Cache API，元数据（含外附 map）存 localStorage。
 */

const CACHE_NAME = 'gnm-workshop-bake-v1';
const CACHE_KEY = 'https://gnm-workshop.local/last-baked-pack.glb';
const META_KEY = 'gnmWorkshop.lastBakePackMeta.v1';

function readMeta() {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return null;
    const meta = JSON.parse(raw);
    return meta && typeof meta === 'object' ? meta : null;
  } catch {
    return null;
  }
}

/**
 * @param {ArrayBuffer} glbBuffer
 * @param {{ fileName?: string, mapJson?: object|null }} meta
 */
export async function saveLastBakePack(glbBuffer, meta = {}) {
  const cache = await caches.open(CACHE_NAME);
  await cache.put(
    CACHE_KEY,
    new Response(glbBuffer.slice(0), {
      headers: { 'Content-Type': 'model/gltf-binary' },
    })
  );
  const payload = {
    fileName: meta.fileName || 'baked.glb',
    savedAt: new Date().toISOString(),
    hasExternalMap: !!meta.mapJson,
    mapJson: meta.mapJson || null,
  };
  localStorage.setItem(META_KEY, JSON.stringify(payload));
}

/** @returns {Promise<{ glbBuffer: ArrayBuffer, fileName: string, mapJson: object|null }|null>} */
export async function loadLastBakePack() {
  try {
    const cache = await caches.open(CACHE_NAME);
    const hit = await cache.match(CACHE_KEY);
    if (!hit) return null;
    const glbBuffer = await hit.arrayBuffer();
    const meta = readMeta();
    return {
      glbBuffer,
      fileName: meta?.fileName || 'last_baked.glb',
      mapJson: meta?.hasExternalMap ? meta.mapJson : null,
    };
  } catch (err) {
    console.warn('loadLastBakePack failed', err);
    return null;
  }
}

export async function clearLastBakePack() {
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.delete(CACHE_KEY);
  } catch (_) {}
  localStorage.removeItem(META_KEY);
}
