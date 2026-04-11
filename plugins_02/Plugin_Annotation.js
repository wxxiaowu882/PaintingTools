import * as THREE from 'three';
window.annoDataList = [];
window.annoCounter = 0;
window.AnnotationManager = {
    selectedId: null,
    isPlacing: false,
    activeData: null,
    _cachedControls: null,

    onSceneHit: function (context) {
        if (window.currentEditorMode !== 'annotate') return;
        const ev = context.event;
        const shiftHeld = ev.shiftKey || (typeof ev.getModifierState === 'function' && ev.getModifierState('Shift'));
        if (!shiftHeld) return;
        this.createLeader(context.targetObj, context.hitPoint, context.worldNormal);
        this.activeData = window.annoDataList[window.annoDataList.length - 1];
        this.isPlacing = true;
        this._cachedControls = context.controls;
        if (this._cachedControls) this._cachedControls.enabled = false;
        if (window.showToast) window.showToast('已锁定锚点：请移动鼠标确定文字位置，松开 Alt 或 Shift 完成。');
    },
    onGlobalPointerMove: function (context) {
        if (window.currentEditorMode !== 'annotate') return;
        if (this.isPlacing && this.activeData) {
            const vw = Math.max(1, window.__solidAnnoViewportW || window.innerWidth || 1);
            const vh = Math.max(1, window.__solidAnnoViewportH || window.innerHeight || 1);
            this.activeData.dx = context.event.clientX - context.startX;
            this.activeData.dy = context.event.clientY - context.startY;
            this.activeData.dxN = this.activeData.dx / vw;
            this.activeData.dyN = this.activeData.dy / vh;
            // 同时记录“跟模型走”的长度：确保 PC/手机形态一致（不随屏幕宽窄变短/变长）
            try {
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
        if (window.currentEditorMode === 'annotate' && window.showToast) window.showToast('引线已放置。');
    },
    onBeforePointerDown: function () {
        if (window.currentEditorMode === 'annotate' && this.isPlacing) return true;
    },
    onGlobalPointerUp: function () {
        if (window.currentEditorMode === 'annotate' && this.isPlacing) return true;
    },

    onClearScene: function () {
        if (!window.annoDataList) return;
        this.cancelInteractivePlacing();
        window.annoDataList.forEach(data => {
            if (data.anchorObj && data.anchorObj.parent) data.anchorObj.parent.remove(data.anchorObj);
            const dom = document.getElementById('dom_' + data.id);
            if (dom) dom.remove();
            if (data.svgPath) data.svgPath.remove();
            if (data.svgGlowPath) data.svgGlowPath.remove();
            if (data.svgCircle) data.svgCircle.remove();
            if (typeof data.cleanupEvents === 'function') data.cleanupEvents();
        });
        window.annoDataList = [];
        this.selectedId = null;
        this.isPlacing = false;
        this.activeData = null;
        this._cachedControls = null;
    },

    onLoadItem: function (ctx) {
        if (!ctx.itemData.annotations) return;
        const leaders = ctx.itemData.annotations.filter(a => {
            const k = a.annotationKind || (a.text != null ? 'leader' : 'colorSample');
            return k !== 'colorSample';
        });
        const safeData = leaders.filter(a => !window.annoDataList.some(exist => exist.id === a.id)).map(a => {
            if (!a.baseScale || a.baseScale === 0) a.baseScale = 1;
            return a;
        });
        if (safeData.length > 0) this.restoreAnnotations(ctx.obj, safeData);
    },
    onLoadGround: function (ctx) {
        if (!ctx.sceneData.groundAnnotations) return;
        const leaders = ctx.sceneData.groundAnnotations.filter(a => {
            const k = a.annotationKind || (a.text != null ? 'leader' : 'colorSample');
            return k !== 'colorSample';
        });
        const safeData = leaders.filter(a => !window.annoDataList.some(exist => exist.id === a.id)).map(a => {
            if (!a.baseScale || a.baseScale === 0) a.baseScale = 1;
            return a;
        });
        if (safeData.length > 0) this.restoreAnnotations(ctx.obj, safeData);
    },
    onSaveItemData: function (context) {
        const annos = this.extractSaveData(context.obj);
        if (annos.length > 0) context.itemData.annotations = annos;
    },
    onSaveGroundData: function (context) {
        const annos = this.extractSaveData(context.obj);
        if (annos.length > 0) context.sceneData.groundAnnotations = annos;
    },

    extractSaveData: function (obj) {
        const annotations = [];
        if (!obj || !obj.children) return annotations;
        obj.children.forEach(c => {
            if (!c.name || !c.name.startsWith('anno_')) return;
            const aData = window.annoDataList.find(a => a.id === c.name);
            if (!aData) return;
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
            annotations.push({
                id: aData.id,
                annotationKind: 'leader',
                text: aData.text,
                detailText: aData.detailText != null ? String(aData.detailText) : '',
                color: aData.color,
                dx: aData.dx,
                dy: aData.dy,
                dxN: typeof aData.dxN === 'number' ? parseFloat(aData.dxN.toFixed(6)) : (typeof aData.dx === 'number' ? parseFloat((aData.dx / vw).toFixed(6)) : 0),
                dyN: typeof aData.dyN === 'number' ? parseFloat(aData.dyN.toFixed(6)) : (typeof aData.dy === 'number' ? parseFloat((aData.dy / vh).toFixed(6)) : 0),
                dxW: typeof aData.dxW === 'number' ? parseFloat(aData.dxW.toFixed(6)) : undefined,
                dyW: typeof aData.dyW === 'number' ? parseFloat(aData.dyW.toFixed(6)) : undefined,
                localPos: [
                    parseFloat(c.position.x.toFixed(4)),
                    parseFloat(c.position.y.toFixed(4)),
                    parseFloat(c.position.z.toFixed(4))
                ],
                localNormal: norm,
                baseDist: aData.baseDist,
                baseScale: aData.baseScale
            });
        });
        return annotations;
    },

    onDrawSnapshot: function (context) {
        if (!window.annoDataList) return;
        const ctx2 = context.ctx, rect = context.rect;
        const scaleX = 256 / rect.width, scaleY = 256 / rect.height;
        window.annoDataList.forEach(data => {
            if (data.isBehind || data.isOccluded) return;
            const ax = data.screenX, ay = data.screenY, ax1 = ax + data.scaledDx, ay1 = ay + data.scaledDy, amidX = ax + data.scaledDx * 0.5;
            const tx = (ax - rect.left) * scaleX, ty = (ay - rect.top) * scaleY, tx1 = (ax1 - rect.left) * scaleX, ty1 = (ay1 - rect.top) * scaleY, tmidX = (amidX - rect.left) * scaleX;
            ctx2.strokeStyle = data.color;
            ctx2.lineWidth = 1.5;
            ctx2.beginPath();
            ctx2.moveTo(tx, ty);
            ctx2.lineTo(tmidX, ty1);
            ctx2.lineTo(tx1, ty1);
            ctx2.stroke();
            ctx2.fillStyle = data.color;
            ctx2.beginPath();
            ctx2.arc(tx, ty, 3, 0, Math.PI * 2);
            ctx2.fill();
            ctx2.font = '11px Inter, sans-serif';
            const textWidth = ctx2.measureText(data.text).width;
            const boxW = textWidth + 16, boxH = 20;
            ctx2.fillStyle = window.AnnotationManager.getDarkBg(data.color);
            ctx2.fillRect(tx1 - boxW / 2, ty1 - boxH / 2, boxW, boxH);
            ctx2.strokeStyle = data.color;
            ctx2.lineWidth = 1;
            ctx2.strokeRect(tx1 - boxW / 2, ty1 - boxH / 2, boxW, boxH);
            ctx2.fillStyle = '#ffffff';
            ctx2.textAlign = 'center';
            ctx2.textBaseline = 'middle';
            ctx2.fillText(data.text, tx1, ty1);
        });
    },

    getDarkBg: function (hex) {
        let c = hex.replace('#', '');
        if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
        const r = parseInt(c.substring(0, 2), 16), g = parseInt(c.substring(2, 4), 16), b = parseInt(c.substring(4, 6), 16);
        return `rgba(${(r * 0.2) | 0}, ${(g * 0.2) | 0}, ${(b * 0.2) | 0}, 0.85)`;
    },

    highlightSelected: function () {
        document.querySelectorAll('.anno-dom').forEach(el => {
            el.style.boxShadow = 'none';
            el.style.borderColor = el.dataset.color || '#00d2ff';
            el.style.zIndex = '99999';
        });
        const picker = document.getElementById('obj-color-picker');
        if (this.selectedId !== null) {
            const el = document.getElementById('dom_' + this.selectedId);
            const data = window.annoDataList.find(a => a.id === this.selectedId);
            if (el) {
                el.style.boxShadow = '0 0 10px rgba(255, 255, 255, 0.8)';
                el.style.borderColor = '#fff';
                el.style.zIndex = '100000';
            }
            if (data && picker) picker.value = data.color;
        }
        if (picker) {
            picker.disabled = false;
            picker.style.opacity = '1';
            picker.style.cursor = 'pointer';
        }
    },

    ensureDOM: function () {
        if (!document.getElementById('anno-style-inject')) {
            const style = document.createElement('style');
            style.id = 'anno-style-inject';
            style.innerHTML = `
                    #anno-layer { position: absolute; top: 0; left: 0; width: 100vw; height: 100vh; pointer-events: none; z-index: 50 !important; overflow: hidden; }
                    #anno-svg { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; }
                    .anno-dom { position: absolute; transform: translate(-50%, -50%); pointer-events: auto; font-family: 'Inter', sans-serif; }
                    .anno-leader-label { border: 1px solid #0df; color: #fff; padding: 4px 8px; font-size: 11px; line-height: 1.35; box-sizing: border-box; white-space: nowrap; cursor: pointer; user-select: none; border-radius: 2px; transition: opacity 0.2s; display: inline-flex; align-items: center; justify-content: center; }
                    .anno-leader-label.editing { background: #fff !important; color: #000; outline: none; border-color: #fff !important; box-shadow: 0 0 10px rgba(0,210,255,0.5) !important; user-select: text !important; cursor: text !important; }
                `;
            document.head.appendChild(style);
        }
        if (!document.getElementById('anno-layer')) {
            const layer = document.createElement('div');
            layer.id = 'anno-layer';
            layer.innerHTML = '<svg id="anno-svg"></svg>';
            document.body.appendChild(layer);
        }
    },

    createLeader: function (targetObj, worldPoint, worldNormal) {
        try {
            this.ensureDOM();
            window.annoCounter++;
            const id = 'anno_' + Date.now() + '_' + window.annoCounter;
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
            const color = document.getElementById('obj-color-picker')?.value || '#00d2ff';
            const annoData = {
                id, targetUUID: targetObj.uuid, anchorObj: anchor,
                text: '引线 ' + window.annoCounter, detailText: '', color, dx: 0, dy: 0, dxN: 0, dyN: 0, dxW: 0, dyW: 0, isOccluded: false
            };
            window.annoDataList.push(annoData);
            this.buildDOM(annoData);
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

    buildDOM: function (data) {
        const layer = document.getElementById('anno-layer');
        const svg = document.getElementById('anno-svg');
        const div = document.createElement('div');
        div.className = 'anno-dom anno-leader-label';
        div.id = 'dom_' + data.id;
        div.innerText = data.text;
        div.style.borderColor = data.color;
        div.style.backgroundColor = this.getDarkBg(data.color);
        div.dataset.color = data.color;
        div.addEventListener('pointerdown', e => {
            e.stopPropagation();
            if (window.__SOLID_CONSUMER__) {
                if (window.PluginManager && typeof window.PluginManager.setExclusiveSelection === 'function') {
                    if (window.AnnotationManager.selectedId === data.id) {
                        window.PluginManager.setExclusiveSelection(window.AnnotationManager, null);
                    } else {
                        window.PluginManager.setExclusiveSelection(window.AnnotationManager, data.id);
                    }
                }
                return;
            }
            if (!div.isContentEditable) {
                if (window.PluginManager && typeof window.PluginManager.setExclusiveSelection === 'function') {
                    window.PluginManager.setExclusiveSelection(window.AnnotationManager, data.id);
                } else {
                    window.AnnotationManager.selectedId = data.id;
                    window.AnnotationManager.highlightSelected();
                }
            }
        });
        div.addEventListener('click', e => { e.stopPropagation(); });
        div.addEventListener('dblclick', e => {
            if (window.__SOLID_CONSUMER__) return;
            e.stopPropagation();
            if (window.PluginManager && typeof window.PluginManager.setExclusiveSelection === 'function') {
                window.PluginManager.setExclusiveSelection(window.AnnotationManager, data.id);
            } else {
                window.AnnotationManager.selectedId = data.id;
                window.AnnotationManager.highlightSelected();
            }
            div.contentEditable = true;
            div.classList.add('editing');
            div.style.cursor = 'text';
            div.focus();
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(div);
            selection.removeAllRanges();
            selection.addRange(range);
        });
        div.addEventListener('blur', () => {
            div.contentEditable = false;
            div.classList.remove('editing');
            div.style.cursor = 'pointer';
            data.text = div.innerText;
            window.needsUpdate = true;
        });
        div.addEventListener('keydown', e => { if (e.key === 'Delete' || e.key === 'Backspace') e.stopPropagation(); });
        let isDragging = false, startX, startY, startDx, startDy, isMoved = false;
        div.addEventListener('mousedown', e => {
            if (div.isContentEditable) { e.stopPropagation(); return; }
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
            // 这里用“像素拖拽”更符合手感；同时换算出 dxW/dyW 以保证跨端形态一致
            data.dx = startDx + (e.clientX - startX);
            data.dy = startDy + (e.clientY - startY);
            data.dxN = data.dx / vw;
            data.dyN = data.dy / vh;
            try {
                const cam = window.AnnotationManager._cachedCamera;
                if (cam && data.anchorObj) {
                    const px = window.AnnotationManager._pxPerWorldAtAnchor(cam, data.anchorObj);
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
        layer.appendChild(div);
        const ns = 'http://www.w3.org/2000/svg';
        const glowPath = document.createElementNS(ns, 'path');
        glowPath.setAttribute('fill', 'none');
        glowPath.setAttribute('stroke', data.color);
        glowPath.setAttribute('stroke-width', '6');
        glowPath.setAttribute('opacity', '0.2');
        svg.appendChild(glowPath);
        data.svgGlowPath = glowPath;
        const path = document.createElementNS(ns, 'path');
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', data.color);
        path.setAttribute('stroke-width', '1.5');
        svg.appendChild(path);
        data.svgPath = path;
        const circle = document.createElementNS(ns, 'circle');
        circle.setAttribute('r', '3');
        circle.setAttribute('fill', data.color);
        svg.appendChild(circle);
        data.svgCircle = circle;
        data.domEl = div;
    },

    updateScreenPositions: function (camera) {
        if (window.annoDataList.length === 0) return;
        this._cachedCamera = camera;
        if (!this._poolInit) {
            this._tempV = new THREE.Vector3();
            this._normalMatrix = new THREE.Matrix3();
            this._viewDir = new THREE.Vector3();
            this._currentWorldNormal = new THREE.Vector3();
            this._rightW = new THREE.Vector3();
            this._upW = new THREE.Vector3();
            this._scratchW = new THREE.Vector3();
            this._poolInit = true;
        }
        window.annoDataList.forEach(data => {
            if (!data.anchorObj) return;
            data.anchorObj.getWorldPosition(this._tempV);
            const dist = camera.position.distanceTo(this._tempV);
            const safeDist = Math.max(dist, 0.1);
            const modelScaleX = data.anchorObj.parent ? data.anchorObj.parent.scale.x : 1;
            if (!data.baseDist) {
                data.baseDist = safeDist;
                data.baseScale = modelScaleX;
            }
            let lineScale = (data.baseDist / safeDist) * (modelScaleX / data.baseScale);
            lineScale = Math.max(0.1, Math.min(lineScale, 10.0));
            data.currentScale = lineScale;
            const textScale = 1.0;
            if (data.anchorObj.parent && data.anchorObj.userData.localNormal) {
                this._normalMatrix.getNormalMatrix(data.anchorObj.parent.matrixWorld);
                this._currentWorldNormal.copy(data.anchorObj.userData.localNormal).applyMatrix3(this._normalMatrix).normalize();
                this._viewDir.copy(camera.position).sub(this._tempV).normalize();
                data.isOccluded = this._currentWorldNormal.dot(this._viewDir) < -0.05;
            } else {
                data.isOccluded = false;
            }
            this._tempV.project(camera);
            const isBehind = this._tempV.z > 1.0 || this._tempV.z < -1.0;
            const x = (this._tempV.x * 0.5 + 0.5) * window.innerWidth;
            const y = (-(this._tempV.y * 0.5) + 0.5) * window.innerHeight;
            const opacity = isBehind ? '0' : (data.isOccluded ? '0.2' : '1');
            const pointerEvents = (isBehind || data.isOccluded) ? 'none' : 'auto';
            // 形态一致：优先用“跟模型走”的长度（dxW/dyW），让 PC/手机看到的相对比例一致
            const px = this._pxPerWorldAtAnchor(camera, data.anchorObj);
            const hasWorld = (typeof data.dxW === 'number') || (typeof data.dyW === 'number');
            const scaledDx = hasWorld && px ? (Number(data.dxW || 0) * px.pxPerWorldX) : ((typeof data.dx === 'number' ? data.dx : 0) * lineScale);
            const scaledDy = hasWorld && px ? (Number(data.dyW || 0) * px.pxPerWorldY) : ((typeof data.dy === 'number' ? data.dy : 0) * lineScale);
            data.screenX = x;
            data.screenY = y;
            data.scaledDx = scaledDx;
            data.scaledDy = scaledDy;
            data.isBehind = isBehind;
            // 同步回像素缓存，保证后续拖拽以当前视图为基准
            data.dx = scaledDx;
            data.dy = scaledDy;
            if (data.domEl) {
                data.domEl.style.left = (x + scaledDx) + 'px';
                data.domEl.style.top = (y + scaledDy) + 'px';
                data.domEl.style.opacity = opacity;
                data.domEl.style.pointerEvents = pointerEvents;
                data.domEl.style.transform = `translate(-50%, -50%) scale(${textScale})`;
            }
            if (data.svgPath && data.svgCircle && !isNaN(x)) {
                if (!isBehind && !data.isOccluded) {
                    const x1 = x + scaledDx;
                    const y1 = y + scaledDy;
                    const midX = x + scaledDx * 0.5;
                    const dStr = `M ${x} ${y} L ${midX} ${y1} L ${x1} ${y1}`;
                    if (data.svgGlowPath) {
                        data.svgGlowPath.setAttribute('d', dStr);
                        data.svgGlowPath.setAttribute('opacity', '0.2');
                    }
                    data.svgPath.setAttribute('d', dStr);
                    data.svgPath.setAttribute('opacity', '0.8');
                    data.svgCircle.setAttribute('cx', x);
                    data.svgCircle.setAttribute('cy', y);
                    data.svgCircle.setAttribute('opacity', '0.8');
                } else {
                    if (data.svgGlowPath) data.svgGlowPath.setAttribute('opacity', '0');
                    data.svgPath.setAttribute('opacity', '0');
                    data.svgCircle.setAttribute('opacity', '0');
                }
            }
        });
    },

    clearAll: function () {
        window.annoDataList.forEach(data => {
            if (data.cleanupEvents) data.cleanupEvents();
            if (data.anchorObj && data.anchorObj.parent) data.anchorObj.parent.remove(data.anchorObj);
        });
        window.annoDataList = [];
        const layer = document.getElementById('anno-layer');
        if (layer) layer.querySelectorAll('.anno-dom').forEach(el => el.remove());
        const svg = document.getElementById('anno-svg');
        if (svg) svg.innerHTML = '';
        this.selectedId = null;
    },

    restoreAnnotations: function (obj, annos) {
        if (!annos) return;
        this.ensureDOM();
        annos.forEach(a => {
            window.annoCounter++;
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
                id: a.id, targetUUID: obj.uuid, anchorObj: anchor,
                text: a.text || '引线',
                detailText: a.detailText != null ? String(a.detailText) : '',
                color: a.color || '#00d2ff',
                dx: _dx,
                dy: _dy,
                dxN: (_dxN !== null) ? _dxN : (typeof _dx === 'number' ? (_dx / vw) : 0),
                dyN: (_dyN !== null) ? _dyN : (typeof _dy === 'number' ? (_dy / vh) : 0),
                dxW: (typeof a.dxW === 'number') ? a.dxW : 0,
                dyW: (typeof a.dyW === 'number') ? a.dyW : 0,
                isOccluded: false
            };
            if (a.baseDist) annoData.baseDist = a.baseDist;
            if (a.baseScale) annoData.baseScale = a.baseScale;
            window.annoDataList.push(annoData);
            this.buildDOM(annoData);
        });
    },

    getDetailText: function (id) {
        const data = window.annoDataList.find(a => a.id === id);
        return data ? (data.detailText || '') : '';
    }
};

// 以锚点处的“1个世界单位”换算成多少像素：用于让引线长度跟模型保持一致
window.AnnotationManager._pxPerWorldAtAnchor = function(camera, anchorObj) {
    try {
        if (!camera || !anchorObj) return null;
        if (!this._scratchW) this._scratchW = new THREE.Vector3();
        if (!this._rightW) this._rightW = new THREE.Vector3();
        if (!this._upW) this._upW = new THREE.Vector3();
        const p0 = this._tempV || new THREE.Vector3();
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
    if (document.activeElement && document.activeElement.isContentEditable) return;
    const id = window.AnnotationManager.selectedId;
    if (id === null) return;
    const idx = window.annoDataList.findIndex(a => a.id === id);
    if (idx > -1) {
        const data = window.annoDataList[idx];
        if (data.anchorObj && data.anchorObj.parent) data.anchorObj.parent.remove(data.anchorObj);
        const div = document.getElementById('dom_' + id);
        if (div) div.remove();
        if (data.svgGlowPath) data.svgGlowPath.remove();
        if (data.svgPath) data.svgPath.remove();
        if (data.svgCircle) data.svgCircle.remove();
        if (data.cleanupEvents) data.cleanupEvents();
        window.annoDataList.splice(idx, 1);
        window.needsUpdate = true;
        window.lightMoved = true;
    }
    window.AnnotationManager.selectedId = null;
});

const colorPicker = document.getElementById('obj-color-picker');
if (colorPicker) {
    colorPicker.addEventListener('input', e => {
        const id = window.AnnotationManager.selectedId;
        if (id === null) return;
        const data = window.annoDataList.find(a => a.id === id);
        if (!data) return;
        data.color = e.target.value;
        const div = document.getElementById('dom_' + id);
        if (div) {
            div.dataset.color = data.color;
            div.style.backgroundColor = window.AnnotationManager.getDarkBg(data.color);
        }
        if (data.svgPath) data.svgPath.setAttribute('stroke', data.color);
        if (data.svgGlowPath) data.svgGlowPath.setAttribute('stroke', data.color);
        if (data.svgCircle) data.svgCircle.setAttribute('fill', data.color);
        window.needsUpdate = true;
    });
}

window.AnnotationManager.onUpdate = function (context) {
    if (window.showAnnotations !== false && context.camera) {
        this.updateScreenPositions(context.camera);
    }
};

if (window.PluginManager) window.PluginManager.register('Annotation_UI', window.AnnotationManager);
