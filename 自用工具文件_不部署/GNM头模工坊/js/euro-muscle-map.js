/**
 * 烘焙欧版肌肉 + 映射表：中性显示烘焙 GLB；滑条驱动 ΔP → Q' + TPS。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import {
  cacheEuroMeshes,
  applyLandmarkWarp as applyEuroWarpTps,
  restoreEuroRest,
} from '../align-overlay/js/euro-warp.js';
import {
  cacheEuroEyeMeshes,
  restoreEuroEyeRest,
  sampleGnmEyeFrames,
  sampleEuroEyeFrames,
  buildEyeAlignSnapshot,
  applyEuroEyeAlign as applyEuroEyeAlignVerts,
} from '../align-overlay/js/euro-eye-align.js';
import { computeBottomCenterNormalize } from '../align-overlay/js/procrustes.js';
import { TARGET_HEIGHT_M } from './viewport.js';
import {
  prepareEuroScene,
  prepareEuroMaterials,
  shouldSkipEuroWarp,
  meshHasEuroEyeName,
  isEuroLensMeshName,
  isEuroJunkOverlayName,
  prepareEuroMeshesForExport,
  cloneMaterialForExport,
  healOpaqueBlendMaterial,
} from '../align-overlay/js/euro-render-prep.js?v=20260829-display9';

const DRACO_DECODER_PATH = '../../../docs/js/three_164/examples/jsm/libs/draco/gltf/';
const NEUTRAL_EPS_M = 0.00015;

function nearestSkinVertex(positions, n, componentId, target, skinComp = 0) {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < n; i++) {
    if (componentId && componentId[i] !== skinComp) continue;
    const dx = positions[i * 3] - target[0];
    const dy = positions[i * 3 + 1] - target[1];
    const dz = positions[i * 3 + 2] - target[2];
    const d = dx * dx + dy * dy + dz * dz;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function setGroupOpacity(root, opacity) {
  const o = Math.max(0, Math.min(1, opacity));
  root.visible = o > 0.005;
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const label = `${obj.name || ''} ${obj.parent?.name || ''}`;
    if (meshHasEuroEyeName(obj) || isEuroLensMeshName(label)) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) {
        if (!m.userData._muscleMapBase) {
          m.userData._muscleMapBase = {
            transparent: !!m.transparent,
            opacity: m.opacity == null ? 1 : m.opacity,
            depthWrite: m.depthWrite !== false,
          };
        }
        const base = m.userData._muscleMapBase;
        m.transparent = base.transparent;
        m.opacity = base.opacity;
        m.depthWrite = base.depthWrite;
        m.needsUpdate = true;
      }
      return;
    }
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of mats) {
      if (!m.userData._muscleMapBase) {
        m.userData._muscleMapBase = {
          transparent: !!m.transparent,
          opacity: m.opacity == null ? 1 : m.opacity,
          depthWrite: m.depthWrite !== false,
        };
      }
      const base = m.userData._muscleMapBase;
      if (o >= 0.985) {
        m.transparent = base.transparent;
        m.opacity = base.opacity;
        m.depthWrite = base.depthWrite;
      } else {
        m.transparent = true;
        m.opacity = o * base.opacity;
        m.depthWrite = o > 0.15;
      }
      m.needsUpdate = true;
    }
  });
}

function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** 从 GLB 二进制读取嵌入的 euroMuscleMap */
export function peekMuscleMapFromGlb(arrayBuffer) {
  const data = new DataView(
    arrayBuffer instanceof ArrayBuffer ? arrayBuffer : arrayBuffer.buffer,
    arrayBuffer.byteOffset || 0,
    arrayBuffer.byteLength || arrayBuffer.byteLength
  );
  if (data.getUint32(0, true) !== 0x46546c67) return null;
  let offset = 12;
  while (offset + 8 <= data.byteLength) {
    const chunkLen = data.getUint32(offset, true);
    const chunkType = data.getUint32(offset + 4, true);
    if (chunkType === 0x4e4f534a) {
      const bytes = new Uint8Array(
        arrayBuffer instanceof ArrayBuffer ? arrayBuffer : arrayBuffer.buffer,
        (arrayBuffer.byteOffset || 0) + offset + 8,
        chunkLen
      );
      const text = new TextDecoder().decode(bytes).replace(/\0+$/, '');
      try {
        const json = JSON.parse(text);
        return json?.asset?.extras?.paintingtools?.euroMuscleMap || null;
      } catch {
        return null;
      }
    }
    offset += 8 + chunkLen;
  }
  return null;
}

