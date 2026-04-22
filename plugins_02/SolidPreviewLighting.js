// Shared preview-mode lighting for Solid consumer & producer pages.
// “Preview mode” means useAdvancedRender === false in hosts.
//
// 生产端页面（如石膏人像沙盒）请与 Solid.html 一致：只 import 本模块并 wiring install/setEnabled/syncShadows，
// 不要在页面内复制地面阴影的 onBeforeCompile / ShaderChunk 改写逻辑。

import {
  SOLID_RASTER_SHADOW_PERF,
  SOLID_RASTER_IRRADIANCE_PROBES,
  SOLID_RASTER_PREVIEW_AO,
  SOLID_RASTER_AREA_LIGHT_RIG,
  getSolidRasterPreviewLightingDerived,
} from '../Config/PaintingConfig.js';
import { solidInstallOnBeforeCompilePatch, solidSyncOnBeforeCompileExternalHead } from './SolidShaderCompilePipelineShared.js';

/** 地面 SOLID_SHADOW_SOFT_GROUND 片元补丁修订号：递增可强制清缓存重编译（勿随意改）。 */
const SOLID_GROUND_SHADOW_PATCH_REVISION = 10;

/**
 * 与 Solid.html 中 shouldSkipEnvProbe 条件一致，供消费端与生产端共用，避免各写一套导致行为分叉。
 * @param {() => { useAdvancedRender?: boolean; isLoadingScene?: boolean; currentSceneData?: unknown; currentSceneIndex?: number }} getFlags
 */
export function solidRasterPreviewShouldSkipEnvProbe(getFlags) {
  return function shouldSkipEnvProbe(_reason) {
    try {
      const w = (typeof getFlags === 'function' ? getFlags() : {}) || {};
      return !!(
        w.useAdvancedRender ||
        w.isLoadingScene ||
        !w.currentSceneData ||
        w.currentSceneIndex == null ||
        w.currentSceneIndex < 0
      );
    } catch (_e) {
      return false;
    }
  };
}

