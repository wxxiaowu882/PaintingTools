import * as THREE from 'three';

/**
 * 生产端地面 XZ 十字辅助线：显隐与灯位指示同开关、同短暂闪现。
 * 不参与消费端；几何固定世界坐标，不读主光。
 */
window.GroundAxesHelperManager = {
    enabled: false,
    initialized: false,
    fadeAlpha: 0,
    targetAlpha: 0,
    hideAt: 0,
    _opts: null,
    group: null,
    linePosX: null,
    lineNegX: null,
    linePosZ: null,
    lineNegZ: null,
    _baseAlpha: 0.26,
    HALF_LEN: 10,

    init: function (opts) {
        this._opts = opts || {};
        this.enabled = !!(this._opts.enabled);
        const scene = this._opts.getScene ? this._opts.getScene() : null;
        if (!scene || this.initialized) return;

        this.group = new THREE.Group();
        this.group.name = 'SolidGroundAxesHelper';
        this.group.visible = false;
        this.group.renderOrder = 9997;

        const y = 0.01;
        const h = this.HALF_LEN;
        const mkSeg = (x0, z0, x1, z1) => {
            const geo = new THREE.BufferGeometry();
            const arr = new Float32Array([x0, y, z0, x1, y, z1]);
            geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
            const mat = new THREE.LineBasicMaterial({
                color: 0xffffff,
                transparent: true,
                opacity: 0.01,
                depthTest: false,
                depthWrite: false,
                toneMapped: false,
            });
            const line = new THREE.Line(geo, mat);
            line.name = 'SolidGroundAxes_helper';
            line.frustumCulled = false;
            line.raycast = function () {};
            this.group.add(line);
            return line;
        };

        // 正半轴略亮于负半轴（同色，仅 opacity 差）
        this.linePosX = mkSeg.call(this, 0, 0, h, 0);
        this.lineNegX = mkSeg.call(this, -h, 0, 0, 0);
        this.linePosZ = mkSeg.call(this, 0, 0, 0, h);
        this.lineNegZ = mkSeg.call(this, 0, -h, 0, 0);

        scene.add(this.group);
        this.initialized = true;
    },

    setEnabled: function (v) {
        this.enabled = !!v;
        if (!this.enabled) {
            this.targetAlpha = 0;
            this.hideAt = 0;
        }
    },

    showTemporarily: function (ms) {
        if (!this.enabled) return;
        const now = performance.now ? performance.now() : Date.now();
        this.targetAlpha = this._baseAlpha;
        this.fadeAlpha = Math.max(this.fadeAlpha, 0.02);
        this.hideAt = now + Math.max(400, Number(ms) || 1200);
        if (this.group) this.group.visible = true;
    },

    onUpdate: function () {
        if (!this.initialized || !this.group) return false;
        const now = performance.now ? performance.now() : Date.now();
        if (!this.enabled) {
            this.targetAlpha = 0;
        } else if (this.hideAt > 0 && now >= this.hideAt) {
            this.targetAlpha = 0;
            this.hideAt = 0;
        }

        const speed = 0.18;
        this.fadeAlpha += (this.targetAlpha - this.fadeAlpha) * speed;
        if (Math.abs(this.fadeAlpha - this.targetAlpha) < 0.002) this.fadeAlpha = this.targetAlpha;

        const visible = this.fadeAlpha > 0.003;
        this.group.visible = visible;
        if (!visible) return false;

        const op = Math.max(0, Math.min(1, this.fadeAlpha));
        if (this.linePosX) this.linePosX.material.opacity = op * 1.0;
        if (this.lineNegX) this.lineNegX.material.opacity = op * 0.55;
        if (this.linePosZ) this.linePosZ.material.opacity = op * 1.0;
        if (this.lineNegZ) this.lineNegZ.material.opacity = op * 0.55;
        return false;
    },

    dispose: function () {
        try {
            if (this.group && this.group.parent) this.group.parent.remove(this.group);
            [this.linePosX, this.lineNegX, this.linePosZ, this.lineNegZ].forEach(obj => {
                if (!obj) return;
                try { if (obj.geometry) obj.geometry.dispose(); } catch (_eG) {}
                try { if (obj.material) obj.material.dispose(); } catch (_eM) {}
            });
        } catch (_e) {}
        this.group = null;
        this.linePosX = null;
        this.lineNegX = null;
        this.linePosZ = null;
        this.lineNegZ = null;
        this.initialized = false;
    },
};

if (window.PluginManager && window.GroundAxesHelperManager) {
    window.PluginManager.register('ground-axes-helper', window.GroundAxesHelperManager, { mode: null });
}
