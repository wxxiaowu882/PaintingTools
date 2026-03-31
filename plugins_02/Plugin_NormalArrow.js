import * as THREE from 'three';

window.normArrowList = [];
window.normArrowCounter = 0;

window.NormalArrowManager = {
        selectedId: null,

        onSceneHit: function(context) {
            if (context.event.shiftKey) return; // 属于引线的操作，忽略
            this.createNormalArrow(context.targetObj, context.hitPoint, context.worldNormal);
        },

        // 【生命周期】：接管场景清理 (Core.Memory) 解决新建场景僵尸数据卡死 Bug
        onClearScene: function() {
            if (!window.normArrowList) return;
            window.normArrowList.forEach(data => {
                if(data.anchorObj && data.anchorObj.parent) data.anchorObj.parent.remove(data.anchorObj);
                if(data.svgGlowPath) data.svgGlowPath.remove(); if(data.svgPath) data.svgPath.remove(); if(data.svgHitPath) data.svgHitPath.remove();
                if(data.svgFace1) data.svgFace1.remove(); if(data.svgFace2) data.svgFace2.remove(); if(data.svgFace3) data.svgFace3.remove();
            });
            window.normArrowList = []; this.selectedId = null;
        },

        // 【数据流生命周期】：接管 JSON 反序列化读取 (Core.IO)
        onLoadItem: function(ctx) { if(ctx.itemData.normalArrows || ctx.itemData.normArrows) this.restoreNormalArrows(ctx.obj, ctx.itemData.normalArrows || ctx.itemData.normArrows); },
        onLoadGround: function(ctx) { if(ctx.sceneData.groundNormArrows) this.restoreNormalArrows(ctx.obj, ctx.sceneData.groundNormArrows); },

        // 【数据流生命周期】：接管 JSON 序列化写入 (Core.IO) 与缩略图绘制
        onSaveItemData: function(context) { 
            const arrows = this.extractSaveData(context.obj);
            if (arrows.length > 0) context.itemData.normalArrows = arrows;
        },
        onSaveGroundData: function(context) { 
            const arrows = this.extractSaveData(context.obj);
            if (arrows.length > 0) context.sceneData.groundNormArrows = arrows;
        },
        extractSaveData: function(obj) {
            const normalArrows = [];
            if (!obj || !obj.children) return normalArrows;
            obj.children.forEach(c => { 
                if(c.name && c.name.startsWith('norm_arrow_')) { 
                    const nData = window.normArrowList.find(a => a.id === c.name); 
                    if(nData) { 
                        let norm = [0,1,0]; 
                        if(c.userData.localNormal) norm = [parseFloat(c.userData.localNormal.x.toFixed(3)), parseFloat(c.userData.localNormal.y.toFixed(3)), parseFloat(c.userData.localNormal.z.toFixed(3))]; 
                        normalArrows.push({ id: nData.id, color: nData.color, localPos: [parseFloat(c.position.x.toFixed(4)), parseFloat(c.position.y.toFixed(4)), parseFloat(c.position.z.toFixed(4))], localNormal: norm, baseDist: nData.baseDist, baseScale: nData.baseScale }); 
                    } 
                } 
            });
            return normalArrows;
        },
        onDrawSnapshot: function(context) {
            if (!window.normArrowList) return;
            const ctx = context.ctx, rect = context.rect;
            const scaleX = 256 / rect.width, scaleY = 256 / rect.height;
            window.normArrowList.forEach(data => {
                if (data.isBehind || data.isOccluded) return;
                if (!data.sStart || !data.sBase || !data.sEnd || !data.sP1 || !data.sP2 || !data.sP3) return;
                const mapPt = (pt) => ({ x: (pt.x - rect.left) * scaleX, y: (pt.y - rect.top) * scaleY });
                const sStart = mapPt(data.sStart), sBase = mapPt(data.sBase), sEnd = mapPt(data.sEnd);
                const sP1 = mapPt(data.sP1), sP2 = mapPt(data.sP2), sP3 = mapPt(data.sP3);
                
                ctx.strokeStyle = data.color; ctx.lineWidth = 2.5; 
                ctx.beginPath(); ctx.moveTo(sStart.x, sStart.y); ctx.lineTo(sBase.x, sBase.y); ctx.stroke();

                const drawFacet = (pA, pB, pC, fillStyle) => {
                    const cross = (pB.x - pA.x) * (pC.y - pA.y) - (pB.y - pA.y) * (pC.x - pA.x);
                    if (cross > 0) {
                        ctx.fillStyle = fillStyle; ctx.strokeStyle = fillStyle; ctx.lineWidth = 1.0; ctx.lineJoin = 'round';
                        ctx.beginPath(); ctx.moveTo(pA.x, pA.y); ctx.lineTo(pB.x, pB.y); ctx.lineTo(pC.x, pC.y); ctx.closePath();
                        ctx.fill(); ctx.stroke();
                    }
                };
                drawFacet(sEnd, sP1, sP2, window.NormalArrowManager.lightenColor(data.color, 0.2));
                drawFacet(sEnd, sP2, sP3, window.NormalArrowManager.darkenColor(data.color, 0.2));
                drawFacet(sEnd, sP3, sP1, window.NormalArrowManager.darkenColor(data.color, 0.5));
            });
        },

        ensureDOM: function() {
        if (!document.getElementById('norm-arrow-layer')) {
            const layer = document.createElement('div');
            layer.id = 'norm-arrow-layer';
            // z-index: 49 保证它在引线(z-index: 50)的下方，且不阻挡全局点击
            layer.style.cssText = 'position: absolute; top: 0; left: 0; width: 100vw; height: 100vh; pointer-events: none; z-index: 49; overflow: hidden;';
            layer.innerHTML = '<svg id="norm-arrow-svg" style="width: 100%; height: 100%; pointer-events: none;"></svg>';
            document.body.appendChild(layer);
            
            // 独立挂载颜色拾取器的监听（完全解耦模式）
            const colorPicker = document.getElementById('obj-color-picker');
            if (colorPicker) {
                colorPicker.addEventListener('input', e => {
                    const id = this.selectedId;
                    if (id !== null) {
                        const data = window.normArrowList.find(a => a.id === id);
                        if (data) {
                            data.color = e.target.value;
                            if (data.svgPath) data.svgPath.setAttribute("stroke", data.color);
                            // 同步更新立体面的高光和阴影色
                            if (data.svgFace1) {
                                data.svgFace1.setAttribute("fill", window.NormalArrowManager.lightenColor(data.color, 0.2));
                                data.svgFace1.setAttribute("stroke", window.NormalArrowManager.lightenColor(data.color, 0.2));
                            }
                            if (data.svgFace2) {
                                data.svgFace2.setAttribute("fill", window.NormalArrowManager.darkenColor(data.color, 0.2));
                                data.svgFace2.setAttribute("stroke", window.NormalArrowManager.darkenColor(data.color, 0.2));
                            }
                            if (data.svgFace3) {
                                data.svgFace3.setAttribute("fill", window.NormalArrowManager.darkenColor(data.color, 0.5));
                                data.svgFace3.setAttribute("stroke", window.NormalArrowManager.darkenColor(data.color, 0.5));
                            }
                            window.needsUpdate = true;
                        }
                    }
                });
            }
        }
    },

    highlightSelected: function() {
        window.normArrowList.forEach(data => {
            if (data.svgGlowPath) {
                if (this.selectedId === data.id) {
                    data.svgGlowPath.setAttribute("stroke", "#ffffff");
                    data.svgGlowPath.setAttribute("opacity", "0.6");
                } else {
                    data.svgGlowPath.setAttribute("opacity", "0");
                }
            }
        });
        // 同步 UI 颜色拾取器
        if (this.selectedId !== null) {
            const data = window.normArrowList.find(a => a.id === this.selectedId);
            const picker = document.getElementById('obj-color-picker');
            if (data && picker) picker.value = data.color;
        }
    },
    lightenColor: function(hex, percent) {
        try {
            if (!hex || !hex.startsWith('#')) return hex;
            let r = parseInt(hex.slice(1, 3), 16); let g = parseInt(hex.slice(3, 5), 16); let b = parseInt(hex.slice(5, 7), 16);
            r = Math.min(255, Math.floor(r + (255 - r) * percent));
            g = Math.min(255, Math.floor(g + (255 - g) * percent));
            b = Math.min(255, Math.floor(b + (255 - b) * percent));
            const toHex = (c) => c.toString(16).padStart(2, '0');
            return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
        } catch(e) { return hex; }
    },
    // 将 16 进制颜色变暗（percent: 0-1）
    darkenColor: function(hex, percent) {
        try {
            if (!hex || !hex.startsWith('#')) return hex;
            let r = parseInt(hex.slice(1, 3), 16);
            let g = parseInt(hex.slice(3, 5), 16);
            let b = parseInt(hex.slice(5, 7), 16);
            r = Math.floor(r * (1 - percent));
            g = Math.floor(g * (1 - percent));
            b = Math.floor(b * (1 - percent));
            const toHex = (c) => c.toString(16).padStart(2, '0');
            return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
        } catch(e) { return hex; }
    },

    createNormalArrow: function(targetObj, worldPoint, worldNormal) {
        try {
            this.ensureDOM();
            window.normArrowCounter++;
            const id = 'norm_arrow_' + Date.now() + '_' + window.normArrowCounter;
            const anchor = new THREE.Object3D();
            targetObj.worldToLocal(anchor.position.copy(worldPoint));
            anchor.name = id;

            if (worldNormal) {
                const localNormalPt = targetObj.worldToLocal(worldPoint.clone().add(worldNormal));
                anchor.userData.localNormal = localNormalPt.sub(anchor.position).normalize();
            } else {
                anchor.userData.localNormal = new THREE.Vector3(0,1,0);
            }
            targetObj.add(anchor);

            const color = document.getElementById('obj-color-picker')?.value || '#fdcb6e';
            const arrowData = { id: id, targetUUID: targetObj.uuid, anchorObj: anchor, color: color, isOccluded: false };
            window.normArrowList.push(arrowData);

            this.buildDOM(arrowData);
            window.needsUpdate = true; window.lightMoved = true;
            this.selectedId = id;
            this.highlightSelected();
        } catch(e) { console.error(e); }
    },

    buildDOM: function(data) {
        const svg = document.getElementById('norm-arrow-svg');
        const ns = "http://www.w3.org/2000/svg";

        // 选择发光层
        const glowPath = document.createElementNS(ns, "path");
        glowPath.setAttribute("fill", "none"); glowPath.setAttribute("stroke", "#ffffff");
        glowPath.setAttribute("stroke-width", "6"); glowPath.setAttribute("opacity", "0");
        svg.appendChild(glowPath); data.svgGlowPath = glowPath;

        // 实体线
        const path = document.createElementNS(ns, "path");
        path.setAttribute("fill", "none"); path.setAttribute("stroke", data.color);
        path.setAttribute("stroke-width", "2.5");
        svg.appendChild(path); data.svgPath = path;

        // 3D立体箭头头部：三个面
        const face1 = document.createElementNS(ns, "polygon");
        face1.setAttribute("fill", this.lightenColor(data.color, 0.2));
        face1.setAttribute("stroke", this.lightenColor(data.color, 0.2)); // 防止面与面之间有缝隙
        face1.setAttribute("stroke-width", "1");
        face1.setAttribute("stroke-linejoin", "round");
        svg.appendChild(face1); data.svgFace1 = face1;

        const face2 = document.createElementNS(ns, "polygon");
        face2.setAttribute("fill", this.darkenColor(data.color, 0.2));
        face2.setAttribute("stroke", this.darkenColor(data.color, 0.2));
        face2.setAttribute("stroke-width", "1");
        face2.setAttribute("stroke-linejoin", "round");
        svg.appendChild(face2); data.svgFace2 = face2;

        const face3 = document.createElementNS(ns, "polygon");
        face3.setAttribute("fill", this.darkenColor(data.color, 0.5));
        face3.setAttribute("stroke", this.darkenColor(data.color, 0.5));
        face3.setAttribute("stroke-width", "1");
        face3.setAttribute("stroke-linejoin", "round");
        svg.appendChild(face3); data.svgFace3 = face3;

        // 隐形加宽点击判定层
        const hitPath = document.createElementNS(ns, "path");
        hitPath.setAttribute("fill", "none"); hitPath.setAttribute("stroke", "transparent");
        hitPath.setAttribute("stroke-width", "15");
        
        svg.appendChild(hitPath); data.svgHitPath = hitPath;

        // 【核心修复】：让线段和所有的 3D 箭头面片都支持被点击选中，彻底解除模式拦截
        [hitPath, face1, face2, face3].forEach(el => {
            if(!el) return;
            el.style.pointerEvents = "auto"; 
            el.style.cursor = "pointer";
            el.addEventListener('pointerdown', e => {
                e.stopPropagation();
                // 取消引线的选中，实现标注排他性高亮互斥
                if (window.AnnotationManager) {
                    window.AnnotationManager.selectedId = null;
                    window.AnnotationManager.highlightSelected();
                }
                window.NormalArrowManager.selectedId = data.id;
                window.NormalArrowManager.highlightSelected();
            });
            el.addEventListener('click', e => e.stopPropagation());
        });
    },

    updateScreenPositions: function(camera) {
        if(window.normArrowList.length === 0) return;
        
        // 【工业级性能优化】：懒加载全局向量池，实现零分配 (Zero Allocation)，彻底消除内存泄漏
        if (!this._poolInit) {
            this._tempV = new THREE.Vector3(); this._endV = new THREE.Vector3(); this._baseCenterV = new THREE.Vector3();
            this._upV = new THREE.Vector3(); this._uV = new THREE.Vector3(); this._vV = new THREE.Vector3();
            this._p1V = new THREE.Vector3(); this._p2V = new THREE.Vector3(); this._p3V = new THREE.Vector3();
            this._scratchV = new THREE.Vector3(); this._normalMatrix = new THREE.Matrix3(); 
            this._viewDir = new THREE.Vector3(); this._currentWorldNormal = new THREE.Vector3();
            this._sStart = {x:0, y:0, isBehind:false}; this._sEnd = {x:0, y:0, isBehind:false}; this._sBase = {x:0, y:0, isBehind:false};
            this._sP1 = {x:0, y:0, isBehind:false}; this._sP2 = {x:0, y:0, isBehind:false}; this._sP3 = {x:0, y:0, isBehind:false};
            this._poolInit = true;
        }

        const toScreenCoord = (wV, sObj) => {
            this._scratchV.copy(wV).project(camera);
            sObj.x = (this._scratchV.x * 0.5 + 0.5) * window.innerWidth;
            sObj.y = (-(this._scratchV.y * 0.5) + 0.5) * window.innerHeight;
            sObj.isBehind = this._scratchV.z > 1.0 || this._scratchV.z < -1.0;
        };

        window.normArrowList.forEach(data => {
            if(!data.anchorObj) return;
            data.anchorObj.getWorldPosition(this._tempV);

            const dist = camera.position.distanceTo(this._tempV);
            const safeDist = Math.max(dist, 0.1); 
            const modelScaleX = data.anchorObj.parent ? data.anchorObj.parent.scale.x : 1;

            if (!data.baseDist) {
                // 惰性初始化：在创建瞬间，记录初始距离与缩放，计算出它的终身“物理基因”
                data.baseDist = safeDist;
                data.baseScale = modelScaleX;
            }

            // 【法线专属逻辑：全 3D 物理缩放】
            // 物理基准尺寸 = 初始距离 * 视觉比例系数 (0.04)。距离越远创建，造得越大，以保证新建时屏幕上看起来大小绝对一致！
            const physicalBaseSize = data.baseDist * 0.04;
            // 真实的 3D 物理尺寸（从此完全跟死模型同比例缩放）
            const currentWorldSize = physicalBaseSize * (modelScaleX / data.baseScale);

            const arrowWorldLen = 3.5 * currentWorldSize;
            const headLenWorld = 1.2 * currentWorldSize;
            const headWidthWorld = 0.4 * currentWorldSize;

            if (data.anchorObj.parent && data.anchorObj.userData.localNormal) {
                this._normalMatrix.getNormalMatrix(data.anchorObj.parent.matrixWorld);
                this._currentWorldNormal.copy(data.anchorObj.userData.localNormal).applyMatrix3(this._normalMatrix).normalize();
                this._viewDir.copy(camera.position).sub(this._tempV).normalize();
                data.isOccluded = this._currentWorldNormal.dot(this._viewDir) < -0.05;
            } else { 
                data.isOccluded = false; this._currentWorldNormal.set(0,1,0); 
            }

            this._endV.copy(this._tempV).addScaledVector(this._currentWorldNormal, arrowWorldLen);
            this._baseCenterV.copy(this._endV).addScaledVector(this._currentWorldNormal, -headLenWorld);

            if (Math.abs(this._currentWorldNormal.y) > 0.5) { this._upV.set(1, 0, 0); } else { this._upV.set(0, 1, 0); }
            this._uV.crossVectors(this._currentWorldNormal, this._upV).normalize();
            this._vV.crossVectors(this._uV, this._currentWorldNormal).normalize();

            this._p1V.copy(this._baseCenterV).addScaledVector(this._uV, headWidthWorld);
            this._scratchV.copy(this._uV).multiplyScalar(-0.5).addScaledVector(this._vV, 0.866);
            this._p2V.copy(this._baseCenterV).addScaledVector(this._scratchV, headWidthWorld);
            this._scratchV.copy(this._uV).multiplyScalar(-0.5).addScaledVector(this._vV, -0.866);
            this._p3V.copy(this._baseCenterV).addScaledVector(this._scratchV, headWidthWorld);

            toScreenCoord(this._tempV, this._sStart); toScreenCoord(this._endV, this._sEnd); toScreenCoord(this._baseCenterV, this._sBase);
            toScreenCoord(this._p1V, this._sP1); toScreenCoord(this._p2V, this._sP2); toScreenCoord(this._p3V, this._sP3);

            // 缓存给截屏系统使用，防止对象逃逸
            data.sStart = {x:this._sStart.x, y:this._sStart.y}; data.sEnd = {x:this._sEnd.x, y:this._sEnd.y}; data.sBase = {x:this._sBase.x, y:this._sBase.y};
            data.sP1 = {x:this._sP1.x, y:this._sP1.y}; data.sP2 = {x:this._sP2.x, y:this._sP2.y}; data.sP3 = {x:this._sP3.x, y:this._sP3.y};

            if (this._sEnd.isBehind) data.isOccluded = true;
            const canHit = (this._sStart.isBehind || data.isOccluded) ? 'none' : 'auto';
            if (data.svgHitPath) data.svgHitPath.style.pointerEvents = canHit;
            if (data.svgFace1) data.svgFace1.style.pointerEvents = canHit;
            if (data.svgFace2) data.svgFace2.style.pointerEvents = canHit;
            if (data.svgFace3) data.svgFace3.style.pointerEvents = canHit;

            // 【防报错卡死机制】：必须判断 NaN 确保 SVG 引擎不会死锁崩溃
            if (!this._sStart.isBehind && !data.isOccluded && !isNaN(this._sStart.x) && !isNaN(this._sEnd.x)) {
                const dStr = `M ${this._sStart.x} ${this._sStart.y} L ${this._sBase.x} ${this._sBase.y}`;
                if(data.svgGlowPath) data.svgGlowPath.setAttribute("d", dStr);
                if(data.svgPath) data.svgPath.setAttribute("d", dStr);
                if(data.svgHitPath) data.svgHitPath.setAttribute("d", dStr);

                const drawFacet = (polyEl, pA, pB, pC) => {
                    if (!polyEl) return;
                    const cross = (pB.x - pA.x) * (pC.y - pA.y) - (pB.y - pA.y) * (pC.x - pA.x);
                    if (cross > 0) { 
                        polyEl.setAttribute("points", `${pA.x},${pA.y} ${pB.x},${pB.y} ${pC.x},${pC.y}`);
                        polyEl.setAttribute("opacity", "0.95");
                    } else { polyEl.setAttribute("opacity", "0"); }
                };
                drawFacet(data.svgFace1, this._sEnd, this._sP1, this._sP2);
                drawFacet(data.svgFace2, this._sEnd, this._sP2, this._sP3);
                drawFacet(data.svgFace3, this._sEnd, this._sP3, this._sP1);
                if(data.svgPath) data.svgPath.setAttribute("opacity", "0.9");
            } else {
                if(data.svgGlowPath) data.svgGlowPath.setAttribute("d", "");
                if(data.svgPath) data.svgPath.setAttribute("opacity", "0");
                if(data.svgHitPath) data.svgHitPath.setAttribute("d", "");
                if(data.svgFace1) data.svgFace1.setAttribute("opacity", "0");
                if(data.svgFace2) data.svgFace2.setAttribute("opacity", "0");
                if(data.svgFace3) data.svgFace3.setAttribute("opacity", "0");
            }
        });
    },

    clearAll: function() {
        window.normArrowList.forEach(data => {
            if(data.anchorObj && data.anchorObj.parent) data.anchorObj.parent.remove(data.anchorObj);
        });
        window.normArrowList = [];
        const svg = document.getElementById('norm-arrow-svg');
        if(svg) svg.innerHTML = '';
        this.selectedId = null;
    },

    // 【新增】：增加别名，完美兼容消费端的读取指令
    restoreNormalArrows: function(obj, arrows) { this.restoreArrows(obj, arrows); },

    restoreArrows: function(obj, arrows) {
        if(!arrows) return;
        this.ensureDOM();
        arrows.forEach(a => {
            window.normArrowCounter++;
            const anchor = new THREE.Object3D();
            anchor.position.set(a.localPos[0], a.localPos[1], a.localPos[2]);
            anchor.name = a.id;
            anchor.userData.localNormal = a.localNormal ? new THREE.Vector3(a.localNormal[0], a.localNormal[1], a.localNormal[2]) : new THREE.Vector3(0,1,0);
            obj.add(anchor);
            
            const arrowData = { id: a.id, targetUUID: obj.uuid, anchorObj: anchor, color: a.color || '#fdcb6e', isOccluded: false };
            if(a.baseDist) arrowData.baseDist = a.baseDist;
            if(a.baseScale) arrowData.baseScale = a.baseScale;
            
            window.normArrowList.push(arrowData);
            this.buildDOM(arrowData);
        });
    }
};

