/**
 * 未拧欧版 · model-viewer 叠层（对齐 GLB 管理器 Filament 路径）
 * 导出失败或取景异常时自动回退 Three.js。
 */
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { isEuroJunkOverlayName } from './euro-render-prep.js?v=20260829-display18';

function hideMelnsOnly(root) {
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    if (isEuroJunkOverlayName(obj.name) || isEuroJunkOverlayName(obj.parent?.name)) {
      obj.visible = false;
    }
  });
}

export class EuroMvOverlay {
  constructor({ mountEl }) {
    this.mountEl = mountEl;
    this.mv = document.createElement('model-viewer');
    this.mv.id = 'euro-mv-overlay';
    this.mv.setAttribute('tone-mapping', 'aces');
    this.mv.setAttribute('environment-image', 'neutral');
    this.mv.setAttribute('exposure', '1');
    this.mv.setAttribute('shadow-intensity', '0');
    this.mv.setAttribute('interaction-prompt', 'none');
    this.mv.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;background:transparent;display:none;';
    mountEl.appendChild(this.mv);
    this._wantActive = false;
    this._active = false;
    this._ready = false;
    this._cameraPulled = false;
    this._blobUrl = '';
    this._exportGen = 0;
    this._exporting = false;
    this._pendingPivot = null;
    this._onReady = null;
    this._lastPivot = null;
  }

  dispose() {
    this._revokeBlob();
    this.mv?.remove();
  }

  _revokeBlob() {
    if (this._blobUrl) {
      URL.revokeObjectURL(this._blobUrl);
      this._blobUrl = '';
    }
  }

  setActive(on) {
    this._wantActive = !!on;
    this._applyVisible();
  }

  isActive() {
    return this._active;
  }

  isReady() {
    return this._ready;
  }

  _applyVisible() {
    const show = this._wantActive && this._ready;
    this._active = show;
    this.mv.style.display = show ? 'block' : 'none';
  }

  setOpacity(o) {
    this.mv.style.opacity = String(Math.min(1, Math.max(0, Number(o) || 0)));
  }

  setOnReady(fn) {
    this._onReady = fn;
  }

  scheduleExport(euroPivot) {
    if (!euroPivot) return Promise.resolve();
    this._pendingPivot = euroPivot;
    const gen = ++this._exportGen;
    if (this._exporting) return Promise.resolve();
    this._exporting = true;
    return (async () => {
      while (this._pendingPivot) {
        const pivot = this._pendingPivot;
        this._pendingPivot = null;
        try {
          await this._exportPivot(pivot);
        } catch (e) {
          console.warn('[euro-mv-overlay] export failed', e);
          this._ready = false;
          this._applyVisible();
        }
        if (gen !== this._exportGen) continue;
        break;
      }
      this._exporting = false;
      if (this._pendingPivot) await this.scheduleExport(this._pendingPivot);
    })();
  }

  async _exportPivot(euroPivot) {
    this._ready = false;
    this._cameraPulled = false;
    this._lastPivot = euroPivot;
    this._applyVisible();
    euroPivot.updateMatrixWorld(true);
    const preview = new THREE.Scene();
    const clone = euroPivot.clone(true);
    hideMelnsOnly(clone);
    preview.add(clone);
    const buffer = await new Promise((resolve, reject) => {
      new GLTFExporter().parse(preview, resolve, reject, { binary: true });
    });
    if (!buffer?.byteLength) throw new Error('empty GLB export');
    this._revokeBlob();
    this._blobUrl = URL.createObjectURL(new Blob([buffer], { type: 'model/gltf-binary' }));
    this.mv.src = `${this._blobUrl}#.glb`;
    await new Promise((resolve) => {
      const done = () => {
        this.mv.removeEventListener('load', done);
        this.mv.removeEventListener('error', done);
        resolve();
      };
      this.mv.addEventListener('load', done);
      this.mv.addEventListener('error', done);
      setTimeout(done, 8000);
    });
    const framed = await this._ensureFraming(euroPivot);
    if (!framed) {
      this._ready = false;
      this._applyVisible();
      this._onReady?.();
      return;
    }
    this._ready = true;
    this._applyVisible();
    this._onReady?.();
  }

  async _ensureFraming(pivot) {
    const mv = this.mv;
    if (mv.updateComplete) await mv.updateComplete;
    if (typeof mv.jumpCameraToGoal === 'function') {
      mv.jumpCameraToGoal();
      if (mv.updateComplete) await mv.updateComplete;
    }
    for (let i = 0; i < 80; i++) {
      const orbit = mv.getCameraOrbit?.();
      if (orbit?.radius > 0.02) return true;
      await new Promise((r) => requestAnimationFrame(r));
    }
    // 手动按 Three 包围盒给 MV 设相机
    const box = new THREE.Box3().setFromObject(pivot);
    if (box.isEmpty()) return false;
    const center = new THREE.Vector3();
    const size = new THREE.Vector3();
    box.getCenter(center);
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z, 0.01);
    const r = maxDim * 2.2;
    mv.setAttribute('camera-target', `${center.x}m ${center.y}m ${center.z}m`);
    mv.setAttribute('camera-orbit', `0deg 75deg ${r}m`);
    if (mv.updateComplete) await mv.updateComplete;
    const orbit = mv.getCameraOrbit?.();
    return !!(orbit?.radius > 0.02);
  }

  pullCameraToThree(camera, controls) {
    if (!this._ready || typeof this.mv.getCameraOrbit !== 'function') return false;
    const orbit = this.mv.getCameraOrbit();
    if (!orbit?.radius || orbit.radius < 0.02) return false;
    const tgt = this.mv.getCameraTarget?.() || { x: 0, y: 0, z: 0 };
    controls.target.set(tgt.x, tgt.y, tgt.z);
    const sinPhi = Math.sin(orbit.phi);
    camera.position.set(
      tgt.x + orbit.radius * sinPhi * Math.sin(orbit.theta),
      tgt.y + orbit.radius * Math.cos(orbit.phi),
      tgt.z + orbit.radius * sinPhi * Math.cos(orbit.theta)
    );
    if (typeof this.mv.getFieldOfView === 'function') {
      camera.fov = this.mv.getFieldOfView();
      camera.updateProjectionMatrix();
    }
    controls.update();
    this._cameraPulled = true;
    return true;
  }

  pushCameraFromThree(camera, target) {
    if (!this._active || !this._ready || !this._cameraPulled) return;
    const dx = camera.position.x - target.x;
    const dy = camera.position.y - target.y;
    const dz = camera.position.z - target.z;
    const r = Math.hypot(dx, dy, dz) || 0.001;
    const phi = Math.acos(THREE.MathUtils.clamp(dy / r, -1, 1));
    const theta = Math.atan2(dx, dz);
    this.mv.setAttribute('camera-target', `${target.x}m ${target.y}m ${target.z}m`);
    this.mv.setAttribute('field-of-view', `${THREE.MathUtils.radToDeg(camera.fov)}deg`);
    this.mv.setAttribute('camera-orbit', `${theta}rad ${phi}rad ${r}m`);
  }
}
