import * as THREE from 'three'; window.annoDataList = []; window.annoCounter = 0; window.AnnotationManager = { selectedId: null,
    isPlacing: false, activeData: null, _cachedControls: null, // 新增：插件内部私有状态
    // 【生命周期】：对接核心总线的各种事件钩子
    onSceneHit: function(context) { // 【核心修复】：必须判断当前是否为标注模式，防止误拦截其他模式下的鼠标操作
    if (window.currentEditorMode !== 'annotate') return; if (!context.event.shiftKey) return; // 属于法线箭头的操作，忽略
    this.createLeader(context.targetObj, context.hitPoint, context.worldNormal); this.activeData = window.annoDataList[window.annoDataList.length - 1]; this.isPlacing = true; this._cachedControls = context.controls;
    if (this._cachedControls) this._cachedControls.enabled = false; if (window.showToast) window.showToast("已锁定锚点：请移动鼠标确定文字位置，松开 Alt 或 Shift 完成。"); }, onGlobalPointerMove: function(context) { if (this.isPlacing && this.activeData) {
    this.activeData.dx = context.event.clientX - context.startX; this.activeData.dy = context.event.clientY - context.startY; window.needsUpdate = true; } }, onKeyUp: function(event) {
    if (this.isPlacing && (event.key === 'Alt' || event.key === 'Shift')) { this.isPlacing = false; this.activeData = null; if (this._cachedControls) this._cachedControls.enabled = true;
    if (window.showToast) window.showToast("引线已放置。"); window.needsUpdate = true; } }, onBeforePointerDown: function(e) { if (this.isPlacing) return true; }, // 拦截原生点击
    onGlobalPointerUp: function(e) { if (this.isPlacing) return true; }, // 拦截选区逻辑
    // 【生命周期】：接管场景清理 (Core.Memory) 解决新建场景僵尸数据卡死 Bug
    onClearScene: function() { if (!window.annoDataList) return; window.annoDataList.forEach(data => { if(data.anchorObj && data.anchorObj.parent) data.anchorObj.parent.remove(data.anchorObj); // 【核心修复】：彻底拔除挂载在地面的3D锚点
    const dom = document.getElementById('dom_' + data.id); if (dom) dom.remove(); if (data.svgPath) data.svgPath.remove(); if (data.svgGlowPath) data.svgGlowPath.remove(); if (data.svgCircle) data.svgCircle.remove();
    if (typeof data.cleanupEvents === 'function') data.cleanupEvents(); // 【核心修复】：注销可能残留的鼠标拖拽监听器
    }); window.annoDataList = []; this.selectedId = null; this.isPlacing = false; this.activeData = null; }, // 【数据流生命周期】：接管 JSON 反序列化读取 (Core.IO)
    onLoadItem: function(ctx) { if(ctx.itemData.annotations) { // 【核心修复】：拦截重复 ID 脏数据，并修正致命的 baseScale=0 问题，防止引发 Infinity 引擎死锁
    const safeData = ctx.itemData.annotations.filter(a => !window.annoDataList.some(exist => exist.id === a.id)).map(a => { if (!a.baseScale || a.baseScale === 0) a.baseScale = 1; return a; });
    if(safeData.length > 0) this.restoreAnnotations(ctx.obj, safeData); } }, onLoadGround: function(ctx) { if(ctx.sceneData.groundAnnotations) {
    const safeData = ctx.sceneData.groundAnnotations.filter(a => !window.annoDataList.some(exist => exist.id === a.id)).map(a => { if (!a.baseScale || a.baseScale === 0) a.baseScale = 1; return a; });
    if(safeData.length > 0) this.restoreAnnotations(ctx.obj, safeData); } }, // 【数据流生命周期】：接管 JSON 序列化写入 (Core.IO) 与缩略图绘制
    onSaveItemData: function(context) { const annos = this.extractSaveData(context.obj); if (annos.length > 0) context.itemData.annotations = annos; }, onSaveGroundData: function(context) { const annos = this.extractSaveData(context.obj);
    if (annos.length > 0) context.sceneData.groundAnnotations = annos; }, extractSaveData: function(obj) { const annotations = []; if (!obj || !obj.children) return annotations; obj.children.forEach(c => {
    if(c.name && c.name.startsWith('anno_')) { const aData = window.annoDataList.find(a => a.id === c.name); if(aData) { let norm = [0,1,0];
    if(c.userData.localNormal) norm = [parseFloat(c.userData.localNormal.x.toFixed(3)), parseFloat(c.userData.localNormal.y.toFixed(3)), parseFloat(c.userData.localNormal.z.toFixed(3))];
    annotations.push({ id: aData.id, text: aData.text, color: aData.color, dx: aData.dx, dy: aData.dy, localPos: [parseFloat(c.position.x.toFixed(4)), parseFloat(c.position.y.toFixed(4)), parseFloat(c.position.z.toFixed(4))], localNormal: norm, baseDist: aData.baseDist, baseScale: aData.baseScale });
    } } }); return annotations; }, onDrawSnapshot: function(context) { if (!window.annoDataList) return; const ctx = context.ctx, rect = context.rect; const scaleX = 256 / rect.width, scaleY = 256 / rect.height;
    window.annoDataList.forEach(data => { if (data.isBehind || data.isOccluded) return; const ax = data.screenX, ay = data.screenY, ax1 = ax + data.scaledDx, ay1 = ay + data.scaledDy, amidX = ax + data.scaledDx * 0.5;
    const tx = (ax - rect.left) * scaleX, ty = (ay - rect.top) * scaleY, tx1 = (ax1 - rect.left) * scaleX, ty1 = (ay1 - rect.top) * scaleY, tmidX = (amidX - rect.left) * scaleX;
    ctx.strokeStyle = data.color; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tmidX, ty1); ctx.lineTo(tx1, ty1); ctx.stroke(); ctx.fillStyle = data.color; ctx.beginPath(); ctx.arc(tx, ty, 3, 0, Math.PI * 2); ctx.fill();
    ctx.font = '11px Inter, sans-serif'; const textWidth = ctx.measureText(data.text).width; const boxW = textWidth + 16, boxH = 20;
    ctx.fillStyle = window.AnnotationManager.getDarkBg(data.color); ctx.fillRect(tx1 - boxW/2, ty1 - boxH/2, boxW, boxH); ctx.strokeStyle = data.color; ctx.lineWidth = 1; ctx.strokeRect(tx1 - boxW/2, ty1 - boxH/2, boxW, boxH);
    ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(data.text, tx1, ty1); }); }, // 【新增核心】：根据传入的十六进制颜色，自动计算出对应的深色系背景（亮度降至20%，带0.85透明度）
    getDarkBg: function(hex) { let c = hex.replace('#', ''); if(c.length === 3) c = c[0]+c[0]+c[1]+c[1]+c[2]+c[2];
    let r = parseInt(c.substring(0,2), 16), g = parseInt(c.substring(2,4), 16), b = parseInt(c.substring(4,6), 16); return `rgba(${(r*0.2)|0}, ${(g*0.2)|0}, ${(b*0.2)|0}, 0.85)`; }, highlightSelected: function() {
    document.querySelectorAll('.anno-dom').forEach(el => { el.style.boxShadow = 'none'; el.style.borderColor = el.dataset.color || '#00d2ff';
    el.style.zIndex = '99999'; }); const picker = document.getElementById('obj-color-picker'); if (this.selectedId !== null) {
    const el = document.getElementById('dom_' + this.selectedId); const data = window.annoDataList.find(a => a.id === this.selectedId); if (el) { el.style.boxShadow = '0 0 10px rgba(255, 255, 255, 0.8)';
    el.style.borderColor = '#fff'; el.style.zIndex = '100000'; }
    // 选中标注时，同步调色板颜色
    if (data && picker) { picker.value = data.color; } }
    // 彻底废除失焦时的调色板禁用逻辑，保证其始终处于可用状态
    if (picker) { picker.disabled = false; picker.style.opacity = '1'; picker.style.cursor = 'pointer'; } }, ensureDOM: function() { if (!document.getElementById('anno-style-inject')) {
    const style = document.createElement('style'); style.id = 'anno-style-inject'; // 从 CSS 里去掉了固定黑背景，改为通过内联样式动态注入
    style.innerHTML = `
                    #anno-layer { position: absolute; top: 0; left: 0; width: 100vw; height: 100vh; pointer-events: none; z-index: 50 !important; overflow: hidden; }
                    #anno-svg { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; }
                    .anno-dom { position: absolute; transform: translate(-50%, -50%); pointer-events: auto; font-family: 'Inter', sans-serif; }
                    .anno-leader-label { border: 1px solid #0df; color: #fff; padding: 4px 8px; font-size: 11px; white-space: nowrap; cursor: pointer; user-select: none; border-radius: 2px; transition: opacity 0.2s; }
                    .anno-leader-label.editing { background: #fff !important; color: #000; outline: none; border-color: #fff !important; box-shadow: 0 0 10px rgba(0,210,255,0.5) !important; user-select: text !important; cursor: text !important; }
                `; document.head.appendChild(style); }
    if (!document.getElementById('anno-layer')) { const layer = document.createElement('div'); layer.id = 'anno-layer'; layer.innerHTML = '<svg id="anno-svg"></svg>';
    document.body.appendChild(layer); } }, createLeader: function(targetObj, worldPoint, worldNormal) { try { this.ensureDOM();
    window.annoCounter++; const id = 'anno_' + Date.now() + '_' + window.annoCounter;
    const anchor = new THREE.Object3D(); targetObj.worldToLocal(anchor.position.copy(worldPoint)); anchor.name = id;
    if (worldNormal) { const localNormalPt = targetObj.worldToLocal(worldPoint.clone().add(worldNormal)); anchor.userData.localNormal = localNormalPt.sub(anchor.position).normalize(); } else { anchor.userData.localNormal = new THREE.Vector3(0,1,0); }
    targetObj.add(anchor); const color = document.getElementById('obj-color-picker').value || '#00d2ff';
    const annoData = { id: id, type: 'leader', targetUUID: targetObj.uuid, anchorObj: anchor, text: '引线 ' + window.annoCounter, color: color, dx: 0, dy: 0, isOccluded: false };
    window.annoDataList.push(annoData); this.buildDOM(annoData); window.needsUpdate = true; window.lightMoved = true; this.selectedId = id; this.highlightSelected(); } catch(e) { console.error(e); } }, buildDOM: function(data) {
    const layer = document.getElementById('anno-layer'); const svg = document.getElementById('anno-svg');
    const div = document.createElement('div'); div.className = 'anno-dom anno-leader-label'; div.id = 'dom_' + data.id; div.innerText = data.text; // 动态注入颜色及对应的暗色背景
    div.style.borderColor = data.color; div.style.backgroundColor = this.getDarkBg(data.color); div.dataset.color = data.color; div.addEventListener('pointerdown', e => { e.stopPropagation();
    /* 【优化2】：彻底移除模式拦截，随时可选中；并自动取消箭头和面片的选中状态 */
    if(!div.isContentEditable) { window.AnnotationManager.selectedId = data.id; window.AnnotationManager.highlightSelected(); if(window.NormalArrowManager){window.NormalArrowManager.selectedId=null; window.NormalArrowManager.highlightSelected();} if(window.Polygon3DManager){window.Polygon3DManager.selectedId=null; window.Polygon3DManager.highlightSelected();} } });
    div.addEventListener('click', e => { e.stopPropagation(); }); div.addEventListener('dblclick', e => { e.stopPropagation(); /* 移除双击限制 */
    window.AnnotationManager.selectedId = data.id; window.AnnotationManager.highlightSelected(); div.contentEditable = true; div.classList.add('editing'); div.style.cursor = 'text'; div.focus();
    const selection = window.getSelection(); const range = document.createRange(); range.selectNodeContents(div); selection.removeAllRanges(); selection.addRange(range); }); div.addEventListener('blur', () => {
    div.contentEditable = false; div.classList.remove('editing'); div.style.cursor = 'pointer'; data.text = div.innerText; window.needsUpdate = true; });
    div.addEventListener('keydown', e => { if(e.key === 'Delete' || e.key === 'Backspace') e.stopPropagation(); });
    let isDragging = false, startX, startY, startDx, startDy, isMoved = false;
    div.addEventListener('mousedown', e => { if(div.isContentEditable) { e.stopPropagation(); return; } isDragging = true; isMoved = false; startX = e.clientX; startY = e.clientY; startDx = data.dx; startDy = data.dy; e.stopPropagation(); });
    const onMouseMove = e => { if(!isDragging) return; if(Math.abs(e.clientX - startX) > 3 || Math.abs(e.clientY - startY) > 3) isMoved = true; if(!isMoved) return; const curS = data.currentScale || 1;
    data.dx = startDx + (e.clientX - startX) / curS; data.dy = startDy + (e.clientY - startY) / curS; window.needsUpdate = true; }; const onMouseUp = () => isDragging = false;
    window.addEventListener('mousemove', onMouseMove); window.addEventListener('mouseup', onMouseUp); data.cleanupEvents = () => {
    window.removeEventListener('mousemove', onMouseMove); window.removeEventListener('mouseup', onMouseUp); }; layer.appendChild(div); const ns = "http://www.w3.org/2000/svg";
    const glowPath = document.createElementNS(ns, "path"); glowPath.setAttribute("fill", "none"); glowPath.setAttribute("stroke", data.color);
    glowPath.setAttribute("stroke-width", "6"); glowPath.setAttribute("opacity", "0.2"); svg.appendChild(glowPath); data.svgGlowPath = glowPath;
    const path = document.createElementNS(ns, "path"); path.setAttribute("fill", "none"); path.setAttribute("stroke", data.color);
    path.setAttribute("stroke-width", "1.5"); svg.appendChild(path); data.svgPath = path; const circle = document.createElementNS(ns, "circle");
    circle.setAttribute("r", "3"); circle.setAttribute("fill", data.color); svg.appendChild(circle); data.svgCircle = circle; data.domEl = div; },
    updateScreenPositions: function(camera) { if(window.annoDataList.length === 0) return; // 【工业级性能优化】：懒加载全局向量池，彻底消灭 new 和 clone，拒绝 GC 垃圾回收造成的卡顿死锁
    if (!this._poolInit) { this._tempV = new THREE.Vector3(); this._normalMatrix = new THREE.Matrix3(); this._viewDir = new THREE.Vector3(); this._currentWorldNormal = new THREE.Vector3(); this._poolInit = true; }
    window.annoDataList.forEach(data => { if(!data.anchorObj) return; data.anchorObj.getWorldPosition(this._tempV); const dist = camera.position.distanceTo(this._tempV); const safeDist = Math.max(dist, 0.1);
    const modelScaleX = data.anchorObj.parent ? data.anchorObj.parent.scale.x : 1; if (!data.baseDist) { // 惰性初始化：在刚创建的瞬间，记录当时的相机距离和模型缩放，作为“物理基因”
    data.baseDist = safeDist; data.baseScale = modelScaleX; }
    // --- 【核心定制逻辑：分离缩放】 ---
    // 1. 线长缩放比例 (lineScale): 受相机距离(透视)和模型缩放影响，产生真实的 3D 近长远短效果
    let lineScale = (data.baseDist / safeDist) * (modelScaleX / data.baseScale); lineScale = Math.max(0.1, Math.min(lineScale, 10.0)); // 2. 文本缩放比例 (textScale): 永远锁定为 1.0，保证文字在任何缩放级别下大小不变，永远清晰可读
    const textScale = 1.0; if (data.anchorObj.parent && data.anchorObj.userData.localNormal) { this._normalMatrix.getNormalMatrix(data.anchorObj.parent.matrixWorld);
    this._currentWorldNormal.copy(data.anchorObj.userData.localNormal).applyMatrix3(this._normalMatrix).normalize(); this._viewDir.copy(camera.position).sub(this._tempV).normalize();
    data.isOccluded = this._currentWorldNormal.dot(this._viewDir) < -0.05; } else { data.isOccluded = false; }
    this._tempV.project(camera); const isBehind = this._tempV.z > 1.0 || this._tempV.z < -1.0; const x = (this._tempV.x * 0.5 + 0.5) * window.innerWidth; const y = (-(this._tempV.y * 0.5) + 0.5) * window.innerHeight;
    const opacity = isBehind ? '0' : (data.isOccluded ? '0.2' : '1');
    const pointerEvents = (isBehind || data.isOccluded) ? 'none' : 'auto'; // SVG 折线的绘制偏移量，挂载 3D 物理透视缩放 (lineScale)
    const scaledDx = data.dx * lineScale; const scaledDy = data.dy * lineScale; data.screenX = x; data.screenY = y; data.scaledDx = scaledDx; data.scaledDy = scaledDy; data.isBehind = isBehind; if(data.domEl) {
    data.domEl.style.left = (x + scaledDx) + 'px'; data.domEl.style.top = (y + scaledDy) + 'px'; data.domEl.style.opacity = opacity; data.domEl.style.pointerEvents = pointerEvents;
    // HTML 文本框的缩放，强行挂载 1.0 恒定缩放 (textScale)
    data.domEl.style.transform = `translate(-50%, -50%) scale(${textScale})`; }
    // 【防卡死机制】：判定 NaN 确保 SVG 引擎不会崩溃
    if(data.svgPath && data.svgCircle && !isNaN(x)) { if (!isBehind && !data.isOccluded) { const x1 = x + scaledDx; const y1 = y + scaledDy; const midX = x + scaledDx * 0.5; const dStr = `M ${x} ${y} L ${midX} ${y1} L ${x1} ${y1}`; if (data.svgGlowPath) {
    data.svgGlowPath.setAttribute("d", dStr); data.svgGlowPath.setAttribute("opacity", "0.2"); }
    data.svgPath.setAttribute("d", dStr); data.svgPath.setAttribute("opacity", "0.8"); data.svgCircle.setAttribute("cx", x);
    data.svgCircle.setAttribute("cy", y); data.svgCircle.setAttribute("opacity", "0.8"); } else {
    if (data.svgGlowPath) data.svgGlowPath.setAttribute("opacity", "0"); data.svgPath.setAttribute("opacity", "0");
    data.svgCircle.setAttribute("opacity", "0"); } } }); }, clearAll: function() { window.annoDataList.forEach(data => { if(data.cleanupEvents) data.cleanupEvents();
    if(data.anchorObj && data.anchorObj.parent) data.anchorObj.parent.remove(data.anchorObj); }); window.annoDataList = [];
    const layer = document.getElementById('anno-layer'); if(layer) layer.querySelectorAll('.anno-dom').forEach(el => el.remove());
    const svg = document.getElementById('anno-svg'); if(svg) svg.innerHTML = ''; this.selectedId = null; },
    restoreAnnotations: function(obj, annos) { if(!annos) return; this.ensureDOM(); annos.forEach(a => { window.annoCounter++; const anchor = new THREE.Object3D(); anchor.position.set(a.localPos[0], a.localPos[1], a.localPos[2]); anchor.name = a.id; anchor.userData.localNormal = a.localNormal ? new THREE.Vector3(a.localNormal[0], a.localNormal[1], a.localNormal[2]) : new THREE.Vector3(0,1,0); obj.add(anchor); const annoData = { id: a.id, type: 'leader', targetUUID: obj.uuid, anchorObj: anchor, text: a.text, color: a.color || '#00d2ff', dx: a.dx, dy: a.dy, isOccluded: false }; if(a.baseDist) annoData.baseDist = a.baseDist; if(a.baseScale) annoData.baseScale = a.baseScale; window.annoDataList.push(annoData); this.buildDOM(annoData); }); }
    }; window.addEventListener('keydown', e => { if (e.key === 'Delete') { if (document.activeElement && document.activeElement.isContentEditable) return;
    const id = window.AnnotationManager.selectedId; if (id !== null) { const idx = window.annoDataList.findIndex(a => a.id === id); if (idx > -1) { const data = window.annoDataList[idx];
    if(data.anchorObj && data.anchorObj.parent) data.anchorObj.parent.remove(data.anchorObj); const div = document.getElementById('dom_' + id); if(div) div.remove(); if(data.svgGlowPath) data.svgGlowPath.remove();
    if(data.svgPath) data.svgPath.remove(); if(data.svgCircle) data.svgCircle.remove(); if(data.cleanupEvents) data.cleanupEvents(); window.annoDataList.splice(idx, 1); window.needsUpdate = true; window.lightMoved = true; }
    window.AnnotationManager.selectedId = null; } } }); // 【核心修复】：实时监听 UI 拾色器变动，直接染色当前选中的引线（外框、背景及 SVG 连线）
    const colorPicker = document.getElementById('obj-color-picker'); if (colorPicker) { colorPicker.addEventListener('input', e => { const id = window.AnnotationManager.selectedId; if (id !== null) {
    const data = window.annoDataList.find(a => a.id === id); if (data) { data.color = e.target.value; const div = document.getElementById('dom_' + id); if (div) { div.dataset.color = data.color;
    div.style.backgroundColor = window.AnnotationManager.getDarkBg(data.color); // 动态背景色
    }
    if (data.svgPath) data.svgPath.setAttribute("stroke", data.color); if (data.svgGlowPath) data.svgGlowPath.setAttribute("stroke", data.color);
    if (data.svgCircle) data.svgCircle.setAttribute("fill", data.color); window.needsUpdate = true; } } }); }
    // 【接入标准插件规范】
    window.AnnotationManager.onUpdate = function(context) { if (window.showAnnotations !== false && context.camera) { this.updateScreenPositions(context.camera); } };
    if (window.PluginManager) window.PluginManager.register('Annotation_UI', window.AnnotationManager);