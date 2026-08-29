/** @typedef {'light'|'standard'|'full'} ExportTier */

export const EXTRAS_KEY = 'paintingtools';
export const EXTRAS_GNM_KEY = 'gnmHead';
export const SCHEMA_VERSION = 1;
export const GNM_MODEL_VERSION = '3.0';
export const PARAM_EPS = 1e-4;
export const STORAGE_COMMON_KEY = 'gnmWorkshop.commonControlIds.v2';
export const STORAGE_EXPR_KEY = 'gnmWorkshop.commonExpressionIds.v3';
export const STORAGE_DIRTY_ONLY = 'gnmWorkshop.showDirtyOnly.v1';
export const STORAGE_EYE_SYNC = 'gnmWorkshop.eyeSync.v1';
export const STORAGE_ACTIVE_TAB = 'gnmWorkshop.activeTab.v1';

export function createDefaultVisibility(componentCount) {
  return Array.from({ length: componentCount }, () => true);
}

export function buildExtrasPayload({
  model,
  visibility,
  commonControlIds,
  title,
  note,
  exportMeta,
}) {
  return {
    [EXTRAS_KEY]: {
      [EXTRAS_GNM_KEY]: {
        schemaVersion: SCHEMA_VERSION,
        gnmModelVersion: GNM_MODEL_VERSION,
        variant: 'head',
        identity: Array.from(model.identity),
        expression: Array.from(model.expression),
        pose: {
          rotations: Array.from(model.rotations),
          translation: Array.from(model.translation),
        },
        visibility: visibility.slice(),
        ui: {
          commonControlIds: commonControlIds.slice(),
          title: title || '',
          note: note || '',
        },
        export: {
          heightCm: 30,
          align: 'bottomCenter',
          ...(exportMeta || {}),
        },
      },
    },
  };
}

export function readGnmExtras(gltf) {
  const root =
    (gltf.parser && gltf.parser.json && gltf.parser.json.asset && gltf.parser.json.asset.extras) ||
    (gltf.userData && gltf.userData) ||
    null;
  const fromAsset = gltf.parser?.json?.asset?.extras?.[EXTRAS_KEY]?.[EXTRAS_GNM_KEY];
  if (fromAsset) return fromAsset;
  const fromScene = gltf.scene?.userData?.[EXTRAS_KEY]?.[EXTRAS_GNM_KEY];
  if (fromScene) return fromScene;
  if (root?.[EXTRAS_KEY]?.[EXTRAS_GNM_KEY]) return root[EXTRAS_KEY][EXTRAS_GNM_KEY];
  // walk nodes
  let found = null;
  gltf.scene?.traverse?.((obj) => {
    if (found) return;
    const pack = obj.userData?.[EXTRAS_KEY]?.[EXTRAS_GNM_KEY];
    if (pack) found = pack;
  });
  return found;
}

export function isModifiedCoeff(value) {
  return Math.abs(value) > PARAM_EPS;
}
