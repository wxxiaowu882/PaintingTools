import * as THREE from 'three';

window.proberList = [];
window.proberCounter = 0;

window.ProberManager = {
    selectedId: null,

    getToneData: function(angle) {
        if (angle <= 20) return { text: `夹角 ${angle.toFixed(0)}°【亮面/高光】`, color: '#ffffff', bg: 'rgba(15,15,20,0.9)' };
        if (angle <= 75) return { text: `夹角 ${angle.toFixed(0)}°【灰面/侧受光】`, color: '#dddddd', bg: 'rgba(15,15,20,0.9)' };
        if (angle <= 100) return { text: `夹角 ${angle.toFixed(0)}°【明暗交界线】`, color: '#ff3333', bg: 'rgba(50,10,10,0.95)' };
        return { text: `夹角 ${angle.toFixed(0)}°【暗部/背光区】`, color: '#66ccff', bg: 'rgba(10,20,35,0.9)' }; 
    },

    calcArrow: function(px, py, pz, dirX, dirY, dirZ, rayLen, isRefl) {
        const tipDist = isRefl ? rayLen * 0.9 : rayLen * 0.4;
        const baseDist = isRefl ? rayLen * 0.7 : rayLen * 0.6;
        const tip = new THREE.Vector3(px + dirX*tipDist, py + dirY*tipDist, pz + dirZ*tipDist);
        const base = new THREE.Vector3(px + dirX*baseDist, py + dirY*baseDist, pz + dirZ*baseDist);
        const hw = rayLen * 0.05;

        const adx = isRefl ? dirX : -dirX; const ady = isRefl ? dirY : -dirY; const adz = isRefl ? dirZ : -dirZ;
        let up = Math.abs(ady) > 0.5 ? [1, 0, 0] : [0, 1, 0];
        let ux = ady*up[2] - adz*up[1], uy = adz*up[0] - adx*up[2], uz = adx*up[1] - ady*up[0];
        let uLen = Math.hypot(ux, uy, uz);
        if(uLen < 0.0001){ ux=1; uy=0; uz=0; uLen=1; }
        ux/=uLen; uy/=uLen; uz/=uLen;
        let vx = uy*adz - uz*ady, vy = uz*adx - ux*adz, vz = ux*ady - uy*adx;

        const p1 = new THREE.Vector3(base.x + hw*ux, base.y + hw*uy, base.z + hw*uz);
        const p2 = new THREE.Vector3(base.x + hw*(-0.5*ux + 0.866*vx), base.y + hw*(-0.5*uy + 0.866*vy), base.z + hw*(-0.5*uz + 0.866*vz));
        const p3 = new THREE.Vector3(base.x + hw*(-0.5*ux - 0.866*vx), base.y + hw*(-0.5*uy - 0.866*vy), base.z + hw*(-0.5*uz - 0.866*vz));

        return { tip, p1, p2, p3 };
    },

    initLayer: function() {
        let layer = document.getElementById('prober-html-layer');
        if (!layer) {
            layer = document.createElement('div');
            layer.id = 'prober-html-layer';
            layer.style.position = 'absolute'; layer.style.top = '0'; layer.style.left = '0';
            layer.style.width = '100vw'; layer.style.height = '100vh';
            layer.style.pointerEvents = 'none'; layer.style.zIndex = '40'; // 【修复】：降低主层级，严格沉入控制面板(100)之下
            document.body.appendChild(layer);
        }

        let svgLayer = document.getElementById('prober-svg-layer');
        if (!svgLayer) {
            svgLayer = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svgLayer.id = 'prober-svg-layer';
            svgLayer.style.position = 'absolute'; svgLayer.style.top = '0'; svgLayer.style.left = '0';
            svgLayer.style.width = '100%'; svgLayer.style.height = '100%';
            svgLayer.style.pointerEvents = 'none';
            layer.appendChild(svgLayer);
        }
        this.layer = layer; this.svgLayer = svgLayer;

        if (!this._colorPickerBound) {
            const colorPicker = document.getElementById('obj-color-picker');
            if (colorPicker) {
                colorPicker.addEventListener('input', e => {
                    const id = this.selectedId;
                    if (id !== null) {
                        const data = window.proberList.find(a => a.id === id);
                        if (data) { data.color = e.target.value; window.needsUpdate = true; }
                    }
                });
            }
            this._colorPickerBound = true;
        }
    },

    buildDOM: function(data) {
        if (!this.layer) this.initLayer();

        const label = document.createElement('div');
        label.className = 'prober-label';
        label.style.position = 'absolute'; label.style.transform = 'translate(18px, -12px)'; 
        label.style.padding = '4px 8px'; label.style.fontSize = '11px'; label.style.fontWeight = 'bold';
        label.style.whiteSpace = 'nowrap'; label.style.boxShadow = '0 4px 10px rgba(0,0,0,0.5)';
        label.style.pointerEvents = 'auto'; label.style.transition = 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)';
        label.style.cursor = 'pointer';
        label.style.outline = 'none'; // 去掉输入时的外发光框
        label.innerText = data.text;
        
        label.addEventListener('pointerdown', e => {
            if (window.AnnotationManager) window.AnnotationManager.selectedId = null;
            if (window.NormalArrowManager) window.NormalArrowManager.selectedId = null;
            if (window.Polygon3DManager) window.Polygon3DManager.selectedId = null;
            this.selectedId = data.id;
            this.highlightSelected();
            e.stopPropagation();
        });

        // 【核心交互】：双击进入编辑模式
        label.addEventListener('dblclick', e => {
            e.stopPropagation();
            label.contentEditable = "true";
            label.focus();
            label.style.cursor = 'text';
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(label);
            selection.removeAllRanges();
            selection.addRange(range);
        });

        // 【核心交互】：失去焦点时保存文本
        label.addEventListener('blur', e => {
            label.contentEditable = "false";
            label.style.cursor = 'pointer';
            const newText = label.innerText.trim();
            if (newText === '') {
                data.isCustomText = false; // 用户清空了，自动恢复托管状态
            } else {
                data.text = newText;
                data.isCustomText = true;  // 锁定用户自定义文本
            }
            window.needsUpdate = true;
        });

        // 【核心交互】：打字按回车保存，并阻拦所有的快捷键冲突
        label.addEventListener('keydown', e => {
            e.stopPropagation();
            if (e.key === 'Enter') {
                e.preventDefault();
                label.blur();
            }
        });

        this.layer.appendChild(label);

        const svgGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        svgGroup.style.transition = 'opacity 0.2s';
        this.svgLayer.appendChild(svgGroup);

        data.dom = { label, svgGroup };
    },

    highlightSelected: function() {
        window.proberList.forEach(data => {
            if (data.dom && data.dom.label) {
                if (this.selectedId === data.id) {
                    data.dom.label.style.transform = 'translate(18px, -12px) scale(1.15)';
                    data.dom.label.style.boxShadow = `0 0 15px ${data.toneColor || '#fff'}, 0 4px 10px rgba(0,0,0,0.5)`;
                    data.dom.label.style.zIndex = '50'; // 【修复】：选中状态下浮起，但依然低于控制面板
                } else {
                    data.dom.label.style.transform = 'translate(18px, -12px) scale(1)';
                    data.dom.label.style.boxShadow = '0 4px 10px rgba(0,0,0,0.5)';
                    data.dom.label.style.zIndex = '40'; // 【修复】：未选中状态恢复基础层级
                }
            }
        });
        if (this.selectedId !== null) {
            const data = window.proberList.find(a => a.id === this.selectedId);
            const picker = document.getElementById('obj-color-picker');
            if (data && picker) picker.value = data.color;
        }
    },

    onSceneHit: function(context) {
        if (window.PluginManager.State.currentMode !== 'prober') return;

        let finalNx = context.worldNormal.x, finalNy = context.worldNormal.y, finalNz = context.worldNormal.z;
        if (context.event && context.event.clientX !== undefined && typeof window.getIntersectFromCoords === 'function') {
            let nxSum = 0, nySum = 0, nzSum = 0, count = 0; const radius = 8;
            const offsets = [[0,0],[-radius,0],[radius,0],[0,-radius],[0,radius],[-radius,-radius],[radius,radius],[-radius,radius],[radius,-radius]];
            for (let [dx, dy] of offsets) {
                const hit = window.getIntersectFromCoords(context.event.clientX + dx, context.event.clientY + dy);
                if (hit && hit.face) { nxSum += hit.face.normal.x; nySum += hit.face.normal.y; nzSum += hit.face.normal.z; count++; }
            }
            if (count > 0) { const len = Math.hypot(nxSum, nySum, nzSum); if (len > 0.0001) { finalNx = nxSum/len; finalNy = nySum/len; finalNz = nzSum/len; } }
        }

        window.proberCounter++;
        const id = 'prober_' + Date.now() + '_' + window.proberCounter;
        
        const anchor = new THREE.Object3D();
        context.targetObj.worldToLocal(anchor.position.copy(context.hitPoint));
        anchor.name = id;
        
        const worldNormVec = new THREE.Vector3(finalNx, finalNy, finalNz);
        const localNormalPt = context.targetObj.worldToLocal(context.hitPoint.clone().add(worldNormVec));
        anchor.userData.localNormal = localNormalPt.sub(anchor.position).normalize();
        
        context.targetObj.add(anchor);

        const probeData = {
            id: id,
            targetUUID: context.targetObj.uuid,
            anchorObj: anchor,
            text: '分析中...',
            isCustomText: false, // 初始化为系统托管状态
            color: document.getElementById('obj-color-picker')?.value || '#00ccff', 
            lastAngleTime: 0,
            displayAngle: 0,
            rayLen: 0,
            isOccluded: false
        };
        
        window.proberList.push(probeData);
        this.buildDOM(probeData);
        
        this.selectedId = id;
        this.highlightSelected();
        window.needsUpdate = true; 
    },

    onUpdate: function(context) {
        // 【适配消费端】：响应右上角的显隐控制
        if (window.showAnnotations === false) {
            if (this.layer) this.layer.style.display = 'none';
            return;
        } else {
            if (this.layer) this.layer.style.display = 'block';
        }

        // --- 【排错日志探针】：实时监控 SVG 绘图层是否脱落 ---
        if (this.svgLayer && this.layer && !this.layer.contains(this.svgLayer)) {
            if (window.hwLog && !this._warnedDrop) {
                window.hwLog("[Prober-Debug] 🚨 抓到元凶！发现 SVG 绘图层从 DOM 树中异常脱落（变成孤儿节点）。这导致所有光影连线被画在了空气中！");
                window.hwLog("[Prober-Debug] 🛠️ 正在执行紧急自动重组修复...");
                this._warnedDrop = true;
            }
            this.layer.appendChild(this.svgLayer); // 紧急补救：重新挂载回 DOM 树
        }

        if (!context.camera || window.proberList.length === 0) return;

        const camera = context.camera;
        const width = window.innerWidth;
        const height = window.innerHeight;

        const azEl = document.getElementById('lightAzimuth');
        const elEl = document.getElementById('lightElevation');
        const azimuth = azEl ? parseFloat(azEl.value) : 113;
        const elevation = elEl ? parseFloat(elEl.value) : 45;

        const phi = (90 - elevation) * (Math.PI / 180);
        const theta = azimuth * (Math.PI / 180);
        const lx = Math.sin(phi) * Math.cos(theta);
        const ly = Math.cos(phi);
        const lz = Math.sin(phi) * Math.sin(theta);

        const now = Date.now();

        if (!this._poolInit) {
            this._tempOrigin = new THREE.Vector3();
            this._currentNormal = new THREE.Vector3();
            this._normalMatrix = new THREE.Matrix3();
            this._poolInit = true;
        }

        const get2D = (v3) => {
            const sp = v3.clone().project(camera);
            return { x: (sp.x * 0.5 + 0.5) * width, y: -(sp.y * 0.5 - 0.5) * height, z: sp.z };
        };

        window.proberList.forEach(p => {
            if (!p.dom || !p.anchorObj) return;

            p.anchorObj.getWorldPosition(this._tempOrigin);
            if (p.anchorObj.parent && p.anchorObj.userData.localNormal) {
                this._normalMatrix.getNormalMatrix(p.anchorObj.parent.matrixWorld);
                this._currentNormal.copy(p.anchorObj.userData.localNormal).applyMatrix3(this._normalMatrix).normalize();
            } else {
                this._currentNormal.set(0, 1, 0);
            }

            if (!p.rayLen) {
                const dist = camera.position.distanceTo(this._tempOrigin);
                p.rayLen = Math.max(dist, 0.1) * 0.16; 
            }
            const rayLen = p.rayLen;

            const viewDir = new THREE.Vector3().subVectors(camera.position, this._tempOrigin).normalize();
            p.isOccluded = this._currentNormal.dot(viewDir) < -0.05;

            const P0 = get2D(this._tempOrigin);
            p.sStart = {x: P0.x, y: P0.y};
            const PN = get2D(new THREE.Vector3(this._tempOrigin.x + this._currentNormal.x*rayLen, this._tempOrigin.y + this._currentNormal.y*rayLen, this._tempOrigin.z + this._currentNormal.z*rayLen));
            p.sEnd = {x: PN.x, y: PN.y};

            if (p.isOccluded) {
                p.dom.label.style.opacity = '0';
                p.dom.label.style.pointerEvents = 'none';
                p.dom.svgGroup.style.opacity = '0';
                return;
            }

            const nx = this._currentNormal.x, ny = this._currentNormal.y, nz = this._currentNormal.z;
            const dotProduct = nx*lx + ny*ly + nz*lz;
            const angle = Math.acos(Math.max(-1, Math.min(1, dotProduct))) * 180 / Math.PI;

            if (now - p.lastAngleTime > 150) {
                p.displayAngle = Math.round(angle);
                p.lastAngleTime = now;
            }

            const tone = this.getToneData(angle);
            p.toneColor = tone.color;
            p.dom.label.style.opacity = '1';
            p.dom.label.style.pointerEvents = 'auto';
            p.dom.label.style.color = tone.color;
            p.dom.label.style.borderLeftColor = tone.color;
            p.dom.label.style.background = tone.bg;

            // 【核心文本托管策略】：如果用户没接管，就自动更新定性文本
            if (!p.isCustomText) {
                p.text = tone.text;
                if (document.activeElement !== p.dom.label) p.dom.label.innerText = p.text;
            } else {
                if (document.activeElement !== p.dom.label && p.dom.label.innerText !== p.text) {
                    p.dom.label.innerText = p.text;
                }
            }

            const PL = get2D(new THREE.Vector3(this._tempOrigin.x + lx*rayLen, this._tempOrigin.y + ly*rayLen, this._tempOrigin.z + lz*rayLen));
            const R = [2*dotProduct*nx - lx, 2*dotProduct*ny - ly, 2*dotProduct*nz - lz];
            const rLen = Math.hypot(R[0], R[1], R[2]);
            if(rLen>0){ R[0]/=rLen; R[1]/=rLen; R[2]/=rLen; }
            const PR = get2D(new THREE.Vector3(this._tempOrigin.x + R[0]*rayLen, this._tempOrigin.y + R[1]*rayLen, this._tempOrigin.z + R[2]*rayLen));

            const arrL = this.calcArrow(this._tempOrigin.x, this._tempOrigin.y, this._tempOrigin.z, lx, ly, lz, rayLen, false);
            const arrR = this.calcArrow(this._tempOrigin.x, this._tempOrigin.y, this._tempOrigin.z, R[0], R[1], R[2], rayLen, true);

            p.dom.label.style.left = `${P0.x}px`;
            p.dom.label.style.top = `${P0.y}px`;

            p.dom.svgGroup.style.opacity = '1';
            let htmlStr = '';

            let sectorPath = null, tx = P0.x, ty = P0.y;
            if (PL && angle > 0.5) {
                const N_vec = new THREE.Vector3(nx, ny, nz).normalize();
                const L_vec = new THREE.Vector3(lx, ly, lz).normalize();
                const dot_val = N_vec.dot(L_vec);
                const V2_vec = new THREE.Vector3().copy(L_vec).sub(N_vec.clone().multiplyScalar(dot_val)).normalize();
                
                const arcRadius = rayLen * 0.45; 
                const numSegments = 16; 
                
                sectorPath = `M ${P0.x} ${P0.y} `;
                
                for(let i=0; i<=numSegments; i++) {
                    const t = (i / numSegments) * (angle * Math.PI / 180);
                    const cosT = Math.cos(t);
                    const sinT = Math.sin(t);
                    
                    const p3d = new THREE.Vector3()
                        .copy(this._tempOrigin)
                        .add(N_vec.clone().multiplyScalar(cosT * arcRadius))
                        .add(V2_vec.clone().multiplyScalar(sinT * arcRadius));
                        
                    const p2d = get2D(p3d);
                    sectorPath += `L ${p2d.x} ${p2d.y} `;
                    
                    if (i === Math.floor(numSegments / 2)) {
                        const text3D = new THREE.Vector3()
                            .copy(this._tempOrigin)
                            .add(N_vec.clone().multiplyScalar(cosT * arcRadius * 1.3))
                            .add(V2_vec.clone().multiplyScalar(sinT * arcRadius * 1.3));
                        const text2D = get2D(text3D);
                        tx = text2D.x;
                        ty = text2D.y;
                    }
                }
                sectorPath += 'Z';
            }

            if (sectorPath) {
                htmlStr += `<path d="${sectorPath}" fill="${tone.color}" opacity="0.5" stroke="none" style="transition: fill 0.2s;" />`;
                htmlStr += `<text x="${tx}" y="${ty}" fill="#ffffff" font-size="10" font-weight="bold" font-family="sans-serif" text-anchor="middle" dominant-baseline="central" style="filter: drop-shadow(0 0 2px rgba(0,0,0,0.9));">${p.displayAngle}°</text>`;
            }

            const drawFacet = (pA, pB, pC, overlayCol, overlayOp, baseColor, alpha) => {
                const cross = (pB.x - pA.x) * (pC.y - pA.y) - (pB.y - pA.y) * (pC.x - pA.x);
                if (cross > 0) {
                    htmlStr += `<polygon points="${pA.x},${pA.y} ${pB.x},${pB.y} ${pC.x},${pC.y}" fill="${baseColor}" opacity="${alpha}" stroke="${baseColor}" stroke-width="1.5" stroke-linejoin="round" />`;
                    if (overlayOp > 0) htmlStr += `<polygon points="${pA.x},${pA.y} ${pB.x},${pB.y} ${pC.x},${pC.y}" fill="${overlayCol}" opacity="${overlayOp * alpha}" />`;
                }
            };
            const draw3DArrow = (tip, p1, p2, p3, baseColor, alpha) => {
                const T = get2D(tip), P1 = get2D(p1), P2 = get2D(p2), P3 = get2D(p3);
                drawFacet(T, P1, P2, '#ffffff', 0.3, baseColor, alpha); drawFacet(T, P2, P3, '#000000', 0.2, baseColor, alpha);
                drawFacet(T, P3, P1, '#000000', 0.5, baseColor, alpha); drawFacet(P1, P3, P2, '#000000', 0.7, baseColor, alpha);
            };

            htmlStr += `<line x1="${P0.x}" y1="${P0.y}" x2="${PN.x}" y2="${PN.y}" stroke="${p.color}" stroke-width="2.5" style="filter: drop-shadow(0 0 2px ${p.color});" />`;
            htmlStr += `<circle cx="${PN.x}" cy="${PN.y}" r="2" fill="${p.color}" />`; 

            const isBacklight = angle > 90;
            const lightAlpha = isBacklight ? 0.15 : 1;
            const filterBlur = isBacklight ? 'none' : 'drop-shadow(0 0 3px #ffaa00)';
            htmlStr += `<line x1="${P0.x}" y1="${P0.y}" x2="${PL.x}" y2="${PL.y}" stroke="#ffcc00" stroke-width="2.5" stroke-dasharray="4,4" opacity="${lightAlpha}" style="filter: ${filterBlur};" />`;
            draw3DArrow(arrL.tip, arrL.p1, arrL.p2, arrL.p3, '#ffcc00', lightAlpha);
            htmlStr += `<circle cx="${PL.x}" cy="${PL.y}" r="3" fill="#ffffff" stroke="#ffcc00" stroke-width="1.5" opacity="${lightAlpha}" />`; 

            if (angle <= 90) {
                htmlStr += `<line x1="${P0.x}" y1="${P0.y}" x2="${PR.x}" y2="${PR.y}" stroke="#88ccff" stroke-width="2" stroke-dasharray="4,4" opacity="0.6" style="filter: drop-shadow(0 0 3px #88ccff);" />`;
                draw3DArrow(arrR.tip, arrR.p1, arrR.p2, arrR.p3, '#88ccff', 0.72);
            }

            htmlStr += `<circle cx="${P0.x}" cy="${P0.y}" r="2.5" fill="#ffffff" />`;

            p.dom.svgGroup.innerHTML = htmlStr;
        });
    },

    extractSaveData: function(obj) {
        const probers = [];
        if (!obj || !obj.children) return probers;
        obj.children.forEach(c => {
            if (c.name && c.name.startsWith('prober_')) {
                const pData = window.proberList.find(a => a.id === c.name);
                if (pData) {
                    let norm = [0,1,0];
                    if (c.userData.localNormal) {
                        norm = [parseFloat(c.userData.localNormal.x.toFixed(3)), parseFloat(c.userData.localNormal.y.toFixed(3)), parseFloat(c.userData.localNormal.z.toFixed(3))];
                    }
                    probers.push({
                        id: pData.id,
                        color: pData.color,
                        text: pData.text, // 序列化自定义文本
                        isCustomText: pData.isCustomText, // 序列化接管状态
                        localPos: [parseFloat(c.position.x.toFixed(4)), parseFloat(c.position.y.toFixed(4)), parseFloat(c.position.z.toFixed(4))],
                        localNormal: norm,
                        rayLen: pData.rayLen
                    });
                }
            }
        });
        return probers;
    },
    onSaveItemData: function(ctx) {
        const p = this.extractSaveData(ctx.obj);
        if (p.length > 0) ctx.itemData.probers = p;
    },
    onSaveGroundData: function(ctx) {
        const p = this.extractSaveData(ctx.obj);
        if (p.length > 0) ctx.sceneData.groundProbers = p;
    },
    restoreProbers: function(obj, probers) {
        if (!probers) return;
        probers.forEach(a => {
            window.proberCounter++;
            const anchor = new THREE.Object3D();
            anchor.position.set(a.localPos[0], a.localPos[1], a.localPos[2]);
            anchor.name = a.id;
            anchor.userData.localNormal = a.localNormal ? new THREE.Vector3(a.localNormal[0], a.localNormal[1], a.localNormal[2]) : new THREE.Vector3(0,1,0);
            obj.add(anchor);
            
            const probeData = {
                id: a.id,
                targetUUID: obj.uuid,
                anchorObj: anchor,
                text: a.text || '分析中...',
                isCustomText: a.isCustomText || false,
                color: a.color || '#00ccff',
                lastAngleTime: 0,
                displayAngle: 0,
                rayLen: a.rayLen || 0,
                isOccluded: false
            };
            window.proberList.push(probeData);
            this.buildDOM(probeData);
        });
    },
    onLoadItem: function(ctx) {
        if (ctx.itemData.probers) {
            const safeData = ctx.itemData.probers.filter(a => !window.proberList.some(exist => exist.id === a.id));
            if (safeData.length > 0) this.restoreProbers(ctx.obj, safeData);
        }
    },
    onLoadGround: function(ctx) {
        if (ctx.sceneData.groundProbers) {
            const safeData = ctx.sceneData.groundProbers.filter(a => !window.proberList.some(exist => exist.id === a.id));
            if (safeData.length > 0) this.restoreProbers(ctx.obj, safeData);
        }
    },

    onDrawSnapshot: function(context) {
        if (!window.proberList) return;
        const ctx = context.ctx, rect = context.rect;
        const scaleX = 256 / rect.width, scaleY = 256 / rect.height;
        
        window.proberList.forEach(data => {
            if (data.isOccluded || !data.sStart || !data.sEnd) return; 

            const mapPt = (pt) => ({ x: (pt.x - rect.left) * scaleX, y: (pt.y - rect.top) * scaleY });
            const sStart = mapPt(data.sStart);
            const sEnd = mapPt(data.sEnd);

            ctx.strokeStyle = data.color || '#00ccff';
            ctx.lineWidth = 2.0;
            ctx.beginPath();
            ctx.moveTo(sStart.x, sStart.y);
            ctx.lineTo(sEnd.x, sEnd.y);
            ctx.stroke();

            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(sStart.x, sStart.y, 2, 0, Math.PI*2);
            ctx.fill();
        });
    },

    onClearScene: function() {
        if (window.hwLog) window.hwLog("[Prober-Debug] 收到 onClearScene 清场指令...");
        
        // 【核心 Bug 修复】：绝对禁止直接使用 this.layer.innerHTML = ''！
        // 暴力清空会导致内部的 svgLayer 被连根拔起并永久销毁！这就是“只显文本，不显图形”的真正原因。
        
        window.proberList.forEach(data => {
            if(data.anchorObj && data.anchorObj.parent) data.anchorObj.parent.remove(data.anchorObj);
            if(data.dom) {
                if (data.dom.label) data.dom.label.remove();
                if (data.dom.svgGroup) data.dom.svgGroup.remove();
            }
        });
        window.proberList = [];
        window.proberCounter = 0;
        this.selectedId = null;
        
        if (window.hwLog) window.hwLog("[Prober-Debug] 清场完毕，已安全移除所有独立探针，成功保全了 SVG 根容器！");
    }
};

// 【核心修复】：更新键盘拦截器，允许在内容编辑模式下自由使用 Backspace/Delete
window.addEventListener('keydown', e => { 
    if (e.key === 'Delete' || e.key === 'Backspace') {
        const activeEl = document.activeElement;
        // 如果当前处在输入框，或者正在使用 contentEditable 编辑标注文本，则安全放行系统输入，不要删除标注对象！
        if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.isContentEditable)) return; 
        
        const id = window.ProberManager.selectedId; 
        if (id !== null) { 
            const idx = window.proberList.findIndex(a => a.id === id);
            if (idx > -1) { 
                const data = window.proberList[idx]; 
                if(data.anchorObj && data.anchorObj.parent) data.anchorObj.parent.remove(data.anchorObj); 
                if(data.dom) { data.dom.label.remove(); data.dom.svgGroup.remove(); }
                window.proberList.splice(idx, 1);
                window.needsUpdate = true; window.lightMoved = true; 
            }
            window.ProberManager.selectedId = null; 
        } 
    } 
});

window.PluginManager.register('prober', window.ProberManager, { mode: 'prober' });