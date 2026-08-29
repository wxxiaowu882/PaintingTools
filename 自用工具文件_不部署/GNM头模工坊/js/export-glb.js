import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { buildExtrasPayload, EXTRAS_KEY, EXTRAS_GNM_KEY } from './extras.js';

// ES module resolve (relative to this file under js/)
const DRACO_BUNDLE_MOD = '../../GBL管理器/draco/gltf-transform-bundle.js';
// <script> / WASM locateFile resolve relative to the HTML page (工坊根目录)
const DRACO_DIR_PAGE = '../GBL管理器/draco/';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`加载失败: ${src}`));
    document.head.appendChild(s);
  });
}

async function compressDraco(arrayBuffer, { method = 'edgebreaker' } = {}) {
  const mod = await import(DRACO_BUNDLE_MOD);
  const { WebIO, KHRONOS_EXTENSIONS, draco } = mod;
  if (!draco) throw new Error('gltf-transform 未导出 draco()');
  const io = new WebIO().registerExtensions(KHRONOS_EXTENSIONS);
  await loadScript(DRACO_DIR_PAGE + 'draco_encoder.js');
  await loadScript(DRACO_DIR_PAGE + 'draco_decoder.js');
  if (!window.DracoEncoderModule || !window.DracoDecoderModule) {
    throw new Error('Draco WASM 模块未挂载到 window');
  }
  const encoder = await window.DracoEncoderModule({
    locateFile: (file) => DRACO_DIR_PAGE + file,
  });
  const decoder = await window.DracoDecoderModule({
    locateFile: (file) => DRACO_DIR_PAGE + file,
  });
  io.registerDependencies({
    'draco3d.encoder': encoder,
    'draco3d.decoder': decoder,
  });
  const doc = await io.readBinary(new Uint8Array(arrayBuffer));
  await doc.transform(
    draco({
      method,
      quantizationVolume: 'scene',
      quantizePosition: 16,
      quantizeNormal: 12,
    })
  );
  const out = await io.writeBinary(doc);
  return out.buffer ? out.buffer : out;
}

function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/**
 * @param {object} opts
 * @param {import('./viewport.js').WorkshopViewport} opts.viewport
 * @param {import('./vendor/GNMModel.js').GNMHeadModel} opts.model
 * @param {boolean[]} opts.visibility
 * @param {string[]} opts.commonControlIds
 * @param {string} opts.title
 * @param {string} opts.note
 * @param {'light'|'standard'|'full'} opts.tier
 * @param {boolean} opts.useDraco
 * @param {(msg:string)=>void} [opts.onStatus]
 */
export async function exportGnmGlb(opts) {
  const {
    viewport,
    model,
    visibility,
    commonControlIds,
    title,
    note,
    tier = 'standard',
    useDraco = true,
    onStatus,
  } = opts;

  const exportRoot = viewport.buildExportRoot(tier);
  if (!exportRoot) throw new Error('模型尚未就绪');

  const exportMeta = {
    tier,
    draco: !!useDraco,
    heightCm: 30,
    align: 'bottomCenter',
    exportedAt: new Date().toISOString(),
  };
  const extrasRoot = buildExtrasPayload({
    model,
    visibility,
    commonControlIds,
    title,
    note,
    exportMeta,
  });

  // Attach extras on group so exporter can pick userData; also inject into asset later
  exportRoot.userData = { ...exportRoot.userData, ...extrasRoot };
  const headMesh = exportRoot.children[0];
  if (headMesh) headMesh.userData = { ...headMesh.userData, ...extrasRoot };

  onStatus?.('正在序列化 GLB…');
  const exporter = new GLTFExporter();
  const gltfArrayBuffer = await new Promise((resolve, reject) => {
    exporter.parse(
      exportRoot,
      (result) => {
        if (result instanceof ArrayBuffer) resolve(result);
        else reject(new Error('导出未返回二进制 GLB'));
      },
      (err) => reject(err),
      {
        binary: true,
        onlyVisible: true,
        truncateDrawRange: true,
      }
    );
  });

  // Patch asset.extras into GLB JSON chunk for reliable round-trip
  let finalBuffer = patchGlbAssetExtras(gltfArrayBuffer, extrasRoot);

  if (useDraco) {
    onStatus?.('正在 Draco 压缩…');
    try {
      finalBuffer = await compressDraco(finalBuffer);
      // Draco rewrite may drop custom extras — patch again
      finalBuffer = patchGlbAssetExtras(finalBuffer, extrasRoot);
    } catch (err) {
      console.warn('Draco 压缩失败，回退未压缩', err);
      onStatus?.('Draco 失败，已导出未压缩 GLB');
    }
  }

  // dispose temp
  exportRoot.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
      else o.material.dispose();
    }
  });

  const bytes = finalBuffer.byteLength || finalBuffer.length;
  const nameSafe = (title || 'gnm_head').replace(/[^\w\u4e00-\u9fff\-]+/g, '_');
  const filename = `${nameSafe}_${tier}${useDraco ? '_draco' : ''}.glb`;
  downloadBlob(new Blob([finalBuffer], { type: 'model/gltf-binary' }), filename);
  onStatus?.(`已导出 ${(bytes / 1024 / 1024).toFixed(2)} MB · ${filename}`);
  return { filename, bytes };
}

