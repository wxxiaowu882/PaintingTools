import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GNMHeadModel, parseContainer } from '../../js/vendor/GNMModel.js';
import {
  sampleGnmFarkasLandmarks,
  pairLandmarks,
  ALIGN_CORE_IDS,
} from './landmarks-gnm.js';
import {
  umeyama,
  applySimilarity,
  applyNormalizePoint,
  applyNormalizePositions,
  inverseNormalizePoint,
  computeBottomCenterNormalize,
  composeNormalizeAfterSimilarity,
} from './procrustes.js';
import { LandmarkEditor } from './landmarks-editor.js?v=20260828-warp6';
import { cacheEuroMeshes, applyLandmarkWarp as applyEuroWarpTps, restoreEuroRest } from './euro-warp.js';
import {
  cacheEuroEyeMeshes,
  sampleGnmEyeFrames,
  sampleEuroEyeFrames,
  buildEyeAlignSnapshot,
  applyEuroEyeAlign as applyEuroEyeAlignVerts,
  applyEuroEyeAlignFromSnapshot,
  restoreEuroEyeRest,
  cloneEyeAlignSnapshot,
  measureEyeSurfaceGapMm,
} from './euro-eye-align.js';
import { exportBakedEuroPack } from './export-baked-euro.js';
import { EuroMvOverlay } from './euro-mv-overlay.js?v=20260829-display15';
import { createGnmHeadGroup } from '../../js/gnm-mesh-factory.js';
import {
  prepareEuroScene,
  prepareEuroMaterials,
  applyEuroPreviewEnvironment,
  installIrisPupilHoleDiscs,
  shouldSkipEuroWarp,
  meshHasEuroEyeName,
  isEuroLensMeshName,
  isEuroStaticName,
  healOpaqueBlendMaterial,
  DISPLAY_REV,
} from './euro-render-prep.js?v=20260829-display18';

const GNM_URL = '../data/gnm/gnm_head_web.bin';
/**
 * 欧版肌肉：内容 = 参考用_欧洲人头部肌肉_20260324204416_opt.glb
 * 使用叠显页本地 ASCII 路径，避免 Live Server 对跨目录中文文件名 404。
 * 见 assets/SOURCE.txt
 */
const EURO_GLB_URL = './assets/euro_muscle.glb';
const EURO_REST_URL =
  '../../篡改猴/亚洲头部肌肉模型/work_v4/compare_review/landmarks/euro_morph_rest.json';
const FARKAS_URL =
  '../../篡改猴/亚洲头部肌肉模型/work_v4/compare_review/landmarks/farkas_core.json';
const HISTORY_KEY = 'gnm-align-overlay-history-v1';
const TARGET_HEIGHT_M = 0.3;
/** 眼球模式取景：单眼外接球半径下限（米） */
const MIN_EYE_FRAME_R = 0.004;
/** 与工坊主页共用 Cache，避免叠显页再下 35MB */
const MODEL_CACHE = 'gnm-workshop-v1';
/** 相对叠显页：docs/js/three_164/.../draco/gltf/ */
const DRACO_DECODER_PATH = '../../../docs/js/three_164/examples/jsm/libs/draco/gltf/';

const $ = (sel) => document.querySelector(sel);

function absUrl(rel) {
  return new URL(rel, window.location.href).href;
}

function setProgress(p) {
  const bar = $('#loading-bar');
  if (bar) bar.style.width = `${Math.round(Math.min(1, Math.max(0, p)) * 100)}%`;
}

function setLoadingTitle(msg) {
  const el = $('#loading-title');
  if (el) el.textContent = msg;
}

function setLoadingDetail(msg) {
  const el = $('#loading-detail');
  if (el) el.textContent = msg;
}

function setStatus(msg) {
  const el = $('#status-text');
  if (el) el.textContent = msg;
}

function showLoadError(err, stage) {
  const box = $('#loading');
  const pre = $('#loading-error');
  box?.classList.remove('hidden');
  box?.classList.add('is-error');
  setLoadingTitle('加载失败');
  setLoadingDetail(stage || '请看下方错误，或打开控制台 Network');
  if (pre) {
    pre.classList.remove('hidden');
    const lines = [
      String(err?.message || err),
      err?.stack ? `\n${err.stack}` : '',
      `\nGNM: ${absUrl(GNM_URL)}`,
      `欧版: ${absUrl(EURO_GLB_URL)}`,
      `路标: ${absUrl(EURO_REST_URL)}`,
    ];
    pre.textContent = lines.join('\n');
  }
  setStatus(`错误：${err?.message || err}`);
}

