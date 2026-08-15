/*
* Plugin_DashedLine.js
* 功能：连续虚线 + 两点直线标注（纯内存数据阵列 + 极限性能点乘剔除）
* kind: 缺省/"dashed" = 连续虚线；"straight" = 直线（可两点，亦可投面后多点；更粗 + 两端实心圆点）
*/
import * as THREE from 'three'; window.dashedLineList = []; window.dashedLineCounter = 0; window.DashedLineManager = { pluginId: 'Plugin_DashedLine', selectedId: null, isDrawing: false, currentLine: null,
    // 直线外观初值（便于后续微调）
    STRAIGHT_STROKE: 4.5, STRAIGHT_STROKE_SEL: 6, STRAIGHT_GLOW: 9, STRAIGHT_CAP_R: 6.5, STRAIGHT_CAP_R_SEL: 8, STRAIGHT_CAP_RING_EXTRA: 4, STRAIGHT_CAP_HIT_R: 18,
    _lastAddPos: new THREE.Vector3(), _straightPending: null, _straightClickArm: null, _straightEndpointDrag: null, _straightEndpointOrbitWasEnabled: null,
    ensureDOM: function() { if (!document.getElementById('dashed-line-layer')) { const layer = document.createElement('div'); layer.id = 'dashed-line-layer';
    // z-index: 48 确保在底层，不干扰法线和引线点击
    layer.style.cssText = 'position: absolute; top: 0; left: 0; width: 100vw; height: 100vh; pointer-events: none; z-index: 48; overflow: hidden;'; layer.innerHTML = '<svg id="dashed-line-svg" style="width: 100%; height: 100%; pointer-events: none;"></svg>'; document.body.appendChild(layer); // 独立挂载颜色拾取器联动
    const colorPicker = document.getElementById('obj-color-picker'); if (colorPicker) { colorPicker.addEventListener('input', e => { if (this.selectedId !== null) {
    const data = window.dashedLineList.find(a => a.id === this.selectedId); if (data) { data.color = e.target.value; if (data.domEl) { data.domEl.dataset.color = data.color; data.domEl.style.borderColor = data.color; }
    if (data.svgPath) data.svgPath.setAttribute("stroke", data.color); if (data.svgGlowPath) data.svgGlowPath.setAttribute("stroke", data.color);
    if (data.svgEndCapA) data.svgEndCapA.setAttribute("fill", data.color); if (data.svgEndCapB) data.svgEndCapB.setAttribute("fill", data.color);
    if (data.svgEndCapRingA) data.svgEndCapRingA.setAttribute("stroke", data.color); if (data.svgEndCapRingB) data.svgEndCapRingB.setAttribute("stroke", data.color); window.needsUpdate = true; } } }); } } },
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
    /** 2B：投面多点线拖端点前收为首尾两点 */
    _collapseStraightToEndpoints: function(data) {
        if (!data || !data.points || data.points.length <= 2) return false;
        const a = data.points[0];
        const b = data.points[data.points.length - 1];
        data.points = [
            { localPos: a.localPos.clone(), localNormal: a.localNormal.clone() },
            { localPos: b.localPos.clone(), localNormal: b.localNormal.clone() }
        ];
        data.midIndex = 1;
        data.lastDStr = '';
        data.lastOccluded = undefined;
        return true;
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
        if (!data || data.kind !== 'straight') return;
        const ringR = this.STRAIGHT_CAP_R_SEL + this.STRAIGHT_CAP_RING_EXTRA;
        const hitR = this.STRAIGHT_CAP_HIT_R;
        const dragging = !!(this._straightEndpointDrag && this._straightEndpointDrag.dataId === data.id);
        const canDrag = isSelected && !window.__SOLID_CONSUMER__;
        if (data.svgEndCapRingA) {
            data.svgEndCapRingA.setAttribute("r", String(ringR));
            data.svgEndCapRingA.setAttribute("stroke", data.color);
            data.svgEndCapRingA.style.display = canDrag ? "" : "none";
        }
        if (data.svgEndCapRingB) {
            data.svgEndCapRingB.setAttribute("r", String(ringR));
            data.svgEndCapRingB.setAttribute("stroke", data.color);
            data.svgEndCapRingB.style.display = canDrag ? "" : "none";
        }
        [data.svgEndCapHitA, data.svgEndCapHitB].forEach(hit => {
            if (!hit) return;
            hit.setAttribute("r", String(hitR));
            hit.style.pointerEvents = canDrag ? "auto" : "none";
            hit.style.cursor = dragging ? "grabbing" : (canDrag ? "grab" : "default");
        });
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
        if (!this._dragLocalProbe) this._dragLocalProbe = new THREE.Vector3();
        const otherIdx = st.endIndex === 0 ? 1 : 0;
        this._dragWorldA.copy(hit.point);
        this._dragWorldB.copy(data.points[otherIdx].localPos);
        data.anchorObj.localToWorld(this._dragWorldB);
        if (this._dragWorldA.distanceTo(this._dragWorldB) < 0.015) return;
        const wn = this._worldNormalFromHit(hit);
        const lp = this._makeLocalPoint(data.anchorObj, hit.point, wn);
        data.points[st.endIndex].localPos.copy(lp.localPos);
        data.points[st.endIndex].localNormal.copy(lp.localNormal);
        data.lastDStr = '';
        st.moved = true;
        window.needsUpdate = true;
        try { if (e.cancelable) e.preventDefault(); } catch (_ePrev) {}
    },
    _beginStraightEndpointDrag: function(data, endIndex, e) {
        if (!this._canInteractStraightEndpoint(e)) return;
        if (!data || data.kind !== 'straight' || !data.anchorObj || !data.points || data.points.length < 2) return;
        if (this._straightEndpointDrag) this._endStraightEndpointDrag(e);
        e.stopPropagation();
        if (this.selectedId !== data.id) {
            if (window.PluginManager && typeof window.PluginManager.setExclusiveSelection === 'function') {
                window.PluginManager.setExclusiveSelection(this, data.id);
            } else { this.selectedId = data.id; this.highlightSelected(); }
        }
        const collapsed = this._collapseStraightToEndpoints(data);
        if (collapsed) data.lastDStr = '';
        const captureEl = e.currentTarget;
        const onMove = ev => this._moveStraightEndpointDrag(ev);
        const onUp = ev => this._endStraightEndpointDrag(ev);
        this._straightEndpointDrag = { dataId: data.id, endIndex: endIndex, pointerId: e.pointerId, captureEl: captureEl, onMove: onMove, onUp: onUp, moved: false };
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
    /** 真直线：恰好两点（未投面）；投面后为多点 */
    isTrueStraight: function(data) {
        return !!(data && data.kind === 'straight' && data.points && data.points.length === 2);
    },
    /**
     * 取消投面：仅保留首尾两点还原为真直线（不改 z-index / 图层）。
     * @returns {{ ok: boolean, reason?: string }}
     */
    unprojectSelectedStraightToChord: function() {
        if (window.__SOLID_CONSUMER__) return { ok: false, reason: 'consumer' };
        if (this.selectedId == null) return { ok: false, reason: 'no_selection' };
        const data = window.dashedLineList.find(a => a.id === this.selectedId);
        if (!data || data.kind !== 'straight') return { ok: false, reason: 'not_straight' };
        if (!data.points || data.points.length < 2) return { ok: false, reason: 'bad_data' };
        if (data.points.length === 2) return { ok: true, reason: 'already_true' };
        const a = data.points[0];
        const b = data.points[data.points.length - 1];
        data.points = [
            { localPos: a.localPos.clone(), localNormal: a.localNormal.clone() },
            { localPos: b.localPos.clone(), localNormal: b.localNormal.clone() }
        ];
        data.midIndex = 1;
        data.lastDStr = '';
        data.lastOccluded = undefined;
        window.needsUpdate = true;
        window.lightMoved = true;
        try { if (typeof window.markDraftDirty === 'function') window.markDraftDirty(); } catch (_e) {}
        if (window.showToast && !window.__SOLID_CONSUMER__) window.showToast('已取消投面（还原为首尾直线）');
        return { ok: true };
    },
    /**
     * 将当前选中的 straight：按当前视角把首尾屏幕弦投到所属模型朝向屏幕的外表面（多点，kind 仍为 straight）。
     * @returns {{ ok: boolean, reason?: string, pointCount?: number }}
     */
    projectSelectedStraightToSurface: function(camera, scene) {
        if (window.__SOLID_CONSUMER__) return { ok: false, reason: 'consumer' };
        if (!camera || !scene) return { ok: false, reason: 'no_camera' };
        if (this.selectedId == null) return { ok: false, reason: 'no_selection' };
        const data = window.dashedLineList.find(a => a.id === this.selectedId);
        if (!data || data.kind !== 'straight') return { ok: false, reason: 'not_straight' };
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
        if (!isFinite(x0) || !isFinite(y0) || !isFinite(x1) || !isFinite(y1)) {
            return { ok: false, reason: 'bad_screen' };
        }
        const pixLen = Math.hypot(x1 - x0, y1 - y0);
        if (pixLen < 4) return { ok: false, reason: 'too_short' };
        const stepPx = 6;
        let n = Math.round(pixLen / stepPx) + 1;
        n = Math.max(16, Math.min(120, n));
        const newPts = [];
        for (let i = 0; i < n; i++) {
            const t = n === 1 ? 0 : (i / (n - 1));
            const cx = x0 + (x1 - x0) * t;
            const cy = y0 + (y1 - y0) * t;
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
            kind: 'straight',
            points: [
                this._makeLocalPoint(anchorObj, worldPosA, worldNormalA),
                this._makeLocalPoint(anchorObj, worldPosB, worldNormalB)
            ],
            midIndex: 1,
            isOccluded: false,
            lastDStr: ''
        };
        window.dashedLineList.push(data);
        this.buildSVG(data);
        // 直线：无标签/无文字，仅 SVG 线可选中
        window.needsUpdate = true;
        window.lightMoved = true;
        if (window.showToast && !window.__SOLID_CONSUMER__) window.showToast('直线已保存');
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
    // 直线：Alt+Shift+左键点击（按下武装，松开且位移小则定点）；可连点两次完成
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
    // 连续虚线：Alt+Shift 悬停划动；直线不走 move
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
    const isStraight = data.kind === 'straight';
    const glowPath = document.createElementNS(ns, "path"); glowPath.setAttribute("fill", "none"); glowPath.setAttribute("stroke", data.color);
    glowPath.setAttribute("stroke-width", isStraight ? String(this.STRAIGHT_GLOW) : "5"); glowPath.setAttribute("opacity", "0.2"); glowPath.style.pointerEvents = "none";
    const path = document.createElementNS(ns, "path"); path.setAttribute("fill", "none"); path.setAttribute("stroke", data.color);
    path.setAttribute("stroke-width", isStraight ? String(this.STRAIGHT_STROKE) : "2.5"); path.setAttribute("stroke-dasharray", "6, 6"); path.style.pointerEvents = "none";
    const hitPath = document.createElementNS(ns, "path");
    hitPath.setAttribute("fill", "none"); hitPath.setAttribute("stroke", "transparent");
    hitPath.setAttribute("stroke-width", isStraight ? "28" : "20"); hitPath.style.pointerEvents = "auto"; hitPath.style.cursor = "pointer";
    hitPath.addEventListener('pointerdown', e => {
    if (window.PluginManager && window.PluginManager.shouldBlockAnnoSelection(e)) return;
    e.stopPropagation();
    // 其它标注工具绘制中勿抢选；本模式绘制中也不抢选，结束后可点选再 Delete
    if (window.currentEditorMode === 'annotate' || window.currentEditorMode === 'annotate-color' || window.currentEditorMode === 'normal-arrow') return;
    if (window.currentEditorMode === 'dashed-line' && this.isDrawing) return;
    if (window.currentEditorMode === 'straight-line' && this._straightPending) return;
    if (window.__SOLID_CONSUMER__) {
        if (window.PluginManager && typeof window.PluginManager.setExclusiveSelection === 'function') {
            if (this.selectedId === data.id) window.PluginManager.setExclusiveSelection(this, null);
            else window.PluginManager.setExclusiveSelection(this, data.id);
        }
        return;
    }
    if (window.PluginManager && typeof window.PluginManager.setExclusiveSelection === 'function') { window.PluginManager.setExclusiveSelection(this, data.id); }
    else { this.selectedId = data.id; this.highlightSelected(); }
    const picker = document.getElementById('obj-color-picker'); if(picker) picker.value = data.color; }); svg.appendChild(glowPath); data.svgGlowPath = glowPath; svg.appendChild(path); data.svgPath = path;
    svg.appendChild(hitPath); data.svgHitPath = hitPath;
    // 直线：两端实心圆点 + 选中描边环 + 透明命中圈（生产端可拖端点）
    if (isStraight) {
        const mkCap = () => {
            const c = document.createElementNS(ns, "circle");
            c.setAttribute("r", String(this.STRAIGHT_CAP_R));
            c.setAttribute("fill", data.color);
            c.setAttribute("cx", "0"); c.setAttribute("cy", "0");
            c.style.pointerEvents = "none"; c.style.display = "none";
            svg.appendChild(c); return c;
        };
        const mkRing = () => {
            const c = document.createElementNS(ns, "circle");
            c.setAttribute("r", String(this.STRAIGHT_CAP_R_SEL + this.STRAIGHT_CAP_RING_EXTRA));
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
            c.setAttribute("r", String(this.STRAIGHT_CAP_HIT_R));
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
    if (!data || data.kind === 'straight') return; // 直线不建文本标签
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
    const picker = document.getElementById('obj-color-picker'); if(picker) picker.value = data.color; }); layer.appendChild(dom); data.domEl = dom; }, highlightSelected: function() {
    document.querySelectorAll('.dashed-line-dom').forEach(el => { el.style.boxShadow = 'none'; }); window.dashedLineList.forEach(data => {
    const baseW = (data.kind === 'straight') ? this.STRAIGHT_STROKE : 2.5;
    if (data.svgPath) data.svgPath.setAttribute("stroke-width", String(baseW)); if (data.svgGlowPath) data.svgGlowPath.setAttribute("opacity", "0.2");
    if (data.svgEndCapA) data.svgEndCapA.setAttribute("r", String(this.STRAIGHT_CAP_R)); if (data.svgEndCapB) data.svgEndCapB.setAttribute("r", String(this.STRAIGHT_CAP_R));
    this._syncStraightEndpointHandles(data, false); });
    const data = window.dashedLineList.find(a => a.id === this.selectedId); if (data) { if (data.domEl) data.domEl.style.boxShadow = `0 0 10px ${data.color}`;
    const selW = (data.kind === 'straight') ? this.STRAIGHT_STROKE_SEL : 4;
    if (data.svgPath) data.svgPath.setAttribute("stroke-width", String(selW)); if (data.svgGlowPath) data.svgGlowPath.setAttribute("opacity", "0.5");
    if (data.svgEndCapA) data.svgEndCapA.setAttribute("r", String(this.STRAIGHT_CAP_R_SEL)); if (data.svgEndCapB) data.svgEndCapB.setAttribute("r", String(this.STRAIGHT_CAP_R_SEL));
    this._syncStraightEndpointHandles(data, true); } },
    deleteSelected: function() { if (this.selectedId !== null) { this.deleteLine(this.selectedId); this.selectedId = null; } }, deleteLine: function(id) {
    if (this._straightEndpointDrag && this._straightEndpointDrag.dataId === id) {
        this._cleanupStraightEndpointDragListeners();
        this._straightEndpointDrag = null;
        this._resumeOrbitForEndpointDrag();
    }
    const idx = window.dashedLineList.findIndex(a => a.id === id); if (idx > -1) {
    const data = window.dashedLineList[idx]; if(data.anchorObj && data.anchorObj.parent) data.anchorObj.parent.remove(data.anchorObj); if(data.domEl) data.domEl.remove(); if(data.svgGlowPath) data.svgGlowPath.remove();
    if(data.svgPath) data.svgPath.remove(); if(data.svgHitPath) data.svgHitPath.remove();
    if(data.svgEndCapA) data.svgEndCapA.remove(); if(data.svgEndCapB) data.svgEndCapB.remove();
    if(data.svgEndCapRingA) data.svgEndCapRingA.remove(); if(data.svgEndCapRingB) data.svgEndCapRingB.remove();
    if(data.svgEndCapHitA) data.svgEndCapHitA.remove(); if(data.svgEndCapHitB) data.svgEndCapHitB.remove();
    window.dashedLineList.splice(idx, 1); window.needsUpdate = true; window.lightMoved = true;
    try { if (typeof window.markDraftDirty === 'function') window.markDraftDirty(); } catch (_e) {} } }, updateScreenPositions: function(camera) {
    if(window.dashedLineList.length === 0) return; // 【核心性能护城河】：零对象分配池，斩断 GC 回收的性能卡顿
    if (!this._poolInit) { this._tempV = new THREE.Vector3(); this._normalMatrix = new THREE.Matrix3(); this._viewDir = new THREE.Vector3(); this._currentWorldNormal = new THREE.Vector3(); this._poolInit = true; }
    window.dashedLineList.forEach(data => { if(!data.anchorObj || data.points.length === 0) return; if (data.anchorObj.parent) { this._normalMatrix.getNormalMatrix(data.anchorObj.parent.matrixWorld); }
    let dStr = ''; let isOccluded = false; let midX = 0, midY = 0, midVisible = false;
    let capAX = null, capAY = null, capBX = null, capBY = null;
    const _ocThr = (data.kind === 'straight' && typeof data.occludeDot === 'number' && isFinite(data.occludeDot)) ? data.occludeDot : -0.05;
    for (let i = 0; i < data.points.length; i++) { const pt = data.points[i]; this._tempV.copy(pt.localPos);
    data.anchorObj.localToWorld(this._tempV); // 【点乘遮挡剔除】：用超轻量级数学算法替代 DOM 获取和射线，只要有一点转到背面，整条线变半透明幽灵状态
    if (!isOccluded && data.anchorObj.parent) { this._currentWorldNormal.copy(pt.localNormal).applyMatrix3(this._normalMatrix).normalize(); this._viewDir.copy(camera.position).sub(this._tempV).normalize();
    if (this._currentWorldNormal.dot(this._viewDir) < _ocThr) { isOccluded = true; } }
    this._tempV.project(camera); const isBehind = this._tempV.z > 1.0 || this._tempV.z < -1.0; const x = (this._tempV.x * 0.5 + 0.5) * window.innerWidth; const y = (-(this._tempV.y * 0.5) + 0.5) * window.innerHeight;
    if (!isNaN(x) && !isNaN(y) && !isBehind) { dStr += `${dStr.length === 0 ? 'M' : 'L'} ${x} ${y} `; if (i === data.midIndex && !this.isDrawing) { midX = x; midY = y; midVisible = true; }
    if (data.kind === 'straight') { if (i === 0) { capAX = x; capAY = y; } if (i === data.points.length - 1) { capBX = x; capBY = y; } } } }
    // 【脏检查】：只在画面像素级变动时才刷新 DOM，节省 90% 性能
    if (data.lastDStr !== dStr) { if (data.svgGlowPath) data.svgGlowPath.setAttribute("d", dStr); if (data.svgPath) data.svgPath.setAttribute("d", dStr);
    if (data.svgHitPath) data.svgHitPath.setAttribute("d", dStr); data.lastDStr = dStr; }
    if (data.svgEndCapA && data.svgEndCapB) {
        const isSel = this.selectedId === data.id;
        const canDrag = isSel && !window.__SOLID_CONSUMER__;
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
    if (data.lastOccluded !== isOccluded) { const opacity = isOccluded ? "0.2" : "0.9"; if (data.svgPath) data.svgPath.setAttribute("opacity", opacity);
    if (data.svgEndCapA) data.svgEndCapA.setAttribute("opacity", opacity); if (data.svgEndCapB) data.svgEndCapB.setAttribute("opacity", opacity);
    if (data.svgEndCapRingA) data.svgEndCapRingA.setAttribute("opacity", opacity); if (data.svgEndCapRingB) data.svgEndCapRingB.setAttribute("opacity", opacity);
    if (data.domEl) data.domEl.style.opacity = isOccluded ? "0.3" : "1"; data.lastOccluded = isOccluded; }
    if (data.domEl) { if (midVisible) { data.domEl.style.display = 'inline-flex'; data.domEl.style.left = midX + 'px'; data.domEl.style.top = (midY - 15) + 'px'; } else {
    data.domEl.style.display = 'none'; } } }); }, clearAll: function() {
    if (this._straightEndpointDrag) {
        this._cleanupStraightEndpointDragListeners();
        this._straightEndpointDrag = null;
        this._resumeOrbitForEndpointDrag();
    }
    this.clearStraightPending(); window.dashedLineList.forEach(data => { if(data.anchorObj && data.anchorObj.parent) data.anchorObj.parent.remove(data.anchorObj);
    if(data.domEl) data.domEl.remove(); }); window.dashedLineList = []; const svg = document.getElementById('dashed-line-svg'); if(svg) svg.innerHTML = ''; this.selectedId = null; },
    onClearScene: function() { this.clearAll(); },
    extractSaveData: function(obj) {
        const lines = [];
        if (!obj) return lines;
        obj.updateMatrixWorld(true);
        obj.traverse(ch => {
            if (!ch.name || !ch.name.startsWith('dash_line_')) return;
            const d = window.dashedLineList.find(a => a.id === ch.name);
            if (!d || !d.points || d.points.length < 2) return;
            const pts = d.points.map(p => ({
                pos: [parseFloat(p.localPos.x.toFixed(4)), parseFloat(p.localPos.y.toFixed(4)), parseFloat(p.localPos.z.toFixed(4))],
                norm: [parseFloat(p.localNormal.x.toFixed(3)), parseFloat(p.localNormal.y.toFixed(3)), parseFloat(p.localNormal.z.toFixed(3))]
            }));
            const entry = { id: d.id, color: d.color, points: pts };
            if (d.kind === 'straight') {
                entry.kind = 'straight';
                if (typeof d.occludeDot === 'number' && isFinite(d.occludeDot)) {
                    entry.occludeDot = parseFloat(d.occludeDot.toFixed(2));
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
            const kind = line.kind === 'straight' ? 'straight' : 'dashed';
            const pts = line.points.map(p => ({
                localPos: new THREE.Vector3(p.pos[0], p.pos[1], p.pos[2]),
                localNormal: new THREE.Vector3(p.norm[0], p.norm[1], p.norm[2])
            }));
            // straight 可多点（投面后）；旧数据缺 kind 按虚线多点
            const points = pts;
            const data = {
                id: id,
                anchorObj: anchorObj,
                color: line.color || '#00d2ff',
                text: (kind === 'straight') ? '' : (line.text != null ? String(line.text) : '线段'),
                detailText: (kind === 'straight') ? '' : (line.detailText != null ? String(line.detailText) : ''),
                kind: kind,
                points: points,
                midIndex: Math.floor(points.length / 2),
                isOccluded: false,
                lastDStr: ''
            };
            if (kind === 'straight' && typeof line.occludeDot === 'number' && isFinite(line.occludeDot)) data.occludeDot = line.occludeDot;
            window.dashedLineList.push(data);
            this.buildSVG(data);
            if (kind !== 'straight') this.buildDOM(data);
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
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) return;
    const id = window.DashedLineManager.selectedId;
    if (id === null || id === undefined) return;
    window.DashedLineManager.deleteSelected();
});