// 独立监听 Delete 键删除功能
window.addEventListener('keydown', e => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
        if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
        const id = window.NormalArrowManager.selectedId;
        if (id !== null) {
            const idx = window.normArrowList.findIndex(a => a.id === id);
            if (idx > -1) {
                const data = window.normArrowList[idx];
                if(data.anchorObj && data.anchorObj.parent) data.anchorObj.parent.remove(data.anchorObj);
                if(data.svgGlowPath) data.svgGlowPath.remove();
                if(data.svgPath) data.svgPath.remove();
                if(data.svgHitPath) data.svgHitPath.remove();
                if(data.svgFace1) data.svgFace1.remove();
                if(data.svgFace2) data.svgFace2.remove();
                if(data.svgFace3) data.svgFace3.remove();
                window.normArrowList.splice(idx, 1);
                window.needsUpdate = true; window.lightMoved = true;
            }
            window.NormalArrowManager.selectedId = null;
        }
    }
});

// 注册标准插件挂载
window.NormalArrowManager.onUpdate = function(context) {
    if (window.showAnnotations !== false && context.camera) {
        this.updateScreenPositions(context.camera);
        const layer = document.getElementById('norm-arrow-layer');
        if (layer) layer.style.display = 'block';
    } else {
        const layer = document.getElementById('norm-arrow-layer');
        if (layer) layer.style.display = 'none';
    }
};

if (window.PluginManager) window.PluginManager.register('NormalArrow_UI', window.NormalArrowManager);