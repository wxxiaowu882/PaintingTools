/*
* Plugin_DashedLine.js
* 功能：连续虚线 + 贝塞尔曲线标注（纯内存数据阵列 + 极限性能点乘剔除）
* kind: 缺省/"dashed" = 连续虚线；"bezier"（旧 "straight" 兼容）= 贝塞尔曲线
*   未投面：可编辑锚点 + 左右控制柄，SVG 三次贝塞尔；
*   投面后 projected:true 为多点折线，不显示锚点/柄。
*/
import * as THREE from 'three'; window.dashedLineList = []; window.dashedLineCounter = 0; window.DashedLineManager = { pluginId: 'Plugin_DashedLine', selectedId: null, selectedIds: [], isDrawing: false, currentLine: null,
    // 贝塞尔/直线外观初值（缺省字段兼容旧 JSON；滑条可写 per-line strokeWidth / opacity / capR / lineStyle）
    STRAIGHT_STROKE: 4.5, STRAIGHT_STROKE_SEL: 6, STRAIGHT_GLOW: 9, STRAIGHT_CAP_R: 6.5, STRAIGHT_CAP_R_SEL: 8, STRAIGHT_CAP_RING_EXTRA: 4, STRAIGHT_CAP_HIT_R: 18,
    STRAIGHT_OPACITY: 0.9, STRAIGHT_OCCLUDE_OPACITY: 0.2,
    STRAIGHT_STROKE_MIN: 1, STRAIGHT_STROKE_MAX: 6, STRAIGHT_OPACITY_MIN: 0.15, STRAIGHT_OPACITY_MAX: 1,
    /** 端点半径：直径滑条 1～24 → capR 0.5～12；命中圈不随视觉缩到过小 */
    STRAIGHT_CAP_R_MIN: 0.5, STRAIGHT_CAP_R_MAX: 12,
    /** 线形：dashed=现网默认虚线；solid=实线；dotted=点线 */
    STRAIGHT_LINE_STYLE: 'dashed',
    STRAIGHT_LINE_STYLES: { dashed: '6, 6', solid: 'none', dotted: '2, 5' },
    ANCHOR_R: 5, HANDLE_R: 4.5, HANDLE_HIT_R: 14,
    selectedAnchorIndex: null, selectedHandleSide: null,
    _lastAddPos: new THREE.Vector3(), _straightPending: null, _straightClickArm: null, _straightEndpointDrag: null, _straightEndpointOrbitWasEnabled: null,
    _bezierDrag: null,
    _clampNum: function(v, lo, hi, fallback) {
        const n = (typeof v === 'number') ? v : parseFloat(v);
        if (!isFinite(n)) return fallback;
        return Math.max(lo, Math.min(hi, n));
    },
    _isBezierKind: function(data) {
        return !!(data && (data.kind === 'bezier' || data.kind === 'straight'));
    },
    /** 投面折线：显式 projected，或旧版多点且无手柄 */
    _isProjectedPolyline: function(data) {
        if (!data || !this._isBezierKind(data) || !data.points) return false;
        if (data.projected === true) return true;
        if (data.points.length > 2) {
            const hasHandle = data.points.some(p => p.handleIn || p.handleOut);
            if (!hasHandle) return true;
        }
        return false;
    },
    /** 未投面可编辑贝塞尔（锚点/柄） */
    isEditableBezier: function(data) {
        return !!(data && this._isBezierKind(data) && data.points && data.points.length >= 2 && !this._isProjectedPolyline(data));
    },
    /** 兼容旧 UI：真直线 = 可编辑贝塞尔（未投面） */
    isTrueStraight: function(data) {
        return this.isEditableBezier(data);
    },
    _clearBezierEditFocus: function() {
        this.selectedAnchorIndex = null;
        this.selectedHandleSide = null;
    },
    _vec3FromArr: function(arr) {
        if (!arr || !Array.isArray(arr) || arr.length < 3) return null;
        const v = new THREE.Vector3(arr[0], arr[1], arr[2]);
        return (isFinite(v.x) && isFinite(v.y) && isFinite(v.z)) ? v : null;
    },
    _arrFromVec3: function(v) {
        if (!v) return null;
        return [parseFloat(v.x.toFixed(4)), parseFloat(v.y.toFixed(4)), parseFloat(v.z.toFixed(4))];
    },
    /** 两端默认共线柄（弦长约 1/3）；中间锚点按切线初始化 */
    _ensureDefaultHandles: function(data) {
        if (!data || !data.points || data.points.length < 2) return;
        const pts = data.points;
        for (let i = 0; i < pts.length; i++) {
            const p = pts[i];
            if (i === 0) {
                p.handleIn = null;
                if (!p.handleOut) {
                    p.handleOut = pts[1].localPos.clone().sub(p.localPos).multiplyScalar(1 / 3);
                }
            } else if (i === pts.length - 1) {
                p.handleOut = null;
                if (!p.handleIn) {
                    p.handleIn = pts[i - 1].localPos.clone().sub(p.localPos).multiplyScalar(1 / 3);
                }
            } else {
                const prev = pts[i - 1].localPos;
                const next = pts[i + 1].localPos;
                const tan = next.clone().sub(prev);
                if (tan.lengthSq() < 1e-12) tan.set(1, 0, 0);
                else tan.normalize();
                const dIn = p.localPos.distanceTo(prev) / 3;
                const dOut = next.distanceTo(p.localPos) / 3;
                if (!p.handleIn) p.handleIn = tan.clone().multiplyScalar(-dIn);
                if (!p.handleOut) p.handleOut = tan.clone().multiplyScalar(dOut);
            }
        }
    },
    _stripHandles: function(data) {
        if (!data || !data.points) return;
        data.points.forEach(p => {
            p.handleIn = null;
            p.handleOut = null;
            delete p.handleIn;
            delete p.handleOut;
        });
    },
    /** 柄是否视为已收起（无柄或长度≈0） */
    _isHandleCollapsed: function(h) {
        if (!h) return true;
        try { return h.lengthSq() < 1e-12; } catch (_e) { return true; }
    },
    /**
     * Alt+单击锚点：切换控制柄。
     * 有柄 → 收起成尖角（写零长度柄，勿 null，否则 _ensureDefaultHandles 每帧会补回默认柄导致仍有弧度）；
     * 已收起 → 沿邻边展开柄（中间点：入柄∥prev边、出柄∥next边，非跨弦共线切线）。
     */
    _collapseBezierAnchorHandles: function(data, index) {
        if (!data || !this.isEditableBezier(data) || !data.points || !data.points[index]) return false;
        if (window.__SOLID_CONSUMER__) return false;
        const pt = data.points[index];
        const n = data.points.length;
        const canIn = index > 0;
        const canOut = index < n - 1;
        const hasIn = canIn && !this._isHandleCollapsed(pt.handleIn);
        const hasOut = canOut && !this._isHandleCollapsed(pt.handleOut);
        let collapsed = false;
        if (hasIn || hasOut) {
            // 零向量：路径控制点落在锚点上 → 真尖角；且 truthy 不会被 _ensureDefaultHandles 冲掉
            if (canIn) pt.handleIn = new THREE.Vector3(0, 0, 0);
            if (canOut) pt.handleOut = new THREE.Vector3(0, 0, 0);
            if (index === 0) { pt.handleIn = null; delete pt.handleIn; }
            if (index === n - 1) { pt.handleOut = null; delete pt.handleOut; }
            collapsed = true;
        } else {
            // 已收起：柄方向与两条边线重合（端点仅一侧）
            if (index === 0 && n > 1) {
                pt.handleIn = null;
                delete pt.handleIn;
                pt.handleOut = data.points[1].localPos.clone().sub(pt.localPos).multiplyScalar(1 / 3);
            } else if (index === n - 1 && n > 1) {
                pt.handleOut = null;
                delete pt.handleOut;
                pt.handleIn = data.points[n - 2].localPos.clone().sub(pt.localPos).multiplyScalar(1 / 3);
            } else if (n > 2) {
                const prev = data.points[index - 1].localPos;
                const next = data.points[index + 1].localPos;
                const dIn = pt.localPos.distanceTo(prev) / 3;
                const dOut = next.distanceTo(pt.localPos) / 3;
                const dirIn = prev.clone().sub(pt.localPos);
                if (dirIn.lengthSq() < 1e-12) dirIn.set(-1, 0, 0); else dirIn.normalize();
                const dirOut = next.clone().sub(pt.localPos);
                if (dirOut.lengthSq() < 1e-12) dirOut.set(1, 0, 0); else dirOut.normalize();
                pt.handleIn = dirIn.multiplyScalar(dIn);
                pt.handleOut = dirOut.multiplyScalar(dOut);
            } else {
                return false;
            }
        }
        data.lastDStr = '';
        this.selectedHandleSide = null;
        this.selectedAnchorIndex = index;
        this._syncBezierEditOverlay(data, this.selectedId === data.id);
        if (this._cachedCamera) {
            try { this._updateBezierHandlesScreen(data, this._cachedCamera); } catch (_eH) {}
        }
        window.needsUpdate = true;
        window.lightMoved = true;
        try { if (typeof window.markDraftDirty === 'function') window.markDraftDirty(); } catch (_e) {}
        if (window.showToast) window.showToast(collapsed ? '已收起该锚点控制柄' : '已恢复该锚点控制柄');
        return true;
    },
    /** 解析外观（旧数据缺字段 = 现网默认） */
    getStraightAppearance: function(data) {
        const strokeWidth = this._clampNum(
            data && data.strokeWidth, this.STRAIGHT_STROKE_MIN, this.STRAIGHT_STROKE_MAX, this.STRAIGHT_STROKE
        );
        const opacity = this._clampNum(
            data && data.opacity, this.STRAIGHT_OPACITY_MIN, this.STRAIGHT_OPACITY_MAX, this.STRAIGHT_OPACITY
        );
        const capR = this._clampNum(
            data && data.capR, this.STRAIGHT_CAP_R_MIN, this.STRAIGHT_CAP_R_MAX, this.STRAIGHT_CAP_R
        );
        const lineStyle = this._normalizeLineStyle(data && data.lineStyle);
        return { strokeWidth: strokeWidth, opacity: opacity, capR: capR, lineStyle: lineStyle };
    },
    _normalizeLineStyle: function(v) {
        const s = (v == null) ? '' : String(v).toLowerCase();
        if (s === 'solid' || s === 'dotted' || s === 'dashed') return s;
        return this.STRAIGHT_LINE_STYLE;
    },
    _dashArrayForLineStyle: function(lineStyle) {
        const key = this._normalizeLineStyle(lineStyle);
        const map = this.STRAIGHT_LINE_STYLES || {};
        return map[key] != null ? map[key] : map.dashed;
    },
    _applyLineStyleToPaths: function(data, lineStyle) {
        if (!data) return;
        const dash = this._dashArrayForLineStyle(lineStyle);
        const apply = (el) => {
            if (!el) return;
            if (dash === 'none' || dash === '') {
                el.removeAttribute('stroke-dasharray');
            } else {
                el.setAttribute('stroke-dasharray', dash);
            }
        };
        apply(data.svgPath);
        apply(data.svgGlowPath);
        // 命中带保持连续，便于点选
    },
    _straightSelStroke: function(strokeWidth) {
        return Math.min(this.STRAIGHT_STROKE_MAX, strokeWidth + 1.5);
    },
    _straightCapScale: function(capR) {
        return capR / this.STRAIGHT_CAP_R;
    },
    /** 可视端点可变小；点选热区至少保持 STRAIGHT_CAP_HIT_R，端点变大时热区同步放大 */
    _straightCapHitR: function(capR) {
        const scale = this._straightCapScale(capR);
        return Math.max(this.STRAIGHT_CAP_HIT_R, this.STRAIGHT_CAP_HIT_R * scale);
    },
    _straightCapRingR: function(capR) {
        const scale = this._straightCapScale(capR);
        const base = this.STRAIGHT_CAP_R_SEL + this.STRAIGHT_CAP_RING_EXTRA;
        // 选中环也不因端点极小而缩到难辨
        return Math.max(base * 0.85, base * scale);
    },
    _straightDisplayOpacity: function(userOpacity, isOccluded) {
        if (!isOccluded) return userOpacity;
        return userOpacity * (this.STRAIGHT_OCCLUDE_OPACITY / this.STRAIGHT_OPACITY);
    },
    _applyStraightStrokeAttrs: function(data, isSelected) {
        if (!data || !this._isBezierKind(data)) return;
        const app = this.getStraightAppearance(data);
        const w = isSelected ? this._straightSelStroke(app.strokeWidth) : app.strokeWidth;
        const glowW = this.STRAIGHT_GLOW * (app.strokeWidth / this.STRAIGHT_STROKE);
        const hitW = 28 * (app.strokeWidth / this.STRAIGHT_STROKE);
        if (data.svgPath) data.svgPath.setAttribute('stroke-width', String(w));
        if (data.svgGlowPath) {
            data.svgGlowPath.setAttribute('stroke-width', String(glowW));
            data.svgGlowPath.setAttribute('opacity', isSelected ? '0.5' : '0.2');
        }
        if (data.svgHitPath) data.svgHitPath.setAttribute('stroke-width', String(Math.max(20, hitW)));
        this._applyLineStyleToPaths(data, app.lineStyle);
        const isPrimary = isSelected && this.selectedId === data.id;
        const capR = isPrimary ? (app.capR + 1.5) : app.capR;
        if (data.svgEndCapA) data.svgEndCapA.setAttribute('r', String(capR));
        if (data.svgEndCapB) data.svgEndCapB.setAttribute('r', String(capR));
        // 多选时仅主选中项显示锚点/柄；其余只加粗高亮
        this._syncStraightEndpointHandles(data, isPrimary);
        this._syncBezierEditOverlay(data, isPrimary);
    },
    _applyStraightOpacityAttrs: function(data, isOccluded) {
        if (!data) return;
        let opacity;
        if (this._isBezierKind(data)) {
            const app = this.getStraightAppearance(data);
            opacity = this._straightDisplayOpacity(app.opacity, isOccluded);
        } else {
            opacity = isOccluded ? this.STRAIGHT_OCCLUDE_OPACITY : this.STRAIGHT_OPACITY;
        }
        const opStr = String(opacity);
        if (data.svgPath) data.svgPath.setAttribute('opacity', opStr);
        if (data.svgEndCapA) data.svgEndCapA.setAttribute('opacity', opStr);
        if (data.svgEndCapB) data.svgEndCapB.setAttribute('opacity', opStr);
        if (data.svgEndCapRingA) data.svgEndCapRingA.setAttribute('opacity', opStr);
        if (data.svgEndCapRingB) data.svgEndCapRingB.setAttribute('opacity', opStr);
        if (data.domEl) data.domEl.style.opacity = isOccluded ? '0.3' : '1';
    },
    /** 生产端滑条即时刷新；写回并规范化字段 */
    applyStraightAppearance: function(data, partial) {
        if (!data || !this._isBezierKind(data)) return null;
        if (partial && typeof partial === 'object') {
            if (partial.strokeWidth != null) data.strokeWidth = this._clampNum(partial.strokeWidth, this.STRAIGHT_STROKE_MIN, this.STRAIGHT_STROKE_MAX, this.STRAIGHT_STROKE);
            if (partial.opacity != null) data.opacity = this._clampNum(partial.opacity, this.STRAIGHT_OPACITY_MIN, this.STRAIGHT_OPACITY_MAX, this.STRAIGHT_OPACITY);
            if (partial.capR != null) data.capR = this._clampNum(partial.capR, this.STRAIGHT_CAP_R_MIN, this.STRAIGHT_CAP_R_MAX, this.STRAIGHT_CAP_R);
            if (partial.capDiameter != null) {
                data.capR = this._clampNum(partial.capDiameter / 2, this.STRAIGHT_CAP_R_MIN, this.STRAIGHT_CAP_R_MAX, this.STRAIGHT_CAP_R);
            }
            if (partial.lineStyle != null) data.lineStyle = this._normalizeLineStyle(partial.lineStyle);
        }
        const app = this.getStraightAppearance(data);
        data.strokeWidth = app.strokeWidth;
        data.opacity = app.opacity;
        data.capR = app.capR;
        data.lineStyle = app.lineStyle;
        data.lastOccluded = undefined;
        const isSel = this._isLineSelected(data.id);
        this._applyStraightStrokeAttrs(data, isSel);
        this._applyStraightOpacityAttrs(data, !!data.isOccluded);
        window.needsUpdate = true;
        try { if (typeof window.markDraftDirty === 'function') window.markDraftDirty(); } catch (_e) {}
        return app;
    },
    /** 当前多选中的贝塞尔（含旧 straight）；无则空数组 */
    getSelectedBezierLines: function() {
        this._normalizeSelectedIds();
        const ids = (this.selectedIds && this.selectedIds.length) ? this.selectedIds : (this.selectedId != null ? [this.selectedId] : []);
        const out = [];
        for (let i = 0; i < ids.length; i++) {
            const d = window.dashedLineList.find(a => a.id === ids[i]);
            if (d && this._isBezierKind(d)) out.push(d);
        }
        return out;
    },
    /** 批量写外观；返回主选中项规范化后的外观（供滑条回显） */
    applyStraightAppearanceToSelection: function(partial) {
        const list = this.getSelectedBezierLines();
        if (!list.length) return null;
        let last = null;
        for (let i = 0; i < list.length; i++) {
            last = this.applyStraightAppearance(list[i], partial);
        }
        return last;
    },
    _isLineSelected: function(id) {
        if (id == null) return false;
        if (this.selectedIds && this.selectedIds.indexOf(id) >= 0) return true;
        return this.selectedId === id;
    },
    _normalizeSelectedIds: function() {
        if (!Array.isArray(this.selectedIds)) this.selectedIds = [];
        if (this.selectedId == null) {
            if (this.selectedIds.length) this.selectedIds = [];
            return;
        }
        if (!this.selectedIds.length) this.selectedIds = [this.selectedId];
    },
    _clearOtherPluginSelections: function() {
        if (!window.PluginManager || !window.PluginManager.plugins) return;
        window.PluginManager.plugins.forEach(p => {
            const inst = p.instance;
            if (!inst || inst === this || inst.selectedId === undefined) return;
            if (inst.selectedId !== null) {
                inst.selectedId = null;
                if (Array.isArray(inst.selectedIds)) inst.selectedIds = [];
                if (typeof inst.highlightSelected === 'function') inst.highlightSelected();
            }
        });
    },
    /** 点选虚线/贝塞尔：普通单击单选；Ctrl/Cmd+点贝塞尔可多选（用于批量外观） */
    _selectLineFromPointer: function(data, e) {
        if (!data) return;
        const ctrl = !!(e && (e.ctrlKey || e.metaKey));
        if (window.__SOLID_CONSUMER__) {
            if (window.PluginManager && typeof window.PluginManager.setExclusiveSelection === 'function') {
                if (this.selectedId === data.id) window.PluginManager.setExclusiveSelection(this, null);
                else window.PluginManager.setExclusiveSelection(this, data.id);
            }
            if (Array.isArray(this.selectedIds)) {
                this.selectedIds = this.selectedId != null ? [this.selectedId] : [];
            }
            return;
        }
        if (!Array.isArray(this.selectedIds)) this.selectedIds = [];
        if (ctrl && this._isBezierKind(data)) {
            this._clearOtherPluginSelections();
            const i = this.selectedIds.indexOf(data.id);
            if (i >= 0) {
                this.selectedIds.splice(i, 1);
                this.selectedId = this.selectedIds.length ? this.selectedIds[this.selectedIds.length - 1] : null;
            } else {
                // 多选仅保留贝塞尔；若当前选中含非贝塞尔则清掉
                this.selectedIds = this.selectedIds.filter(id => {
                    const d = window.dashedLineList.find(a => a.id === id);
                    return d && this._isBezierKind(d);
                });
                this.selectedIds.push(data.id);
                this.selectedId = data.id;
            }
            this._clearBezierEditFocus();
            this.highlightSelected();
            if (window.needsUpdate !== undefined) window.needsUpdate = true;
            const primary = window.dashedLineList.find(a => a.id === this.selectedId);
            const picker = document.getElementById('obj-color-picker');
            if (picker && primary) picker.value = primary.color;
            try { if (typeof window.syncSharedAnnoObjColorPickers === 'function') window.syncSharedAnnoObjColorPickers('obj'); } catch (_e1) {}
            try { if (typeof window.solidCreateSyncAnnoDetailPanel === 'function') window.solidCreateSyncAnnoDetailPanel(); } catch (_e2) {}
            if (window.PluginManager && typeof window.PluginManager._syncSolidConsumerDetail === 'function') {
                try { window.PluginManager._syncSolidConsumerDetail(this, this.selectedId); } catch (_e3) {}
            }
            return;
        }
        this.selectedIds = [data.id];
        if (window.PluginManager && typeof window.PluginManager.setExclusiveSelection === 'function') {
            window.PluginManager.setExclusiveSelection(this, data.id);
        } else {
            this.selectedId = data.id;
            this.highlightSelected();
        }
        // setExclusiveSelection 可能不保留 selectedIds，再写一次
        this.selectedIds = [data.id];
        this._clearBezierEditFocus();
        const picker = document.getElementById('obj-color-picker');
        if (picker) picker.value = data.color;
        try { if (typeof window.syncSharedAnnoObjColorPickers === 'function') window.syncSharedAnnoObjColorPickers('obj'); } catch (_e4) {}
    },
    ensureDOM: function() { if (!document.getElementById('dashed-line-layer')) { const layer = document.createElement('div'); layer.id = 'dashed-line-layer';
    // z-index: 48 确保在底层，不干扰法线和引线点击
    layer.style.cssText = 'position: absolute; top: 0; left: 0; width: 100vw; height: 100vh; pointer-events: none; z-index: 48; overflow: hidden;'; layer.innerHTML = '<svg id="dashed-line-svg" style="width: 100%; height: 100%; pointer-events: none;"></svg>'; document.body.appendChild(layer); // 独立挂载颜色拾取器联动
    const colorPicker = document.getElementById('obj-color-picker'); if (colorPicker) { colorPicker.addEventListener('input', e => { if (this.selectedId !== null) {
    const targets = (typeof this.getSelectedBezierLines === 'function') ? this.getSelectedBezierLines() : [];
    const list = targets.length ? targets : [window.dashedLineList.find(a => a.id === this.selectedId)].filter(Boolean);
    list.forEach(data => { if (!data) return; data.color = e.target.value; if (data.domEl) { data.domEl.dataset.color = data.color; data.domEl.style.borderColor = data.color; }
    if (data.svgPath) data.svgPath.setAttribute("stroke", data.color); if (data.svgGlowPath) data.svgGlowPath.setAttribute("stroke", data.color);
    if (data.svgEndCapA) data.svgEndCapA.setAttribute("fill", data.color); if (data.svgEndCapB) data.svgEndCapB.setAttribute("fill", data.color);
    if (data.svgEndCapRingA) data.svgEndCapRingA.setAttribute("stroke", data.color); if (data.svgEndCapRingB) data.svgEndCapRingB.setAttribute("stroke", data.color);
    this._tintBezierOverlay(data); }); window.needsUpdate = true; } }); } } },
    _makeLocalPoint: function(anchorObj, worldPos, worldNormal) {
        const localPos = anchorObj.worldToLocal(worldPos.clone());
        let localNormal = worldNormal.clone();
        const parent = anchorObj.parent;
        if (parent) {
            if (!this._invNormalMat) this._invNormalMat = new THREE.Matrix3();
            if (!this._invWorldMat) this._invWorldMat = new THREE.Matrix4();
            this._invWorldMat.copy(parent.matrixWorld).invert();
            this._invNormalMat.getNormalMatrix(this._invWorldMat);
            localNormal.applyMatrix3(this._invNormalMat).normalize();
        }
        return { localPos: localPos, localNormal: localNormal };
    },
    _raycastHit: function(clientX, clientY) {
        if (!this._cachedCamera || !this._cachedScene) return null;
        if (!this._raycaster) this._raycaster = new THREE.Raycaster();
        if (!this._ndc) this._ndc = new THREE.Vector2();
        this._ndc.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
        this._raycaster.setFromCamera(this._ndc, this._cachedCamera);
        const intersects = this._raycaster.intersectObjects(this._cachedScene.children, true)
            .filter(res => res.object.isMesh && res.object.visible && res.object.name !== 'transformControl' && !(res.object.name && res.object.name.includes('helper')));
        return intersects.length ? intersects[0] : null;
    },
    _worldNormalFromHit: function(hit) {
        return hit.face
            ? hit.face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize()
            : new THREE.Vector3(0, 1, 0);
    },
    _isUnderRoot: function(obj, root) {
        let cur = obj;
        while (cur) {
            if (cur === root) return true;
            cur = cur.parent;
        }
        return false;
    },
    _raycastHitOnAnchorParent: function(clientX, clientY, parentObj) {
        if (!parentObj || !this._cachedCamera || !this._cachedScene) return null;
        if (!this._raycaster) this._raycaster = new THREE.Raycaster();
        if (!this._ndc) this._ndc = new THREE.Vector2();
        this._ndc.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
        this._raycaster.setFromCamera(this._ndc, this._cachedCamera);
        const intersects = this._raycaster.intersectObjects(this._cachedScene.children, true)
            .filter(res => res.object.isMesh && res.object.visible && res.object.name !== 'transformControl' && !(res.object.name && res.object.name.includes('helper')));
        for (let i = 0; i < intersects.length; i++) {
            const res = intersects[i];
            if (res.object === parentObj || this._isUnderRoot(res.object, parentObj)) return res;
        }
        return null;
    },
    /** 投面多点线拖端点前收为首尾 + 默认柄，并清除 projected */
    _collapseStraightToEndpoints: function(data) {
        if (!data || !data.points || data.points.length < 2) return false;
        const changed = data.points.length > 2 || data.projected === true;
        const a = data.points[0];
        const b = data.points[data.points.length - 1];
        data.points = [
            { localPos: a.localPos.clone(), localNormal: a.localNormal.clone() },
            { localPos: b.localPos.clone(), localNormal: b.localNormal.clone() }
        ];
        delete data.projected;
        data.kind = 'bezier';
        this._ensureDefaultHandles(data);
        data.midIndex = 1;
        data.lastDStr = '';
        data.lastOccluded = undefined;
        this._clearBezierEditFocus();
        return changed;
    },
    _canInteractStraightEndpoint: function(e) {
        if (window.__SOLID_CONSUMER__) return false;
        if (window.PluginManager && window.PluginManager.shouldBlockAnnoSelection(e)) return false;
        if (e && e.button != null && e.button !== 0) return false;
        if (window.currentEditorMode === 'annotate' || window.currentEditorMode === 'annotate-color' || window.currentEditorMode === 'normal-arrow') return false;
        if (window.currentEditorMode === 'dashed-line' && this.isDrawing) return false;
        if (window.currentEditorMode === 'straight-line' && this._straightPending) return false;
        return true;
    },
    _pauseOrbitForEndpointDrag: function() {
        if (this._straightEndpointOrbitWasEnabled !== null) return;
        try {
            if (window.controls) {
                this._straightEndpointOrbitWasEnabled = !!window.controls.enabled;
                window.controls.enabled = false;
            } else { this._straightEndpointOrbitWasEnabled = null; }
        } catch (_e) { this._straightEndpointOrbitWasEnabled = null; }
    },
    _resumeOrbitForEndpointDrag: function() {
        if (this._straightEndpointOrbitWasEnabled !== null) {
            try { if (window.controls) window.controls.enabled = this._straightEndpointOrbitWasEnabled; } catch (_e2) {}
            this._straightEndpointOrbitWasEnabled = null;
        }
    },
    _syncStraightEndpointHandles: function(data, isSelected) {
        if (!data || !this._isBezierKind(data)) return;
        const app = this.getStraightAppearance(data);
        const ringR = this._straightCapRingR(app.capR);
        const hitR = this._straightCapHitR(app.capR);
        const dragging = !!(this._straightEndpointDrag && this._straightEndpointDrag.dataId === data.id)
            || !!(this._bezierDrag && this._bezierDrag.dataId === data.id);
        const editable = this.isEditableBezier(data);
        // 未投面选中时端点命中交给锚点层；投面仍用端点命中圈拖（会先收成两端）
        const canDragEnds = isSelected && !window.__SOLID_CONSUMER__ && (!editable || this._isProjectedPolyline(data));
        if (data.svgEndCapRingA) {
            data.svgEndCapRingA.setAttribute("r", String(ringR));
            data.svgEndCapRingA.setAttribute("stroke", data.color);
            data.svgEndCapRingA.style.display = (isSelected && !window.__SOLID_CONSUMER__ && !editable) ? "" : "none";
        }
        if (data.svgEndCapRingB) {
            data.svgEndCapRingB.setAttribute("r", String(ringR));
            data.svgEndCapRingB.setAttribute("stroke", data.color);
            data.svgEndCapRingB.style.display = (isSelected && !window.__SOLID_CONSUMER__ && !editable) ? "" : "none";
        }
        [data.svgEndCapHitA, data.svgEndCapHitB].forEach(hit => {
            if (!hit) return;
            hit.setAttribute("r", String(hitR));
            hit.style.pointerEvents = canDragEnds ? "auto" : "none";
            hit.style.cursor = dragging ? "grabbing" : (canDragEnds ? "grab" : "default");
        });
    },
    _removeBezierOverlay: function(data) {
        if (!data) return;
        if (data.svgAnchorGroup) {
            try { data.svgAnchorGroup.remove(); } catch (_e) {}
            data.svgAnchorGroup = null;
        }
        data.svgAnchors = null;
        data.svgHandleIn = null;
        data.svgHandleOut = null;
        data.svgHandleLineIn = null;
        data.svgHandleLineOut = null;
        data.svgHandleHitIn = null;
        data.svgHandleHitOut = null;
    },
    _tintBezierOverlay: function(data) {
        if (!data || !data.svgAnchors) return;
        data.svgAnchors.forEach(c => { if (c) c.setAttribute('fill', data.color); });
        if (data.svgHandleIn) data.svgHandleIn.setAttribute('fill', data.color);
        if (data.svgHandleOut) data.svgHandleOut.setAttribute('fill', data.color);
        if (data.svgHandleLineIn) data.svgHandleLineIn.setAttribute('stroke', data.color);
        if (data.svgHandleLineOut) data.svgHandleLineOut.setAttribute('stroke', data.color);
    },
    _ensureBezierOverlay: function(data) {
        if (!data || data.svgAnchorGroup) return;
        const svg = document.getElementById('dashed-line-svg');
        if (!svg) return;
        const ns = 'http://www.w3.org/2000/svg';
        const g = document.createElementNS(ns, 'g');
        g.setAttribute('data-bezier-edit', data.id);
        g.style.pointerEvents = 'none';
        svg.appendChild(g);
        data.svgAnchorGroup = g;
        data.svgAnchors = [];
        const mkLine = () => {
            const l = document.createElementNS(ns, 'line');
            l.setAttribute('stroke', data.color);
            l.setAttribute('stroke-width', '1.5');
            l.setAttribute('opacity', '0.75');
            l.style.pointerEvents = 'none';
            l.style.display = 'none';
            g.appendChild(l);
            return l;
        };
        const mkHandle = () => {
            const c = document.createElementNS(ns, 'circle');
            c.setAttribute('r', String(this.HANDLE_R));
            c.setAttribute('fill', data.color);
            c.setAttribute('stroke', '#fff');
            c.setAttribute('stroke-width', '1');
            c.style.pointerEvents = 'none';
            c.style.display = 'none';
            g.appendChild(c);
            return c;
        };
        const mkHandleHit = (side) => {
            const c = document.createElementNS(ns, 'circle');
            c.setAttribute('r', String(this.HANDLE_HIT_R));
            c.setAttribute('fill', 'transparent');
            c.style.pointerEvents = 'none';
            c.style.cursor = 'grab';
            c.style.display = 'none';
            c.addEventListener('pointerdown', e => {
                if (!this._canInteractStraightEndpoint(e)) return;
                if (this.selectedId !== data.id) return;
                this._beginBezierHandleDrag(data, side, e);
            }, { passive: false });
            g.appendChild(c);
            return c;
        };
        data.svgHandleLineIn = mkLine();
        data.svgHandleLineOut = mkLine();
        data.svgHandleIn = mkHandle();
        data.svgHandleOut = mkHandle();
        data.svgHandleHitIn = mkHandleHit('in');
        data.svgHandleHitOut = mkHandleHit('out');
    },
    _syncBezierEditOverlay: function(data, isSelected) {
        if (!data || !this._isBezierKind(data)) return;
        const editable = this.isEditableBezier(data);
        const show = isSelected && editable && !window.__SOLID_CONSUMER__;
        if (!show) {
            if (data.svgAnchorGroup) data.svgAnchorGroup.style.display = 'none';
            return;
        }
        this._ensureBezierOverlay(data);
        if (!data.svgAnchorGroup) return;
        data.svgAnchorGroup.style.display = '';
        const n = data.points.length;
        const ns = 'http://www.w3.org/2000/svg';
        while (data.svgAnchors.length < n) {
            const idx = data.svgAnchors.length;
            const c = document.createElementNS(ns, 'circle');
            c.setAttribute('r', String(this.ANCHOR_R));
            c.setAttribute('fill', data.color);
            c.setAttribute('stroke', '#fff');
            c.setAttribute('stroke-width', '1.5');
            c.style.pointerEvents = 'auto';
            c.style.cursor = 'grab';
            c.addEventListener('pointerdown', e => {
                if (!this._canInteractStraightEndpoint(e)) return;
                if (this.selectedId !== data.id) return;
                const altOnly = !!(e.altKey || (typeof e.getModifierState === 'function' && e.getModifierState('Alt')))
                    && !(e.shiftKey || (typeof e.getModifierState === 'function' && e.getModifierState('Shift')))
                    && !e.ctrlKey && !e.metaKey;
                if (altOnly) {
                    e.stopPropagation();
                    try { if (e.cancelable) e.preventDefault(); } catch (_ePrev) {}
                    this.selectedAnchorIndex = idx;
                    this.selectedHandleSide = null;
                    this._collapseBezierAnchorHandles(data, idx);
                    return;
                }
                this.selectedAnchorIndex = idx;
                this.selectedHandleSide = null;
                this._beginBezierAnchorDrag(data, idx, e);
            }, { passive: false });
            // 插在手柄线之前，保证柄在上层
            data.svgAnchorGroup.insertBefore(c, data.svgHandleLineIn);
            data.svgAnchors.push(c);
        }
        for (let i = 0; i < data.svgAnchors.length; i++) {
            const c = data.svgAnchors[i];
            if (i < n) {
                c.style.display = '';
                const focus = this.selectedAnchorIndex === i;
                c.setAttribute('r', String(focus ? this.ANCHOR_R + 1.5 : this.ANCHOR_R));
                c.setAttribute('stroke-width', focus ? '2.5' : '1.5');
            } else {
                c.style.display = 'none';
            }
        }
    },
    _projectLocalToScreen: function(anchorObj, localPos, camera, out) {
        if (!this._tempV) this._tempV = new THREE.Vector3();
        this._tempV.copy(localPos);
        anchorObj.localToWorld(this._tempV);
        this._tempV.project(camera);
        const behind = this._tempV.z > 1.0 || this._tempV.z < -1.0;
        const x = (this._tempV.x * 0.5 + 0.5) * window.innerWidth;
        const y = (-(this._tempV.y * 0.5) + 0.5) * window.innerHeight;
        if (out) { out.x = x; out.y = y; out.behind = behind || isNaN(x) || isNaN(y); }
        return !(behind || isNaN(x) || isNaN(y));
    },
    _localHandlePos: function(pt, side) {
        if (!pt || !pt.localPos) return null;
        const h = side === 'in' ? pt.handleIn : pt.handleOut;
        if (!h) return null;
        return pt.localPos.clone().add(h);
    },
    _cubicEval: function(p0, p1, p2, p3, t, out) {
        const u = 1 - t;
        const uu = u * u;
        const uuu = uu * u;
        const tt = t * t;
        const ttt = tt * t;
        out.x = uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x;
        out.y = uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y;
        return out;
    },
    _buildScreenPathForData: function(data, camera) {
        const pts = data.points;
        let dStr = '';
        let midX = 0, midY = 0, midVisible = false;
        let capAX = null, capAY = null, capBX = null, capBY = null;
        const screenAnchors = [];
        const editable = this.isEditableBezier(data);
        if (!this._scrA) {
            this._scrA = { x: 0, y: 0, behind: false };
            this._scrB = { x: 0, y: 0, behind: false };
            this._scrC = { x: 0, y: 0, behind: false };
            this._scrD = { x: 0, y: 0, behind: false };
            this._scrTmp = { x: 0, y: 0 };
            this._localTmp = new THREE.Vector3();
        }
        if (editable) {
            this._ensureDefaultHandles(data);
            for (let i = 0; i < pts.length; i++) {
                const ok = this._projectLocalToScreen(data.anchorObj, pts[i].localPos, camera, this._scrA);
                if (ok) {
                    screenAnchors.push({ x: this._scrA.x, y: this._scrA.y, ok: true });
                    if (i === 0) { capAX = this._scrA.x; capAY = this._scrA.y; }
                    if (i === pts.length - 1) { capBX = this._scrA.x; capBY = this._scrA.y; }
                    if (i === data.midIndex && !this.isDrawing) { midX = this._scrA.x; midY = this._scrA.y; midVisible = true; }
                } else {
                    screenAnchors.push({ x: 0, y: 0, ok: false });
                }
            }
            for (let i = 0; i < pts.length - 1; i++) {
                const a = pts[i];
                const b = pts[i + 1];
                const ok0 = this._projectLocalToScreen(data.anchorObj, a.localPos, camera, this._scrA);
                this._localTmp.copy(a.localPos);
                if (a.handleOut) this._localTmp.add(a.handleOut);
                const ok1 = this._projectLocalToScreen(data.anchorObj, this._localTmp, camera, this._scrB);
                this._localTmp.copy(b.localPos);
                if (b.handleIn) this._localTmp.add(b.handleIn);
                const ok2 = this._projectLocalToScreen(data.anchorObj, this._localTmp, camera, this._scrC);
                const ok3 = this._projectLocalToScreen(data.anchorObj, b.localPos, camera, this._scrD);
                if (!(ok0 && ok1 && ok2 && ok3)) continue;
                if (dStr.length === 0) dStr += `M ${this._scrA.x} ${this._scrA.y} `;
                dStr += `C ${this._scrB.x} ${this._scrB.y} ${this._scrC.x} ${this._scrC.y} ${this._scrD.x} ${this._scrD.y} `;
            }
        } else {
            for (let i = 0; i < pts.length; i++) {
                const ok = this._projectLocalToScreen(data.anchorObj, pts[i].localPos, camera, this._scrA);
                if (!ok) { screenAnchors.push({ x: 0, y: 0, ok: false }); continue; }
                screenAnchors.push({ x: this._scrA.x, y: this._scrA.y, ok: true });
                dStr += `${dStr.length === 0 ? 'M' : 'L'} ${this._scrA.x} ${this._scrA.y} `;
                if (i === data.midIndex && !this.isDrawing) { midX = this._scrA.x; midY = this._scrA.y; midVisible = true; }
                if (i === 0) { capAX = this._scrA.x; capAY = this._scrA.y; }
                if (i === pts.length - 1) { capBX = this._scrA.x; capBY = this._scrA.y; }
            }
        }
        return { dStr: dStr, midX: midX, midY: midY, midVisible: midVisible, capAX: capAX, capAY: capAY, capBX: capBX, capBY: capBY, screenAnchors: screenAnchors };
    },
    _updateBezierHandlesScreen: function(data, camera) {
        if (!data || !data.svgAnchorGroup || data.svgAnchorGroup.style.display === 'none') return;
        const idx = this.selectedAnchorIndex;
        const showH = idx != null && data.points[idx] && this.isEditableBezier(data);
        const hideAll = () => {
            [data.svgHandleIn, data.svgHandleOut, data.svgHandleHitIn, data.svgHandleHitOut,
                data.svgHandleLineIn, data.svgHandleLineOut].forEach(el => { if (el) el.style.display = 'none'; });
        };
        if (!showH) { hideAll(); return; }
        const pt = data.points[idx];
        if (!this._scrA) return;
        const okA = this._projectLocalToScreen(data.anchorObj, pt.localPos, camera, this._scrA);
        if (!okA) { hideAll(); return; }
        const ax = this._scrA.x, ay = this._scrA.y;
        const placeHandle = (side, circle, hit, line) => {
            const h = side === 'in' ? pt.handleIn : pt.handleOut;
            if (this._isHandleCollapsed(h) || (side === 'in' && idx === 0) || (side === 'out' && idx === data.points.length - 1)) {
                if (circle) circle.style.display = 'none';
                if (hit) hit.style.display = 'none';
                if (line) line.style.display = 'none';
                return;
            }
            this._localTmp.copy(pt.localPos).add(h);
            const ok = this._projectLocalToScreen(data.anchorObj, this._localTmp, camera, this._scrB);
            if (!ok) {
                if (circle) circle.style.display = 'none';
                if (hit) hit.style.display = 'none';
                if (line) line.style.display = 'none';
                return;
            }
            if (line) {
                line.setAttribute('x1', String(ax)); line.setAttribute('y1', String(ay));
                line.setAttribute('x2', String(this._scrB.x)); line.setAttribute('y2', String(this._scrB.y));
                line.style.display = '';
            }
            if (circle) {
                circle.setAttribute('cx', String(this._scrB.x)); circle.setAttribute('cy', String(this._scrB.y));
                circle.style.display = '';
            }
            if (hit) {
                hit.setAttribute('cx', String(this._scrB.x)); hit.setAttribute('cy', String(this._scrB.y));
                hit.style.display = '';
                hit.style.pointerEvents = 'auto';
            }
        };
        placeHandle('in', data.svgHandleIn, data.svgHandleHitIn, data.svgHandleLineIn);
        placeHandle('out', data.svgHandleOut, data.svgHandleHitOut, data.svgHandleLineOut);
    },
    _cleanupBezierDragListeners: function() {
        const st = this._bezierDrag;
        if (!st || !st.captureEl) return;
        if (st.onMove) {
            try { st.captureEl.removeEventListener('pointermove', st.onMove, { passive: false }); } catch (_e1) { try { st.captureEl.removeEventListener('pointermove', st.onMove); } catch (_e1b) {} }
        }
        if (st.onUp) {
            st.captureEl.removeEventListener('pointerup', st.onUp);
            st.captureEl.removeEventListener('pointercancel', st.onUp);
        }
    },
    _endBezierDrag: function(e) {
        const st = this._bezierDrag;
        if (!st) return;
        if (e && st.pointerId !== undefined && e.pointerId !== undefined && e.pointerId !== st.pointerId) return;
        const data = window.dashedLineList.find(a => a.id === st.dataId);
        this._cleanupBezierDragListeners();
        if (st.captureEl && e) { try { st.captureEl.releasePointerCapture(e.pointerId); } catch (_eRel) {} }
        this._bezierDrag = null;
        this._resumeOrbitForEndpointDrag();
        if (data) {
            this._syncStraightEndpointHandles(data, this.selectedId === data.id);
            this._syncBezierEditOverlay(data, this.selectedId === data.id);
            if (st.moved) {
                window.needsUpdate = true;
                window.lightMoved = true;
                try { if (typeof window.markDraftDirty === 'function') window.markDraftDirty(); } catch (_e) {}
            }
        }
        try { if (typeof window.solidCreateSyncAnnoDetailPanel === 'function') window.solidCreateSyncAnnoDetailPanel(); } catch (_e2) {}
    },
    _moveBezierAnchorDrag: function(e) {
        const st = this._bezierDrag;
        if (!st || st.type !== 'anchor' || !e) return;
        if (st.pointerId !== undefined && e.pointerId !== undefined && e.pointerId !== st.pointerId) return;
        const data = window.dashedLineList.find(a => a.id === st.dataId);
        if (!data || !data.anchorObj || !data.anchorObj.parent || !data.points || !data.points[st.index]) return;
        const parentObj = data.anchorObj.parent;
        const hit = this._raycastHitOnAnchorParent(e.clientX, e.clientY, parentObj);
        if (!hit) return;
        const pt = data.points[st.index];
        const wn = this._worldNormalFromHit(hit);
        const lp = this._makeLocalPoint(data.anchorObj, hit.point, wn);
        pt.localPos.copy(lp.localPos);
        pt.localNormal.copy(lp.localNormal);
        data.lastDStr = '';
        st.moved = true;
        window.needsUpdate = true;
        try { if (e.cancelable) e.preventDefault(); } catch (_ePrev) {}
    },
    _moveBezierHandleDrag: function(e) {
        const st = this._bezierDrag;
        if (!st || st.type !== 'handle' || !e) return;
        if (st.pointerId !== undefined && e.pointerId !== undefined && e.pointerId !== st.pointerId) return;
        const data = window.dashedLineList.find(a => a.id === st.dataId);
        if (!data || !data.anchorObj || !data.anchorObj.parent || !data.points || !data.points[st.index]) return;
        const parentObj = data.anchorObj.parent;
        const hit = this._raycastHitOnAnchorParent(e.clientX, e.clientY, parentObj);
        if (!hit) return;
        const pt = data.points[st.index];
        const lp = data.anchorObj.worldToLocal(hit.point.clone());
        const offset = lp.sub(pt.localPos);
        if (st.side === 'in') pt.handleIn = offset.clone();
        else pt.handleOut = offset.clone();
        if (e.shiftKey && st.index > 0 && st.index < data.points.length - 1) {
            const mirror = offset.clone().multiplyScalar(-1);
            if (st.side === 'in') pt.handleOut = mirror;
            else pt.handleIn = mirror;
        }
        data.lastDStr = '';
        st.moved = true;
        window.needsUpdate = true;
        try { if (e.cancelable) e.preventDefault(); } catch (_ePrev) {}
    },
    _beginBezierAnchorDrag: function(data, index, e) {
        if (!this._canInteractStraightEndpoint(e)) return;
        if (!data || !this.isEditableBezier(data) || !data.points[index]) return;
        // Alt（无 Shift）单击锚点：收起控制柄，不进入拖拽
        const altOnly = e && (e.altKey || (typeof e.getModifierState === 'function' && e.getModifierState('Alt')))
            && !(e.shiftKey || (typeof e.getModifierState === 'function' && e.getModifierState('Shift')))
            && !e.ctrlKey && !e.metaKey;
        if (altOnly) {
            e.stopPropagation();
            try { if (e.cancelable) e.preventDefault(); } catch (_ePrev0) {}
            if (this.selectedId !== data.id) {
                if (window.PluginManager && typeof window.PluginManager.setExclusiveSelection === 'function') {
                    window.PluginManager.setExclusiveSelection(this, data.id);
                } else { this.selectedId = data.id; this.highlightSelected(); }
            }
            this._collapseBezierAnchorHandles(data, index);
            return;
        }
        if (this._bezierDrag) this._endBezierDrag(e);
        if (this._straightEndpointDrag) this._endStraightEndpointDrag(e);
        e.stopPropagation();
        if (this.selectedId !== data.id) {
            if (window.PluginManager && typeof window.PluginManager.setExclusiveSelection === 'function') {
                window.PluginManager.setExclusiveSelection(this, data.id);
            } else { this.selectedId = data.id; this.highlightSelected(); }
        }
        this.selectedAnchorIndex = index;
        this.selectedHandleSide = null;
        const captureEl = e.currentTarget;
        const onMove = ev => this._moveBezierAnchorDrag(ev);
        const onUp = ev => this._endBezierDrag(ev);
        this._bezierDrag = { type: 'anchor', dataId: data.id, index: index, pointerId: e.pointerId, captureEl: captureEl, onMove: onMove, onUp: onUp, moved: false };
        this._syncBezierEditOverlay(data, true);
        this._pauseOrbitForEndpointDrag();
        try { captureEl.setPointerCapture(e.pointerId); } catch (_eCap) {}
        captureEl.addEventListener('pointermove', onMove, { passive: false });
        captureEl.addEventListener('pointerup', onUp);
        captureEl.addEventListener('pointercancel', onUp);
        if (e.pointerType === 'touch' || e.pointerType === 'pen') {
            try { e.preventDefault(); } catch (_ePrev2) {}
        }
    },
    _beginBezierHandleDrag: function(data, side, e) {
        if (!this._canInteractStraightEndpoint(e)) return;
        if (!data || !this.isEditableBezier(data)) return;
        const index = this.selectedAnchorIndex;
        if (index == null || !data.points[index]) return;
        if (this._bezierDrag) this._endBezierDrag(e);
        if (this._straightEndpointDrag) this._endStraightEndpointDrag(e);
        e.stopPropagation();
        this.selectedHandleSide = side;
        const captureEl = e.currentTarget;
        const onMove = ev => this._moveBezierHandleDrag(ev);
        const onUp = ev => this._endBezierDrag(ev);
        this._bezierDrag = { type: 'handle', dataId: data.id, index: index, side: side, pointerId: e.pointerId, captureEl: captureEl, onMove: onMove, onUp: onUp, moved: false };
        this._pauseOrbitForEndpointDrag();
        try { captureEl.setPointerCapture(e.pointerId); } catch (_eCap) {}
        captureEl.addEventListener('pointermove', onMove, { passive: false });
        captureEl.addEventListener('pointerup', onUp);
        captureEl.addEventListener('pointercancel', onUp);
        if (e.pointerType === 'touch' || e.pointerType === 'pen') {
            try { e.preventDefault(); } catch (_ePrev2) {}
        }
    },
    _cleanupStraightEndpointDragListeners: function() {
        const st = this._straightEndpointDrag;
        if (!st || !st.captureEl) return;
        if (st.onMove) {
            try { st.captureEl.removeEventListener('pointermove', st.onMove, { passive: false }); } catch (_e1) { try { st.captureEl.removeEventListener('pointermove', st.onMove); } catch (_e1b) {} }
        }
        if (st.onUp) {
            st.captureEl.removeEventListener('pointerup', st.onUp);
            st.captureEl.removeEventListener('pointercancel', st.onUp);
        }
    },
    _endStraightEndpointDrag: function(e) {
        const st = this._straightEndpointDrag;
        if (!st) return;
        if (e && st.pointerId !== undefined && e.pointerId !== undefined && e.pointerId !== st.pointerId) return;
        const data = window.dashedLineList.find(a => a.id === st.dataId);
        this._cleanupStraightEndpointDragListeners();
        if (st.captureEl && e) { try { st.captureEl.releasePointerCapture(e.pointerId); } catch (_eRel) {} }
        this._straightEndpointDrag = null;
        this._resumeOrbitForEndpointDrag();
        if (data) {
            this._syncStraightEndpointHandles(data, this.selectedId === data.id);
            if (st.moved) {
                window.needsUpdate = true;
                window.lightMoved = true;
                try { if (typeof window.markDraftDirty === 'function') window.markDraftDirty(); } catch (_e) {}
            }
        }
        try { if (typeof window.solidCreateSyncAnnoDetailPanel === 'function') window.solidCreateSyncAnnoDetailPanel(); } catch (_e2) {}
    },
    _moveStraightEndpointDrag: function(e) {
        const st = this._straightEndpointDrag;
        if (!st || !e) return;
        if (st.pointerId !== undefined && e.pointerId !== undefined && e.pointerId !== st.pointerId) return;
        const data = window.dashedLineList.find(a => a.id === st.dataId);
        if (!data || !data.anchorObj || !data.anchorObj.parent || !data.points || data.points.length < 2) return;
        const parentObj = data.anchorObj.parent;
        const hit = this._raycastHitOnAnchorParent(e.clientX, e.clientY, parentObj);
        if (!hit) return;
        if (!this._dragWorldA) this._dragWorldA = new THREE.Vector3();
        if (!this._dragWorldB) this._dragWorldB = new THREE.Vector3();
        const otherIdx = st.endIndex === 0 ? data.points.length - 1 : 0;
        this._dragWorldA.copy(hit.point);
        this._dragWorldB.copy(data.points[otherIdx].localPos);
        data.anchorObj.localToWorld(this._dragWorldB);
        if (this._dragWorldA.distanceTo(this._dragWorldB) < 0.015) return;
        const wn = this._worldNormalFromHit(hit);
        const lp = this._makeLocalPoint(data.anchorObj, hit.point, wn);
        data.points[st.endIndex].localPos.copy(lp.localPos);
        data.points[st.endIndex].localNormal.copy(lp.localNormal);
        if (this.isEditableBezier(data)) this._ensureDefaultHandles(data);
        data.lastDStr = '';
        st.moved = true;
        window.needsUpdate = true;
        try { if (e.cancelable) e.preventDefault(); } catch (_ePrev) {}
    },
    _beginStraightEndpointDrag: function(data, endIndex, e) {
        if (!this._canInteractStraightEndpoint(e)) return;
        if (!data || !this._isBezierKind(data) || !data.anchorObj || !data.points || data.points.length < 2) return;
        if (this._straightEndpointDrag) this._endStraightEndpointDrag(e);
        if (this._bezierDrag) this._endBezierDrag(e);
        e.stopPropagation();
        if (this.selectedId !== data.id) {
            if (window.PluginManager && typeof window.PluginManager.setExclusiveSelection === 'function') {
                window.PluginManager.setExclusiveSelection(this, data.id);
            } else { this.selectedId = data.id; this.highlightSelected(); }
        }
        const collapsed = this._isProjectedPolyline(data) ? this._collapseStraightToEndpoints(data) : false;
        if (collapsed) data.lastDStr = '';
        const captureEl = e.currentTarget;
        const onMove = ev => this._moveStraightEndpointDrag(ev);
        const onUp = ev => this._endStraightEndpointDrag(ev);
        this._straightEndpointDrag = { dataId: data.id, endIndex: endIndex === 0 ? 0 : (data.points.length - 1), pointerId: e.pointerId, captureEl: captureEl, onMove: onMove, onUp: onUp, moved: false };
        this.selectedAnchorIndex = this._straightEndpointDrag.endIndex;
        this._syncStraightEndpointHandles(data, true);
        this._pauseOrbitForEndpointDrag();
        try { captureEl.setPointerCapture(e.pointerId); } catch (_eCap) {}
        captureEl.addEventListener('pointermove', onMove, { passive: false });
        captureEl.addEventListener('pointerup', onUp);
        captureEl.addEventListener('pointercancel', onUp);
        if (e.pointerType === 'touch' || e.pointerType === 'pen') {
            try { e.preventDefault(); } catch (_ePrev2) {}
        }
        if (collapsed) {
            window.needsUpdate = true;
            try { if (typeof window.solidCreateSyncAnnoDetailPanel === 'function') window.solidCreateSyncAnnoDetailPanel(); } catch (_e3) {}
        }
    },
    /**
     * 取消投面：还原为首尾两端 + 默认柄的可编辑贝塞尔。
     * @returns {{ ok: boolean, reason?: string }}
     */
    unprojectSelectedStraightToChord: function() {
        if (window.__SOLID_CONSUMER__) return { ok: false, reason: 'consumer' };
        if (this.selectedId == null) return { ok: false, reason: 'no_selection' };
        const data = window.dashedLineList.find(a => a.id === this.selectedId);
        if (!data || !this._isBezierKind(data)) return { ok: false, reason: 'not_straight' };
        if (!data.points || data.points.length < 2) return { ok: false, reason: 'bad_data' };
        if (this.isEditableBezier(data) && data.points.length === 2) return { ok: true, reason: 'already_true' };
        this._collapseStraightToEndpoints(data);
        window.needsUpdate = true;
        window.lightMoved = true;
        try { if (typeof window.markDraftDirty === 'function') window.markDraftDirty(); } catch (_e) {}
        if (window.showToast && !window.__SOLID_CONSUMER__) window.showToast('已取消投面（还原为可编辑贝塞尔）');
        return { ok: true };
    },
    /**
     * 将当前选中的贝塞尔：按当前视角把路径屏幕采样投到所属模型外表面（多点折线，projected）。
     * @returns {{ ok: boolean, reason?: string, pointCount?: number }}
     */
    projectSelectedStraightToSurface: function(camera, scene) {
        if (window.__SOLID_CONSUMER__) return { ok: false, reason: 'consumer' };
        if (!camera || !scene) return { ok: false, reason: 'no_camera' };
        if (this.selectedId == null) return { ok: false, reason: 'no_selection' };
        const data = window.dashedLineList.find(a => a.id === this.selectedId);
        if (!data || !this._isBezierKind(data)) return { ok: false, reason: 'not_straight' };
        if (!data.anchorObj || !data.anchorObj.parent || !data.points || data.points.length < 2) {
            return { ok: false, reason: 'bad_data' };
        }
        const root = data.anchorObj.parent;
        if (!this._projTempA) {
            this._projTempA = new THREE.Vector3();
            this._projTempB = new THREE.Vector3();
            this._projNdc = new THREE.Vector2();
            this._projRaycaster = new THREE.Raycaster();
        }
        // 采样屏幕路径：可编辑贝塞尔走曲线；否则走首尾弦
        const samples = [];
        if (this.isEditableBezier(data)) {
            this._ensureDefaultHandles(data);
            if (!this._scrA) {
                this._scrA = { x: 0, y: 0, behind: false };
                this._scrB = { x: 0, y: 0, behind: false };
                this._scrC = { x: 0, y: 0, behind: false };
                this._scrD = { x: 0, y: 0, behind: false };
                this._localTmp = new THREE.Vector3();
            }
            const p0 = { x: 0, y: 0 }, p1 = { x: 0, y: 0 }, p2 = { x: 0, y: 0 }, p3 = { x: 0, y: 0 }, out = { x: 0, y: 0 };
            for (let seg = 0; seg < data.points.length - 1; seg++) {
                const a = data.points[seg], b = data.points[seg + 1];
                if (!this._projectLocalToScreen(data.anchorObj, a.localPos, camera, this._scrA)) continue;
                this._localTmp.copy(a.localPos); if (a.handleOut) this._localTmp.add(a.handleOut);
                if (!this._projectLocalToScreen(data.anchorObj, this._localTmp, camera, this._scrB)) continue;
                this._localTmp.copy(b.localPos); if (b.handleIn) this._localTmp.add(b.handleIn);
                if (!this._projectLocalToScreen(data.anchorObj, this._localTmp, camera, this._scrC)) continue;
                if (!this._projectLocalToScreen(data.anchorObj, b.localPos, camera, this._scrD)) continue;
                p0.x = this._scrA.x; p0.y = this._scrA.y;
                p1.x = this._scrB.x; p1.y = this._scrB.y;
                p2.x = this._scrC.x; p2.y = this._scrC.y;
                p3.x = this._scrD.x; p3.y = this._scrD.y;
                const pixLen = Math.hypot(p3.x - p0.x, p3.y - p0.y) + Math.hypot(p1.x - p0.x, p1.y - p0.y) + Math.hypot(p2.x - p3.x, p2.y - p3.y);
                let n = Math.round(pixLen / 6) + 1;
                n = Math.max(8, Math.min(40, n));
                for (let i = 0; i < n; i++) {
                    const t = n === 1 ? 0 : (i / (n - 1));
                    if (seg > 0 && i === 0) continue;
                    this._cubicEval(p0, p1, p2, p3, t, out);
                    samples.push({ x: out.x, y: out.y });
                }
            }
        } else {
            this._projTempA.copy(data.points[0].localPos);
            data.anchorObj.localToWorld(this._projTempA);
            this._projTempB.copy(data.points[data.points.length - 1].localPos);
            data.anchorObj.localToWorld(this._projTempB);
            this._projTempA.project(camera);
            this._projTempB.project(camera);
            const behindA = this._projTempA.z > 1.0 || this._projTempA.z < -1.0;
            const behindB = this._projTempB.z > 1.0 || this._projTempB.z < -1.0;
            if (behindA || behindB) return { ok: false, reason: 'behind_camera' };
            const x0 = (this._projTempA.x * 0.5 + 0.5) * window.innerWidth;
            const y0 = (-(this._projTempA.y * 0.5) + 0.5) * window.innerHeight;
            const x1 = (this._projTempB.x * 0.5 + 0.5) * window.innerWidth;
            const y1 = (-(this._projTempB.y * 0.5) + 0.5) * window.innerHeight;
            const pixLen = Math.hypot(x1 - x0, y1 - y0);
            if (pixLen < 4) return { ok: false, reason: 'too_short' };
            let n = Math.round(pixLen / 6) + 1;
            n = Math.max(16, Math.min(120, n));
            for (let i = 0; i < n; i++) {
                const t = n === 1 ? 0 : (i / (n - 1));
                samples.push({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t });
            }
        }
        if (samples.length < 3) return { ok: false, reason: 'too_short' };
        const newPts = [];
        for (let i = 0; i < samples.length; i++) {
            const cx = samples[i].x, cy = samples[i].y;
            if (!isFinite(cx) || !isFinite(cy)) continue;
            this._projNdc.set((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1);
            this._projRaycaster.setFromCamera(this._projNdc, camera);
            const hits = this._projRaycaster.intersectObjects(scene.children, true).filter(res => {
                if (!res.object || !res.object.isMesh || !res.object.visible) return false;
                if (res.object.name === 'transformControl') return false;
                if (res.object.name && res.object.name.includes('helper')) return false;
                if (res.object.userData && res.object.userData.solidShadowCore) return false;
                return this._isUnderRoot(res.object, root);
            });
            if (!hits.length) continue;
            const hit = hits[0];
            const wn = this._worldNormalFromHit(hit);
            newPts.push(this._makeLocalPoint(data.anchorObj, hit.point, wn));
        }
        if (newPts.length < 3) return { ok: false, reason: 'too_few_hits', pointCount: newPts.length };
        data.points = newPts;
        data.projected = true;
        data.kind = 'bezier';
        this._stripHandles(data);
        this._clearBezierEditFocus();
        this._removeBezierOverlay(data);
        data.midIndex = Math.floor(newPts.length / 2);
        data.lastDStr = '';
        data.lastOccluded = undefined;
        window.needsUpdate = true;
        window.lightMoved = true;
        try { if (typeof window.markDraftDirty === 'function') window.markDraftDirty(); } catch (_e) {}
        if (window.showToast && !window.__SOLID_CONSUMER__) {
            window.showToast('已投到面（' + newPts.length + ' 点）');
        }
        return { ok: true, pointCount: newPts.length };
    },
    /** 双击曲线插入锚点；返回是否成功 */
    _insertBezierAnchorAtClient: function(data, clientX, clientY, camera) {
        if (!data || !this.isEditableBezier(data) || !camera) return false;
        this._ensureDefaultHandles(data);
        if (!this._scrA) {
            this._scrA = { x: 0, y: 0, behind: false };
            this._scrB = { x: 0, y: 0, behind: false };
            this._scrC = { x: 0, y: 0, behind: false };
            this._scrD = { x: 0, y: 0, behind: false };
            this._localTmp = new THREE.Vector3();
            this._scrTmp = { x: 0, y: 0 };
        }
        let best = null;
        const p0 = { x: 0, y: 0 }, p1 = { x: 0, y: 0 }, p2 = { x: 0, y: 0 }, p3 = { x: 0, y: 0 }, out = { x: 0, y: 0 };
        for (let seg = 0; seg < data.points.length - 1; seg++) {
            const a = data.points[seg], b = data.points[seg + 1];
            if (!this._projectLocalToScreen(data.anchorObj, a.localPos, camera, this._scrA)) continue;
            this._localTmp.copy(a.localPos); if (a.handleOut) this._localTmp.add(a.handleOut);
            if (!this._projectLocalToScreen(data.anchorObj, this._localTmp, camera, this._scrB)) continue;
            this._localTmp.copy(b.localPos); if (b.handleIn) this._localTmp.add(b.handleIn);
            if (!this._projectLocalToScreen(data.anchorObj, this._localTmp, camera, this._scrC)) continue;
            if (!this._projectLocalToScreen(data.anchorObj, b.localPos, camera, this._scrD)) continue;
            p0.x = this._scrA.x; p0.y = this._scrA.y;
            p1.x = this._scrB.x; p1.y = this._scrB.y;
            p2.x = this._scrC.x; p2.y = this._scrC.y;
            p3.x = this._scrD.x; p3.y = this._scrD.y;
            for (let i = 1; i < 20; i++) {
                const t = i / 20;
                this._cubicEval(p0, p1, p2, p3, t, out);
                const dist = Math.hypot(out.x - clientX, out.y - clientY);
                if (!best || dist < best.dist) best = { dist: dist, seg: seg, t: t };
            }
        }
        if (!best || best.dist > 28) return false;
        const a = data.points[best.seg];
        const b = data.points[best.seg + 1];
        const t = best.t;
        // de Casteljau 拆分局部控制点
        const A = a.localPos.clone();
        const B = a.localPos.clone().add(a.handleOut || new THREE.Vector3());
        const C = b.localPos.clone().add(b.handleIn || new THREE.Vector3());
        const D = b.localPos.clone();
        const AB = A.clone().lerp(B, t);
        const BC = B.clone().lerp(C, t);
        const CD = C.clone().lerp(D, t);
        const ABC = AB.clone().lerp(BC, t);
        const BCD = BC.clone().lerp(CD, t);
        const ABCD = ABC.clone().lerp(BCD, t);
        a.handleOut = AB.clone().sub(A);
        b.handleIn = CD.clone().sub(D);
        // 新点：用射线落到表面；失败则沿弦插值
        let newLocal = ABCD;
        let newNormal = a.localNormal.clone().lerp(b.localNormal, t).normalize();
        if (this._cachedScene && data.anchorObj.parent) {
            this._projectLocalToScreen(data.anchorObj, ABCD, camera, this._scrA);
            if (!this._scrA.behind) {
                const hit = this._raycastHitOnAnchorParent(this._scrA.x, this._scrA.y, data.anchorObj.parent);
                if (hit) {
                    const wn = this._worldNormalFromHit(hit);
                    const lp = this._makeLocalPoint(data.anchorObj, hit.point, wn);
                    newLocal = lp.localPos;
                    newNormal = lp.localNormal;
                }
            }
        }
        const newPt = {
            localPos: newLocal.clone(),
            localNormal: newNormal.clone(),
            handleIn: ABC.clone().sub(ABCD),
            handleOut: BCD.clone().sub(ABCD)
        };
        data.points.splice(best.seg + 1, 0, newPt);
        data.midIndex = Math.floor(data.points.length / 2);
        data.lastDStr = '';
        this.selectedAnchorIndex = best.seg + 1;
        this.selectedHandleSide = null;
        this._removeBezierOverlay(data);
        this._syncBezierEditOverlay(data, true);
        window.needsUpdate = true;
        window.lightMoved = true;
        try { if (typeof window.markDraftDirty === 'function') window.markDraftDirty(); } catch (_e) {}
        return true;
    },
    /** 删除当前中间锚点；端点不可删。返回是否删了锚点 */
    deleteSelectedBezierAnchorIfAny: function() {
        if (window.__SOLID_CONSUMER__) return false;
        if (this.selectedId == null) return false;
        const data = window.dashedLineList.find(a => a.id === this.selectedId);
        if (!data || !this.isEditableBezier(data)) return false;
        const idx = this.selectedAnchorIndex;
        if (idx == null || idx <= 0 || idx >= data.points.length - 1) return false;
        data.points.splice(idx, 1);
        data.midIndex = Math.floor(data.points.length / 2);
        data.lastDStr = '';
        this.selectedAnchorIndex = Math.min(idx, data.points.length - 1);
        this.selectedHandleSide = null;
        this._removeBezierOverlay(data);
        this._ensureDefaultHandles(data);
        this._syncBezierEditOverlay(data, true);
        window.needsUpdate = true;
        window.lightMoved = true;
        try { if (typeof window.markDraftDirty === 'function') window.markDraftDirty(); } catch (_e) {}
        try { if (typeof window.solidCreateSyncAnnoDetailPanel === 'function') window.solidCreateSyncAnnoDetailPanel(); } catch (_e2) {}
        return true;
    },
    /** 方向键微调当前锚点或柄（屏上约 3px，Shift 加速） */
    nudgeSelectedBezier: function(dxPx, dyPx) {
        if (window.__SOLID_CONSUMER__) return false;
        if (this.selectedId == null || !this._cachedCamera) return false;
        const data = window.dashedLineList.find(a => a.id === this.selectedId);
        if (!data || !this.isEditableBezier(data) || this.selectedAnchorIndex == null) return false;
        const idx = this.selectedAnchorIndex;
        const pt = data.points[idx];
        if (!pt) return false;
        if (!this._scrA) {
            this._scrA = { x: 0, y: 0, behind: false };
            this._localTmp = new THREE.Vector3();
        }
        let targetLocal;
        if (this.selectedHandleSide === 'in' && pt.handleIn) {
            targetLocal = pt.localPos.clone().add(pt.handleIn);
        } else if (this.selectedHandleSide === 'out' && pt.handleOut) {
            targetLocal = pt.localPos.clone().add(pt.handleOut);
        } else {
            targetLocal = pt.localPos.clone();
        }
        if (!this._projectLocalToScreen(data.anchorObj, targetLocal, this._cachedCamera, this._scrA)) return false;
        const cx = this._scrA.x + dxPx;
        const cy = this._scrA.y + dyPx;
        if (!data.anchorObj.parent) return false;
        const hit = this._raycastHitOnAnchorParent(cx, cy, data.anchorObj.parent);
        if (!hit) return false;
        if (this.selectedHandleSide === 'in' || this.selectedHandleSide === 'out') {
            const lp = data.anchorObj.worldToLocal(hit.point.clone());
            const offset = lp.sub(pt.localPos);
            if (this.selectedHandleSide === 'in') pt.handleIn = offset;
            else pt.handleOut = offset;
        } else {
            const wn = this._worldNormalFromHit(hit);
            const lp = this._makeLocalPoint(data.anchorObj, hit.point, wn);
            pt.localPos.copy(lp.localPos);
            pt.localNormal.copy(lp.localNormal);
        }
        data.lastDStr = '';
        window.needsUpdate = true;
        try { if (typeof window.markDraftDirty === 'function') window.markDraftDirty(); } catch (_e) {}
        return true;
    },
    startLine: function(anchorParent, worldPos, worldNormal) { this.ensureDOM(); this.isDrawing = true; const id = 'dash_line_' + Date.now(); const anchorObj = new THREE.Object3D(); anchorObj.name = id;
    anchorParent.add(anchorObj); // 绑定唯一基站到模型，极大降低 DOM 树深度
    const picker = document.getElementById('obj-color-picker');
    const color = (picker && picker.value) ? picker.value : '#00d2ff';
    const data = { id: id, anchorObj: anchorObj, color: color, text: "线段 " + (++window.dashedLineCounter), detailText: '', kind: 'dashed', points: [], // 纯内存数据阵列: { localPos, localNormal }
    midIndex: 0, isOccluded: false, lastDStr: '' }; this.currentLine = data; window.dashedLineList.push(data); this._lastAddPos.copy(worldPos); this.addPoint(worldPos, worldNormal, true); this.buildSVG(data);
    return data; },
    commitStraightLine: function(anchorParent, worldPosA, worldNormalA, worldPosB, worldNormalB) {
        this.ensureDOM();
        const id = 'dash_line_' + Date.now();
        const anchorObj = new THREE.Object3D();
        anchorObj.name = id;
        anchorParent.add(anchorObj);
        const picker = document.getElementById('obj-color-picker');
        const color = (picker && picker.value) ? picker.value : '#00d2ff';
        const data = {
            id: id,
            anchorObj: anchorObj,
            color: color,
            text: '',
            detailText: '',
            kind: 'bezier',
            strokeWidth: this.STRAIGHT_STROKE,
            opacity: this.STRAIGHT_OPACITY,
            capR: this.STRAIGHT_CAP_R,
            lineStyle: this.STRAIGHT_LINE_STYLE,
            points: [
                this._makeLocalPoint(anchorObj, worldPosA, worldNormalA),
                this._makeLocalPoint(anchorObj, worldPosB, worldNormalB)
            ],
            midIndex: 1,
            isOccluded: false,
            lastDStr: ''
        };
        this._ensureDefaultHandles(data);
        window.dashedLineList.push(data);
        this.buildSVG(data);
        window.needsUpdate = true;
        window.lightMoved = true;
        if (window.showToast && !window.__SOLID_CONSUMER__) window.showToast('贝塞尔曲线已保存');
        try { if (typeof window.markDraftDirty === 'function') window.markDraftDirty(); } catch (_e) {}
        return data;
    },
    addPoint: function(worldPos, worldNormal, force = false) { if (!this.isDrawing || !this.currentLine || !this.currentLine.anchorObj) return; // 【距离检测防刷屏】：世界距离大于 0.015 (1.5厘米) 才记录，防止点位过于密集挤爆内存
    if (!force && this._lastAddPos.distanceTo(worldPos) < 0.015) return; this._lastAddPos.copy(worldPos);
    this.currentLine.points.push(this._makeLocalPoint(this.currentLine.anchorObj, worldPos, worldNormal)); window.needsUpdate = true; }, finishLine: function() { if (!this.isDrawing || !this.currentLine) return; this.isDrawing = false; const data = this.currentLine; if (data.points.length < 2) {
    // 如果只点了一下没拉开，视为误触，直接无痕销毁
    this.deleteLine(data.id); } else { // 计算中点索引，用于挂载文本标签
    data.midIndex = Math.floor(data.points.length / 2); this.buildDOM(data);
    if (window.showToast && !window.__SOLID_CONSUMER__) window.showToast('虚线已保存'); }
    this.currentLine = null; window.needsUpdate = true; },
    clearStraightPending: function() { this._straightPending = null; this._straightClickArm = null; },
    cancelInteractivePlacing: function() { if (this.isDrawing) this.finishLine(); this.clearStraightPending(); },
    _placeStraightClick: function(anchorParent, worldPos, worldNormal) {
        if (!anchorParent || !worldPos || !worldNormal) return;
        if (!this._straightPending) {
            this._straightPending = {
                anchorParent: anchorParent,
                worldPos: worldPos.clone(),
                worldNormal: worldNormal.clone()
            };
            if (window.showToast) window.showToast('已定起点，保持 Alt+Shift 再点终点');
            return;
        }
        const a = this._straightPending;
        if (anchorParent !== a.anchorParent) {
            this.clearStraightPending();
            if (window.showToast) window.showToast('两点须在同一物体上，已取消', true);
            return;
        }
        if (a.worldPos.distanceTo(worldPos) < 0.015) {
            this.clearStraightPending();
            if (window.showToast) window.showToast('两点过近，已取消', true);
            return;
        }
        this.commitStraightLine(a.anchorParent, a.worldPos, a.worldNormal, worldPos.clone(), worldNormal.clone());
        this.clearStraightPending();
    },
    // 贝塞尔：Alt+Shift+左键点击（按下武装，松开且位移小则定点）；可连点两次完成（mode 仍为 straight-line）
    onSceneHit: function(context) {
        if (window.__SOLID_CONSUMER__) return;
        if (window.currentEditorMode !== 'straight-line') return;
        const e = context && context.event;
        if (!e || e.button !== 0) return;
        const shiftDown = e.shiftKey || (typeof e.getModifierState === 'function' && e.getModifierState('Shift'));
        if (!shiftDown) return;
        if (!context.targetObj || !context.hitPoint || !context.worldNormal) return;
        this._straightClickArm = {
            targetObj: context.targetObj,
            hitPoint: context.hitPoint.clone(),
            worldNormal: context.worldNormal.clone(),
            x: e.clientX,
            y: e.clientY,
            pointerId: e.pointerId
        };
    },
    onGlobalPointerUp: function(e) {
        if (window.__SOLID_CONSUMER__) return;
        if (window.currentEditorMode !== 'straight-line') return;
        const arm = this._straightClickArm;
        if (!arm) return;
        this._straightClickArm = null;
        if (e && arm.pointerId !== undefined && e.pointerId !== undefined && e.pointerId !== arm.pointerId) return;
        const altDown = e && (e.altKey || (typeof e.getModifierState === 'function' && e.getModifierState('Alt')));
        const shiftDown = e && (e.shiftKey || (typeof e.getModifierState === 'function' && e.getModifierState('Shift')));
        if (!altDown || !shiftDown) return;
        if (Math.hypot((e.clientX || 0) - arm.x, (e.clientY || 0) - arm.y) > 10) return; // 拖拽不算点击
        this._placeStraightClick(arm.targetObj, arm.hitPoint, arm.worldNormal);
    },
    // 连续虚线：Alt+Shift 悬停划动；贝塞尔不走 move
    onGlobalPointerMove: function(context) {
        if (window.__SOLID_CONSUMER__) return;
        if (window.currentEditorMode !== 'dashed-line') return;
        const e = context && context.event; if (!e) return;
        if (!(e.shiftKey && e.altKey)) return;
        const hit = this._raycastHit(e.clientX, e.clientY);
        if (!hit) return;
        const worldNormal = this._worldNormalFromHit(hit);
        if (!this.isDrawing) {
            this.startLine(hit.object, hit.point, worldNormal);
            if (window.showToast) window.showToast('正在绘制虚线，松开 Alt/Shift 结束…');
        } else {
            this.addPoint(hit.point, worldNormal);
        }
    },
    onKeyUp: function(event) {
        if (this.isDrawing && (event.key === 'Alt' || event.key === 'Shift')) this.finishLine();
    },
    buildSVG: function(data) { const svg = document.getElementById('dashed-line-svg'); const ns = "http://www.w3.org/2000/svg";
    const isBezier = this._isBezierKind(data);
    const app = isBezier ? this.getStraightAppearance(data) : null;
    if (isBezier && app) {
        data.strokeWidth = app.strokeWidth;
        data.opacity = app.opacity;
        data.capR = app.capR;
        data.lineStyle = app.lineStyle;
    }
    const baseStroke = isBezier ? app.strokeWidth : 2.5;
    const glowW = isBezier ? (this.STRAIGHT_GLOW * (app.strokeWidth / this.STRAIGHT_STROKE)) : 5;
    const hitW = isBezier ? Math.max(20, 28 * (app.strokeWidth / this.STRAIGHT_STROKE)) : 20;
    const glowPath = document.createElementNS(ns, "path"); glowPath.setAttribute("fill", "none"); glowPath.setAttribute("stroke", data.color);
    glowPath.setAttribute("stroke-width", String(glowW)); glowPath.setAttribute("opacity", "0.2"); glowPath.style.pointerEvents = "none";
    const path = document.createElementNS(ns, "path"); path.setAttribute("fill", "none"); path.setAttribute("stroke", data.color);
    path.setAttribute("stroke-width", String(baseStroke));
    if (isBezier) {
        const dash = this._dashArrayForLineStyle(app.lineStyle);
        if (dash !== 'none' && dash !== '') {
            path.setAttribute("stroke-dasharray", dash);
            glowPath.setAttribute("stroke-dasharray", dash);
        }
    } else {
        path.setAttribute("stroke-dasharray", "6, 6");
    }
    path.setAttribute("opacity", isBezier ? String(app.opacity) : String(this.STRAIGHT_OPACITY));
    path.style.pointerEvents = "none";
    const hitPath = document.createElementNS(ns, "path");
    hitPath.setAttribute("fill", "none"); hitPath.setAttribute("stroke", "transparent");
    hitPath.setAttribute("stroke-width", String(hitW)); hitPath.style.pointerEvents = "auto"; hitPath.style.cursor = "pointer";
    hitPath.addEventListener('pointerdown', e => {
    if (window.PluginManager && window.PluginManager.shouldBlockAnnoSelection(e)) return;
    e.stopPropagation();
    if (window.currentEditorMode === 'annotate' || window.currentEditorMode === 'annotate-color' || window.currentEditorMode === 'normal-arrow') return;
    if (window.currentEditorMode === 'dashed-line' && this.isDrawing) return;
    if (window.currentEditorMode === 'straight-line' && this._straightPending) return;
    this._selectLineFromPointer(data, e);
    });
    if (isBezier && !window.__SOLID_CONSUMER__) {
        hitPath.addEventListener('dblclick', e => {
            if (!this._canInteractStraightEndpoint(e)) return;
            if (this.selectedId !== data.id) return;
            if (!this.isEditableBezier(data)) return;
            e.stopPropagation();
            e.preventDefault();
            const cam = this._cachedCamera;
            if (cam && this._insertBezierAnchorAtClient(data, e.clientX, e.clientY, cam)) {
                if (window.showToast) window.showToast('已插入锚点');
            }
        });
    }
    svg.appendChild(glowPath); data.svgGlowPath = glowPath; svg.appendChild(path); data.svgPath = path;
    svg.appendChild(hitPath); data.svgHitPath = hitPath;
    // 贝塞尔：两端实心圆点 + 选中描边环 + 透明命中圈（投面态可拖端点收成两端）
    if (isBezier) {
        const capR0 = app.capR;
        const mkCap = () => {
            const c = document.createElementNS(ns, "circle");
            c.setAttribute("r", String(capR0));
            c.setAttribute("fill", data.color);
            c.setAttribute("opacity", String(app.opacity));
            c.setAttribute("cx", "0"); c.setAttribute("cy", "0");
            c.style.pointerEvents = "none"; c.style.display = "none";
            svg.appendChild(c); return c;
        };
        const mkRing = () => {
            const c = document.createElementNS(ns, "circle");
            c.setAttribute("r", String(this._straightCapRingR(capR0)));
            c.setAttribute("fill", "none");
            c.setAttribute("stroke", data.color);
            c.setAttribute("stroke-width", "2");
            c.setAttribute("opacity", "0.85");
            c.setAttribute("cx", "0"); c.setAttribute("cy", "0");
            c.style.pointerEvents = "none"; c.style.display = "none";
            svg.appendChild(c); return c;
        };
        const mkHit = (endIndex) => {
            const c = document.createElementNS(ns, "circle");
            c.setAttribute("r", String(this._straightCapHitR(capR0)));
            c.setAttribute("fill", "transparent");
            c.setAttribute("cx", "0"); c.setAttribute("cy", "0");
            c.style.pointerEvents = "none"; c.style.display = "none";
            c.addEventListener('pointerdown', e => {
                if (!this._canInteractStraightEndpoint(e)) return;
                if (this.selectedId !== data.id) return;
                this._beginStraightEndpointDrag(data, endIndex, e);
            }, { passive: false });
            svg.appendChild(c); return c;
        };
        data.svgEndCapA = mkCap(); data.svgEndCapB = mkCap();
        data.svgEndCapRingA = mkRing(); data.svgEndCapRingB = mkRing();
        data.svgEndCapHitA = mkHit(0); data.svgEndCapHitB = mkHit(1);
    }
    }, buildDOM: function(data) {
    if (!data || this._isBezierKind(data)) return; // 贝塞尔不建文本标签
    const layer = document.getElementById('dashed-line-layer'); const dom = document.createElement('div');
    dom.id = 'dom_' + data.id; dom.className = 'dashed-line-dom';     dom.style.cssText = `
                position: absolute; pointer-events: auto; cursor: pointer;
                padding: 4px 8px; border-radius: 4px; border: 1px solid ${data.color};
                background: rgba(0, 20, 40, 0.85); color: white; font-size: 12px; line-height: 1.35; box-sizing: border-box;
                white-space: nowrap; user-select: none; transition: opacity 0.2s;
                transform: translate(-50%, -50%); display: none; align-items: center; justify-content: center;
            `; dom.innerText = data.text; dom.dataset.color = data.color;
    dom.addEventListener('pointerdown', e => {
    if (window.PluginManager && window.PluginManager.shouldBlockAnnoSelection(e)) return;
    e.stopPropagation();
    if (window.__SOLID_CONSUMER__) {
        if (window.PluginManager && typeof window.PluginManager.setExclusiveSelection === 'function') {
            if (this.selectedId === data.id) window.PluginManager.setExclusiveSelection(this, null);
            else window.PluginManager.setExclusiveSelection(this, data.id);
        }
        return;
    }
    if (window.PluginManager && typeof window.PluginManager.setExclusiveSelection === 'function') { window.PluginManager.setExclusiveSelection(this, data.id); }
    else { this.selectedId = data.id; this.highlightSelected(); }
    const picker = document.getElementById('obj-color-picker'); if(picker) picker.value = data.color; }); layer.appendChild(dom); data.domEl = dom;     },     highlightSelected: function() {
    if (this.selectedId == null) {
        this.selectedIds = [];
        this._clearBezierEditFocus();
    } else if (!Array.isArray(this.selectedIds) || !this.selectedIds.length) {
        this.selectedIds = [this.selectedId];
    } else if (this.selectedIds.indexOf(this.selectedId) < 0) {
        // 外部互斥单选写入 selectedId 时，对齐为单选
        this.selectedIds = [this.selectedId];
    }
    if (this._bezierFocusLineId !== this.selectedId) {
        this._clearBezierEditFocus();
        this._bezierFocusLineId = this.selectedId;
    }
    document.querySelectorAll('.dashed-line-dom').forEach(el => { el.style.boxShadow = 'none'; });
    window.dashedLineList.forEach(data => {
    if (this._isBezierKind(data)) {
        this._applyStraightStrokeAttrs(data, this._isLineSelected(data.id));
    } else {
        if (data.svgPath) data.svgPath.setAttribute("stroke-width", "2.5");
        if (data.svgGlowPath) data.svgGlowPath.setAttribute("opacity", "0.2");
    }
    });
    // 标签高亮：多选中的虚线 DOM 全亮；贝塞尔无 DOM
    if (this.selectedIds && this.selectedIds.length) {
        this.selectedIds.forEach(id => {
            const d = window.dashedLineList.find(a => a.id === id);
            if (d && d.domEl) d.domEl.style.boxShadow = `0 0 10px ${d.color}`;
            if (d && !this._isBezierKind(d)) {
                if (d.svgPath) d.svgPath.setAttribute("stroke-width", "4");
                if (d.svgGlowPath) d.svgGlowPath.setAttribute("opacity", "0.5");
            }
        });
    }
    },
    deleteSelected: function() {
        this._normalizeSelectedIds();
        const ids = (this.selectedIds && this.selectedIds.length) ? this.selectedIds.slice() : (this.selectedId != null ? [this.selectedId] : []);
        ids.forEach(id => this.deleteLine(id));
        this.selectedId = null;
        this.selectedIds = [];
        this._clearBezierEditFocus();
    }, deleteLine: function(id) {
    if (this._straightEndpointDrag && this._straightEndpointDrag.dataId === id) {
        this._cleanupStraightEndpointDragListeners();
        this._straightEndpointDrag = null;
        this._resumeOrbitForEndpointDrag();
    }
    if (this._bezierDrag && this._bezierDrag.dataId === id) {
        this._cleanupBezierDragListeners();
        this._bezierDrag = null;
        this._resumeOrbitForEndpointDrag();
    }
    const idx = window.dashedLineList.findIndex(a => a.id === id); if (idx > -1) {
    const data = window.dashedLineList[idx]; if(data.anchorObj && data.anchorObj.parent) data.anchorObj.parent.remove(data.anchorObj); if(data.domEl) data.domEl.remove(); if(data.svgGlowPath) data.svgGlowPath.remove();
    if(data.svgPath) data.svgPath.remove(); if(data.svgHitPath) data.svgHitPath.remove();
    if(data.svgEndCapA) data.svgEndCapA.remove(); if(data.svgEndCapB) data.svgEndCapB.remove();
    if(data.svgEndCapRingA) data.svgEndCapRingA.remove(); if(data.svgEndCapRingB) data.svgEndCapRingB.remove();
    if(data.svgEndCapHitA) data.svgEndCapHitA.remove(); if(data.svgEndCapHitB) data.svgEndCapHitB.remove();
    this._removeBezierOverlay(data);
    if (Array.isArray(this.selectedIds)) {
        const si = this.selectedIds.indexOf(id);
        if (si >= 0) this.selectedIds.splice(si, 1);
    }
    if (this.selectedId === id) {
        this.selectedId = (this.selectedIds && this.selectedIds.length) ? this.selectedIds[this.selectedIds.length - 1] : null;
        this._clearBezierEditFocus();
    }
    window.dashedLineList.splice(idx, 1); window.needsUpdate = true; window.lightMoved = true;
    try { if (typeof window.markDraftDirty === 'function') window.markDraftDirty(); } catch (_e) {} } }, updateScreenPositions: function(camera) {
    if(window.dashedLineList.length === 0) return; // 【核心性能护城河】：零对象分配池，斩断 GC 回收的性能卡顿
    if (!this._poolInit) { this._tempV = new THREE.Vector3(); this._normalMatrix = new THREE.Matrix3(); this._viewDir = new THREE.Vector3(); this._currentWorldNormal = new THREE.Vector3(); this._poolInit = true; }
    window.dashedLineList.forEach(data => { if(!data.anchorObj || data.points.length === 0) return; if (data.anchorObj.parent) { this._normalMatrix.getNormalMatrix(data.anchorObj.parent.matrixWorld); }
    let isOccluded = false;
    const _ocThr = (this._isBezierKind(data) && typeof data.occludeDot === 'number' && isFinite(data.occludeDot)) ? data.occludeDot : -0.05;
    for (let i = 0; i < data.points.length; i++) { const pt = data.points[i]; this._tempV.copy(pt.localPos);
    data.anchorObj.localToWorld(this._tempV);
    if (!isOccluded && data.anchorObj.parent) { this._currentWorldNormal.copy(pt.localNormal).applyMatrix3(this._normalMatrix).normalize(); this._viewDir.copy(camera.position).sub(this._tempV).normalize();
    if (this._currentWorldNormal.dot(this._viewDir) < _ocThr) { isOccluded = true; } }
    }
    let dStr = '', midX = 0, midY = 0, midVisible = false, capAX = null, capAY = null, capBX = null, capBY = null, screenAnchors = null;
    if (this._isBezierKind(data)) {
        const built = this._buildScreenPathForData(data, camera);
        dStr = built.dStr; midX = built.midX; midY = built.midY; midVisible = built.midVisible;
        capAX = built.capAX; capAY = built.capAY; capBX = built.capBX; capBY = built.capBY;
        screenAnchors = built.screenAnchors;
    } else {
        for (let i = 0; i < data.points.length; i++) { const pt = data.points[i]; this._tempV.copy(pt.localPos);
        data.anchorObj.localToWorld(this._tempV);
        this._tempV.project(camera); const isBehind = this._tempV.z > 1.0 || this._tempV.z < -1.0; const x = (this._tempV.x * 0.5 + 0.5) * window.innerWidth; const y = (-(this._tempV.y * 0.5) + 0.5) * window.innerHeight;
        if (!isNaN(x) && !isNaN(y) && !isBehind) { dStr += `${dStr.length === 0 ? 'M' : 'L'} ${x} ${y} `; if (i === data.midIndex && !this.isDrawing) { midX = x; midY = y; midVisible = true; } } }
    }
    // 【脏检查】：只在画面像素级变动时才刷新 DOM，节省 90% 性能
    if (data.lastDStr !== dStr) { if (data.svgGlowPath) data.svgGlowPath.setAttribute("d", dStr); if (data.svgPath) data.svgPath.setAttribute("d", dStr);
    if (data.svgHitPath) data.svgHitPath.setAttribute("d", dStr); data.lastDStr = dStr; }
    if (data.svgEndCapA && data.svgEndCapB) {
        const isSel = this._isLineSelected(data.id);
        const canDrag = this.selectedId === data.id && !window.__SOLID_CONSUMER__ && this._isProjectedPolyline(data);
        if (capAX != null && capAY != null) {
            data.svgEndCapA.setAttribute("cx", String(capAX)); data.svgEndCapA.setAttribute("cy", String(capAY)); data.svgEndCapA.style.display = "";
            if (data.svgEndCapRingA) { data.svgEndCapRingA.setAttribute("cx", String(capAX)); data.svgEndCapRingA.setAttribute("cy", String(capAY)); data.svgEndCapRingA.style.display = canDrag ? "" : "none"; }
            if (data.svgEndCapHitA) { data.svgEndCapHitA.setAttribute("cx", String(capAX)); data.svgEndCapHitA.setAttribute("cy", String(capAY)); data.svgEndCapHitA.style.display = canDrag ? "" : "none"; }
        } else {
            data.svgEndCapA.style.display = "none";
            if (data.svgEndCapRingA) data.svgEndCapRingA.style.display = "none";
            if (data.svgEndCapHitA) data.svgEndCapHitA.style.display = "none";
        }
        if (capBX != null && capBY != null) {
            data.svgEndCapB.setAttribute("cx", String(capBX)); data.svgEndCapB.setAttribute("cy", String(capBY)); data.svgEndCapB.style.display = "";
            if (data.svgEndCapRingB) { data.svgEndCapRingB.setAttribute("cx", String(capBX)); data.svgEndCapRingB.setAttribute("cy", String(capBY)); data.svgEndCapRingB.style.display = canDrag ? "" : "none"; }
            if (data.svgEndCapHitB) { data.svgEndCapHitB.setAttribute("cx", String(capBX)); data.svgEndCapHitB.setAttribute("cy", String(capBY)); data.svgEndCapHitB.style.display = canDrag ? "" : "none"; }
        } else {
            data.svgEndCapB.style.display = "none";
            if (data.svgEndCapRingB) data.svgEndCapRingB.style.display = "none";
            if (data.svgEndCapHitB) data.svgEndCapHitB.style.display = "none";
        }
    }
    if (screenAnchors && this.selectedId === data.id && this.isEditableBezier(data) && !window.__SOLID_CONSUMER__) {
        this._syncBezierEditOverlay(data, true);
        if (data.svgAnchors) {
            for (let i = 0; i < screenAnchors.length && i < data.svgAnchors.length; i++) {
                const sa = screenAnchors[i];
                const c = data.svgAnchors[i];
                if (!c) continue;
                if (sa.ok) {
                    c.setAttribute('cx', String(sa.x)); c.setAttribute('cy', String(sa.y));
                    c.style.display = '';
                } else {
                    c.style.display = 'none';
                }
            }
        }
        this._updateBezierHandlesScreen(data, camera);
    } else if (data.svgAnchorGroup) {
        data.svgAnchorGroup.style.display = 'none';
    }
    data.isOccluded = isOccluded;
    if (data.lastOccluded !== isOccluded) {
        this._applyStraightOpacityAttrs(data, isOccluded);
        data.lastOccluded = isOccluded;
    }
    if (data.domEl) { if (midVisible) { data.domEl.style.display = 'inline-flex'; data.domEl.style.left = midX + 'px'; data.domEl.style.top = (midY - 15) + 'px'; } else {
    data.domEl.style.display = 'none'; } } }); }, clearAll: function() {
    if (this._straightEndpointDrag) {
        this._cleanupStraightEndpointDragListeners();
        this._straightEndpointDrag = null;
        this._resumeOrbitForEndpointDrag();
    }
    if (this._bezierDrag) {
        this._cleanupBezierDragListeners();
        this._bezierDrag = null;
        this._resumeOrbitForEndpointDrag();
    }
    this._clearBezierEditFocus();
    this.clearStraightPending(); window.dashedLineList.forEach(data => { if(data.anchorObj && data.anchorObj.parent) data.anchorObj.parent.remove(data.anchorObj);
    if(data.domEl) data.domEl.remove(); }); window.dashedLineList = []; const svg = document.getElementById('dashed-line-svg'); if(svg) svg.innerHTML = ''; this.selectedId = null; this.selectedIds = []; },
    onClearScene: function() { this.clearAll(); },
    extractSaveData: function(obj) {
        const lines = [];
        if (!obj) return lines;
        obj.updateMatrixWorld(true);
        obj.traverse(ch => {
            if (!ch.name || !ch.name.startsWith('dash_line_')) return;
            const d = window.dashedLineList.find(a => a.id === ch.name);
            if (!d || !d.points || d.points.length < 2) return;
            const projected = this._isProjectedPolyline(d);
            const pts = d.points.map(p => {
                const entry = {
                    pos: [parseFloat(p.localPos.x.toFixed(4)), parseFloat(p.localPos.y.toFixed(4)), parseFloat(p.localPos.z.toFixed(4))],
                    norm: [parseFloat(p.localNormal.x.toFixed(3)), parseFloat(p.localNormal.y.toFixed(3)), parseFloat(p.localNormal.z.toFixed(3))]
                };
                if (!projected) {
                    if (p.handleIn) entry.handleIn = this._arrFromVec3(p.handleIn);
                    if (p.handleOut) entry.handleOut = this._arrFromVec3(p.handleOut);
                }
                return entry;
            });
            const entry = { id: d.id, color: d.color, points: pts };
            if (this._isBezierKind(d)) {
                entry.kind = 'bezier';
                if (projected) entry.projected = true;
                if (typeof d.occludeDot === 'number' && isFinite(d.occludeDot)) {
                    entry.occludeDot = parseFloat(d.occludeDot.toFixed(2));
                }
                const app = this.getStraightAppearance(d);
                if (Math.abs(app.strokeWidth - this.STRAIGHT_STROKE) > 0.001) {
                    entry.strokeWidth = parseFloat(app.strokeWidth.toFixed(2));
                }
                if (Math.abs(app.opacity - this.STRAIGHT_OPACITY) > 0.001) {
                    entry.opacity = parseFloat(app.opacity.toFixed(2));
                }
                if (Math.abs(app.capR - this.STRAIGHT_CAP_R) > 0.001) {
                    entry.capR = parseFloat(app.capR.toFixed(2));
                }
                if (app.lineStyle && app.lineStyle !== this.STRAIGHT_LINE_STYLE) {
                    entry.lineStyle = app.lineStyle;
                }
            } else {
                entry.text = d.text != null ? String(d.text) : '';
                entry.detailText = d.detailText != null ? String(d.detailText) : '';
            }
            lines.push(entry);
        });
        return lines;
    },
    onSaveItemData: function(context) { const lines = this.extractSaveData(context.obj); if (lines.length > 0) context.itemData.dashedLines = lines; },
    onSaveGroundData: function(context) { const lines = this.extractSaveData(context.obj); if (lines.length > 0) context.sceneData.groundDashedLines = lines; },
    onLoadItem: function(ctx) { if (ctx.itemData.dashedLines) this.restoreLines(ctx.obj, ctx.itemData.dashedLines); },
    onLoadGround: function(ctx) { if (ctx.sceneData.groundDashedLines) this.restoreLines(ctx.obj, ctx.sceneData.groundDashedLines); },
    getDetailText: function(id) { const d = window.dashedLineList.find(a => a.id === id); return d ? (d.detailText || '') : ''; },
    restoreLines: function(parentObj, lines) {
        if (!lines || !lines.length) return;
        this.ensureDOM();
        lines.forEach(line => {
            if (!line.points || line.points.length < 2) return;
            const id = line.id || ('dash_line_' + Date.now() + Math.random());
            const anchorObj = new THREE.Object3D();
            anchorObj.name = id;
            parentObj.add(anchorObj);
            const rawKind = line.kind;
            const isBez = rawKind === 'bezier' || rawKind === 'straight';
            const kind = isBez ? 'bezier' : 'dashed';
            const pts = line.points.map(p => {
                const pt = {
                    localPos: new THREE.Vector3(p.pos[0], p.pos[1], p.pos[2]),
                    localNormal: new THREE.Vector3(p.norm[0], p.norm[1], p.norm[2])
                };
                const hi = this._vec3FromArr(p.handleIn);
                const ho = this._vec3FromArr(p.handleOut);
                if (hi) pt.handleIn = hi;
                if (ho) pt.handleOut = ho;
                return pt;
            });
            const data = {
                id: id,
                anchorObj: anchorObj,
                color: line.color || '#00d2ff',
                text: isBez ? '' : (line.text != null ? String(line.text) : '线段'),
                detailText: isBez ? '' : (line.detailText != null ? String(line.detailText) : ''),
                kind: kind,
                points: pts,
                midIndex: Math.floor(pts.length / 2),
                isOccluded: false,
                lastDStr: ''
            };
            if (isBez) {
                if (line.projected === true || (pts.length > 2 && !pts.some(p => p.handleIn || p.handleOut))) {
                    data.projected = true;
                    this._stripHandles(data);
                } else {
                    this._ensureDefaultHandles(data);
                }
                if (typeof line.occludeDot === 'number' && isFinite(line.occludeDot)) data.occludeDot = line.occludeDot;
                const app = this.getStraightAppearance({
                    strokeWidth: line.strokeWidth,
                    opacity: line.opacity,
                    capR: line.capR,
                    lineStyle: line.lineStyle
                });
                data.strokeWidth = app.strokeWidth;
                data.opacity = app.opacity;
                data.capR = app.capR;
                data.lineStyle = app.lineStyle;
            }
            window.dashedLineList.push(data);
            this.buildSVG(data);
            if (!isBez) this.buildDOM(data);
        });
    },
    onUpdate: function(context) {
        this._cachedCamera = context.camera;
        this._cachedScene = context.scene;
        if (window.showAnnotations !== false && context.camera) {
            this.updateScreenPositions(context.camera);
            const layer = document.getElementById('dashed-line-layer');
            if (layer) layer.style.display = 'block';
        } else {
            const layer = document.getElementById('dashed-line-layer');
            if (layer) layer.style.display = 'none';
        }
    }
    }; // 挂载到主引擎
    if (window.PluginManager) { window.PluginManager.register('DashedLine', window.DashedLineManager); }
// 与法线/面片/探针一致：选中后 Delete/Backspace 删除（消费端由 PluginManager 总闸拦截）
window.addEventListener('keydown', e => {
    if (window.__SOLID_CONSUMER__) return;
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) return;
    const mgr = window.DashedLineManager;
    if (!mgr || mgr.selectedId == null) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const step = e.shiftKey ? 10 : 3;
        let dx = 0, dy = 0;
        if (e.key === 'ArrowLeft') dx = -step;
        if (e.key === 'ArrowRight') dx = step;
        if (e.key === 'ArrowUp') dy = -step;
        if (e.key === 'ArrowDown') dy = step;
        if (mgr.nudgeSelectedBezier(dx, dy)) {
            e.preventDefault();
            e.stopPropagation();
        }
        return;
    }
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    if (typeof mgr.deleteSelectedBezierAnchorIfAny === 'function' && mgr.deleteSelectedBezierAnchorIfAny()) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
    }
    mgr.deleteSelected();
    e.preventDefault();
    e.stopImmediatePropagation();
});
