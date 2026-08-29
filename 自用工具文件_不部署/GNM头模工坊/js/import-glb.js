import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { EXTRAS_KEY, EXTRAS_GNM_KEY, SCHEMA_VERSION } from './extras.js';

let sharedDraco = null;
function getDraco() {
  if (!sharedDraco) {
    sharedDraco = new DRACOLoader();
    sharedDraco.setDecoderPath('../../docs/js/three_164/examples/jsm/libs/draco/gltf/');
  }
  return sharedDraco;
}

function extractPackFromJson(json) {
  const a = json?.asset?.extras?.[EXTRAS_KEY]?.[EXTRAS_GNM_KEY];
  if (a) return a;
  if (json?.nodes) {
    for (const n of json.nodes) {
      const p = n?.extras?.[EXTRAS_KEY]?.[EXTRAS_GNM_KEY];
      if (p) return p;
    }
  }
  return null;
}

/** Parse GLB JSON chunk without full three parse (fast extras check). */
export function peekGnmExtrasFromGlb(arrayBuffer) {
  const data = new DataView(arrayBuffer);
  if (data.getUint32(0, true) !== 0x46546c67) return null;
  let offset = 12;
  while (offset + 8 <= data.byteLength) {
    const chunkLen = data.getUint32(offset, true);
    const chunkType = data.getUint32(offset + 4, true);
    if (chunkType === 0x4e4f534a) {
      const bytes = new Uint8Array(arrayBuffer, offset + 8, chunkLen);
      const text = new TextDecoder().decode(bytes).replace(/\0+$/, '');
      try {
        return extractPackFromJson(JSON.parse(text));
      } catch {
        return null;
      }
    }
    offset += 8 + chunkLen;
  }
  return null;
}

/**
 * @returns {Promise<{pack: object, gltf?: object}>}
 */
export async function importGnmGlbFile(file) {
  const buffer = await file.arrayBuffer();
  const pack = peekGnmExtrasFromGlb(buffer);
  if (!pack) {
    throw new Error('此 GLB 不含 paintingtools.gnmHead 配置，无法在工坊中回炉编辑。');
  }
  if (pack.schemaVersion && pack.schemaVersion > SCHEMA_VERSION) {
    throw new Error(`配置版本 ${pack.schemaVersion} 高于本工坊，请升级工具后再打开。`);
  }

  // Optional: still load mesh via three for sanity (not used as edit source)
  const loader = new GLTFLoader();
  loader.setDRACOLoader(getDraco());
  const gltf = await new Promise((resolve, reject) => {
    loader.parse(buffer, '', resolve, reject);
  });

  return { pack, gltf, fileName: file.name };
}

export function applyPackToModel(model, pack) {
  if (!pack.identity || pack.identity.length !== model.identityDim) {
    throw new Error(`身份维数不匹配：文件 ${pack.identity?.length} / 模型 ${model.identityDim}`);
  }
  if (!pack.expression || pack.expression.length !== model.expressionDim) {
    throw new Error(`表情维数不匹配：文件 ${pack.expression?.length} / 模型 ${model.expressionDim}`);
  }
  model.setIdentityVector(Float32Array.from(pack.identity));
  model.setExpressionVector(Float32Array.from(pack.expression));
  if (pack.pose?.rotations) {
    model.rotations.set(Float32Array.from(pack.pose.rotations));
  }
  if (pack.pose?.translation) {
    model.translation.set(Float32Array.from(pack.pose.translation));
  }
  model.dirty = true;
  return {
    visibility: Array.isArray(pack.visibility)
      ? pack.visibility.slice()
      : Array.from({ length: model.meta.componentNames.length }, () => true),
    commonControlIds: pack.ui?.commonControlIds || null,
    title: pack.ui?.title || '',
    note: pack.ui?.note || '',
  };
}