/**
 * 烘焙包缺少映射表时的用户提示（区分：未选 map / 已选但无效 / 自动恢复缓存）。
 * @param {{ mapFileSelected?: boolean, glbFileName?: string, fromCache?: boolean }} [opts]
 */
export function describeMissingBakeMapError(opts = {}) {
  const { mapFileSelected, glbFileName, fromCache } = opts;
  if (fromCache) {
    return (
      '上次缓存的烘焙包缺少映射表。\n\n' +
      '请点「加载烘焙包」，在同一次选择中同时选中 GLB 与配套的 *_map.json（按住 Ctrl 多选）。'
    );
  }
  if (mapFileSelected) {
    return '所选 map.json 无法识别为映射表，请确认文件完整，且与 GLB 来自同一次「对齐叠显」烘焙导出。';
  }
  const name = glbFileName ? `「${glbFileName}」` : '该 GLB';
  return (
    `${name} 内未包含映射表。\n\n` +
    '请重新点「加载烘焙包」，在同一次文件选择中同时选中：\n' +
    '· *_baked.glb\n' +
    '· 配套的 *_map.json（按住 Ctrl 多选两个文件）\n\n' +
    '若从「对齐叠显」导出，会同时下载这两个文件；改色后导出的 GLB 需配原烘焙包的 map.json。'
  );
}

export class EuroMuscleMap {
  /**
   * @param {object} opts
   * @param {THREE.Scene} opts.scene
   * @param {() => Float32Array|null} opts.getRawPositions
   * @param {() => number} opts.getVertexCount
   * @param {(msg: string) => void} [opts.onStatus]
   */
  constructor(opts) {
    this.scene = opts.scene;
    this.getDisplayPositions = opts.getDisplayPositions;
    this.getRawPositions = opts.getRawPositions;
    this.getGnmModel = opts.getGnmModel;
    this.getComponentId = opts.getComponentId;
    this.getVertexCount = opts.getVertexCount;
    this.onStatus = opts.onStatus || (() => {});

    this.root = new THREE.Group();
    this.root.name = 'EuroMuscleBaked';
    this.root.renderOrder = 2;
    this.scene.add(this.root);
    this.root.visible = false;

    this.enabled = false;
    this.opacity = 0.75;
    this.map = null;
    this.meshCache = null;
    this.eyeCache = null;
    this._loaded = false;
    this._raf = 0;
    this._pending = false;
    this._packLabel = '';
    this.trackers = [];
  }

  get loaded() {
    return this._loaded;
  }

  /**
   * @param {ArrayBuffer} glbBuffer
   * @param {object} mapJson
   */
  async loadPack(glbBuffer, mapJson) {
    if (!mapJson?.pairs?.length) throw new Error('映射表无效');
    if (mapJson.pairs.length < 4) throw new Error(`映射点对不足（${mapJson.pairs.length}）`);

    this._disposeMeshes();
    this.root.clear();

    const loader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath(DRACO_DECODER_PATH);
    loader.setDRACOLoader(draco);

    const gltf = await loader.parseAsync(glbBuffer, '');
    const scene = gltf.scene;
    scene.traverse((obj) => {
      if (!obj.isMesh) return;
      if (shouldSkipEuroWarp(obj)) obj.userData._skipEuroWarp = true;
    });
    prepareEuroScene(scene);
    this.root.add(scene);
    this.root.updateMatrixWorld(true);

    this.map = mapJson;
    this.meshCache = cacheEuroMeshes(this.root);
    this.eyeCache = cacheEuroEyeMeshes(scene);
    this._bindTrackers();
    this._loaded = true;
    this._packLabel = mapJson.note || '烘焙包';
    setGroupOpacity(this.root, this.opacity);
    this.root.visible = this.enabled;
    this._pending = true;
    this.onStatus(
      `已加载「${this._packLabel}」· ${mapJson.pairs.length} 对映射点 · 烘焙肌肉`
    );
  }

  async loadPackFromFiles(glbFile, mapFile) {
    const glbBuffer = await glbFile.arrayBuffer();
    let mapJson = null;
    if (mapFile) {
      mapJson = JSON.parse(await mapFile.text());
    } else {
      mapJson = peekMuscleMapFromGlb(glbBuffer);
    }
    if (!mapJson) {
      throw new Error(
        describeMissingBakeMapError({
          mapFileSelected: !!mapFile,
          glbFileName: glbFile?.name,
        })
      );
    }
    await this.loadPack(glbBuffer, mapJson);
  }