/** Insert/replace asset.extras inside a GLB binary. */
export function patchGlbAssetExtras(arrayBuffer, extrasObject) {
  const data = new DataView(arrayBuffer instanceof ArrayBuffer ? arrayBuffer : arrayBuffer.buffer);
  const magic = data.getUint32(0, true);
  if (magic !== 0x46546c67) return arrayBuffer; // glTF
  const version = data.getUint32(4, true);
  if (version !== 2) return arrayBuffer;

  let offset = 12;
  const chunks = [];
  while (offset < data.byteLength) {
    const chunkLen = data.getUint32(offset, true);
    const chunkType = data.getUint32(offset + 4, true);
    const chunkData = new Uint8Array(arrayBuffer, offset + 8, chunkLen);
    chunks.push({ type: chunkType, data: chunkData });
    offset += 8 + chunkLen;
  }

  const jsonChunk = chunks.find((c) => c.type === 0x4e4f534a);
  const binChunk = chunks.find((c) => c.type === 0x004e4942);
  if (!jsonChunk) return arrayBuffer;

  const jsonText = new TextDecoder().decode(jsonChunk.data);
  const json = JSON.parse(jsonText.replace(/\0+$/, ''));
  json.asset = json.asset || { version: '2.0' };
  json.asset.extras = { ...(json.asset.extras || {}), ...extrasObject };
  // also mirror on first node
  if (json.nodes && json.nodes[0]) {
    json.nodes[0].extras = { ...(json.nodes[0].extras || {}), ...extrasObject };
  }

  let newJson = new TextEncoder().encode(JSON.stringify(json));
  const pad = (4 - (newJson.byteLength % 4)) % 4;
  if (pad) {
    const padded = new Uint8Array(newJson.byteLength + pad);
    padded.set(newJson);
    for (let i = 0; i < pad; i++) padded[newJson.byteLength + i] = 0x20;
    newJson = padded;
  }

  const binData = binChunk ? binChunk.data : null;
  let binPad = 0;
  let binOut = binData;
  if (binData) {
    binPad = (4 - (binData.byteLength % 4)) % 4;
    if (binPad) {
      binOut = new Uint8Array(binData.byteLength + binPad);
      binOut.set(binData);
    }
  }

  const totalLength =
    12 +
    8 +
    newJson.byteLength +
    (binOut ? 8 + binOut.byteLength : 0);
  const out = new ArrayBuffer(totalLength);
  const view = new DataView(out);
  const u8 = new Uint8Array(out);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLength, true);
  let o = 12;
  view.setUint32(o, newJson.byteLength, true);
  view.setUint32(o + 4, 0x4e4f534a, true);
  u8.set(newJson, o + 8);
  o += 8 + newJson.byteLength;
  if (binOut) {
    view.setUint32(o, binOut.byteLength, true);
    view.setUint32(o + 4, 0x004e4942, true);
    u8.set(binOut, o + 8);
  }
  return out;
}
