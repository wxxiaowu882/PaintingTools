import * as THREE from 'three'; window.poly3dList = []; window.poly3dCounter = 0; window.Polygon3DManager = { selectedId: null, isDrawing: false, activeData: null, lastDrawX: 0, lastDrawY: 0,
    // 【核心】：利用 onUpdate 钩子白嫖系统的 Camera 和 Scene 引用，供内部射线检测使用
    onUpdate: function(context) { this._cachedCamera = context.camera; this._cachedScene = context.scene; if (window.showAnnotations !== false && context.camera) { this.updateScreenPositions(context.camera);
    const layer = document.getElementById('poly3d-layer'); if (layer) layer.style.display = 'block'; } else { const layer = document.getElementById('poly3d-layer');
    if (layer) layer.style.display = 'none'; } }, // 【操作流】：拦截全局鼠标移动，实现 Shift + Alt 悬停连续绘制
    onGlobalPointerMove: function(context) { if (window.currentEditorMode !== 'polygon3d') return; const e = context.event; if (e.shiftKey && e.altKey) { if (!this._cachedCamera || !this._cachedScene) return;
    if (!this._raycaster) this._raycaster = new THREE.Raycaster(); const pt = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1); this._raycaster.setFromCamera(pt, this._cachedCamera);
    // 过滤掉不可见物体、辅助控件，只与真实的 Mesh 碰撞
    const intersects = this._raycaster.intersectObjects(this._cachedScene.children, true)
    .filter(res => res.object.isMesh && res.object.visible && res.object.name !== 'transformControl' && !res.object.name.includes('helper')); if (intersects.length > 0) { const hit = intersects[0];
    let targetRoot = hit.object; // 【终极破解】：移除所有树层级查找！直接焊死在实际命中的底层网格上。利用后续的坐标变换完美化解缩放危机。
    const worldNormal = hit.face ? hit.face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize() : new THREE.Vector3(0,1,0); if (!this.isDrawing) {
    window.hwLog(`[Poly-Draw] 直接挂载到底层网格: ${targetRoot.name || targetRoot.type}`);
    this.startDrawing(targetRoot, hit.point, worldNormal, e.clientX, e.clientY); } else { const dist = Math.hypot(e.clientX - this.lastDrawX, e.clientY - this.lastDrawY); if (dist > 12) {
    this.addPoint(hit.point, worldNormal, e.clientX, e.clientY); } } } } },
    onGlobalPointerUp: function(e) { if (e.target && e.target.tagName === 'polygon' && e.target.parentNode && e.target.parentNode.style.cursor === 'pointer') return true; return false; },
    onKeyUp: function(event) { if (this.isDrawing && (event.key === 'Alt' || event.key === 'Shift')) { this.finishDrawing(); } },
    startDrawing: function(targetObj, worldPoint, worldNormal, screenX, screenY) { this.ensureDOM(); window.poly3dCounter++; const id = 'poly3d_' + Date.now() + '_' + window.poly3dCounter;
    // 整个面片只消耗 1 个 3D 锚点
    const anchor = new THREE.Object3D(); targetObj.worldToLocal(anchor.position.copy(worldPoint)); anchor.name = id; anchor.userData.localNormal = targetObj.worldToLocal(worldPoint.clone().add(worldNormal)).sub(anchor.position).normalize();
    targetObj.add(anchor); const color = document.getElementById('obj-color-picker')?.value || '#2ecc71'; this.activeData = { id: id, anchorObj: anchor, color: color, points: [], // 用于存储相对内部坐标的阵列
    isOccluded: false, isFinished: false // 【状态修复】：新增绘制完成状态标识
    }; window.poly3dList.push(this.activeData); this.buildDOM(this.activeData); this.isDrawing = true; this.lastDrawX = screenX; this.lastDrawY = screenY; this.addPoint(worldPoint, worldNormal, screenX, screenY);
    if (window.showToast) window.showToast("正在绘制光影面片，松开按键自动闭合..."); }, addPoint: function(worldPoint, worldNormal, screenX, screenY) { if (!this.activeData || !this.activeData.anchorObj.parent) return; // 将世界坐标降维转换为挂载模型的本地坐标系，永远锁死物理关联
    const localPos = this.activeData.anchorObj.parent.worldToLocal(worldPoint.clone()); this.activeData.points.push({ localPos: localPos }); this.lastDrawX = screenX; this.lastDrawY = screenY; window.needsUpdate = true; },
    finishDrawing: function() { this.isDrawing = false; if (this.activeData) { // 如果误触只有不到 3 个点，形不成面，直接作为垃圾回收
    if (this.activeData.points.length < 3) { const idx = window.poly3dList.indexOf(this.activeData); if (idx > -1) window.poly3dList.splice(idx, 1);
    if (this.activeData.anchorObj && this.activeData.anchorObj.parent) this.activeData.anchorObj.parent.remove(this.activeData.anchorObj); if (this.activeData.svgGroup) this.activeData.svgGroup.remove(); } else {
    this.activeData.isFinished = true; // 标记为绘制完成
    this.selectedId = null; // 【核心修复】：闭合时绝对不能自动选中，让虚线自然消失！
    this.highlightSelected(); if (window.showToast) window.showToast("面片已闭合保存！"); } }
    this.activeData = null; window.needsUpdate = true; window.lightMoved = true; }, ensureDOM: function() { if (!document.getElementById('poly3d-layer')) { const layer = document.createElement('div');
    layer.id = 'poly3d-layer'; // 【核心突破】：必须将 SVG 容器挂载到 canvas-container 内部，共享同一个层叠上下文，才能让 mix-blend-mode 完美穿透融合！
    layer.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: auto; overflow: visible;'; layer.innerHTML = '<svg id="poly3d-svg" style="width: 100%; height: 100%; pointer-events: none; overflow: visible;"></svg>'; const canvasContainer = document.getElementById('canvas-container'); if (canvasContainer) {
    canvasContainer.appendChild(layer); } else { document.body.appendChild(layer); }
    const colorPicker = document.getElementById('obj-color-picker'); if (colorPicker) { colorPicker.addEventListener('input', e => { const id = this.selectedId; if (id !== null) {
    const data = window.poly3dList.find(a => a.id === id); if (data) { data.color = e.target.value; if (data.svgGroup) { data.previewPolyline.setAttribute('stroke', data.color);
    data.previewPolyline.setAttribute('fill', window.Polygon3DManager.hexToRgba(data.color, 0.2)); data.svgFill.setAttribute('fill', data.color);
    data.svgBlend.setAttribute('fill', data.color); data.svgStroke.setAttribute('stroke', data.color); }
    window.needsUpdate = true; } } }); } } }, buildDOM: function(data) { const svg = document.getElementById('poly3d-svg'); const ns = "http://www.w3.org/2000/svg";
    const container = document.createElementNS(ns, "g"); // 【核心还原】：绘制中状态的临时虚线框 (纯显示，不可点击)
    const previewPolyline = document.createElementNS(ns, "polyline"); previewPolyline.setAttribute("stroke-width", "2");
    previewPolyline.setAttribute("stroke-dasharray", "4,4"); previewPolyline.style.pointerEvents = "none"; container.appendChild(previewPolyline); // 【核心还原】：闭合后的正式混合涂层 (响应点击)
    const finalGroup = document.createElementNS(ns, "g"); finalGroup.style.pointerEvents = "auto"; finalGroup.style.cursor = "pointer";
    const hitPath = document.createElementNS(ns, "polygon"); hitPath.setAttribute("fill", "transparent"); hitPath.setAttribute("stroke", "transparent"); hitPath.setAttribute("stroke-width", "20");
    const fillPath = document.createElementNS(ns, "polygon"); fillPath.style.pointerEvents = "none";
    const blendPath = document.createElementNS(ns, "polygon"); blendPath.setAttribute("style", "mix-blend-mode: color; pointer-events: none;");
    const strokePath = document.createElementNS(ns, "polygon"); strokePath.setAttribute("fill", "none"); strokePath.setAttribute("stroke-linejoin", "round"); strokePath.setAttribute("stroke-dasharray", "4,4"); strokePath.style.pointerEvents = "none";
    finalGroup.appendChild(hitPath); finalGroup.appendChild(fillPath); finalGroup.appendChild(blendPath); finalGroup.appendChild(strokePath); container.appendChild(finalGroup); finalGroup.addEventListener('pointerdown', e => {
    /* 【优化2】：移除模式限制，任何时候点击都能选中面片 */
    /* 【优化3】：移除 e.stopPropagation()，允许事件冒泡穿透到场景控制器，实现拖拽旋转 */
    if (window.AnnotationManager) { window.AnnotationManager.selectedId = null; window.AnnotationManager.highlightSelected(); }
    if (window.NormalArrowManager) { window.NormalArrowManager.selectedId = null; window.NormalArrowManager.highlightSelected(); }
    this.selectedId = data.id; this.highlightSelected(); }); svg.appendChild(container); data.svgGroup = container; data.previewPolyline = previewPolyline; data.finalGroup = finalGroup;
    data.svgHit = hitPath; data.svgFill = fillPath; data.svgBlend = blendPath; data.svgStroke = strokePath; // 分配各自的颜色与透明度
    previewPolyline.setAttribute("stroke", data.color); previewPolyline.setAttribute("fill", this.hexToRgba(data.color, 0.2));
    fillPath.setAttribute("fill", data.color); blendPath.setAttribute("fill", data.color); strokePath.setAttribute("stroke", data.color); }, // 【算法修复】：还原原案所需的 rgba 转换器
    hexToRgba: function(hex, alpha) { let c = hex.replace('#', ''); if(c.length === 3) c = c[0]+c[0]+c[1]+c[1]+c[2]+c[2];
    let r = parseInt(c.substring(0,2), 16), g = parseInt(c.substring(2,4), 16), b = parseInt(c.substring(4,6), 16); return `rgba(${r}, ${g}, ${b}, ${alpha})`; }, highlightSelected: function() { window.poly3dList.forEach(data => {
    data.isSelected = (this.selectedId === data.id); }); 
    // 【优化3】：专门为3D光影面片恢复选中反向吸色功能，并强制触发 input 事件！
    if (this.selectedId !== null) { const data = window.poly3dList.find(a => a.id === this.selectedId); const picker = document.getElementById('obj-color-picker'); if (data && picker) { picker.value = data.color; picker.dispatchEvent(new Event('input', { bubbles: true })); } }
    window.needsUpdate = true; }, updateScreenPositions: function(camera) { if(window.poly3dList.length === 0) return; if (!this._tempV) { this._tempV = new THREE.Vector3(); this._scratchV = new THREE.Vector3();
    this._normalMatrix = new THREE.Matrix3(); this._viewDir = new THREE.Vector3(); this._currentWorldNormal = new THREE.Vector3(); }
    window.poly3dList.forEach(data => { if(!data.anchorObj || !data.anchorObj.parent || data.points.length === 0) return; // 【严谨还原】：使用原案中极快、零消耗的背面法线剔除算法
    data.anchorObj.getWorldPosition(this._tempV); if (data.anchorObj.userData.localNormal) { this._normalMatrix.getNormalMatrix(data.anchorObj.parent.matrixWorld);
    this._currentWorldNormal.copy(data.anchorObj.userData.localNormal).applyMatrix3(this._normalMatrix).normalize(); this._viewDir.copy(camera.position).sub(this._tempV).normalize(); 
    const dot = this._currentWorldNormal.dot(this._viewDir);
    data.isOccluded = dot < -0.05; 
    if (data.isSelected) { /* 仅对选中的面片打印调试，防止日志刷屏 */ console.log(`[Poly-Render] ID:${data.id} dot:${dot.toFixed(3)} occluded:${data.isOccluded}`); }
    } else { data.isOccluded = false; }
    // 【彻底对齐原案逻辑】：只要被遮挡（转到背面），面片透明度强制归零（直接消失），杜绝任何灰黑实心块！
    const finalSvgAlpha = data.isOccluded ? 0 : (data.isSelected ? 1.0 : 0.85); let pointsStr = ""; let allBehind = true; data.points.forEach(pt => {
    this._scratchV.copy(pt.localPos).applyMatrix4(data.anchorObj.parent.matrixWorld); this._scratchV.project(camera); const isBehind = this._scratchV.z > 1.0 || this._scratchV.z < -1.0; if (!isBehind) allBehind = false;
    const sx = (this._scratchV.x * 0.5 + 0.5) * window.innerWidth; const sy = (-(this._scratchV.y * 0.5) + 0.5) * window.innerHeight; pointsStr += `${sx},${sy} `; }); data.sPointsStr = pointsStr; 
    if (data._dbgCnt === undefined) data._dbgCnt = 0; if (data._dbgCnt < 2 && data.isFinished) { window.hwLog(`[Poly-Render] ID:${data.id} isOccluded(是否被挡):${data.isOccluded} 最终透明度:${finalSvgAlpha} 屏幕坐标截取:${pointsStr.substring(0,35)}...`); data._dbgCnt++; }
    if (data.svgGroup) {
    if (allBehind) { data.svgGroup.style.display = "none"; } else { data.svgGroup.style.display = "block"; const pts = pointsStr.trim(); if (!data.isFinished) {
    data.previewPolyline.style.display = finalSvgAlpha > 0 ? "block" : "none"; data.finalGroup.style.display = "none";
    data.previewPolyline.setAttribute("points", pts); data.previewPolyline.setAttribute("opacity", finalSvgAlpha); } else { data.previewPolyline.style.display = "none";
    if (finalSvgAlpha > 0) { data.finalGroup.style.display = "block"; data.svgHit.setAttribute("points", pts); data.svgFill.setAttribute("points", pts);
    data.svgBlend.setAttribute("points", pts); data.svgStroke.setAttribute("points", pts); // 【视觉核心突破】：原案的 0.05 在物理光追的深邃阴影下会由于 color 混合导致发灰发黑。这里提升至 0.25，强行注入底色亮度，完美还原旧版的鲜亮质感！
    data.svgFill.setAttribute("opacity", finalSvgAlpha * 0.25); data.svgBlend.style.display = "block"; data.svgBlend.setAttribute("opacity", finalSvgAlpha); if (data.isSelected) {
    data.svgStroke.style.display = "block"; data.svgStroke.setAttribute("stroke-width", "2"); data.svgStroke.setAttribute("opacity", finalSvgAlpha * 0.8);
    } else { data.svgStroke.style.display = "none"; } } else { // 遮挡时 finalSvgAlpha 为 0，组整体隐藏
    data.finalGroup.style.display = "none"; } } } } }); }, // --- 标准生命周期与 IO 挂载 ---
    onClearScene: function() { window.poly3dList.forEach(data => { if(data.anchorObj && data.anchorObj.parent) data.anchorObj.parent.remove(data.anchorObj); if(data.svgGroup) data.svgGroup.remove(); });
    window.poly3dList = []; this.selectedId = null; this.isDrawing = false; this.activeData = null; }, onSaveItemData: function(context) { const polys = this.extractSaveData(context.obj);
    if (polys.length > 0) context.itemData.polygon3ds = polys; }, onSaveGroundData: function(context) { const polys = this.extractSaveData(context.obj); if (polys.length > 0) context.sceneData.groundPolygon3ds = polys; },
    extractSaveData: function(obj) { const polyData = []; if (!obj) return polyData; 
    obj.updateMatrixWorld(true);
    window.hwLog(`[Poly-Extract] 开始提取物体: ${obj.name || 'unnamed'} 的面片...`); obj.traverse(c => { if(c.name && c.name.startsWith('poly3d_')) {
    window.hwLog(`[Poly-Extract] 找到 3D 锚点: ${c.name}`); const d = window.poly3dList.find(a => a.id === c.name); if(d) { 
    // 【绝对降维打击】：必须将锚点坐标、所有边缘点坐标、法线方向，统统从“深层网格(c.parent)”转换为“根节点(obj)”的局部空间！
    const wPos = new THREE.Vector3(); c.getWorldPosition(wPos);
    const anchorLocalPos = wPos.clone(); obj.worldToLocal(anchorLocalPos);
    let norm = [0,1,0]; if(c.userData.localNormal) { const worldNorm = c.userData.localNormal.clone().transformDirection(c.parent.matrixWorld).normalize(); const objInvMat = new THREE.Matrix4().copy(obj.matrixWorld).invert(); const rootLocalNorm = worldNorm.transformDirection(objInvMat).normalize(); norm = [parseFloat(rootLocalNorm.x.toFixed(3)), parseFloat(rootLocalNorm.y.toFixed(3)), parseFloat(rootLocalNorm.z.toFixed(3))]; }
    const ptsArray = d.points.map(p => { const ptWorld = p.localPos.clone().applyMatrix4(c.parent.matrixWorld); obj.worldToLocal(ptWorld); return [parseFloat(ptWorld.x.toFixed(4)), parseFloat(ptWorld.y.toFixed(4)), parseFloat(ptWorld.z.toFixed(4))]; });
    polyData.push({ id: d.id, color: d.color, localPos: [parseFloat(anchorLocalPos.x.toFixed(4)), parseFloat(anchorLocalPos.y.toFixed(4)), parseFloat(anchorLocalPos.z.toFixed(4))], localNormal: norm, points: ptsArray });
    window.hwLog(`[Poly-Extract] 数据全维度映射完成，点数: ${ptsArray.length}`); } else { window.hwLog(`[Poly-Extract] 警告: 找到锚点但 poly3dList 中无对应数据!`); } } }); return polyData; },
    onLoadItem: function(ctx) { if(ctx.itemData.polygon3ds) this.restorePolygons(ctx.obj, ctx.itemData.polygon3ds); }, onLoadGround: function(ctx) {
    if(ctx.sceneData.groundPolygon3ds) this.restorePolygons(ctx.obj, ctx.sceneData.groundPolygon3ds); }, restorePolygons: function(obj, polys) { 
    if(!polys || polys.length === 0) { window.hwLog(`[Plugin-Load] 放弃加载：${obj.name || 'unnamed'} 没有面片数据`); return; } 
    window.hwLog(`[Plugin-Load] 关键触发：准备为 ${obj.name || 'unnamed'} 恢复 ${polys.length} 个面片`); 
    this.ensureDOM(); obj.updateMatrixWorld(true); // 【关键修正】：强制更新模型矩阵，防止异步加载导致坐标投影失败
    polys.forEach(a => { window.poly3dCounter++;
    const anchor = new THREE.Object3D(); anchor.position.set(a.localPos[0], a.localPos[1], a.localPos[2]); anchor.name = a.id;
    anchor.userData.localNormal = a.localNormal ? new THREE.Vector3(a.localNormal[0], a.localNormal[1], a.localNormal[2]) : new THREE.Vector3(0,1,0); obj.add(anchor);
    const pts = a.points.map(p => ({ localPos: new THREE.Vector3(p[0], p[1], p[2]) }));
    const data = { id: a.id, anchorObj: anchor, color: a.color || '#2ecc71', points: pts, isOccluded: false, isFinished: true };
    window.poly3dList.push(data); this.buildDOM(data); window.hwLog(` -> 面片 ${a.id} 已还原到 3D 空间`); }); 
    window.needsUpdate = true; window.lightMoved = true; }, onDrawSnapshot: function(context) { if (!window.poly3dList) return; const ctx = context.ctx, rect = context.rect; const scaleX = 256 / rect.width, scaleY = 256 / rect.height;
    window.poly3dList.forEach(data => { if (data.isOccluded || !data.sPointsStr) return; const ptsArray = data.sPointsStr.trim().split(' '); if (ptsArray.length < 3) return; ctx.beginPath();
    ptsArray.forEach((ptStr, i) => { const [sx, sy] = ptStr.split(',').map(parseFloat); const tx = (sx - rect.left) * scaleX; const ty = (sy - rect.top) * scaleY;
    if (i === 0) ctx.moveTo(tx, ty); else ctx.lineTo(tx, ty); }); ctx.closePath(); // 截屏严格还原叠加算法 (使用 Canvas 全局合成模式)
    if (!data.isOccluded) { ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = data.color; ctx.globalAlpha = 0.25; // 同步提升截屏时的底色亮度防发黑
    ctx.fill(); ctx.globalCompositeOperation = 'color'; // 对应 mix-blend-mode: color
    ctx.globalAlpha = 1.0; ctx.fill(); }
    // 【截屏同步对齐】：当转到背面遮挡时，直接彻底跳过渲染，不再绘制多余的实色和虚线
    ctx.globalCompositeOperation = 'source-over'; // 还原全局合成模式
    ctx.globalCompositeOperation = 'source-over'; // 还原全局合成模式
    }); } }; window.addEventListener('keydown', e => { if (e.key === 'Delete' || e.key === 'Backspace') {
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return; const id = window.Polygon3DManager.selectedId; if (id !== null) { const idx = window.poly3dList.findIndex(a => a.id === id);
    if (idx > -1) { const data = window.poly3dList[idx]; if(data.anchorObj && data.anchorObj.parent) data.anchorObj.parent.remove(data.anchorObj); if(data.svgGroup) data.svgGroup.remove(); window.poly3dList.splice(idx, 1);
    window.needsUpdate = true; window.lightMoved = true; }
    window.Polygon3DManager.selectedId = null; } } }); if (window.PluginManager) window.PluginManager.register('Polygon3D_UI', window.Polygon3DManager);