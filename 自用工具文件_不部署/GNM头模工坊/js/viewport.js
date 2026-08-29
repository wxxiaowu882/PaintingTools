import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createGnmHeadGroup, buildGnmVertexColors } from './gnm-mesh-factory.js';

/** 与 GLB 管理器「高度 30cm + 强制底部中心对齐」一致（单位：米） */
export const TARGET_HEIGHT_M = 0.3;
export const TARGET_HEIGHT_CM = 30;

/**
 * 将 positions（Flat XYZ）缩放到目标高度，并底部中心对齐到原点。
 * @returns {{ heightCm: number, scale: number }}
 */
export function normalizePositionsBottomCenter(positions, targetHeightM = TARGET_HEIGHT_M) {
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i],
      y = positions[i + 1],
      z = positions[i + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  const h = maxY - minY;
  if (!(h > 0) || !isFinite(h)) return { heightCm: 0, scale: 1 };
  const scale = targetHeightM / h;
  const cx = ((minX + maxX) / 2) * scale;
  const minYs = minY * scale;
  const cz = ((minZ + maxZ) / 2) * scale;
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] = positions[i] * scale - cx;
    positions[i + 1] = positions[i + 1] * scale - minYs;
    positions[i + 2] = positions[i + 2] * scale - cz;
  }
  return { heightCm: targetHeightM * 100, scale };
}

