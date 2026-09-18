/**
 * Solid 标注层「小眼睛」临时显隐（会话态，不写 JSON，不影响另一端存盘字段）。
 * 消费端 / 生产端共用。
 */

export function solidSceneJsonHasOverlayAnnotations(sceneData) {
  if (!sceneData || typeof sceneData !== 'object') return false;
  const ne = function (a) { return Array.isArray(a) && a.length > 0; };
  if (ne(sceneData.groundAnnotations) || ne(sceneData.groundColorSampleAnnotations)
    || ne(sceneData.groundNormArrows) || ne(sceneData.groundProbers) || ne(sceneData.groundPolygon3ds)
    || ne(sceneData.groundDashedLines)) {
    return true;
  }
  const items = sceneData.items;
  if (!Array.isArray(items)) return false;
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    if (!it || typeof it !== 'object') continue;
    if (ne(it.annotations) || ne(it.colorSampleAnnotations) || ne(it.normalArrows) || ne(it.normArrows)
      || ne(it.probers) || ne(it.polygon3ds) || ne(it.dashedLines)) {
      return true;
    }
  }
  return false;
}

/** 生产端编辑中：内存列表也算「有标注」，避免未保存时眼睛按钮不出现。 */
export function solidLiveHasOverlayAnnotations() {
  const ne = function (a) { return Array.isArray(a) && a.length > 0; };
  try {
    if (ne(window.annoDataList) || ne(window.colorSampleAnnoList) || ne(window.normArrowList)
      || ne(window.proberList) || ne(window.poly3dList) || ne(window.dashedLineList)) {
      return true;
    }
  } catch (_e) {}
  return false;
}

export function solidHasOverlayAnnotations(sceneData) {
  return solidSceneJsonHasOverlayAnnotations(sceneData) || solidLiveHasOverlayAnnotations();
}

export function applySolidAnnotationOverlayLayers(visible) {
  const disp = visible ? 'block' : 'none';
  const layer = document.getElementById('anno-layer'); if (layer) layer.style.display = disp;
  const svg = document.getElementById('anno-svg'); if (svg) svg.style.display = disp;
  const csLayer = document.getElementById('anno-cs-layer'); if (csLayer) csLayer.style.display = disp;
  const csSvg = document.getElementById('anno-cs-svg'); if (csSvg) csSvg.style.display = disp;
  const naLayer = document.getElementById('norm-arrow-layer'); if (naLayer) naLayer.style.display = disp;
  const proberLayer = document.getElementById('prober-html-layer'); if (proberLayer) proberLayer.style.display = disp;
  const polyLayer = document.getElementById('poly3d-layer'); if (polyLayer) polyLayer.style.display = disp;
  const dlLayer = document.getElementById('dashed-line-layer'); if (dlLayer) dlLayer.style.display = disp;
}

function syncAnnoEyeButton() {
  const eye = document.getElementById('btn-anno-eye');
  if (!eye) return;
  const on = eye.querySelector('.anno-eye-on');
  const off = eye.querySelector('.anno-eye-off');
  const shown = window.showAnnotations !== false;
  if (on) on.style.display = shown ? 'inline-flex' : 'none';
  if (off) off.style.display = shown ? 'none' : 'inline-flex';
  eye.setAttribute('aria-pressed', shown ? 'true' : 'false');
  eye.title = shown ? '隐藏标注' : '显示标注';
  eye.style.opacity = shown ? '1' : '0.55';
}

/**
 * @param {object} [opts]
 * @param {boolean} [opts.useLiveLists=false] 生产端传 true
 * @param {function} [opts.onHidden] 隐藏时回调（消费端可弹写生 toast）
 */
export function installSolidAnnotationOverlayEye(opts) {
  const o = opts || {};
  const useLive = !!o.useLiveLists;
  if (typeof window.showAnnotations === 'undefined') window.showAnnotations = true;

  window.sceneJsonHasOverlayAnnotations = solidSceneJsonHasOverlayAnnotations;

  window.updateAnnotationEyeButtonVisibility = function () {
    const eye = document.getElementById('btn-anno-eye');
    if (!eye) return;
    const has = useLive
      ? solidHasOverlayAnnotations(window.currentSceneData)
      : solidSceneJsonHasOverlayAnnotations(window.currentSceneData);
    if (!has) {
      eye.style.display = 'none';
      window.showAnnotations = true;
      applySolidAnnotationOverlayLayers(true);
      syncAnnoEyeButton();
      return;
    }
    eye.style.display = 'inline-flex';
    syncAnnoEyeButton();
    applySolidAnnotationOverlayLayers(window.showAnnotations !== false);
  };

  window.toggleAnnotations = function () {
    window.showAnnotations = !(window.showAnnotations !== false);
    syncAnnoEyeButton();
    applySolidAnnotationOverlayLayers(window.showAnnotations !== false);
    if (!window.showAnnotations) {
      try {
        if (window.PluginManager && typeof window.PluginManager.clearAllSelections === 'function') {
          window.PluginManager.clearAllSelections();
        } else if (window.SolidAnnotationDetail && typeof window.SolidAnnotationDetail.clearForAnnotationsOff === 'function') {
          window.SolidAnnotationDetail.clearForAnnotationsOff();
        }
      } catch (_e) {}
      try { if (typeof o.onHidden === 'function') o.onHidden(); } catch (_e2) {}
    }
  };

  return {
    syncAnnoEyeButton,
    applySolidAnnotationOverlayLayers,
    updateAnnotationEyeButtonVisibility: window.updateAnnotationEyeButtonVisibility,
    toggleAnnotations: window.toggleAnnotations,
  };
}
