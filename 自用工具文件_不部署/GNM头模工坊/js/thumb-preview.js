import * as THREE from 'three';
import { normalizePositionsBottomCenter, TARGET_HEIGHT_M } from './viewport.js';

const MATERIAL_COLORS = [
  [0.85, 0.63, 0.51],
  [0.95, 0.93, 0.86],
  [0.77, 0.45, 0.42],
  [0.71, 0.31, 0.28],
  [0.96, 0.95, 0.93],
  [0.36, 0.27, 0.19],
  [0.06, 0.05, 0.05],
];

/**
 * Offscreen face thumbnails for identity / expression presets (Tembrica-style).
 */
export class ThumbPreviewer {
  constructor(model, { size = 96 } = {}) {
    this.model = model;
    this.size = size;
    this.canvas = document.createElement('canvas');
    this.canvas.width = size;
    this.canvas.height = size;
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
    });
    this.renderer.setSize(size, size, false);
    this.renderer.setClearColor(0x1a1b22, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(28, 1, 0.01, 5);
    this.camera.position.set(0.22, 0.18, 0.38);
    this.camera.lookAt(0, 0.16, 0);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 0.7));
    const key = new THREE.DirectionalLight(0xffffff, 1.0);
    key.position.set(0.4, 0.8, 0.6);
    this.scene.add(key);

    this.positions = new Float32Array(model.numVertices * 3);
    this.geometry = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.positions, 3);
    this.geometry.setAttribute('position', this.posAttr);
    const colors = new Float32Array(model.numVertices * 3);
    const matId = model.materialId;
    for (let i = 0; i < model.numVertices; i++) {
      const c = MATERIAL_COLORS[matId[i] % MATERIAL_COLORS.length];
      colors[i * 3] = c[0];
      colors[i * 3 + 1] = c[1];
      colors[i * 3 + 2] = c[2];
    }
    this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.geometry.setIndex(new THREE.BufferAttribute(model.triangles.slice(), 1));
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.62,
      metalness: 0.02,
    });
    this.mesh = new THREE.Mesh(this.geometry, mat);
    this.scene.add(this.mesh);

    this._savedId = new Float32Array(model.identityDim);
    this._savedEx = new Float32Array(model.expressionDim);
  }

  _snapshotParams() {
    this._savedId.set(this.model.identity);
    this._savedEx.set(this.model.expression);
  }

  _restoreParams() {
    this.model.setIdentityVector(this._savedId);
    this.model.setExpressionVector(this._savedEx);
  }

  _renderOnce() {
    this.model.computeVertices(this.positions);
    normalizePositionsBottomCenter(this.positions, TARGET_HEIGHT_M);
    this.posAttr.needsUpdate = true;
    this.geometry.computeVertexNormals();
    if (this.geometry.attributes.normal) this.geometry.attributes.normal.needsUpdate = true;
    this.renderer.render(this.scene, this.camera);
    return this.canvas.toDataURL('image/png');
  }

  /**
   * @param {{ identity?: ArrayLike<number>, expression?: ArrayLike<number> }} pack
   */
  renderPack(pack) {
    this._snapshotParams();
    try {
      if (pack.identity) this.model.setIdentityVector(Float32Array.from(pack.identity));
      else this.model.resetIdentity();
      if (pack.expression) this.model.setExpressionVector(Float32Array.from(pack.expression));
      else this.model.resetExpression();
      this.model.resetPose();
      return this._renderOnce();
    } finally {
      this._restoreParams();
    }
  }

  dispose() {
    this.geometry.dispose();
    this.mesh.material.dispose();
    this.renderer.dispose();
  }
}
