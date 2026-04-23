/**
 * 光栅预览后处理：EffectComposer + GTAO + OutputPass（与 PathTracer 分离）。
 * 宿主在 `useAdvancedRender === false` 且 SOLID_RASTER_PREVIEW_AO.enabled 时调用 tryRender()。
 */
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import {
  SOLID_RASTER_IRRADIANCE_PROBES,
  SOLID_RASTER_PREVIEW_AA,
  SOLID_RASTER_PREVIEW_AO,
  getSolidRasterPreviewLightingDerived,
} from '../Config/PaintingConfig.js';

/**
 * @param {object} opts
 * @param {import('three').THREE} opts.THREE
 * @param {() => import('three').WebGLRenderer} opts.getRenderer
 * @param {() => import('three').Scene} opts.getScene
 * @param {() => import('three').Camera} opts.getCamera
 * @param {() => boolean} [opts.getIsMobile]
 * @param {() => boolean} [opts.getInteractionState]
 * @param {() => boolean} opts.getUseAdvancedRender
 * @param {() => import('three').Object3D|null} [opts.getSceneGroup]
 */
export function createSolidRasterPreviewComposer(opts) {
  const THREE = opts.THREE;
  const getRenderer = opts.getRenderer;
  const getScene = opts.getScene;
  const getCamera = opts.getCamera;
  const getIsMobile = typeof opts.getIsMobile === 'function' ? opts.getIsMobile : () => false;
  const getInteractionState = typeof opts.getInteractionState === 'function' ? opts.getInteractionState : () => false;
  const getUseAdvancedRender = opts.getUseAdvancedRender;
  const getSceneGroup = typeof opts.getSceneGroup === 'function' ? opts.getSceneGroup : () => null;

  let composer = null;
  let renderPass = null;
  let gtaoPass = null;
  let smaaPass = null;
  let outputPass = null;
  let _clipSig = '';
  let _composerSig = '';

  function _aoCfg() {
    return SOLID_RASTER_PREVIEW_AO || {};
  }
  function _aaCfg() {
    return SOLID_RASTER_PREVIEW_AA || {};
  }

  function _clamp01(v, dft) {
    const n = Number(v);
    if (!Number.isFinite(n)) return dft;
    return Math.max(0, Math.min(1, n));
  }

  function _smaaParamsFromSoftness() {
    const aa = _aaCfg();
    // 无极档：0=偏锐利、1=偏柔和（默认偏柔和）
    const s = _clamp01(aa.softness, 0.72);
    // 阈值越低，检测到的边越多，画面更柔和。
    const threshold = (0.14 - 0.10 * s).toFixed(4); // 0.14 -> 0.04
    // 搜索步数越高，斜边与细边的平滑更充分。
    const searchSteps = String(Math.max(4, Math.min(16, Math.round(6 + 10 * s))));
    return { threshold, searchSteps, softness: s };
  }

  function _applySmaaTuning(pass) {
    if (!pass) return { threshold: '0.1000', searchSteps: '8', softness: 0.72 };
    const tuned = _smaaParamsFromSoftness();
    try {
      if (pass.materialEdges && pass.materialEdges.defines) {
        pass.materialEdges.defines.SMAA_THRESHOLD = tuned.threshold;
        pass.materialEdges.needsUpdate = true;
      }
      if (pass.materialWeights && pass.materialWeights.defines) {
        pass.materialWeights.defines.SMAA_MAX_SEARCH_STEPS = tuned.searchSteps;
        pass.materialWeights.needsUpdate = true;
      }
    } catch (_e) {}
    return tuned;
  }

  function _aoTerminatorProtectedBlend(baseBi) {
    const bi0 = Number.isFinite(baseBi) ? baseBi : 0;
    // Anti-regression: AO 只负责“间接遮蔽”对比，不承担主光交界线宽化职责。
    // 主光明暗交界线的宽化/柔化应由主光链路（N·L / 影子）控制，避免出现“AO线被误调宽”。
    return Math.max(0, Math.min(1, bi0));
  }

  function dispose() {
    if (!composer) return;
    try {
      const passes = composer.passes;
      for (let i = 0; i < passes.length; i++) {
        const p = passes[i];
        if (p && typeof p.dispose === 'function') {
          try {
            p.dispose();
          } catch (_e) {}
        }
      }
    } catch (_e2) {}
    try {
      composer.dispose();
    } catch (_e3) {}
    composer = null;
    renderPass = null;
    gtaoPass = null;
    smaaPass = null;
    outputPass = null;
    _clipSig = '';
    _composerSig = '';
  }

  function _shouldUseSmaa(nowMs) {
    const aa = _aaCfg();
    if (!aa.enabled) return false;
    if (String(aa.mode || 'smaa') !== 'smaa') return false;
    const mobile = !!getIsMobile();
    if (mobile && aa.mobileEnabled === false) return false;

    if (aa.skipWhileInteracting === false) return true;
    if (!getInteractionState()) return true;

    const policy = String(aa.interactionQualityPolicy || 'adaptive');
    if (policy !== 'adaptive') return true;

    const now = Number(nowMs) || ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now());
    const restoreDelay = Math.max(0, Number(aa.restoreDelayMs) || 0);
    const g = (typeof globalThis !== 'undefined') ? globalThis : null;
    const lastInteract = g ? Number(g._solidLastInteractAt || 0) : 0;
    if (lastInteract <= 0) return false;
    return (now - lastInteract) >= restoreDelay;
  }

  function _ensureComposer(enableSmaa) {
    const cfg = _aoCfg();
    if (!cfg.enabled) return null;
    if (getUseAdvancedRender && getUseAdvancedRender()) return null;
    const renderer = getRenderer();
    const scene = getScene();
    const camera = getCamera();
    if (!renderer || !scene || !camera) return null;
    if (composer) return composer;

    const size = new THREE.Vector2();
    renderer.getSize(size);
    const w = Math.max(1, Math.floor(size.x));
    const h = Math.max(1, Math.floor(size.y));
    const mobile = !!getIsMobile();
    const resScale = mobile
      ? Math.max(0.25, Math.min(1, Number(cfg.resolutionScaleMobile ?? 1)))
      : Math.max(0.25, Math.min(1, Number(cfg.resolutionScaleDesktop ?? 1)));
    const aw = Math.max(1, Math.floor(w * resScale));
    const ah = Math.max(1, Math.floor(h * resScale));
    const aaTuned = _smaaParamsFromSoftness();
    const sig = [
      w, h, aw, ah,
      enableSmaa ? 1 : 0, aaTuned.threshold, aaTuned.searchSteps,
    ].join('|');
    if (composer && _composerSig === sig) return composer;
    if (composer && _composerSig !== sig) dispose();

    composer = new EffectComposer(renderer);
    _composerSig = sig;
    renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    gtaoPass = new GTAOPass(scene, camera, aw, ah);
    gtaoPass.output = GTAOPass.OUTPUT.Default;
    const drv = getSolidRasterPreviewLightingDerived();
    const irr = SOLID_RASTER_IRRADIANCE_PROBES || {};
    let bi = Number(cfg.blendIntensity ?? 0.62) * drv.aoBlendMultiplier;
    if (drv.shActive && irr.enabled) {
      bi *= Math.max(0.2, Math.min(1, Number(cfg.blendIntensityScaleWhenIrradianceSh ?? 1)));
    }
    gtaoPass.blendIntensity = _aoTerminatorProtectedBlend(bi);

    const samp = mobile
      ? Math.max(4, Math.min(24, Math.floor(Number(cfg.samplesMobile ?? cfg.samples ?? 8))))
      : Math.max(4, Math.min(32, Math.floor(Number(cfg.samples) ?? 12)));
    const pdSamp = mobile
      ? Math.max(4, Math.min(24, Math.floor(Number(cfg.pdSamplesMobile ?? cfg.pdSamples ?? 8))))
      : Math.max(4, Math.min(32, Math.floor(Number(cfg.pdSamples) ?? 12)));

    const aoParameters = {
      radius: Number(cfg.radius) ?? 0.22,
      distanceExponent: Number(cfg.distanceExponent) ?? 1.1,
      thickness: Number(cfg.thickness) ?? 1.0,
      scale: Number(cfg.scale) ?? 1.0,
      samples: samp,
      distanceFallOff: Number(cfg.distanceFallOff) ?? 1.0,
      screenSpaceRadius: !!cfg.screenSpaceRadius,
    };
    gtaoPass.updateGtaoMaterial(aoParameters);

    const pdParameters = {
      lumaPhi: Number(cfg.pdLumaPhi) ?? 10,
      depthPhi: Number(cfg.pdDepthPhi) ?? 2,
      normalPhi: Number(cfg.pdNormalPhi) ?? 3,
      radius: Math.max(1, Math.floor(Number(cfg.pdRadius) ?? 6)),
      radiusExponent: Number(cfg.pdRadiusExponent) ?? 2,
      rings: Math.max(1, Number(cfg.pdRings) ?? 2),
      samples: pdSamp,
    };
    gtaoPass.updatePdMaterial(pdParameters);

    outputPass = new OutputPass();
    composer.addPass(gtaoPass);
    if (enableSmaa) {
      smaaPass = new SMAAPass(w, h);
      _applySmaaTuning(smaaPass);
      composer.addPass(smaaPass);
    }
    composer.addPass(outputPass);

    composer.setSize(w, h);

    return composer;
  }

  function _syncClipBox() {
    if (!gtaoPass || typeof gtaoPass.setSceneClipBox !== 'function') return;
    const sg = getSceneGroup();
    if (!sg) return;
    try {
      const box = new THREE.Box3().setFromObject(sg);
      if (box.isEmpty()) return;
      const sig =
        box.min.x.toFixed(2) +
        box.min.y.toFixed(2) +
        box.min.z.toFixed(2) +
        box.max.x.toFixed(2) +
        box.max.y.toFixed(2) +
        box.max.z.toFixed(2);
      if (sig === _clipSig) return;
      _clipSig = sig;
      gtaoPass.setSceneClipBox(box);
    } catch (_e) {}
  }

  /**
   * EffectComposer 在离屏 RT 上渲染主场景时，Plugin_Atmosphere 对 renderer.render 的补丁（需 getRenderTarget()===null）不会叠雾/景深；
   * 交互时 skipComposer 走 forward 才会生效。雾/景深开启时强制 forward，与交互路径一致。
   */
  function _atmosphereRasterState() {
    try {
      const g = typeof globalThis !== 'undefined' ? globalThis : {};
      const am = g.AtmosphereManager;
      if (am && am.postMaterial && am.postMaterial.uniforms) {
        const u = am.postMaterial.uniforms;
        const fogU = u.fogEnabled && u.fogEnabled.value;
        const dofU = u.dofEnabled && u.dofEnabled.value;
        return { fog: !!fogU, dof: !!dofU };
      }
      return { fog: !!g.isFogEnabled, dof: !!(g.DoFManager && g.DoFManager.enabled) };
    } catch (_e) {
      return { fog: false, dof: false };
    }
  }

  /**
   * @returns {boolean} true 表示已绘制（composer 或 forward），调用方勿再 renderer.render
   */
  function tryRender() {
    const cfg = _aoCfg();
    if (!cfg.enabled || (getUseAdvancedRender && getUseAdvancedRender())) return false;
    const renderer = getRenderer();
    const scene = getScene();
    const camera = getCamera();
    if (!renderer || !scene || !camera) return false;
    const inStabilizing = (typeof window !== 'undefined' && (window.__solidSceneStabilizing || window.__solidCreateSceneStabilizing));
    if (inStabilizing) {
      try { renderer.render(scene, camera); } catch (_eStb) {}
      return true;
    }

    const atm = _atmosphereRasterState();
    // 景深滑块依赖 AtmosphereManager 的前向路径；景深开启时必须强制 forward。
    if (atm.dof) {
      try {
        renderer.render(scene, camera);
      } catch (_eAtmDof) {}
      return true;
    }
    // 雾气可按配置选择是否继续走 composer（保留 AA）
    if (atm.fog && cfg.allowComposerWhenAtmosphereEnabled !== true) {
      try {
        renderer.render(scene, camera);
      } catch (_eAtmFog) {}
      return true;
    }

    if (cfg.skipComposerWhileInteracting !== false && getInteractionState()) {
      const aa = _aaCfg();
      const policy = String(aa.interactionQualityPolicy || 'adaptive');
      if (policy !== 'adaptive') {
        try {
          renderer.render(scene, camera);
        } catch (_e) {}
        return true;
      }
    }

    const nowMs = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    const enableSmaa = _shouldUseSmaa(nowMs);
    const c = _ensureComposer(enableSmaa);
    if (!c) return false;
    try {
      // dynamic AO blend (size-driven): no composer rebuild required.
      if (gtaoPass) {
        const cfg2 = _aoCfg();
        const drv2 = getSolidRasterPreviewLightingDerived();
        const irr2 = SOLID_RASTER_IRRADIANCE_PROBES || {};
        let bi2 = Number(cfg2.blendIntensity ?? 0.62) * drv2.aoBlendMultiplier;
        if (drv2.shActive && irr2.enabled) {
          bi2 *= Math.max(0.2, Math.min(1, Number(cfg2.blendIntensityScaleWhenIrradianceSh ?? 1)));
        }
        gtaoPass.blendIntensity = _aoTerminatorProtectedBlend(bi2);
      }
      _syncClipBox();
      c.render();
    } catch (_eR) {
      try {
        renderer.render(scene, camera);
      } catch (_e2) {}
      return true;
    }
    return true;
  }

  function setSize(cssWidth, cssHeight) {
    void cssWidth;
    void cssHeight;
    if (!getRenderer()) return;
    // GTAO 内部分辨率在 ctor 固定；画布变化后整链重建，避免尺寸/clip 错位
    dispose();
  }

  return {
    tryRender,
    setSize,
    dispose,
    /** 场景/相机大幅变化后可清掉 composer，下一帧按新尺寸重建 */
    invalidate() {
      dispose();
    },
  };
}
