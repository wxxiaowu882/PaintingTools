import * as THREE from 'three';

/** 屏幕取色引线：独立数据与 DOM，序列化到 itemData.colorSampleAnnotations */
window.colorSampleAnnoList = [];
window.colorSampleAnnoCounter = 0;

const RING_SEGMENTS = 36;
const RING_WORLD_RADIUS = 0.045;
const END_CIRCLE_R = 19;
const END_STROKE_W = 4;
const END_STROKE_COLOR = '#808080';
/** 选中时仅略提亮描边，避免与 sampledColor 采样节奏打架产生闪烁 */
const END_STROKE_SELECTED = '#d2d6da';
const RING_STROKE = 'rgba(118,120,126,0.5)';
const RING_STROKE_SELECTED = 'rgba(145,148,155,0.72)';
const RING_W = '1';
const RING_W_SEL = '1.15';
const SAMPLE_MIN_INTERVAL_MS = 220;

function colorSampleDebugLog(msg) {
    const line = '[ColorSample] ' + msg;
    if (typeof window !== 'undefined' && window.hwLog) window.hwLog(line);
}

function getDarkBg(hex) {
    if (!hex) return 'rgba(0,0,0,0.65)';
    let c = String(hex).replace('#', '');
    if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
    const r = parseInt(c.substring(0, 2), 16), g = parseInt(c.substring(2, 4), 16), b = parseInt(c.substring(4, 6), 16);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return 'rgba(0,0,0,0.65)';
    return `rgba(${(r * 0.2) | 0}, ${(g * 0.2) | 0}, ${(b * 0.2) | 0}, 0.85)`;
}

function defaultColorSampleLineColor() {
    return document.getElementById('obj-color-picker')?.value || '#00d2ff';
}

