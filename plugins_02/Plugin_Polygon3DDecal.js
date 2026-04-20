import * as THREE from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';

function _clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function _nextPow2(v) { v = Math.max(2, v | 0); v--; v |= v >> 1; v |= v >> 2; v |= v >> 4; v |= v >> 8; v |= v >> 16; return v + 1; }

window.Polygon3DDecal = {
    _map: new Map(),
    _group: null,
    _tmpA: new THREE.Vector3(),
    _tmpB: new THREE.Vector3(),
    _tmpC: new THREE.Vector3(),
    _tmpN: new THREE.Vector3(),
    _tmpU: new THREE.Vector3(),
    _tmpV: new THREE.Vector3(),
    _tmpCenter: new THREE.Vector3(),
    _tmpNormal: new THREE.Vector3(),
    _tmpMat4: new THREE.Matrix4(),
    _tmpE: new THREE.Euler(),

    _signature(data) {
        if (!data || !data.anchorObj || !data.anchorObj.parent || !data.isFinished || !Array.isArray(data.points)) return 'invalid';
        let s = `${data.id}|${data.anchorObj.parent.uuid}|${data.color || ''}|${data.points.length}|`;
        for (let i = 0; i < data.points.length; i++) {
            const p = data.points[i] && data.points[i].localPos;
            if (!p) continue;
            s += `${p.x.toFixed(4)},${p.y.toFixed(4)},${p.z.toFixed(4)};`;
        }
        return s;
    },

    _disposeDecalEntry(entry) {
        if (!entry || !entry.root) return;
        try {
            entry.root.traverse(obj => {
                if (!obj || !obj.isMesh) return;
                if (obj.geometry) obj.geometry.dispose();
                if (obj.material) {
                    if (Array.isArray(obj.material)) obj.material.forEach(m => m && m.dispose && m.dispose());
                    else if (obj.material.dispose) obj.material.dispose();
                }
            });
        } catch (_e) {}
        if (entry.root.parent) entry.root.parent.remove(entry.root);
    },

    _ensureGroup(scene) {
        if (this._group && this._group.parent) return this._group;
        const g = new THREE.Group();
        g.name = 'poly3d_decal_group';
        g.renderOrder = 10;
        if (scene) scene.add(g);
        this._group = g;
        return g;
    },

    _buildRuntime(data) {
        if (!data || !data.anchorObj || !data.anchorObj.parent || !data.isFinished || !Array.isArray(data.points) || data.points.length < 3) return null;
        const parent = data.anchorObj.parent;
        const ptsW = [];
        const nrmW = [];
        const normalM = new THREE.Matrix3().getNormalMatrix(parent.matrixWorld);
        for (let i = 0; i < data.points.length; i++) {
            const p = data.points[i];
            if (!p || !p.localPos) continue;
            ptsW.push(p.localPos.clone().applyMatrix4(parent.matrixWorld));
            if (p.localNormal) nrmW.push(p.localNormal.clone().applyMatrix3(normalM).normalize());
        }
        if (ptsW.length < 3) return null;
        const avgN = new THREE.Vector3();
        if (nrmW.length) nrmW.forEach(n => avgN.add(n));
        else if (data.anchorObj.userData && data.anchorObj.userData.localNormal) avgN.copy(data.anchorObj.userData.localNormal).applyMatrix3(normalM);
        else avgN.set(0, 1, 0);
        if (avgN.lengthSq() < 1e-8) avgN.set(0, 1, 0);
        avgN.normalize();
        const u = new THREE.Vector3(0, 1, 0);
        if (Math.abs(avgN.dot(u)) > 0.95) u.set(1, 0, 0);
        u.cross(avgN).normalize();
        const v = new THREE.Vector3().crossVectors(avgN, u).normalize();
        const base = ptsW[0];
        const contour2 = ptsW.map(p => new THREE.Vector2(p.clone().sub(base).dot(u), p.clone().sub(base).dot(v)));
        return { parent, ptsW, nrmW, avgN, u, v, base, contour2 };
    },

    _buildAlphaMaskTexture(contour2) {
        // 画面质量优先：用较高分辨率 Canvas 生成抗锯齿 alphaMap
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (let i = 0; i < contour2.length; i++) {
            const p = contour2[i];
            if (p.x < minX) minX = p.x; if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x; if (p.y > maxY) maxY = p.y;
        }
        const w = Math.max(1e-6, maxX - minX);
        const h = Math.max(1e-6, maxY - minY);
        // pad 稍大一点，避免边缘被 decal box 裁掉
        const pad = Math.max(0.016, Math.min(0.18, Math.max(w, h) * 0.08));
        const aw = w + pad * 2;
        const ah = h + pad * 2;
        // 目标像素密度：每世界单位 ~ 900px，上限 1024
        const pxW = _clamp(Math.round(aw * 900), 192, 1024);
        const pxH = _clamp(Math.round(ah * 900), 192, 1024);
        const cw = _nextPow2(pxW);
        const ch = _nextPow2(pxH);
        const canvas = document.createElement('canvas');
        canvas.width = cw;
        canvas.height = ch;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.clearRect(0, 0, cw, ch);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        // 背景透明，填充白色即 alpha=1
        ctx.fillStyle = 'rgba(255,255,255,1)';
        ctx.beginPath();
        for (let i = 0; i < contour2.length; i++) {
            const p = contour2[i];
            const x = ((p.x - minX) + pad) / aw * cw;
            const y = ((p.y - minY) + pad) / ah * ch;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fill();
        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.minFilter = THREE.LinearMipmapLinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.generateMipmaps = true;
        tex.needsUpdate = true;
        return { tex, minX, minY, maxX, maxY, pad, aw, ah };
    },

    _buildDecalRoot(data, context) {
        const rt = this._buildRuntime(data);
        if (!rt) return null;
        const root = new THREE.Object3D();
        root.name = `poly3d_decal_${data.id}`;
        root.userData.poly3dDecal = true;
        root.userData.poly3dId = data.id;
        const color = new THREE.Color(data.color || '#2ecc71');

        const mask = this._buildAlphaMaskTexture(rt.contour2);
        if (!mask || !mask.tex) return null;
        const mat = new THREE.MeshStandardMaterial({
            color,
            transparent: true,
            opacity: 1.0,
            alphaMap: mask.tex,
            alphaTest: 0.02,
            depthTest: true,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            polygonOffsetUnits: -2,
            side: THREE.DoubleSide
        });
        mat.premultipliedAlpha = true;

        // 单个 decal box 覆盖整个多边形包围盒（在片面平面内）
        const midX = (mask.minX + mask.maxX) * 0.5;
        const midY = (mask.minY + mask.maxY) * 0.5;
        this._tmpCenter.copy(rt.base)
            .addScaledVector(rt.u, midX)
            .addScaledVector(rt.v, midY);
        this._tmpNormal.copy(rt.avgN);
        const lookAtPos = this._tmpCenter.clone().add(this._tmpNormal);
        this._tmpMat4.lookAt(this._tmpCenter, lookAtPos, rt.v);
        this._tmpE.setFromRotationMatrix(this._tmpMat4);
        // sizeX/Y 留冗余，sizeZ 必须随尺寸自适应加厚，保证球/圆柱等曲面不会只切到一圈“弧段”
        const sizeX = _clamp(mask.aw * 1.08, 0.02, 4.0);
        const sizeY = _clamp(mask.ah * 1.08, 0.02, 4.0);
        const sizeZ = _clamp(Math.max(0.12, Math.max(sizeX, sizeY) * 0.35), 0.12, 0.9);
        const geo = new DecalGeometry(rt.parent, this._tmpCenter, this._tmpE, new THREE.Vector3(sizeX, sizeY, sizeZ));
        if (!geo || !geo.attributes || !geo.attributes.position || geo.attributes.position.count < 3) {
            geo && geo.dispose && geo.dispose();
            mask.tex.dispose && mask.tex.dispose();
            return null;
        }
        const mesh = new THREE.Mesh(geo, mat);
        mesh.userData.poly3dDecal = true;
        mesh.userData.poly3dId = data.id;
        mesh.matrixAutoUpdate = false;
        mesh.matrix.identity();
        mesh.frustumCulled = false;
        root.add(mesh);

        const scene = context && context.scene ? context.scene : null;
        this._ensureGroup(scene).add(root);
        return root;
    },

    _syncOne(data, context) {
        const sig = this._signature(data);
        const old = this._map.get(data.id);
        if (old && old.sig === sig && old.parentUUID === (data.anchorObj && data.anchorObj.parent ? data.anchorObj.parent.uuid : '')) return false;
        if (old) this._disposeDecalEntry(old);
        const root = this._buildDecalRoot(data, context);
        this._map.set(data.id, { sig, root, parentUUID: data.anchorObj && data.anchorObj.parent ? data.anchorObj.parent.uuid : '' });
        return true;
    },

    _cleanupMissing() {
        const keep = new Set((window.poly3dList || []).map(d => d && d.id).filter(Boolean));
        let changed = false;
        Array.from(this._map.keys()).forEach(id => {
            if (keep.has(id)) return;
            this._disposeDecalEntry(this._map.get(id));
            this._map.delete(id);
            changed = true;
        });
        return changed;
    },

    onUpdate: function(context) {
        if (!window.poly3dList) return;
        this._ensureGroup(context && context.scene ? context.scene : null);
        let changed = this._cleanupMissing();
        for (let i = 0; i < window.poly3dList.length; i++) {
            const d = window.poly3dList[i];
            if (!d || !d.id) continue;
            const c = this._syncOne(d, context);
            if (c) changed = true;
        }
        if (!changed) return;
        if (typeof window.needsUpdate !== 'undefined') window.needsUpdate = true;
        if (typeof window.lightMoved !== 'undefined') window.lightMoved = true;
        if (context && context.pathTracer) {
            try {
                if (typeof context.pathTracer.setScene === 'function' && context.scene && context.camera) context.pathTracer.setScene(context.scene, context.camera);
                else if (typeof context.pathTracer.updateMaterials === 'function') context.pathTracer.updateMaterials();
                if (typeof context.pathTracer.reset === 'function') context.pathTracer.reset();
            } catch (_e) {}
        }
    },

    onClearScene: function() {
        Array.from(this._map.values()).forEach(v => this._disposeDecalEntry(v));
        this._map.clear();
        if (this._group && this._group.parent) this._group.parent.remove(this._group);
        this._group = null;
    }
};

if (window.PluginManager) window.PluginManager.register('Polygon3D_Decal', window.Polygon3DDecal);

