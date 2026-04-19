/**
 * 光栅预览后处理：EffectComposer + GTAO + OutputPass（与 PathTracer 分离）。
 * 宿主在 `useAdvancedRender === false` 且 SOLID_RASTER_PREVIEW_AO.enabled 时调用 tryRender()。
 */
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import {
  SOLID_RASTER_IRRADIANCE_PROBES,
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
  let outputPass = null;
  let _clipSig = '';

  function _aoCfg() {
    return SOLID_RASTER_PREVIEW_AO || {};
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
    outputPass = null;
    _clipSig = '';
  }

  function _ensureComposer() {
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

    composer = new EffectComposer(renderer);
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
    gtaoPass.blendIntensity = Math.max(0, Math.min(1, bi));

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
   * @returns {boolean} true 表示已绘制（composer 或 forward），调用方勿再 renderer.render
   */
  function tryRender() {
    const cfg = _aoCfg();
    if (!cfg.enabled || (getUseAdvancedRender && getUseAdvancedRender())) return false;
    const renderer = getRenderer();
    const scene = getScene();
    const camera = getCamera();
    if (!renderer || !scene || !camera) return false;

    if (cfg.skipComposerWhileInteracting !== false && getInteractionState()) {
      try {
        renderer.render(scene, camera);
      } catch (_e) {}
      return true;
    }

    const c = _ensureComposer();
    if (!c) return false;
    try {
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
