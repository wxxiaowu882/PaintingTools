import * as THREE from 'three';

window.LightIndicatorManager = {
    enabled: false,
    initialized: false,
    isMobile: false,
    fadeAlpha: 0,
    targetAlpha: 0,
    hideAt: 0,
    _lastUpdateAt: 0,
    _lastPoseSig: '',
    _opts: null,
    group: null,
    dot: null,
    ring: null,
    line: null,
    cone: null,
    pointStar: null,
    dirArrows: null,
    rectFrame: null,
    rectNormal: null,
    rectPlate: null,
    _linePos: null,
    _tmpA: new THREE.Vector3(),
    _tmpB: new THREE.Vector3(),
    _tmpDir: new THREE.Vector3(),
    _tmpMid: new THREE.Vector3(),
    _tmpU: new THREE.Vector3(),
    _tmpV: new THREE.Vector3(),
    _tmpC: new THREE.Vector3(),
    _baseAlpha: 0.28,

    init: function(opts) {
        this._opts = opts || {};
        this.isMobile = !!(this._opts.isMobile);
        this.enabled = !!(this._opts.enabled);
        const scene = this._opts.getScene ? this._opts.getScene() : null;
        if (!scene || this.initialized) return;

        this.group = new THREE.Group();
        this.group.name = 'SolidLightIndicatorGroup';
        this.group.visible = false;
        this.group.renderOrder = 9998;

        const dotMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.01, depthTest: false, depthWrite: false, toneMapped: false });
        this.dot = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), dotMat);
        this.dot.frustumCulled = false;
        this.group.add(this.dot);

        const ringGeo = new THREE.BufferGeometry();
        const seg = 20;
        const arr = new Float32Array((seg + 1) * 3);
        for (let i = 0; i <= seg; i++) {
            const t = (i / seg) * Math.PI * 2;
            arr[i * 3 + 0] = Math.cos(t) * 0.22;
            arr[i * 3 + 1] = Math.sin(t) * 0.22;
            arr[i * 3 + 2] = 0;
        }
        ringGeo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
        const ringMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.01, depthTest: false, depthWrite: false, toneMapped: false });
        this.ring = new THREE.LineLoop(ringGeo, ringMat);
        this.ring.frustumCulled = false;
        this.group.add(this.ring);

        const lineGeo = new THREE.BufferGeometry();
        this._linePos = new Float32Array(6);
        lineGeo.setAttribute('position', new THREE.BufferAttribute(this._linePos, 3));
        const lineMat = new THREE.LineDashedMaterial({ color: 0xffffff, transparent: true, opacity: 0.01, depthTest: false, depthWrite: false, toneMapped: false, dashSize: 0.18, gapSize: 0.14 });
        this.line = new THREE.Line(lineGeo, lineMat);
        this.line.frustumCulled = false;
        this.group.add(this.line);

        // Point：球外向发散短线
        const starGeo = new THREE.BufferGeometry();
        const starPos = new Float32Array(24 * 3); // 12 segments * 2 points * 3
        starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
        const starMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.01, depthTest: false, depthWrite: false, toneMapped: false });
        this.pointStar = new THREE.LineSegments(starGeo, starMat);
        this.pointStar.frustumCulled = false;
        this.group.add(this.pointStar);

        // Dir：平行短箭头阵列（表达方向）
        const arrowsGeo = new THREE.BufferGeometry();
        const arrowsPos = new Float32Array((this.isMobile ? 5 : 9) * 6 * 3); // n arrows * (shaft+2 head)*2pts*3
        arrowsGeo.setAttribute('position', new THREE.BufferAttribute(arrowsPos, 3));
        const arrowsMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.01, depthTest: false, depthWrite: false, toneMapped: false });
        this.dirArrows = new THREE.LineSegments(arrowsGeo, arrowsMat);
        this.dirArrows.frustumCulled = false;
        this.group.add(this.dirArrows);

        // Rect：小矩形线框面片 + 法线箭头
        const rectGeo = new THREE.BufferGeometry();
        const rectPos = new Float32Array(5 * 3); // loop (5 points)
        rectGeo.setAttribute('position', new THREE.BufferAttribute(rectPos, 3));
        const rectMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.01, depthTest: false, depthWrite: false, toneMapped: false });
        this.rectFrame = new THREE.Line(rectGeo, rectMat);
        this.rectFrame.frustumCulled = false;
        this.group.add(this.rectFrame);

        const rectNGeo = new THREE.BufferGeometry();
        const rectNPos = new Float32Array(9 * 3); // shaft + 2 head segments (3 segments * 2 pts)
        rectNGeo.setAttribute('position', new THREE.BufferAttribute(rectNPos, 3));
        const rectNMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.01, depthTest: false, depthWrite: false, toneMapped: false });
        this.rectNormal = new THREE.LineSegments(rectNGeo, rectNMat);
        this.rectNormal.frustumCulled = false;
        this.group.add(this.rectNormal);
        // Rect：微白透明薄片（主语义）
        const plateGeo = new THREE.PlaneGeometry(1, 1);
        const plateMat = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.01,
            side: THREE.DoubleSide,
            depthTest: false,
            depthWrite: false,
            toneMapped: false,
        });
        this.rectPlate = new THREE.Mesh(plateGeo, plateMat);
        this.rectPlate.frustumCulled = false;
        this.group.add(this.rectPlate);

        if (!this.isMobile) {
            // Spot：锥体尖端在灯位，开口朝向 target（沿 -Y）
            const coneGeo = new THREE.ConeGeometry(0.28, 1.0, 12, 1, true);
            try { coneGeo.translate(0, -0.5, 0); } catch (_eT) {} // tip at (0,0,0), base towards -Y
            const coneMat = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.01, depthTest: false, depthWrite: false, toneMapped: false });
            this.cone = new THREE.Mesh(coneGeo, coneMat);
            this.cone.frustumCulled = false;
            this.group.add(this.cone);
        }

        scene.add(this.group);
        this.initialized = true;
        this.refreshImmediate(true);
    },

    setEnabled: function(v) {
        this.enabled = !!v;
        if (!this.enabled) {
            this.targetAlpha = 0;
            this.hideAt = 0;
        }
    },

    showTemporarily: function(ms) {
        if (!this.enabled) return;
        const now = performance.now ? performance.now() : Date.now();
        this.targetAlpha = this._baseAlpha;
        this.fadeAlpha = Math.max(this.fadeAlpha, 0.02);
        this.hideAt = now + Math.max(400, Number(ms) || 1200);
        if (this.group) this.group.visible = true;
        this.refreshImmediate(true);
    },

    refreshImmediate: function(force) {
        if (!this.initialized || !this._opts) return;
        const light = this._opts.getMainLight ? this._opts.getMainLight() : null;
        const camera = this._opts.getCamera ? this._opts.getCamera() : null;
        const target = this._opts.getTarget ? this._opts.getTarget() : null;
        if (!light || !camera) return;

        const a = this._tmpA;
        const b = this._tmpB;
        light.getWorldPosition(a);
        if (light.target && light.target.getWorldPosition) light.target.getWorldPosition(b);
        else if (target && target.isVector3) b.copy(target);
        else b.set(0, 1, 0);

        const lightTypeRaw = this._opts.getLightType ? String(this._opts.getLightType() || '') : '';
        let mainType = '';
        if (lightTypeRaw === 'spot' || lightTypeRaw === 'point' || lightTypeRaw === 'dir' || lightTypeRaw === 'rect') {
            // UI 类型优先，避免切换瞬间对象类型与 UI 不一致造成混态
            mainType = lightTypeRaw;
        } else if (light && light.isSpotLight) mainType = 'spot';
        else if (light && light.isPointLight) mainType = 'point';
        else if (light && light.isDirectionalLight) mainType = 'dir';
        else if (light && light.isRectAreaLight) mainType = 'rect';
        const isSpot = mainType === 'spot';
        const isPoint = mainType === 'point';
        const isDir = mainType === 'dir';
        const isRect = mainType === 'rect';

        // 基于 size 的克制映射：Spot/Rect 明显生效，Point 轻微，Dir 不随 size 变
        const sizeRaw = this._opts.getLightSize ? Number(this._opts.getLightSize()) : NaN;
        const size01 = Number.isFinite(sizeRaw) ? Math.max(0, Math.min(1, (sizeRaw - 1.0) / (25.0 - 1.0))) : 0.04;
        const spotRectScale = 0.7 + size01 * 0.7; // 0.7 ~ 1.4
        const pointScale = 0.9 + size01 * 0.2; // 0.9 ~ 1.1
        const dirScale = 0.9 + size01 * 0.25; // 0.9 ~ 1.15（克制）
        const sizeQ = Math.round(size01 * 100);
        const sig = `${mainType}|${sizeQ}|${a.x.toFixed(3)},${a.y.toFixed(3)},${a.z.toFixed(3)}|${b.x.toFixed(3)},${b.y.toFixed(3)},${b.z.toFixed(3)}`;
        if (!force && sig === this._lastPoseSig) return;
        this._lastPoseSig = sig;

        this.dot.position.copy(a);
        this.ring.position.copy(a);

        this._linePos[0] = a.x; this._linePos[1] = a.y; this._linePos[2] = a.z;
        this._linePos[3] = b.x; this._linePos[4] = b.y; this._linePos[5] = b.z;
        this.line.geometry.attributes.position.needsUpdate = true;
        this.line.computeLineDistances();

        // 方向与 basis（用于 Rect/Dir）
        this._tmpDir.subVectors(b, a);
        const d = this._tmpDir.length();
        if (d > 1e-5) this._tmpDir.normalize();
        else this._tmpDir.set(0, -1, 0);
        // 选一个不共线的 up 来构造正交基
        const up = Math.abs(this._tmpDir.y) > 0.92 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
        this._tmpU.crossVectors(this._tmpDir, up).normalize();
        this._tmpV.crossVectors(this._tmpU, this._tmpDir).normalize();

        // Point 星芒（仅 Point）
        if (this.pointStar) {
            this.pointStar.visible = isPoint;
            if (this.pointStar.visible) {
                const rOut = 0.18 * pointScale; // 从球体外侧起笔，避免穿过球体
                const len = 0.28 * pointScale;
                const p = this.pointStar.geometry.attributes.position.array;
                const dirs = [
                    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
                    [1, 1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, -1], [0, 1, 1], [0, -1, -1],
                ];
                let w = 0;
                for (let i = 0; i < dirs.length; i++) {
                    const dv = this._tmpC.set(dirs[i][0], dirs[i][1], dirs[i][2]).normalize();
                    const sx = a.x + dv.x * rOut;
                    const sy = a.y + dv.y * rOut;
                    const sz = a.z + dv.z * rOut;
                    const ex = a.x + dv.x * (rOut + len);
                    const ey = a.y + dv.y * (rOut + len);
                    const ez = a.z + dv.z * (rOut + len);
                    p[w++] = sx; p[w++] = sy; p[w++] = sz;
                    p[w++] = ex; p[w++] = ey; p[w++] = ez;
                }
                this.pointStar.geometry.setDrawRange(0, w / 3);
                this.pointStar.geometry.attributes.position.needsUpdate = true;
            }
        }

        // Dir 箭头阵列（仅 Dir）
        if (this.dirArrows) {
            this.dirArrows.visible = isDir;
            if (this.dirArrows.visible) {
                const baseStep = (this.isMobile ? 0.34 : 0.26) * 5.0;
                const step = Math.max(0.8, Math.min(3.2, baseStep * dirScale)); // 5 倍放大阵列覆盖
                const shaft = Math.max(0.8, Math.min(2.8, (0.46 * dirScale) * 2.6)); // 与阵列尺度匹配
                const p = this.dirArrows.geometry.attributes.position.array;
                const offsets = this.isMobile
                    ? [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]
                    : [[-1, -1], [0, -1], [1, -1], [-1, 0], [0, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
                let w = 0;
                const centerShift = Math.max(0.9, Math.min(2.4, (0.24 * dirScale) * 5.0));
                const planeCenter = this._tmpC.copy(a).addScaledVector(this._tmpDir, centerShift);
                for (let i = 0; i < offsets.length; i++) {
                    const o = offsets[i];
                    const offs = this._tmpU.clone().multiplyScalar(o[0] * step).addScaledVector(this._tmpV, o[1] * step);
                    const s0 = this._tmpMid.copy(planeCenter).add(offs); // 同一局部平面内规则阵列
                    const s1 = this._tmpA.copy(s0).addScaledVector(this._tmpDir, shaft);
                    // shaft
                    p[w++] = s0.x; p[w++] = s0.y; p[w++] = s0.z;
                    p[w++] = s1.x; p[w++] = s1.y; p[w++] = s1.z;
                }
                this.dirArrows.geometry.setDrawRange(0, w / 3);
                this.dirArrows.geometry.attributes.position.needsUpdate = true;
            }
        }

        // Rect 面框 + 法线（仅 Rect）
        if (this.rectFrame) this.rectFrame.visible = false; // 去掉额外线框，仅保留薄片
        if (isRect && this.rectPlate) {
            const dist = camera.position.distanceTo(a);
            const minHalfW = Math.max(0.34, Math.min(1.05, dist * 0.040)); // 屏幕最小可见兜底（近似）
            const w2 = Math.max(0.50 * spotRectScale, minHalfW);
            const h2 = w2;
            const c0 = this._tmpMid.copy(a);
            this.rectPlate.visible = true;
            this.rectPlate.position.copy(c0);
            this.rectPlate.scale.set(w2 * 2, h2 * 2, 1);
            // PlaneGeometry 默认法线是 +Z；将其对齐到出光方向
            this.rectPlate.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), this._tmpDir);
        }
        if (this.rectNormal) {
            this.rectNormal.visible = isRect;
            if (this.rectNormal.visible) {
                const dist = camera.position.distanceTo(a);
                const minHalfW = Math.max(0.34, Math.min(1.05, dist * 0.040));
                // 法线箭头更明确，确保“面光朝向”一眼可见
                const shaft = Math.max(0.95 * spotRectScale, minHalfW * 1.5);
                const head = 0.20;
                const headW = 0.14;
                const p = this.rectNormal.geometry.attributes.position.array;
                const s0 = this._tmpMid.copy(a);
                const s1 = this._tmpA.copy(s0).addScaledVector(this._tmpDir, shaft);
                const tip = s1;
                const back = this._tmpB.copy(tip).addScaledVector(this._tmpDir, -head);
                const l = this._tmpA.copy(back).addScaledVector(this._tmpU, headW);
                const r = this._tmpB.copy(back).addScaledVector(this._tmpU, -headW);
                // shaft
                p[0] = s0.x; p[1] = s0.y; p[2] = s0.z;
                p[3] = tip.x; p[4] = tip.y; p[5] = tip.z;
                // head
                p[6] = tip.x; p[7] = tip.y; p[8] = tip.z;
                p[9] = l.x; p[10] = l.y; p[11] = l.z;
                p[12] = tip.x; p[13] = tip.y; p[14] = tip.z;
                p[15] = r.x; p[16] = r.y; p[17] = r.z;
                this.rectNormal.geometry.attributes.position.needsUpdate = true;
            }
        }

        if (this.cone) {
            this.cone.visible = isSpot && d > 1e-4;
            if (this.cone.visible) {
                const uniformScale = 0.85 + size01 * 0.45; // 0.85 ~ 1.3，整体比例不变
                this.cone.position.copy(a);
                this.cone.scale.setScalar(uniformScale);
                // cone axis points to -Y (after translate), align -Y to dir
                this.cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), this._tmpDir);
            }
        }

        const temp = this._opts.getLightTemp ? Number(this._opts.getLightTemp()) : 38;
        const intensity = this._opts.getLightIntensity ? Number(this._opts.getLightIntensity()) : 1.7;
        const c = this._opts.getTempColor ? this._opts.getTempColor(temp * 100) : new THREE.Color(0xffffff);
        const iNorm = Math.max(0.0, Math.min(1.0, (intensity - 0.2) / 7.8));
        const r = 0.11 + iNorm * 0.08;
        const dotSize = isPoint ? (r * pointScale) : (isSpot ? (r * spotRectScale) : r);
        this.dot.scale.setScalar(dotSize / 0.12);
        this.ring.scale.setScalar((r * 1.8) / 0.22);
        // 可见性矩阵：每种灯只保留语义最清晰的符号
        if (this.dot) this.dot.visible = isSpot || isPoint;
        if (this.ring) this.ring.visible = false;
        if (this.line) this.line.visible = isSpot || isDir || isRect; // Point 不显示长虚线
        if (this.pointStar) this.pointStar.visible = isPoint;
        if (this.dirArrows) this.dirArrows.visible = isDir;
        if (this.rectFrame) this.rectFrame.visible = false;
        if (this.rectNormal) this.rectNormal.visible = false;
        if (this.rectPlate) this.rectPlate.visible = isRect;

        this.dot.material.color.copy(c);
        this.ring.material.color.copy(c);
        this.line.material.color.copy(c);
        if (this.cone) this.cone.material.color.copy(c);
        if (this.pointStar) this.pointStar.material.color.copy(c);
        if (this.dirArrows) this.dirArrows.material.color.copy(c);
        if (this.rectFrame) this.rectFrame.material.color.copy(c);
        if (this.rectNormal) this.rectNormal.material.color.copy(c);
        if (this.rectPlate) this.rectPlate.material.color.copy(c);
        if (isRect && this.line) {
            // 面积光下保留长虚线但降低存在感，避免压过矩形+法线
            this.line.material.opacity = Math.min(this.line.material.opacity, 0.18);
        }
    },

    onUpdate: function() {
        if (!this.initialized || !this.group) return false;
        const now = performance.now ? performance.now() : Date.now();
        if (!this.enabled) {
            this.targetAlpha = 0;
        } else if (this.hideAt > 0 && now >= this.hideAt) {
            this.targetAlpha = 0;
            this.hideAt = 0;
        }

        // 仅在可见或正在过渡时刷新，减少开销
        if (this.fadeAlpha > 0.001 || this.targetAlpha > 0.001) {
            if ((now - this._lastUpdateAt) > 80) {
                this._lastUpdateAt = now;
                this.refreshImmediate(false);
            }
        }

        const speed = 0.18;
        this.fadeAlpha += (this.targetAlpha - this.fadeAlpha) * speed;
        if (Math.abs(this.fadeAlpha - this.targetAlpha) < 0.002) this.fadeAlpha = this.targetAlpha;

        const visible = this.fadeAlpha > 0.003;
        this.group.visible = visible;
        if (!visible) return false;

        const op = Math.max(0, Math.min(1, this.fadeAlpha));
        this.dot.material.opacity = op * 0.9;
        this.ring.material.opacity = op * 0.0;
        this.line.material.opacity = op * 0.62;
        if (this.rectPlate && this.rectPlate.visible) this.line.material.opacity = op * 0.28;
        if (this.cone && this.cone.visible) this.cone.material.opacity = op * 0.35;
        if (this.pointStar && this.pointStar.visible) this.pointStar.material.opacity = op * 0.56;
        if (this.dirArrows && this.dirArrows.visible) this.dirArrows.material.opacity = op * 0.34;
        if (this.rectFrame && this.rectFrame.visible) this.rectFrame.material.opacity = op * 0.56;
        if (this.rectNormal && this.rectNormal.visible) this.rectNormal.material.opacity = op * 0.62;
        if (this.rectPlate && this.rectPlate.visible) this.rectPlate.material.opacity = op * 0.36;
        return false;
    },

    dispose: function() {
        try {
            if (this.group && this.group.parent) this.group.parent.remove(this.group);
            [this.dot, this.ring, this.line, this.cone, this.pointStar, this.dirArrows, this.rectFrame, this.rectNormal, this.rectPlate].forEach(obj => {
                if (!obj) return;
                try { if (obj.geometry) obj.geometry.dispose(); } catch (_eG) {}
                try { if (obj.material) obj.material.dispose(); } catch (_eM) {}
            });
        } catch (_e) {}
        this.group = null; this.dot = null; this.ring = null; this.line = null; this.cone = null;
        this.pointStar = null; this.dirArrows = null; this.rectFrame = null; this.rectNormal = null; this.rectPlate = null;
        this.initialized = false;
    },
};

if (window.PluginManager && window.LightIndicatorManager) {
    window.PluginManager.register('light-indicator', window.LightIndicatorManager, { mode: null });
}