  _bindTrackers() {
    const display = this.getDisplayPositions?.();
    const n = this.getVertexCount?.() || 0;
    const comp = this.getComponentId?.();
    if (!display || !n || !this.map?.pairs?.length) {
      this.trackers = [];
      return;
    }
    this.trackers = [];
    for (const pair of this.map.pairs) {
      const hint = pair.P;
      if (!hint?.length) continue;
      const vi = nearestSkinVertex(display, n, comp, hint, 0);
      if (vi < 0) continue;
      const i3 = vi * 3;
      this.trackers.push({
        id: pair.id,
        Q0: pair.Q.slice(0, 3),
        P0: pair.P.slice(0, 3),
        vi,
        ox: hint[0] - display[i3],
        oy: hint[1] - display[i3 + 1],
        oz: hint[2] - display[i3 + 2],
      });
    }
  }

  rebindTrackers() {
    if (!this._loaded) return;
    this._bindTrackers();
    this._pending = true;
  }

  _collectWarpTargets() {
    if (!this.trackers.length) return null;
    const display = this.getDisplayPositions?.();
    const n = this.getVertexCount?.() || 0;
    if (!display || !n) return null;

    const src = [];
    const dst = [];
    let maxDelta = 0;

    for (const t of this.trackers) {
      if (t.vi < 0 || t.vi >= n) continue;
      const i3 = t.vi * 3;
      const Pprime = [
        display[i3] + t.ox,
        display[i3 + 1] + t.oy,
        display[i3 + 2] + t.oz,
      ];
      const dx = Pprime[0] - t.P0[0];
      const dy = Pprime[1] - t.P0[1];
      const dz = Pprime[2] - t.P0[2];
      maxDelta = Math.max(maxDelta, Math.abs(dx), Math.abs(dy), Math.abs(dz));
      const Q0 = t.Q0;
      src.push([Q0[0], Q0[1], Q0[2]]);
      dst.push([Q0[0] + dx, Q0[1] + dy, Q0[2] + dz]);
    }

    if (src.length < 4) return null;
    return { src, dst, maxDelta, neutral: maxDelta < NEUTRAL_EPS_M };
  }

  setEnabled(on) {
    this.enabled = !!on;
    if (!this.enabled) {
      this.root.visible = false;
      return;
    }
    if (!this._loaded) {
      this.onStatus('请先加载烘焙包（GLB + map.json）');
      this.enabled = false;
      return;
    }
    this.root.visible = true;
    setGroupOpacity(this.root, this.opacity);
    this._bindTrackers();
    this._pending = true;
  }

  setOpacity(v) {
    this.opacity = Math.max(0, Math.min(1, Number(v) || 0));
    if (this._loaded && this.enabled) setGroupOpacity(this.root, this.opacity);
  }

