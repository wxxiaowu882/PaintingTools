import * as THREE from 'three'; window.normArrowList = []; window.normArrowCounter = 0; window.NormalArrowManager = { selectedId: null, onSceneHit: function(context) { // 【核心精准修复】：法线箭头专属，必须严格校验当前是否为 'normal-arrow' 模式！
    if (window.currentEditorMode !== 'normal-arrow') return; if (context.event.shiftKey) return; // 属于引线的操作，忽略
    this.createNormalArrow(context.targetObj, context.hitPoint, context.worldNormal); }, // 【生命周期】：接管场景清理 (Core.Memory) 解决新建场景僵尸数据卡死 Bug
    onClearScene: function() { if (!window.normArrowList) return; window.normArrowList.forEach(data => { if(data.anchorObj && data.anchorObj.parent) data.anchorObj.parent.remove(data.anchorObj);
    if(data.svgGlowPath) data.svgGlowPath.remove(); if(data.svgPath) data.svgPath.remove(); if(data.svgStem) data.svgStem.remove(); if (data.domLabel) data.domLabel.remove(); if(data.svgHitPath) data.svgHitPath.remove();
    if(data.svgFace1) data.svgFace1.remove(); if(data.svgFace2) data.svgFace2.remove(); if(data.svgFace3) data.svgFace3.remove(); if(data.svgStem) data.svgStem.remove();
    if (data.domLabel) data.domLabel.remove();
    if (typeof data.cleanupEvents === 'function') data.cleanupEvents(); // 预防性清理隐形监听
    }); window.normArrowList = []; this.selectedId = null; }, // 【数据流生命周期】：接管 JSON 反序列化读取 (Core.IO)
    onLoadItem: function(ctx) { if(ctx.itemData.normalArrows || ctx.itemData.normArrows) { const rawData = ctx.itemData.normalArrows || ctx.itemData.normArrows; // 【核心修复】：同步拦截脏数据与 Infinity 隐患
    const safeData = rawData.filter(a => !window.normArrowList.some(exist => exist.id === a.id)).map(a => { if (!a.baseScale || a.baseScale === 0) a.baseScale = 1; return a; });
    if(safeData.length > 0) this.restoreNormalArrows(ctx.obj, safeData); } }, onLoadGround: function(ctx) { if(ctx.sceneData.groundNormArrows) {
    const safeData = ctx.sceneData.groundNormArrows.filter(a => !window.normArrowList.some(exist => exist.id === a.id)).map(a => { if (!a.baseScale || a.baseScale === 0) a.baseScale = 1; return a; });
    if(safeData.length > 0) this.restoreNormalArrows(ctx.obj, safeData); } }, // 【数据流生命周期】：接管 JSON 序列化写入 (Core.IO) 与缩略图绘制
    onSaveItemData: function(context) { const arrows = this.extractSaveData(context.obj); if (arrows.length > 0) context.itemData.normalArrows = arrows; }, onSaveGroundData: function(context) { const arrows = this.extractSaveData(context.obj);
    if (arrows.length > 0) context.sceneData.groundNormArrows = arrows; }, extractSaveData: function(obj) { const normalArrows = []; if (!obj || !obj.children) return normalArrows; obj.children.forEach(c => {
    if(c.name && c.name.startsWith('norm_arrow_')) { const nData = window.normArrowList.find(a => a.id === c.name); if(nData) { let norm = [0,1,0];
    if(c.userData.localNormal) norm = [parseFloat(c.userData.localNormal.x.toFixed(3)), parseFloat(c.userData.localNormal.y.toFixed(3)), parseFloat(c.userData.localNormal.z.toFixed(3))];
    normalArrows.push({ id: nData.id, color: nData.color, text: nData.text, detailText: nData.detailText != null ? String(nData.detailText) : '', labelVisible: nData.labelVisible !== false, localPos: [parseFloat(c.position.x.toFixed(4)), parseFloat(c.position.y.toFixed(4)), parseFloat(c.position.z.toFixed(4))], localNormal: norm, baseDist: nData.baseDist, baseScale: nData.baseScale });
    } } }); return normalArrows; }, onDrawSnapshot: function(context) { if (!window.normArrowList) return; const ctx = context.ctx, rect = context.rect; const scaleX = 256 / rect.width, scaleY = 256 / rect.height;
    window.normArrowList.forEach(data => { if (data.isBehind || data.isOccluded) return; if (!data.sStart || !data.sBase || !data.sEnd || !data.sP1 || !data.sP2 || !data.sP3) return;
    const mapPt = (pt) => ({ x: (pt.x - rect.left) * scaleX, y: (pt.y - rect.top) * scaleY }); const sStart = mapPt(data.sStart), sBase = mapPt(data.sBase), sEnd = mapPt(data.sEnd);
    const sP1 = mapPt(data.sP1), sP2 = mapPt(data.sP2), sP3 = mapPt(data.sP3); ctx.strokeStyle = data.color; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(sStart.x, sStart.y); ctx.lineTo(sBase.x, sBase.y); ctx.stroke();
    const drawFacet = (pA, pB, pC, fillStyle) => { const cross = (pB.x - pA.x) * (pC.y - pA.y) - (pB.y - pA.y) * (pC.x - pA.x); if (cross > 0) {
    ctx.fillStyle = fillStyle; ctx.strokeStyle = fillStyle; ctx.lineWidth = 1.0; ctx.lineJoin = 'round'; ctx.beginPath(); ctx.moveTo(pA.x, pA.y); ctx.lineTo(pB.x, pB.y); ctx.lineTo(pC.x, pC.y); ctx.closePath();
    ctx.fill(); ctx.stroke(); } }; drawFacet(sEnd, sP1, sP2, window.NormalArrowManager.lightenColor(data.color, 0.2)); drawFacet(sEnd, sP2, sP3, window.NormalArrowManager.darkenColor(data.color, 0.2));
    drawFacet(sEnd, sP3, sP1, window.NormalArrowManager.darkenColor(data.color, 0.5)); }); }, ensureDOM: function() { if (!document.getElementById('norm-arrow-layer')) {
    const layer = document.createElement('div'); layer.id = 'norm-arrow-layer'; // z-index: 49 保证它在引线(z-index: 50)的下方，且不阻挡全局点击
    layer.style.cssText = 'position: absolute; top: 0; left: 0; width: 100vw; height: 100vh; pointer-events: none; z-index: 49; overflow: hidden;'; layer.innerHTML = '<svg id="norm-arrow-svg" style="width: 100%; height: 100%; pointer-events: none;"></svg>'; document.body.appendChild(layer); // 独立挂载颜色拾取器的监听（完全解耦模式）
    if (!document.getElementById('norm-arrow-style-inject')) { const style = document.createElement('style'); style.id = 'norm-arrow-style-inject'; style.innerHTML = `
        .norm-arrow-label { position:absolute; transform:translate(0,-50%); pointer-events:auto; font-family:'Inter', ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto; border:1px solid rgba(255,255,255,0.35); color:#fff; padding:4px 8px; font-size:11px; line-height:1.45; box-sizing:border-box; font-weight:700; white-space:pre-wrap; max-width:260px; user-select:none; border-radius:2px; transition:opacity 0.2s; box-shadow:0 4px 10px rgba(0,0,0,0.5); cursor:pointer; display:inline-flex; align-items:center; justify-content:flex-start; }
        .norm-arrow-label.editing { background:#fff !important; color:#000 !important; outline:none; border-color:#fff !important; box-shadow:0 0 10px rgba(0,210,255,0.5) !important; user-select:text !important; cursor:text !important; }
    `; document.head.appendChild(style); }
    const colorPicker = document.getElementById('obj-color-picker'); if (colorPicker) { colorPicker.addEventListener('input', e => { const id = this.selectedId; if (id !== null) {
    const data = window.normArrowList.find(a => a.id === id); if (data) { data.color = e.target.value; if (data.svgPath) data.svgPath.setAttribute("stroke", data.color); // 同步更新立体面的高光和阴影色
    if (data.svgFace1) { data.svgFace1.setAttribute("fill", window.NormalArrowManager.lightenColor(data.color, 0.2));
    data.svgFace1.setAttribute("stroke", window.NormalArrowManager.lightenColor(data.color, 0.2)); }
    if (data.svgFace2) { data.svgFace2.setAttribute("fill", window.NormalArrowManager.darkenColor(data.color, 0.2));
    data.svgFace2.setAttribute("stroke", window.NormalArrowManager.darkenColor(data.color, 0.2)); }
    if (data.svgFace3) { data.svgFace3.setAttribute("fill", window.NormalArrowManager.darkenColor(data.color, 0.5));
    data.svgFace3.setAttribute("stroke", window.NormalArrowManager.darkenColor(data.color, 0.5)); }
    if (data.domLabel) { data.domLabel.style.borderColor = data.color; data.domLabel.style.backgroundColor = window.NormalArrowManager.getDarkBg(data.color); }
    if (data.svgStem) data.svgStem.setAttribute("stroke", data.color);
    window.needsUpdate = true; } } }); } } }, highlightSelected: function() { window.normArrowList.forEach(data => { if (data.svgGlowPath) { if (this.selectedId === data.id) {
    data.svgGlowPath.setAttribute("stroke", "#ffffff"); data.svgGlowPath.setAttribute("opacity", "0.6"); } else {
    data.svgGlowPath.setAttribute("opacity", "0"); } } }); // 同步 UI 颜色拾取器
    if (this.selectedId !== null) { const data = window.normArrowList.find(a => a.id === this.selectedId); const picker = document.getElementById('obj-color-picker'); if (data && picker) picker.value = data.color; } },
    lightenColor: function(hex, percent) { try { if (!hex || !hex.startsWith('#')) return hex; let r = parseInt(hex.slice(1, 3), 16); let g = parseInt(hex.slice(3, 5), 16); let b = parseInt(hex.slice(5, 7), 16);
    r = Math.min(255, Math.floor(r + (255 - r) * percent)); g = Math.min(255, Math.floor(g + (255 - g) * percent)); b = Math.min(255, Math.floor(b + (255 - b) * percent));
    const toHex = (c) => c.toString(16).padStart(2, '0'); return `#${toHex(r)}${toHex(g)}${toHex(b)}`; } catch(e) { return hex; } }, // 将 16 进制颜色变暗（percent: 0-1）
    darkenColor: function(hex, percent) { try { if (!hex || !hex.startsWith('#')) return hex; let r = parseInt(hex.slice(1, 3), 16); let g = parseInt(hex.slice(3, 5), 16); let b = parseInt(hex.slice(5, 7), 16);
    r = Math.floor(r * (1 - percent)); g = Math.floor(g * (1 - percent)); b = Math.floor(b * (1 - percent)); const toHex = (c) => c.toString(16).padStart(2, '0'); return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    } catch(e) { return hex; } },
    getDarkBg: function(hex) { try { if (!hex || !hex.startsWith('#')) return 'rgba(0,0,0,0.65)'; let c = hex.replace('#',''); if (c.length === 3) c = c[0]+c[0]+c[1]+c[1]+c[2]+c[2]; const r = parseInt(c.substring(0,2),16), g = parseInt(c.substring(2,4),16), b = parseInt(c.substring(4,6),16); return `rgba(${(r*0.2)|0}, ${(g*0.2)|0}, ${(b*0.2)|0}, 0.85)`; } catch(_e) { return 'rgba(0,0,0,0.65)'; } },
    createNormalArrow: function(targetObj, worldPoint, worldNormal) { try { this.ensureDOM(); window.normArrowCounter++;
    const id = 'norm_arrow_' + Date.now() + '_' + window.normArrowCounter; const anchor = new THREE.Object3D(); targetObj.worldToLocal(anchor.position.copy(worldPoint)); anchor.name = id;
    if (worldNormal) { const localNormalPt = targetObj.worldToLocal(worldPoint.clone().add(worldNormal)); anchor.userData.localNormal = localNormalPt.sub(anchor.position).normalize(); } else {
    anchor.userData.localNormal = new THREE.Vector3(0,1,0); }
    targetObj.add(anchor); const color = document.getElementById('obj-color-picker')?.value || '#fdcb6e';
    const arrowData = { id: id, targetUUID: targetObj.uuid, anchorObj: anchor, color: color, text: '法线', detailText: '', labelVisible: true, isOccluded: false }; window.normArrowList.push(arrowData); this.buildDOM(arrowData); window.needsUpdate = true; window.lightMoved = true;
    if (window.PluginManager && typeof window.PluginManager.setExclusiveSelection === 'function') { window.PluginManager.setExclusiveSelection(this, id); } else { this.selectedId = id; this.highlightSelected(); } } catch(e) { console.error(e); } }, buildDOM: function(data) { const layer = document.getElementById('norm-arrow-layer'); const svg = document.getElementById('norm-arrow-svg'); const ns = "http://www.w3.org/2000/svg"; this.ensureDOM();
    if (layer && !data.domLabel) { const div = document.createElement('div'); div.className = 'norm-arrow-label'; div.id = 'norm_label_' + data.id; div.innerText = data.text || '法线'; div.style.borderColor = data.color || '#fdcb6e'; div.style.backgroundColor = window.NormalArrowManager.getDarkBg(data.color || '#fdcb6e'); div.style.display = (data.labelVisible === false) ? 'none' : 'block'; div.addEventListener('pointerdown', e => { e.stopPropagation(); if (window.__SOLID_CONSUMER__) { if (window.PluginManager && typeof window.PluginManager.setExclusiveSelection === 'function') { if (window.NormalArrowManager.selectedId === data.id) window.PluginManager.setExclusiveSelection(window.NormalArrowManager, null); else window.PluginManager.setExclusiveSelection(window.NormalArrowManager, data.id); } return; } if (!div.isContentEditable) { if (window.PluginManager && typeof window.PluginManager.setExclusiveSelection === 'function') { window.PluginManager.setExclusiveSelection(window.NormalArrowManager, data.id); } else { window.NormalArrowManager.selectedId = data.id; window.NormalArrowManager.highlightSelected(); } } }); div.addEventListener('dblclick', e => { if (window.__SOLID_CONSUMER__) return; e.stopPropagation(); if (window.PluginManager && typeof window.PluginManager.setExclusiveSelection === 'function') { window.PluginManager.setExclusiveSelection(window.NormalArrowManager, data.id); } else { window.NormalArrowManager.selectedId = data.id; window.NormalArrowManager.highlightSelected(); } div.contentEditable = true; div.classList.add('editing'); div.style.cursor = 'text'; div.focus(); try { const selection = window.getSelection(); const range = document.createRange(); range.selectNodeContents(div); selection.removeAllRanges(); selection.addRange(range); } catch(_e) {} }); div.addEventListener('blur', () => { if (!div.isContentEditable) return; div.contentEditable = false; div.classList.remove('editing'); div.style.cursor = 'pointer'; data.text = div.innerText; window.needsUpdate = true; }); div.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Delete' || e.key === 'Backspace') e.stopPropagation(); }); layer.appendChild(div); data.domLabel = div; }
    // 选择发光层
    const glowPath = document.createElementNS(ns, "path");
    glowPath.setAttribute("fill", "none"); glowPath.setAttribute("stroke", "#ffffff");
    glowPath.setAttribute("stroke-width", "6"); glowPath.setAttribute("opacity", "0"); svg.appendChild(glowPath); data.svgGlowPath = glowPath;
    // 实体线
    const path = document.createElementNS(ns, "path"); path.setAttribute("fill", "none"); path.setAttribute("stroke", data.color);
    path.setAttribute("stroke-width", "2.5"); svg.appendChild(path); data.svgPath = path; // 3D立体箭头头部：三个面
    const stem = document.createElementNS(ns, "line"); stem.setAttribute("stroke", data.color); stem.setAttribute("stroke-width", "1.5"); stem.setAttribute("opacity", "0.88"); svg.appendChild(stem); data.svgStem = stem;
    const face1 = document.createElementNS(ns, "polygon"); face1.setAttribute("fill", this.lightenColor(data.color, 0.2));
    face1.setAttribute("stroke", this.lightenColor(data.color, 0.2)); // 防止面与面之间有缝隙
    face1.setAttribute("stroke-width", "1"); face1.setAttribute("stroke-linejoin", "round"); svg.appendChild(face1); data.svgFace1 = face1;
    const face2 = document.createElementNS(ns, "polygon"); face2.setAttribute("fill", this.darkenColor(data.color, 0.2));
    face2.setAttribute("stroke", this.darkenColor(data.color, 0.2)); face2.setAttribute("stroke-width", "1");
    face2.setAttribute("stroke-linejoin", "round"); svg.appendChild(face2); data.svgFace2 = face2; const face3 = document.createElementNS(ns, "polygon");
    face3.setAttribute("fill", this.darkenColor(data.color, 0.5)); face3.setAttribute("stroke", this.darkenColor(data.color, 0.5));
    face3.setAttribute("stroke-width", "1"); face3.setAttribute("stroke-linejoin", "round"); svg.appendChild(face3); data.svgFace3 = face3;
    // 隐形加宽点击判定层
    const hitPath = document.createElementNS(ns, "path");
    hitPath.setAttribute("fill", "none"); hitPath.setAttribute("stroke", "transparent");
    hitPath.setAttribute("stroke-width", "15"); svg.appendChild(hitPath); data.svgHitPath = hitPath; // 【核心修复】：让线段和所有的 3D 箭头面片都支持被点击选中，彻底解除模式拦截
    [hitPath, face1, face2, face3].forEach(el => { if(!el) return; el.style.pointerEvents = "auto"; el.style.cursor = "pointer"; el.addEventListener('pointerdown', e => {
    if (window.__SOLID_CONSUMER__) { e.stopPropagation(); if (window.PluginManager && typeof window.PluginManager.setExclusiveSelection === 'function') { if (window.NormalArrowManager.selectedId === data.id) window.PluginManager.setExclusiveSelection(window.NormalArrowManager, null); else window.PluginManager.setExclusiveSelection(window.NormalArrowManager, data.id); } return; }
    /* 【优化2 & 3】：移除 e.stopPropagation() 允许事件穿透旋转场景；互斥选中由 PluginManager 统一处理 */
    if (window.PluginManager && typeof window.PluginManager.setExclusiveSelection === 'function') { window.PluginManager.setExclusiveSelection(window.NormalArrowManager, data.id); }
    else { window.NormalArrowManager.selectedId = data.id; window.NormalArrowManager.highlightSelected(); } });
    // 双击法线：切换文本显隐，并记录到 json 的 labelVisible
    el.addEventListener('dblclick', e => { try { e.stopPropagation(); } catch(_e) {} data.labelVisible = data.labelVisible === false ? true : false; if (data.domLabel) data.domLabel.style.display = data.labelVisible ? 'block' : 'none'; if (data.svgStem) data.svgStem.setAttribute('opacity', data.labelVisible ? '0.88' : '0'); if (typeof window.needsUpdate !== 'undefined') window.needsUpdate = true; });
    /* 移除click拦截 */ }); }, updateScreenPositions: function(camera) {
    if(window.normArrowList.length === 0) return; // 【工业级性能优化】：懒加载全局向量池，实现零分配 (Zero Allocation)，彻底消除内存泄漏
    if (!this._poolInit) { this._tempV = new THREE.Vector3(); this._endV = new THREE.Vector3(); this._baseCenterV = new THREE.Vector3(); this._upV = new THREE.Vector3(); this._uV = new THREE.Vector3(); this._vV = new THREE.Vector3();
    this._p1V = new THREE.Vector3(); this._p2V = new THREE.Vector3(); this._p3V = new THREE.Vector3(); this._scratchV = new THREE.Vector3(); this._normalMatrix = new THREE.Matrix3();
    this._viewDir = new THREE.Vector3(); this._currentWorldNormal = new THREE.Vector3(); this._sStart = {x:0, y:0, isBehind:false}; this._sEnd = {x:0, y:0, isBehind:false}; this._sBase = {x:0, y:0, isBehind:false};
    this._sP1 = {x:0, y:0, isBehind:false}; this._sP2 = {x:0, y:0, isBehind:false}; this._sP3 = {x:0, y:0, isBehind:false}; this._poolInit = true; }
    const toScreenCoord = (wV, sObj) => { this._scratchV.copy(wV).project(camera); sObj.x = (this._scratchV.x * 0.5 + 0.5) * window.innerWidth; sObj.y = (-(this._scratchV.y * 0.5) + 0.5) * window.innerHeight;
    sObj.isBehind = this._scratchV.z > 1.0 || this._scratchV.z < -1.0; }; window.normArrowList.forEach(data => { if(!data.anchorObj) return; data.anchorObj.getWorldPosition(this._tempV); const dist = camera.position.distanceTo(this._tempV);
    const safeDist = Math.max(dist, 0.1); const modelScaleX = data.anchorObj.parent ? data.anchorObj.parent.scale.x : 1; if (!data.baseDist) { // 惰性初始化：在创建瞬间，记录初始距离与缩放，计算出它的终身“物理基因”
    data.baseDist = safeDist; data.baseScale = modelScaleX; }
    // 【法线专属逻辑：全 3D 物理缩放】
    // 物理基准尺寸 = 初始距离 * 视觉比例系数 (0.04)。距离越远创建，造得越大，以保证新建时屏幕上看起来大小绝对一致！
    const physicalBaseSize = data.baseDist * 0.04; // 真实的 3D 物理尺寸（从此完全跟死模型同比例缩放）
    const currentWorldSize = physicalBaseSize * (modelScaleX / data.baseScale); const arrowWorldLen = 3.5 * currentWorldSize; const headLenWorld = 1.2 * currentWorldSize; const headWidthWorld = 0.4 * currentWorldSize;
    if (data.anchorObj.parent && data.anchorObj.userData.localNormal) { this._normalMatrix.getNormalMatrix(data.anchorObj.parent.matrixWorld);
    this._currentWorldNormal.copy(data.anchorObj.userData.localNormal).applyMatrix3(this._normalMatrix).normalize(); this._viewDir.copy(camera.position).sub(this._tempV).normalize();
    data.isOccluded = this._currentWorldNormal.dot(this._viewDir) < -0.05; } else { data.isOccluded = false; this._currentWorldNormal.set(0,1,0); }
    this._endV.copy(this._tempV).addScaledVector(this._currentWorldNormal, arrowWorldLen); this._baseCenterV.copy(this._endV).addScaledVector(this._currentWorldNormal, -headLenWorld);
    if (Math.abs(this._currentWorldNormal.y) > 0.5) { this._upV.set(1, 0, 0); } else { this._upV.set(0, 1, 0); }
    this._uV.crossVectors(this._currentWorldNormal, this._upV).normalize(); this._vV.crossVectors(this._uV, this._currentWorldNormal).normalize(); this._p1V.copy(this._baseCenterV).addScaledVector(this._uV, headWidthWorld);
    this._scratchV.copy(this._uV).multiplyScalar(-0.5).addScaledVector(this._vV, 0.866); this._p2V.copy(this._baseCenterV).addScaledVector(this._scratchV, headWidthWorld);
    this._scratchV.copy(this._uV).multiplyScalar(-0.5).addScaledVector(this._vV, -0.866); this._p3V.copy(this._baseCenterV).addScaledVector(this._scratchV, headWidthWorld);
    toScreenCoord(this._tempV, this._sStart); toScreenCoord(this._endV, this._sEnd); toScreenCoord(this._baseCenterV, this._sBase); toScreenCoord(this._p1V, this._sP1); toScreenCoord(this._p2V, this._sP2); toScreenCoord(this._p3V, this._sP3);
    // 缓存给截屏系统使用，防止对象逃逸
    data.sStart = {x:this._sStart.x, y:this._sStart.y}; data.sEnd = {x:this._sEnd.x, y:this._sEnd.y}; data.sBase = {x:this._sBase.x, y:this._sBase.y};
    data.sP1 = {x:this._sP1.x, y:this._sP1.y}; data.sP2 = {x:this._sP2.x, y:this._sP2.y}; data.sP3 = {x:this._sP3.x, y:this._sP3.y}; if (this._sEnd.isBehind) data.isOccluded = true;
    if (data.domLabel) { const anchorRight = (this._sEnd.x - this._sStart.x) < -1; const gap = 14; const lx = this._sEnd.x + (anchorRight ? -gap : gap); data.domLabel.style.left = `${lx}px`; data.domLabel.style.top = `${this._sEnd.y}px`; data.domLabel.style.transform = anchorRight ? 'translate(-100%,-50%)' : 'translate(0,-50%)'; data.domLabel.style.textAlign = 'left'; const hide = (this._sStart.isBehind || data.isOccluded || data.labelVisible === false); data.domLabel.style.opacity = hide ? '0' : '1'; data.domLabel.style.pointerEvents = hide ? 'none' : 'auto'; data.domLabel.style.display = data.labelVisible === false ? 'none' : 'block'; }
    if (data.svgStem) { const anchorRight = (this._sEnd.x - this._sStart.x) < -1; const xStart = this._sEnd.x; const xEnd = xStart + (anchorRight ? -12 : 12); const hide = (this._sStart.isBehind || data.isOccluded || data.labelVisible === false); data.svgStem.setAttribute('x1', String(xStart)); data.svgStem.setAttribute('y1', String(this._sEnd.y)); data.svgStem.setAttribute('x2', String(xEnd)); data.svgStem.setAttribute('y2', String(this._sEnd.y)); data.svgStem.setAttribute('opacity', hide ? '0' : '0.88'); }
    const canHit = (this._sStart.isBehind || data.isOccluded) ? 'none' : 'auto'; if (data.svgHitPath) data.svgHitPath.style.pointerEvents = canHit;
    if (data.svgFace1) data.svgFace1.style.pointerEvents = canHit; if (data.svgFace2) data.svgFace2.style.pointerEvents = canHit; if (data.svgFace3) data.svgFace3.style.pointerEvents = canHit; // 【防报错卡死机制】：必须判断 NaN 确保 SVG 引擎不会死锁崩溃
    if (!this._sStart.isBehind && !data.isOccluded && !isNaN(this._sStart.x) && !isNaN(this._sEnd.x)) { const dStr = `M ${this._sStart.x} ${this._sStart.y} L ${this._sBase.x} ${this._sBase.y}`; if(data.svgGlowPath) data.svgGlowPath.setAttribute("d", dStr);
    if(data.svgPath) data.svgPath.setAttribute("d", dStr); if(data.svgHitPath) data.svgHitPath.setAttribute("d", dStr); const drawFacet = (polyEl, pA, pB, pC) => { if (!polyEl) return;
    const cross = (pB.x - pA.x) * (pC.y - pA.y) - (pB.y - pA.y) * (pC.x - pA.x); if (cross > 0) { polyEl.setAttribute("points", `${pA.x},${pA.y} ${pB.x},${pB.y} ${pC.x},${pC.y}`);
    polyEl.setAttribute("opacity", "0.95"); } else { polyEl.setAttribute("opacity", "0"); } };
    drawFacet(data.svgFace1, this._sEnd, this._sP1, this._sP2); drawFacet(data.svgFace2, this._sEnd, this._sP2, this._sP3); drawFacet(data.svgFace3, this._sEnd, this._sP3, this._sP1);
    if(data.svgPath) data.svgPath.setAttribute("opacity", "0.9"); } else { if(data.svgGlowPath) data.svgGlowPath.setAttribute("d", "");
    if(data.svgPath) data.svgPath.setAttribute("opacity", "0"); if(data.svgHitPath) data.svgHitPath.setAttribute("d", "");
    if(data.svgFace1) data.svgFace1.setAttribute("opacity", "0"); if(data.svgFace2) data.svgFace2.setAttribute("opacity", "0");
    if(data.svgFace3) data.svgFace3.setAttribute("opacity", "0"); } }); }, clearAll: function() { window.normArrowList.forEach(data => {
    if(data.anchorObj && data.anchorObj.parent) data.anchorObj.parent.remove(data.anchorObj); }); window.normArrowList = []; const svg = document.getElementById('norm-arrow-svg');
    if(svg) svg.innerHTML = ''; this.selectedId = null; }, // 【新增】：增加别名，完美兼容消费端的读取指令
    restoreNormalArrows: function(obj, arrows) { this.restoreArrows(obj, arrows); }, restoreArrows: function(obj, arrows) { if(!arrows) return; this.ensureDOM(); arrows.forEach(a => { window.normArrowCounter++;
    const anchor = new THREE.Object3D(); anchor.position.set(a.localPos[0], a.localPos[1], a.localPos[2]); anchor.name = a.id;
    anchor.userData.localNormal = a.localNormal ? new THREE.Vector3(a.localNormal[0], a.localNormal[1], a.localNormal[2]) : new THREE.Vector3(0,1,0); obj.add(anchor);
    const arrowData = { id: a.id, targetUUID: obj.uuid, anchorObj: anchor, color: a.color || '#fdcb6e', isOccluded: false }; if(a.baseDist) arrowData.baseDist = a.baseDist;
    if(a.baseScale) arrowData.baseScale = a.baseScale; arrowData.text = (a.text !== undefined && a.text !== null) ? String(a.text) : '法线'; arrowData.detailText = a.detailText != null ? String(a.detailText) : ''; arrowData.labelVisible = a.labelVisible !== false; window.normArrowList.push(arrowData); this.buildDOM(arrowData); }); },
    getDetailText: function(id) { const d = window.normArrowList.find(a => a.id === id); return d ? (d.detailText || '') : ''; } }; // 独立监听 Delete 键删除功能
    window.addEventListener('keydown', e => { if (e.key === 'Delete' || e.key === 'Backspace') {
    if (document.activeElement && document.activeElement.isContentEditable) return; const id = window.NormalArrowManager.selectedId; if (id !== null) { const idx = window.normArrowList.findIndex(a => a.id === id);
    if (idx > -1) { const data = window.normArrowList[idx]; if(data.anchorObj && data.anchorObj.parent) data.anchorObj.parent.remove(data.anchorObj); if(data.svgGlowPath) data.svgGlowPath.remove(); if(data.svgPath) data.svgPath.remove(); if(data.svgStem) data.svgStem.remove(); if (data.domLabel) data.domLabel.remove();
    if(data.svgHitPath) data.svgHitPath.remove(); if(data.svgFace1) data.svgFace1.remove(); if(data.svgFace2) data.svgFace2.remove(); if(data.svgFace3) data.svgFace3.remove(); if(data.svgStem) data.svgStem.remove(); if (data.domLabel) data.domLabel.remove(); window.normArrowList.splice(idx, 1);
    window.needsUpdate = true; window.lightMoved = true; }
    window.NormalArrowManager.selectedId = null; } } }); // 注册标准插件挂载
    window.NormalArrowManager.onUpdate = function(context) { if (window.showAnnotations !== false && context.camera) { this.updateScreenPositions(context.camera); const layer = document.getElementById('norm-arrow-layer');
    if (layer) layer.style.display = 'block'; } else { const layer = document.getElementById('norm-arrow-layer'); if (layer) layer.style.display = 'none'; } };
    if (window.PluginManager) window.PluginManager.register('NormalArrow_UI', window.NormalArrowManager);