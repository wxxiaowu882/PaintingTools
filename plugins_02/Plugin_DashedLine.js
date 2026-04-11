/*
* Plugin_DashedLine.js
* 功能：连续虚线标注（纯内存数据阵列 + 极限性能点乘剔除）
*/
import * as THREE from 'three'; window.dashedLineList = []; window.dashedLineCounter = 0; window.DashedLineManager = { pluginId: 'Plugin_DashedLine', selectedId: null, isDrawing: false, currentLine: null,
    _lastAddPos: new THREE.Vector3(), ensureDOM: function() { if (!document.getElementById('dashed-line-layer')) { const layer = document.createElement('div'); layer.id = 'dashed-line-layer';
    // z-index: 48 确保在底层，不干扰法线和引线点击
    layer.style.cssText = 'position: absolute; top: 0; left: 0; width: 100vw; height: 100vh; pointer-events: none; z-index: 48; overflow: hidden;'; layer.innerHTML = '<svg id="dashed-line-svg" style="width: 100%; height: 100%; pointer-events: none;"></svg>'; document.body.appendChild(layer); // 独立挂载颜色拾取器联动
    const colorPicker = document.getElementById('obj-color-picker'); if (colorPicker) { colorPicker.addEventListener('input', e => { if (this.selectedId !== null) {
    const data = window.dashedLineList.find(a => a.id === this.selectedId); if (data) { data.color = e.target.value; if (data.domEl) { data.domEl.dataset.color = data.color; data.domEl.style.borderColor = data.color; }
    if (data.svgPath) data.svgPath.setAttribute("stroke", data.color); if (data.svgGlowPath) data.svgGlowPath.setAttribute("stroke", data.color); window.needsUpdate = true; } } }); } } },
    startLine: function(anchorParent, worldPos, worldNormal) { this.ensureDOM(); this.isDrawing = true; const id = 'dash_line_' + Date.now(); const anchorObj = new THREE.Object3D(); anchorObj.name = id;
    anchorParent.add(anchorObj); // 绑定唯一基站到模型，极大降低 DOM 树深度
    const data = { id: id, anchorObj: anchorObj, color: '#00d2ff', text: "线段 " + (++window.dashedLineCounter), detailText: '', points: [], // 纯内存数据阵列: { localPos, localNormal }
    midIndex: 0, isOccluded: false, lastDStr: '' }; this.currentLine = data; window.dashedLineList.push(data); this._lastAddPos.copy(worldPos); this.addPoint(worldPos, worldNormal, true); this.buildSVG(data);
    return data; }, addPoint: function(worldPos, worldNormal, force = false) { if (!this.isDrawing || !this.currentLine || !this.currentLine.anchorObj) return; // 【距离检测防刷屏】：世界距离大于 0.015 (1.5厘米) 才记录，防止点位过于密集挤爆内存
    if (!force && this._lastAddPos.distanceTo(worldPos) < 0.015) return; this._lastAddPos.copy(worldPos); const localPos = this.currentLine.anchorObj.worldToLocal(worldPos.clone()); this.currentLine.points.push({ localPos: localPos,
    localNormal: worldNormal.clone() }); window.needsUpdate = true; }, finishLine: function() { if (!this.isDrawing || !this.currentLine) return; this.isDrawing = false; const data = this.currentLine; if (data.points.length < 2) {
    // 如果只点了一下没拉开，视为误触，直接无痕销毁
    this.deleteLine(data.id); } else { // 计算中点索引，用于挂载文本标签
    data.midIndex = Math.floor(data.points.length / 2); this.buildDOM(data); }
    this.currentLine = null; window.needsUpdate = true; }, cancelInteractivePlacing: function() { if (this.isDrawing) this.finishLine(); }, buildSVG: function(data) { const svg = document.getElementById('dashed-line-svg'); const ns = "http://www.w3.org/2000/svg";
    const glowPath = document.createElementNS(ns, "path"); glowPath.setAttribute("fill", "none"); glowPath.setAttribute("stroke", data.color);
    glowPath.setAttribute("stroke-width", "5"); glowPath.setAttribute("opacity", "0.2"); glowPath.style.pointerEvents = "none";
    const path = document.createElementNS(ns, "path"); path.setAttribute("fill", "none"); path.setAttribute("stroke", data.color);
    path.setAttribute("stroke-width", "2.5"); path.setAttribute("stroke-dasharray", "6, 6"); path.style.pointerEvents = "none";
    const hitPath = document.createElementNS(ns, "path");
    hitPath.setAttribute("fill", "none"); hitPath.setAttribute("stroke", "transparent");
    hitPath.setAttribute("stroke-width", "20"); hitPath.style.pointerEvents = "auto"; hitPath.style.cursor = "pointer";
    hitPath.addEventListener('pointerdown', e => { e.stopPropagation();
    if (window.currentEditorMode === 'annotate' || window.currentEditorMode === 'normal-arrow' || window.currentEditorMode === 'dashed-line') return;
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
    svg.appendChild(hitPath); data.svgHitPath = hitPath; }, buildDOM: function(data) { const layer = document.getElementById('dashed-line-layer'); const dom = document.createElement('div');
    dom.id = 'dom_' + data.id; dom.className = 'dashed-line-dom';     dom.style.cssText = `
                position: absolute; pointer-events: auto; cursor: pointer;
                padding: 4px 8px; border-radius: 4px; border: 1px solid ${data.color};
                background: rgba(0, 20, 40, 0.85); color: white; font-size: 12px; line-height: 1.35; box-sizing: border-box;
                white-space: nowrap; user-select: none; transition: opacity 0.2s;
                transform: translate(-50%, -50%); display: none; align-items: center; justify-content: center;
            `; dom.innerText = data.text; dom.dataset.color = data.color;
    dom.addEventListener('pointerdown', e => { e.stopPropagation();
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
    if (data.svgPath) data.svgPath.setAttribute("stroke-width", "2.5"); if (data.svgGlowPath) data.svgGlowPath.setAttribute("opacity", "0.2"); });
    const data = window.dashedLineList.find(a => a.id === this.selectedId); if (data) { if (data.domEl) data.domEl.style.boxShadow = `0 0 10px ${data.color}`;
    if (data.svgPath) data.svgPath.setAttribute("stroke-width", "4"); if (data.svgGlowPath) data.svgGlowPath.setAttribute("opacity", "0.5"); } },
    deleteSelected: function() { if (this.selectedId !== null) { this.deleteLine(this.selectedId); this.selectedId = null; } }, deleteLine: function(id) { const idx = window.dashedLineList.findIndex(a => a.id === id); if (idx > -1) {
    const data = window.dashedLineList[idx]; if(data.anchorObj && data.anchorObj.parent) data.anchorObj.parent.remove(data.anchorObj); if(data.domEl) data.domEl.remove(); if(data.svgGlowPath) data.svgGlowPath.remove();
    if(data.svgPath) data.svgPath.remove(); if(data.svgHitPath) data.svgHitPath.remove(); window.dashedLineList.splice(idx, 1); window.needsUpdate = true; } }, updateScreenPositions: function(camera) {
    if(window.dashedLineList.length === 0) return; // 【核心性能护城河】：零对象分配池，斩断 GC 回收的性能卡顿
    if (!this._poolInit) { this._tempV = new THREE.Vector3(); this._normalMatrix = new THREE.Matrix3(); this._viewDir = new THREE.Vector3(); this._currentWorldNormal = new THREE.Vector3(); this._poolInit = true; }
    window.dashedLineList.forEach(data => { if(!data.anchorObj || data.points.length === 0) return; if (data.anchorObj.parent) { this._normalMatrix.getNormalMatrix(data.anchorObj.parent.matrixWorld); }
    let dStr = ''; let isOccluded = false; let midX = 0, midY = 0, midVisible = false; for (let i = 0; i < data.points.length; i++) { const pt = data.points[i]; this._tempV.copy(pt.localPos);
    data.anchorObj.localToWorld(this._tempV); // 【点乘遮挡剔除】：用超轻量级数学算法替代 DOM 获取和射线，只要有一点转到背面，整条线变半透明幽灵状态
    if (!isOccluded && data.anchorObj.parent) { this._currentWorldNormal.copy(pt.localNormal).applyMatrix3(this._normalMatrix).normalize(); this._viewDir.copy(camera.position).sub(this._tempV).normalize();
    if (this._currentWorldNormal.dot(this._viewDir) < -0.05) { isOccluded = true; } }
    this._tempV.project(camera); const isBehind = this._tempV.z > 1.0 || this._tempV.z < -1.0; const x = (this._tempV.x * 0.5 + 0.5) * window.innerWidth; const y = (-(this._tempV.y * 0.5) + 0.5) * window.innerHeight;
    if (!isNaN(x) && !isNaN(y) && !isBehind) { dStr += `${dStr.length === 0 ? 'M' : 'L'} ${x} ${y} `; if (i === data.midIndex && !this.isDrawing) { midX = x; midY = y; midVisible = true; } } }
    // 【脏检查】：只在画面像素级变动时才刷新 DOM，节省 90% 性能
    if (data.lastDStr !== dStr) { if (data.svgGlowPath) data.svgGlowPath.setAttribute("d", dStr); if (data.svgPath) data.svgPath.setAttribute("d", dStr);
    if (data.svgHitPath) data.svgHitPath.setAttribute("d", dStr); data.lastDStr = dStr; }
    if (data.lastOccluded !== isOccluded) { const opacity = isOccluded ? "0.2" : "0.9"; if (data.svgPath) data.svgPath.setAttribute("opacity", opacity);
    if (data.domEl) data.domEl.style.opacity = isOccluded ? "0.3" : "1"; data.lastOccluded = isOccluded; }
    if (data.domEl) { if (midVisible) { data.domEl.style.display = 'inline-flex'; data.domEl.style.left = midX + 'px'; data.domEl.style.top = (midY - 15) + 'px'; } else {
    data.domEl.style.display = 'none'; } } }); }, clearAll: function() { window.dashedLineList.forEach(data => { if(data.anchorObj && data.anchorObj.parent) data.anchorObj.parent.remove(data.anchorObj);
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
            lines.push({ id: d.id, color: d.color, text: d.text != null ? String(d.text) : '', detailText: d.detailText != null ? String(d.detailText) : '', points: pts });
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
            const data = {
                id: id,
                anchorObj: anchorObj,
                color: line.color || '#00d2ff',
                text: line.text != null ? String(line.text) : '线段',
                detailText: line.detailText != null ? String(line.detailText) : '',
                points: line.points.map(p => ({
                    localPos: new THREE.Vector3(p.pos[0], p.pos[1], p.pos[2]),
                    localNormal: new THREE.Vector3(p.norm[0], p.norm[1], p.norm[2])
                })),
                midIndex: Math.floor(line.points.length / 2),
                isOccluded: false,
                lastDStr: ''
            };
            window.dashedLineList.push(data);
            this.buildSVG(data);
            this.buildDOM(data);
        });
    } }; // 挂载到主引擎
    if (window.PluginManager) { window.PluginManager.register('DashedLine', window.DashedLineManager); }
    window.DashedLineManager.onUpdate = function(context) { if (window.showAnnotations !== false && context.camera) { this.updateScreenPositions(context.camera); const layer = document.getElementById('dashed-line-layer');
    if (layer) layer.style.display = 'block'; } else { const layer = document.getElementById('dashed-line-layer'); if (layer) layer.style.display = 'none'; } };