async function fetchWithProgress(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} · ${url}`);
  const total = Number(res.headers.get('Content-Length')) || 0;
  if (!res.body || !total) {
    const buf = await res.arrayBuffer();
    onProgress?.(1, buf.byteLength, buf.byteLength);
    return buf;
  }
  const reader = res.body.getReader();
  const data = new Uint8Array(total);
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (received + value.length > total) {
      const chunks = [data.subarray(0, received), value];
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        chunks.push(next.value);
      }
      const length = chunks.reduce((n, c) => n + c.length, 0);
      const out = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
      }
      onProgress?.(1, length, length);
      return out.buffer;
    }
    data.set(value, received);
    received += value.length;
    onProgress?.(received / total, received, total);
  }
  const out =
    data.buffer.byteLength === received ? data.buffer : data.slice(0, received).buffer;
  onProgress?.(1, received, total);
  return out;
}

async function fetchModelBuffer(relUrl, onProgress) {
  const url = absUrl(relUrl);
  try {
    const cache = await caches.open(MODEL_CACHE);
    // 尝试绝对 URL，以及工坊主页可能写入的相对键
    const hit =
      (await cache.match(url)) ||
      (await cache.match(new URL('../data/gnm/gnm_head_web.bin', absUrl('../index.html')).href)) ||
      (await cache.match(absUrl('../data/gnm/gnm_head_web.bin')));
    if (hit) {
      onProgress?.(1, 0, 0);
      setLoadingDetail('命中浏览器缓存，跳过重复下载');
      return await hit.arrayBuffer();
    }
    const buf = await fetchWithProgress(url, onProgress);
    try {
      await cache.put(
        url,
        new Response(buf.slice(0), { headers: { 'Content-Type': 'application/octet-stream' } })
      );
    } catch (_) {
      /* private mode / quota */
    }
    return buf;
  } catch (_) {
    return await fetchWithProgress(url, onProgress);
  }
}

function fmtMb(n) {
  return (n / (1024 * 1024)).toFixed(1);
}

function stampMaterialBase(m) {
  if (!m || m.userData._overlayBase) return;
  m.userData._overlayBase = {
    transparent: !!m.transparent,
    opacity: m.opacity == null ? 1 : m.opacity,
    depthWrite: m.depthWrite !== false,
    side: m.side,
    transmission: m.transmission == null ? 0 : m.transmission,
  };
}

/** 透明度：接近 1 时恢复材质原样（不强制透明），避免多层肌肉深度错乱。
 */
function setGroupOpacity(root, opacity, opts = {}) {
  const o = Math.max(0, Math.min(1, opacity));
  const blendEuroEyes = !!opts.blendEuroEyes;
  root.visible = o > 0.005;
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    // 虹膜/晶状体不参与组透明度，避免半透明后透出红色肌层（红瞳）
    const label = `${obj.name || ''} ${obj.parent?.name || ''}`;
    if (!blendEuroEyes && (meshHasEuroEyeName(obj) || isEuroLensMeshName(label))) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        stampMaterialBase(m);
        const base = m.userData._overlayBase;
        m.transparent = base.transparent;
        m.opacity = base.opacity;
        m.depthWrite = base.depthWrite;
        m.side = base.side;
        if ('transmission' in m) m.transmission = base.transmission;
        m.needsUpdate = true;
      }
      return;
    }
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of mats) {
      stampMaterialBase(m);
      const base = m.userData._overlayBase;
      if (o >= 0.985) {
        m.transparent = base.transparent;
        m.opacity = base.opacity;
        m.depthWrite = base.depthWrite;
        m.side = base.side;
        if ('transmission' in m) m.transmission = base.transmission;
      } else {
        m.transparent = true;
        m.opacity = o * base.opacity;
        // 半透明也写深度，避免侧视后颈/耳被下层穿通成「空壳」
        m.depthWrite = o > 0.15;
        if (m.userData._gnmSclera && 'transmission' in m) {
          m.transmission = base.transmission * o;
        }
      }
      m.needsUpdate = true;
    }
  });
}

/** 肌层（与 Static 共面）→ 渲染层 1；Static/其它 → 层 0 */
const LAYER_BASE = 0;

function assignEuroRenderLayer(mesh) {
  // 单通道即可；层标记留给调试，全部留在默认层 0
  mesh.layers.set(LAYER_BASE);
}

class OverlayApp {
  constructor() {
    this.canvas = $('#view-canvas');
    // 对齐 Portrait_c / GLB 管理器：ACES + 室内 IBL，材质保持 GLB 原样
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x050508, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.78;
    this.renderer.sortObjects = true;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050508);
    applyEuroPreviewEnvironment(this.scene, this.renderer);
    this.camera = new THREE.PerspectiveCamera(28, 1, 0.01, 100);
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;

    // 对齐 GLB 管理器 neutral：欧版靠 IBL；GNM 粉模才补弱半球光
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x666666, 0);
    this.scene.add(this.hemi);

    this.gnmRoot = new THREE.Group();
    this.gnmRoot.name = 'GNM';
    // 外层：用户正交预变换；内层：Umeyama+normalize（重算只改内层）
    this.euroPivot = new THREE.Group();
    this.euroPivot.name = 'EuroPivot';
    this.euroRoot = new THREE.Group();
    this.euroRoot.name = 'Euro';
    this.euroPivot.add(this.euroRoot);
    this.markerRoot = new THREE.Group();
    this.markerRoot.name = 'Landmarks';
    this.scene.add(this.gnmRoot, this.euroPivot, this.markerRoot);

    this.euroMvOverlay = new EuroMvOverlay({
      mountEl: this.canvas.parentElement,
    });
    this.euroMvOverlay.setOnReady(() => {
      const euroScene = this.euroRoot?.children?.[0];
      if (euroScene) euroScene.visible = !this._shouldUseEuroMvOverlay();
      if (this._shouldUseEuroMvOverlay()) {
        this.euroMvOverlay.pullCameraToThree(this.camera, this.controls.target);
      }
      this._syncEuroThreeEyeDisplay();
    });

    this.preTrs = {
      txMm: 0,
      tyMm: 0,
      tzMm: 0,
      rxDeg: 0,
      ryDeg: 0,
      rzDeg: 0,
      su: 1,
      sx: 1,
      sy: 1,
      sz: 1,
      scaleUniform: true,
      scaleAxisX: false,
      scaleAxisY: false,
      scaleAxisZ: false,
    };

    this.alignReport = null;
    this.euroMeshes = [];
    this.euroWarpCache = null;
    /** 当前欧版网格是否处于拧形后状态 */
    this._euroWarped = false;
    /** 最近一次拧形的 TPS 控点（拧当下、同步黄点之前），存历史用 */
    this._lastWarpSnapshot = null;
    /** 欧版眼球刚性对齐快照（平移+缩放贴合 GNM） */
    this._eyeAlignSnapshot = null;
    this._euroEyeCache = null;
    this.gnmModel = null;
    this.gnmPositionsNative = null;
    this.viewMode = 'front';
    /** 'both' | 'gnm' | 'euro' — 模型显示与路标列表过滤 */
    this.modelViewMode = 'both';
    /** 眼球模式：仅显示两侧眼球（用于验证重合） */
    this.eyeOnlyMode = false;
    this.norm = null;
    this.lmEditor = new LandmarkEditor({
      scene: this.scene,
      camera: this.camera,
      canvas: this.canvas,
      controls: this.controls,
      gnmRoot: this.gnmRoot,
      euroRoot: this.euroRoot,
      markerRoot: this.markerRoot,
      getNorm: () => this.norm,
      applyAlignment: (sim, patch) => this._applyAlignment(sim, patch),
      getPreTrs: () => ({ ...this.preTrs }),
      applyPreTrs: (raw) => this.applyPreTrs(raw),
      getAlignSnapshot: () => this.getAlignSnapshot(),
      applyAlignSnapshot: (snap) => this.applyAlignSnapshot(snap),
      getGnmLandmarksNative: () => this.alignReport?.gnmLandmarksNative || null,
      getEuroRestUrl: () => absUrl(EURO_REST_URL),
      snapGnmNative: (xyz) => this.snapGnmNative(xyz),
      snapEuroLocal: (xyz) => this.snapEuroLocal(xyz),
      getHeadCenterWorld: () => this.getHeadCenterWorld(),
      getModelShowFlags: () => this.getModelShowFlags(),
      getListSideFilter: () => this.getListSideFilter(),
      setStatus,
      applyLandmarkWarp: () => this.applyLandmarkWarp(),
      applyEuroEyeAlign: () => this.applyEuroEyeAlign(),
      restoreEuroMesh: () => this.restoreEuroMesh(),
      getWarpSnapshotForSave: () => this.getWarpSnapshotForSave(),
      applyWarpSnapshot: (snap) => this.applyWarpSnapshot(snap),
      getEyeAlignSnapshotForSave: () => this.getEyeAlignSnapshotForSave(),
      applyEyeAlignSnapshot: (snap) => this.applyEyeAlignSnapshot(snap),
      isEuroWarped: () => this._euroWarped,
    });
    // 侧栏按钮（含历史删除）尽早绑定；loadFromPairs 内会再调一次（有防重入）
    this.lmEditor.bindUi();

    this._bindUi();
    this._bindPanelTabs();
    this._bindPreTrsUi();
    this._applyPreTrsToPivot();
    this._syncScaleUi();
    window.addEventListener('resize', () => this.resize());
    if (typeof ResizeObserver !== 'undefined' && this.canvas.parentElement) {
      new ResizeObserver(() => this.resize()).observe(this.canvas.parentElement);
    }
    this.resize();
    this._loop();
  }

  /** 未拧 + 欧版可见：Filament 叠层（实验性，失败时回退 Three.js） */
  _shouldUseEuroMvOverlay() {
    if (window.__ALIGN_DISABLE_MV_OVERLAY__) return false;
    if (this.eyeOnlyMode) return false;
    if (this._euroWarped) return false;
    if ($('#chk-euro-static-only')?.checked) return false;
    const e = Number($('#op-euro').value) / 100;
    const { showEuro } = this.getModelShowFlags();
    return showEuro && e > 0.005 && !!this.euroPivot?.visible;
  }

  _syncEuroMvOverlay() {
    if (!this.euroMvOverlay) return;
    const use = this._shouldUseEuroMvOverlay();
    this.euroMvOverlay?.setActive(use);
    const euroScene = this.euroRoot?.children?.[0];
    if (euroScene) {
      // MV 未就绪时仍显示 Three 欧版，避免黑屏
      euroScene.visible = !use || !this.euroMvOverlay.isReady();
    }
    const e = Number($('#op-euro').value) / 100;
    this.euroMvOverlay?.setOpacity(e);
    if (use && this.euroPivot) this.euroMvOverlay.scheduleExport(this.euroPivot);
  }

  _bindUi() {
    const syncOp = () => {
      const g = Number($('#op-gnm').value) / 100;
      const e = Number($('#op-euro').value) / 100;
      const { showGnm, showEuro } = this.getModelShowFlags();
      const eyeBlend = !!this.eyeOnlyMode;
      $('#op-gnm-val').textContent = `${Math.round(g * 100)}%`;
      $('#op-euro-val').textContent = `${Math.round(e * 100)}%`;
      setGroupOpacity(this.gnmRoot, g, { blendEuroEyes: true });
      setGroupOpacity(this.euroRoot, e, { blendEuroEyes: eyeBlend });
      // 模式开关优先于透明度：未显示的一侧整组隐藏（含对应路标点）
      // 眼球模式：按「切换模型」显隐，透明度滑条只做叠显比例（不因 0% 整组消失）
      const gnmOn = showGnm && (eyeBlend || g > 0.005);
      const euroOn = showEuro && (eyeBlend || e > 0.005);
      this.gnmRoot.visible = gnmOn;
      this.euroPivot.visible = euroOn;
      this._syncEyeOnlyVisibility();
      if (this.eyeOnlyMode) {
        this.markerRoot.visible = false;
      } else {
        this._syncLandmarkSideVisibility(gnmOn, euroOn);
      }
      // GLB 管理器 neutral：仅欧版时只靠 IBL；有 GNM 时才补弱半球光
      if (this.hemi) this.hemi.intensity = gnmOn ? 0.22 : 0;
      this._syncEuroMvOverlay();
      this._syncEuroThreeEyeDisplay();
    };
    $('#op-gnm').addEventListener('input', syncOp);
    $('#op-euro').addEventListener('input', syncOp);
    this._syncOp = syncOp;

    $('#btn-model-switch')?.addEventListener('click', () => {
      const m = this.modelViewMode || 'both';
      // GNM ↔ 欧版（从双侧切入时先到粉侧 / GNM 眼球侧）
      this.setModelViewMode(m === 'gnm' ? 'euro' : 'gnm');
    });
    $('#btn-model-all')?.addEventListener('click', () => {
      this.setModelViewMode('both');
    });
    $('#btn-eye-only')?.addEventListener('click', () => {
      this.setEyeOnlyMode(!this.eyeOnlyMode);
    });

    $('#chk-landmarks').addEventListener('change', (ev) => {
      if (this.eyeOnlyMode) return;
      this.markerRoot.visible = !!ev.target.checked;
      if (ev.target.checked) {
        const { showGnm, showEuro } = this.getModelShowFlags();
        this._syncLandmarkSideVisibility(showGnm, showEuro);
      }
    });
    $('#chk-euro-static-only').addEventListener('change', (ev) => {
      this._applyEuroStaticOnly(!!ev.target.checked);
    });
    $('#btn-front').addEventListener('click', () => this.setView('front'));
    $('#btn-side').addEventListener('click', () => this.setView('side'));
    $('#btn-download-align').addEventListener('click', () => this.downloadAlignJson());
    const onExportBake = () => this.exportBakedPack().catch((e) => setStatus(`导出烘焙包失败：${e.message || e}`));
    $('#btn-export-bake')?.addEventListener('click', onExportBake);
    $('#lm-hist-export-bake')?.addEventListener('click', onExportBake);
    this._syncModelViewUi();
  }

  getModelShowFlags() {
    const m = this.modelViewMode || 'both';
    return {
      showGnm: m === 'both' || m === 'gnm',
      showEuro: m === 'both' || m === 'euro',
    };
  }

  _modelViewStatusLabel(mode) {
    const m = mode || this.modelViewMode || 'both';
    if (this.eyeOnlyMode) {
      if (m === 'both') return '眼球模式 · 双侧叠显';
      if (m === 'gnm') return '眼球模式 · 仅 GNM 眼球';
      return '眼球模式 · 仅欧版眼球';
    }
    if (m === 'both') return '全部显示（粉+黄）';
    if (m === 'gnm') return '仅 GNM（粉点）';
    return '仅欧版（黄点）';
  }

  /** 路标列表过滤：null=两侧都列；'gnm'|'euro'=只列该侧 */
  getListSideFilter() {
    const m = this.modelViewMode || 'both';
    if (m === 'gnm' || m === 'euro') return m;
    return null;
  }

  setModelViewMode(mode) {
    if (mode !== 'both' && mode !== 'gnm' && mode !== 'euro') mode = 'both';
    this.modelViewMode = mode;
    if (this.eyeOnlyMode) this._ensureEyeModeOpacityForView(mode);
    this._syncModelViewUi();
    this._syncOp?.();
    this.lmEditor?.refreshList?.();
    setStatus(`模型视图：${this._modelViewStatusLabel(mode)}`);
  }

  /** 眼球模式：切换 GNM/欧版/双侧时保证当前侧可见且可叠显 */
  _ensureEyeModeOpacityForView(mode) {
    const gEl = $('#op-gnm');
    const eEl = $('#op-euro');
    if (!gEl || !eEl) return;
    if (mode === 'gnm') {
      if (Number(gEl.value) < 5) gEl.value = '100';
    } else if (mode === 'euro') {
      if (Number(eEl.value) < 5) eEl.value = '100';
    } else if (mode === 'both') {
      if (Number(gEl.value) < 5) gEl.value = '58';
      if (Number(eEl.value) < 5) eEl.value = '100';
    }
  }

  /** 眼球模式：仅显示两侧眼球，隐藏肌肉/皮肤与路标 */
  setEyeOnlyMode(on) {
    this.eyeOnlyMode = !!on;
    $('#btn-eye-only')?.classList.toggle('is-active', this.eyeOnlyMode);
    if (this.eyeOnlyMode) {
      // 眼球模式：切换按钮只在 GNM/欧版眼球间二选一，默认落到 GNM 侧
      if ((this.modelViewMode || 'both') === 'both') this.modelViewMode = 'gnm';
      this._ensureEyeModeOpacityForView(this.modelViewMode);
      this._syncModelViewUi();
    }
    this._syncOp?.();
    if (this.eyeOnlyMode) {
      this.frameEyes();
      setStatus(`模型视图：${this._modelViewStatusLabel()}`);
    } else {
      const chk = $('#chk-landmarks');
      this.markerRoot.visible = !!chk?.checked;
      this.frameHead();
      setStatus(`模型视图：${this._modelViewStatusLabel()}`);
    }
  }

  _syncEyeOnlyVisibility() {
    const on = !!this.eyeOnlyMode;
    const { showGnm, showEuro } = this.getModelShowFlags();
    const gh = this.gnmHead;
    if (gh?.bodyMesh) gh.bodyMesh.visible = !on;
    if (gh?.eyeInnerMesh) gh.eyeInnerMesh.visible = !on || showGnm;
    // 眼球模式需显示 GNM 巩膜球体（虹膜+巩膜壳），与欧版眼球叠显比对
    if (gh?.eyeScleraMesh) gh.eyeScleraMesh.visible = showGnm;

    const staticOnly = !on && !!$('#chk-euro-static-only')?.checked;
    for (const mesh of this.euroMeshes) {
      if (mesh.userData._overlayHiddenJunk) {
        mesh.visible = false;
        continue;
      }
      if (!on) {
        if (staticOnly) {
          mesh.visible = isEuroStaticName(mesh.name) || isEuroStaticName(mesh.parent?.name);
        } else {
          mesh.visible = true;
        }
        continue;
      }
      const label = `${mesh.name || ''} ${mesh.parent?.name || ''}`;
      const isEye =
        meshHasEuroEyeName(mesh) || isEuroLensMeshName(label) || mesh.name === 'EuroPupilHoleDisc';
      mesh.visible = showEuro && isEye;
    }
  }

  _syncModelViewUi() {
    const m = this.modelViewMode || 'both';
    const sw = $('#btn-model-switch');
    const all = $('#btn-model-all');
    if (all) all.classList.toggle('is-active', m === 'both');
    if (sw) {
      sw.classList.toggle('is-active', m === 'gnm' || m === 'euro');
      if (m === 'gnm') sw.textContent = '显示：GNM · 切欧版';
      else if (m === 'euro') sw.textContent = '显示：欧版 · 切GNM';
      else sw.textContent = '切换模型';
    }
  }

  _bindPanelTabs() {
    const btns = [...document.querySelectorAll('.lm-tab-btn')];
    const panels = [...document.querySelectorAll('.lm-tab-panel')];
    const activate = (name) => {
      for (const b of btns) {
        const on = b.dataset.tab === name;
        b.classList.toggle('is-active', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
      }
      for (const p of panels) {
        const on = p.id === `tab-${name}`;
        p.classList.toggle('is-active', on);
        if (on) p.removeAttribute('hidden');
        else p.setAttribute('hidden', '');
      }
    };
    for (const b of btns) {
      b.addEventListener('click', () => activate(b.dataset.tab));
    }
  }

  _bindPreTrsUi() {
    const syncPair = (numId, rangeId, onVal) => {
      const num = $(numId);
      const range = $(rangeId);
      if (!num || !range) return;
      const push = (from) => {
        const v = Number(from.value);
        if (!Number.isFinite(v)) return;
        num.value = String(v);
        range.value = String(v);
        onVal(v);
        this._applyPreTrsToPivot();
        this.lmEditor?.refreshMarkers?.();
        this._stampPreTrsInReport();
      };
      num.addEventListener('input', () => push(num));
      num.addEventListener('change', () => push(num));
      range.addEventListener('input', () => push(range));
    };

    syncPair('#trs-tx', '#trs-tx-r', (v) => {
      this.preTrs.txMm = v;
    });
    syncPair('#trs-ty', '#trs-ty-r', (v) => {
      this.preTrs.tyMm = v;
    });
    syncPair('#trs-tz', '#trs-tz-r', (v) => {
      this.preTrs.tzMm = v;
    });
    syncPair('#trs-rx', '#trs-rx-r', (v) => {
      this.preTrs.rxDeg = v;
    });
    syncPair('#trs-ry', '#trs-ry-r', (v) => {
      this.preTrs.ryDeg = v;
    });
    syncPair('#trs-rz', '#trs-rz-r', (v) => {
      this.preTrs.rzDeg = v;
    });

    const applyScaleFromUi = (which) => {
      const p = this.preTrs;
      if (which === 'u') {
        const u = Number($('#trs-su')?.value);
        if (!Number.isFinite(u) || u <= 0) return;
        p.su = u;
        if (p.scaleUniform && !p.scaleAxisX) p.sx = u;
        if (p.scaleUniform && !p.scaleAxisY) p.sy = u;
        if (p.scaleUniform && !p.scaleAxisZ) p.sz = u;
      } else if (which === 'x') {
        const v = Number($('#trs-sx')?.value);
        if (Number.isFinite(v) && v > 0) p.sx = v;
      } else if (which === 'y') {
        const v = Number($('#trs-sy')?.value);
        if (Number.isFinite(v) && v > 0) p.sy = v;
      } else if (which === 'z') {
        const v = Number($('#trs-sz')?.value);
        if (Number.isFinite(v) && v > 0) p.sz = v;
      }
      this._syncScaleValueUi();
      this._applyPreTrsToPivot();
      this.lmEditor?.refreshMarkers?.();
      this._stampPreTrsInReport();
    };

    const bindScalePair = (numId, rangeId, which) => {
      const num = $(numId);
      const range = $(rangeId);
      if (!num || !range) return;
      const push = (from) => {
        const v = Number(from.value);
        if (!Number.isFinite(v)) return;
        num.value = String(v);
        range.value = String(v);
        applyScaleFromUi(which);
      };
      num.addEventListener('input', () => push(num));
      num.addEventListener('change', () => push(num));
      range.addEventListener('input', () => push(range));
    };

    bindScalePair('#trs-su', '#trs-su-r', 'u');
    bindScalePair('#trs-sx', '#trs-sx-r', 'x');
    bindScalePair('#trs-sy', '#trs-sy-r', 'y');
    bindScalePair('#trs-sz', '#trs-sz-r', 'z');

    const onScaleFlagChange = () => {
      const p = this.preTrs;
      p.scaleUniform = !!$('#trs-uniform')?.checked;
      p.scaleAxisX = !!$('#trs-axis-x')?.checked;
      p.scaleAxisY = !!$('#trs-axis-y')?.checked;
      p.scaleAxisZ = !!$('#trs-axis-z')?.checked;
      if (!p.scaleUniform && !p.scaleAxisX && !p.scaleAxisY && !p.scaleAxisZ) {
        p.scaleUniform = true;
      }
      if (p.scaleUniform) {
        const u = p.su;
        if (!p.scaleAxisX) p.sx = u;
        if (!p.scaleAxisY) p.sy = u;
        if (!p.scaleAxisZ) p.sz = u;
      }
      this._syncScaleUi();
      this._syncScaleValueUi();
      this._applyPreTrsToPivot();
      this.lmEditor?.refreshMarkers?.();
      this._stampPreTrsInReport();
    };

    $('#trs-uniform')?.addEventListener('change', onScaleFlagChange);
    $('#trs-axis-x')?.addEventListener('change', onScaleFlagChange);
    $('#trs-axis-y')?.addEventListener('change', onScaleFlagChange);
    $('#trs-axis-z')?.addEventListener('change', onScaleFlagChange);

    $('#trs-reset')?.addEventListener('click', () => this.resetPreTrs());
  }

  _effectiveScale() {
    const p = this.preTrs;
    let sx = p.sx;
    let sy = p.sy;
    let sz = p.sz;
    if (p.scaleUniform) {
      if (!p.scaleAxisX) sx = p.su;
      if (!p.scaleAxisY) sy = p.su;
      if (!p.scaleAxisZ) sz = p.su;
    }
    return { sx, sy, sz };
  }

  _syncScaleUi() {
    const panel = $('#pre-trs-panel');
    const p = this.preTrs;
    if (panel) {
      panel.classList.toggle('scale-uni', !!p.scaleUniform);
      panel.classList.toggle('scale-x', !!p.scaleAxisX);
      panel.classList.toggle('scale-y', !!p.scaleAxisY);
      panel.classList.toggle('scale-z', !!p.scaleAxisZ);
    }
    if ($('#trs-uniform')) $('#trs-uniform').checked = !!p.scaleUniform;
    if ($('#trs-axis-x')) $('#trs-axis-x').checked = !!p.scaleAxisX;
    if ($('#trs-axis-y')) $('#trs-axis-y').checked = !!p.scaleAxisY;
    if ($('#trs-axis-z')) $('#trs-axis-z').checked = !!p.scaleAxisZ;
  }

  _syncScaleValueUi() {
    const p = this.preTrs;
    const eff = this._effectiveScale();
    const set = (id, v) => {
      const el = $(id);
      if (el) el.value = String(v);
    };
    set('#trs-su', p.su);
    set('#trs-su-r', p.su);
    set('#trs-sx', eff.sx);
    set('#trs-sx-r', eff.sx);
    set('#trs-sy', eff.sy);
    set('#trs-sy-r', eff.sy);
    set('#trs-sz', eff.sz);
    set('#trs-sz-r', eff.sz);
  }

  _applyPreTrsToPivot() {
    if (!this.euroPivot) return;
    const p = this.preTrs;
    const { sx, sy, sz } = this._effectiveScale();
    this.euroPivot.position.set(p.txMm / 1000, p.tyMm / 1000, p.tzMm / 1000);
    this.euroPivot.rotation.set(
      THREE.MathUtils.degToRad(p.rxDeg),
      THREE.MathUtils.degToRad(p.ryDeg),
      THREE.MathUtils.degToRad(p.rzDeg),
      'XYZ'
    );
    this.euroPivot.scale.set(sx, sy, sz);
    this.euroPivot.updateMatrixWorld(true);
    this._syncEuroMvOverlay();
  }

  _defaultPreTrs() {
    return {
      txMm: 0,
      tyMm: 0,
      tzMm: 0,
      rxDeg: 0,
      ryDeg: 0,
      rzDeg: 0,
      su: 1,
      sx: 1,
      sy: 1,
      sz: 1,
      scaleUniform: true,
      scaleAxisX: false,
      scaleAxisY: false,
      scaleAxisZ: false,
    };
  }

  /** 兼容旧版 uniform / 缺 su 字段 */
  _normalizePreTrs(raw) {
    const d = this._defaultPreTrs();
    if (!raw || typeof raw !== 'object') return { ...d };
    const p = { ...d, ...raw };
    if (raw.uniform != null && raw.scaleUniform == null) {
      p.scaleUniform = !!raw.uniform;
    }
    if (p.su == null || !Number.isFinite(Number(p.su))) {
      p.su = p.scaleUniform ? p.sx : 1;
    }
    for (const k of ['txMm', 'tyMm', 'tzMm', 'rxDeg', 'ryDeg', 'rzDeg', 'su', 'sx', 'sy', 'sz']) {
      p[k] = Number(p[k]);
      if (!Number.isFinite(p[k])) p[k] = d[k];
    }
    p.scaleUniform = !!p.scaleUniform;
    p.scaleAxisX = !!p.scaleAxisX;
    p.scaleAxisY = !!p.scaleAxisY;
    p.scaleAxisZ = !!p.scaleAxisZ;
    if (p.su <= 0) p.su = 1;
    if (p.sx <= 0) p.sx = 1;
    if (p.sy <= 0) p.sy = 1;
    if (p.sz <= 0) p.sz = 1;
    return p;
  }

  getPreTrs() {
    return { ...this.preTrs };
  }

  /** 从历史/导入恢复预变换并刷新 UI */
  applyPreTrs(raw) {
    this.preTrs = this._normalizePreTrs(raw);
    this._syncPreTrsUiFromState();
    this._applyPreTrsToPivot();
    this.lmEditor?.refreshMarkers?.();
    this._stampPreTrsInReport();
  }

  _syncPreTrsUiFromState() {
    const p = this.preTrs;
    const set = (id, v) => {
      const el = $(id);
      if (el) el.value = String(v);
    };
    set('#trs-tx', p.txMm);
    set('#trs-ty', p.tyMm);
    set('#trs-tz', p.tzMm);
    set('#trs-tx-r', p.txMm);
    set('#trs-ty-r', p.tyMm);
    set('#trs-tz-r', p.tzMm);
    set('#trs-rx', p.rxDeg);
    set('#trs-ry', p.ryDeg);
    set('#trs-rz', p.rzDeg);
    set('#trs-rx-r', p.rxDeg);
    set('#trs-ry-r', p.ryDeg);
    set('#trs-rz-r', p.rzDeg);
    this._syncScaleUi();
    this._syncScaleValueUi();
  }

  resetPreTrs() {
    this.preTrs = this._defaultPreTrs();
    this._syncPreTrsUiFromState();
    this._applyPreTrsToPivot();
    this.lmEditor?.refreshMarkers?.();
    this._stampPreTrsInReport();
    setStatus('已重置欧版预变换');
  }

  _stampPreTrsInReport() {
    if (!this.alignReport) return;
    this.alignReport.preTrs = { ...this.preTrs };
    this.alignReport.editedAt = new Date().toISOString();
  }

  _syncLandmarkSideVisibility(showG, showE) {
    this.lmEditor?.syncMarkerSideVisibility?.(!!showG, !!showE);
  }

  _applyEuroStaticOnly(only) {
    if (this.eyeOnlyMode) {
      this._syncEyeOnlyVisibility();
      this._syncOp?.();
      return;
    }
    for (const mesh of this.euroMeshes) {
      if (mesh.userData._overlayHiddenJunk) {
        mesh.visible = false;
        continue;
      }
      if (only) {
        mesh.visible = isEuroStaticName(mesh.name) || isEuroStaticName(mesh.parent?.name);
      } else {
        mesh.visible = true;
      }
    }
    if (only) {
      const any = this.euroMeshes.some((m) => m.visible);
      if (!any) {
        for (const mesh of this.euroMeshes) {
          if (!mesh.userData._overlayHiddenJunk) mesh.visible = true;
        }
        setStatus('未识别 Static 网格名，已回退显示全部欧版');
      }
    }
    this._syncOp?.();
  }

  resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const w = Math.max(1, Math.floor(parent.clientWidth));
    const h = Math.max(1, Math.floor(parent.clientHeight));
    this.renderer.setSize(w, h, true);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  _loop() {
    this.controls.update();
    if (this._shouldUseEuroMvOverlay()) {
      this.euroMvOverlay.pushCameraFromThree(this.camera, this.controls.target);
    }
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(() => this._loop());
  }

  /** Three.js 可见：PBR 虹膜 + 局部瞳孔黑盘；MV 叠层保持 PBR 导出 */
  _syncEuroThreeEyeDisplay() {
    const euroScene = this.euroRoot?.children?.[0];
    if (!euroScene) return;
    const { showEuro } = this.getModelShowFlags();
    const useMv =
      showEuro &&
      this._shouldUseEuroMvOverlay() &&
      this.euroMvOverlay?.isReady?.() &&
      this.euroMvOverlay?.isActive?.();
    if (!useMv && showEuro) {
      installIrisPupilHoleDiscs(euroScene);
    }
  }

  setView(mode) {
    this.viewMode = mode;
    $('#btn-front').classList.toggle('is-active', mode === 'front');
    $('#btn-side').classList.toggle('is-active', mode === 'side');
    const target = new THREE.Vector3(0, 0.15, 0);
    this.controls.target.copy(target);
    if (mode === 'side') {
      this.camera.position.set(0.55, 0.16, 0.02);
    } else {
      this.camera.position.set(0.02, 0.16, 0.55);
    }
    this.controls.update();
  }

  frameHead() {
    const box = new THREE.Box3();
    const { showGnm, showEuro } = this.getModelShowFlags();
    if (showGnm) box.expandByObject(this.gnmRoot);
    if (showEuro) box.expandByObject(this.euroPivot);
    if (box.isEmpty()) return;
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const maxDim = Math.max(size.x, size.y, size.z, 0.01);
    this.controls.target.copy(center);
    this.controls.minDistance = maxDim * 0.35;
    this.controls.maxDistance = maxDim * 8;
    this.setView(this.viewMode || 'front');
    // re-place camera relative to center
    if (this.viewMode === 'side') {
      this.camera.position.set(center.x + maxDim * 1.6, center.y, center.z);
    } else {
      this.camera.position.set(center.x, center.y, center.z + maxDim * 1.6);
    }
    this.controls.update();
    this._syncEuroThreeEyeDisplay();
    if (this._shouldUseEuroMvOverlay() && this.euroMvOverlay?.isReady?.()) {
      this.euroMvOverlay.pushCameraFromThree(this.camera, this.controls.target);
    }
  }

  /** 眼球模式：相机对准双眼区域（切换 GNM/欧版时取景不变，避免「对齐了但看起来跳位」） */
  frameEyes() {
    const box = new THREE.Box3();
    const gh = this.gnmHead;
    const snap = this._eyeAlignSnapshot;
    const pad = 0.004;

    if (this.eyeOnlyMode && snap?.L?.dstCenter && snap?.R?.dstCenter) {
      // 已眼球重合：按 GNM 目标球心+外径取景，两侧网格视觉中心一致
      for (const side of ['L', 'R']) {
        const spec = snap[side];
        if (!spec?.dstCenter) continue;
        const r = Math.max(spec.dstRadius || 0.008, MIN_EYE_FRAME_R);
        const [x, y, z] = spec.dstCenter;
        box.expandByPoint(new THREE.Vector3(x - r - pad, y - r - pad, z - r - pad));
        box.expandByPoint(new THREE.Vector3(x + r + pad, y + r + pad, z + r + pad));
      }
    } else if (this.eyeOnlyMode) {
      // 未重合：双侧眼球并集取景，切换时也不跳
      if (gh?.eyeInnerMesh) box.expandByObject(gh.eyeInnerMesh);
      if (gh?.eyeScleraMesh) box.expandByObject(gh.eyeScleraMesh);
      for (const { mesh } of this._euroEyeCache || []) {
        if (mesh) box.expandByObject(mesh);
      }
    } else {
      if (gh?.eyeInnerMesh?.visible) box.expandByObject(gh.eyeInnerMesh);
      if (gh?.eyeScleraMesh?.visible) box.expandByObject(gh.eyeScleraMesh);
      for (const { mesh } of this._euroEyeCache || []) {
        if (mesh?.visible) box.expandByObject(mesh);
      }
    }

    if (box.isEmpty() && this.gnmModel && this.gnmPositionsNative && this.norm) {
      const tmp = new THREE.Vector3();
      for (const side of ['L', 'R']) {
        const spec = snap?.[side];
        if (spec?.dstCenter) {
          tmp.set(spec.dstCenter[0], spec.dstCenter[1], spec.dstCenter[2]);
          box.expandByPoint(tmp);
        }
      }
    }
    if (box.isEmpty()) {
      this.frameHead();
      return;
    }
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const maxDim = Math.max(size.x, size.y, size.z, 0.004);
    this.controls.target.copy(center);
    this.controls.minDistance = maxDim * 0.35;
    this.controls.maxDistance = maxDim * 8;
    this.setView(this.viewMode || 'front');
    if (this.viewMode === 'side') {
      this.camera.position.set(center.x + maxDim * 2.2, center.y, center.z);
    } else {
      this.camera.position.set(center.x, center.y, center.z + maxDim * 2.2);
    }
    this.controls.update();
    this._syncEuroThreeEyeDisplay();
  }

  /** 导出烘焙 GLB + map.json（供头模工坊加载） */
  async exportBakedPack() {
    if (!this.euroPivot?.children?.length) {
      throw new Error('欧版未就绪');
    }
    if (!this.norm) {
      throw new Error('GNM normalize 未就绪');
    }
    if (!this._euroWarped) {
      throw new Error('请先点「拧」完成贴形后再导出烘焙包');
    }
    const warpSnapshot = this.getWarpSnapshotForSave?.() || this._lastWarpSnapshot;
    const note =
      ($('#lm-hist-note')?.value || '').trim() ||
      (() => {
        const opt = $('#lm-hist-select')?.selectedOptions?.[0];
        const t = opt?.textContent || '';
        const m = t.match(/·\s*([^·]+?)\s*·\s*\d+点/);
        return m?.[1]?.trim() || '';
      })() ||
      'euro_baked';
    const points = this.lmEditor?.points || [];
    await exportBakedEuroPack({
      euroPivot: this.euroPivot,
      points,
      norm: this.norm,
      warpSnapshot,
      note,
      requireWarp: true,
      onStatus: setStatus,
    });
  }

  downloadAlignJson() {
    if (!this.alignReport) return;
    const blob = new Blob([JSON.stringify(this.alignReport, null, 2)], {
      type: 'application/json',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'align_euro_to_gnm_v1.json';
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /** 当前欧版内层对齐（euroRoot）快照：存历史用，避免「只挪路标」加载时被迫重算改姿态 */
  getAlignSnapshot() {
    if (!this.euroRoot) return null;
    this.euroRoot.updateMatrix();
    const matrix4_columnMajor = this.euroRoot.matrix.toArray();
    const report = this.alignReport || {};
    return {
      matrix4_columnMajor,
      usedIds: report.usedIds || null,
      summary: report.summary || null,
      umeyama: report.umeyama || null,
      perPoint: report.perPoint || null,
    };
  }

  /** 恢复历史中的对齐矩阵；成功返回 true */
  applyAlignSnapshot(snap) {
    if (!snap?.matrix4_columnMajor?.length) return false;
    this._applyAlignment(null, {
      matrix4_columnMajor: snap.matrix4_columnMajor,
      usedIds: snap.usedIds,
      summary: snap.summary,
      umeyama: snap.umeyama,
      perPoint: snap.perPoint,
    });
    this.lmEditor?.refreshMarkers?.();
    return true;
  }

  /** 将 Umeyama+normalize 矩阵应用到 euroRoot，并合并 alignReport */
  _applyAlignment(sim, patch = {}) {
    const elements =
      patch.matrix4_columnMajor ||
      (sim && this.norm ? composeNormalizeAfterSimilarity(sim, this.norm) : null);
    if (!elements) return;
    const mat = new THREE.Matrix4().fromArray(elements);
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    mat.decompose(pos, quat, scl);
    this.euroRoot.position.copy(pos);
    this.euroRoot.quaternion.copy(quat);
    this.euroRoot.scale.copy(scl);
    this.euroRoot.updateMatrixWorld(true);
    // 预变换在 euroPivot，重算不对它清零
    this._applyPreTrsToPivot();
    if (this.alignReport) {
      const umeyamaFromSim = sim
        ? {
            scale: sim.scale,
            R: sim.R,
            t: sim.t,
            rmsM: sim.rms,
            maxErrM: sim.maxErr,
          }
        : null;
      Object.assign(this.alignReport, patch, {
        umeyama: patch.umeyama || umeyamaFromSim || this.alignReport.umeyama,
        matrix4_columnMajor: elements,
        usedIds: patch.usedIds || this.alignReport.usedIds,
        summary: patch.summary || this.alignReport.summary,
        perPoint: patch.perPoint || this.alignReport.perPoint,
        preTrs: { ...this.preTrs },
        editedAt: new Date().toISOString(),
      });
    }
  }

  async run() {
    setLoadingTitle('加载 GNM 基底…');
    setLoadingDetail(`约 35MB · ${absUrl(GNM_URL)}`);
    setStatus('加载 GNM…');
    const buf = await fetchModelBuffer(GNM_URL, (p, received, total) => {
      setProgress(p * 0.55);
      if (total > 0) {
        setLoadingDetail(`GNM ${fmtMb(received)} / ${fmtMb(total)} MB`);
      } else if (p >= 1) {
        setLoadingDetail('GNM 已就绪');
      }
    });
    const { meta, sections } = parseContainer(buf);
    const model = new GNMHeadModel(meta, sections);
    model.resetIdentity();
    model.resetExpression();
    model.resetPose();
    const raw = new Float32Array(model.numVertices * 3);
    model.computeVertices(raw);
    this.gnmModel = model;
    this.gnmPositionsNative = new Float32Array(raw);

    setLoadingTitle('采样 GNM 路标…');
    setStatus('采样 GNM 路标…');
    const { points: gnmLmNative } = sampleGnmFarkasLandmarks(raw, model.componentId);

    setLoadingTitle('加载欧版路标…');
    setStatus('加载欧版路标…');
    const [euroRest, farkas] = await Promise.all([
      fetch(absUrl(EURO_REST_URL)).then((r) => {
        if (!r.ok) throw new Error(`无法加载 euro_morph_rest.json · HTTP ${r.status}`);
        return r.json();
      }),
      fetch(absUrl(FARKAS_URL)).then((r) => (r.ok ? r.json() : null)),
    ]);
    const euroLm = euroRest.points || {};

    const paired = pairLandmarks(euroLm, gnmLmNative, ALIGN_CORE_IDS);
    if (paired.src.length < 3) {
      throw new Error(`可配对路标不足：${paired.used.join(',')}`);
    }

    setLoadingTitle(`Umeyama 对齐（${paired.used.length} 点）…`);
    setStatus(`Umeyama 对齐（${paired.used.length} 点）…`);
    const sim = umeyama(paired.src, paired.dst, paired.weights);

    // Normalize GNM to 30cm bottom-center
    const disp = new Float32Array(raw);
    const norm = computeBottomCenterNormalize(disp, TARGET_HEIGHT_M);
    applyNormalizePositions(disp, norm);
    this.norm = norm;

    // Build GNM mesh：身体 + 虹膜瞳孔 + 半透明巩膜（模拟角膜透光）
    const gnmHead = createGnmHeadGroup(model, { positions: disp, dynamic: false });
    for (const part of gnmHead.parts) {
      const mats = Array.isArray(part.mesh.material) ? part.mesh.material : [part.mesh.material];
      for (const m of mats) stampMaterialBase(m);
    }
    this.gnmHead = gnmHead;
    this.gnmRoot.add(gnmHead.root);

    // Errors after full pipeline (display space)
    const perPoint = paired.used.map((id, i) => {
      const g = applyNormalizePoint(gnmLmNative[id], norm);
      const e = applyNormalizePoint(applySimilarity(euroLm[id], sim), norm);
      const dx = e[0] - g[0],
        dy = e[1] - g[1],
        dz = e[2] - g[2];
      const err = Math.hypot(dx, dy, dz);
      return {
        id,
        errM: err,
        errMm: err * 1000,
        gnm: g,
        euroAligned: e,
        weight: paired.weights[i],
      };
    });
    const rmsMm =
      Math.sqrt(perPoint.reduce((s, p) => s + p.errM * p.errM, 0) / perPoint.length) * 1000;
    const maxMm = Math.max(...perPoint.map((p) => p.errMm));

    setLoadingTitle('加载欧版肌肉 GLB…');
    setLoadingDetail(absUrl(EURO_GLB_URL));
    setStatus('加载欧版 GLB…');
    const loader = new GLTFLoader();
    const draco = new DRACOLoader();
    const dracoPath = new URL(DRACO_DECODER_PATH, window.location.href).href;
    draco.setDecoderPath(dracoPath.endsWith('/') ? dracoPath : `${dracoPath}/`);
    loader.setDRACOLoader(draco);
    const gltf = await new Promise((resolve, reject) => {
      loader.load(
        absUrl(EURO_GLB_URL),
        resolve,
        (ev) => {
          if (ev.total) {
            setProgress(0.55 + 0.4 * (ev.loaded / ev.total));
            setLoadingDetail(`欧版 ${fmtMb(ev.loaded)} / ${fmtMb(ev.total)} MB`);
          }
        },
        (err) => reject(err?.message ? err : new Error(`欧版 GLB 加载失败 · ${absUrl(EURO_GLB_URL)}`))
      );
    });
    draco.dispose();

    const euroScene = gltf.scene;
    euroScene.updateMatrixWorld(true);
    // display5：保持 GLB 原材质（对齐 Portrait_c / GLB 管理器），仅 prepareEuroScene 隐藏 Melns
    this.euroMeshes = [];
    euroScene.traverse((obj) => {
      if (!obj.isMesh) return;
      this.euroMeshes.push(obj);
      if (shouldSkipEuroWarp(obj)) obj.userData._skipEuroWarp = true;
      assignEuroRenderLayer(obj);
    });
    prepareEuroScene(euroScene, { pupilHoleDiscs: false });

    this.euroWarpCache = cacheEuroMeshes(this.euroPivot);

    // Apply composed matrix on euroRoot: normalize ∘ umeyama
    const elements = composeNormalizeAfterSimilarity(sim, norm);
    this.euroRoot.clear();
    this.euroRoot.add(euroScene);
    this._euroEyeCache = cacheEuroEyeMeshes(euroScene);
    this._applyAlignment(sim, { matrix4_columnMajor: elements });

    this.alignReport = {
      version: 1,
      createdAt: new Date().toISOString(),
      note: 'Euro muscle (参考用_欧洲人头部肌肉_…_opt.glb) → GNM neutral via weighted Umeyama; then 30cm bottom-center normalize.',
      euroGlb: EURO_GLB_URL,
      targetHeightM: TARGET_HEIGHT_M,
      coreIds: ALIGN_CORE_IDS,
      usedIds: paired.used,
      umeyama: {
        scale: sim.scale,
        R: sim.R,
        t: sim.t,
        rmsM: sim.rms,
        maxErrM: sim.maxErr,
      },
      normalize: {
        scale: norm.scale,
        offset: norm.offset,
        heightCm: norm.heightCm,
      },
      matrix4_columnMajor: elements,
      preTrs: { ...this.preTrs },
      perPoint,
      summary: {
        nPoints: perPoint.length,
        rmsMm,
        maxMm,
      },
      gnmLandmarksNative: gnmLmNative,
      euroLandmarksNative: Object.fromEntries(
        paired.used.map((id) => [id, euroLm[id]])
      ),
      farkasNote: farkas?.notes || null,
    };

    this.lmEditor.loadFromPairs({
      gnmNative: gnmLmNative,
      euroLocal: Object.fromEntries(paired.used.map((id) => [id, euroLm[id]])),
      usedIds: paired.used,
      weights: paired.weights,
    });

    this._syncOp?.();
    this.frameHead();
    setProgress(1);
    $('#loading').classList.add('hidden');
    const statusMsg = `对齐 ${perPoint.length} 点 · RMS ${rmsMm.toFixed(1)} mm · 最大 ${maxMm.toFixed(1)} mm`;
    setStatus(statusMsg);
    this.lmEditor._lastStatus = statusMsg;

    console.log('[align-overlay]', this.alignReport.summary);
    await this.applyBootQuery();
  }

  getHeadCenterWorld() {
    const box = new THREE.Box3();
    if (this.gnmRoot) box.expandByObject(this.gnmRoot);
    if (this.euroPivot) box.expandByObject(this.euroPivot);
    if (box.isEmpty()) return new THREE.Vector3(0, 0.15, 0);
    return box.getCenter(new THREE.Vector3());
  }

  /** GNM native → 贴到显示网格最近顶点 → 再逆变换回 native，并略抬出表面 */
  snapGnmNative(nativeXYZ) {
    const norm = this.norm;
    if (!norm || !nativeXYZ) return nativeXYZ?.slice?.(0, 3) || [0, 0, 0];
    const mesh = this.gnmRoot?.children?.[0];
    if (!mesh?.geometry?.attributes?.position) return nativeXYZ.slice(0, 3);
    const target = new THREE.Vector3(
      nativeXYZ[0] * norm.scale - norm.offset[0],
      nativeXYZ[1] * norm.scale - norm.offset[1],
      nativeXYZ[2] * norm.scale - norm.offset[2]
    );
    const pos = mesh.geometry.attributes.position;
    const v = new THREE.Vector3();
    let best = null;
    let bestD = Infinity;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const d = v.distanceToSquared(target);
      if (d < bestD) {
        bestD = d;
        best = v.clone();
      }
    }
    if (!best) return nativeXYZ.slice(0, 3);
    // 沿「头中心 → 点」方向略抬出，避免埋进壳内
    const center = this.getHeadCenterWorld();
    const out = best.clone().sub(center);
    if (out.lengthSq() > 1e-12) {
      out.normalize().multiplyScalar(0.0016);
      best.add(out);
    }
    return [
      (best.x + norm.offset[0]) / norm.scale,
      (best.y + norm.offset[1]) / norm.scale,
      (best.z + norm.offset[2]) / norm.scale,
    ];
  }

  /** 欧版 GLB 局部坐标 → 贴到 euroRoot 局部最近顶点，并略抬出 */
  snapEuroLocal(localXYZ) {
    if (!localXYZ || !this.euroRoot) return localXYZ?.slice?.(0, 3) || [0, 0, 0];
    const target = new THREE.Vector3(localXYZ[0], localXYZ[1], localXYZ[2]);
    const v = new THREE.Vector3();
    let best = null;
    let bestD = Infinity;
    this.euroRoot.updateMatrixWorld(true);
    const invRoot = new THREE.Matrix4().copy(this.euroRoot.matrixWorld).invert();
    const toLocal = new THREE.Matrix4();
    this.euroRoot.traverse((obj) => {
      if (!obj.isMesh || !obj.geometry?.attributes?.position) return;
      if (obj.userData?._overlayHiddenJunk) return;
      toLocal.multiplyMatrices(invRoot, obj.matrixWorld);
      const pos = obj.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(toLocal);
        const d = v.distanceToSquared(target);
        if (d < bestD) {
          bestD = d;
          best = [v.x, v.y, v.z];
        }
      }
    });
    if (!best) return localXYZ.slice(0, 3);
    const centerLocal = this.euroRoot.worldToLocal(this.getHeadCenterWorld().clone());
    const bx = best[0] - centerLocal.x;
    const by = best[1] - centerLocal.y;
    const bz = best[2] - centerLocal.z;
    const len = Math.hypot(bx, by, bz) || 1;
    const lift = 0.0016;
    return [best[0] + (bx / len) * lift, best[1] + (by / len) * lift, best[2] + (bz / len) * lift];
  }

  /** 欧版网格恢复为 GLB 初始形态（撤销拧形） */
  restoreEuroMesh() {
    if (!this.euroPivot) return;
    this.euroWarpCache = cacheEuroMeshes(this.euroPivot);
    if (this.euroWarpCache.length) restoreEuroRest(this.euroWarpCache);
    this._euroWarped = false;
    this._lastWarpSnapshot = null;
    this._reprepareEuroAfterWarp();
    this._replayEuroEyeAlign();
    this._syncEuroMvOverlay();
  }

  getEyeAlignSnapshotForSave() {
    return cloneEyeAlignSnapshot(this._eyeAlignSnapshot);
  }

  /** 从历史或导入恢复眼球对齐（v5 整球相似变换；旧版快照自动重算） */
  applyEyeAlignSnapshot(snap) {
    if (!snap) {
      this._eyeAlignSnapshot = null;
      return { ok: false, reason: 'empty' };
    }
    const cloned = cloneEyeAlignSnapshot(snap);
    if (!cloned) return { ok: false, reason: 'empty' };
    if ((cloned.version || 0) < 6) {
      return this.applyEuroEyeAlign();
    }
    this._eyeAlignSnapshot = cloned;
    const result = this._replayEuroEyeAlign();
    if (result.ok) {
      this._upsertLensCenterLandmarks(cloned);
    }
    return result;
  }

  _replayEuroEyeAlign() {
    if (!this._eyeAlignSnapshot || !this._euroEyeCache?.length || !this.euroRoot) {
      return { ok: false, reason: 'no-snapshot' };
    }
    const result = applyEuroEyeAlignFromSnapshot(this._euroEyeCache, this._eyeAlignSnapshot, this.euroRoot);
    if (result.ok) {
      this._reprepareEuroAfterWarp();
      this._syncEuroMvOverlay();
    }
    return result;
  }

  _upsertLensCenterLandmarks(snapshot) {
    if (!snapshot || !this.lmEditor || !this.norm) return;
    const norm = this.norm;
    this.euroRoot.updateMatrixWorld(true);
    const tmp = new THREE.Vector3();
    for (const side of ['L', 'R']) {
      const spec = snapshot[side];
      if (!spec?.dstCenter) continue;
      const pairKey = `晶状体中心${side}`;
      const name = pairKey;
      const gnmPos = inverseNormalizePoint(spec.dstCenter, norm);
      tmp.set(spec.dstCenter[0], spec.dstCenter[1], spec.dstCenter[2]);
      this.euroRoot.worldToLocal(tmp);
      const euroPos = [tmp.x, tmp.y, tmp.z];
      let gnmPt = this.lmEditor.points.find((p) => p.pairKey === pairKey && p.side === 'gnm');
      let euroPt = this.lmEditor.points.find((p) => p.pairKey === pairKey && p.side === 'euro');
      if (!gnmPt) {
        gnmPt = {
          uid: `lm_eye_${pairKey}_g_${Date.now().toString(36)}`,
          name,
          side: 'gnm',
          pos: gnmPos,
          pairKey,
          weight: 1,
        };
        this.lmEditor.points.push(gnmPt);
      } else {
        gnmPt.pos = gnmPos;
        gnmPt.name = name;
      }
      if (!euroPt) {
        euroPt = {
          uid: `lm_eye_${pairKey}_e_${Date.now().toString(36)}`,
          name,
          side: 'euro',
          pos: euroPos,
          pairKey,
          weight: 1,
        };
        this.lmEditor.points.push(euroPt);
      } else {
        euroPt.pos = euroPos;
        euroPt.name = name;
      }
    }
    this.lmEditor.refreshMarkers();
    this.lmEditor.refreshList();
  }

  /** 按 GNM 中性眼球自动重合欧版虹膜/晶状体，并生成晶状体中心路标 */
  applyEuroEyeAlign() {
    if (!this.gnmModel || !this.gnmPositionsNative || !this.norm) {
      setStatus('GNM 未就绪，无法眼球重合');
      return { ok: false };
    }
    if (!this._euroEyeCache?.length || !this.euroRoot) {
      setStatus('欧版眼球网格未就绪');
      return { ok: false };
    }

    const gnmFrames = sampleGnmEyeFrames(this.gnmModel, this.gnmPositionsNative, this.norm);
    restoreEuroEyeRest(this._euroEyeCache);
    const euroFrames = sampleEuroEyeFrames(this.euroRoot);
    const built = buildEyeAlignSnapshot(gnmFrames, euroFrames);
    if (!built.ok || !built.snapshot) {
      setStatus(`眼球重合失败：${built.warnings?.join(' · ') || built.reason || '采样不足'}`);
      return { ok: false };
    }

    this._eyeAlignSnapshot = cloneEyeAlignSnapshot(built.snapshot);
    const applied = applyEuroEyeAlignVerts(this._euroEyeCache, this._eyeAlignSnapshot, this.euroRoot);
    if (!applied.ok) {
      setStatus('眼球重合：顶点写入失败');
      return { ok: false };
    }

    this._upsertLensCenterLandmarks(this._eyeAlignSnapshot);
    this._reprepareEuroAfterWarp();
    this._syncEuroMvOverlay();

    const fmt = (n, d = 1) => Number(n).toFixed(d);
    const l = built.snapshot.L;
    const r = built.snapshot.R;
    const surf = measureEyeSurfaceGapMm(
      this.gnmModel,
      this.gnmPositionsNative,
      this.norm,
      this.euroRoot
    );
    const warn = built.warnings?.length ? ` · ${built.warnings.join(' · ')}` : '';
    const surfHint =
      surf.L && surf.R
        ? ` · 复核 中心L${fmt(surf.L.centerDistMm)}mm R${fmt(surf.R.centerDistMm)}mm` +
          ` · 半径差L${fmt(surf.L.radiusDiffMm)}mm R${fmt(surf.R.radiusDiffMm)}mm`
        : '';
    const scaleHint = ` · 缩放 L${fmt(l.scale, 3)} R${fmt(r.scale, 3)}`;
    const msg =
      `眼球重合（巩膜外径缩放+平移）· 左 残差${fmt(l.residualMm)}mm · 右 残差${fmt(r.residualMm)}mm` +
      scaleHint +
      surfHint +
      ` · 已生成晶状体中心L/R${warn}`;
    setStatus(msg);
    this.lmEditor._lastStatus = msg;
    return { ok: true, snapshot: this._eyeAlignSnapshot };
  }

  _cloneWarpSnapshot(snap) {
    if (!snap) return null;
    return {
      version: snap.version || 1,
      used: (snap.used || []).slice(),
      src: (snap.src || []).map((p) => p.slice(0, 3)),
      dst: (snap.dst || []).map((p) => p.slice(0, 3)),
      nPairs: snap.nPairs ?? snap.src?.length ?? 0,
      landmarkResidualMm: snap.landmarkResidualMm,
      pairGapMm: snap.pairGapMm,
    };
  }

  _freezeWarpPairs(pairs) {
    return {
      used: pairs.used.slice(),
      src: pairs.src.map((p) => [p[0], p[1], p[2]]),
      dst: pairs.dst.map((p) => [p[0], p[1], p[2]]),
    };
  }

  _makeWarpSnapshot(frozen, result) {
    return {
      version: 1,
      used: frozen.used.slice(),
      src: frozen.src.map((p) => p.slice(0, 3)),
      dst: frozen.dst.map((p) => p.slice(0, 3)),
      nPairs: frozen.src.length,
      landmarkResidualMm: result.landmarkResidualMm,
      pairGapMm: this._warpSnapshotGapMm(frozen),
    };
  }

  /** 拧形控点 src→dst 最大间距（mm）；过小说明快照无效（粉黄已重合后误存） */
  _warpSnapshotGapMm(snap) {
    if (!snap?.src?.length) return 0;
    let max = 0;
    for (let i = 0; i < snap.src.length; i++) {
      const s = snap.src[i];
      const d = snap.dst[i];
      if (!d) continue;
      const g = Math.hypot(s[0] - d[0], s[1] - d[1], s[2] - d[2]) * 1000;
      if (g > max) max = g;
    }
    return max;
  }

  /** 存历史用：返回拧当下缓存的 TPS 控点，不改动当前网格 */
  getWarpSnapshotForSave() {
    if (!this._euroWarped || !this._lastWarpSnapshot) return null;
    return this._cloneWarpSnapshot(this._lastWarpSnapshot);
  }

  /** 从历史 warpSnapshot 恢复拧形（会先回到 rest 再变形） */
  applyWarpSnapshot(snap) {
    if (!snap?.src?.length || snap.src.length < 4 || !this.euroPivot) {
      return { ok: false, reason: 'invalid-snapshot' };
    }
    const gap = this._warpSnapshotGapMm(snap);
    if (gap < 0.05) {
      return { ok: false, reason: 'degenerate-snapshot', gapMm: gap };
    }
    this.euroWarpCache = cacheEuroMeshes(this.euroPivot);
    if (!this.euroWarpCache.length) return { ok: false, reason: 'no-meshes' };
    restoreEuroRest(this.euroWarpCache);
    const result = applyEuroWarpTps(this.euroWarpCache, snap.src, snap.dst);
    if (result.ok) {
      this._euroWarped = true;
      this._lastWarpSnapshot = this._cloneWarpSnapshot(snap);
      this.lmEditor.syncEuroLandmarksToWarpTargets(snap.used);
    }
    this._reprepareEuroAfterWarp();
    this._replayEuroEyeAlign();
    return result;
  }

  _reprepareEuroAfterWarp() {
    const euroScene = this.euroRoot?.children?.[0];
    if (euroScene) prepareEuroScene(euroScene);
    this._syncOp?.();
    this._syncEuroThreeEyeDisplay();
  }

  /** 按当前粉黄路标，将欧版网格 TPS 拧向 GNM 形态 */
  applyLandmarkWarp() {
    const pairs = this.lmEditor.collectWarpPairsWorld();
    if (pairs.src.length < 4) {
      setStatus(`拧需要至少 4 对已配对的粉黄路标（当前 ${pairs.src.length}）`);
      return;
    }
    if (!this.euroPivot) {
      setStatus('欧版模型未就绪');
      return;
    }
    this.euroWarpCache = cacheEuroMeshes(this.euroPivot);
    if (!this.euroWarpCache.length) {
      setStatus('未找到可拧形的欧版网格');
      return;
    }
    const frozen = this._freezeWarpPairs(pairs);
    restoreEuroRest(this.euroWarpCache);
    const result = applyEuroWarpTps(this.euroWarpCache, frozen.src, frozen.dst);
    if (!result.ok) {
      setStatus(`拧失败：${result.reason || '未知错误'}`);
      return;
    }
    this._lastWarpSnapshot = this._makeWarpSnapshot(frozen, result);
    this._euroWarped = true;
    this.lmEditor.syncEuroLandmarksToWarpTargets(pairs.used);
    this.lmEditor.refreshMarkers();
    this.lmEditor.refreshList();
    const msg = `拧 · ${result.nPairs} 对路标 · ${result.nVerts} 顶点 · 控点残差 ${result.landmarkResidualMm.toFixed(1)} mm · 粉黄已重合`;
    const weak =
      this._lastWarpSnapshot.pairGapMm != null && this._lastWarpSnapshot.pairGapMm < 0.05;
    this.lmEditor._lastStatus = weak
      ? `${msg}（粉黄几乎未分离，拧形很弱；请先挪动粉点再拧）`
      : msg;
    setStatus(this.lmEditor._lastStatus);
    this._replayEuroEyeAlign();
  }

  async applyBootQuery() {
    const q = new URLSearchParams(location.search);
    const loadHist = (q.get('loadHist') || '').trim();
    const retuneKeep = (q.get('retuneKeep') || '').trim();
    if (loadHist) {
      try {
        const index = await this.lmEditor._fetchHistoryIndex();
        const versions = index.versions || [];
        const hitMeta =
          versions.find((v) => (v.note || '') === loadHist) ||
          versions.find((v) => (v.note || '').includes(loadHist));
        if (!hitMeta) {
          setStatus(`未找到历史备注含「${loadHist}」的版本`);
        } else {
          const hit = await this.lmEditor._fetchHistoryEntry(hitMeta);
          const msg = await this.lmEditor.applyHistoryEntry(hit, {
            statusPrefix: `已按 URL 加载历史「${hit.note || loadHist}」`,
          });
          this.lmEditor._lastStatus = msg;
          const sel = $('#lm-hist-select');
          if (sel) sel.value = hitMeta.id;
        }
      } catch (e) {
        setStatus(`加载历史失败：${e.message || e}`);
      }
    } else {
      try {
        await this.lmEditor.loadLatestHistory();
      } catch (e) {
        setStatus(`自动加载历史失败：${e.message || e}`);
      }
    }
    if (retuneKeep) {
      const keep = retuneKeep.split(/[,+\s]+/).filter(Boolean);
      await this.lmEditor.retuneOtherLandmarks(keep);
    }
  }
}

const app = new OverlayApp();
app.displayRev = DISPLAY_REV;
window.__alignOverlayApp = app;
app.run().then(() => {
  const el = document.querySelector('#build-rev');
  if (el) el.textContent = `构建 ${DISPLAY_REV}`;
}).catch((err) => {
  console.error('[align-overlay]', err);
  showLoadError(err, '资源加载或对齐计算失败');
});
