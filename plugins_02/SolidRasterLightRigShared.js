import { SOLID_RASTER_AREA_LIGHT_RIG } from '../Config/PaintingConfig.js';

function _clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function _safeNum(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function _lerp(a, b, t) {
  return a + (b - a) * t;
}

function _smoothstep(t) {
  const x = _clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

function _toColorHex(c) {
  try {
    if (c && typeof c.getHex === 'function') return c.getHex();
  } catch (_e) {}
  return 0xffffff;
}

export function createSolidRasterLightRig(opts) {
  const THREE = opts && opts.THREE;
  if (!THREE) throw new Error('createSolidRasterLightRig: opts.THREE required');

  const getScene = typeof opts.getScene === 'function' ? opts.getScene : (() => opts.scene);
  const getIsMobile = typeof opts.getIsMobile === 'function' ? opts.getIsMobile : (() => !!opts.isMobile);
  const log = typeof opts.log === 'function' ? opts.log : (() => {});

  let shadowLight = null;
  let emitLight = null;
  let _lastMap = null;

  function _cfg() {
    return SOLID_RASTER_AREA_LIGHT_RIG || {};
  }

  function _enabled() {
    const c = _cfg();
    return !!c.enabled;
  }

  function _removeEmitLight() {
    if (!emitLight) return;
    const scene = getScene();
    try { if (scene) scene.remove(emitLight); } catch (_eRm) {}
    try { if (emitLight.dispose) emitLight.dispose(); } catch (_eDp) {}
    emitLight = null;
  }

  function _computeEmitGeometry(lightSize) {
    const c = _cfg();
    const ec = (c && c.emitLight) ? c.emitLight : {};
    const baseW = _safeNum(ec.widthBase, 8.0);
    const baseH = _safeNum(ec.heightBase, 8.0);
    const sizeScale = _safeNum(ec.sizeScale, 0.5);
    const sizeBias = _safeNum(ec.sizeBias, 0.1);
    const size = _safeNum(lightSize, 1.9);
    const f = size * sizeScale + sizeBias;
    return {
      width: Math.max(0.1, baseW * f),
      height: Math.max(0.1, baseH * f),
      yOffset: _safeNum(ec.yOffset, 0.0),
    };
  }

  function _sizeT(lightSize) {
    const c = _cfg();
    const sMin = _safeNum(c.sizeMin, 1.0);
    const sMax = _safeNum(c.sizeMax, 15.0);
    return _clamp((lightSize - sMin) / Math.max(1e-6, sMax - sMin), 0, 1);
  }

  function _curveT(lightSize) {
    const c = _cfg();
    const ce = (c && c.conservativeEnergy) ? c.conservativeEnergy : {};
    const rawT = _sizeT(lightSize);
    if (ce.curve === 'smoothstep') return _smoothstep(rawT);
    return rawT;
  }

  function _lightTypeKey(lightType, sl) {
    if (lightType === 'point' || (sl && sl.isPointLight)) return 'point';
    if (lightType === 'dir' || (sl && sl.isDirectionalLight)) return 'dir';
    if (lightType === 'rect') return 'rect';
    return 'spot';
  }

  function _mapConservative(lightType, lightSize, intensitySlider) {
    const c = _cfg();
    const ec = (c && c.emitLight) ? c.emitLight : {};
    const cc = (c && c.conservativeEnergy) ? c.conservativeEnergy : {};
    const factors = cc.factors || {};
    const key = _lightTypeKey(lightType, shadowLight);
    const fc = factors[key] || factors.spot || { shadowAtMin: 1.0, shadowAtMax: 0.6, emitAtMin: 0.02, emitAtMax: 0.36 };
    const t = _curveT(lightSize);
    const shadowFactor = _clamp(_lerp(_safeNum(fc.shadowAtMin, 1.0), _safeNum(fc.shadowAtMax, 0.6), t), 0, 2);
    let emitFactor = _clamp(_lerp(_safeNum(fc.emitAtMin, 0.02), _safeNum(fc.emitAtMax, 0.36), t), 0, 2);

    // 全端同路径：移动端受光灯更保守，避免 banding 与叠亮错觉
    const maxEmitFactor = getIsMobile() ? _safeNum(ec.maxFactorMobile, 0.0) : _safeNum(ec.maxFactorDesktop, 0.0);
    emitFactor = Math.min(emitFactor, maxEmitFactor);

    const slider = _safeNum(intensitySlider, 1.7);
    const minI = _safeNum(ec.minIntensity, 0.0);
    const maxI = _safeNum(ec.maxIntensity, 8.0);
    const emitIntensity = _clamp(slider * emitFactor, minI, maxI);
    const shadowIntensityFactor = _clamp(shadowFactor, 0, 2);
    return {
      t,
      emitFactor,
      shadowIntensityFactor,
      emitIntensity,
    };
  }

  function _applyShadowLightEnergy(_intensitySlider, _lightType, _lightSize) {
    return null;
  }

  function _buildShadowSoftPackage(lightType, lightSize) {
    const c = _cfg();
    const sc = (c && c.shadowSoftness) ? c.shadowSoftness : {};
    // 投影软化允许独立于主光 size 上限封顶：
    // 例如主光 size 可到 25（用于交界线），但投影软化只跟到 15。
    const sMin = _safeNum(sc.sizeMin, _safeNum(c.sizeMin, 1.0));
    const sMax = _safeNum(sc.sizeMax, _safeNum(c.sizeMax, 15.0));
    const tRaw = _clamp((lightSize - sMin) / Math.max(1e-6, sMax - sMin), 0, 1);
    const ce = (c && c.conservativeEnergy) ? c.conservativeEnergy : {};
    const t = (ce.curve === 'smoothstep') ? _smoothstep(tRaw) : tRaw;
    // 主光交界线优先：弱化 size 对“阴影核软化”的驱动力，避免暗部变化盖过主光线条变化。
    const tSoft = _clamp(t * 0.42, 0, 1);
    const key = _lightTypeKey(lightType, shadowLight);

    let defR = _safeNum(sc.spotDefault, 1.4);
    let maxR = getIsMobile() ? _safeNum(sc.spotMaxMobile, 1.95) : _safeNum(sc.spotMaxDesktop, 2.4);
    if (key === 'dir') {
      defR = _safeNum(sc.dirDefault, 1.4);
      maxR = getIsMobile() ? _safeNum(sc.dirMaxMobile, 1.85) : _safeNum(sc.dirMaxDesktop, 2.25);
    } else if (key === 'point') {
      defR = _safeNum(sc.pointDefault, 2.2);
      maxR = getIsMobile() ? _safeNum(sc.pointMaxMobile, 2.2) : _safeNum(sc.pointMaxDesktop, 2.85);
    }
    return {
      radiusTarget: _lerp(defR, maxR, tSoft),
      blurMin: getIsMobile() ? _safeNum(sc.blurSamplesMinMobile, 12) : _safeNum(sc.blurSamplesMinDesktop, 18),
      blurMax: getIsMobile() ? _safeNum(sc.blurSamplesMaxMobile, 18) : _safeNum(sc.blurSamplesMaxDesktop, 24),
      blurSampleHysteresis: _safeNum(sc.blurSampleHysteresis, 1.25),
      contactGuard: !!sc.contactGuard,
      lightType: key,
      t: tSoft,
    };
  }

  function setShadowLight(light) {
    shadowLight = light || null;
    try { if (shadowLight && !shadowLight.userData) shadowLight.userData = {}; } catch (_eUd) {}
  }

  function syncAreaEmitter(params) {
    const scene = getScene();
    const p = params || {};
    const useAdvancedRender = !!p.useAdvancedRender;

    // 仅在“光栅模式 + 开关开启 + 有 shadowLight”时启用受光灯
    if (useAdvancedRender || !_enabled() || !shadowLight || !scene) {
      _removeEmitLight();
      return;
    }

    const color = p.color;
    const lightSize = _safeNum(p.lightSize, 1.9);
    const intensitySlider = _safeNum(p.intensitySlider, 1.7);
    const g = _computeEmitGeometry(lightSize);
    const c = _cfg();
    const singleMain = (c.mode || 'single_main') === 'single_main';
    const emitEnabled = !!(c.emitLight && c.emitLight.enabled) && !singleMain;
    const map = _applyShadowLightEnergy(intensitySlider, p.lightType, lightSize) || _mapConservative(p.lightType, lightSize, intensitySlider);
    const eIntensity = map.emitIntensity;

    if (!emitEnabled) {
      _removeEmitLight();
    } else {
      if (!emitLight) {
        emitLight = new THREE.RectAreaLight(_toColorHex(color), eIntensity, g.width, g.height);
        emitLight.castShadow = false;
        scene.add(emitLight);
      } else {
        emitLight.intensity = eIntensity;
        emitLight.width = g.width;
        emitLight.height = g.height;
        try {
          if (emitLight.color && color && typeof emitLight.color.copy === 'function') emitLight.color.copy(color);
        } catch (_eC) {}
      }
      syncPose({ yOffset: g.yOffset });
    }

    // 将统一映射后的 shadow 参数挂到主投影灯，供 SolidPreviewLighting 单点读取。
    try {
      if (shadowLight) {
        if (!shadowLight.userData) shadowLight.userData = {};
        shadowLight.userData.solidAreaShadowSoft = _buildShadowSoftPackage(p.lightType, lightSize);
      }
    } catch (_eUd) {}

    _lastMap = {
      lightSize,
      intensitySlider,
      lightType: _lightTypeKey(p.lightType, shadowLight),
      emitIntensity: eIntensity,
      shadowIntensityFactor: 1.0,
    };
  }

  function syncPose(optsPose) {
    if (!emitLight || !shadowLight) return;
    const yOffset = _safeNum(optsPose && optsPose.yOffset, 0.0);

    try {
      emitLight.position.copy(shadowLight.position);
      emitLight.position.y += yOffset;
    } catch (_ePos) {}

    try {
      if (shadowLight.target) {
        emitLight.lookAt(shadowLight.target.position);
      } else {
        emitLight.lookAt(0, 1, 0);
      }
    } catch (_eLook) {}
  }

  function getShadowLight() {
    return shadowLight;
  }

  function getEmitLight() {
    return emitLight;
  }

  function getPrimaryLight() {
    return shadowLight;
  }

  function dispose() {
    _removeEmitLight();
    try {
      if (shadowLight && shadowLight.userData && shadowLight.userData.solidAreaShadowSoft) delete shadowLight.userData.solidAreaShadowSoft;
    } catch (_eClean) {}
    shadowLight = null;
    _lastMap = null;
  }

  try {
    log('[SolidRasterLightRig] ready');
  } catch (_e) {}

  return {
    setShadowLight,
    syncAreaEmitter,
    syncPose,
    getShadowLight,
    getEmitLight,
    getPrimaryLight,
    getLastMapping: () => _lastMap,
    isEnabled: _enabled,
    isMobileHost: () => !!getIsMobile(),
    dispose,
  };
}

