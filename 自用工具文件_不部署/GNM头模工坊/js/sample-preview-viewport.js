/**
 * 语义采样弹层内可交互预览：OrbitControls 旋转 / 滚轮缩放。
 * 临时写 identity 算顶点后立刻还原主模型，避免脏主视口。
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
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

export class SamplePreviewViewport {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {import('./vendor/GNMModel.js').GNMHeadModel} model
   */
  constructor(canvas, model) {
    this.canvas = canvas;
    this.model = model;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
    });
    this.renderer.setClearColor(0x1a1b22, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.01, 8);
    this.camera.position.set(0.36, 0.16, 0.55);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(0, 0.14, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.18;
    this.controls.maxDistance = 3;
    this.controls.enablePan = true;

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 0.7));
    const key = new THREE.DirectionalLight(0xffffff, 1.05);
    key.position.set(0.4, 0.8, 0.6);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xaabbff, 0.3);
    fill.position.set(-0.5, 0.2, -0.25);
    this.scene.add(fill);

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
    this.mesh = new THREE.Mesh(
      this.geometry,
      new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.62,
        metalness: 0.02,
      })
    );
    this.scene.add(this.mesh);

    this._savedId = new Float32Array(model.identityDim);
    this._savedEx = new Float32Array(model.expressionDim);
    this._raf = 0;
    this._alive = true;
    this._framed = false;

    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.stopPropagation();
      },
      { passive: true }
    );

    this.resize();
    this._tick = this._tick.bind(this);
    this._raf = requestAnimationFrame(this._tick);
  }

  resize() {
    const parent = this.canvas.parentElement;
    const w = Math.max(160, parent?.clientWidth || 320);
    const h = Math.max(160, parent?.clientHeight || w);
    const pr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /**
   * 按包围盒框入整头：尽量占满画布，仍留少量边以免头顶/下巴被裁。
   * @param {{ force?: boolean }} [opts]
   */
  frameHead(opts = {}) {
    this.geometry.computeBoundingBox();
    const box = this.geometry.boundingBox;
    if (!box) return;
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    // 略抬目标，优先保证垂直方向入画（头模高大于宽）
    center.y += size.y * 0.01;
    const fitDim = Math.max(size.x * 1.02, size.y * 1.04, size.z * 0.9, 0.01);
    const dist = (fitDim / (2 * Math.tan((this.camera.fov * Math.PI) / 360))) * 1.2;
    this.controls.target.copy(center);
    // 近正面略偏，减少侧向浪费画布
    this.camera.position.set(center.x + dist * 0.18, center.y + dist * 0.01, center.z + dist);
    this.controls.minDistance = fitDim * 0.35;
    this.controls.maxDistance = fitDim * 10;
    this.controls.update();
    this._framed = true;
  }

  /**
   * @param {ArrayLike<number>} identity
   * @param {{ reframe?: boolean }} [opts] reframe=true 强制重新框选整头
   */
  setIdentity(identity, opts = {}) {
    this._savedId.set(this.model.identity);
    this._savedEx.set(this.model.expression);
    try {
      this.model.setIdentityVector(Float32Array.from(identity));
      this.model.resetExpression();
      this.model.resetPose();
      this.model.computeVertices(this.positions);
      normalizePositionsBottomCenter(this.positions, TARGET_HEIGHT_M);
      this.posAttr.needsUpdate = true;
      this.geometry.computeVertexNormals();
      if (this.geometry.attributes.normal) this.geometry.attributes.normal.needsUpdate = true;
    } finally {
      this.model.setIdentityVector(this._savedId);
      this.model.setExpressionVector(this._savedEx);
    }
    if (!this._framed || opts.reframe) this.frameHead();
  }

  _tick() {
    if (!this._alive) return;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    this._raf = requestAnimationFrame(this._tick);
  }

  dispose() {
    this._alive = false;
    cancelAnimationFrame(this._raf);
    this.controls.dispose();
    this.geometry.dispose();
    this.mesh.material.dispose();
    this.renderer.dispose();
  }
}
