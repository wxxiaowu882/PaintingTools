import * as THREE from 'three';
/** iOS / iPadOS WebKit：SVG 上 mix-blend-mode:color 与 WebGL 画布合成经常失效，面片会像纯色平涂；改用 soft-light + 略调透明度贴近 PC 上「底色+着色」层次 */
const _poly3dIosLike = typeof navigator !== 'undefined' && (/iPhone|iPad|iPod/i.test(navigator.userAgent || '') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

// iOS 新策略：不做 readPixels 读回，改为“法线 + 主光方向”的几何明暗，避免卡顿并保证转动时连续变化。
const _poly3dIosGeomShadeCfg = {
    enabled: true,
    ambient: 0.22,
    diffuse: 0.95,
    contrast: 1.18,
    lumaSmooth: 0.35,
    lumaMin: 0.10,
    lumaMax: 0.98,
    // iPad 可见性增强：提高渐变底层占比，降低 soft-light 盖层占比，避免“算了但看起来不变”。
    fillAlpha: 0.58,
    blendAlpha: 0.52
};
// iPad SVG 融合模式：multiply 比 soft-light 更容易“吃进”场景明暗，不只是透明叠色。
const _poly3dIosBlendMode = 'multiply';

function _poly3dClamp01(x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }
function _poly3dHexToRgb01(hex) {
    try {
        if (!hex) return { r: 1, g: 1, b: 1 };
        let c = String(hex).replace('#', '');
        if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
        const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
        if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return { r: 1, g: 1, b: 1 };
        return { r: r / 255, g: g / 255, b: b / 255 };
    } catch (_e) { return { r: 1, g: 1, b: 1 }; }
}
function _poly3dRgb01ToHex(c) {
    const r = Math.round(_poly3dClamp01(c.r) * 255);
    const g = Math.round(_poly3dClamp01(c.g) * 255);
    const b = Math.round(_poly3dClamp01(c.b) * 255);
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}
function _poly3dRgb01ToHsl(c) {
    const r = _poly3dClamp01(c.r), g = _poly3dClamp01(c.g), b = _poly3dClamp01(c.b);
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) * 0.5;
    const d = max - min;
    if (d > 1e-6) {
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = (g - b) / d + (g < b ? 6 : 0); break;
            case g: h = (b - r) / d + 2; break;
            default: h = (r - g) / d + 4; break;
        }
        h /= 6;
    }
    return { h, s, l };
}
function _poly3dHue2rgb(p, q, t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
}
function _poly3dHslToRgb01(hsl) {
    const h = ((hsl.h % 1) + 1) % 1;
    const s = _poly3dClamp01(hsl.s);
    const l = _poly3dClamp01(hsl.l);
    if (s < 1e-6) return { r: l, g: l, b: l };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return {
        r: _poly3dHue2rgb(p, q, h + 1 / 3),
        g: _poly3dHue2rgb(p, q, h),
        b: _poly3dHue2rgb(p, q, h - 1 / 3)
    };
}
window.poly3dList = []; window.poly3dCounter = 0; window.Polygon3DManager = { selectedId: null, isDrawing: false, activeData: null, lastDrawX: 0, lastDrawY: 0,
    _samplingDisabled: true,
    _regionStateVersion: 0,
    _bumpRegionVersion: function() {
        this._regionStateVersion = (this._regionStateVersion || 0) + 1;
    },
    _rebuildRegionState: function() {
        const out = [];
        window.poly3dList.forEach(d => {
            if (!d || !d.isFinished || !d.anchorObj || !d.anchorObj.parent || !Array.isArray(d.points) || d.points.length < 3) return;
            out.push({
                id: d.id,
                meshUUID: d.anchorObj.parent.uuid,
                color: d.color || '#2ecc71',
                pointsLocal: d.points.map(p => [p.localPos.x, p.localPos.y, p.localPos.z]),
                localNormal: d.anchorObj.userData && d.anchorObj.userData.localNormal ? [d.anchorObj.userData.localNormal.x, d.anchorObj.userData.localNormal.y, d.anchorObj.userData.localNormal.z] : [0, 1, 0]
            });
        });
        window.__poly3dRegionState = { version: this._regionStateVersion || 0, regions: out };
    },
    // 【核心】：利用 onUpdate 钩子白嫖系统的 Camera 和 Scene 引用，供内部射线检测使用
    onUpdate: function(context) { this._cachedCamera = context.camera; this._cachedScene = context.scene; this._rebuildRegionState(); if (window.showAnnotations !== false && context.camera) { this.updateScreenPositions(context.camera);
    const layer = document.getElementById('poly3d-layer'); if (layer) layer.style.display = 'block'; } else { const layer = document.getElementById('poly3d-layer');
    if (layer) layer.style.display = 'none'; } }, // 【操作流】：拦截全局鼠标移动，实现 Shift + Alt 悬停连续绘制
    onGlobalPointerMove: function(context) { if (window.currentEditorMode !== 'polygon3d') return; const e = context.event; if (e.shiftKey && e.altKey) { if (!this._cachedCamera || !this._cachedScene) return;
    if (!this._raycaster) this._raycaster = new THREE.Raycaster(); const pt = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1); this._raycaster.setFromCamera(pt, this._cachedCamera);
    // 过滤掉不可见物体、辅助控件，只与真实的 Mesh 碰撞
    const intersects = this._raycaster.intersectObjects(this._cachedScene.children, true)
    .filter(res => res.object.isMesh && res.object.visible && res.object.name !== 'transformControl' && !res.object.name.includes('helper')); if (intersects.length > 0) { const hit = intersects[0];
    let targetRoot = hit.object; // 【终极破解】：移除所有树层级查找！直接焊死在实际命中的底层网格上。利用后续的坐标变换完美化解缩放危机。
    const worldNormal = hit.face ? hit.face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize() : new THREE.Vector3(0,1,0); if (!this.isDrawing) {
    this.startDrawing(targetRoot, hit.point, worldNormal, e.clientX, e.clientY); } else { const dist = Math.hypot(e.clientX - this.lastDrawX, e.clientY - this.lastDrawY); if (dist > 12) {
    this.addPoint(hit.point, worldNormal, e.clientX, e.clientY); } } } } },
    onGlobalPointerUp: function(e) { if (e.target && e.target.tagName === 'polygon' && e.target.parentNode && e.target.parentNode.style.cursor === 'pointer') return true; return false; },
    onKeyUp: function(event) { if (this.isDrawing && (event.key === 'Alt' || event.key === 'Shift')) { this.finishDrawing(); } },
    cancelInteractivePlacing: function() { if (this.isDrawing) this.finishDrawing(); },
    startDrawing: function(targetObj, worldPoint, worldNormal, screenX, screenY) { this.ensureDOM(); window.poly3dCounter++; const id = 'poly3d_' + Date.now() + '_' + window.poly3dCounter;
    // 整个面片只消耗 1 个 3D 锚点
    const anchor = new THREE.Object3D(); targetObj.worldToLocal(anchor.position.copy(worldPoint)); anchor.name = id; anchor.userData.localNormal = targetObj.worldToLocal(worldPoint.clone().add(worldNormal)).sub(anchor.position).normalize();
    targetObj.add(anchor); const color = document.getElementById('obj-color-picker')?.value || '#2ecc71'; this.activeData = { id: id, anchorObj: anchor, color: color, detailText: '', points: [], // 用于存储相对内部坐标的阵列
    isOccluded: false, isFinished: false // 【状态修复】：新增绘制完成状态标识
    }; window.poly3dList.push(this.activeData); this._bumpRegionVersion(); this.buildDOM(this.activeData); this.isDrawing = true; this.lastDrawX = screenX; this.lastDrawY = screenY; this.addPoint(worldPoint, worldNormal, screenX, screenY);
    if (window.showToast) window.showToast("正在绘制光影面片，松开按键自动闭合..."); }, addPoint: function(worldPoint, worldNormal, screenX, screenY) { if (!this.activeData || !this.activeData.anchorObj.parent) return; // 将世界坐标降维转换为挂载模型的本地坐标系，永远锁死物理关联
    const localPos = this.activeData.anchorObj.parent.worldToLocal(worldPoint.clone());
    let localNormal = null;
    if (worldNormal) {
        localNormal = this.activeData.anchorObj.parent.worldToLocal(worldPoint.clone().add(worldNormal)).sub(localPos.clone()).normalize();
    }
    this.activeData.points.push({ localPos: localPos, localNormal: localNormal }); this.lastDrawX = screenX; this.lastDrawY = screenY; window.needsUpdate = true; },
    finishDrawing: function() { this.isDrawing = false; if (this.activeData) { // 如果误触只有不到 3 个点，形不成面，直接作为垃圾回收
    if (this.activeData.points.length < 3) { const idx = window.poly3dList.indexOf(this.activeData); if (idx > -1) window.poly3dList.splice(idx, 1);
    if (this.activeData.anchorObj && this.activeData.anchorObj.parent) this.activeData.anchorObj.parent.remove(this.activeData.anchorObj); if (this.activeData.svgGroup) this.activeData.svgGroup.remove(); if (this.activeData.svgGrad) this.activeData.svgGrad.remove(); } else {
    this.activeData.isFinished = true; // 标记为绘制完成
    this._bumpRegionVersion();
    this.selectedId = null; // 【核心修复】：闭合时绝对不能自动选中，让虚线自然消失！
    this.highlightSelected(); if (window.showToast) window.showToast("面片已闭合保存！"); } }
    this.activeData = null; window.needsUpdate = true; window.lightMoved = true; }, ensureDOM: function() { if (!document.getElementById('poly3d-layer')) { const layer = document.createElement('div');
    layer.id = 'poly3d-layer'; // 【核心突破】：必须将 SVG 容器挂载到 canvas-container 内部，共享同一个层叠上下文，才能让 mix-blend-mode 完美穿透融合！
    layer.style.cssText = 'position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: auto; overflow: visible;'; layer.innerHTML = '<svg id="poly3d-svg" style="width: 100%; height: 100%; pointer-events: none; overflow: visible;"></svg>'; const canvasContainer = document.getElementById('canvas-container'); if (canvasContainer) {
    canvasContainer.appendChild(layer); } else { document.body.appendChild(layer); }
    const colorPicker = document.getElementById('obj-color-picker'); if (colorPicker) { colorPicker.addEventListener('input', e => { const id = this.selectedId; if (id !== null) {
    const data = window.poly3dList.find(a => a.id === id); if (data) { data.color = e.target.value; this._bumpRegionVersion(); if (data.svgGroup) { data.previewPolyline.setAttribute('stroke', data.color);
    data.previewPolyline.setAttribute('fill', window.Polygon3DManager.hexToRgba(data.color, 0.2));
    // 切色后重置几何光照缓存，下一帧按新底色重新收敛。
    data._shadedFill = null; data._lumaSmoothed = undefined; data._lumaDarkSm = undefined; data._lumaMidSm = undefined; data._lumaBrightSm = undefined;
    if (data.svgGrad) data.svgFill.setAttribute('fill', `url(#${data.svgGrad.id})`); else data.svgFill.setAttribute('fill', data.color);
    data.svgBlend.setAttribute('fill', data.color); data.svgStroke.setAttribute('stroke', data.color); }
    window.needsUpdate = true; } } }); } } }, buildDOM: function(data) { const svg = document.getElementById('poly3d-svg'); const ns = "http://www.w3.org/2000/svg";
    const container = document.createElementNS(ns, "g"); // 【核心还原】：绘制中状态的临时虚线框 (纯显示，不可点击)
    const previewPolyline = document.createElementNS(ns, "polyline"); previewPolyline.setAttribute("stroke-width", "2");
    previewPolyline.setAttribute("stroke-dasharray", "4,4"); previewPolyline.style.pointerEvents = "none"; container.appendChild(previewPolyline); // 【核心还原】：闭合后的正式混合涂层 (响应点击)
    const finalGroup = document.createElementNS(ns, "g"); finalGroup.style.pointerEvents = "auto"; finalGroup.style.cursor = "pointer";
    const hitPath = document.createElementNS(ns, "polygon"); hitPath.setAttribute("fill", "transparent"); hitPath.setAttribute("stroke", "transparent"); hitPath.setAttribute("stroke-width", "20");
    const fillPath = document.createElementNS(ns, "polygon"); fillPath.style.pointerEvents = "none";
    const blendPath = document.createElementNS(ns, "polygon"); blendPath.setAttribute("style", (_poly3dIosLike ? `mix-blend-mode: ${_poly3dIosBlendMode}; -webkit-mix-blend-mode: ${_poly3dIosBlendMode};` : "mix-blend-mode: color;") + " pointer-events: none;");
    const strokePath = document.createElementNS(ns, "polygon"); strokePath.setAttribute("fill", "none"); strokePath.setAttribute("stroke-linejoin", "round"); strokePath.setAttribute("stroke-dasharray", "4,4"); strokePath.style.pointerEvents = "none";
    let grad = null, stopA = null, stopB = null, stopC = null;
    if (_poly3dIosLike && _poly3dIosGeomShadeCfg.enabled) {
        let defs = document.getElementById('poly3d-defs');
        if (!defs) {
            defs = document.createElementNS(ns, 'defs');
            defs.id = 'poly3d-defs';
            svg.appendChild(defs);
        }
        const gradId = ('poly3d_grad_' + data.id).replace(/[^a-zA-Z0-9_:-]/g, '_');
        grad = document.createElementNS(ns, 'linearGradient');
        grad.setAttribute('id', gradId);
        grad.setAttribute('gradientUnits', 'userSpaceOnUse');
        stopA = document.createElementNS(ns, 'stop'); stopA.setAttribute('offset', '0%');
        stopB = document.createElementNS(ns, 'stop'); stopB.setAttribute('offset', '50%');
        stopC = document.createElementNS(ns, 'stop'); stopC.setAttribute('offset', '100%');
        grad.appendChild(stopA); grad.appendChild(stopB); grad.appendChild(stopC);
        defs.appendChild(grad);
        fillPath.setAttribute('fill', `url(#${gradId})`);
    }
    finalGroup.appendChild(hitPath); finalGroup.appendChild(fillPath); finalGroup.appendChild(blendPath); finalGroup.appendChild(strokePath); container.appendChild(finalGroup);     finalGroup.addEventListener('pointerdown', e => {
    if (window.__SOLID_CONSUMER__) {
        e.stopPropagation();
        if (window.PluginManager && typeof window.PluginManager.setExclusiveSelection === 'function') {
            if (this.selectedId === data.id) window.PluginManager.setExclusiveSelection(this, null);
            else window.PluginManager.setExclusiveSelection(this, data.id);
        }
        return;
    }
    /* 【优化2】：移除模式限制；互斥选中由 PluginManager 统一处理 */
    /* 【优化3】：移除 e.stopPropagation()，允许事件冒泡穿透到场景控制器 */
    if (window.PluginManager && typeof window.PluginManager.setExclusiveSelection === 'function') {
        window.PluginManager.setExclusiveSelection(this, data.id);
    } else {
        this.selectedId = data.id;
        this.highlightSelected();
    } }); svg.appendChild(container); data.svgGroup = container; data.previewPolyline = previewPolyline; data.finalGroup = finalGroup;
    data.svgHit = hitPath; data.svgFill = fillPath; data.svgBlend = blendPath; data.svgStroke = strokePath;
    data.svgGrad = grad; data.svgGradStopA = stopA; data.svgGradStopB = stopB; data.svgGradStopC = stopC; // 分配各自的颜色与透明度
    previewPolyline.setAttribute("stroke", data.color); previewPolyline.setAttribute("fill", this.hexToRgba(data.color, 0.2));
    fillPath.setAttribute("fill", data.color); blendPath.setAttribute("fill", data.color); strokePath.setAttribute("stroke", data.color); }, // 【算法修复】：还原原案所需的 rgba 转换器
    hexToRgba: function(hex, alpha) { let c = hex.replace('#', ''); if(c.length === 3) c = c[0]+c[0]+c[1]+c[1]+c[2]+c[2];
    let r = parseInt(c.substring(0,2), 16), g = parseInt(c.substring(2,4), 16), b = parseInt(c.substring(4,6), 16); return `rgba(${r}, ${g}, ${b}, ${alpha})`; },
    _resolveMainLightDir: function(camera) {
        if (!this._lightDirW) this._lightDirW = new THREE.Vector3();
        if (!this._lightTmpW) this._lightTmpW = new THREE.Vector3();
        const scene = this._cachedScene;
        if (scene) {
            let found = false;
            scene.traverseVisible(obj => {
                if (found || !obj || !obj.isLight || obj.intensity <= 0) return;
                if (obj.isDirectionalLight) {
                    const target = obj.target;
                    if (target && target.getWorldPosition) {
                        target.getWorldPosition(this._lightTmpW);
                        obj.getWorldPosition(this._lightDirW);
                        this._lightDirW.sub(this._lightTmpW).normalize();
                    } else {
                        obj.getWorldDirection(this._lightDirW).normalize();
                    }
                    found = true;
                } else if (obj.isSpotLight) {
                    obj.getWorldDirection(this._lightDirW).normalize();
                    found = true;
                }
            });
            if (found) return this._lightDirW;
        }
        // 没有主方向光时，回退为“视线同向主光”，保证有连续明暗变化且不发灰。
        this._lightDirW.copy(camera.position).sub(this._tempV).normalize();
        return this._lightDirW;
    },
    _shadeFromLightIntensity: function(baseHex, intensity, prevLuma) {
        const baseHsl = _poly3dRgb01ToHsl(_poly3dHexToRgb01(baseHex));
        const t = _poly3dClamp01(Math.pow(intensity, _poly3dIosGeomShadeCfg.contrast));
        const l = Math.max(_poly3dIosGeomShadeCfg.lumaMin, Math.min(_poly3dIosGeomShadeCfg.lumaMax, t));
        const sm = (typeof prevLuma === 'number') ? (prevLuma + (l - prevLuma) * _poly3dIosGeomShadeCfg.lumaSmooth) : l;
        const rgb = _poly3dHslToRgb01({ h: baseHsl.h, s: baseHsl.s, l: sm });
        return { shadedHex: _poly3dRgb01ToHex(rgb), lumaSmoothed: sm };
    },
    _isUnderRoot: function(obj, root) {
        if (!obj || !root) return false;
        let p = obj;
        let guard = 0;
        while (p && guard++ < 64) {
            if (p.uuid === root.uuid) return true;
            p = p.parent;
        }
        return false;
    },
    _isBlockedByOtherMesh: function(camera, worldPoint, ownerRoot) {
        try {
            if (!this._cachedScene || !camera || !worldPoint) return false;
            if (!this._occRaycaster) this._occRaycaster = new THREE.Raycaster();
            if (!this._occDir) this._occDir = new THREE.Vector3();
            if (!this._occCamPos) this._occCamPos = new THREE.Vector3();
            this._occCamPos.copy(camera.position);
            this._occDir.copy(worldPoint).sub(this._occCamPos);
            const dist = this._occDir.length();
            if (dist < 1e-4) return false;
            this._occDir.divideScalar(dist);
            this._occRaycaster.near = 0.02;
            this._occRaycaster.far = dist - 0.02;
            this._occRaycaster.set(this._occCamPos, this._occDir);
            const hits = this._occRaycaster.intersectObjects(this._cachedScene.children, true);
            for (let i = 0; i < hits.length; i++) {
                const h = hits[i];
                const o = h && h.object;
                if (!o || !o.isMesh || !o.visible) continue;
                if (o.name === 'transformControl' || (o.name && o.name.includes('helper'))) continue;
                // 忽略当前片面所属模型自身命中，只拦截“其它模型”的遮挡。
                if (ownerRoot && this._isUnderRoot(o, ownerRoot)) continue;
                if (h.distance < dist - 0.02) return true;
            }
            return false;
        } catch (_e) { return false; }
    }, highlightSelected: function() { window.poly3dList.forEach(data => {
    data.isSelected = (this.selectedId === data.id); }); 
    // 【优化3】：专门为3D光影面片恢复选中反向吸色功能，并强制触发 input 事件！
    if (this.selectedId !== null) { const data = window.poly3dList.find(a => a.id === this.selectedId); const picker = document.getElementById('obj-color-picker'); if (data && picker) { picker.value = data.color; picker.dispatchEvent(new Event('input', { bubbles: true })); } }
    window.needsUpdate = true; }, updateScreenPositions: function(camera) { if(window.poly3dList.length === 0) return; if (!this._tempV) { this._tempV = new THREE.Vector3(); this._scratchV = new THREE.Vector3();
    this._normalMatrix = new THREE.Matrix3(); this._viewDir = new THREE.Vector3(); this._currentWorldNormal = new THREE.Vector3(); }
    window.poly3dList.forEach(data => { if(!data.anchorObj || !data.anchorObj.parent || data.points.length === 0) return; // 【严谨还原】：使用原案中极快、零消耗的背面法线剔除算法
    data.anchorObj.getWorldPosition(this._tempV); if (data.anchorObj.userData.localNormal) { this._normalMatrix.getNormalMatrix(data.anchorObj.parent.matrixWorld);
    this._currentWorldNormal.copy(data.anchorObj.userData.localNormal).applyMatrix3(this._normalMatrix).normalize(); this._viewDir.copy(camera.position).sub(this._tempV).normalize(); 
    const dot = this._currentWorldNormal.dot(this._viewDir);
    const blockedByOtherMesh = this._isBlockedByOtherMesh(camera, this._tempV, data.anchorObj.parent);
    data.isOccluded = (dot < -0.05) || blockedByOtherMesh;
    if (_poly3dIosLike && _poly3dIosGeomShadeCfg.enabled) {
        const lightDir = this._resolveMainLightDir(camera);
        const nDotL = Math.max(0, this._currentWorldNormal.dot(lightDir));
        const intensity = _poly3dIosGeomShadeCfg.ambient + _poly3dIosGeomShadeCfg.diffuse * nDotL;
        const shaded = this._shadeFromLightIntensity(data.color || '#2ecc71', intensity, data._lumaSmoothed);
        data._lumaSmoothed = shaded.lumaSmoothed;
        data._shadedFill = shaded.shadedHex;
    }
    // 选中面片的调试日志：默认关闭（否则每帧刷屏会拖慢页面）。
    // 打开方式：localStorage.setItem('SolidPoly3DDbg','1') 然后刷新。
    if (data.isSelected) {}
    } else { data.isOccluded = false; }
    // 【彻底对齐原案逻辑】：只要被遮挡（转到背面），面片透明度强制归零（直接消失），杜绝任何灰黑实心块！
    const finalSvgAlpha = data.isOccluded ? 0 : (data.isSelected ? 1.0 : 0.85); let pointsStr = ""; let allBehind = true;
    let minI = Infinity, maxI = -Infinity, minX = 0, minY = 0, maxX = 0, maxY = 0, iSum = 0, iCount = 0;
    if (!this._ptNormalW) this._ptNormalW = new THREE.Vector3();
    if (!this._halfV) this._halfV = new THREE.Vector3();
    const lightDirForPts = (_poly3dIosLike && _poly3dIosGeomShadeCfg.enabled) ? this._resolveMainLightDir(camera) : null;
    data.points.forEach(pt => {
    this._scratchV.copy(pt.localPos).applyMatrix4(data.anchorObj.parent.matrixWorld); this._scratchV.project(camera); const isBehind = this._scratchV.z > 1.0 || this._scratchV.z < -1.0; if (!isBehind) allBehind = false;
    const sx = (this._scratchV.x * 0.5 + 0.5) * window.innerWidth; const sy = (-(this._scratchV.y * 0.5) + 0.5) * window.innerHeight; pointsStr += `${sx},${sy} `;
    if (lightDirForPts) {
        if (pt.localNormal) this._ptNormalW.copy(pt.localNormal).applyMatrix3(this._normalMatrix).normalize(); else this._ptNormalW.copy(this._currentWorldNormal);
        const nDotL = Math.max(0, this._ptNormalW.dot(lightDirForPts));
        const nDotV = Math.max(0, this._ptNormalW.dot(this._viewDir));
        this._halfV.copy(lightDirForPts).add(this._viewDir).normalize();
        const spec = Math.pow(Math.max(0, this._ptNormalW.dot(this._halfV)), 12.0) * 0.18;
        const inten = _poly3dClamp01(_poly3dIosGeomShadeCfg.ambient + _poly3dIosGeomShadeCfg.diffuse * nDotL + 0.10 * nDotV + spec);
        iSum += inten; iCount++;
        if (inten < minI) { minI = inten; minX = sx; minY = sy; }
        if (inten > maxI) { maxI = inten; maxX = sx; maxY = sy; }
    }
    }); data.sPointsStr = pointsStr; 
    if (lightDirForPts && iCount > 0) {
        const midI = iSum / iCount;
        const dark = this._shadeFromLightIntensity(data.color || '#2ecc71', minI, data._lumaDarkSm); data._lumaDarkSm = dark.lumaSmoothed;
        const mid = this._shadeFromLightIntensity(data.color || '#2ecc71', midI, data._lumaMidSm); data._lumaMidSm = mid.lumaSmoothed;
        const bright = this._shadeFromLightIntensity(data.color || '#2ecc71', maxI, data._lumaBrightSm); data._lumaBrightSm = bright.lumaSmoothed;
        data._shadeDark = dark.shadedHex; data._shadeMid = mid.shadedHex; data._shadeBright = bright.shadedHex;
        data._gradX1 = minX; data._gradY1 = minY; data._gradX2 = maxX; data._gradY2 = maxY;
        data._shadeRange = Math.max(0, Math.min(1, maxI - minI));
    }
    if (data._dbgCnt === undefined) data._dbgCnt = 0;
    if (data.svgGroup) {
    if (allBehind) { data.svgGroup.style.display = "none"; } else { data.svgGroup.style.display = "block"; const pts = pointsStr.trim(); if (!data.isFinished) {
    data.previewPolyline.style.display = finalSvgAlpha > 0 ? "block" : "none"; data.finalGroup.style.display = "none";
    data.previewPolyline.setAttribute("points", pts); data.previewPolyline.setAttribute("opacity", finalSvgAlpha); } else { data.previewPolyline.style.display = "none";
    if (finalSvgAlpha > 0) { data.finalGroup.style.display = "block"; data.svgHit.setAttribute("points", pts); data.svgFill.setAttribute("points", pts);
    data.svgBlend.setAttribute("points", pts); data.svgStroke.setAttribute("points", pts);
    // SVG-only + iPad 光影模拟：iOS 使用渐变填充，非 iOS 维持纯色填充
    if (_poly3dIosLike && _poly3dIosGeomShadeCfg.enabled && data.svgGrad && data.svgGradStopA && data.svgGradStopB && data.svgGradStopC) {
    const x1 = (typeof data._gradX1 === 'number') ? data._gradX1 : 0;
    const y1 = (typeof data._gradY1 === 'number') ? data._gradY1 : 0;
    const x2 = (typeof data._gradX2 === 'number') ? data._gradX2 : 1;
    const y2 = (typeof data._gradY2 === 'number') ? data._gradY2 : 1;
    data.svgGrad.setAttribute('x1', String(x1));
    data.svgGrad.setAttribute('y1', String(y1));
    data.svgGrad.setAttribute('x2', String(x2));
    data.svgGrad.setAttribute('y2', String(y2));
    data.svgGradStopA.setAttribute('stop-color', data._shadeDark || data.color);
    data.svgGradStopB.setAttribute('stop-color', data._shadeMid || data.color);
    data.svgGradStopC.setAttribute('stop-color', data._shadeBright || data.color);
    data.svgFill.setAttribute('fill', `url(#${data.svgGrad.id})`);
    } else {
    data.svgFill.setAttribute("fill", data.color);
    }
    const iosRangeBoost = (_poly3dIosLike && _poly3dIosGeomShadeCfg.enabled) ? (0.75 + Math.max(0, Math.min(1, data._shadeRange || 0)) * 0.55) : 1.0;
    const fillAlpha = (_poly3dIosLike && _poly3dIosGeomShadeCfg.enabled) ? (finalSvgAlpha * _poly3dIosGeomShadeCfg.fillAlpha * iosRangeBoost) : (finalSvgAlpha * 0.22);
    const blendAlpha = (_poly3dIosLike && _poly3dIosGeomShadeCfg.enabled) ? (finalSvgAlpha * _poly3dIosGeomShadeCfg.blendAlpha * iosRangeBoost) : finalSvgAlpha;
    data.svgFill.setAttribute("opacity", String(fillAlpha));
    data.svgBlend.style.display = "block";
    if (_poly3dIosLike && _poly3dIosGeomShadeCfg.enabled) data.svgBlend.setAttribute("fill", data._shadeMid || data.color);
    else data.svgBlend.setAttribute("fill", data.color);
    data.svgBlend.setAttribute("opacity", String(blendAlpha));
    if (data.isSelected) {
    data.svgStroke.style.display = "block"; data.svgStroke.setAttribute("stroke-width", "2"); data.svgStroke.setAttribute("opacity", finalSvgAlpha * 0.8);
    } else { data.svgStroke.style.display = "none"; } } else { // 遮挡时 finalSvgAlpha 为 0，组整体隐藏
    data.finalGroup.style.display = "none"; } } } } }); }, // --- 标准生命周期与 IO 挂载 ---
    readScreenColor: function(renderer, screenX, screenY) {
        // 保留接口以兼容旧调用；iOS 已切换为几何光照策略，不再 readPixels。
        return { r: 1, g: 1, b: 1 };
    },
    _shadeFromModelLuma: function(baseHex, modelRgb01, prevLuma) {
        return this._shadeFromLightIntensity(baseHex, 1, prevLuma);
    },
    onPostRender: function(context) {
        // iOS 已改为 updateScreenPositions 内的几何光照，不再执行 readPixels 批采样。
        return;
    },
    getDetailText: function(id) { const d = window.poly3dList.find(a => a.id === id); return d ? (d.detailText || '') : ''; },
    onClearScene: function() { this.cancelInteractivePlacing(); window.poly3dList.forEach(data => { if(data.anchorObj && data.anchorObj.parent) data.anchorObj.parent.remove(data.anchorObj); if(data.svgGroup) data.svgGroup.remove(); if (data.svgGrad) data.svgGrad.remove(); });
    window.poly3dList = []; this.selectedId = null; this.isDrawing = false; this.activeData = null; this._bumpRegionVersion(); this._rebuildRegionState(); }, onSaveItemData: function(context) { const polys = this.extractSaveData(context.obj);
    if (polys.length > 0) context.itemData.polygon3ds = polys; }, onSaveGroundData: function(context) { const polys = this.extractSaveData(context.obj); if (polys.length > 0) context.sceneData.groundPolygon3ds = polys; },
    extractSaveData: function(obj) { const polyData = []; if (!obj) return polyData; 
    obj.updateMatrixWorld(true);
    obj.traverse(c => { if(c.name && c.name.startsWith('poly3d_')) {
    const d = window.poly3dList.find(a => a.id === c.name); if(d) { 
    // 【绝对降维打击】：必须将锚点坐标、所有边缘点坐标、法线方向，统统从“深层网格(c.parent)”转换为“根节点(obj)”的局部空间！
    const wPos = new THREE.Vector3(); c.getWorldPosition(wPos);
    const anchorLocalPos = wPos.clone(); obj.worldToLocal(anchorLocalPos);
    let norm = [0,1,0]; if(c.userData.localNormal) { const worldNorm = c.userData.localNormal.clone().transformDirection(c.parent.matrixWorld).normalize(); const objInvMat = new THREE.Matrix4().copy(obj.matrixWorld).invert(); const rootLocalNorm = worldNorm.transformDirection(objInvMat).normalize(); norm = [parseFloat(rootLocalNorm.x.toFixed(3)), parseFloat(rootLocalNorm.y.toFixed(3)), parseFloat(rootLocalNorm.z.toFixed(3))]; }
    const ptsArray = d.points.map(p => { const ptWorld = p.localPos.clone().applyMatrix4(c.parent.matrixWorld); obj.worldToLocal(ptWorld);
    const out = [parseFloat(ptWorld.x.toFixed(4)), parseFloat(ptWorld.y.toFixed(4)), parseFloat(ptWorld.z.toFixed(4))];
    if (p.localNormal) { const worldNorm = p.localNormal.clone().transformDirection(c.parent.matrixWorld).normalize(); const objInvMatN = new THREE.Matrix4().copy(obj.matrixWorld).invert(); const objLocalNorm = worldNorm.transformDirection(objInvMatN).normalize();
    out.push(parseFloat(objLocalNorm.x.toFixed(4)), parseFloat(objLocalNorm.y.toFixed(4)), parseFloat(objLocalNorm.z.toFixed(4))); }
    return out; });
    polyData.push({ id: d.id, color: d.color, detailText: d.detailText != null ? String(d.detailText) : '', localPos: [parseFloat(anchorLocalPos.x.toFixed(4)), parseFloat(anchorLocalPos.y.toFixed(4)), parseFloat(anchorLocalPos.z.toFixed(4))], localNormal: norm, points: ptsArray });
    } } }); return polyData; },
    onLoadItem: function(ctx) { if(ctx.itemData.polygon3ds) this.restorePolygons(ctx.obj, ctx.itemData.polygon3ds); }, onLoadGround: function(ctx) {
    if(ctx.sceneData.groundPolygon3ds) this.restorePolygons(ctx.obj, ctx.sceneData.groundPolygon3ds); }, restorePolygons: function(obj, polys) { 
    if(!polys || polys.length === 0) { return; } 
    this.ensureDOM(); obj.updateMatrixWorld(true); // 【关键修正】：强制更新模型矩阵，防止异步加载导致坐标投影失败
    polys.forEach(a => { window.poly3dCounter++;
    const anchor = new THREE.Object3D(); anchor.position.set(a.localPos[0], a.localPos[1], a.localPos[2]); anchor.name = a.id;
    anchor.userData.localNormal = a.localNormal ? new THREE.Vector3(a.localNormal[0], a.localNormal[1], a.localNormal[2]) : new THREE.Vector3(0,1,0); obj.add(anchor);
    const pts = a.points.map(p => ({ localPos: new THREE.Vector3(p[0], p[1], p[2]), localNormal: (p.length >= 6 ? new THREE.Vector3(p[3], p[4], p[5]).normalize() : null) }));
    const data = { id: a.id, anchorObj: anchor, color: a.color || '#2ecc71', detailText: a.detailText != null ? String(a.detailText) : '', points: pts, isOccluded: false, isFinished: true };
    window.poly3dList.push(data); this.buildDOM(data); }); this._bumpRegionVersion();
    window.needsUpdate = true; window.lightMoved = true; }, onDrawSnapshot: function(context) { if (!window.poly3dList) return; const ctx = context.ctx, rect = context.rect; const scaleX = 256 / rect.width, scaleY = 256 / rect.height;
    window.poly3dList.forEach(data => { if (data.isOccluded || !data.sPointsStr) return; const ptsArray = data.sPointsStr.trim().split(' '); if (ptsArray.length < 3) return; ctx.beginPath();
    ptsArray.forEach((ptStr, i) => { const [sx, sy] = ptStr.split(',').map(parseFloat); const tx = (sx - rect.left) * scaleX; const ty = (sy - rect.top) * scaleY;
    if (i === 0) ctx.moveTo(tx, ty); else ctx.lineTo(tx, ty); }); ctx.closePath(); // 截屏严格还原叠加算法 (使用 Canvas 全局合成模式)
    if (!data.isOccluded) { if (_poly3dIosLike) { ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = data.color; ctx.globalAlpha = 0.18; ctx.fill(); ctx.globalCompositeOperation = 'soft-light'; ctx.globalAlpha = 0.88; ctx.fill(); } else { ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = data.color; ctx.globalAlpha = 0.25; ctx.fill(); ctx.globalCompositeOperation = 'color'; ctx.globalAlpha = 1.0; ctx.fill(); } }
    // 【截屏同步对齐】：当转到背面遮挡时，直接彻底跳过渲染，不再绘制多余的实色和虚线
    ctx.globalCompositeOperation = 'source-over'; // 还原全局合成模式
    ctx.globalCompositeOperation = 'source-over'; // 还原全局合成模式
    });
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    } }; window.addEventListener('keydown', e => { if (e.key === 'Delete' || e.key === 'Backspace') {
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return; const id = window.Polygon3DManager.selectedId; if (id !== null) { const idx = window.poly3dList.findIndex(a => a.id === id);
    if (idx > -1) { const data = window.poly3dList[idx]; if(data.anchorObj && data.anchorObj.parent) data.anchorObj.parent.remove(data.anchorObj); if(data.svgGroup) data.svgGroup.remove(); if (data.svgGrad) data.svgGrad.remove(); window.poly3dList.splice(idx, 1); window.Polygon3DManager._bumpRegionVersion();
    window.needsUpdate = true; window.lightMoved = true; }
    window.Polygon3DManager.selectedId = null; } } }); if (window.PluginManager) window.PluginManager.register('Polygon3D_UI', window.Polygon3DManager);