  scheduleUpdate() {
    if (!this.enabled || !this._loaded) return;
    this._pending = true;
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      if (!this._pending) return;
      this._pending = false;
      this._applyFrame();
    });
  }

  _applyEuroEyeFollow() {
    const scene = this.root.children[0];
    if (!scene || !this.eyeCache?.length) return;
    const model = this.getGnmModel?.();
    const raw = this.getRawPositions?.();
    if (!model || !raw?.length) return;

    const norm = computeBottomCenterNormalize(new Float32Array(raw), TARGET_HEIGHT_M);
    const gnmFrames = sampleGnmEyeFrames(model, raw, norm);
    if (!gnmFrames.L || !gnmFrames.R) return;

    restoreEuroEyeRest(this.eyeCache);
    const euroFrames = sampleEuroEyeFrames(scene);
    const built = buildEyeAlignSnapshot(gnmFrames, euroFrames);
    if (!built.ok || !built.snapshot) return;
    applyEuroEyeAlignVerts(this.eyeCache, built.snapshot, scene);
    prepareEuroScene(scene);
  }

  _applyFrame() {
    if (!this.meshCache?.length) return;
    restoreEuroRest(this.meshCache);
    const targets = this._collectWarpTargets();
    if (targets && !targets.neutral) {
      applyEuroWarpTps(this.meshCache, targets.src, targets.dst);
    }
    this._applyEuroEyeFollow();
    const scene = this.root.children[0];
    if (scene) prepareEuroScene(scene);
    if (this.enabled) setGroupOpacity(this.root, this.opacity);
  }

  /** 调试：欧版眼球中心与 GNM 巩膜目标的最大偏差（米，归一化空间） */
  getEyeAlignGap() {
    const scene = this.root.children[0];
    if (!scene || !this.eyeCache?.length) return { ok: false, reason: 'no-eye-cache' };
    const model = this.getGnmModel?.();
    const raw = this.getRawPositions?.();
    if (!model || !raw?.length) return { ok: false, reason: 'no-gnm' };
    const norm = computeBottomCenterNormalize(new Float32Array(raw), TARGET_HEIGHT_M);
    const gnmFrames = sampleGnmEyeFrames(model, raw, norm);
    const euroFrames = sampleEuroEyeFrames(scene, { deformed: true });
    let maxGap = 0;
    const gaps = {};
    for (const side of ['L', 'R']) {
      if (!gnmFrames[side] || !euroFrames[side]) continue;
      const d = gnmFrames[side].center.distanceTo(euroFrames[side].center);
      gaps[side] = d;
      maxGap = Math.max(maxGap, d);
    }
    return { ok: maxGap < 0.0025, maxGap, gaps, eyeCached: this.eyeCache.length };
  }

  /** 调试 / 冒烟：当前映射位移幅度 */
  getWarpState() {
    const targets = this._collectWarpTargets();
    return {
      trackers: this.trackers.length,
      pairs: this.map?.pairs?.length || 0,
      maxDelta: targets?.maxDelta ?? 0,
      neutral: targets?.neutral ?? true,
      loaded: this._loaded,
      enabled: this.enabled,
    };
  }

  /** 导出当前变形后的欧版肌肉 GLB */
  async exportMuscleGlb(filename = 'euro_muscle_mapped.glb') {
    if (!this._loaded) throw new Error('未加载烘焙包');
    this.root.updateMatrixWorld(true);
    const exportRoot = new THREE.Group();
    exportRoot.name = 'EuroMuscle_Export';

    this.root.traverse((obj) => {
      if (!obj.isMesh || !obj.geometry?.attributes?.position) return;
      if (isEuroJunkOverlayName(obj.name) || isEuroJunkOverlayName(obj.parent?.name)) return;
      const geo = obj.geometry.clone();
      geo.applyMatrix4(obj.matrixWorld);
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      const clonedMats = mats.map((m) => {
        const c = cloneMaterialForExport(m);
        if (c?.userData?._muscleMapBase) {
          c.transparent = c.userData._muscleMapBase.transparent;
          c.opacity = c.userData._muscleMapBase.opacity;
          c.depthWrite = c.userData._muscleMapBase.depthWrite;
        } else {
          c.transparent = false;
          c.opacity = 1;
          c.depthWrite = true;
        }
        return c;
      });
      const mesh = new THREE.Mesh(geo, clonedMats.length === 1 ? clonedMats[0] : clonedMats);
      prepareEuroMeshesForExport(mesh);
      mesh.name = obj.name || 'EuroMesh';
      exportRoot.add(mesh);
    });

    if (!exportRoot.children.length) throw new Error('无可导出网格');

    const exporter = new GLTFExporter();
    const buffer = await new Promise((resolve, reject) => {
      exporter.parse(
        exportRoot,
        (result) => {
          if (result instanceof ArrayBuffer) resolve(result);
          else reject(new Error('导出失败'));
        },
        (err) => reject(err),
        { binary: true, onlyVisible: false, truncateDrawRange: true }
      );
    });

    exportRoot.traverse((o) => {
      if (o.isMesh) {
        o.geometry?.dispose?.();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) m?.dispose?.();
      }
    });

    const safe = filename.replace(/[^\w\u4e00-\u9fff\-_.]+/g, '_');
    downloadBlob(new Blob([buffer], { type: 'model/gltf-binary' }), safe);
    return buffer;
  }

  _disposeMeshes() {
    this.root.traverse((o) => {
      if (o.isMesh) {
        o.geometry?.dispose?.();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) m?.dispose?.();
      }
    });
  }

  dispose() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._disposeMeshes();
    this.scene.remove(this.root);
    this._loaded = false;
    this.meshCache = null;
    this.eyeCache = null;
    this.map = null;
  }
}