export class WorkshopViewport {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x1a1b22, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.sortObjects = true;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(28, 1, 0.01, 8);
    this.camera.position.set(0.32, 0.17, 0.48);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0.15, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.12;
    this.controls.maxDistance = 3;

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444455, 0.55);
    this.scene.add(this.hemi);
    this.key = new THREE.DirectionalLight(0xffffff, 1.05);
    this.key.position.set(0.45, 0.85, 0.65);
    this.scene.add(this.key);
    this.fill = new THREE.DirectionalLight(0xaabbff, 0.28);
    this.fill.position.set(-0.6, 0.2, -0.3);
    this.scene.add(this.fill);

    // 地面参考（预览用，不导出）
    const grid = new THREE.GridHelper(0.8, 16, 0x333344, 0x222233);
    grid.position.y = 0;
    this.scene.add(grid);

    this.root = new THREE.Group();
    this.scene.add(this.root);

    this.mesh = null;
    this.geometry = null;
    this.positionAttr = null;
    this.model = null;
    this.rawPositions = null;
    this.positions = null;
    this.visibility = null;
    this.fullIndex = null;
    this._raf = 0;
    this.lastHeightCm = TARGET_HEIGHT_CM;
    this.onHeightChange = null;
    /** GNM 网格刷新后回调（提线木偶等） */
    this.onAfterRefresh = null;
    this.gnmOpacity = 1;

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this._ro = null;
    if (typeof ResizeObserver !== 'undefined' && canvas.parentElement) {
      this._ro = new ResizeObserver(() => this.resize());
      this._ro.observe(canvas.parentElement);
    }
    // 布局完成后再量一次，避免首帧父级高度为 0 导致画布比例错误
    requestAnimationFrame(() => {
      this.resize();
      requestAnimationFrame(() => this.resize());
    });
    this.resize();
    this._loop();
  }

  resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const w = Math.max(1, Math.floor(parent.clientWidth));
    const h = Math.max(1, Math.floor(parent.clientHeight));
    // 同步绘制缓冲与 CSS 显示尺寸，避免比例被拉伸
    this.renderer.setSize(w, h, true);
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** 按当前网格包围盒把相机框到合适观察距离（不改变网格尺度） */
  frameHead() {
    if (!this.geometry) return;
    this.geometry.computeBoundingBox();
    const box = this.geometry.boundingBox;
    if (!box) return;
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const maxDim = Math.max(size.x, size.y, size.z, 0.01);
    const dist = maxDim / (2 * Math.tan((this.camera.fov * Math.PI) / 360)) * 1.35;
    this.controls.target.copy(center);
    this.camera.position.set(center.x + dist * 0.55, center.y + dist * 0.08, center.z + dist * 0.95);
    this.controls.minDistance = maxDim * 0.35;
    this.controls.maxDistance = maxDim * 8;
    this.controls.update();
  }

  bindModel(model) {
    this.model = model;
    this.rawPositions = new Float32Array(model.numVertices * 3);
    this.positions = new Float32Array(model.numVertices * 3);
    this.visibility = Array.from({ length: model.meta.componentNames.length }, () => true);

    if (this.gnmHead) {
      this.root.remove(this.gnmHead.root);
      this.gnmHead.dispose();
    }

    this.gnmHead = createGnmHeadGroup(model, {
      positions: this.positions,
      visibility: this.visibility,
      dynamic: true,
    });
    this.mesh = this.gnmHead.root;
    this.positionAttr = this.gnmHead.positionAttr;

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', this.positionAttr);
    this.geometry.setAttribute('color', new THREE.BufferAttribute(buildGnmVertexColors(model), 3));

    this.fullIndex = model.triangles;
    this.mesh.name = 'GNM_Head';
    this.mesh.renderOrder = 0;
    this.root.add(this.mesh);

    this.rebuildIndex();
    this.refreshGeometry(true);
    this.setOpacity(this.gnmOpacity);
    this.frameHead();
    this.resize();
  }

  /** 预览用 GNM 透明度（0–1）；不影响导出网格 */
  setOpacity(opacity) {
    const o = Math.max(0, Math.min(1, Number(opacity) || 0));
    this.gnmOpacity = o;
    if (!this.gnmHead?.root) return;
    this.gnmHead.root.traverse((obj) => {
      if (!obj.isMesh || !obj.material) return;
      const m = obj.material;
      if (!m.userData._gnmOpacityBase) {
        m.userData._gnmOpacityBase = {
          transparent: !!m.transparent,
          opacity: m.opacity == null ? 1 : m.opacity,
          depthWrite: m.depthWrite !== false,
          transmission: m.transmission == null ? 0 : m.transmission,
        };
      }
      const base = m.userData._gnmOpacityBase;
      if (o >= 0.985) {
        m.transparent = base.transparent;
        m.opacity = base.opacity;
        m.depthWrite = base.depthWrite;
        if ('transmission' in m) m.transmission = base.transmission;
      } else {
        m.transparent = true;
        m.opacity = o * base.opacity;
        m.depthWrite = o > 0.92;
        if (m.userData._gnmSclera && 'transmission' in m) {
          m.transmission = base.transmission * o;
        }
      }
      m.needsUpdate = true;
    });
    this.gnmHead.root.visible = o > 0.005;
  }

  setVisibility(list) {
    this.visibility = list.slice();
    this.rebuildIndex();
    this.refreshGeometry(true);
  }

  rebuildIndex() {
    if (!this.model || !this.gnmHead || !this.geometry) return;
    this.gnmHead.rebuildIndices(this.visibility);
    const tris = this.fullIndex;
    const comp = this.model.componentId;
    const out = [];
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t];
      const b = tris[t + 1];
      const c = tris[t + 2];
      if (this.visibility[comp[a]] === false) continue;
      if (this.visibility[comp[b]] === false || this.visibility[comp[c]] === false) continue;
      out.push(a, b, c);
    }
    this.geometry.setIndex(out.length ? out : [0, 0, 0]);
    this.geometry.computeVertexNormals();
  }

  refreshGeometry(force = false) {
    if (!this.model || !this.positions) return;
    if (!force && !this.model.dirty) return;
    this.model.computeVertices(this.rawPositions);
    this.positions.set(this.rawPositions);
    const { heightCm } = normalizePositionsBottomCenter(this.positions, TARGET_HEIGHT_M);
    this.lastHeightCm = heightCm;
    this.onHeightChange?.(heightCm);
    this.positionAttr.needsUpdate = true;
    for (const part of this.gnmHead?.parts || []) {
      part.mesh.geometry.computeVertexNormals();
    }
    this.geometry.computeVertexNormals();
    if (this.geometry.attributes.normal) this.geometry.attributes.normal.needsUpdate = true;
    this.onAfterRefresh?.(force);
  }

  /** 导出用：已是 30cm + 底部中心对齐的网格 */
  buildExportRoot(tier = 'standard') {
    if (!this.model || !this.mesh) return null;
    this.refreshGeometry(true);
    const group = new THREE.Group();
    group.name = 'GNM_Head_Export';

    const includeColors = tier !== 'light';
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions.slice(), 3));
    if (includeColors) {
      geo.setAttribute('color', this.geometry.getAttribute('color').clone());
    }
    const idx = this.geometry.getIndex();
    if (idx) geo.setIndex(idx.clone());
    geo.computeVertexNormals();

    let mat;
    if (tier === 'light') {
      mat = new THREE.MeshStandardMaterial({
        color: 0xb9b2aa,
        roughness: 0.82,
        metalness: 0,
      });
    } else {
      mat = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.62,
        metalness: 0.02,
      });
    }
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'GNM_Head';
    group.add(mesh);

    if (tier === 'full') {
      group.userData.exportTier = 'full';
      group.userData.componentNames = this.model.meta.componentNames.slice();
    }
    group.userData.align = 'bottomCenter';
    group.userData.heightCm = TARGET_HEIGHT_CM;
    return group;
  }

  _loop = () => {
    this._raf = requestAnimationFrame(this._loop);
    this.controls.update();
    this.refreshGeometry(false);
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    cancelAnimationFrame(this._raf);
    window.removeEventListener('resize', this._onResize);
    this._ro?.disconnect?.();
    this.controls.dispose();
    this.renderer.dispose();
  }
}