window.ColorSampleAnnotationManager = {
    selectedId: null,
    isPlacing: false,
    activeData: null,
    _cachedControls: null,
    _lastBatchSampleAt: 0,
    _pixelBuf: new Uint8Array(4),

    _ensurePool: function () {
        if (this._poolOk) return;
        this._centerW = new THREE.Vector3();
        this._nW = new THREE.Vector3();
        this._t1 = new THREE.Vector3();
        this._t2 = new THREE.Vector3();
        this._pRing = new THREE.Vector3();
        this._normalMatrix = new THREE.Matrix3();
        this._viewDir = new THREE.Vector3();
        this._poolOk = true;
    },

    ensureDOM: function () {
        if (!document.getElementById('anno-cs-style-inject')) {
            const style = document.createElement('style');
            style.id = 'anno-cs-style-inject';
            style.innerHTML = `
                #anno-cs-layer { position: absolute; top: 0; left: 0; width: 100vw; height: 100vh; pointer-events: none; z-index: 52 !important; overflow: hidden; }
                #anno-cs-svg { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; }
                .anno-cs-end { pointer-events: auto; cursor: grab; }
                .anno-cs-ring { pointer-events: auto; cursor: pointer; fill: none; }
                /* 取色标签样式对齐经典引线：矩形文本框（支持内部换行） */
                .anno-cs-label { position:absolute; pointer-events:auto; cursor:pointer; border:1px solid #0df; color:#fff; padding:4px 8px; font-size:11px; line-height:1.45; box-sizing:border-box; font-weight:700; font-family:'Inter', ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto; white-space:pre-wrap; user-select:none; border-radius:2px; transition:opacity 0.2s; box-shadow:0 4px 10px rgba(0,0,0,0.5); transform:translate(0,-50%); max-width:260px; display:inline-flex; align-items:center; justify-content:flex-start; }
                /* 编辑态完全对齐经典引线 */
                .anno-cs-label.editing { background:#fff !important; color:#000 !important; outline:none; border-color:#fff !important; box-shadow:0 0 10px rgba(0,210,255,0.5) !important; user-select:text !important; cursor:text !important; }
            `;
            document.head.appendChild(style);
        }
        if (!document.getElementById('anno-cs-layer')) {
            const layer = document.createElement('div');
            layer.id = 'anno-cs-layer';
            layer.innerHTML = '<svg id="anno-cs-svg"></svg>';
            document.body.appendChild(layer);
        }
    },

    onSceneHit: function (context) {
        if (window.currentEditorMode !== 'annotate-color') {
            colorSampleDebugLog(`onSceneHit 忽略: editorMode=${window.currentEditorMode}（需要 annotate-color）`);
            return;
        }
        const ev = context.event;
        const shiftHeld = ev.shiftKey || (typeof ev.getModifierState === 'function' && ev.getModifierState('Shift'));
        if (!shiftHeld) {
            colorSampleDebugLog(`onSceneHit 忽略: 未按住 Shift（shiftKey=${ev.shiftKey} getShift=${typeof ev.getModifierState === 'function' ? ev.getModifierState('Shift') : 'n/a'}）`);
            return;
        }
        colorSampleDebugLog('onSceneHit → 开始 createColorSample');
        // 正确体验：点下即出现“实心圆+引线”，移动鼠标实时预览位置；松开 Alt/Shift 才结束放置
        this.createColorSample(context.targetObj, context.hitPoint, context.worldNormal);
        this.activeData = window.colorSampleAnnoList[window.colorSampleAnnoList.length - 1];
        this.isPlacing = true;
        this._cachedControls = context.controls;
        if (this._cachedControls) this._cachedControls.enabled = false;
        if (window.showToast) window.showToast('已锁定取色锚点：移动鼠标确定色块位置，松开 Alt 或 Shift 完成。');
    },

    onGlobalPointerMove: function (context) {
        if (window.currentEditorMode !== 'annotate-color') return;
        if (this.isPlacing && this.activeData) {
            this.activeData.dx = context.event.clientX - context.startX;
            this.activeData.dy = context.event.clientY - context.startY;
            // 同步“跨端一致”的长度字段（如果能取到 camera）
            try {
                const vw = Math.max(1, window.__solidAnnoViewportW || window.innerWidth || 1);
                const vh = Math.max(1, window.__solidAnnoViewportH || window.innerHeight || 1);
                this.activeData.dxN = this.activeData.dx / vw;
                this.activeData.dyN = this.activeData.dy / vh;
                const cam = this._cachedCamera;
                if (cam && this.activeData.anchorObj) {
                    const px = this._pxPerWorldAtAnchor(cam, this.activeData.anchorObj);
                    if (px && px.pxPerWorldX > 1e-6 && px.pxPerWorldY > 1e-6) {
                        this.activeData.dxW = this.activeData.dx / px.pxPerWorldX;
                        this.activeData.dyW = this.activeData.dy / px.pxPerWorldY;
                    }
                }
            } catch (_e) {}
            window.needsUpdate = true;
        }
    },

    /** 解除放置中（轨道控制器、onBeforePointerDown）；模式切换时由 PluginManager.cancelInteractivePlacing 统一调用，避免切工具后卡死。 */
    cancelInteractivePlacing: function () {
        if (!this.isPlacing) return;
        this.isPlacing = false;
        this.activeData = null;
        if (this._cachedControls) {
            this._cachedControls.enabled = true;
            this._cachedControls = null;
        }
        if (typeof window.needsUpdate !== 'undefined') window.needsUpdate = true;
    },

    onKeyUp: function (event) {
        if (!this.isPlacing || (event.key !== 'Alt' && event.key !== 'Shift')) return;
        this.cancelInteractivePlacing();
        if (window.currentEditorMode === 'annotate-color' && window.showToast) window.showToast('取色引线已放置。');
    },

    onBeforePointerDown: function () {
        if (window.currentEditorMode !== 'annotate-color') return false;
        if (this.isPlacing) {
            colorSampleDebugLog('onBeforePointerDown 拦截: 正在放置取色引线 isPlacing=true');
            return true;
        }
    },
    onGlobalPointerUp: function () {
        if (window.currentEditorMode !== 'annotate-color') return false;
        if (this.isPlacing) return true;
    },

    onClearScene: function () {
        if (!window.colorSampleAnnoList) return;
        this.cancelInteractivePlacing();
        window.colorSampleAnnoList.forEach(data => {
            if (data.anchorObj && data.anchorObj.parent) data.anchorObj.parent.remove(data.anchorObj);
            if (data.svgGlowPath) data.svgGlowPath.remove();
            if (data.svgPath) data.svgPath.remove();
            if (data.svgStem) data.svgStem.remove();
            if (data.svgRing) data.svgRing.remove();
            if (data.svgEnd) data.svgEnd.remove();
            if (data.domLabel) data.domLabel.remove();
            if (typeof data.cleanupEvents === 'function') data.cleanupEvents();
        });
        window.colorSampleAnnoList = [];
        const svg = document.getElementById('anno-cs-svg');
        if (svg) svg.innerHTML = '';
        this.selectedId = null;
        this.isPlacing = false;
        this.activeData = null;
        this._cachedControls = null;
    },

    _mergeLoadList: function (ctx) {
        let arr = ctx.itemData.colorSampleAnnotations;
        if (Array.isArray(arr) && arr.length) return arr;
        const ann = ctx.itemData.annotations;
        if (!Array.isArray(ann)) return [];
        return ann.filter(a => a.annotationKind === 'colorSample');
    },

    onLoadItem: function (ctx) {
        const raw = this._mergeLoadList(ctx);
        const safeData = raw.filter(a => !window.colorSampleAnnoList.some(ex => ex.id === a.id)).map(a => {
            if (!a.baseScale || a.baseScale === 0) a.baseScale = 1;
            return a;
        });
        if (safeData.length > 0) this.restoreMany(ctx.obj, safeData);
    },

    onLoadGround: function (ctx) {
        let arr = ctx.sceneData.groundColorSampleAnnotations;
        if (!Array.isArray(arr) || !arr.length) {
            const ga = ctx.sceneData.groundAnnotations;
            if (Array.isArray(ga)) arr = ga.filter(a => a.annotationKind === 'colorSample');
            else arr = [];
        }
        const safeData = arr.filter(a => !window.colorSampleAnnoList.some(ex => ex.id === a.id)).map(a => {
            if (!a.baseScale || a.baseScale === 0) a.baseScale = 1;
            return a;
        });
        if (safeData.length > 0) this.restoreMany(ctx.obj, safeData);
    },

    onSaveItemData: function (context) {
        const list = this.extractSaveData(context.obj);
        if (list.length > 0) context.itemData.colorSampleAnnotations = list;
    },

    onSaveGroundData: function (context) {
        const list = this.extractSaveData(context.obj);
        if (list.length > 0) context.sceneData.groundColorSampleAnnotations = list;
    },

    extractSaveData: function (obj) {
        const out = [];
        if (!obj || !obj.children) return out;
        obj.children.forEach(c => {
            const data = window.colorSampleAnnoList.find(d => d.id === c.name);
            if (!data) return;
            const vw = Math.max(1, window.__solidAnnoViewportW || window.innerWidth || 1);
            const vh = Math.max(1, window.__solidAnnoViewportH || window.innerHeight || 1);
            let norm = [0, 1, 0];
            if (c.userData.localNormal) {
                norm = [
                    parseFloat(c.userData.localNormal.x.toFixed(3)),
                    parseFloat(c.userData.localNormal.y.toFixed(3)),
                    parseFloat(c.userData.localNormal.z.toFixed(3))
                ];
            }
            out.push({
                id: data.id,
                annotationKind: 'colorSample',
                dx: data.dx,
                dy: data.dy,
                dxN: typeof data.dxN === 'number' ? parseFloat(data.dxN.toFixed(6)) : (typeof data.dx === 'number' ? parseFloat((data.dx / vw).toFixed(6)) : 0),
                dyN: typeof data.dyN === 'number' ? parseFloat(data.dyN.toFixed(6)) : (typeof data.dy === 'number' ? parseFloat((data.dy / vh).toFixed(6)) : 0),
                dxW: typeof data.dxW === 'number' ? parseFloat(data.dxW.toFixed(6)) : undefined,
                dyW: typeof data.dyW === 'number' ? parseFloat(data.dyW.toFixed(6)) : undefined,
                localPos: [
                    parseFloat(c.position.x.toFixed(4)),
                    parseFloat(c.position.y.toFixed(4)),
                    parseFloat(c.position.z.toFixed(4))
                ],
                localNormal: norm,
                baseDist: data.baseDist,
                baseScale: data.baseScale,
                ringWorldRadius: data.ringWorldRadius,
                lineColor: data.lineColor || '#00d2ff',
                labelText: data.labelText,
                detailText: data.detailText != null ? String(data.detailText) : '',
                labelVisible: data.labelVisible !== false
            });
        });
        return out;
    },

    onDrawSnapshot: function (context) {
        if (!window.colorSampleAnnoList.length) return;
        this._ensurePool();
        const ctx2 = context.ctx, rect = context.rect, camera = context.camera;
        if (!camera) return;
        const scaleX = 256 / rect.width, scaleY = 256 / rect.height;
        const endR = END_CIRCLE_R * Math.min(scaleX, scaleY);
        window.colorSampleAnnoList.forEach(data => {
            if (data.isBehind || data.isOccluded || !data.anchorObj) return;
            this._updateAnchorScreen(data, camera);
            const ax = data.screenX, ay = data.screenY;
            const scaledDx = data.scaledDx || 0, scaledDy = data.scaledDy || 0;
            const ax1 = ax + scaledDx, ay1 = ay + scaledDy, amidX = ax + scaledDx * 0.5;
            const tx = (ax - rect.left) * scaleX, ty = (ay - rect.top) * scaleY, tx1 = (ax1 - rect.left) * scaleX, ty1 = (ay1 - rect.top) * scaleY, tmidX = (amidX - rect.left) * scaleX;
            const lineCol = data.lineColor || '#00d2ff';
            ctx2.strokeStyle = lineCol;
            ctx2.lineWidth = 1.5;
            ctx2.beginPath();
            ctx2.moveTo(tx, ty);
            ctx2.lineTo(tmidX, ty1);
            ctx2.lineTo(tx1, ty1);
            ctx2.stroke();
            const dRing = this._ringPathString(data, camera);
            if (dRing) {
                try {
                    const p = new Path2D(dRing);
                    ctx2.strokeStyle = 'rgba(110,112,118,0.55)';
                    ctx2.lineWidth = 0.9;
                    ctx2.stroke(p);
                } catch (_e) {}
            }
            ctx2.fillStyle = data.sampledColor || '#888888';
            ctx2.strokeStyle = END_STROKE_COLOR;
            ctx2.lineWidth = Math.max(2, END_STROKE_W * Math.min(scaleX, scaleY) * 0.5);
            ctx2.beginPath();
            ctx2.arc(tx1, ty1, endR, 0, Math.PI * 2);
            ctx2.fill();
            ctx2.stroke();
        });
    },

    createColorSample: function (targetObj, worldPoint, worldNormal) {
        try {
            this.ensureDOM();
            window.colorSampleAnnoCounter++;
            const id = 'csanno_' + Date.now() + '_' + window.colorSampleAnnoCounter;
            const anchor = new THREE.Object3D();
            targetObj.worldToLocal(anchor.position.copy(worldPoint));
            anchor.name = id;
            if (worldNormal) {
                const localNormalPt = targetObj.worldToLocal(worldPoint.clone().add(worldNormal));
                anchor.userData.localNormal = localNormalPt.sub(anchor.position).normalize();
            } else {
                anchor.userData.localNormal = new THREE.Vector3(0, 1, 0);
            }
            targetObj.add(anchor);
            const annoData = {
                id,
                targetUUID: targetObj.uuid,
                anchorObj: anchor,
                dx: 0,
                dy: 0,
                dxN: 0,
                dyN: 0,
                dxW: 0,
                dyW: 0,
                isOccluded: false,
                sampledColor: '#666666',
                ringWorldRadius: RING_WORLD_RADIUS,
                lineColor: defaultColorSampleLineColor(),
                labelText: String(window.colorSampleAnnoCounter),
                detailText: '',
                labelVisible: true
            };
            window.colorSampleAnnoList.push(annoData);
            this._buildSVG(annoData);
            window.needsUpdate = true;
            window.lightMoved = true;
            if (window.PluginManager && typeof window.PluginManager.setExclusiveSelection === 'function') {
                window.PluginManager.setExclusiveSelection(this, id);
            } else {
                this.selectedId = id;
                this.highlightSelected();
            }
        } catch (e) { console.error(e); }
    },

    _buildSVG: function (data) {
        const svg = document.getElementById('anno-cs-svg');
        const ns = 'http://www.w3.org/2000/svg';
        if (!data.lineColor) data.lineColor = defaultColorSampleLineColor();
        const lineCol = data.lineColor;
        const fillCol = data.sampledColor || '#666666';

        const glowPath = document.createElementNS(ns, 'path');
        glowPath.setAttribute('fill', 'none');
        glowPath.setAttribute('stroke', lineCol);
        glowPath.setAttribute('stroke-width', '6');
        glowPath.setAttribute('opacity', '0.15');
        svg.appendChild(glowPath);
        data.svgGlowPath = glowPath;

        const path = document.createElementNS(ns, 'path');
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', lineCol);
        path.setAttribute('stroke-width', '1.5');
        svg.appendChild(path);
        data.svgPath = path;

        // 圆点与文本框之间的短连线（水平）：线段 -> 实心圆 -> 文本框
        const stem = document.createElementNS(ns, 'line');
        stem.setAttribute('stroke', lineCol);
        stem.setAttribute('stroke-width', '1.5');
        stem.setAttribute('opacity', '0.88');
        svg.appendChild(stem);
        data.svgStem = stem;

        const ring = document.createElementNS(ns, 'path');
        ring.setAttribute('class', 'anno-cs-ring');
        ring.setAttribute('stroke', RING_STROKE);
        ring.setAttribute('stroke-width', RING_W);
        ring.setAttribute('stroke-linejoin', 'round');
        ring.addEventListener('pointerdown', e => {
            e.stopPropagation();
            if (window.__SOLID_CONSUMER__) {
                if (window.PluginManager && typeof window.PluginManager.setExclusiveSelection === 'function') {
                    if (this.selectedId === data.id) window.PluginManager.setExclusiveSelection(this, null);
                    else window.PluginManager.setExclusiveSelection(this, data.id);
                }
                return;
            }
            if (window.PluginManager && typeof window.PluginManager.setExclusiveSelection === 'function') {
                window.PluginManager.setExclusiveSelection(this, data.id);
            } else {
                this.selectedId = data.id;
                this.highlightSelected();
            }
        });
        svg.appendChild(ring);
        data.svgRing = ring;

        const endC = document.createElementNS(ns, 'circle');
        endC.setAttribute('class', 'anno-cs-end');
        endC.setAttribute('r', String(END_CIRCLE_R));
        endC.setAttribute('fill', fillCol);
        endC.setAttribute('stroke', END_STROKE_COLOR);
        endC.setAttribute('stroke-width', String(END_STROKE_W));
        endC.addEventListener('pointerdown', e => {
            e.stopPropagation();
            if (window.__SOLID_CONSUMER__) {
                if (window.PluginManager && typeof window.PluginManager.setExclusiveSelection === 'function') {
                    if (this.selectedId === data.id) window.PluginManager.setExclusiveSelection(this, null);
                    else window.PluginManager.setExclusiveSelection(this, data.id);
                }
                return;
            }
            if (window.PluginManager && typeof window.PluginManager.setExclusiveSelection === 'function') {
                window.PluginManager.setExclusiveSelection(this, data.id);
            } else {
                this.selectedId = data.id;
                this.highlightSelected();
            }
        });
        endC.addEventListener('dblclick', e => {
            if (window.__SOLID_CONSUMER__) return;
            e.stopPropagation();
            data.labelVisible = !data.labelVisible;
            if (data.domLabel) data.domLabel.style.display = data.labelVisible ? 'block' : 'none';
            if (typeof window.needsUpdate !== 'undefined') window.needsUpdate = true;
        });
        let isDragging = false, startX, startY, startDx, startDy, isMoved = false;
        endC.addEventListener('mousedown', e => {
            isDragging = true;
            isMoved = false;
            startX = e.clientX;
            startY = e.clientY;
            startDx = data.dx;
            startDy = data.dy;
            e.stopPropagation();
        });
        const onMouseMove = e => {
            if (!isDragging) return;
            if (Math.abs(e.clientX - startX) > 3 || Math.abs(e.clientY - startY) > 3) isMoved = true;
            if (!isMoved) return;
            const vw = Math.max(1, window.__solidAnnoViewportW || window.innerWidth || 1);
            const vh = Math.max(1, window.__solidAnnoViewportH || window.innerHeight || 1);
            data.dx = startDx + (e.clientX - startX);
            data.dy = startDy + (e.clientY - startY);
            data.dxN = data.dx / vw;
            data.dyN = data.dy / vh;
            try {
                const cam = window.ColorSampleAnnotationManager._cachedCamera;
                if (cam && data.anchorObj) {
                    const px = window.ColorSampleAnnotationManager._pxPerWorldAtAnchor(cam, data.anchorObj);
                    if (px && px.pxPerWorldX > 1e-6 && px.pxPerWorldY > 1e-6) {
                        data.dxW = data.dx / px.pxPerWorldX;
                        data.dyW = data.dy / px.pxPerWorldY;
                    }
                }
            } catch (_e) {}
            window.needsUpdate = true;
        };
        const onMouseUp = () => { isDragging = false; };
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
        data.cleanupEvents = () => {
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };
        svg.appendChild(endC);
        data.svgEnd = endC;

        // 文本标签：跟随实心圆，默认编号，可编辑；双击实心圆可切换显隐
        const layer = document.getElementById('anno-cs-layer');
        if (layer && !data.domLabel) {
            const label = document.createElement('div');
            label.className = 'anno-cs-label';
            label.innerText = (data.labelText !== undefined && data.labelText !== null) ? String(data.labelText) : '';
            label.style.display = data.labelVisible === false ? 'none' : 'block';
            label.style.borderColor = data.lineColor || '#00d2ff';
            label.style.backgroundColor = getDarkBg(data.lineColor || '#00d2ff');

            label.addEventListener('pointerdown', e => {
                e.stopPropagation();
                if (window.__SOLID_CONSUMER__) {
                    if (window.PluginManager && typeof window.PluginManager.setExclusiveSelection === 'function') {
                        if (this.selectedId === data.id) window.PluginManager.setExclusiveSelection(this, null);
                        else window.PluginManager.setExclusiveSelection(this, data.id);
                    }
                    return;
                }
                if (window.PluginManager && typeof window.PluginManager.setExclusiveSelection === 'function') {
                    window.PluginManager.setExclusiveSelection(this, data.id);
                } else {
                    this.selectedId = data.id;
                    this.highlightSelected();
                }
            });

            // 经典引线同款：双击同一文本框进入编辑（contentEditable + editing），失焦保存，回车结束编辑
            label.addEventListener('dblclick', e => {
                if (window.__SOLID_CONSUMER__) return;
                e.stopPropagation();
                if (window.PluginManager && typeof window.PluginManager.setExclusiveSelection === 'function') {
                    window.PluginManager.setExclusiveSelection(this, data.id);
                } else {
                    this.selectedId = data.id;
                    this.highlightSelected();
                }
                label.contentEditable = 'true';
                label.classList.add('editing');
                label.style.cursor = 'text';
                label.focus();
                try {
                    const selection = window.getSelection();
                    const range = document.createRange();
                    range.selectNodeContents(label);
                    selection.removeAllRanges();
                    selection.addRange(range);
                } catch (_e) {}
            });

            label.addEventListener('blur', () => {
                if (!label.isContentEditable) return;
                label.contentEditable = 'false';
                label.classList.remove('editing');
                label.style.cursor = 'pointer';
                const t = label.innerText.trim();
                data.labelText = t;
                label.innerText = t;
                if (typeof window.needsUpdate !== 'undefined') window.needsUpdate = true;
            });

            label.addEventListener('keydown', e => {
                e.stopPropagation();
                if (e.key === 'Delete' || e.key === 'Backspace') e.stopPropagation();
            });

            layer.appendChild(label);
            data.domLabel = label;
        }
    },

    highlightSelected: function () {
        const sid = this.selectedId;
        window.colorSampleAnnoList.forEach(d => {
            const sel = sid === d.id;
            if (d.svgRing) {
                d.svgRing.setAttribute('stroke', sel ? RING_STROKE_SELECTED : RING_STROKE);
                d.svgRing.setAttribute('stroke-width', sel ? RING_W_SEL : RING_W);
            }
            if (d.svgEnd) {
                d.svgEnd.setAttribute('stroke', sel ? END_STROKE_SELECTED : END_STROKE_COLOR);
            }
            if (d.domLabel) {
                d.domLabel.style.boxShadow = sel ? '0 0 10px rgba(255, 255, 255, 0.8)' : '0 4px 10px rgba(0,0,0,0.5)';
                d.domLabel.style.borderColor = sel ? '#fff' : (d.lineColor || '#00d2ff');
                d.domLabel.style.zIndex = sel ? '100000' : '99999';
            }
        });
        const picker = document.getElementById('obj-color-picker');
        if (sid !== null && picker) {
            const d = window.colorSampleAnnoList.find(a => a.id === sid);
            if (d) picker.value = d.lineColor || '#00d2ff';
        }
    },

    _updateAnchorScreen: function (data, camera) {
        if (!data.anchorObj) return;
        this._ensurePool();
        data.anchorObj.getWorldPosition(this._centerW);
        this._pRing.copy(this._centerW).project(camera);
        data.screenX = (this._pRing.x * 0.5 + 0.5) * window.innerWidth;
        data.screenY = (-(this._pRing.y * 0.5) + 0.5) * window.innerHeight;
    },

    _ringPathString: function (data, camera) {
        if (!data.anchorObj) return '';
        this._ensurePool();
        const R = data.ringWorldRadius || RING_WORLD_RADIUS;
        data.anchorObj.getWorldPosition(this._centerW);
        if (data.anchorObj.parent && data.anchorObj.userData.localNormal) {
            this._normalMatrix.getNormalMatrix(data.anchorObj.parent.matrixWorld);
            this._nW.copy(data.anchorObj.userData.localNormal).applyMatrix3(this._normalMatrix).normalize();
        } else {
            this._nW.set(0, 1, 0);
        }
        const up = new THREE.Vector3(0, 1, 0);
        this._t1.crossVectors(this._nW, up);
        if (this._t1.lengthSq() < 1e-8) this._t1.crossVectors(this._nW, new THREE.Vector3(1, 0, 0));
        this._t1.normalize();
        this._t2.crossVectors(this._nW, this._t1).normalize();

        let d = '';
        for (let i = 0; i <= RING_SEGMENTS; i++) {
            const th = (i / RING_SEGMENTS) * Math.PI * 2;
            this._pRing.copy(this._centerW)
                .addScaledVector(this._t1, Math.cos(th) * R)
                .addScaledVector(this._t2, Math.sin(th) * R);
            this._pRing.project(camera);
            const sx = (this._pRing.x * 0.5 + 0.5) * window.innerWidth;
            const sy = (-(this._pRing.y * 0.5) + 0.5) * window.innerHeight;
            d += (i === 0 ? 'M ' : ' L ') + sx + ' ' + sy;
        }
        d += ' Z';
        return d;
    },

    updateScreenPositions: function (camera) {
        if (!window.colorSampleAnnoList.length) return;
        this._cachedCamera = camera;
        this._ensurePool();
        window.colorSampleAnnoList.forEach(data => {
            if (!data.anchorObj) return;
            data.anchorObj.getWorldPosition(this._centerW);
            const dist = camera.position.distanceTo(this._centerW);
            const safeDist = Math.max(dist, 0.1);
            const modelScaleX = data.anchorObj.parent ? data.anchorObj.parent.scale.x : 1;
            if (!data.baseDist) {
                data.baseDist = safeDist;
                data.baseScale = modelScaleX;
            }
            let lineScale = (data.baseDist / safeDist) * (modelScaleX / data.baseScale);
            lineScale = Math.max(0.1, Math.min(lineScale, 10.0));
            data.currentScale = lineScale;

            if (data.anchorObj.parent && data.anchorObj.userData.localNormal) {
                this._normalMatrix.getNormalMatrix(data.anchorObj.parent.matrixWorld);
                this._nW.copy(data.anchorObj.userData.localNormal).applyMatrix3(this._normalMatrix).normalize();
                this._viewDir.copy(camera.position).sub(this._centerW).normalize();
                data.isOccluded = this._nW.dot(this._viewDir) < -0.05;
            } else {
                data.isOccluded = false;
            }

            // 须先 project 再比 z：世界坐标 .z 与 ±1 比较会错误隐藏大量仍可见的锚点（与 Plugin_Annotation 一致）
            this._pRing.copy(this._centerW).project(camera);
            const isBehind = this._pRing.z > 1.0 || this._pRing.z < -1.0;
            data.isBehind = isBehind;

            this._updateAnchorScreen(data, camera);
            const opacity = isBehind ? '0' : (data.isOccluded ? '0.2' : '1');
            const pointerEvents = (isBehind || data.isOccluded) ? 'none' : 'auto';
            const px = this._pxPerWorldAtAnchor(camera, data.anchorObj);
            const hasWorld = (typeof data.dxW === 'number') || (typeof data.dyW === 'number');
            const scaledDx = hasWorld && px ? (Number(data.dxW || 0) * px.pxPerWorldX) : ((typeof data.dx === 'number' ? data.dx : 0) * lineScale);
            const scaledDy = hasWorld && px ? (Number(data.dyW || 0) * px.pxPerWorldY) : ((typeof data.dy === 'number' ? data.dy : 0) * lineScale);
            data.scaledDx = scaledDx;
            data.scaledDy = scaledDy;
            data.dx = scaledDx;
            data.dy = scaledDy;

            const leaderCol = data.lineColor || '#00d2ff';
            const x = data.screenX, y = data.screenY;
            const isSel = this.selectedId === data.id;
            if (data.svgPath && !isNaN(x)) {
                if (!isBehind && !data.isOccluded) {
                    const x1 = x + scaledDx;
                    const y1 = y + scaledDy;
                    const midX = x + scaledDx * 0.5;
                    const dStr = `M ${x} ${y} L ${midX} ${y1} L ${x1} ${y1}`;
                    if (data.svgGlowPath) {
                        data.svgGlowPath.setAttribute('d', dStr);
                        data.svgGlowPath.setAttribute('stroke', leaderCol);
                    }
                    data.svgPath.setAttribute('d', dStr);
                    data.svgPath.setAttribute('stroke', leaderCol);
                    data.svgPath.setAttribute('opacity', '0.88');
                    if (data.svgGlowPath) data.svgGlowPath.setAttribute('opacity', '0.14');

                    const ringD = this._ringPathString(data, camera);
                    if (data.svgRing) {
                        data.svgRing.setAttribute('d', ringD);
                        data.svgRing.setAttribute('opacity', '0.95');
                        data.svgRing.setAttribute('stroke', isSel ? RING_STROKE_SELECTED : RING_STROKE);
                        data.svgRing.setAttribute('stroke-width', isSel ? RING_W_SEL : RING_W);
                        data.svgRing.style.pointerEvents = pointerEvents;
                    }
                    if (data.svgEnd) {
                        data.svgEnd.setAttribute('cx', x1);
                        data.svgEnd.setAttribute('cy', y1);
                        data.svgEnd.setAttribute('fill', data.sampledColor || '#666666');
                        data.svgEnd.setAttribute('r', String(END_CIRCLE_R));
                        data.svgEnd.setAttribute('stroke', isSel ? END_STROKE_SELECTED : END_STROKE_COLOR);
                        data.svgEnd.setAttribute('stroke-width', String(END_STROKE_W));
                        data.svgEnd.setAttribute('opacity', '1');
                        data.svgEnd.style.pointerEvents = pointerEvents;
                    }
                    if (data.domLabel) {
                        // 文本框位置：实心圆正左侧或正右侧（不斜放），形成：线段 -> 实心圆 -> 文本框
                        // 用引线水平指向决定放置在左还是右；若几乎无水平分量则默认放右侧
                        const anchorRight = scaledDx < -1; // true: 文本在圆左侧（右端锚定），false: 文本在圆右侧（左端锚定）
                        const gap = 10;
                        const lx = x1 + (anchorRight ? -(END_CIRCLE_R + gap) : (END_CIRCLE_R + gap));
                        const ly = y1;
                        data.domLabel.style.left = `${lx}px`;
                        data.domLabel.style.top = `${ly}px`;
                        data.domLabel.style.opacity = '1';
                        data.domLabel.style.pointerEvents = pointerEvents;
                        data.domLabel.style.display = data.labelVisible === false ? 'none' : 'block';
                        data.domLabel.style.transform = anchorRight ? 'translate(-100%,-50%)' : 'translate(0,-50%)';
                        // 多行文本统一左对齐；锚定端仅由 transform 决定
                        data.domLabel.style.textAlign = 'left';
                        data.domLabel.style.borderColor = leaderCol;
                        data.domLabel.style.backgroundColor = getDarkBg(leaderCol);
                        // 圆点到文本框之间的短连线（水平）
                        if (data.svgStem) {
                            const xStart = x1 + (anchorRight ? -END_CIRCLE_R : END_CIRCLE_R);
                            const xEnd = lx;
                            data.svgStem.setAttribute('x1', String(xStart));
                            data.svgStem.setAttribute('y1', String(ly));
                            data.svgStem.setAttribute('x2', String(xEnd));
                            data.svgStem.setAttribute('y2', String(ly));
                            data.svgStem.setAttribute('stroke', leaderCol);
                            data.svgStem.setAttribute('opacity', data.labelVisible === false ? '0' : '0.88');
                        }
                    }
                } else {
                    if (data.svgGlowPath) data.svgGlowPath.setAttribute('opacity', '0');
                    data.svgPath.setAttribute('opacity', '0');
                    if (data.svgStem) data.svgStem.setAttribute('opacity', '0');
                    if (data.svgRing) data.svgRing.setAttribute('opacity', '0');
                    if (data.svgEnd) {
                        data.svgEnd.setAttribute('opacity', '0');
                        data.svgEnd.style.pointerEvents = 'none';
                    }
                    if (data.domLabel) {
                        data.domLabel.style.opacity = '0';
                        data.domLabel.style.pointerEvents = 'none';
                    }
                }
            }
        });
    },

    readScreenColor: function (renderer, screenX, screenY) {
        if (!renderer) return '#666666';
        const canvas = renderer.domElement;
        const gl = renderer.getContext();
        const w = canvas.width, h = canvas.height;
        if (w < 2 || h < 2) return '#666666';
        const sx = Math.max(0, Math.min(w - 1, Math.floor((screenX / window.innerWidth) * w)));
        const sy = Math.max(0, Math.min(h - 1, h - 1 - Math.floor((screenY / window.innerHeight) * h)));
        gl.readPixels(sx, sy, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this._pixelBuf);
        const r = this._pixelBuf[0], g = this._pixelBuf[1], b = this._pixelBuf[2];
        return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
    },

    onPostRender: function (context) {
        if (window.showAnnotations === false || !context.renderer) return;
        if (this._samplingDisabled) return;
        // 刷新/切后台/回收 WebGL 时禁止 readPixels：部分驱动会直接卡死
        if (typeof document !== 'undefined' && (document.hidden || document.visibilityState === 'hidden')) return;
        if (window.__isPageUnloading) return;
        // 轨道拖动期间禁止 readPixels：与每帧 WebGL 合成叠加时部分驱动会长时间阻塞甚至卡死整页
        if (window._orbitInteracting) return;
        try {
            const gl = context.renderer.getContext && context.renderer.getContext();
            if (gl && typeof gl.isContextLost === 'function' && gl.isContextLost()) return;
        } catch (_e) {}
        // 屏幕取色是 readPixels 的屏幕采样：不应因法线朝向(isOccluded)跳过，否则会长期停留在初始灰色
        const vis = window.colorSampleAnnoList.filter(d => !d.isBehind && d.anchorObj);
        if (!vis.length) return;
        const now = performance.now();
        if (now - this._lastBatchSampleAt < SAMPLE_MIN_INTERVAL_MS) return;
        this._lastBatchSampleAt = now;
        const r = context.renderer;
        try {
            vis.forEach(d => {
                d.sampledColor = this.readScreenColor(r, d.screenX, d.screenY);
                if (d.svgEnd) d.svgEnd.setAttribute('fill', d.sampledColor);
            });
        } catch (e) {
            this._samplingDisabled = true;
            colorSampleDebugLog(`readPixels 异常，已自动停用取色采样: ${e && e.message ? e.message : e}`);
        }
    },

    clearAll: function () {
        this.onClearScene();
    },

    restoreMany: function (obj, annos) {
        if (!annos) return;
        this.ensureDOM();
        annos.forEach(a => {
            window.colorSampleAnnoCounter++;
            const vw = Math.max(1, window.__solidAnnoViewportW || window.innerWidth || 1);
            const vh = Math.max(1, window.__solidAnnoViewportH || window.innerHeight || 1);
            const _dxN = (typeof a.dxN === 'number') ? a.dxN : null;
            const _dyN = (typeof a.dyN === 'number') ? a.dyN : null;
            const _dx = (_dxN !== null) ? (_dxN * vw) : (a.dx || 0);
            const _dy = (_dyN !== null) ? (_dyN * vh) : (a.dy || 0);
            const anchor = new THREE.Object3D();
            anchor.position.set(a.localPos[0], a.localPos[1], a.localPos[2]);
            anchor.name = a.id;
            anchor.userData.localNormal = a.localNormal
                ? new THREE.Vector3(a.localNormal[0], a.localNormal[1], a.localNormal[2])
                : new THREE.Vector3(0, 1, 0);
            obj.add(anchor);
            const annoData = {
                id: a.id,
                targetUUID: obj.uuid,
                anchorObj: anchor,
                dx: _dx,
                dy: _dy,
                dxN: (_dxN !== null) ? _dxN : (typeof _dx === 'number' ? (_dx / vw) : 0),
                dyN: (_dyN !== null) ? _dyN : (typeof _dy === 'number' ? (_dy / vh) : 0),
                dxW: (typeof a.dxW === 'number') ? a.dxW : 0,
                dyW: (typeof a.dyW === 'number') ? a.dyW : 0,
                _placing: false,
                isOccluded: false,
                sampledColor: '#666666',
                ringWorldRadius: typeof a.ringWorldRadius === 'number' && a.ringWorldRadius > 0 ? a.ringWorldRadius : RING_WORLD_RADIUS,
                lineColor: (typeof a.lineColor === 'string' && a.lineColor.startsWith('#')) ? a.lineColor : '#00d2ff',
                labelText: (a.labelText !== undefined && a.labelText !== null) ? String(a.labelText) : '',
                detailText: a.detailText != null ? String(a.detailText) : '',
                labelVisible: a.labelVisible !== false
            };
            if (a.baseDist) annoData.baseDist = a.baseDist;
            if (a.baseScale) annoData.baseScale = a.baseScale;
            window.colorSampleAnnoList.push(annoData);
            this._buildSVG(annoData);
        });
    },

    onUpdate: function (context) {
        if (window.showAnnotations !== false && context.camera) {
            this.updateScreenPositions(context.camera);
        }
    },

    getDetailText: function (id) {
        const data = window.colorSampleAnnoList.find(a => a.id === id);
        return data ? (data.detailText || '') : '';
    }
};

