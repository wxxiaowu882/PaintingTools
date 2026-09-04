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
export const STORAGE_FAVORITES_KEY = 'gnmWorkshop.paramFavorites.v1';

/** 系数为 1 时最大顶点位移 ≥ 1mm 的主维；其余为细微维。 */
const MAIN_IDENTITY = new Set([
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 19, 173, 174, 175,
]);
const MAIN_EXPRESSION = new Set([
  0, 1, 2, 3, 100, 101, 102, 103, 200, 201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 350, 351,
  352, 353, 354, 355, 356, 357,
]);

export function isMainPcaDim(kind, index) {
  const i = Number(index);
  if (kind === 'identity') return MAIN_IDENTITY.has(i);
  if (kind === 'expression') return MAIN_EXPRESSION.has(i);
  return false;
}

/** 主维 ±5，细微维 ±15。 */
export function pcaSliderRange(kind, index) {
  const amp = isMainPcaDim(kind, index) ? 5 : 15;
  return { min: -amp, max: amp };
}

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