export function createSolidPreviewLightingManager(opts) {
  const THREE = opts && opts.THREE;
  if (!THREE) throw new Error('createSolidPreviewLightingManager: opts.THREE required');

  const getRenderer = opts.getRenderer || (() => opts.renderer);
  const getScene = opts.getScene || (() => opts.scene);
  const getCamera = opts.getCamera || (() => opts.camera);
  const getSceneGroup = opts.getSceneGroup || (() => opts.sceneGroup);
  const getShadowLight = opts.getShadowLight || opts.getMainLight || (() => opts.mainLight);
  const getGround = opts.getGround || (() => opts.ground);
  const getWalls = opts.getWalls || (() => opts.walls);

  const log = typeof opts.log === 'function' ? opts.log : (() => {});
  const safeDispose = typeof opts.safeDispose === 'function' ? opts.safeDispose : (() => {});

  const getIsMobile = typeof opts.getIsMobile === 'function' ? opts.getIsMobile : (() => !!opts.isMobile);
  const getIsIosHost = typeof opts.getIsIosHost === 'function' ? opts.getIsIosHost : (() => !!opts.isIosHost);
  const getLightState = typeof opts.getLightState === 'function' ? opts.getLightState : (() => opts.lightState || null); // expects { radius?: number }
  const getInteractionState = typeof opts.getInteractionState === 'function' ? opts.getInteractionState : (() => false);
  const shouldSkipEnvProbe = typeof opts.shouldSkipEnvProbe === 'function' ? opts.shouldSkipEnvProbe : () => false;

  let previewEnabled = true;
  let _receiverPatchLastEnsureAt = 0;
  let _receiverEnsureBusy = false;
  let _receiverWallsSigLast = '';
  let _receiverModelsSigLast = '';
  let _receiverWallsSigCache = { sig: '', at: 0 };
  let _receiverModelsSigCache = { sig: '', at: 0 };
  let _sceneChangedSyncToken = 0;
  let _sceneChangedSyncRaf = 0;
  let _sceneChangedSyncTimer80 = 0;
  let _sceneChangedSyncTimer220 = 0;

  // ---------- Perf tiering (interactive vs idle) ----------
  // We only adjust uniforms (taps/rotate) during interaction to avoid shader recompiles.
  let _perfTier = 'idle'; // 'idle' | 'interactive'
  let _perfTierLastApplied = '';
  let _perfLastSphereUpdateAt = 0;
  let _perfLastEnsureAt = 0;
  let _perfLastLogAt = 0;

  function _perfNow() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }

  function _perfIsInteractive(now) {
    try {
      const cfg = SOLID_RASTER_SHADOW_PERF;
      if (!cfg || !cfg.enableDynamicRasterShadowQuality) return false;
      const w = (typeof window !== 'undefined') ? window : null;
      if (!w) return false;
      if (w._orbitInteracting) return true;
      const t = Number(w._solidLastInteractAt || 0);
      const winMs = Math.max(0, Number(cfg.interactWindowMs) || 0);
      return (t > 0) && (now - t) <= winMs;
    } catch (_e) {
      return false;
    }
  }

  function _perfUpdateTier(now) {
    try {
      const cfg = SOLID_RASTER_SHADOW_PERF;
      if (!cfg || !cfg.enableDynamicRasterShadowQuality) {
        _perfTier = 'idle';
        return;
      }
      const w = (typeof window !== 'undefined') ? window : null;
      const lastInteract = w ? Number(w._solidLastInteractAt || 0) : 0;
      const restoreMs = Math.max(0, Number(cfg.restoreDelayMs) || 0);
      const interactive = _perfIsInteractive(now);
      if (interactive) {
        _perfTier = 'interactive';
      } else {
        // Consider idle only after restoreDelayMs has passed since the last interaction.
        if (!lastInteract || (now - lastInteract) >= restoreMs) _perfTier = 'idle';
        else _perfTier = 'interactive';
      }
    } catch (_e) {}
  }

  function _perfTierCfg() {
    const cfg = SOLID_RASTER_SHADOW_PERF || {};
    const t = (cfg.qualityTiers && cfg.qualityTiers[_perfTier]) ? cfg.qualityTiers[_perfTier] : null;
    return t || (cfg.qualityTiers ? cfg.qualityTiers.idle : null) || null;
  }

  function _perfCpuCfg() {
    const cfg = SOLID_RASTER_SHADOW_PERF || {};
    const t = (cfg.cpuThrottle && cfg.cpuThrottle[_perfTier]) ? cfg.cpuThrottle[_perfTier] : null;
    return t || (cfg.cpuThrottle ? cfg.cpuThrottle.idle : null) || null;
  }

  function _receiverSigCacheMs() {
    try {
      const cpuCfg = _perfCpuCfg() || {};
      const ms = Number(cpuCfg.receiverSigCacheMs);
      if (Number.isFinite(ms) && ms >= 0) return ms;
    } catch (_e) {}
    return _perfTier === 'interactive' ? 120 : 40;
  }

  function _bumpReceiverSignatureCaches() {
    _receiverWallsSigCache.at = 0;
    _receiverModelsSigCache.at = 0;
  }

  function _perfApplyUniformQuality(sharedUd, isMobile, isIosHost) {
    try {
      const cfg = SOLID_RASTER_SHADOW_PERF;
      if (!cfg || !cfg.enableDynamicRasterShadowQuality) return false;
      if (!sharedUd) return false;
      const q = _perfTierCfg();
      if (!q) return false;
      const mob = !!(isMobile || isIosHost);
      const taps = mob ? Number(q.tapsMobile) : Number(q.tapsDesktop);
      const rot = Number(q.rotate);
      if (sharedUd.uSolidShadowGaussTaps) sharedUd.uSolidShadowGaussTaps.value = Math.max(4.0, Math.min(32.0, taps || 16.0));
      if (sharedUd.uSolidShadowGaussRotate) sharedUd.uSolidShadowGaussRotate.value = (rot ? 1.0 : 0.0);
      return true;
    } catch (_e) {
      return false;
    }
  }

  // ---------- Raster shadow softening params ----------
  // Goal: keep contact edge relatively sharp, then progressively blur farther away from the model footprint
  // (distance in projected ground plane, NOT distance to light).
  //
  // Tuning tips:
  // - Increase `strength` => farther region gets softer (bigger PCF radius multiplier).
  // - Increase `exp`      => near region stays sharper, far region ramps up faster.
  // - `startH/endH` are multipliers of model height (sceneGroup bbox size.y); they control where the ramp begins/ends.
  //   This is more intuitive for typical Solid assets (~20cm–50cm height).
  const RASTER_SHADOW_SOFT_PARAMS = {
    // Directional / Spot: usually matches the “reference photo” look better (longer, smoother tail).
    dirSpot: {
      // More visible defaults (easy to tune down):
      // start smaller => blur begins closer to the model footprint
      // end smaller   => reaches maximum blur sooner (stronger tail)
      // Aggressive “far end melts away” defaults:
      // - endH smaller => reaches maximum blur earlier, so the far edge loses the hard contour.
      // - exp closer to 1 => mid/far region gets blur sooner (less “stuck sharp”).
      startH: 0.10, // start blur after ~0.10x model height
      endH: 0.95,   // reach max blur at ~0.95x model height
      exp: 1.15,
      strengthDesktop: 140.0,
      strengthMobile: 85.0,
    },
    // Point light cube shadow tends to look “grainier”; keep it slightly more conservative.
    point: {
      // Point light: still aggressive, but a bit more conservative than dir/spot.
      startH: 0.10,
      endH: 0.85,
      exp: 1.10,
      strengthDesktop: 110.0,
      strengthMobile: 70.0,
    },
  };

  // Gaussian-like PCF sampling params.
  // If you see “rings / slice stacking”, increase `taps` and/or enable `rotate` to break fixed tap patterns.
  const RASTER_SHADOW_GAUSS_PARAMS = {
    // Desktop default: smoother penumbra, less ring artifacts.
    // Note: implementation supports up to 32 taps.
    desktop: { taps: 24, rotate: 1 },
    // Mobile: fewer taps to keep it fast.
    mobile: { taps: 12, rotate: 1 },
  };
  let _lastBlurSamplesApplied = 0;

  function _clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function _sizeEffectT(lightState) {
    try {
      const cfg = SOLID_RASTER_AREA_LIGHT_RIG || {};
      const sMin = Number(cfg.sizeMin || 1.0);
      const sMax = Number(cfg.sizeMax || 15.0);
      const s = Number(lightState && lightState.lightSize);
      if (!Number.isFinite(s)) return 0.0;
      return _clamp((s - sMin) / Math.max(1e-6, sMax - sMin), 0, 1);
    } catch (_e) {
      return 0.0;
    }
  }

  function _sizeDrivenShadowSoftness(shadowLight, isMobile, lightState) {
    // 优先读取共享 Rig 计算结果，确保消费/生产与桌面/移动走同一映射真源。
    try {
      const pkg = shadowLight && shadowLight.userData && shadowLight.userData.solidAreaShadowSoft;
      if (pkg && Number.isFinite(pkg.radiusTarget)) {
        const radius = Number(pkg.radiusTarget);
        const minB = Number(pkg.blurMin || (isMobile ? 12 : 18));
        const maxB = Number(pkg.blurMax || (isMobile ? 18 : 24));
        const t = _clamp(Number(pkg.t || 0), 0, 1);
        const target = _clamp(minB + (maxB - minB) * t, Math.min(minB, maxB), Math.max(minB, maxB));
        let blurSamples = Math.round(target);
        const hysteresis = Math.max(0, Number(pkg.blurSampleHysteresis || 1.25));
        const interacting = !!getInteractionState();
        if (_lastBlurSamplesApplied <= 0) _lastBlurSamplesApplied = blurSamples;
        if (interacting) {
          const diff = target - _lastBlurSamplesApplied;
          if (Math.abs(diff) >= hysteresis) _lastBlurSamplesApplied += (diff > 0 ? 1 : -1);
          blurSamples = Math.round(_lastBlurSamplesApplied);
        } else {
          _lastBlurSamplesApplied = blurSamples;
        }
        return { radius, blurSamples, contactGuard: !!pkg.contactGuard };
      }
    } catch (_ePkg) {}

    const cfg = SOLID_RASTER_AREA_LIGHT_RIG;
    const sc = cfg && cfg.shadowSoftness;
    if (!cfg || !sc || !sc.enabled || !shadowLight) return null;

    const s = Number(lightState && lightState.lightSize);
    if (!Number.isFinite(s)) return null;
    const sizeMin = Number(sc.sizeMin || 1.0);
    const sizeMax = Number(sc.sizeMax || (cfg && cfg.sizeMax) || 15.0);
    const t = _clamp((s - sizeMin) / Math.max(1e-6, sizeMax - sizeMin), 0, 1);

    let defR = 1.4;
    let maxR = isMobile ? Number(sc.spotMaxMobile || 2.2) : Number(sc.spotMaxDesktop || 3.0);
    if (shadowLight.isDirectionalLight) {
      defR = Number(sc.dirDefault || 1.4);
      maxR = isMobile ? Number(sc.dirMaxMobile || 2.1) : Number(sc.dirMaxDesktop || 2.8);
    } else if (shadowLight.isPointLight) {
      defR = Number(sc.pointDefault || 2.2);
      maxR = isMobile ? Number(sc.pointMaxMobile || 2.6) : Number(sc.pointMaxDesktop || 3.4);
    } else if (shadowLight.isSpotLight) {
      defR = Number(sc.spotDefault || 1.4);
      maxR = isMobile ? Number(sc.spotMaxMobile || 2.2) : Number(sc.spotMaxDesktop || 3.0);
    }

    const radius = _clamp(defR + (maxR - defR) * t, Math.min(defR, maxR), Math.max(defR, maxR));
    const bsMin = isMobile ? Number(sc.blurSamplesMinMobile || 12) : Number(sc.blurSamplesMinDesktop || 16);
    const bsMax = isMobile ? Number(sc.blurSamplesMaxMobile || 16) : Number(sc.blurSamplesMaxDesktop || 22);
    const target = _clamp(bsMin + (bsMax - bsMin) * t, Math.min(bsMin, bsMax), Math.max(bsMin, bsMax));
    let blurSamples = Math.round(target);
    const hysteresis = Math.max(0, Number(sc.blurSampleHysteresis || 1.25));
    const interacting = !!getInteractionState();
    if (_lastBlurSamplesApplied <= 0) _lastBlurSamplesApplied = blurSamples;
    if (interacting) {
      const diff = target - _lastBlurSamplesApplied;
      if (Math.abs(diff) >= hysteresis) _lastBlurSamplesApplied += (diff > 0 ? 1 : -1);
      blurSamples = Math.round(_lastBlurSamplesApplied);
    } else {
      _lastBlurSamplesApplied = blurSamples;
    }

    return { radius, blurSamples, contactGuard: !!(sc && sc.contactGuard) };
  }

  // ---------- Model soft-terminator (direct lighting) ----------
  const SOLID_TERM_PATCH_REVISION = 3;
  let _termDbgLastAt = 0;
  let _termDbgLastRepl = { mats: 0, repl: 0, zero: 0, pending: 0, fallback: 0, chunk: 0 };

  function _termCfg() {
    try {
      const rig = SOLID_RASTER_AREA_LIGHT_RIG || {};
      return (rig && rig.terminator) ? rig.terminator : {};
    } catch (_e) {
      return {};
    }
  }

  function _termSizeT(st) {
    const tCfg = _termCfg();
    const p = _clamp(Number(tCfg.curvePow || 0.72), 0.05, 3.0);
    return Math.pow(_sizeEffectT(st), p);
  }

  function _applySolidTerminatorShaderPatch(shader, ud) {
    try {
      if (!shader || !ud) return;
      shader.uniforms.uSolidTermSizeT = ud.uSolidTermSizeT;
      shader.uniforms.uSolidTermStrength = ud.uSolidTermStrength;
      shader.uniforms.uSolidTermWidthMin = ud.uSolidTermWidthMin;
      shader.uniforms.uSolidTermWidthMax = ud.uSolidTermWidthMax;
      shader.uniforms.uSolidTermLightType = ud.uSolidTermLightType;
      shader.uniforms.uSolidTermLightPos = ud.uSolidTermLightPos;
      shader.uniforms.uSolidTermLightDir = ud.uSolidTermLightDir;

      const fs0 = shader.fragmentShader || '';
      let fs1 = fs0;
      const hookTag = '#include <lights_fragment_end>';
      const fnMark = 'solidTerminatorFieldFn';
      const hookMark = 'solidTerminatorFieldApply';
      let chunkHit = 0;
      if (!fs1.includes(fnMark)) {
        const uDecl =
          'uniform float uSolidTermSizeT;\n' +
          'uniform float uSolidTermStrength;\n' +
          'uniform float uSolidTermWidthMin;\n' +
          'uniform float uSolidTermWidthMax;\n' +
          'uniform int uSolidTermLightType;\n' +
          'uniform vec3 uSolidTermLightPos;\n' +
          'uniform vec3 uSolidTermLightDir;\n' +
          'varying vec3 vSolidTermWorldPos;\n' +
          'varying vec3 vSolidTermWorldNormal;\n';
        const tFunc =
          '\n// solidTerminatorFieldFn\n' +
          'vec2 solidTerminatorField( float ndl, float sizeT, float strength ) {\n' +
          '\tfloat t = clamp( sizeT, 0.0, 1.0 );\n' +
          '\tfloat s = clamp( strength, 0.0, 1.0 );\n' +
          '\tfloat w = mix( uSolidTermWidthMin, uSolidTermWidthMax, t );\n' +
          '\tfloat sigma = max( 0.02, w * 0.28 );\n' +
          '\tfloat termMask = exp( - ( ndl * ndl ) / max( 1e-5, sigma * sigma ) );\n' +
          '\tfloat ndlSoft = smoothstep( -w, w, ndl );\n' +
          '\tfloat ndlHard = step( 0.0, ndl );\n' +
          '\tfloat gain = mix( ndlHard, ndlSoft, s );\n' +
          '\tgain = mix( 1.0, gain, clamp(0.35 + 0.65 * t, 0.0, 1.0 ) );\n' +
          '\treturn vec2( termMask, gain );\n' +
          '}\n';
        if (fs1.includes('#include <lights_pars_begin>')) fs1 = fs1.replace('#include <lights_pars_begin>', uDecl + tFunc + '\n#include <lights_pars_begin>');
        else fs1 = uDecl + tFunc + fs1;
      }
      let fallbackHit = 0;
      if (fs1.includes(hookTag) && !fs1.includes(hookMark)) {
        const fbCode =
          '\n// solidTerminatorFieldApply\n' +
          '{\n' +
          '\tvec3 solidN = normalize( vSolidTermWorldNormal );\n' +
          '\tvec3 solidL = (uSolidTermLightType == 0) ? normalize( uSolidTermLightDir ) : normalize( uSolidTermLightPos - vSolidTermWorldPos );\n' +
          '\tfloat ndl = dot( solidN, solidL );\n' +
          '\tvec2 tf = solidTerminatorField( ndl, uSolidTermSizeT, uSolidTermStrength );\n' +
          '\tfloat termMask = tf.x;\n' +
          '\tfloat termGain = tf.y;\n' +
          '\t// Anti-regression: 仅处理主光直射项，避免 AO/SH 间接项被误当作主光交界线处理。\n' +
          '\tfloat guard = mix( 0.94, 1.0, termMask );\n' +
          '\treflectedLight.directDiffuse *= clamp( termGain * guard, 0.0, 2.0 );\n' +
          '}\n';
        fs1 = fs1.replace(hookTag, fbCode + hookTag);
        fallbackHit = 1;
        chunkHit = 1;
      }

      if (shader.vertexShader && !shader.vertexShader.includes('vSolidTermWorldPos')) {
        shader.vertexShader = 'varying vec3 vSolidTermWorldPos;\n' + shader.vertexShader;
        const assign = '\n\tvSolidTermWorldPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;';
        if (shader.vertexShader.includes('#include <worldpos_vertex>')) {
          shader.vertexShader = shader.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>' + assign);
        } else if (shader.vertexShader.includes('#include <begin_vertex>')) {
          shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>' + assign);
        }
      }
      if (shader.vertexShader && !shader.vertexShader.includes('vSolidTermWorldNormal')) {
        shader.vertexShader = 'varying vec3 vSolidTermWorldNormal;\n' + shader.vertexShader;
        const assignNDefault = '\n\tvSolidTermWorldNormal = normalize( mat3( modelMatrix ) * objectNormal );';
        const assignNBegin = '\n\tvSolidTermWorldNormal = normalize( mat3( modelMatrix ) * normal );';
        if (shader.vertexShader.includes('#include <defaultnormal_vertex>')) {
          shader.vertexShader = shader.vertexShader.replace('#include <defaultnormal_vertex>', '#include <defaultnormal_vertex>' + assignNDefault);
        } else if (shader.vertexShader.includes('#include <begin_vertex>')) {
          shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>' + assignNBegin);
        }
      }

      shader.fragmentShader = fs1;
      if (!ud._solidTermDbg) ud._solidTermDbg = { repl: 0, zero: 0, compiled: 0 };
      ud._solidTermDbg.repl = 0;
      ud._solidTermDbg.zero = chunkHit ? 0 : 1;
      ud._solidTermDbg.fallback = fallbackHit;
      ud._solidTermDbg.chunk = chunkHit;
      ud._solidTermDbg.termApplied = chunkHit ? 1 : 0;
      ud._solidTermDbg.termMode = chunkHit ? 'chunk_field' : 'none';
      ud._solidTermDbg.termHitChunk = chunkHit ? 'lights_fragment_end' : 'none';
      ud._solidTermDbg.termSpace = 'world';
      ud._solidTermDbg.compiled = 1;
    } catch (_e) {}
  }

  function _installSolidTerminatorPatch(material) {
    try {
      if (!material) return false;
      if (!material.userData) material.userData = {};
      const ud = material.userData;
      // NOTE: Do NOT early-return solely by revision.
      // Other systems (env probes / SH / receivers) may overwrite material.onBeforeCompile after we install.
      // We must ensure our wrapper remains attached to the current onBeforeCompile chain tail.

      if (!ud.uSolidTermSizeT) ud.uSolidTermSizeT = { value: 0.0 };
      if (!ud.uSolidTermStrength) ud.uSolidTermStrength = { value: 0.0 };
      if (!ud.uSolidTermWidthMin) ud.uSolidTermWidthMin = { value: 0.035 };
      if (!ud.uSolidTermWidthMax) ud.uSolidTermWidthMax = { value: 0.26 };
      if (!ud.uSolidTermLightType) ud.uSolidTermLightType = { value: 0 };
      if (!ud.uSolidTermLightPos) ud.uSolidTermLightPos = { value: new THREE.Vector3(0, 2, 0) };
      if (!ud.uSolidTermLightDir) ud.uSolidTermLightDir = { value: new THREE.Vector3(0, 1, 0) };

      solidInstallOnBeforeCompilePatch(material, {
        id: 'solidTerm',
        ver: SOLID_TERM_PATCH_REVISION,
        apply: (shader) => _applySolidTerminatorShaderPatch(shader, ud),
      });

      ud._solidTerminator = { v: SOLID_TERM_PATCH_REVISION };
      return true;
    } catch (_e) {
      return false;
    }
  }

  function _syncSolidTerminatorForSceneGroup(sceneGroup, st, isMobile, isIosHost) {
    try {
      const tCfg = _termCfg();
      const enabled = !!tCfg.enabled;
      if (!sceneGroup || !sceneGroup.traverse) return;

      const sizeT = _termSizeT(st);
      const strength = enabled ? _clamp((isMobile || isIosHost) ? Number(tCfg.strengthMobile || 0.72) : Number(tCfg.strengthDesktop || 0.82), 0, 1) : 0.0;
      const wMin = Number(tCfg.widthMin || 0.035);
      const wMax = Number(tCfg.widthMax || 0.26);

      let hit = 0;
      let replSum = 0;
      let zeroSum = 0;
      let pendingSum = 0;
      let fbSum = 0;
      let chunkSum = 0;
      sceneGroup.traverse((obj) => {
        try {
          if (!obj || !obj.isMesh) return;
          if (obj.userData && obj.userData.solidShadowCore) return;
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (let mi = 0; mi < mats.length; mi++) {
            const m = mats[mi];
            if (!m) continue;
            // ShaderMaterial opt-in only (avoid breaking custom shaders).
            if (m.isShaderMaterial && !(m.userData && m.userData.solidTerminatorOptIn)) continue;
            _installSolidTerminatorPatch(m);
            if (!m.userData) m.userData = {};
            if (m.userData.uSolidTermSizeT) m.userData.uSolidTermSizeT.value = sizeT;
            if (m.userData.uSolidTermStrength) m.userData.uSolidTermStrength.value = strength;
            if (m.userData.uSolidTermWidthMin) m.userData.uSolidTermWidthMin.value = wMin;
            if (m.userData.uSolidTermWidthMax) m.userData.uSolidTermWidthMax.value = wMax;
            try {
              const lt = getShadowLight ? getShadowLight() : null;
              if (lt) {
                const lp = new THREE.Vector3();
                lt.getWorldPosition(lp);
                if (m.userData.uSolidTermLightPos) m.userData.uSolidTermLightPos.value.copy(lp);
                if (m.userData.uSolidTermLightType) m.userData.uSolidTermLightType.value = lt.isDirectionalLight ? 0 : (lt.isSpotLight ? 1 : 2);
                if (m.userData.uSolidTermLightDir) {
                  const d = new THREE.Vector3(0, 1, 0);
                  if (lt.isDirectionalLight && lt.target) {
                    const tpos = new THREE.Vector3();
                    lt.target.getWorldPosition(tpos);
                    d.subVectors(lp, tpos).normalize();
                  }
                  m.userData.uSolidTermLightDir.value.copy(d);
                }
              }
            } catch (_eLt) {}
            hit++;
            try {
              const d = m.userData && m.userData._solidTermDbg ? m.userData._solidTermDbg : null;
              if (d && d.compiled) { replSum += Number(d.repl || 0); zeroSum += Number(d.zero || 0); fbSum += Number(d.fallback || 0); chunkSum += Number(d.chunk || 0); }
              else pendingSum += 1;
            } catch (_eAcc) {}
          }
        } catch (_eM) {}
      });

      if (tCfg && tCfg.debugLog) {
        const now = _perfNow();
        if ((now - _termDbgLastAt) > 800) {
          _termDbgLastAt = now;
          _termDbgLastRepl = { mats: hit, repl: replSum, zero: zeroSum, pending: pendingSum, fallback: fbSum, chunk: chunkSum };
          try { log('[SolidTerm] enabled=' + enabled + ' hitMats=' + hit + ' repl=' + replSum + ' zero=' + zeroSum + ' pending=' + pendingSum + ' fallback=' + fbSum + ' chunk=' + chunkSum + ' sizeT=' + sizeT.toFixed(3) + ' str=' + strength.toFixed(3) + ' w=' + wMin.toFixed(3) + '->' + wMax.toFixed(3)); } catch (_eLg) {}
          // Deferred report: onBeforeCompile runs during actual render. If we log immediately inside syncShadows(),
          // materials may still be "pending" even though the next frame will compile them.
          try {
            const raf = (typeof requestAnimationFrame === 'function') ? requestAnimationFrame : null;
            if (raf) {
              raf(() => {
                try {
                  let cHit = 0;
                  let cRepl = 0;
                  let cZero = 0;
                  let cPend = 0;
                  let cFb = 0;
                  let cChunk = 0;
                  if (sceneGroup && sceneGroup.traverse) {
                    sceneGroup.traverse((obj) => {
                      try {
                        if (!obj || !obj.isMesh) return;
                        if (obj.userData && obj.userData.solidShadowCore) return;
                        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
                        for (let mi = 0; mi < mats.length; mi++) {
                          const m = mats[mi];
                          if (!m) continue;
                          if (m.isShaderMaterial && !(m.userData && m.userData.solidTerminatorOptIn)) continue;
                          cHit++;
                          const d = m.userData && m.userData._solidTermDbg ? m.userData._solidTermDbg : null;
                          if (d && d.compiled) { cRepl += Number(d.repl || 0); cZero += Number(d.zero || 0); cFb += Number(d.fallback || 0); cChunk += Number(d.chunk || 0); }
                          else cPend += 1;
                        }
                      } catch (_eO) {}
                    });
                  }
                  log('[SolidTerm][deferred] enabled=' + enabled + ' hitMats=' + cHit + ' repl=' + cRepl + ' zero=' + cZero + ' pending=' + cPend + ' fallback=' + cFb + ' chunk=' + cChunk + ' sizeT=' + sizeT.toFixed(3) + ' str=' + strength.toFixed(3));
                } catch (_eD) {}
              });
            }
          } catch (_eRaf) {}
        }
      }
    } catch (_e) {}
  }

  function _rasterShadowDbgEnabled() {
    try { return typeof window !== 'undefined' && localStorage.getItem('SolidRasterShadowDbg') === '1'; }
    catch (_e) { return false; }
  }

  function _perfDbgEnabled() {
    try { return !!(SOLID_RASTER_SHADOW_PERF && SOLID_RASTER_SHADOW_PERF.debugLog); }
    catch (_e) { return false; }
  }

  function _contactPatchEnabled() {
    try {
      if (typeof window === 'undefined') return true;
      if (window.__solidContactPatchEnabled != null) return !!window.__solidContactPatchEnabled;
      return localStorage.getItem('SolidContactPatch') !== '0';
    } catch (_e) {
      return true;
    }
  }

  function _contactPatchDebugAllEnabled() {
    try {
      if (typeof window === 'undefined') return false;
      if (window.__solidContactPatchDebugAll != null) return !!window.__solidContactPatchDebugAll;
      return localStorage.getItem('SolidContactPatchDebugAll') === '1';
    } catch (_e) {
      return false;
    }
  }

  function _contactPatchForceRedEnabled() {
    try {
      if (typeof window === 'undefined') return false;
      if (window.__solidContactPatchForceRed != null) return !!window.__solidContactPatchForceRed;
      return localStorage.getItem('SolidContactPatchForceRed') === '1';
    } catch (_e) {
      return false;
    }
  }

  function _receiverSoftShadowWallsEnabled() {
    // Receiver soft shadows are always enabled in raster preview
    // (except directional path where we explicitly keep legacy projection).
    return true;
  }

  function _receiverSoftShadowModelsEnabled() {
    // Receiver soft shadows are always enabled in raster preview
    // (except directional path where we explicitly keep legacy projection).
    return true;
  }

  const _tmpFootprintV = new THREE.Vector3();

  function _installReceiverSoftShadowPatch(material, sharedUd, cfg) {
    try {
      if (!material || !sharedUd) return false;
      const canPatch = !!(material.isMeshPhysicalMaterial || material.isMeshStandardMaterial);
      if (!canPatch) return false;
      if (!material.userData) material.userData = {};
      const ud = material.userData;
      if (!ud._solidReceiverSoft) ud._solidReceiverSoft = { v: 1 };
      if (!ud.uSolidShadowGaussTaps) ud.uSolidShadowGaussTaps = sharedUd.uSolidShadowGaussTaps || { value: 16.0 };
      if (!ud.uSolidShadowGaussRotate) ud.uSolidShadowGaussRotate = sharedUd.uSolidShadowGaussRotate || { value: 1.0 };
      if (!ud.uSolidShadowReceiverEnable) ud.uSolidShadowReceiverEnable = { value: 1.0 };

      if (!material.defines) material.defines = {};
      material.defines.SOLID_SHADOW_SOFT_RECEIVER = 1;
      material.defines.SOLID_SHADOW_SOFT_RECEIVER_KIND = cfg && cfg.kindTag ? cfg.kindTag : 0;
      // Install through shared compile pipeline to avoid re-arm fights.
      const kindTag = cfg && cfg.kindTag ? cfg.kindTag : 0;
      solidInstallOnBeforeCompilePatch(material, {
        id: 'solidShadowReceiver',
        ver: 1,
        variant: 'k' + String(kindTag),
        apply: (shader) => {
          try {
          // --- patch shadow chunk wrappers ---
          let fs = shader.fragmentShader;
          const inc = '#include <shadowmap_pars_fragment>';
          if (!(fs && fs.includes(inc) && THREE.ShaderChunk && THREE.ShaderChunk.shadowmap_pars_fragment)) return;
          // Idempotent guard: if already patched, only update uniforms.
          const already = fs.includes('getShadow_orig') && fs.includes('uSolidShadowReceiverEnable');
          let chunk = THREE.ShaderChunk.shadowmap_pars_fragment;
          chunk = chunk.replace(
            'float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, float shadowRadius, vec4 shadowCoord ) {',
            'float getShadow_orig( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, float shadowRadius, vec4 shadowCoord ) {'
          );
          chunk = chunk.replace(
            'float getPointShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {',
            'float getPointShadow_orig( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {'
          );

          const append =
            '\n\nfloat solidHash12( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }\n' +
            'mat2 solidRot2( float a ) { float s = sin( a ), c = cos( a ); return mat2( c, -s, s, c ); }\n' +
            'float solidShadowSoftCompare( sampler2D shadowMap, vec2 uv, float compareZ, float smoothZ ) {\n' +
            '\tfloat depth = unpackRGBAToDepth( texture2D( shadowMap, uv ) );\n' +
            '\treturn 1.0 - smoothstep( 0.0, smoothZ, compareZ - depth );\n' +
            '}\n' +
            'vec2 solidPoisson24( int i ) {\n' +
            '\tif ( i == 0 ) return vec2( -0.326, -0.406 );\n' +
            '\tif ( i == 1 ) return vec2( -0.840, -0.074 );\n' +
            '\tif ( i == 2 ) return vec2( -0.696,  0.457 );\n' +
            '\tif ( i == 3 ) return vec2( -0.203,  0.621 );\n' +
            '\tif ( i == 4 ) return vec2(  0.962, -0.195 );\n' +
            '\tif ( i == 5 ) return vec2(  0.473, -0.480 );\n' +
            '\tif ( i == 6 ) return vec2(  0.519,  0.767 );\n' +
            '\tif ( i == 7 ) return vec2(  0.185, -0.893 );\n' +
            '\tif ( i == 8 ) return vec2(  0.507,  0.064 );\n' +
            '\tif ( i == 9 ) return vec2(  0.896,  0.412 );\n' +
            '\tif ( i == 10 ) return vec2( -0.322, -0.933 );\n' +
            '\tif ( i == 11 ) return vec2( -0.792, -0.598 );\n' +
            '\tif ( i == 12 ) return vec2( -0.043,  0.280 );\n' +
            '\tif ( i == 13 ) return vec2( -0.155,  0.970 );\n' +
            '\tif ( i == 14 ) return vec2(  0.252,  0.395 );\n' +
            '\tif ( i == 15 ) return vec2( -0.444,  0.106 );\n' +
            '\tif ( i == 16 ) return vec2(  0.727,  0.279 );\n' +
            '\tif ( i == 17 ) return vec2(  0.395, -0.732 );\n' +
            '\tif ( i == 18 ) return vec2( -0.600,  0.780 );\n' +
            '\tif ( i == 19 ) return vec2(  0.043, -0.165 );\n' +
            '\tif ( i == 20 ) return vec2(  0.143,  0.867 );\n' +
            '\tif ( i == 21 ) return vec2(  0.675, -0.160 );\n' +
            '\tif ( i == 22 ) return vec2( -0.325,  0.320 );\n' +
            '\treturn vec2( -0.069, -0.492 );\n' +
            '}\n' +
            'float solidGaussianShadow2D( sampler2D shadowMap, vec2 shadowMapSize, vec4 shadowCoord, float shadowRadius, float shadowBias ) {\n' +
            '\tvec3 sc = shadowCoord.xyz / shadowCoord.w;\n' +
            '\tvec3 sc0 = sc;\n' +
            '\tsc0.z += shadowBias;\n' +
            '\tsc = sc0;\n' +
            '\tbool inFrustum = sc.x >= 0.0 && sc.x <= 1.0 && sc.y >= 0.0 && sc.y <= 1.0;\n' +
            '\tbool frustumTest = inFrustum && sc.z <= 1.0;\n' +
            '\tif ( !frustumTest ) return 1.0;\n' +
            '\tvec2 texel = vec2( 1.0 ) / shadowMapSize;\n' +
            '\tfloat tapsF = clamp( uSolidShadowGaussTaps, 4.0, 32.0 );\n' +
            '\tint taps = int( floor( tapsF + 0.5 ) );\n' +
            '\tfloat ang = ( uSolidShadowGaussRotate > 0.5 ) ? ( 6.2831853 * solidHash12( vSolidShadowWorldPos.xz * 0.071 + sc.xy * shadowMapSize.xy * 0.17 ) ) : 0.0;\n' +
            '\tmat2 R = solidRot2( ang );\n' +
            '\tfloat sum = 0.0;\n' +
            '\tfloat wsum = 0.0;\n' +
            '\tfor ( int i = 0; i < 32; i++ ) {\n' +
            '\t\tif ( i >= taps ) break;\n' +
            '\t\tfloat fi = float(i);\n' +
            '\t\tfloat t = (fi + 0.5) / max( 1.0, float(taps) );\n' +
            '\t\tvec2 o = ( R * solidPoisson24( i ) ) * sqrt( clamp( t, 0.001, 1.0 ) );\n' +
            '\t\tvec2 uv = sc.xy + o * texel * shadowRadius;\n' +
            '\t\tif ( uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 ) continue;\n' +
            '\t\tfloat rr = dot( o, o );\n' +
            '\t\tfloat w = exp( - rr * 2.4 );\n' +
            '\t\tfloat hardTap = texture2DCompare( shadowMap, uv, sc.z );\n' +
            '\t\tfloat softTap = solidShadowSoftCompare( shadowMap, uv, sc.z, 0.0018 );\n' +
            '\t\tfloat tap = min( hardTap, softTap );\n' +
            '\t\tsum += w * tap;\n' +
            '\t\twsum += w;\n' +
            '\t}\n' +
            '\treturn (wsum > 0.0) ? (sum / wsum) : 1.0;\n' +
            '}\n' +
            'float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, float shadowRadius, vec4 shadowCoord ) {\n' +
            '\tif ( uSolidShadowReceiverEnable < 0.5 ) return getShadow_orig( shadowMap, shadowMapSize, shadowBias, shadowRadius, shadowCoord );\n' +
            '\tfloat dSolidSh = 1e9;\n' +
            '\tfor ( int i = 0; i < 8; i++ ) {\n' +
            '\t\tif ( i >= uSolidShadowAnchorCount ) break;\n' +
            '\t\tdSolidSh = min( dSolidSh, length( vSolidShadowWorldPos.xz - uSolidShadowAnchors[i].xz ) );\n' +
            '\t}\n' +
            '\tfloat tSolidSh = smoothstep( uSolidShadowSoftRange.x, uSolidShadowSoftRange.y, dSolidSh );\n' +
            '\ttSolidSh = pow( clamp( tSolidSh, 0.0, 1.0 ), max( 0.75, uSolidShadowSoftExp ) );\n' +
            '\tshadowRadius *= ( 1.0 + uSolidShadowSoftStrength * tSolidSh );\n' +
            '\treturn solidGaussianShadow2D( shadowMap, shadowMapSize, shadowCoord, shadowRadius, shadowBias );\n' +
            '}\n' +
            'float getPointShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {\n' +
            '\treturn getPointShadow_orig( shadowMap, shadowMapSize, shadowBias, shadowRadius, shadowCoord, shadowCameraNear, shadowCameraFar );\n' +
            '}\n';

          const endifIdx = chunk.lastIndexOf('#endif');
          if (endifIdx < 0) return;
          chunk = chunk.slice(0, endifIdx) + append + '\n' + chunk.slice(endifIdx);
          if (!already) fs = fs.replace(inc, chunk);

          shader.uniforms.uSolidShadowAnchorCount = sharedUd.uSolidShadowAnchorCount;
          shader.uniforms.uSolidShadowAnchors = sharedUd.uSolidShadowAnchors;
          shader.uniforms.uSolidShadowSoftRange = sharedUd.uSolidShadowSoftRange;
          shader.uniforms.uSolidShadowSoftStrength = sharedUd.uSolidShadowSoftStrength;
          shader.uniforms.uSolidShadowSoftExp = sharedUd.uSolidShadowSoftExp;
          shader.uniforms.uSolidShadowGaussTaps = ud.uSolidShadowGaussTaps;
          shader.uniforms.uSolidShadowGaussRotate = ud.uSolidShadowGaussRotate;
          shader.uniforms.uSolidShadowReceiverEnable = ud.uSolidShadowReceiverEnable;

          // receiver uniforms/varying
          if (!already) shader.fragmentShader =
            'varying vec3 vSolidShadowWorldPos;\n' +
            'uniform int uSolidShadowAnchorCount;\n' +
            'uniform vec3 uSolidShadowAnchors[8];\n' +
            'uniform vec4 uSolidShadowSoftRange;\n' +
            'uniform float uSolidShadowSoftStrength;\n' +
            'uniform float uSolidShadowSoftExp;\n' +
            'uniform float uSolidShadowGaussTaps;\n' +
            'uniform float uSolidShadowGaussRotate;\n' +
            'uniform float uSolidShadowReceiverEnable;\n' +
            fs;

          // vertex varying assign
          if (!already) {
            shader.vertexShader = 'varying vec3 vSolidShadowWorldPos;\n' + shader.vertexShader;
            const assign = '\n\tvSolidShadowWorldPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;';
            if (shader.vertexShader.includes('#include <worldpos_vertex>')) {
              shader.vertexShader = shader.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>' + assign);
            } else if (shader.vertexShader.includes('#include <begin_vertex>')) {
              shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>' + assign);
            }
          }
          // Receiver patch may become the final onBeforeCompile in chain; ensure terminator patch also runs here.
          try {
            if (ud.uSolidTermSizeT && ud.uSolidTermStrength && ud.uSolidTermWidthMin && ud.uSolidTermWidthMax) {
              _applySolidTerminatorShaderPatch(shader, ud);
            }
          } catch (_eTermRecv) {}
        } catch (_e) {}
        },
      });
      try { solidSyncOnBeforeCompileExternalHead(material); } catch (_e) {}

      // gaussian params
      try {
        const g = cfg && cfg.gauss ? cfg.gauss : { taps: 16, rotate: 1 };
        ud.uSolidShadowGaussTaps.value = g.taps;
        ud.uSolidShadowGaussRotate.value = g.rotate ? 1.0 : 0.0;
      } catch (_eG) {}

      try { ud.uSolidShadowReceiverEnable.value = 1.0; } catch (_eEn) {}
      material.needsUpdate = true;
      return true;
    } catch (_e0) {
      return false;
    }
  }

  function _clearReceiverSoftShadowPatch(material) {
    try {
      if (!material) return false;
      try {
        if (material.userData && material.userData.uSolidShadowReceiverEnable) material.userData.uSolidShadowReceiverEnable.value = 0.0;
      } catch (_eDef) {}
      return true;
    } catch (_e) {
      return false;
    }
  }

  function _hasReceiverSoftPatch(material) {
    try {
      return !!(material && material.defines && material.defines.SOLID_SHADOW_SOFT_RECEIVER === 1);
    } catch (_e) {
      return false;
    }
  }

  function _shouldEnsureReceiverSoftPatch() {
    try {
      if (!previewEnabled) return false;
      const mainLight = getShadowLight();
      if (!mainLight || mainLight.isDirectionalLight) return false;
      const wantWalls = _receiverSoftShadowWallsEnabled();
      const wantModels = _receiverSoftShadowModelsEnabled();
      if (!wantWalls && !wantModels) return false;

      if (wantWalls) {
        const walls = getWalls();
        if (walls && Array.isArray(walls)) {
          for (let wi = 0; wi < walls.length; wi++) {
            const w = walls[wi];
            if (!w || !w.isMesh || !w.material) continue;
            const mats = Array.isArray(w.material) ? w.material : [w.material];
            for (let mi = 0; mi < mats.length; mi++) {
              const mat = mats[mi];
              if (!mat) continue;
              const canPatch = !!(mat.isMeshPhysicalMaterial || mat.isMeshStandardMaterial);
              if (!canPatch) continue;
              if (!_hasReceiverSoftPatch(mat)) return true;
            }
          }
        }
      }

      if (wantModels) {
        const sg = getSceneGroup();
        if (sg && sg.traverse) {
          let need = false;
          sg.traverse((obj) => {
            if (need) return;
            if (!obj || !obj.isMesh || !obj.receiveShadow) return;
            const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
            for (let mi = 0; mi < mats.length; mi++) {
              const mat = mats[mi];
              if (!mat) continue;
              const canPatch = !!(mat.isMeshPhysicalMaterial || mat.isMeshStandardMaterial);
              if (!canPatch) continue;
              if (!_hasReceiverSoftPatch(mat)) { need = true; return; }
            }
          });
          if (need) return true;
        }
      }
      return false;
    } catch (_e) {
      return false;
    }
  }

  function _receiverWallsSignature() {
    try {
      const now = _perfNow();
      const cacheMs = _receiverSigCacheMs();
      if (_receiverWallsSigCache.sig && (now - _receiverWallsSigCache.at) <= cacheMs) return _receiverWallsSigCache.sig;
      const walls = getWalls();
      if (!walls || !Array.isArray(walls)) {
        _receiverWallsSigCache.sig = 'nw';
        _receiverWallsSigCache.at = now;
        return _receiverWallsSigCache.sig;
      }
      const ids = [];
      for (let wi = 0; wi < walls.length; wi++) {
        const w = walls[wi];
        if (!w || !w.isMesh || !w.material) continue;
        const mats = Array.isArray(w.material) ? w.material : [w.material];
        for (let mi = 0; mi < mats.length; mi++) {
          const mat = mats[mi];
          if (!mat) continue;
          ids.push(String(mat.uuid || ('idx' + wi + '_' + mi)));
        }
      }
      ids.sort();
      _receiverWallsSigCache.sig = ids.join('|');
      _receiverWallsSigCache.at = now;
      return _receiverWallsSigCache.sig;
    } catch (_e) {
      return 'errw';
    }
  }

  function _receiverModelsSignature() {
    try {
      const now = _perfNow();
      const cacheMs = _receiverSigCacheMs();
      if (_receiverModelsSigCache.sig && (now - _receiverModelsSigCache.at) <= cacheMs) return _receiverModelsSigCache.sig;
      const sg = getSceneGroup();
      if (!sg || !sg.traverse) {
        _receiverModelsSigCache.sig = 'nm';
        _receiverModelsSigCache.at = now;
        return _receiverModelsSigCache.sig;
      }
      const ids = [];
      sg.traverse((obj) => {
        if (!obj || !obj.isMesh || !obj.receiveShadow) return;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (let mi = 0; mi < mats.length; mi++) {
          const mat = mats[mi];
          if (!mat) continue;
          ids.push(String(mat.uuid || ('midx' + mi)));
        }
      });
      ids.sort();
      _receiverModelsSigCache.sig = ids.join('|');
      _receiverModelsSigCache.at = now;
      return _receiverModelsSigCache.sig;
    } catch (_e) {
      return 'errm';
    }
  }

  /**
   * 地面脚印圆盘：旧版用水平 AABB 外接圆 (0.5*max(sx,sz))，头像等竖高网格会把整头宽度当“脚”，补丁过大。
   * 优先用「底部一条带」内顶点在 xz 上的包围盒，再混合内外接圆；无几何或蒙皮实例则退回较紧的 AABB 混合半径。
   * @returns {{ cx: number, cz: number, r: number } | null}
   */
  function _computeFootprintSphereOnGround(node, groundY, groundEps, tmpBox, tmpSize) {
    try {
      if (!node.userData) node.userData = {};
      const cache = node.userData._solidFootprintCache;
      const geom = node.geometry;
      const posAttr = geom && geom.attributes ? geom.attributes.position : null;
      const posVersion = posAttr && posAttr.version != null ? posAttr.version : 0;
      const worldMatrix = node.matrixWorld;
      const me = worldMatrix && worldMatrix.elements ? worldMatrix.elements : null;
      if (cache && cache.matrix && me && cache.posVersion === posVersion && cache.groundY === groundY && cache.groundEps === groundEps) {
        let same = true;
        for (let i = 0; i < 16; i++) {
          if (cache.matrix[i] !== me[i]) { same = false; break; }
        }
        if (same) return cache.fp;
      }
      tmpBox.setFromObject(node);
      if (!tmpBox || tmpBox.isEmpty()) return null;
      const minY = (tmpBox.min && tmpBox.min.y != null) ? tmpBox.min.y : 1e9;
      if (minY > groundY + groundEps) return null;

      tmpBox.getSize(tmpSize);
      const sx = Math.abs(tmpSize.x);
      const sz = Math.abs(tmpSize.z);
      const tmpH = tmpBox.max.y - tmpBox.min.y;
      const bminY = tmpBox.min.y;
      const halfMin = 0.5 * Math.min(sx, sz);
      const halfMax = 0.5 * Math.max(sx, sz);
      const rFallback = Math.max(0.04, halfMax);

      let cx = 0.5 * (tmpBox.min.x + tmpBox.max.x);
      let cz = 0.5 * (tmpBox.min.z + tmpBox.max.z);
      // 比纯外接圆紧：长短轴混合（细长物体明显缩小）
      let r = Math.max(0.04, 0.62 * halfMin + 0.38 * halfMax);

      const canSampleVerts =
        geom &&
        geom.attributes &&
        geom.attributes.position &&
        !node.isSkinnedMesh &&
        !node.isInstancedMesh;

      if (canSampleVerts) {
        const posAttr = geom.attributes.position;
        const count = posAttr.count;
        const sliceH = Math.min(Math.max(tmpH * 0.14, 0.025), 0.11);
        const yCut = bminY + sliceH;
        let minX = Infinity;
        let maxX = -Infinity;
        let minZ = Infinity;
        let maxZ = -Infinity;
        let nHit = 0;
        let sumX = 0.0;
        let sumZ = 0.0;
        const stride = Math.max(1, Math.floor(count / 14000));
        const m = node.matrixWorld;
        for (let vi = 0; vi < count; vi += stride) {
          _tmpFootprintV.fromBufferAttribute(posAttr, vi).applyMatrix4(m);
          if (_tmpFootprintV.y <= yCut + 1e-5) {
            const vx = _tmpFootprintV.x;
            const vz = _tmpFootprintV.z;
            if (vx < minX) minX = vx;
            if (vx > maxX) maxX = vx;
            if (vz < minZ) minZ = vz;
            if (vz > maxZ) maxZ = vz;
            sumX += vx;
            sumZ += vz;
            nHit++;
          }
        }
        if (nHit >= 3) {
          // 用底部顶点带的均值作为圆心，再取最大半径（对圆锥/圆柱底面更贴合，避免 bbox 中心偏移造成“补丁两侧冒出”）
          const inv = 1.0 / nHit;
          const cxMean = sumX * inv;
          const czMean = sumZ * inv;
          let maxD2 = 0.0;
          for (let vi = 0; vi < count; vi += stride) {
            _tmpFootprintV.fromBufferAttribute(posAttr, vi).applyMatrix4(m);
            if (_tmpFootprintV.y <= yCut + 1e-5) {
              const dx = _tmpFootprintV.x - cxMean;
              const dz = _tmpFootprintV.z - czMean;
              const d2 = dx * dx + dz * dz;
              if (d2 > maxD2) maxD2 = d2;
            }
          }
          const rr = Math.sqrt(Math.max(0.0, maxD2));
          if (rr > 1e-6) {
            cx = cxMean;
            cz = czMean;
            r = Math.min(rFallback, Math.max(0.04, rr));
          }
        } else if (nHit >= 2 && maxX > minX && maxZ > minZ) {
          // 退回：仍用底部顶点带 bbox 的内外接混合（比纯外接圆紧）
          const frx = 0.5 * (maxX - minX);
          const frz = 0.5 * (maxZ - minZ);
          cx = 0.5 * (minX + maxX);
          cz = 0.5 * (minZ + maxZ);
          const rBlend = 0.58 * Math.min(frx, frz) + 0.42 * Math.max(frx, frz);
          r = Math.min(rFallback, Math.max(0.04, rBlend));
        }
      }

      const fp = { cx, cz, r };
      if (me) {
        const matCopy = cache && cache.matrix ? cache.matrix : new Float32Array(16);
        for (let i = 0; i < 16; i++) matCopy[i] = me[i];
        node.userData._solidFootprintCache = {
          matrix: matCopy,
          posVersion,
          groundY,
          groundEps,
          fp,
        };
      }
      return fp;
    } catch (_eFp) {
      return null;
    }
  }

  function _fillGroundSphereUniforms(sharedUd, sceneGroup, groundY, epsY) {
    try {
      if (!sharedUd || !sharedUd.uSolidSphereCenters || !sharedUd.uSolidSphereRadii || !sharedUd.uSolidSphereCount) return false;
      let n = 0;
      let nBuiltin = 0;
      const tmpPos = new THREE.Vector3();
      const tmpScale = new THREE.Vector3();
      const tmpBox = new THREE.Box3();
      const tmpSize = new THREE.Vector3();
      if (sceneGroup) {
        const stack = [sceneGroup];
        const otherCandidates = [];
        while (stack.length) {
          const node = stack.pop();
          if (!node) continue;
          const children = node.children;
          if (children && children.length) {
            for (let ci = 0; ci < children.length; ci++) stack.push(children[ci]);
          }
          if (!node.isMesh) continue;
          if (!node.castShadow) continue;
          try {
            if (node.userData && node.userData.type === 'builtin' && node.userData.shape === 'sphere') {
              if (n < 8) {
                node.getWorldPosition(tmpPos);
                node.getWorldScale(tmpScale);
                const r0 = Math.max(0.0001, Math.abs(tmpScale.y) * 2.0);
                sharedUd.uSolidSphereCenters.value[n].copy(tmpPos);
                sharedUd.uSolidSphereRadii.value[n] = r0;
                n++;
                nBuiltin++;
              }
              continue;
            }
          } catch (_eBs) {}
          if (node.userData && node.userData.solidShadowCore) continue;
          if (n < 8) otherCandidates.push(node);
        }
        for (let si = 0; si < otherCandidates.length && n < 8; si++) {
          const node = otherCandidates[si];
          try {
            const fp = _computeFootprintSphereOnGround(node, groundY, epsY, tmpBox, tmpSize);
            if (!fp) continue;
            sharedUd.uSolidSphereCenters.value[n].set(fp.cx, groundY, fp.cz);
            sharedUd.uSolidSphereRadii.value[n] = fp.r;
            n++;
          } catch (_eS) {}
        }
      }
      sharedUd.uSolidSphereCount.value = n;
      if (sharedUd.uSolidBuiltinSphereCount) sharedUd.uSolidBuiltinSphereCount.value = nBuiltin;
      return true;
    } catch (_eFill) {
      return false;
    }
  }

  // ---------- Shadow soft ground patch (consumer extracted) ----------
  function _fitRasterShadowFrustumForSceneGroup(lightOverride) {
    try {
      const mainLight = lightOverride || getShadowLight();
      const sceneGroup = getSceneGroup();
      if (!mainLight || !mainLight.shadow || !mainLight.shadow.camera || !sceneGroup) return;
      const sh = mainLight.shadow;

      const box = new THREE.Box3();
      box.setFromObject(sceneGroup);
      if (box.isEmpty()) return;
      const size = new THREE.Vector3();
      box.getSize(size);
      try { box.expandByScalar(0.35); } catch (_e) {}
      const sphere = new THREE.Sphere();
      box.getBoundingSphere(sphere);
      if (!(sphere.radius > 1e-4)) return;

      const lp = new THREE.Vector3();
      mainLight.getWorldPosition(lp);
      const dist = lp.distanceTo(sphere.center);
      const margin = 3.2;
      let desiredFar = Math.max(10, dist + sphere.radius + margin);

      let grazeMul = 1.0;
      try {
        const dir = new THREE.Vector3();
        if ((mainLight.isDirectionalLight || mainLight.isSpotLight) && mainLight.target) {
          mainLight.target.getWorldPosition(dir);
          dir.sub(lp).normalize();
        } else {
          dir.subVectors(sphere.center, lp).normalize();
        }
        const ay = Math.max(0.12, Math.min(1.0, Math.abs(dir.y)));
        grazeMul = Math.min(3.8, Math.max(1.0, 1.0 / ay));
      } catch (_eG) {}

      desiredFar *= (0.92 + 0.48 * grazeMul);

      const st = getLightState() || {};
      const radius = Number(st.radius) || 18;

      if (mainLight.isSpotLight) {
        const cap = Math.min(175, Math.max(70, radius * 2.75 + 38));
        sh.camera.far = Math.min(cap, Math.max(32, desiredFar * 1.14));
        const n = Math.max(0.18, Math.min(0.85, sh.camera.far * 0.012));
        sh.camera.near = Math.min(n, sh.camera.far * 0.06);
        sh.camera.updateProjectionMatrix();
      } else if (mainLight.isPointLight) {
        const cap = Math.min(175, Math.max(70, radius * 2.75 + 38));
        sh.camera.far = Math.min(cap, Math.max(32, desiredFar * 1.18));
        sh.camera.near = Math.max(0.22, Math.min(1.2, sh.camera.far * 0.015));
        sh.camera.updateProjectionMatrix();
      } else if (mainLight.isDirectionalLight) {
        const capF = Math.min(125, radius * 4.2 + 58);
        sh.camera.far = Math.min(capF, Math.max(28, desiredFar + 18));
        sh.camera.near = Math.max(0.6, Math.min(2.2, sh.camera.far * 0.03));
        try {
          const cam = sh.camera;
          const heAuto = (Math.max(size.x, size.z) * 0.72 + 6.5) * Math.min(2.6, Math.max(1.0, 0.75 + 0.35 * grazeMul));
          const he = Math.max(18, Math.min(78, heAuto));
          cam.left = -he; cam.right = he; cam.top = he; cam.bottom = -he;
        } catch (_eHe) {}
        sh.camera.updateProjectionMatrix();
      }
    } catch (_e) {}
  }

  function syncGroundShadowUniforms() {
    try {
      if (!previewEnabled) return;
      const nowPerf = _perfNow();
      _perfUpdateTier(nowPerf);

      // Keep shadowMap type stable in preview mode.
      // Some hosts may switch shadowMap.type during light moves; PCFSoft ignores shadowRadius in r164,
      // which would make our distance-based softening appear “hard”.
      try {
        const renderer = getRenderer();
        if (renderer && renderer.shadowMap) {
          if (renderer.shadowMap.enabled && renderer.shadowMap.type !== THREE.PCFShadowMap) {
            renderer.shadowMap.type = THREE.PCFShadowMap;
            renderer.shadowMap.needsUpdate = true;
          }
        }
      } catch (_eSmType) {}
      const mainLight = getShadowLight();
      const ground = getGround();
      const sceneGroup = getSceneGroup();
      if (!mainLight || !ground || !ground.material || !ground.material.userData) return;
      const ud = ground.material.userData;
      if (!ud.uSolidMainLightPos || !ud.uSolidMainLightDir || !ud.uSolidMainLightType) return;
      if (ud.uSolidContactPatchEnable) ud.uSolidContactPatchEnable.value = _contactPatchEnabled() ? 1.0 : 0.0;
      if (ud.uSolidSphereDebug) ud.uSolidSphereDebug.value = _contactPatchDebugAllEnabled() ? 1.0 : 0.0;
      if (ud.uSolidDbgForceRed) ud.uSolidDbgForceRed.value = _contactPatchForceRedEnabled() ? 1.0 : 0.0;

      // Apply dynamic uniform quality (taps/rotate) only on tier changes.
      // This keeps interaction fast while guaranteeing idle recovers to baseline.
      try {
        if (SOLID_RASTER_SHADOW_PERF && SOLID_RASTER_SHADOW_PERF.enableDynamicRasterShadowQuality) {
          if (_perfTier !== _perfTierLastApplied) {
            const isMobile = !!getIsMobile();
            const isIosHost = !!getIsIosHost();
            _perfApplyUniformQuality(ud, isMobile, isIosHost);
            _perfTierLastApplied = _perfTier;
            // IMPORTANT: do NOT call syncShadows() on tier transitions.
            // syncShadows() may bump ground program cache key and trigger shader recompilation,
            // which causes a visible hitch during interaction. Tiering here is uniform-only.
          }
        }
      } catch (_eTier) {}

      // Optional debug log (throttled).
      try {
        if (_perfDbgEnabled()) {
          if ((nowPerf - _perfLastLogAt) > 900) {
            _perfLastLogAt = nowPerf;
            log('[RasterShadowPerf] tier=' + _perfTier);
          }
        }
      } catch (_eLog) {}

      // Deterministic auto-heal:
      // - immediate re-arm when receiver material signature changes
      // - throttled safety check for unexpected missing patch
      try {
        if (!_receiverEnsureBusy) {
          const now = nowPerf;
          const mainLight = getShadowLight();
          const isDir = !!(mainLight && mainLight.isDirectionalLight);
          const wantWalls = _receiverSoftShadowWallsEnabled();
          const wantModels = _receiverSoftShadowModelsEnabled();
          let changed = false;

          if (!isDir && wantWalls) {
            const sigW = _receiverWallsSignature();
            if (sigW !== _receiverWallsSigLast) {
              _receiverWallsSigLast = sigW;
              changed = true;
            }
          }
          if (!isDir && wantModels) {
            const sigM = _receiverModelsSignature();
            if (sigM !== _receiverModelsSigLast) {
              _receiverModelsSigLast = sigM;
              changed = true;
            }
          }

          // Throttle auto-heal more aggressively during interaction to avoid extra syncShadows cost.
          const cpuCfg = _perfCpuCfg() || {};
          const ensureMs = Math.max(50, Number(cpuCfg.receiverEnsureMs) || 380);
          const needByThrottle = (now - _receiverPatchLastEnsureAt) > ensureMs && _shouldEnsureReceiverSoftPatch();
          if (changed || needByThrottle) {
            _receiverEnsureBusy = true;
            try { syncShadows(); } catch (_eReSync) {}
            _receiverPatchLastEnsureAt = now;
            _receiverEnsureBusy = false;
          }
        }
      } catch (_eEnsure) {}

      const lp = new THREE.Vector3();
      mainLight.getWorldPosition(lp);
      ud.uSolidMainLightPos.value.copy(lp);
      if (mainLight.isPointLight) ud.uSolidMainLightType.value = 2;
      else if (mainLight.isSpotLight) ud.uSolidMainLightType.value = 1;
      else ud.uSolidMainLightType.value = 0;

      const d = new THREE.Vector3(0, 1, 0);
      if (ud.uSolidMainLightType.value === 0 && mainLight.target) {
        const t = new THREE.Vector3();
        mainLight.target.getWorldPosition(t);
        d.subVectors(lp, t).normalize();
      }
      ud.uSolidMainLightDir.value.copy(d);

      // Keep sphere-based occlusion data up-to-date every frame.
      // IMPORTANT: this must NOT be limited to builtin spheres; otherwise only spheres get “contact seam” protection.
      // We approximate near-ground casters as spheres on the ground plane (xz footprint).
      if (ud.uSolidSphereCenters && ud.uSolidSphereRadii && ud.uSolidSphereCount) {
        // CPU throttle: during interaction we update these approximations at a lower rate.
        const cpuCfg = _perfCpuCfg() || {};
        const sphereEveryMs = Math.max(0, Number(cpuCfg.sphereOccluderUpdateMs) || 0);
        if (sphereEveryMs > 0 && (nowPerf - _perfLastSphereUpdateAt) < sphereEveryMs) return;
        _perfLastSphereUpdateAt = nowPerf;

        const groundY = (ground && ground.position) ? ground.position.y : 0;
        const epsY = 0.12; // tolerant: many assets float slightly; keep in sync with syncShadows()
        _fillGroundSphereUniforms(ud, sceneGroup, groundY, epsY);
      }
    } catch (_e) {}
  }

  function syncShadows() {
    try {
      if (!previewEnabled) return;
      const renderer = getRenderer();
      const scene = getScene();
      const mainLight = getShadowLight();
      const ground = getGround();
      const sceneGroup = getSceneGroup();
      const walls = getWalls();

      if (!renderer || !scene || !mainLight) return;
      if (!renderer.shadowMap) return;

      const isMobile = !!getIsMobile();
      const isIosHost = !!getIsIosHost();
      const st = getLightState() || {};

      const dbg = _rasterShadowDbgEnabled();
      const nowPerf = _perfNow();
      _perfUpdateTier(nowPerf);

      const clearGroundSoftPatch = () => {
        try {
          if (!ground || !ground.material) return;
          const m0 = ground.material;
          // three.js built-in `customProgramCacheKey()` may call `onBeforeCompile.toString()`;
          // never set it to undefined, or MeshPhysicalMaterial may crash at render time.
          if (m0.onBeforeCompile) m0.onBeforeCompile = function() {};
          if (m0.userData) {
            delete m0.userData.uSolidShadowAnchorCount;
            delete m0.userData.uSolidShadowAnchors;
            delete m0.userData.uSolidShadowSoftRange;
            delete m0.userData.uSolidShadowSoftStrength;
            delete m0.userData.uSolidShadowSoftExp;
            delete m0.userData.uSolidContactPatchEnable;
            delete m0.userData.uSolidBuiltinSphereCount;
            delete m0.userData._solidShadowSoftVer;
          }
          if (m0.customProgramCacheKey) delete m0.customProgramCacheKey;
          if (m0.defines) {
            delete m0.defines.SOLID_SHADOW_SOFT_GROUND;
            delete m0.defines.SOLID_SHADOW_SOFT_GROUND_VER;
          }
          m0.needsUpdate = true;
        } catch (_eClr) {}
      };

      if ((mainLight && mainLight.isRectAreaLight) || !mainLight.shadow) {
        if (renderer.shadowMap.enabled) {
          renderer.shadowMap.enabled = false;
          renderer.shadowMap.needsUpdate = true;
        }
        try { mainLight.castShadow = false; } catch (_e) {}
        clearGroundSoftPatch();
        if (dbg) log('[RasterShadowSoft] skip: rect/no-shadow light');
        return;
      }

      if (!renderer.shadowMap.enabled) {
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.needsUpdate = true;
      }
      // IMPORTANT: three r164 `SHADOWMAP_TYPE_PCF_SOFT` ignores `shadowRadius`.
      // Our “distance-based blur” is implemented by scaling `shadowRadius` inside getShadow/getPointShadow,
      // so we must use PCFShadowMap here to make the blur visible.
      if (renderer.shadowMap.type !== THREE.PCFShadowMap) {
        renderer.shadowMap.type = THREE.PCFShadowMap;
        renderer.shadowMap.needsUpdate = true;
      }
      try { if (typeof window !== 'undefined' && window._solidFallbackRenderAt !== undefined) window._solidFallbackRenderAt = 0; } catch (_eFb) {}

      // Physical: point/directional/spot cast shadows on themselves (no shadow proxy light).
      mainLight.castShadow = true;
      const shadowLight = mainLight;
      const sh = shadowLight.shadow;
      // Optional dynamic shadowMap mapSize tiering (OFF by default).
      // We only change it on tier transitions (via syncShadows calls), never per-frame.
      let ms = isMobile ? 3072 : 4096;
      const range = Math.min(175, Math.max(96, (Number(st.radius) || 18) * 2.75 + 48));
      try {
        const cfg = SOLID_RASTER_SHADOW_PERF;
        if (cfg && cfg.enableDynamicRasterShadowQuality && cfg.enableDynamicShadowMapSize && cfg.shadowMapSizeTiers) {
          const t = (_perfTier === 'interactive') ? 'interactive' : 'idle';
          if (t === 'interactive') {
            ms = isMobile ? Number(cfg.shadowMapSizeTiers.interactiveMobile) : Number(cfg.shadowMapSizeTiers.interactiveDesktop);
          } else {
            ms = isMobile ? Number(cfg.shadowMapSizeTiers.idleMobile) : Number(cfg.shadowMapSizeTiers.idleDesktop);
          }
          ms = Math.max(512, Math.min(8192, ms || (isMobile ? 3072 : 4096)));
        }
      } catch (_eMsTier) {}

      if (shadowLight.isSpotLight) {
        sh.mapSize.set(ms, ms);
        // Keep raster shadow kernel stable (avoid patterning on some GPUs).
        // Softness for Spot is handled by our ground shader gaussian PCF.
        sh.radius = 1.4;
        sh.blurSamples = 18;
        sh.camera.near = Math.max(0.26, Math.min(0.6, (Number(st.radius) || 18) * 0.016));
        sh.camera.far = range;
        sh.camera.updateProjectionMatrix();
      } else if (shadowLight.isDirectionalLight) {
        sh.mapSize.set(ms, ms);
        sh.radius = 1.4;
        sh.blurSamples = 18;
        const cam = sh.camera;
        const he = isMobile ? 26 : 32;
        cam.near = 1.3;
        cam.far = Math.min(125, (Number(st.radius) || 18) * 4.2 + 58);
        cam.left = -he; cam.right = he; cam.top = he; cam.bottom = -he;
        cam.updateProjectionMatrix();
      } else if (shadowLight.isPointLight) {
        // Point/cube shadow: increase resolution to reduce aliasing on model surfaces.
        let pms = isMobile ? 1536 : 2048;
        try {
          const cfg = SOLID_RASTER_SHADOW_PERF;
          if (cfg && cfg.enableDynamicRasterShadowQuality && cfg.enableDynamicShadowMapSize && cfg.shadowMapSizeTiers) {
            const t = (_perfTier === 'interactive') ? 'interactive' : 'idle';
            if (t === 'interactive') {
              pms = isMobile ? Number(cfg.shadowMapSizeTiers.interactivePointMobile) : Number(cfg.shadowMapSizeTiers.interactivePointDesktop);
            } else {
              pms = isMobile ? Number(cfg.shadowMapSizeTiers.idlePointMobile) : Number(cfg.shadowMapSizeTiers.idlePointDesktop);
            }
            pms = Math.max(256, Math.min(4096, pms || (isMobile ? 1536 : 2048)));
          }
        } catch (_ePmsTier) {}
        sh.mapSize.set(pms, pms);
        sh.radius = 2.2;
        sh.blurSamples = 24;
        // Tighter near/far to improve depth precision and reduce banding/slice artifacts.
        sh.camera.near = Math.max(0.15, Math.min(1.2, (Number(st.radius) || 18) * 0.02));
        sh.camera.far = range;
        sh.camera.updateProjectionMatrix();
      }

      const __sizeSoft = _sizeDrivenShadowSoftness(shadowLight, isMobile, st);
      const __contactGuard = !!(__sizeSoft && __sizeSoft.contactGuard);
      if (__sizeSoft) {
        // 投影保底：size 变大时允许更柔，但限制核大小，避免地面投影被“抹没”。
        const radiusCap = shadowLight.isPointLight ? 2.15 : (shadowLight.isDirectionalLight ? 1.78 : 1.72);
        const blurCap = shadowLight.isPointLight ? 18 : 16;
        sh.radius = Math.min(Number(__sizeSoft.radius || sh.radius), radiusCap);
        sh.blurSamples = Math.min(Number(__sizeSoft.blurSamples || sh.blurSamples), blurCap);
      }

      try { if (sceneGroup) sceneGroup.updateMatrixWorld(true); } catch (_eMw) {}
      _fitRasterShadowFrustumForSceneGroup(shadowLight);

      const _nbBoost = isMobile ? 1.9 : (isIosHost ? 1.4 : 1.0);
      if (shadowLight.isSpotLight) {
        sh.bias = (isMobile || isIosHost) ? -0.000012 : -0.000006;
        // Tighten caster/receiver contact to suppress bright seam lines on pedestal/cylinders.
        sh.normalBias = 0.014 * _nbBoost;
        if (isMobile || isIosHost) sh.normalBias = Math.min(sh.normalBias, 0.022);
        if (__contactGuard) sh.normalBias = Math.min(sh.normalBias, isMobile || isIosHost ? 0.019 : 0.0165);
      } else if (shadowLight.isDirectionalLight) {
        // Ortho + large lit planes: low normalBias → shadow acne / horizontal banding on flats & cylinders.
        sh.bias = (isMobile || isIosHost) ? -0.000045 : -0.000022;
        sh.normalBias = 0.020 * _nbBoost;
        if (isMobile || isIosHost) sh.normalBias = Math.min(sh.normalBias, 0.028);
        if (__contactGuard) sh.normalBias = Math.min(sh.normalBias, isMobile || isIosHost ? 0.024 : 0.0215);
      } else if (shadowLight.isPointLight) {
        // Cube shadow：normalBias 过低易摩尔纹，过高易亮缝（peter panning）。锚点球 min(occ) 曾误伤受光侧地面，已撤；此处用折中 bias。
        sh.bias = (isMobile || isIosHost) ? -0.000038 : -0.00003;
        sh.normalBias = (isMobile || isIosHost) ? 0.036 : 0.028;
        if (__contactGuard) sh.normalBias = Math.min(sh.normalBias, isMobile || isIosHost ? 0.031 : 0.0245);
      }

      if (ground) { ground.receiveShadow = true; ground.castShadow = false; }
      if (walls && Array.isArray(walls)) {
        walls.forEach(w => { if (w) { w.receiveShadow = true; w.castShadow = false; } });
      }
      if (sceneGroup && sceneGroup.traverse) {
        sceneGroup.traverse(obj => {
          if (!obj || !obj.isMesh) return;
          if (obj.userData && obj.userData.solidShadowCore) {
            obj.receiveShadow = false;
            obj.castShadow = true;
            return;
          }
          obj.receiveShadow = true;
          obj.castShadow = true;
        });
      }

      // Model terminator softening (direct lighting): must run for both consumer & producer, all light types.
      try { _syncSolidTerminatorForSceneGroup(sceneGroup, st, isMobile, isIosHost); } catch (_eTerm) {}

      // Ground shader patch — keep behavior identical to consumer.
      try {
        if (ground && ground.material && mainLight && mainLight.castShadow) {
          const m = ground.material;
          const canPatch = !!(m.isMeshPhysicalMaterial || m.isMeshStandardMaterial);
          if (!canPatch) return;

          if (!m.userData) m.userData = {};
          if (!m.userData.uSolidShadowAnchorCount) m.userData.uSolidShadowAnchorCount = { value: 0 };
          if (!m.userData.uSolidShadowAnchors) m.userData.uSolidShadowAnchors = { value: Array.from({ length: 8 }, () => new THREE.Vector3(0, 0, 0)) };
          if (!m.userData.uSolidSphereCount) m.userData.uSolidSphereCount = { value: 0 };
          if (!m.userData.uSolidSphereCenters) m.userData.uSolidSphereCenters = { value: Array.from({ length: 8 }, () => new THREE.Vector3()) };
          if (!m.userData.uSolidSphereRadii) m.userData.uSolidSphereRadii = { value: new Float32Array(8) };
          // Sphere-based patch (reference implementation): apply only on ground, gated to dark-side.
          if (!m.userData.uSolidSpherePatchStrength) m.userData.uSolidSpherePatchStrength = { value: 0.95 };
          // Debug toggles (default OFF).
          if (!m.userData.uSolidSphereDebug) m.userData.uSolidSphereDebug = { value: 0.0 };
          if (!m.userData.uSolidDbgForceRed) m.userData.uSolidDbgForceRed = { value: 0.0 };
          m.userData.uSolidSphereDebug.value = _contactPatchDebugAllEnabled() ? 1.0 : 0.0;
          m.userData.uSolidDbgForceRed.value = _contactPatchForceRedEnabled() ? 1.0 : 0.0;
          if (!m.userData.uSolidMainLightType) m.userData.uSolidMainLightType = { value: 0 };
          if (!m.userData.uSolidMainLightPos) m.userData.uSolidMainLightPos = { value: new THREE.Vector3() };
          if (!m.userData.uSolidMainLightDir) m.userData.uSolidMainLightDir = { value: new THREE.Vector3(0, 1, 0) };
          if (!m.userData.uSolidShadowContactPull) m.userData.uSolidShadowContactPull = { value: 0.00065 };
          // Dark-side contact seam leak fix (ground-only; directional/spot use 2D shadow map).
          if (!m.userData.uSolidShadowSeamStrength) m.userData.uSolidShadowSeamStrength = { value: 0.85 };
          if (!m.userData.uSolidShadowSeamPush) m.userData.uSolidShadowSeamPush = { value: 0.00065 };
          if (!m.userData.uSolidShadowSeamRadius) m.userData.uSolidShadowSeamRadius = { value: 1.0 };
          // Scheme A: direction-locked narrow wedge patch (ground-only).
          if (!m.userData.uSolidWedgeEnable) m.userData.uSolidWedgeEnable = { value: 1.0 };
          if (!m.userData.uSolidWedgeStrength) m.userData.uSolidWedgeStrength = { value: 0.65 };
          if (!m.userData.uSolidWedgeWidth) m.userData.uSolidWedgeWidth = { value: 0.18 };
          if (!m.userData.uSolidWedgeLength) m.userData.uSolidWedgeLength = { value: 0.90 };
          if (!m.userData.uSolidWedgeDebug) m.userData.uSolidWedgeDebug = { value: 0.0 };
          if (!m.userData.uSolidShadowSoftRange) m.userData.uSolidShadowSoftRange = { value: new THREE.Vector4(2.8, 28.0, 2.8, 7.8) };
          if (!m.userData.uSolidShadowSoftStrength) m.userData.uSolidShadowSoftStrength = { value: 16.0 };
          if (!m.userData.uSolidShadowSoftExp) m.userData.uSolidShadowSoftExp = { value: 2.25 };
          if (!m.userData.uSolidContactPatchEnable) m.userData.uSolidContactPatchEnable = { value: 1.0 };
          if (!m.userData.uSolidBuiltinSphereCount) m.userData.uSolidBuiltinSphereCount = { value: 0 };
          m.userData.uSolidContactPatchEnable.value = _contactPatchEnabled() ? 1.0 : 0.0;

          // Perf tiering: keep gaussian PCF taps/rotate in sync with current tier.
          // This is safe because these are uniforms (no shader recompile).
          if (!m.userData.uSolidShadowGaussTaps) m.userData.uSolidShadowGaussTaps = { value: 16.0 };
          if (!m.userData.uSolidShadowGaussRotate) m.userData.uSolidShadowGaussRotate = { value: 1.0 };
          _perfApplyUniformQuality(m.userData, isMobile, isIosHost);

          // Avoid recompiling ground shader on every syncShadows() call.
          // Only bump version when the ground patch is not armed yet (or has been cleared).
          if (!m.defines) m.defines = {};
          try {
            if (m.userData._solidGroundShadowPatchRevision !== SOLID_GROUND_SHADOW_PATCH_REVISION) {
              if (m.defines.SOLID_SHADOW_SOFT_GROUND) {
                delete m.defines.SOLID_SHADOW_SOFT_GROUND;
                delete m.defines.SOLID_SHADOW_SOFT_GROUND_VER;
              }
              m.userData._solidGroundShadowPatchRevision = SOLID_GROUND_SHADOW_PATCH_REVISION;
            }
          } catch (_eRev) {}
          const alreadyArmed = !!m.defines.SOLID_SHADOW_SOFT_GROUND;
          if (!alreadyArmed) {
            m.userData._solidShadowSoftVer = (m.userData._solidShadowSoftVer || 0) + 1;
            const _ver = m.userData._solidShadowSoftVer;
            m.customProgramCacheKey = function() { return 'solid_shadow_soft_ground_v' + _ver; };
            m.defines.SOLID_SHADOW_SOFT_GROUND = 1;
            m.defines.SOLID_SHADOW_SOFT_GROUND_VER = _ver;
          }

          // bbox metrics (shared by anchors & softening params)
          let diagXZ = 12.0;
          let heightY = 2.0;
          try {
            if (sceneGroup) {
              const gbox = new THREE.Box3();
              const gsz = new THREE.Vector3();
              gbox.setFromObject(sceneGroup);
              gbox.getSize(gsz);
              diagXZ = Math.max(1.0, Math.sqrt(gsz.x * gsz.x + gsz.z * gsz.z));
              heightY = Math.max(0.25, Number(gsz.y) || 0.25);
            }
          } catch (_eGsz) {}

          // anchors
          try {
            const anchors = m.userData.uSolidShadowAnchors.value;
            const box = new THREE.Box3();
            const c = new THREE.Vector3();
            let nA = 0;
            const groundY = (ground && ground.position) ? ground.position.y : 0;
            // More tolerant: many assets are not perfectly snapped to ground, but we still want anchors.
            const epsY = 0.035;
            if (sceneGroup && sceneGroup.traverse) {
              sceneGroup.traverse((obj) => {
                if (nA >= 8) return;
                if (!obj || !obj.isMesh) return;
                if (!obj.castShadow) return;
                if (obj.userData && obj.userData.solidShadowCore) return;
                try {
                  box.setFromObject(obj);
                  const minY = (box.min && box.min.y != null) ? box.min.y : 1e9;
                  // Accept meshes that are touching or slightly above/below the ground plane.
                  if (Math.abs(minY - groundY) > epsY && (minY > groundY + epsY)) return;
                  box.getCenter(c);
                  anchors[nA].set(c.x, groundY, c.z);
                  nA++;
                } catch (_eB) {}
              });
            }
            m.userData.uSolidShadowAnchorCount.value = nA;
          } catch (_eA) { try { m.userData.uSolidShadowAnchorCount.value = 0; } catch (_eA2) {} }

          try {
            const mob = (isMobile || isIosHost);
            // Point light uses cube shadow sampling; modifying shadowCoord.z can introduce “slice / sheet” artifacts.
            // Keep contact pull effectively disabled for point lights; sphere occlusion still handles the historical bright-spot case.
            if (mainLight && mainLight.isPointLight) m.userData.uSolidShadowContactPull.value = 0.0;
            else if (mainLight && mainLight.isDirectionalLight) m.userData.uSolidShadowContactPull.value = mob ? 0.00085 : 0.00065;
            else {
              // Spot: small pull to prevent dark-side “contact leak”.
              // iOS/iPad tends to show the gap more due to precision/bias, so give it a bit more.
              if (isIosHost) m.userData.uSolidShadowContactPull.value = 0.00044;
              else m.userData.uSolidShadowContactPull.value = mob ? 0.00030 : 0.00022;
            }
          } catch (_ePull) {}

          // seam fix defaults (keep conservative; only ground)
          try {
            const mob = (isMobile || isIosHost);
            // More push on iOS/mobile where precision tends to show gaps.
            // iPad tends to show jagged seam leaks: use slightly larger radius and push.
            m.userData.uSolidShadowSeamPush.value = isIosHost ? 0.00145 : (mob ? 0.00105 : 0.00065);
            m.userData.uSolidShadowSeamStrength.value = mob ? 0.92 : 0.85;
            m.userData.uSolidShadowSeamRadius.value = isIosHost ? 1.35 : 1.0;
          } catch (_eSeamCfg) {}

          // wedge patch defaults (keep OFF by default; we are switching to sphere-based patch)
          try {
            m.userData.uSolidWedgeEnable.value = 0.0;
            m.userData.uSolidWedgeDebug.value = 0.0;
          } catch (_eWdg) {}

          // softening curve parameters (per light type; keep independent)
          try {
            const isPoint = !!(mainLight && mainLight.isPointLight);
            const cfg = isPoint ? RASTER_SHADOW_SOFT_PARAMS.point : RASTER_SHADOW_SOFT_PARAMS.dirSpot;
            const str = (isMobile || isIosHost) ? cfg.strengthMobile : cfg.strengthDesktop;
            m.userData.uSolidShadowSoftStrength.value = str;
            m.userData.uSolidShadowSoftExp.value = cfg.exp;
            // Keep uSolidShadowSoftRange as the “distance ramp” (x=start, y=end). z/w retained for backward compat.
            try {
              // Use model height as baseline (more intuitive than diagXZ for typical 20cm–50cm assets).
              // start/end are in ground-plane distance units.
              const start = heightY * (Number(cfg.startH) || 0.25);
              const end = heightY * (Number(cfg.endH) || 3.0);
              const near0 = diagXZ * 0.02;
              const near1 = diagXZ * 0.10;
              m.userData.uSolidShadowSoftRange.value.set(start, end, near0, near1);
            } catch (_eSR) {}

            if (dbg) {
              try {
                const lt = isPoint ? 'point' : ((mainLight && mainLight.isDirectionalLight) ? 'dir' : 'spot');
                const r = m.userData.uSolidShadowSoftRange && m.userData.uSolidShadowSoftRange.value ? m.userData.uSolidShadowSoftRange.value : null;
                const msg = `[RasterShadowSoft][dbg] lt=${lt} anchors=${m.userData.uSolidShadowAnchorCount.value} heightY=${heightY.toFixed(3)} diagXZ=${diagXZ.toFixed(3)} start=${r ? r.x.toFixed(3) : '?'} end=${r ? r.y.toFixed(3) : '?'} exp=${m.userData.uSolidShadowSoftExp.value} strength=${m.userData.uSolidShadowSoftStrength.value}`;
                try { log(msg); } catch (_eLg) {}
                try { if (typeof window !== 'undefined' && typeof window.hwLog === 'function') window.hwLog(msg); } catch (_eHw) {}
                try { if (typeof console !== 'undefined' && console.log) console.log(msg); } catch (_eCon) {}
              } catch (_eDbg0) {}
            }
          } catch (_eSoftCfg) {}

          // light info
          try {
            const lp = new THREE.Vector3();
            mainLight.getWorldPosition(lp);
            m.userData.uSolidMainLightPos.value.copy(lp);
            if (mainLight && mainLight.isPointLight) m.userData.uSolidMainLightType.value = 2;
            else if (mainLight && mainLight.isSpotLight) m.userData.uSolidMainLightType.value = 1;
            else m.userData.uSolidMainLightType.value = 0;
            const d = new THREE.Vector3(0, 1, 0);
            if (m.userData.uSolidMainLightType.value === 0) {
              if (mainLight && mainLight.target) {
                const t = new THREE.Vector3();
                mainLight.target.getWorldPosition(t);
                d.subVectors(lp, t).normalize();
              }
            }
            m.userData.uSolidMainLightDir.value.copy(d);
          } catch (_eL) {}

          // spheres（与 syncGroundShadowUniforms 相同：builtin 优先，再其它近地投射体；脚印半径见 _computeFootprintSphereOnGround）
          try {
            const groundY = (ground && ground.position) ? ground.position.y : 0;
            const epsY = 0.12; // tolerant: many assets float slightly; keep in sync with syncGroundShadowUniforms()
            _fillGroundSphereUniforms(m.userData, sceneGroup, groundY, epsY);
          } catch (_eSc) {
            try { m.userData.uSolidSphereCount.value = 0; } catch (_e2) {}
            try { m.userData.uSolidBuiltinSphereCount.value = 0; } catch (_e3) {}
          }

          m.onBeforeCompile = (shader) => {
            let fs = shader.fragmentShader;
            let cnt = 0;
            if (cnt <= 0) {
              try {
                const inc = '#include <shadowmap_pars_fragment>';
                if (fs.includes(inc) && THREE.ShaderChunk && THREE.ShaderChunk.shadowmap_pars_fragment) {
                  let chunk = THREE.ShaderChunk.shadowmap_pars_fragment;
                  // GLSL ES requires all declarations before statements.
                  // We rename original shadow functions and append wrappers that scale `shadowRadius`
                  // based on distance-to-model-footprint, then call the originals.
                  chunk = chunk.replace(
                    'float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, float shadowRadius, vec4 shadowCoord ) {',
                    'float getShadow_orig( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, float shadowRadius, vec4 shadowCoord ) {'
                  );
                  chunk = chunk.replace(
                    'float getPointShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {',
                    'float getPointShadow_orig( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {'
                  );

                  // 自定义代码必须插在 shadowmap_pars_fragment 最外层 #ifdef USE_SHADOWMAP 的 **最后一个 #endif 之前**。
                  // 若用 chunk += 接在 #endif 之后，WebGL2/GLSL300 下 texture2DCompare 等会脱离块作用域，片元编译失败 → 地面全黑。
                  const solidShadowSoftAppend =
                    '\n\nfloat solidHash12( vec2 p ) { vec3 p3 = fract( vec3( p.xyx ) * 0.1031 ); p3 += dot( p3, p3.yzx + 33.33 ); return fract( ( p3.x + p3.y ) * p3.z ); }\n' +
                    'mat2 solidRot2( float a ) { float s = sin( a ), c = cos( a ); return mat2( c, -s, s, c ); }\n' +
                    'float solidWedgeMaskAtAnchor( vec2 p, vec2 a, vec2 dirXZ, float halfW, float len ) {\n' +
                    '\tvec2 d = p - a;\n' +
                    '\tfloat u = dot( d, dirXZ );\n' +
                    '\tfloat v = dot( d, vec2( -dirXZ.y, dirXZ.x ) );\n' +
                    '\tfloat side = smoothstep( 0.0, -len, u );\n' +
                    '\tfloat band = 1.0 - smoothstep( halfW, halfW * 1.6, abs( v ) );\n' +
                    '\treturn side * band;\n' +
                    '}\n' +
                    'float solidWedgeRawMask( vec2 dirXZ ) {\n' +
                    '\tfloat halfW = max( 0.001, uSolidWedgeWidth * 0.5 );\n' +
                    '\tfloat len = max( 0.001, uSolidWedgeLength );\n' +
                    '\tfloat m = 0.0;\n' +
                    '\tfor ( int i = 0; i < 8; i++ ) {\n' +
                    '\t\tif ( i >= uSolidShadowAnchorCount ) break;\n' +
                    '\t\tm = max( m, solidWedgeMaskAtAnchor( vSolidShadowGroundPos.xz, uSolidShadowAnchors[i].xz, dirXZ, halfW, len ) );\n' +
                    '\t}\n' +
                    '\treturn m;\n' +
                    '}\n' +
                    'float solidShadowAvgGate2D( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, vec4 shadowCoord ) {\n' +
                    '\tvec3 sc = shadowCoord.xyz / shadowCoord.w;\n' +
                    '\tsc.z += shadowBias;\n' +
                    '\tif ( sc.x < 0.0 || sc.x > 1.0 || sc.y < 0.0 || sc.y > 1.0 || sc.z > 1.0 ) return 0.0;\n' +
                    '\tvec2 texel = vec2( 1.0 ) / shadowMapSize;\n' +
                    '\tfloat c0 = texture2DCompare( shadowMap, sc.xy, sc.z );\n' +
                    '\tfloat c1 = texture2DCompare( shadowMap, sc.xy + vec2( texel.x, 0.0 ), sc.z );\n' +
                    '\tfloat c2 = texture2DCompare( shadowMap, sc.xy - vec2( texel.x, 0.0 ), sc.z );\n' +
                    '\tfloat c3 = texture2DCompare( shadowMap, sc.xy + vec2( 0.0, texel.y ), sc.z );\n' +
                    '\tfloat c4 = texture2DCompare( shadowMap, sc.xy - vec2( 0.0, texel.y ), sc.z );\n' +
                    '\tfloat avg = ( c0 + c1 + c2 + c3 + c4 ) * 0.2;\n' +
                    '\t// 略提高对「偏亮 avg」的敏感度，放大锚球漏光修补在明暗交界与浅影区的权重（减轻残漏）。\n' +
                    '\treturn clamp( ( 0.935 - avg ) / 0.27, 0.0, 1.0 );\n' +
                    '}\n' +
                    'float solidApplyWedgePatch2D( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, vec4 shadowCoord, float sh0 ) {\n' +
                    '\tif ( uSolidContactPatchEnable < 0.5 ) return sh0;\n' +
                    '\tif ( uSolidWedgeEnable < 0.5 ) return sh0;\n' +
                    '\tvec2 dirXZ;\n' +
                    '\tif ( uSolidMainLightType == 0 ) {\n' +
                    '\t\tdirXZ = normalize( vec2( uSolidMainLightDir.x, uSolidMainLightDir.z ) );\n' +
                    '\t} else {\n' +
                    '\t\tvec2 d = normalize( uSolidMainLightPos.xz - vSolidShadowGroundPos.xz );\n' +
                    '\t\tdirXZ = d;\n' +
                    '\t}\n' +
                    '\tif ( dot( dirXZ, dirXZ ) < 1e-6 ) return sh0;\n' +
                    '\tfloat m = solidWedgeRawMask( dirXZ );\n' +
                    '\tif ( m <= 1e-5 ) return sh0;\n' +
                    '\tfloat gate = solidShadowAvgGate2D( shadowMap, shadowMapSize, shadowBias, shadowCoord );\n' +
                    '\tfloat k = clamp( uSolidWedgeStrength, 0.0, 1.0 ) * gate;\n' +
                    '\treturn clamp( sh0 * ( 1.0 - k * m ), 0.0, 1.0 );\n' +
                    '}\n' +
                    'float solidSeamFix2D( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, vec4 shadowCoord, float sh0 ) {\n' +
                    '\tif ( uSolidContactPatchEnable < 0.5 ) return sh0;\n' +
                    '\t// sh0: 1=lit, 0=shadow. Only darken thin bright seams near shadow boundary.\n' +
                    '\tfloat k = clamp( uSolidShadowSeamStrength, 0.0, 1.0 );\n' +
                    '\tif ( k <= 0.0001 ) return sh0;\n' +
                    '\tvec3 sc = shadowCoord.xyz / shadowCoord.w;\n' +
                    '\t// IMPORTANT: decide gate WITHOUT push (avoid lit-side black rim).\n' +
                    '\tvec3 sc0 = sc;\n' +
                    '\tsc0.z += shadowBias;\n' +
                    '\tif ( sc0.x < 0.0 || sc0.x > 1.0 || sc0.y < 0.0 || sc0.y > 1.0 || sc0.z > 1.0 ) return sh0;\n' +
                    '\tvec2 texel = vec2( 1.0 ) / shadowMapSize;\n' +
                    '\tfloat r = clamp( uSolidShadowSeamRadius, 0.5, 2.5 );\n' +
                    '\tvec2 dx = vec2( r, 0.0 ) * texel;\n' +
                    '\tvec2 dy = vec2( 0.0, r ) * texel;\n' +
                    '\tfloat c0 = texture2DCompare( shadowMap, sc0.xy, sc0.z );\n' +
                    '\tfloat c1 = texture2DCompare( shadowMap, sc0.xy + dx, sc0.z );\n' +
                    '\tfloat c2 = texture2DCompare( shadowMap, sc0.xy - dx, sc0.z );\n' +
                    '\tfloat c3 = texture2DCompare( shadowMap, sc0.xy + dy, sc0.z );\n' +
                    '\tfloat c4 = texture2DCompare( shadowMap, sc0.xy - dy, sc0.z );\n' +
                    '\tfloat cMin = min( c0, min( c1, min( c2, min( c3, c4 ) ) ) );\n' +
                    '\tfloat avg = ( c0 + c1 + c2 + c3 + c4 ) * 0.2;\n' +
                    '\tfloat gN = clamp( ( 0.995 - cMin ) / 0.20, 0.0, 1.0 );\n' +
                    '\tfloat gA = clamp( ( 0.93 - avg ) / 0.30, 0.0, 1.0 );\n' +
                    '\tfloat gLegacy = gN * gA;\n' +
                    '\t// Edge gate: only patch on real shadow boundary (max local contrast in 4-neighborhood).\n' +
                    '\tfloat e0 = max( abs( c0 - c1 ), abs( c0 - c2 ) );\n' +
                    '\tfloat e1 = max( abs( c0 - c3 ), abs( c0 - c4 ) );\n' +
                    '\tfloat edge = max( e0, e1 );\n' +
                    '\tfloat gE = clamp( ( edge - 0.012 ) / 0.075, 0.0, 1.0 );\n' +
                    '\tfloat gate = max( gLegacy, gA * gE );\n' +
                    '\t// Only when gate passes, use pushed compare to aggressively close the seam.\n' +
                    '\tvec3 scP = sc0;\n' +
                    '\t// Adaptive push: stronger only where gate is strong (dark-side seam),\n' +
                    '\t// avoids over-darkening near lit-side boundary.\n' +
                    '\tfloat pPush = max( 0.0, uSolidShadowSeamPush ) * ( 0.35 + 0.65 * gate );\n' +
                    '\tscP.z += pPush;\n' +
                    '\t// Use 9-tap min (including diagonals) to fill jagged seam gaps on mobile.\n' +
                    '\tvec2 dd = ( dx + dy ) * 0.70710678;\n' +
                    '\tfloat p0 = texture2DCompare( shadowMap, scP.xy, scP.z );\n' +
                    '\tfloat p1 = texture2DCompare( shadowMap, scP.xy + dx, scP.z );\n' +
                    '\tfloat p2 = texture2DCompare( shadowMap, scP.xy - dx, scP.z );\n' +
                    '\tfloat p3 = texture2DCompare( shadowMap, scP.xy + dy, scP.z );\n' +
                    '\tfloat p4 = texture2DCompare( shadowMap, scP.xy - dy, scP.z );\n' +
                    '\tfloat p5 = texture2DCompare( shadowMap, scP.xy + dd, scP.z );\n' +
                    '\tfloat p6 = texture2DCompare( shadowMap, scP.xy - dd, scP.z );\n' +
                    '\tfloat p7 = texture2DCompare( shadowMap, scP.xy + vec2( dd.x, -dd.y ), scP.z );\n' +
                    '\tfloat p8 = texture2DCompare( shadowMap, scP.xy + vec2( -dd.x, dd.y ), scP.z );\n' +
                    '\tfloat pMin = min( p0, min( p1, min( p2, min( p3, min( p4, min( p5, min( p6, min( p7, p8 ) ) ) ) ) ) ) );\n' +
                    '\t// Contact-band gate (all casters): close thin bright seams near ground contact without affecting far tail.\n' +
                    '\tfloat mC = 0.0;\n' +
                    '\tfor ( int i = 0; i < 8; i++ ) {\n' +
                    '\t\tif ( i >= uSolidSphereCount ) break;\n' +
                    '\t\tfloat rC = max( 0.0001, uSolidSphereRadii[i] );\n' +
                    '\t\tfloat dC = length( vSolidShadowGroundPos.xz - uSolidSphereCenters[i].xz );\n' +
                    '\t\t// For large bases (big radius), widen contact band slightly to cover persistent underside bright seams.\n' +
                    '\t\tfloat isBig = step( 1.25, rC );\n' +
                    '\t\tfloat inMul = mix( 0.92, 0.84, isBig );\n' +
                    '\t\tfloat outMul = mix( 1.18, 1.34, isBig );\n' +
                    '\t\tfloat mm = 1.0 - smoothstep( rC * inMul, rC * outMul, dC );\n' +
                    '\t\tmm = mix( mm, pow( clamp( mm, 0.0, 1.0 ), 0.72 ), isBig );\n' +
                    '\t\tmC = max( mC, mm );\n' +
                    '\t}\n' +
                    '\tmC = clamp( mC, 0.0, 1.0 );\n' +
                    '\t// In contact leaks, avg may look "lit" while cMin still indicates nearby shadow.\n' +
                    '\t// Still require dark-side gate (gA) to avoid lit-side over-trigger (prevents "回潮").\n' +
                    '\tfloat gateC = gN * gA * mC;\n' +
                    '\tfloat gateAll = max( gate, gateC );\n' +
                    '\t// Slightly stronger closure in contact band.\n' +
                    '\tfloat k2 = k * ( 0.85 + 0.75 * mC );\n' +
                    '\treturn min( sh0, mix( sh0, pMin, k2 * gateAll ) );\n' +
                    '}\n' +
                    'float solidShadowSoftCompare( sampler2D shadowMap, vec2 uv, float compareZ, float smoothZ ) {\n' +
                    '\tfloat depth = unpackRGBAToDepth( texture2D( shadowMap, uv ) );\n' +
                    '\t// 1.0=lit, 0.0=shadow. smoothZ is in normalized shadow depth units.\n' +
                    '\treturn 1.0 - smoothstep( 0.0, smoothZ, compareZ - depth );\n' +
                    '}\n' +
                    'vec2 solidPoisson24( int i ) {\n' +
                    '\tif ( i == 0 ) return vec2( -0.326, -0.406 );\n' +
                    '\tif ( i == 1 ) return vec2( -0.840, -0.074 );\n' +
                    '\tif ( i == 2 ) return vec2( -0.696,  0.457 );\n' +
                    '\tif ( i == 3 ) return vec2( -0.203,  0.621 );\n' +
                    '\tif ( i == 4 ) return vec2(  0.962, -0.195 );\n' +
                    '\tif ( i == 5 ) return vec2(  0.473, -0.480 );\n' +
                    '\tif ( i == 6 ) return vec2(  0.519,  0.767 );\n' +
                    '\tif ( i == 7 ) return vec2(  0.185, -0.893 );\n' +
                    '\tif ( i == 8 ) return vec2(  0.507,  0.064 );\n' +
                    '\tif ( i == 9 ) return vec2(  0.896,  0.412 );\n' +
                    '\tif ( i == 10 ) return vec2( -0.322, -0.933 );\n' +
                    '\tif ( i == 11 ) return vec2( -0.792, -0.598 );\n' +
                    '\tif ( i == 12 ) return vec2( -0.043,  0.280 );\n' +
                    '\tif ( i == 13 ) return vec2( -0.155,  0.970 );\n' +
                    '\tif ( i == 14 ) return vec2(  0.252,  0.395 );\n' +
                    '\tif ( i == 15 ) return vec2( -0.444,  0.106 );\n' +
                    '\tif ( i == 16 ) return vec2(  0.727,  0.279 );\n' +
                    '\tif ( i == 17 ) return vec2(  0.395, -0.732 );\n' +
                    '\tif ( i == 18 ) return vec2( -0.600,  0.780 );\n' +
                    '\tif ( i == 19 ) return vec2(  0.043, -0.165 );\n' +
                    '\tif ( i == 20 ) return vec2(  0.143,  0.867 );\n' +
                    '\tif ( i == 21 ) return vec2(  0.675, -0.160 );\n' +
                    '\tif ( i == 22 ) return vec2( -0.325,  0.320 );\n' +
                    '\treturn vec2( -0.069, -0.492 );\n' +
                    '}\n' +
                    'float solidGaussianShadow2D( sampler2D shadowMap, vec2 shadowMapSize, vec4 shadowCoord, float shadowRadius, float shadowBias, float solidPullZ ) {\n' +
                    '\tfloat shadow = 1.0;\n' +
                    '\tvec3 sc = shadowCoord.xyz / shadowCoord.w;\n' +
                    '\t// IMPORTANT: apply bias/pull AFTER perspective divide to avoid “sheet/stripe” artifacts.\n' +
                    '\tvec3 sc0 = sc;\n' +
                    '\tsc0.z += shadowBias;\n' +
                    '\t// Two-worlds solution: only apply contact pull where the fragment is already in shadow.\n' +
                    '\t// This closes dark-side contact leaks without creating a lit-side dark ring.\n' +
                    '\tfloat applyPull = 0.0;\n' +
                    '\tif ( solidPullZ > 0.0 ) {\n' +
                    '\t\t// Use a small neighborhood min: closes tiny gaps in penumbra (esp. iPad precision)\n' +
                    '\t\tfloat c0 = texture2DCompare( shadowMap, sc0.xy, sc0.z );\n' +
                    '\t\tfloat c1 = texture2DCompare( shadowMap, sc0.xy + vec2( 0.5, 0.0 ) / shadowMapSize, sc0.z );\n' +
                    '\t\tfloat c2 = texture2DCompare( shadowMap, sc0.xy + vec2( 0.0, 0.5 ) / shadowMapSize, sc0.z );\n' +
                    '\t\tfloat cMin = min( c0, min( c1, c2 ) );\n' +
                    '\t\t// Continuous gate: strong in shadow/penumbra, fades to 0 when fully lit.\n' +
                    '\t\tapplyPull = clamp( ( 0.985 - cMin ) / 0.22, 0.0, 1.0 );\n' +
                    '\t}\n' +
                    '\tsc = sc0;\n' +
                    '\tsc.z += solidPullZ * applyPull;\n' +
                    '\tbool inFrustum = sc.x >= 0.0 && sc.x <= 1.0 && sc.y >= 0.0 && sc.y <= 1.0;\n' +
                    '\tbool frustumTest = inFrustum && sc.z <= 1.0;\n' +
                    '\tif ( !frustumTest ) return 1.0;\n' +
                    '\tvec2 texel = vec2( 1.0 ) / shadowMapSize;\n' +
                    '\tfloat tapsF = clamp( uSolidShadowGaussTaps, 4.0, 32.0 );\n' +
                    '\tint taps = int( floor( tapsF + 0.5 ) );\n' +
                    '\tfloat ang = ( uSolidShadowGaussRotate > 0.5 ) ? ( 6.2831853 * solidHash12( vSolidShadowGroundPos.xz * 0.071 + sc.xy * shadowMapSize.xy * 0.17 ) ) : 0.0;\n' +
                    '\tmat2 R = solidRot2( ang );\n' +
                    '\tfloat sum = 0.0;\n' +
                    '\tfloat wsum = 0.0;\n' +
                    '\tfloat rMax = 1.85;\n' +
                    '\tfor ( int i = 0; i < 32; i++ ) {\n' +
                    '\t\tif ( i >= taps ) break;\n' +
                    '\t\tfloat fi = float(i);\n' +
                    '\t\tfloat t = (fi + 0.5) / max( 1.0, float(taps) );\n' +
                    '\t\t// Scale samples progressively to avoid “ring edge” in penumbra.\n' +
                    '\t\tvec2 o = ( R * solidPoisson24( i ) ) * sqrt( clamp( t, 0.001, 1.0 ) );\n' +
                    '\t\tvec2 uv = sc.xy + o * texel * shadowRadius;\n' +
                    '\t\tif ( uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0 ) continue;\n' +
                    '\t\tfloat rr = dot( o, o );\n' +
                    '\t\tfloat w = exp( - rr * 2.4 );\n' +
                    '\t\tfloat hardTap = texture2DCompare( shadowMap, uv, sc.z );\n' +
                    '\t\tfloat softTap = solidShadowSoftCompare( shadowMap, uv, sc.z, 0.0018 );\n' +
                    '\t\t// Keep contact from getting brighter (no leak), but smooth the transition.\n' +
                    '\t\tfloat tap = min( hardTap, softTap );\n' +
                    '\t\tsum += w * tap;\n' +
                    '\t\twsum += w;\n' +
                    '\t}\n' +
                    '\tshadow = (wsum > 0.0) ? (sum / wsum) : 1.0;\n' +
                    '\treturn shadow;\n' +
                    '}\n' +
                    '\n' +
                    'float solidSphereOcclusionFaded( vec3 p ) {\n' +
                    '\tif ( uSolidSphereCount <= 0 ) return 1.0;\n' +
                    '\tfloat minEdge = 1e9;\n' +
                    '\tfloat nearR = 2.0;\n' +
                    '\tfor ( int i = 0; i < 8; i++ ) {\n' +
                    '\t\tif ( i >= uSolidSphereCount ) break;\n' +
                    '\t\tfloat r = max( 0.0001, uSolidSphereRadii[i] );\n' +
                    '\t\tfloat d = length( p.xz - uSolidSphereCenters[i].xz );\n' +
                    '\t\tfloat edge = max( 0.0, d - r );\n' +
                    '\t\tif ( edge < minEdge ) { minEdge = edge; nearR = r; }\n' +
                    '\t}\n' +
                    '\t// Narrower footprint than original (avoid lit-side dark rim):\n' +
                    '\tfloat k = 1.0 - smoothstep( nearR * 0.18, nearR * 0.95, minEdge );\n' +
                    '\tk = pow( clamp( k, 0.0, 1.0 ), 1.8 );\n' +
                    '\tfloat occ = solidSphereOcclusion( p );\n' +
                    '\treturn mix( 1.0, occ, k );\n' +
                    '}\n' +
                    'float solidSphereOcclusionBuiltin( vec3 p ) {\n' +
                    '\tif ( uSolidBuiltinSphereCount <= 0 ) return 1.0;\n' +
                    '\tfloat occ = 1.0;\n' +
                    '\tif ( uSolidMainLightType == 0 ) {\n' +
                    '\t\tvec3 rd = normalize( uSolidMainLightDir );\n' +
                    '\t\tfor ( int i = 0; i < 8; i++ ) {\n' +
                    '\t\t\tif ( i >= uSolidBuiltinSphereCount ) break;\n' +
                    '\t\t\tocc = min( occ, solidRaySphereOcc( p, rd, 1e6, uSolidSphereCenters[i], uSolidSphereRadii[i] ) );\n' +
                    '\t\t}\n' +
                    '\t} else {\n' +
                    '\t\tvec3 lp = uSolidMainLightPos;\n' +
                    '\t\tvec3 rd = normalize( lp - p );\n' +
                    '\t\tfloat tMax = length( lp - p );\n' +
                    '\t\tfor ( int i = 0; i < 8; i++ ) {\n' +
                    '\t\t\tif ( i >= uSolidBuiltinSphereCount ) break;\n' +
                    '\t\t\tocc = min( occ, solidRaySphereOcc( p, rd, tMax, uSolidSphereCenters[i], uSolidSphereRadii[i] ) );\n' +
                    '\t\t}\n' +
                    '\t}\n' +
                    '\treturn occ;\n' +
                    '}\n' +
                    'float solidSphereOcclusionFadedBuiltin( vec3 p ) {\n' +
                    '\tif ( uSolidBuiltinSphereCount <= 0 ) return 1.0;\n' +
                    '\tfloat minEdge = 1e9;\n' +
                    '\tfloat nearR = 2.0;\n' +
                    '\tfor ( int i = 0; i < 8; i++ ) {\n' +
                    '\t\tif ( i >= uSolidBuiltinSphereCount ) break;\n' +
                    '\t\tfloat r = max( 0.0001, uSolidSphereRadii[i] );\n' +
                    '\t\tfloat d = length( p.xz - uSolidSphereCenters[i].xz );\n' +
                    '\t\tfloat edge = max( 0.0, d - r );\n' +
                    '\t\tif ( edge < minEdge ) { minEdge = edge; nearR = r; }\n' +
                    '\t}\n' +
                    '\tfloat k = 1.0 - smoothstep( nearR * 0.18, nearR * 0.95, minEdge );\n' +
                    '\tk = pow( clamp( k, 0.0, 1.0 ), 1.8 );\n' +
                    '\tfloat occ = solidSphereOcclusionBuiltin( p );\n' +
                    '\treturn mix( 1.0, occ, k );\n' +
                    '}\n' +
                    'float solidApplyBuiltinSpherePatchGated( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, vec4 shadowCoord, float sh0 ) {\n' +
                    '\tif ( uSolidContactPatchEnable < 0.5 || uSolidBuiltinSphereCount <= 0 ) return sh0;\n' +
                    '\tfloat gate = solidShadowAvgGate2D( shadowMap, shadowMapSize, shadowBias, shadowCoord );\n' +
                    '\tfloat occ = solidSphereOcclusionFadedBuiltin( vSolidShadowGroundPos );\n' +
                    '\tfloat a = clamp( 1.0 - occ, 0.0, 1.0 );\n' +
                    '\tfloat k = min( 1.0, gate * 1.12 );\n' +
                    '\tfloat outSh = sh0;\n' +
                    '\toutSh = clamp( outSh * ( 1.0 - k * a ), 0.0, 1.0 );\n' +
                    '\treturn outSh;\n' +
                    '}\n' +
                    'float solidApplySpherePatchGated( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, vec4 shadowCoord, float sh0 ) {\n' +
                    '\tif ( uSolidContactPatchEnable < 0.5 ) return sh0;\n' +
                    '\t// Gate using shadow neighborhood avg (same idea as seam fix): only patch in dark-side.\n' +
                    '\tfloat gate = solidShadowAvgGate2D( shadowMap, shadowMapSize, shadowBias, shadowCoord );\n' +
                    '\tfloat occ = solidSphereOcclusionFaded( vSolidShadowGroundPos );\n' +
                    '\tfloat a = clamp( 1.0 - occ, 0.0, 1.0 );\n' +
                    '\tfloat k = clamp( uSolidSpherePatchStrength, 0.0, 1.0 ) * gate;\n' +
                    '\tfloat outSh = sh0;\n' +
                    '\t// Only darken.\n' +
                    '\toutSh = clamp( outSh * ( 1.0 - k * a ), 0.0, 1.0 );\n' +
                    '\treturn outSh;\n' +
                    '}\n' +
                    '\n' +
                    'float getShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, float shadowRadius, vec4 shadowCoord ) {\n' +
                    '\tif ( uSolidMainLightType == 0 ) {\n' +
                    '\t\tfloat sh0 = getShadow_orig( shadowMap, shadowMapSize, shadowBias, shadowRadius, shadowCoord );\n' +
                    '\t\tif ( uSolidContactPatchEnable < 0.5 ) return sh0;\n' +
                    '\t\tsh0 = solidSeamFix2D( shadowMap, shadowMapSize, shadowBias, shadowCoord, sh0 );\n' +
                    '\t\tsh0 = solidApplyBuiltinSpherePatchGated( shadowMap, shadowMapSize, shadowBias, shadowCoord, sh0 );\n' +
                    '\t\tsh0 = solidApplySpherePatchGated( shadowMap, shadowMapSize, shadowBias, shadowCoord, sh0 );\n' +
                    '\t\t// 锚球 occ 按 gate 混（4aa85f9）；略加强 gate 权重压残漏；builtin 底再 min(FadedBuiltin) 消球下光斑（历史 b95d2ec）。\n' +
                    '\t\tfloat gate0 = solidShadowAvgGate2D( shadowMap, shadowMapSize, shadowBias, shadowCoord );\n' +
                    '\t\tfloat occ0 = solidSphereOcclusionFaded( vSolidShadowGroundPos );\n' +
                    '\t\tfloat gLeak = min( 1.0, gate0 * 1.28 );\n' +
                    '\t\tsh0 = min( sh0, mix( 1.0, occ0, gLeak ) );\n' +
                    '\t\treturn min( sh0, solidSphereOcclusionFadedBuiltin( vSolidShadowGroundPos ) );\n' +
                    '\t}\n' +
                    '\tfloat dSolidSh = 1e9;\n' +
                    '\tfor ( int i = 0; i < 8; i++ ) {\n' +
                    '\t\tif ( i >= uSolidShadowAnchorCount ) break;\n' +
                    '\t\tdSolidSh = min( dSolidSh, length( vSolidShadowGroundPos.xz - uSolidShadowAnchors[i].xz ) );\n' +
                    '\t}\n' +
                    '\tfloat solidPullMult = 1.0 + 0.35 * exp( - ( dSolidSh * dSolidSh ) / 2.2 );\n' +
                    '\tfloat solidPull = min( uSolidShadowContactPull * solidPullMult, uSolidShadowContactPull + 0.00012 );\n' +
                    '\tfloat tSolidSh = smoothstep( uSolidShadowSoftRange.x, uSolidShadowSoftRange.y, dSolidSh );\n' +
                    '\ttSolidSh = pow( clamp( tSolidSh, 0.0, 1.0 ), max( 0.75, uSolidShadowSoftExp ) );\n' +
                    '\tshadowRadius *= ( 1.0 + uSolidShadowSoftStrength * tSolidSh );\n' +
                    '\tfloat solidPullUse = ( uSolidContactPatchEnable < 0.5 ) ? 0.0 : solidPull;\n' +
                    '\tfloat shadowOut = solidGaussianShadow2D( shadowMap, shadowMapSize, shadowCoord, shadowRadius, shadowBias, solidPullUse );\n' +
                    '\tif ( uSolidContactPatchEnable < 0.5 ) return shadowOut;\n' +
                    '\t// 聚光/Rect 光栅降级：锚球 occ 乘 gateOcc，暗侧补压漏光，受光侧不误伤（同 4aa85f9）。\n' +
                    '\tfloat occ = solidSphereOcclusion( vSolidShadowGroundPos );\n' +
                    '\tfloat kOcc = pow( 1.0 - tSolidSh, 1.8 );\n' +
                    '\tfloat gateOcc = solidShadowAvgGate2D( shadowMap, shadowMapSize, shadowBias, shadowCoord );\n' +
                    '\tshadowOut = min( shadowOut, mix( 1.0, occ, min( 1.0, kOcc * gateOcc * 1.28 ) ) );\n' +
                    '\t// 内置球心部亮斑：径向圆盘与解析 ob 融合 + 贴图 gate（曾出现扇形硬边；回退供对比是否仍有光斑）。\n' +
                    '\tif ( uSolidBuiltinSphereCount > 0 ) {\n' +
                    '\t\tfloat diskMax = 0.0;\n' +
                    '\t\tfor ( int bi = 0; bi < 8; bi++ ) {\n' +
                    '\t\t\tif ( bi >= uSolidBuiltinSphereCount ) break;\n' +
                    '\t\t\tfloat rB = max( 0.0001, uSolidSphereRadii[bi] );\n' +
                    '\t\t\tfloat dB = length( vSolidShadowGroundPos.xz - uSolidSphereCenters[bi].xz );\n' +
                    '\t\t\tfloat disk = 1.0 - smoothstep( rB * 0.905, rB * 0.992, dB );\n' +
                    '\t\t\tdisk *= disk * ( 3.0 - 2.0 * disk );\n' +
                    '\t\t\tdiskMax = max( diskMax, disk );\n' +
                    '\t\t}\n' +
                    '\t\tif ( diskMax > 1e-4 ) {\n' +
                    '\t\t\tfloat gateMap = smoothstep( 0.46, 0.91, 1.0 - shadowOut );\n' +
                    '\t\t\tfloat ob = solidSphereOcclusionBuiltin( vSolidShadowGroundPos );\n' +
                    '\t\t\tfloat obCirc = 0.0;\n' +
                    '\t\t\tfor ( int bj = 0; bj < 8; bj++ ) {\n' +
                    '\t\t\t\tif ( bj >= uSolidBuiltinSphereCount ) break;\n' +
                    '\t\t\t\tfloat r2 = max( 0.0001, uSolidSphereRadii[bj] );\n' +
                    '\t\t\t\tfloat d2 = length( vSolidShadowGroundPos.xz - uSolidSphereCenters[bj].xz );\n' +
                    '\t\t\t\tobCirc = max( obCirc, 1.0 - smoothstep( r2 * 0.88, r2 * 0.975, d2 ) );\n' +
                    '\t\t\t}\n' +
                    '\t\t\tfloat obFused = mix( ob, obCirc, 0.78 );\n' +
                    '\t\t\tfloat w = diskMax * diskMax * gateMap;\n' +
                    '\t\t\tfloat target = shadowOut * mix( 1.0, max( obFused, 0.22 ), 0.88 );\n' +
                    '\t\t\tshadowOut = mix( shadowOut, target, w );\n' +
                    '\t\t}\n' +
                    '\t}\n' +
                    '\treturn shadowOut;\n' +
                    '}\n' +
                    '\n' +
                    'float getPointShadow( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, float shadowRadius, vec4 shadowCoord, float shadowCameraNear, float shadowCameraFar ) {\n' +
                    '\tfloat sh0 = getPointShadow_orig( shadowMap, shadowMapSize, shadowBias, shadowRadius, shadowCoord, shadowCameraNear, shadowCameraFar );\n' +
                    '\tif ( uSolidContactPatchEnable < 0.5 ) return sh0;\n' +
                    '\t// 立方体阴影：锚球混光 + builtin 底 min（与平行光一致，压 builtin 球下光斑）。\n' +
                    '\tfloat g0 = clamp( ( 0.99 - sh0 ) / 0.26, 0.0, 1.0 );\n' +
                    '\tfloat sh1 = min( sh0, mix( 1.0, solidSphereOcclusionFaded( vSolidShadowGroundPos ), g0 ) );\n' +
                    '\treturn min( sh1, solidSphereOcclusionFadedBuiltin( vSolidShadowGroundPos ) );\n' +
                    '}\n';

                  const endifIdx = chunk.lastIndexOf('#endif');
                  if (endifIdx < 0) {
                    log('[RasterShadowSoft] shadow chunk missing #endif — ground soft shadow skipped');
                    return;
                  }
                  chunk = chunk.slice(0, endifIdx) + solidShadowSoftAppend + '\n' + chunk.slice(endifIdx);

                  fs = fs.replace(inc, chunk);
                  cnt = 1;
                }
              } catch (_eChunk) {}
              if (cnt <= 0) {
                log('[RasterShadowSoft] shadow chunk replace MISS — ground soft shadow skipped');
                return;
              }
            }

            shader.uniforms.uSolidShadowAnchorCount = m.userData.uSolidShadowAnchorCount;
            shader.uniforms.uSolidShadowAnchors = m.userData.uSolidShadowAnchors;
            shader.uniforms.uSolidShadowContactPull = m.userData.uSolidShadowContactPull;
            shader.uniforms.uSolidShadowSeamStrength = m.userData.uSolidShadowSeamStrength;
            shader.uniforms.uSolidShadowSeamPush = m.userData.uSolidShadowSeamPush;
            shader.uniforms.uSolidShadowSeamRadius = m.userData.uSolidShadowSeamRadius;
            shader.uniforms.uSolidWedgeEnable = m.userData.uSolidWedgeEnable;
            shader.uniforms.uSolidWedgeStrength = m.userData.uSolidWedgeStrength;
            shader.uniforms.uSolidWedgeWidth = m.userData.uSolidWedgeWidth;
            shader.uniforms.uSolidWedgeLength = m.userData.uSolidWedgeLength;
            shader.uniforms.uSolidWedgeDebug = m.userData.uSolidWedgeDebug;
            shader.uniforms.uSolidShadowSoftRange = m.userData.uSolidShadowSoftRange;
            shader.uniforms.uSolidShadowSoftStrength = m.userData.uSolidShadowSoftStrength;
            shader.uniforms.uSolidShadowSoftExp = m.userData.uSolidShadowSoftExp;
            shader.uniforms.uSolidContactPatchEnable = m.userData.uSolidContactPatchEnable;
            shader.uniforms.uSolidBuiltinSphereCount = m.userData.uSolidBuiltinSphereCount;
            shader.uniforms.uSolidSphereCount = m.userData.uSolidSphereCount;
            shader.uniforms.uSolidSphereCenters = m.userData.uSolidSphereCenters;
            shader.uniforms.uSolidSphereRadii = m.userData.uSolidSphereRadii;
            shader.uniforms.uSolidSpherePatchStrength = m.userData.uSolidSpherePatchStrength;
            shader.uniforms.uSolidSphereDebug = m.userData.uSolidSphereDebug;
            shader.uniforms.uSolidDbgForceRed = m.userData.uSolidDbgForceRed;
            shader.uniforms.uSolidMainLightType = m.userData.uSolidMainLightType;
            shader.uniforms.uSolidMainLightPos = m.userData.uSolidMainLightPos;
            shader.uniforms.uSolidMainLightDir = m.userData.uSolidMainLightDir;

            shader.fragmentShader =
              'varying vec3 vSolidShadowGroundPos;\n' +
              'uniform int uSolidShadowAnchorCount;\n' +
              'uniform vec3 uSolidShadowAnchors[8];\n' +
              'uniform float uSolidShadowContactPull;\n' +
              'uniform float uSolidShadowSeamStrength;\n' +
              'uniform float uSolidShadowSeamPush;\n' +
              'uniform float uSolidShadowSeamRadius;\n' +
              'uniform float uSolidWedgeEnable;\n' +
              'uniform float uSolidWedgeStrength;\n' +
              'uniform float uSolidWedgeWidth;\n' +
              'uniform float uSolidWedgeLength;\n' +
              'uniform float uSolidWedgeDebug;\n' +
              'uniform vec4 uSolidShadowSoftRange;\n' +
              'uniform float uSolidShadowSoftStrength;\n' +
              'uniform float uSolidShadowSoftExp;\n' +
              'uniform float uSolidContactPatchEnable;\n' +
              'uniform int uSolidBuiltinSphereCount;\n' +
              'uniform float uSolidShadowGaussTaps;\n' +
              'uniform float uSolidShadowGaussRotate;\n' +
              'uniform int uSolidSphereCount;\n' +
              'uniform vec3 uSolidSphereCenters[8];\n' +
              'uniform float uSolidSphereRadii[8];\n' +
              'uniform float uSolidSpherePatchStrength;\n' +
              'uniform float uSolidSphereDebug;\n' +
              'uniform float uSolidDbgForceRed;\n' +
              'uniform int uSolidMainLightType;\n' +
              'uniform vec3 uSolidMainLightPos;\n' +
              'uniform vec3 uSolidMainLightDir;\n' +
              'float solidRaySphereOcc( vec3 ro, vec3 rd, float tMax, vec3 c, float r ) {\n' +
              '  vec3 oc = ro - c;\n' +
              '  float b = dot( oc, rd );\n' +
              '  float cc = dot( oc, oc ) - r * r;\n' +
              '  float h = b * b - cc;\n' +
              '  if ( h < 0.0 ) return 1.0;\n' +
              '  float s = sqrt( h );\n' +
              '  float t = -b - s;\n' +
              '  if ( t < 0.0 ) t = -b + s;\n' +
              '  return ( t > -1e-4 && t < tMax ) ? 0.0 : 1.0;\n' +
              '}\n' +
              'float solidSphereOcclusion( vec3 p ) {\n' +
              '  if ( uSolidSphereCount <= 0 ) return 1.0;\n' +
              '  float occ = 1.0;\n' +
              '  if ( uSolidMainLightType == 0 ) {\n' +
              '    vec3 rd = normalize( uSolidMainLightDir );\n' +
              '    for ( int i = 0; i < 8; i++ ) {\n' +
              '      if ( i >= uSolidSphereCount ) break;\n' +
              '      occ = min( occ, solidRaySphereOcc( p, rd, 1e6, uSolidSphereCenters[i], uSolidSphereRadii[i] ) );\n' +
              '    }\n' +
              '  } else {\n' +
              '    vec3 lp = uSolidMainLightPos;\n' +
              '    vec3 rd = normalize( lp - p );\n' +
              '    float tMax = length( lp - p );\n' +
              '    for ( int i = 0; i < 8; i++ ) {\n' +
              '      if ( i >= uSolidSphereCount ) break;\n' +
              '      occ = min( occ, solidRaySphereOcc( p, rd, tMax, uSolidSphereCenters[i], uSolidSphereRadii[i] ) );\n' +
              '    }\n' +
              '  }\n' +
              '  return occ;\n' +
              '}\n' +
              'float solidContactDebugMask( vec3 p ) {\n' +
              '  if ( uSolidSphereCount <= 0 ) return 0.0;\n' +
              '  float m = 0.0;\n' +
              '  for ( int i = 0; i < 8; i++ ) {\n' +
              '    if ( i >= uSolidSphereCount ) break;\n' +
              '    float r = max( 0.0001, uSolidSphereRadii[i] );\n' +
              '    float d = length( p.xz - uSolidSphereCenters[i].xz );\n' +
              '    // Exaggerated wide band for visual verification.\n' +
              '    float mm = 1.0 - smoothstep( r * 0.65, r * 1.75, d );\n' +
              '    m = max( m, mm );\n' +
              '  }\n' +
              '  return clamp( m, 0.0, 1.0 );\n' +
              '}\n' +
              fs;

            // Debug/Experiment: tint ground red (visual confirmation).
            // IMPORTANT: inject only once; #include tag is removed after first replace.
            try {
              if (shader.fragmentShader) {
                const dbgCode =
                  '\nif ( uSolidDbgForceRed > 0.5 ) {\n' +
                  '  gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );\n' +
                  '}\n' +
                  '\n{\n' +
                  '  float aDbg = 0.0;\n' +
                  '  if ( uSolidSphereDebug > 0.5 ) {\n' +
                  '    aDbg = max( aDbg, solidContactDebugMask( vSolidShadowGroundPos ) );\n' +
                  '  }\n' +
                  '  if ( uSolidSphereDebug > 0.5 ) {\n' +
                  '    if ( aDbg > 1e-4 ) gl_FragColor = vec4( 1.0, 0.0, 0.0, 1.0 );\n' +
                  '    else gl_FragColor = vec4( 0.0, 0.35, 1.0, 1.0 );\n' +
                  '  }\n' +
                  '}\n';

                let injected = false;
                const tags = [
                  '#include <output_fragment>',
                  '#include <opaque_fragment>',
                  '#include <dithering_fragment>',
                ];
                for (let ti = 0; ti < tags.length; ti++) {
                  const tag = tags[ti];
                  if (shader.fragmentShader.includes(tag)) {
                    shader.fragmentShader = shader.fragmentShader.replace(tag, tag + dbgCode);
                    injected = true;
                    break;
                  }
                }
                if (!injected) {
                  // Last-resort: append at end for visibility diagnosis.
                  shader.fragmentShader += dbgCode;
                }
              }
            } catch (_eDbg) {}

            // gaussian PCF params (constants wrapped as uniforms for easy tuning)
            try {
              const mob = (isMobile || isIosHost);
              const g = mob ? RASTER_SHADOW_GAUSS_PARAMS.mobile : RASTER_SHADOW_GAUSS_PARAMS.desktop;
              if (!m.userData.uSolidShadowGaussTaps) m.userData.uSolidShadowGaussTaps = { value: 16.0 };
              if (!m.userData.uSolidShadowGaussRotate) m.userData.uSolidShadowGaussRotate = { value: 1.0 };
              m.userData.uSolidShadowGaussTaps.value = g.taps;
              m.userData.uSolidShadowGaussRotate.value = g.rotate ? 1.0 : 0.0;
              shader.uniforms.uSolidShadowGaussTaps = m.userData.uSolidShadowGaussTaps;
              shader.uniforms.uSolidShadowGaussRotate = m.userData.uSolidShadowGaussRotate;
            } catch (_eGpcf) {}

            shader.vertexShader = 'varying vec3 vSolidShadowGroundPos;\n' + shader.vertexShader;
            // worldpos_vertex 在 USE_SHADOWMAP 等均未定义时会展开为空，此时无 worldPosition；与 begin_vertex 分支统一用 modelMatrix。
            const vSolidGroundAssign = '\n\tvSolidShadowGroundPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;';
            if (shader.vertexShader.includes('#include <worldpos_vertex>')) {
              shader.vertexShader = shader.vertexShader.replace(
                '#include <worldpos_vertex>',
                '#include <worldpos_vertex>' + vSolidGroundAssign
              );
            } else if (shader.vertexShader.includes('#include <begin_vertex>')) {
              shader.vertexShader = shader.vertexShader.replace(
                '#include <begin_vertex>',
                '#include <begin_vertex>' + vSolidGroundAssign
              );
            }
          };

          try {
            const v = (m && m.userData && m.userData._solidShadowSoftVer) ? m.userData._solidShadowSoftVer : _ver;
            log('[RasterShadowSoft] ground patch armed v' + v);
          } catch (_eDbgV) {
            log('[RasterShadowSoft] ground patch armed');
          }
          m.needsUpdate = true;
        }
      } catch (_eGs) {}

      // ---------- Receiver soft shadow (walls) ----------
      try {
        const walls = getWalls();
        const ground = getGround();
        const mainLight = getShadowLight();
        const sharedUd = ground && ground.material && ground.material.userData ? ground.material.userData : null;
        const okShared = !!(sharedUd && sharedUd.uSolidShadowAnchorCount && sharedUd.uSolidShadowAnchors && sharedUd.uSolidShadowSoftRange);
        const shouldSoftWalls = _receiverSoftShadowWallsEnabled() && okShared && walls && Array.isArray(walls) && !(mainLight && mainLight.isDirectionalLight);
        if (walls && Array.isArray(walls) && !shouldSoftWalls) {
          // Ensure we revert to legacy shaders when disabling/when switching to directional.
          for (let wi = 0; wi < walls.length; wi++) {
            const w = walls[wi];
            if (!w || !w.isMesh || !w.material) continue;
            const mats = Array.isArray(w.material) ? w.material : [w.material];
            for (let mi = 0; mi < mats.length; mi++) _clearReceiverSoftShadowPatch(mats[mi]);
          }
        }
        // Directional light: keep legacy projection behavior (no receiver softening).
        if (shouldSoftWalls) {
          const mob = (isMobile || isIosHost);
          const g = mob ? RASTER_SHADOW_GAUSS_PARAMS.mobile : RASTER_SHADOW_GAUSS_PARAMS.desktop;
          for (let wi = 0; wi < walls.length; wi++) {
            const w = walls[wi];
            if (!w || !w.isMesh || !w.material) continue;
            const mats = Array.isArray(w.material) ? w.material : [w.material];
            for (let mi = 0; mi < mats.length; mi++) {
              const mat = mats[mi];
              if (!mat) continue;
              _installReceiverSoftShadowPatch(mat, sharedUd, { kindTag: 1, gauss: g });
            }
          }
        }
      } catch (_eWallSoft) {}

      // ---------- Receiver soft shadow (sceneGroup models) ----------
      try {
        const mainLight = getShadowLight();
        const ground = getGround();
        const sharedUd = ground && ground.material && ground.material.userData ? ground.material.userData : null;
        const okShared = !!(sharedUd && sharedUd.uSolidShadowAnchorCount && sharedUd.uSolidShadowAnchors && sharedUd.uSolidShadowSoftRange);
        const sg = getSceneGroup();
        const shouldSoftModels = _receiverSoftShadowModelsEnabled() && okShared && sg && sg.traverse && !(mainLight && mainLight.isDirectionalLight);
        if (sg && sg.traverse && !shouldSoftModels) {
          // Ensure we revert to legacy shaders when disabling/when switching to directional.
          sg.traverse((obj) => {
            try {
              if (!obj || !obj.isMesh) return;
              const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
              for (let mi = 0; mi < mats.length; mi++) _clearReceiverSoftShadowPatch(mats[mi]);
            } catch (_eC) {}
          });
        }
        if (shouldSoftModels) {
          const mob = (isMobile || isIosHost);
          const g = mob ? RASTER_SHADOW_GAUSS_PARAMS.mobile : RASTER_SHADOW_GAUSS_PARAMS.desktop;
          sg.traverse((obj) => {
            try {
              if (!obj || !obj.isMesh) return;
              if (!obj.receiveShadow) return;
              const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
              for (let mi = 0; mi < mats.length; mi++) {
                const mat = mats[mi];
                if (!mat) continue;
                _installReceiverSoftShadowPatch(mat, sharedUd, { kindTag: 2, gauss: g });
              }
            } catch (_eM) {}
          });
        }
      } catch (_eModelSoft) {}
    } catch (_e) {}
  }

  // ---------- Preview env probes（光栅预览环境采样；术语勿与 three.LightProbe 混淆）----------
  // 1) 多探针 PMREM：3 个 CubeCamera 位姿 _computeProbeLayout → 每点拍 cubemap → PMREMGenerator.fromCubemap；
  //    scene.environment 用探针 0；各网格按包围球中心 _pickNearestProbeIndex 指到最近 pmrem 作 material.envMap（IBL 高光/反射为主）。
  // 2) 空间 SH 漫反射（可选）：SOLID_RASTER_IRRADIANCE_PROBES.enabled 时，每探针从同一 cubemap readPixels 积 L2 系数，
  //    片段着色器按世界坐标混合三套系数并写入 irradiance，并缩放 iblIrradiance 减轻与 PMREM 漫反射重复；非场景里挂多盏 LightProbe。
  // 3) 屏幕空间 AO 由宿主 SolidRasterPreviewComposer（GTAO）处理，与 SH 能量在 PaintingConfig 中 `diffuseMixScaleWhenScreenAo` 协调。
  let pmremGen = null;
  let cubeRT = null;
  let cubeCam = null;
  let basePmremRT = null;
  let pmremRTs = [null, null, null];
  let probePositions = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  let envProbeTimer = 0;
  let envProbeMaxTimer = 0;
  let lastRunAt = 0;
  const minIntervalMs = typeof opts.envMinIntervalMs === 'number' ? opts.envMinIntervalMs : 2600;
  const debounceMs = typeof opts.envDebounceMs === 'number' ? opts.envDebounceMs : 220;
  const cubeSize = typeof opts.envCubeSize === 'number' ? opts.envCubeSize : (getIsMobile() ? 48 : 64);
  const probeCount = 3;
  /** 上一轮 SH 系数是否已填满。 */
  let _solidShLastValid = false;
  const _SOLID_SH_PATCH_VER = 6;
  const _solidShPatchedMaterials = new Set();
  /** 每探针 9×vec3 线性系数（与 Three LightProbe / shGetIrradianceAt 一致），按行主序 r,g,b 交错存于 27 长度数组。 */
  const _probeShFlat = [new Float32Array(27), new Float32Array(27), new Float32Array(27)];
  const _shBasisScratch = new Array(9).fill(0);
  const _shCoord = new THREE.Vector3();
  const _shDir = new THREE.Vector3();
  const _shColor = new THREE.Color();
  let _shReadbackU8 = null;
  let _shReadbackU16 = null;
  let _shReadbackSize = 0;
  let _lastCubeRtSize = 0;
  const _tmpSolidGroundWorld = new THREE.Vector3();

  const _shAcc9 = (function () {
    const a = [];
    for (let i = 0; i < 9; i++) a.push(new THREE.Vector3());
    return a;
  })();

  function _irrCfg() {
    return SOLID_RASTER_IRRADIANCE_PROBES || {};
  }

  function _solidShIrrEnabled() {
    try {
      const drv = getSolidRasterPreviewLightingDerived();
      return !!previewEnabled && !!drv.shActive;
    } catch (_e) {
      return false;
    }
  }

  function _solidConvertShPixelToLinear(color, colorSpace) {
    try {
      if (colorSpace === THREE.SRGBColorSpace) color.convertSRGBToLinear();
    } catch (_e) {}
    return color;
  }

  /**
   * 从 CubeRenderTarget 读回像素并投影到 L2 球谐（与 three/examples LightProbeGenerator.fromCubeRenderTarget 同序）。
   * 结果写入 out27：9 个 vec3 按 band 顺序展开为 [r0,g0,b0, …, r8,g8,b8]。
   */
  function _computeShFromCubeRenderTarget(renderer, cubeRT, out27) {
    if (!renderer || !cubeRT || !cubeRT.isWebGLCubeRenderTarget || !out27) return false;
    const SH3 = THREE.SphericalHarmonics3;
    if (!SH3 || typeof SH3.getBasisAt !== 'function') return false;
    const HalfFloatType = THREE.HalfFloatType;
    const DataUtils = THREE.DataUtils;
    const imageWidth = cubeRT.width;
    if (!imageWidth || imageWidth < 4) return false;
    const dataType = cubeRT.texture.type;
    const pixelCount = imageWidth * imageWidth * 4;
    let totalWeight = 0;
    for (let j = 0; j < 9; j++) _shAcc9[j].set(0, 0, 0);
    let shStride = 1;
    try {
      const irrS = _irrCfg();
      shStride = Math.max(1, Math.floor(Number(irrS.shPixelStride) || 1));
    } catch (_eSt) {
      shStride = 1;
    }
    const pixelSize = 2 / imageWidth;
    for (let faceIndex = 0; faceIndex < 6; faceIndex++) {
      let data;
      if (dataType === HalfFloatType) {
        if (!_shReadbackU16 || _shReadbackSize !== imageWidth) _shReadbackU16 = new Uint16Array(pixelCount);
        data = _shReadbackU16;
      } else {
        if (!_shReadbackU8 || _shReadbackSize !== imageWidth) _shReadbackU8 = new Uint8Array(pixelCount);
        data = _shReadbackU8;
      }
      _shReadbackSize = imageWidth;
      try {
        renderer.readRenderTargetPixels(cubeRT, 0, 0, imageWidth, imageWidth, data, faceIndex);
      } catch (_eRead) {
        return false;
      }
      for (let py = 0; py < imageWidth; py += shStride) {
        for (let px = 0; px < imageWidth; px += shStride) {
          const pixelIndex = py * imageWidth + px;
          const i = pixelIndex * 4;
        let r; let g; let b;
        if (dataType === HalfFloatType) {
          if (!DataUtils || typeof DataUtils.fromHalfFloat !== 'function') return false;
          r = DataUtils.fromHalfFloat(data[i]);
          g = DataUtils.fromHalfFloat(data[i + 1]);
          b = DataUtils.fromHalfFloat(data[i + 2]);
        } else {
          r = data[i] / 255;
          g = data[i + 1] / 255;
          b = data[i + 2] / 255;
        }
        _shColor.setRGB(r, g, b);
        _solidConvertShPixelToLinear(_shColor, cubeRT.texture.colorSpace);
        const col = -1 + (px + 0.5) * pixelSize;
        const row = 1 - (py + 0.5) * pixelSize;
        switch (faceIndex) {
          case 0: _shCoord.set(1, row, -col); break;
          case 1: _shCoord.set(-1, row, col); break;
          case 2: _shCoord.set(col, 1, -row); break;
          case 3: _shCoord.set(col, -1, row); break;
          case 4: _shCoord.set(col, row, 1); break;
          case 5: _shCoord.set(-col, row, -1); break;
          default: _shCoord.set(0, 1, 0);
        }
        const lengthSq = _shCoord.lengthSq();
        if (lengthSq < 1e-10) continue;
        const weight = 4 / (Math.sqrt(lengthSq) * lengthSq);
        totalWeight += weight;
        _shDir.copy(_shCoord).normalize();
        SH3.getBasisAt(_shDir, _shBasisScratch);
        for (let j = 0; j < 9; j++) {
          const bj = _shBasisScratch[j];
          _shAcc9[j].x += bj * _shColor.r * weight;
          _shAcc9[j].y += bj * _shColor.g * weight;
          _shAcc9[j].z += bj * _shColor.b * weight;
        }
        }
      }
    }
    if (totalWeight <= 1e-10) return false;
    const norm = (4 * Math.PI) / totalWeight;
    for (let j = 0; j < 9; j++) {
      out27[j * 3] = _shAcc9[j].x * norm;
      out27[j * 3 + 1] = _shAcc9[j].y * norm;
      out27[j * 3 + 2] = _shAcc9[j].z * norm;
    }
    return true;
  }

  function _solidShCoeffUniformName(probeIndex, coeffIndex) {
    return 'uSolidSH' + probeIndex + 'c' + coeffIndex;
  }

  function _solidShEnsureUniforms(material) {
    try {
      const legacy = material.userData._solidShUni;
      if (legacy && !legacy[_solidShCoeffUniformName(0, 0)]) delete material.userData._solidShUni;
    } catch (_eL) {}
    if (!material.userData._solidShUni) {
      const u = {};
      u.uSolidProbePos0 = { value: new THREE.Vector3() };
      u.uSolidProbePos1 = { value: new THREE.Vector3() };
      u.uSolidProbePos2 = { value: new THREE.Vector3() };
      for (let pi = 0; pi < probeCount; pi++) {
        for (let j = 0; j < 9; j++) {
          u[_solidShCoeffUniformName(pi, j)] = { value: new THREE.Vector3() };
        }
      }
      u.uSolidShDiffuseMix = { value: 0 };
      u.uSolidEnvIblDiffuseScale = { value: 1 };
      u.uSolidShWeightPow = { value: 2.2 };
      u.uSolidShMinWt = { value: 0.08 };
      u.uSolidGroundY = { value: 0 };
      u.uSolidGroundOcclH = { value: 0.15 };
      u.uSolidGroundOcclCavityPow = { value: 2.6 };
      u.uSolidGroundNorBindPow = { value: 0.35 };
      u.uSolidGroundOcclNExp = { value: 2.0 };
      u.uSolidGroundOcclMin = { value: 0.08 };
      u.uSolidGroundOcclAmt = { value: 0 };
      u.uSolidGroundIblMin = { value: 0.4 };
      u.uSolidGroundIblOccAmt = { value: 0 };
      u.uSolidGroundCrevicePow = { value: 2.5 };
      u.uSolidGroundCreviceShMul = { value: 0.05 };
      u.uSolidGroundCreviceIblMul = { value: 0.2 };
      u.uSolidGroundCreviceAmt = { value: 0 };
      material.userData._solidShUni = u;
    }
    const u2 = material.userData._solidShUni;
    if (u2 && !u2.uSolidGroundY) {
      u2.uSolidGroundY = { value: 0 };
      u2.uSolidGroundOcclH = { value: 0.15 };
      u2.uSolidGroundOcclCavityPow = { value: 2.6 };
      u2.uSolidGroundNorBindPow = { value: 0.35 };
      u2.uSolidGroundOcclNExp = { value: 2.0 };
      u2.uSolidGroundOcclMin = { value: 0.08 };
      u2.uSolidGroundOcclAmt = { value: 0 };
      u2.uSolidGroundIblMin = { value: 0.4 };
      u2.uSolidGroundIblOccAmt = { value: 0 };
      u2.uSolidGroundCrevicePow = { value: 2.5 };
      u2.uSolidGroundCreviceShMul = { value: 0.05 };
      u2.uSolidGroundCreviceIblMul = { value: 0.2 };
      u2.uSolidGroundCreviceAmt = { value: 0 };
    }
    if (u2 && !u2.uSolidGroundOcclCavityPow) u2.uSolidGroundOcclCavityPow = { value: 2.6 };
    if (u2 && !u2.uSolidGroundNorBindPow) u2.uSolidGroundNorBindPow = { value: 0.35 };
    if (u2 && !u2.uSolidGroundCrevicePow) u2.uSolidGroundCrevicePow = { value: 2.5 };
    if (u2 && !u2.uSolidGroundCreviceShMul) u2.uSolidGroundCreviceShMul = { value: 0.05 };
    if (u2 && !u2.uSolidGroundCreviceIblMul) u2.uSolidGroundCreviceIblMul = { value: 0.2 };
    if (u2 && !u2.uSolidGroundCreviceAmt) u2.uSolidGroundCreviceAmt = { value: 0 };
    return material.userData._solidShUni;
  }

  function _solidShPushUniformsFromState() {
    const irr = _irrCfg();
    // Anti-regression: SH/AO 链路只做间接光遮蔽，不读取 lightSize，不承担主光交界线宽化。
    let mix = _solidShIrrEnabled() && _solidShLastValid ? Math.max(0, Number(irr.diffuseMix) || 0) : 0;
    try {
      const drv = getSolidRasterPreviewLightingDerived();
      mix *= Math.max(0, Math.min(1, Number(drv.diffuseMixMultiplier) || 1));
    } catch (_eDm) {}
    try {
      const aoCfg = SOLID_RASTER_PREVIEW_AO || {};
      if (aoCfg.enabled) {
        const shAoMul = Math.max(0.25, Math.min(1, Number(irr.diffuseMixScaleWhenScreenAo ?? 1)));
        mix *= shAoMul;
      }
    } catch (_eAo) {}
    const envScale = _solidShIrrEnabled() && _solidShLastValid ? Math.max(0.05, Math.min(1, Number(irr.envIblDiffuseScale) ?? 1)) : 1;
    const wp = Math.max(0.5, Number(irr.weightPower) || 2);
    const mw = Math.max(0, Number(irr.minWeight) || 0);
    let groundY = 0;
    let hasGround = false;
    try {
      const gnd = getGround && getGround();
      if (gnd && typeof gnd.getWorldPosition === 'function') {
        gnd.getWorldPosition(_tmpSolidGroundWorld);
        groundY = Number(_tmpSolidGroundWorld.y) || 0;
        hasGround = true;
      } else if (gnd && gnd.position) {
        groundY = Number(gnd.position.y) || 0;
        hasGround = true;
      }
    } catch (_eGy) {}
    const gocOn = irr.groundShOcclusionEnabled !== false && hasGround && mix > 1e-6;
    let gocAmt = gocOn ? Math.max(0, Math.min(1, Number(irr.groundShOcclusionAmount ?? 1))) : 0;
    const gocH = Math.max(1e-4, Number(irr.groundShOcclusionHeight) || 0.16);
    const gocCavityPow = Math.max(0.25, Number(irr.groundShOcclusionCavityPow) || 2.6);
    const gNorBindPow = Math.max(0.08, Math.min(2, Number(irr.groundShOcclusionNorBindPow) || 0.34));
    const gocNExp = Math.max(0.5, Number(irr.groundShOcclusionNormalExp) || 2);
    const gocMin = Math.max(0, Math.min(1, Number(irr.groundShOcclusionMinFactor) ?? 0.06));
    let gIblAmt = gocOn ? Math.max(0, Math.min(1, Number(irr.groundIblOcclusionAmount) || 0)) : 0;
    const gIblMin = Math.max(0, Math.min(1, Number(irr.groundIblOcclusionMinFactor) ?? 0.35));
    const gCrevPow = Math.max(0.2, Number(irr.groundShCrevicePow) || 2.5);
    const gCrevShMul = Math.max(0, Math.min(1, Number(irr.groundShCreviceShMul) ?? 0.05));
    const gCrevIblMul = Math.max(0, Math.min(1, Number(irr.groundShCreviceIblMul) ?? 0.2));
    let gCrevAmt = gocOn ? Math.max(0, Math.min(1, Number(irr.groundShCreviceAmount ?? 1))) : 0;
    // Keep SH/AO energy stable globally; terminator softening is handled in the terminator field patch.
    _solidShPatchedMaterials.forEach((m) => {
      try {
        const u = m && m.userData && m.userData._solidShUni;
        if (!u) return;
        u.uSolidProbePos0.value.copy(probePositions[0]);
        u.uSolidProbePos1.value.copy(probePositions[1]);
        u.uSolidProbePos2.value.copy(probePositions[2]);
        for (let pi = 0; pi < probeCount; pi++) {
          const flat = _probeShFlat[pi];
          for (let j = 0; j < 9; j++) {
            const key = _solidShCoeffUniformName(pi, j);
            const uv = u[key];
            if (uv && uv.value && uv.value.set) {
              uv.value.set(flat[j * 3], flat[j * 3 + 1], flat[j * 3 + 2]);
            }
          }
        }
        u.uSolidShDiffuseMix.value = mix;
        u.uSolidEnvIblDiffuseScale.value = envScale;
        u.uSolidShWeightPow.value = wp;
        u.uSolidShMinWt.value = mw;
        if (u.uSolidGroundY) u.uSolidGroundY.value = groundY;
        if (u.uSolidGroundOcclH) u.uSolidGroundOcclH.value = gocH;
        if (u.uSolidGroundOcclCavityPow) u.uSolidGroundOcclCavityPow.value = gocCavityPow;
        if (u.uSolidGroundNorBindPow) u.uSolidGroundNorBindPow.value = gNorBindPow;
        if (u.uSolidGroundOcclNExp) u.uSolidGroundOcclNExp.value = gocNExp;
        if (u.uSolidGroundOcclMin) u.uSolidGroundOcclMin.value = gocMin;
        if (u.uSolidGroundOcclAmt) u.uSolidGroundOcclAmt.value = gocAmt;
        if (u.uSolidGroundIblMin) u.uSolidGroundIblMin.value = gIblMin;
        if (u.uSolidGroundIblOccAmt) u.uSolidGroundIblOccAmt.value = gIblAmt;
        if (u.uSolidGroundCrevicePow) u.uSolidGroundCrevicePow.value = gCrevPow;
        if (u.uSolidGroundCreviceShMul) u.uSolidGroundCreviceShMul.value = gCrevShMul;
        if (u.uSolidGroundCreviceIblMul) u.uSolidGroundCreviceIblMul.value = gCrevIblMul;
        if (u.uSolidGroundCreviceAmt) u.uSolidGroundCreviceAmt.value = gCrevAmt;
      } catch (_e) {}
    });
  }

  function _solidShDisposeUniformMix() {
    _solidShLastValid = false;
    _solidShPatchedMaterials.forEach((m) => {
      try {
        const u = m && m.userData && m.userData._solidShUni;
        if (u && u.uSolidShDiffuseMix) u.uSolidShDiffuseMix.value = 0;
        if (u && u.uSolidEnvIblDiffuseScale) u.uSolidEnvIblDiffuseScale.value = 1;
        if (u && u.uSolidGroundOcclAmt) u.uSolidGroundOcclAmt.value = 0;
        if (u && u.uSolidGroundIblOccAmt) u.uSolidGroundIblOccAmt.value = 0;
        if (u && u.uSolidGroundCreviceAmt) u.uSolidGroundCreviceAmt.value = 0;
      } catch (_e) {}
    });
  }

  function _solidShEnsureDiffusePatch(material) {
    if (!material || (!material.isMeshStandardMaterial && !material.isMeshPhysicalMaterial)) return;
    if (!_solidShIrrEnabled()) return;
    if (material.userData.__solidShPatchVer === _SOLID_SH_PATCH_VER) return;
    material.userData.__solidShPatchVer = _SOLID_SH_PATCH_VER;
    solidInstallOnBeforeCompilePatch(material, {
      id: 'solidShProbe',
      ver: _SOLID_SH_PATCH_VER,
      apply: (shader) => {
        try {
        const u = _solidShEnsureUniforms(material);
        Object.keys(u).forEach((k) => {
          shader.uniforms[k] = u[k];
        });
        if (shader.vertexShader && !shader.vertexShader.includes('vSolidWorldPos')) {
          shader.vertexShader = 'varying vec3 vSolidWorldPos;\n' + shader.vertexShader;
          const vSolidWorldPosAssign = '\n\tvSolidWorldPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;';
          if (shader.vertexShader.includes('#include <worldpos_vertex>')) {
            shader.vertexShader = shader.vertexShader.replace(
              '#include <worldpos_vertex>',
              '#include <worldpos_vertex>' + vSolidWorldPosAssign
            );
          } else if (shader.vertexShader.includes('#include <begin_vertex>')) {
            shader.vertexShader = shader.vertexShader.replace(
              '#include <begin_vertex>',
              '#include <begin_vertex>' + vSolidWorldPosAssign
            );
          }
        }
        const glslMix = (
          'vec3 solidShEvalIrr9( vec3 normalWorld, vec3 c0, vec3 c1, vec3 c2, vec3 c3, vec3 c4, vec3 c5, vec3 c6, vec3 c7, vec3 c8 ) {\n' +
          '\tfloat x = normalWorld.x, y = normalWorld.y, z = normalWorld.z;\n' +
          '\tvec3 irr = c0 * 0.886227;\n' +
          '\tirr += c1 * ( 2.0 * 0.511664 * y );\n' +
          '\tirr += c2 * ( 2.0 * 0.511664 * z );\n' +
          '\tirr += c3 * ( 2.0 * 0.511664 * x );\n' +
          '\tirr += c4 * ( 2.0 * 0.429043 * x * y );\n' +
          '\tirr += c5 * ( 2.0 * 0.429043 * y * z );\n' +
          '\tirr += c6 * ( 0.743125 * z * z - 0.247708 );\n' +
          '\tirr += c7 * ( 2.0 * 0.429043 * x * z );\n' +
          '\tirr += c8 * ( 0.429043 * ( x * x - y * y ) );\n' +
          '\treturn irr;\n' +
          '}\n'
        );
        let fragShDecl = '';
        let shMixLines = '';
        for (let pi = 0; pi < probeCount; pi++) {
          for (let j = 0; j < 9; j++) {
            fragShDecl += 'uniform vec3 ' + _solidShCoeffUniformName(pi, j) + ';\n';
          }
        }
        for (let j = 0; j < 9; j++) {
          shMixLines +=
            '\tvec3 m' + j + ' = ' + _solidShCoeffUniformName(0, j) + '*w0+' +
            _solidShCoeffUniformName(1, j) + '*w1+' +
            _solidShCoeffUniformName(2, j) + '*w2;\n';
        }
        // 函数必须放在全局作用域（与 uniform 一起、在 lights_pars_begin 之前）。
        // 若插在 lights_fragment_end 前，会紧跟 lights_fragment_maps 的 #endif，部分驱动会误判为块内函数定义而报 '{' syntax error。
        const glslBlock =
          '{\n' +
          '\tvec3 p = vSolidWorldPos;\n' +
          '\tfloat d0 = length( p - uSolidProbePos0 );\n' +
          '\tfloat d1 = length( p - uSolidProbePos1 );\n' +
          '\tfloat d2 = length( p - uSolidProbePos2 );\n' +
          '\tfloat w0 = 1.0 / ( pow( max( d0, 1e-3 ), uSolidShWeightPow ) + uSolidShMinWt );\n' +
          '\tfloat w1 = 1.0 / ( pow( max( d1, 1e-3 ), uSolidShWeightPow ) + uSolidShMinWt );\n' +
          '\tfloat w2 = 1.0 / ( pow( max( d2, 1e-3 ), uSolidShWeightPow ) + uSolidShMinWt );\n' +
          '\tfloat ws = w0 + w1 + w2;\n' +
          '\tw0 /= ws; w1 /= ws; w2 /= ws;\n' +
          '\tvec3 nW = inverseTransformDirection( normal, viewMatrix );\n' +
          shMixLines +
          '\tvec3 shIrr = solidShEvalIrr9( nW, m0, m1, m2, m3, m4, m5, m6, m7, m8 );\n' +
          '\tfloat solidH = max( vSolidWorldPos.y - uSolidGroundY, 0.0 );\n' +
          '\tfloat solidGapRaw = uSolidGroundOcclH / ( uSolidGroundOcclH + solidH );\n' +
          '\tfloat solidNearGr = pow( solidGapRaw, uSolidGroundOcclCavityPow );\n' +
          '\tfloat solidNd = pow( max( 0.0, -nW.y ), uSolidGroundOcclNExp );\n' +
          '\tfloat solidNdEff = max( solidNd, pow( max( solidGapRaw, 1e-4 ), uSolidGroundNorBindPow ) );\n' +
          '\tfloat solidOccW = clamp( solidNearGr * solidNdEff, 0.0, 1.0 );\n' +
          '\tfloat solidShOcc = mix( 1.0, uSolidGroundOcclMin, solidOccW * uSolidGroundOcclAmt );\n' +
          '\tfloat solidIblOcc = mix( 1.0, uSolidGroundIblMin, solidOccW * uSolidGroundIblOccAmt );\n' +
          '\tfloat solidCrev = pow( max( solidGapRaw, 1e-4 ), uSolidGroundCrevicePow );\n' +
          '\tfloat solidShLine = mix( 1.0, uSolidGroundCreviceShMul, solidCrev * uSolidGroundCreviceAmt );\n' +
          '\tfloat solidIblLine = mix( 1.0, uSolidGroundCreviceIblMul, solidCrev * uSolidGroundCreviceAmt );\n' +
          '\tirradiance += shIrr * uSolidShDiffuseMix * solidShOcc * solidShLine;\n' +
          '\tiblIrradiance *= uSolidEnvIblDiffuseScale * solidIblOcc * solidIblLine;\n' +
          '}\n';
        const fragPars =
          glslMix +
          'uniform vec3 uSolidProbePos0;\n' +
          'uniform vec3 uSolidProbePos1;\n' +
          'uniform vec3 uSolidProbePos2;\n' +
          fragShDecl +
          'uniform float uSolidShDiffuseMix;\n' +
          'uniform float uSolidEnvIblDiffuseScale;\n' +
          'uniform float uSolidShWeightPow;\n' +
          'uniform float uSolidShMinWt;\n' +
          'uniform float uSolidGroundY;\n' +
          'uniform float uSolidGroundOcclH;\n' +
          'uniform float uSolidGroundOcclCavityPow;\n' +
          'uniform float uSolidGroundNorBindPow;\n' +
          'uniform float uSolidGroundOcclNExp;\n' +
          'uniform float uSolidGroundOcclMin;\n' +
          'uniform float uSolidGroundOcclAmt;\n' +
          'uniform float uSolidGroundIblMin;\n' +
          'uniform float uSolidGroundIblOccAmt;\n' +
          'uniform float uSolidGroundCrevicePow;\n' +
          'uniform float uSolidGroundCreviceShMul;\n' +
          'uniform float uSolidGroundCreviceIblMul;\n' +
          'uniform float uSolidGroundCreviceAmt;\n' +
          'varying vec3 vSolidWorldPos;\n';
        if (shader.fragmentShader && !shader.fragmentShader.includes('uSolidShDiffuseMix')) {
          if (shader.fragmentShader.includes('#include <lights_pars_begin>')) {
            shader.fragmentShader = shader.fragmentShader.replace('#include <lights_pars_begin>', fragPars + '\n#include <lights_pars_begin>');
          } else {
            shader.fragmentShader = fragPars + shader.fragmentShader;
          }
          const endTag = '#include <lights_fragment_end>';
          if (shader.fragmentShader.includes(endTag)) {
            shader.fragmentShader = shader.fragmentShader.replace(endTag, glslBlock + endTag);
          }
        }
        } catch (_eSh) {}
      },
    });
    try { solidSyncOnBeforeCompileExternalHead(material); } catch (_e) {}
    try {
      material.needsUpdate = true;
    } catch (_eNu) {}
    _solidShPatchedMaterials.add(material);
  }

  function _isEnvMapClearTargetMaterial(m) {
    if (!m) return false;
    return !!(m.isMeshStandardMaterial || m.isMeshPhysicalMaterial);
  }

  function _disposeEnvProbe() {
    try {
      _solidShDisposeUniformMix();
      const scene = getScene();
      const sameAs0 = (basePmremRT && pmremRTs[0] && basePmremRT === pmremRTs[0]);
      if (basePmremRT && !sameAs0) { try { safeDispose(basePmremRT); } catch (_e0) {} }
      basePmremRT = null;
      for (let i = 0; i < pmremRTs.length; i++) {
        if (pmremRTs[i]) { try { safeDispose(pmremRTs[i]); } catch (_e) {} pmremRTs[i] = null; }
      }
      try { if (cubeRT) safeDispose(cubeRT); } catch (_e3) {}
      cubeRT = null;
      cubeCam = null;
      try { if (scene) { scene.environment = null; scene.environmentIntensity = 1; } } catch (_e4) {}
      try {
        const targets = _collectEnvProbeTargetMeshes();
        for (let ti = 0; ti < targets.length; ti++) {
          const obj = targets[ti];
          if (!obj || !obj.isMesh) continue;
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          for (let mi = 0; mi < mats.length; mi++) {
            const m = mats[mi];
            if (!_isEnvMapClearTargetMaterial(m)) continue;
            if (m.envMap) {
              m.envMap = null;
              m.needsUpdate = true;
            }
          }
        }
      } catch (_e5) {}
    } catch (_e) {}
  }

  function _envIntensityForMaterial(m) {
    const r = Math.min(1, Math.max(0, Number(m.roughness) || 0));
    const met = Math.min(1, Math.max(0, Number(m.metalness) || 0));
    let v = 0.16 + (1.0 - r) * 0.38;
    if (met > 0.55) v *= 0.72;
    v = Math.min(0.78, Math.max(0.11, v));
    return v;
  }

  function _computeProbeLayout() {
    const sceneGroup = getSceneGroup();
    const center = new THREE.Vector3(0, 1.0, 0);
    let radius = 3.2;
    try {
      const box = new THREE.Box3();
      box.setFromObject(sceneGroup);
      if (!box.isEmpty()) {
        const c = new THREE.Vector3();
        box.getCenter(c);
        const size = new THREE.Vector3();
        box.getSize(size);
        center.copy(c);
        radius = Math.max(1.2, Math.max(size.x, size.z) * 0.42 + size.y * 0.10);
        center.y = Math.max(0.35, center.y);
      }
    } catch (_e) {}

    const yHi = Math.max(0.9, Math.min(2.8, center.y + radius * 0.22));
    const yLo = Math.max(0.22, Math.min(1.1, center.y * 0.35 + 0.22));
    probePositions[0].set(center.x, yHi, center.z + radius * 0.62);
    probePositions[1].set(center.x + radius * 0.58, yHi, center.z - radius * 0.36);
    probePositions[2].set(center.x - radius * 0.58, yLo, center.z - radius * 0.36);
  }

  function _scheduleSceneChangedSyncShadows() {
    _sceneChangedSyncToken++;
    const token = _sceneChangedSyncToken;
    if (_sceneChangedSyncRaf) {
      try { cancelAnimationFrame(_sceneChangedSyncRaf); } catch (_eRafCancel) {}
      _sceneChangedSyncRaf = 0;
    }
    if (_sceneChangedSyncTimer80) {
      clearTimeout(_sceneChangedSyncTimer80);
      _sceneChangedSyncTimer80 = 0;
    }
    if (_sceneChangedSyncTimer220) {
      clearTimeout(_sceneChangedSyncTimer220);
      _sceneChangedSyncTimer220 = 0;
    }

    try { syncShadows(); } catch (_eNow) {}
    try {
      _sceneChangedSyncRaf = requestAnimationFrame(() => {
        _sceneChangedSyncRaf = 0;
        if (!previewEnabled || token !== _sceneChangedSyncToken) return;
        try { syncShadows(); } catch (_eRafRun) {}
      });
    } catch (_eRaf) {}
    try {
      _sceneChangedSyncTimer80 = setTimeout(() => {
        _sceneChangedSyncTimer80 = 0;
        if (!previewEnabled || token !== _sceneChangedSyncToken) return;
        try { syncShadows(); } catch (_eT1) {}
      }, 80);
    } catch (_eT0) {}
    try {
      _sceneChangedSyncTimer220 = setTimeout(() => {
        _sceneChangedSyncTimer220 = 0;
        if (!previewEnabled || token !== _sceneChangedSyncToken) return;
        try { syncShadows(); } catch (_eT2) {}
      }, 220);
    } catch (_eT00) {}
  }

  function _pickNearestProbeIndex(p) {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < probeCount; i++) {
      const d = p.distanceToSquared(probePositions[i]);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  function _collectEnvProbeTargetMeshes() {
    const out = [];
    const sceneGroup = getSceneGroup();
    if (sceneGroup && sceneGroup.traverse) {
      try {
        sceneGroup.traverse((obj) => {
          if (obj && obj.isMesh && !(obj.userData && obj.userData.solidShadowCore)) out.push(obj);
        });
      } catch (_e) {}
    }
    const g = getGround();
    if (g && g.isMesh) out.push(g);
    const ws = getWalls();
    if (ws && Array.isArray(ws)) {
      ws.forEach((w) => {
        if (w && w.isMesh) out.push(w);
      });
    }
    return out;
  }

  function _applyMultiEnvProbesToSceneGroup() {
    const targets = _collectEnvProbeTargetMeshes();
    const tmp = new THREE.Vector3();
    for (let oi = 0; oi < targets.length; oi++) {
      const obj = targets[oi];
      if (!obj || !obj.isMesh) continue;
      let idx = 0;
      try {
        obj.updateWorldMatrix(true, false);
        const g = (obj.geometry && obj.geometry.boundingSphere) ? obj.geometry.boundingSphere : null;
        if (g) tmp.copy(g.center).applyMatrix4(obj.matrixWorld);
        else obj.getWorldPosition(tmp);
      } catch (_eP) {
        try { obj.getWorldPosition(tmp); } catch (_e2) { tmp.set(0, 1, 0); }
      }
      idx = _pickNearestProbeIndex(tmp);
      const pm = pmremRTs[idx];
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (let i = 0; i < mats.length; i++) {
        const m = mats[i];
        if (!m) continue;
        if (!(m.isMeshStandardMaterial || m.isMeshPhysicalMaterial)) continue;
        if (pm && pm.texture) {
          const nextIntensity = _envIntensityForMaterial(m);
          const envChanged = m.envMap !== pm.texture;
          const intensityChanged = m.envMapIntensity !== nextIntensity;
          if (envChanged) m.envMap = pm.texture;
          if (intensityChanged) m.envMapIntensity = nextIntensity;
          if (envChanged) m.needsUpdate = true;
        }
        _solidShEnsureDiffusePatch(m);
      }
    }
  }

  function _updateEnvProbeNow(reason) {
    try {
      if (!previewEnabled) return;
      if (shouldSkipEnvProbe(reason)) return;
      const renderer = getRenderer();
      const scene = getScene();
      const camera = getCamera();
      const sceneGroup = getSceneGroup();
      if (!renderer || !scene || !camera || !sceneGroup) return;

      const irr = _irrCfg();
      const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      _perfUpdateTier(now);
      const interact = (!!getInteractionState()) || _perfIsInteractive(now);
      let minIv = minIntervalMs;
      if (irr && typeof irr.minIntervalMsIdle === 'number') {
        minIv = interact ? (Number(irr.minIntervalMsInteractive) || minIntervalMs) : (Number(irr.minIntervalMsIdle) || minIntervalMs);
      }
      if (_solidShIrrEnabled() && irr && !_solidShLastValid) {
        const retryIv = Math.max(120, Math.floor(Number(irr.shRetryMinIntervalMs) || 420));
        minIv = Math.min(minIv, retryIv);
      }
      if (lastRunAt && (now - lastRunAt) < minIv) return;
      lastRunAt = now;

      let effectiveCubeSize = cubeSize;
      if (_solidShIrrEnabled() && irr) {
        effectiveCubeSize = interact
          ? Math.max(16, Math.floor(Number(irr.cubeSizeInteractive) || 40))
          : Math.max(16, Math.floor(Number(irr.cubeSizeIdle) || 64));
      } else if (typeof opts.envCubeSize === 'number') {
        effectiveCubeSize = opts.envCubeSize;
      } else {
        effectiveCubeSize = getIsMobile() ? 48 : 64;
      }

      if (!pmremGen) pmremGen = new THREE.PMREMGenerator(renderer);
      if (!cubeRT || cubeRT.width !== effectiveCubeSize) {
        try { if (cubeRT) safeDispose(cubeRT); } catch (_eCr) {}
        cubeRT = null;
        cubeCam = null;
        cubeRT = new THREE.WebGLCubeRenderTarget(effectiveCubeSize, {
          type: THREE.HalfFloatType,
          generateMipmaps: true,
          minFilter: THREE.LinearMipmapLinearFilter,
        });
        _lastCubeRtSize = effectiveCubeSize;
      }
      if (!cubeCam) {
        cubeCam = new THREE.CubeCamera(0.08, 160, cubeRT);
        cubeCam.renderTarget.texture.name = 'SolidRasterEnvCubeRT';
      }

      if (!_solidShIrrEnabled()) {
        _solidShLastValid = false;
        _solidShDisposeUniformMix();
      }

      _computeProbeLayout();
      scene.environment = null;
      scene.environmentIntensity = 1;

      const prevPos = cubeCam.position.clone();
      const shFreeze = _solidShIrrEnabled() && !!(irr && irr.freezeShWhileInteractive) && interact;
      let shAllOk = true;
      for (let pi = 0; pi < probeCount; pi++) {
        cubeCam.position.copy(probePositions[pi]);
        cubeCam.updateMatrixWorld(true);
        cubeCam.update(renderer, scene);
        if (_solidShIrrEnabled()) {
          if (!shFreeze) {
            const ok = _computeShFromCubeRenderTarget(renderer, cubeRT, _probeShFlat[pi]);
            if (!ok) shAllOk = false;
          }
        }
        if (pmremRTs[pi]) { try { safeDispose(pmremRTs[pi]); } catch (_eD) {} pmremRTs[pi] = null; }
        pmremRTs[pi] = pmremGen.fromCubemap(cubeRT.texture);
      }
      cubeCam.position.copy(prevPos);
      cubeCam.updateMatrixWorld(true);

      if (_solidShIrrEnabled()) {
        _solidShLastValid = shFreeze ? _solidShLastValid : shAllOk;
      } else {
        _solidShLastValid = false;
      }

      try {
        const baseSrc = pmremRTs[0];
        if (basePmremRT && basePmremRT !== baseSrc) { try { safeDispose(basePmremRT); } catch (_eDb) {} }
        basePmremRT = null;
        if (baseSrc && baseSrc.texture) {
          basePmremRT = baseSrc;
          scene.environment = baseSrc.texture;
          scene.environmentIntensity = getIsMobile() ? 0.22 : 0.26;
        } else {
          scene.environment = null;
          scene.environmentIntensity = 1;
        }
      } catch (_eB) {
        scene.environment = null;
        scene.environmentIntensity = 1;
      }

      _applyMultiEnvProbesToSceneGroup();
      if (_solidShIrrEnabled()) _solidShPushUniformsFromState();
      log('[RasterEnvProbe] multi updated (' + (reason || 'unknown') + '), cube=' + effectiveCubeSize + ' x3 sh=' + (_solidShIrrEnabled() ? (_solidShLastValid ? '1' : '0') : 'off'));
    } catch (e) {
      log('[RasterEnvProbe] failed: ' + (e && e.message ? e.message : e));
      _disposeEnvProbe();
    }
  }

  function requestEnvProbe(reason) {
    if (!previewEnabled) return;
    const r = String(reason || '');
    // 换场景/增删物体后若仍沿用旧的 lastRunAt，会把首轮探针推迟整整一个 minInterval，表现为「SH 很久才出来」。
    if (/scene_loaded|scene_changed|apply_scene|json_loaded|new_scene|delete_selected|add_builtin|add_glb/i.test(r)) {
      lastRunAt = 0;
    }
    const irr = _irrCfg();
    const deb = Math.max(0, typeof irr.envDebounceMs === 'number' ? irr.envDebounceMs : debounceMs);
    const debMax = Math.max(0, Number(irr.debounceMaxMs) || 0);

    if (envProbeTimer) { clearTimeout(envProbeTimer); envProbeTimer = 0; }
    envProbeTimer = setTimeout(() => {
      envProbeTimer = 0;
      if (envProbeMaxTimer) { clearTimeout(envProbeMaxTimer); envProbeMaxTimer = 0; }
      _updateEnvProbeNow(reason);
    }, deb);

    if (debMax > 0 && !envProbeMaxTimer) {
      envProbeMaxTimer = setTimeout(() => {
        envProbeMaxTimer = 0;
        if (envProbeTimer) { clearTimeout(envProbeTimer); envProbeTimer = 0; }
        _updateEnvProbeNow(reason);
      }, debMax);
    }
  }

  function onSceneChanged(reason) {
    // Scene load/apply may create/replace receiver materials asynchronously.
    // Re-arm shadow receiver patch several times in a short window, so first entry
    // gets soft receivers without requiring a manual light-type toggle.
    try {
      if (previewEnabled) {
        _bumpReceiverSignatureCaches();
        _scheduleSceneChangedSyncShadows();
      }
    } catch (_e) {}
    // For now: force a near-term env refresh; layout will adapt to new bounds.
    requestEnvProbe(reason || 'scene_changed');
  }

  function dispose() {
    try {
      if (envProbeTimer) { clearTimeout(envProbeTimer); envProbeTimer = 0; }
      if (envProbeMaxTimer) { clearTimeout(envProbeMaxTimer); envProbeMaxTimer = 0; }
    } catch (_e) {}
    _disposeEnvProbe();
  }

  function install() {
    // No-op: kept for future global ShaderChunk guard if needed.
    return true;
  }

  function setEnabled(isPreviewMode) {
    previewEnabled = !!isPreviewMode;
    if (!previewEnabled) {
      // When leaving preview mode, release probe resources to avoid memory peaks.
      dispose();
    }
  }

  return {
    install,
    setEnabled,
    syncShadows,
    syncGroundShadowUniforms,
    /** 与 Solid.html 原 `_solidFitRasterShadowFrustumForSceneGroup` 同源：光源移动后收紧 shadow frustum。 */
    fitRasterShadowFrustumForSceneGroup: (lightOverride) => _fitRasterShadowFrustumForSceneGroup(lightOverride),
    requestEnvProbe,
    onSceneChanged,
    dispose,
  };
}