// 以锚点处的“1个世界单位”换算成多少像素：用于让引线长度跟模型保持一致
window.ColorSampleAnnotationManager._pxPerWorldAtAnchor = function(camera, anchorObj) {
    try {
        if (!camera || !anchorObj) return null;
        if (!this._scratchW) this._scratchW = new THREE.Vector3();
        if (!this._rightW) this._rightW = new THREE.Vector3();
        if (!this._upW) this._upW = new THREE.Vector3();
        const p0 = this._centerW || new THREE.Vector3();
        anchorObj.getWorldPosition(p0);
        this._rightW.set(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
        this._upW.set(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
        const toPx = (w) => {
            const v = this._scratchW.copy(w).project(camera);
            return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-(v.y * 0.5) + 0.5) * window.innerHeight };
        };
        const a = toPx(p0);
        const b = toPx(p0.clone().add(this._rightW));
        const c = toPx(p0.clone().add(this._upW));
        const pxPerWorldX = Math.max(1e-6, Math.hypot(b.x - a.x, b.y - a.y));
        const pxPerWorldY = Math.max(1e-6, Math.hypot(c.x - a.x, c.y - a.y));
        return { pxPerWorldX, pxPerWorldY };
    } catch (_e) { return null; }
};

window.addEventListener('keydown', e => {
    if (e.key !== 'Delete') return;
    // 编辑中不响应删除
    if (document.activeElement && document.activeElement.isContentEditable) return;
    const id = window.ColorSampleAnnotationManager.selectedId;
    if (id === null) return;
    const idx = window.colorSampleAnnoList.findIndex(a => a.id === id);
    if (idx > -1) {
        const data = window.colorSampleAnnoList[idx];
        if (data.anchorObj && data.anchorObj.parent) data.anchorObj.parent.remove(data.anchorObj);
        if (data.svgGlowPath) data.svgGlowPath.remove();
        if (data.svgPath) data.svgPath.remove();
        if (data.svgStem) data.svgStem.remove();
        if (data.svgRing) data.svgRing.remove();
        if (data.svgEnd) data.svgEnd.remove();
        if (data.domLabel) data.domLabel.remove();
        if (data.cleanupEvents) data.cleanupEvents();
        window.colorSampleAnnoList.splice(idx, 1);
        if (typeof window.needsUpdate !== 'undefined') window.needsUpdate = true;
        if (typeof window.lightMoved !== 'undefined') window.lightMoved = true;
    }
    window.ColorSampleAnnotationManager.selectedId = null;
});

const _csColorPicker = document.getElementById('obj-color-picker');
if (_csColorPicker) {
    _csColorPicker.addEventListener('input', e => {
        const id = window.ColorSampleAnnotationManager.selectedId;
        if (id === null) return;
        const data = window.colorSampleAnnoList.find(a => a.id === id);
        if (!data) return;
        data.lineColor = e.target.value;
        if (data.svgPath) data.svgPath.setAttribute('stroke', data.lineColor);
        if (data.svgGlowPath) data.svgGlowPath.setAttribute('stroke', data.lineColor);
        if (data.domLabel) {
            data.domLabel.style.borderColor = data.lineColor;
            data.domLabel.style.backgroundColor = getDarkBg(data.lineColor);
        }
    });
}

// 与经典引线一致：全局注册 onSceneHit，仅用 window.currentEditorMode 分流。
// 放置态由 cancelInteractivePlacing + 宿主经 PluginManager.setMode 统一解除，勿依赖「仍在取色模式才 keyup」。
if (window.PluginManager) {
    window.PluginManager.register('ColorSampleAnnotation_UI', window.ColorSampleAnnotationManager);
}
