/**
 * 欧版提线木偶：加载 align-overlay 历史版本，GNM 滑条驱动时 TPS 拧动欧版肌肉跟随。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import {
  cacheEuroMeshes,
  applyLandmarkWarp as applyEuroWarpTps,
  restoreEuroRest,
} from '../align-overlay/js/euro-warp.js';
import {
  applyNormalizePoint,
  computeBottomCenterNormalize,
} from '../align-overlay/js/procrustes.js';

const EURO_GLB_URL = './align-overlay/assets/euro_muscle.glb';
const HISTORY_DIR = './align-overlay/landmarks/history/';
const DRACO_DECODER_PATH = '../../../docs/js/three_164/examples/jsm/libs/draco/gltf/';
const TARGET_HEIGHT_M = 0.3;

function isEuroJunkOverlayName(name) {
  const n = (name || '').toLowerCase();
  return n.includes('melns') || n.includes('acsleca');
}

function healOpaqueBlendMaterial(m) {
  if (!m) return;
  const op = m.opacity == null ? 1 : m.opacity;
  if (m.transparent && op >= 0.985 && !m.alphaMap) {
    m.transparent = false;
    m.depthWrite = true;
  }
}

function prepareEuroMaterials(mesh) {
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  const n = (mesh.name || '').toLowerCase();
  const isStatic = n.includes('static') || n === 'skin' || n.includes('head_static');
  const isMuscle = n.includes('deform') || n.includes('skiedras') || n.includes('plastyma');
  for (const m of mats) {
    if (!m) continue;
    healOpaqueBlendMaterial(m);
    if ('metalness' in m) m.metalness = 0;
    if ('roughness' in m) m.roughness = Math.max(Number(m.roughness) || 0.5, 0.48);
    m.side = THREE.FrontSide;
    m.polygonOffset = true;
    if (isStatic) {
      m.depthWrite = true;
      m.polygonOffsetFactor = 4;
      m.polygonOffsetUnits = 4;
    } else if (isMuscle) {
      const isSkiedras = /skiedras/i.test(mesh.name || '');
      m.depthWrite = !isSkiedras;
      m.polygonOffsetFactor = isSkiedras ? 1 : -4;
      m.polygonOffsetUnits = isSkiedras ? 1 : -4;
    }
    m.needsUpdate = true;
  }
}

function setGroupOpacity(root, opacity) {
  const o = Math.max(0, Math.min(1, opacity));
  root.visible = o > 0.005;
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of mats) {
      if (!m.userData._puppetBase) {
        m.userData._puppetBase = {
          transparent: !!m.transparent,
          opacity: m.opacity == null ? 1 : m.opacity,
          depthWrite: m.depthWrite !== false,
        };
      }
      const base = m.userData._puppetBase;
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

function defaultPreTrs() {
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

function normalizePreTrs(raw) {
  const d = defaultPreTrs();
  if (!raw || typeof raw !== 'object') return { ...d };
  return { ...d, ...raw };
}

function effectiveScale(p) {
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

function applyPreTrsToPivot(pivot, preTrs) {
  const p = normalizePreTrs(preTrs);
  const { sx, sy, sz } = effectiveScale(p);
  pivot.position.set(p.txMm / 1000, p.tyMm / 1000, p.tzMm / 1000);
  pivot.rotation.set(
    THREE.MathUtils.degToRad(p.rxDeg),
    THREE.MathUtils.degToRad(p.ryDeg),
    THREE.MathUtils.degToRad(p.rzDeg),
    'XYZ'
  );
  pivot.scale.set(sx, sy, sz);
  pivot.updateMatrixWorld(true);
}

function warpSnapshotGapMm(snap) {
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

function parsePairs(points) {
  const byKey = new Map();
  for (const p of points || []) {
    if (!p?.pairKey) continue;
    if (!byKey.has(p.pairKey)) byKey.set(p.pairKey, {});
    byKey.get(p.pairKey)[p.side === 'euro' ? 'euro' : 'gnm'] = p;
  }
  const out = [];
  for (const [pairKey, sides] of byKey) {
    if (!sides.gnm || !sides.euro) continue;
    out.push({
      pairKey,
      gnmNative: sides.gnm.pos.slice(0, 3),
      euroLocal: sides.euro.pos.slice(0, 3),
    });
  }
  return out;
}

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

export class EuroPuppet {
  /**
   * @param {object} opts
   * @param {THREE.Scene} opts.scene
   * @param {() => Float32Array|null} opts.getDisplayPositions
   * @param {() => Float32Array|null} opts.getRawPositions
   * @param {() => Uint8Array|number[]|null} opts.getComponentId
   * @param {() => number} opts.getVertexCount
   * @param {(msg: string) => void} [opts.onStatus]
   */
  constructor(opts) {
    this.scene = opts.scene;
    this.getDisplayPositions = opts.getDisplayPositions;
    this.getRawPositions = opts.getRawPositions;
    this.getComponentId = opts.getComponentId;
    this.getVertexCount = opts.getVertexCount;
    this.onStatus = opts.onStatus || (() => {});

    this.euroPivot = new THREE.Group();
    this.euroPivot.name = 'EuroPuppetPivot';
    this.euroRoot = new THREE.Group();
    this.euroRoot.name = 'EuroPuppetRoot';
    this.euroPivot.add(this.euroRoot);
    this.scene.add(this.euroPivot);
    this.euroPivot.visible = false;

    this.enabled = false;
    this.opacity = 0.75;
    this.pairs = [];
    this.trackers = [];
    this.meshCache = null;
    this._raf = 0;
    this._pending = false;
    this._loaded = false;
    this._versionMeta = null;
    this._baselineWarp = null;
  }

  async fetchHistoryIndex() {
    const res = await fetch(`${HISTORY_DIR}index.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`无法读取对齐历史 HTTP ${res.status}`);
    const data = await res.json();
    return (data.versions || []).slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }

  async fetchHistoryEntry(meta) {
    const file = meta?.file || `${meta?.id}.json`;
    const res = await fetch(`${HISTORY_DIR}${file}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`无法读取 ${file} · HTTP ${res.status}`);
    return res.json();
  }

  async loadVersion(meta) {
    if (!meta?.id) throw new Error('未选择对齐版本');
    this.onStatus('加载欧版对齐…');
    const entry = await this.fetchHistoryEntry(meta);
    const payload = entry.payload || entry;
    const points = payload.points || [];
    this.pairs = parsePairs(points);
    if (this.pairs.length < 4) throw new Error(`配对路标不足（${this.pairs.length}）`);

    await this._loadEuroGlb();
    this._applyAlignSnapshot(entry.alignSnapshot ?? payload.alignSnapshot);
    applyPreTrsToPivot(this.euroPivot, entry.preTrs ?? payload.preTrs);

    this.meshCache = cacheEuroMeshes(this.euroPivot);
    restoreEuroRest(this.meshCache);

    const warpSnap = entry.warpSnapshot ?? payload.warpSnapshot ?? null;
    this._baselineWarp = warpSnap && warpSnapshotGapMm(warpSnap) >= 0.05 ? warpSnap : null;
    if (this._baselineWarp) {
      applyEuroWarpTps(this.meshCache, this._baselineWarp.src, this._baselineWarp.dst);
    }

    this._bindTrackers();
    this._loaded = true;
    this._versionMeta = meta;
    setGroupOpacity(this.euroPivot, this.opacity);
    this.euroPivot.visible = this.enabled;
    this._pending = true;
    const note = meta.note ? `「${meta.note}」` : meta.id;
    this.onStatus(`欧版已载入 ${note} · ${this.pairs.length} 对路标${this._baselineWarp ? ' · 含拧形基线' : ''}`);
    return entry;
  }

  async _loadEuroGlb() {
    if (this.euroRoot.children.length) return;
    const loader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath(DRACO_DECODER_PATH);
    loader.setDRACOLoader(draco);
    const gltf = await loader.loadAsync(EURO_GLB_URL);
    const euroScene = gltf.scene;
    euroScene.traverse((obj) => {
      if (!obj.isMesh) return;
      prepareEuroMaterials(obj);
      if (isEuroJunkOverlayName(obj.name)) {
        obj.visible = false;
        obj.userData._overlayHiddenJunk = true;
      }
    });
    this.euroRoot.clear();
    this.euroRoot.add(euroScene);
    this.euroRoot.updateMatrixWorld(true);
  }

  _applyAlignSnapshot(snap) {
    if (!snap?.matrix4_columnMajor?.length) {
      throw new Error('该版本缺少对齐矩阵 alignSnapshot');
    }
    const mat = new THREE.Matrix4().fromArray(snap.matrix4_columnMajor);
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    mat.decompose(pos, quat, scl);
    this.euroRoot.position.copy(pos);
    this.euroRoot.quaternion.copy(quat);
    this.euroRoot.scale.copy(scl);
    this.euroRoot.updateMatrixWorld(true);
  }

  _bindTrackers() {
    const raw = this.getRawPositions?.();
    const n = this.getVertexCount?.() || 0;
    const comp = this.getComponentId?.();
    const display = this.getDisplayPositions?.();
    if (!raw || !display || !n) {
      this.trackers = [];
      return;
    }
    const rawCopy = new Float32Array(raw);
    const norm = computeBottomCenterNormalize(rawCopy, TARGET_HEIGHT_M);
    this.trackers = [];
    for (const pair of this.pairs) {
      const hint = applyNormalizePoint(pair.gnmNative, norm);
      const vi = nearestSkinVertex(display, n, comp, hint, 0);
      if (vi < 0) continue;
      this.trackers.push({
        pairKey: pair.pairKey,
        euroLocal: pair.euroLocal.slice(0, 3),
        vi,
        ox: hint[0] - display[vi * 3],
        oy: hint[1] - display[vi * 3 + 1],
        oz: hint[2] - display[vi * 3 + 2],
      });
    }
  }

  setEnabled(on) {
    this.enabled = !!on;
    if (!this.enabled) {
      this.euroPivot.visible = false;
      return;
    }
    if (!this._loaded) {
      this.onStatus('请先选择对齐版本');
      this.enabled = false;
      return;
    }
    this.euroPivot.visible = true;
    setGroupOpacity(this.euroPivot, this.opacity);
    this._bindTrackers();
    this._pending = true;
  }

  setOpacity(v) {
    this.opacity = Math.max(0, Math.min(1, Number(v) || 0));
    if (this._loaded && this.enabled) setGroupOpacity(this.euroPivot, this.opacity);
  }

  /** 版本切换或 GNM 大改后重绑跟踪点 */
  rebindTrackers() {
    if (!this._loaded) return;
    this._bindTrackers();
    this._pending = true;
  }

  scheduleUpdate() {
    if (!this.enabled || !this._loaded) return;
    this._pending = true;
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => {
      this._raf = 0;
      if (!this._pending) return;
      this._pending = false;
      this._applyPuppetFrame();
    });
  }

  _collectWarpPairs() {
    const positions = this.getDisplayPositions?.();
    const n = this.getVertexCount?.() || 0;
    if (!positions || !n || !this.trackers.length) return null;
    const src = [];
    const dst = [];
    const used = [];
    const tmp = new THREE.Vector3();
    this.euroRoot.updateMatrixWorld(true);
    for (const t of this.trackers) {
      const i3 = t.vi * 3;
      if (t.vi < 0 || t.vi >= n) continue;
      dst.push([positions[i3] + t.ox, positions[i3 + 1] + t.oy, positions[i3 + 2] + t.oz]);
      tmp.set(t.euroLocal[0], t.euroLocal[1], t.euroLocal[2]);
      this.euroRoot.localToWorld(tmp);
      src.push([tmp.x, tmp.y, tmp.z]);
      used.push(t.pairKey);
    }
    if (src.length < 4) return null;
    return { src, dst, used };
  }

  _applyPuppetFrame() {
    if (!this.meshCache?.length) return;
    const pairs = this._collectWarpPairs();
    if (!pairs) return;
    restoreEuroRest(this.meshCache);
    const result = applyEuroWarpTps(this.meshCache, pairs.src, pairs.dst);
    if (!result.ok) return;
  }

  dispose() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this.scene.remove(this.euroPivot);
    this.euroRoot.traverse((o) => {
      if (o.isMesh) {
        o.geometry?.dispose?.();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) m?.dispose?.();
      }
    });
  }
}
