window.AnnotationPluginManager.register({
    id: 'prober', 
    name: '受光探针',
    
    getToneData: function(angle) {
        if (angle <= 20) return { text: `夹角 ${angle.toFixed(0)}°【亮面/高光】`, color: '#ffffff', bg: 'rgba(15,15,20,0.9)' };
        if (angle <= 75) return { text: `夹角 ${angle.toFixed(0)}°【灰面/侧受光】`, color: '#dddddd', bg: 'rgba(15,15,20,0.9)' };
        if (angle <= 100) return { text: `夹角 ${angle.toFixed(0)}°【明暗交界线】`, color: '#ff3333', bg: 'rgba(50,10,10,0.95)' };
        return { text: `夹角 ${angle.toFixed(0)}°【暗部/背光区】`, color: '#66ccff', bg: 'rgba(10,20,35,0.9)' }; 
    },

    calcArrow: function(px, py, pz, dirX, dirY, dirZ, rayLen, isRefl) {
        const tipDist = isRefl ? rayLen * 0.9 : rayLen * 0.4;
        const baseDist = isRefl ? rayLen * 0.7 : rayLen * 0.6;
        const tip = [px + dirX*tipDist, py + dirY*tipDist, pz + dirZ*tipDist];
        const base = [px + dirX*baseDist, py + dirY*baseDist, pz + dirZ*baseDist];
        const hw = rayLen * 0.05;

        const adx = isRefl ? dirX : -dirX; const ady = isRefl ? dirY : -dirY; const adz = isRefl ? dirZ : -dirZ;
        let up = Math.abs(ady) > 0.5 ? [1, 0, 0] : [0, 1, 0];
        let ux = ady*up[2] - adz*up[1], uy = adz*up[0] - adx*up[2], uz = adx*up[1] - ady*up[0];
        let uLen = Math.hypot(ux, uy, uz);
        if(uLen < 0.0001){ ux=1; uy=0; uz=0; uLen=1; }
        ux/=uLen; uy/=uLen; uz/=uLen;
        let vx = uy*adz - uz*ady, vy = uz*adx - ux*adz, vz = ux*ady - uy*adx;

        const p1 = [base[0] + hw*ux, base[1] + hw*uy, base[2] + hw*uz];
        const p2 = [base[0] + hw*(-0.5*ux + 0.866*vx), base[1] + hw*(-0.5*uy + 0.866*vy), base[2] + hw*(-0.5*uz + 0.866*vz)];
        const p3 = [base[0] + hw*(-0.5*ux - 0.866*vx), base[1] + hw*(-0.5*uy - 0.866*vy), base[2] + hw*(-0.5*uz - 0.866*vz)];

        return { tip, p1, p2, p3 };
    },

    // 核心统一重算引擎：负责处理光线变化时的 3D 锚点投射转移
    updateProbeMath: function(p, azimuth, elevation, viewer) {
        const phi = (90 - elevation) * (Math.PI / 180);
        const theta = azimuth * (Math.PI / 180);
        const lx = Math.sin(phi) * Math.cos(theta); const ly = Math.cos(phi); const lz = Math.sin(phi) * Math.sin(theta);

        const parts = p.pos.split(' ').map(v => parseFloat(v));
        if(parts.length < 3 || isNaN(parts[0])) return;
        const px = parts[0], py = parts[1], pz = parts[2];
        const rayLen = 0.15;

        const nx = p.baseNorm[0], ny = p.baseNorm[1], nz = p.baseNorm[2];
        const dotProduct = nx*lx + ny*ly + nz*lz;
        const angle = Math.acos(Math.max(-1, Math.min(1, dotProduct))) * 180 / Math.PI;

        const R = [2*dotProduct*nx - lx, 2*dotProduct*ny - ly, 2*dotProduct*nz - lz];
        const rLen = Math.hypot(R[0], R[1], R[2]);
        if(rLen>0){ R[0]/=rLen; R[1]/=rLen; R[2]/=rLen; }

        const arrL = this.calcArrow(px, py, pz, lx, ly, lz, rayLen, false);
        const arrR = this.calcArrow(px, py, pz, R[0], R[1], R[2], rayLen, true);
        const toStr = (arr) => `${arr[0].toFixed(4)}m ${arr[1].toFixed(4)}m ${arr[2].toFixed(4)}m`;

        p.subAnchors = {
            Light: toStr([px + lx*rayLen, py + ly*rayLen, pz + lz*rayLen]),
            Refl: toStr([px + R[0]*rayLen, py + R[1]*rayLen, pz + R[2]*rayLen]),
            L_Tip: toStr(arrL.tip), L_P1: toStr(arrL.p1), L_P2: toStr(arrL.p2), L_P3: toStr(arrL.p3),
            R_Tip: toStr(arrR.tip), R_P1: toStr(arrR.p1), R_P2: toStr(arrR.p2), R_P3: toStr(arrR.p3)
        };
        
        if(!p.probeData) p.probeData = {};
        p.probeData.angle = angle;
        p.probeData.lightDir = [lx, ly, lz];
        
        // 保留节流数字刷新，防抽搐
        const now = Date.now();
        if (!p.probeData.lastAngleTime || now - p.probeData.lastAngleTime > 150) {
            p.probeData.displayAngle = Math.round(angle);
            p.probeData.lastAngleTime = now;
        }
        
        // 刻录当前使用的光线坐标，用作后续比对参考系
        p.probeData.lastSX = azimuth;
        p.probeData.lastSY = elevation;

        const tone = this.getToneData(angle);
        p.probeData.toneColor = tone.color;
        p.probeData.toneBg = tone.bg;

        // 向下兼容：如果有缓存的 DOM 则直接暴力操控
        if (viewer && p.domCache) {
            if (p.domCache.label) {
                p.domCache.label.style.color = tone.color;
                p.domCache.label.style.borderLeftColor = tone.color;
                p.domCache.label.style.background = tone.bg;
            }
            Object.keys(p.subAnchors).forEach(key => {
                const newPos = p.subAnchors[key];
                const anchor = p.domCache.anchors[key];
                if (anchor && anchor.getAttribute('data-position') !== newPos) {
                    if (typeof viewer.updateHotspot === 'function') {
                        anchor.setAttribute('data-position', newPos);
                        viewer.updateHotspot({name: anchor.getAttribute('slot'), position: newPos});
                    } else {
                        const newAnchor = anchor.cloneNode(true);
                        newAnchor.setAttribute('data-position', newPos);
                        newAnchor.style.transform = anchor.style.transform;
                        anchor.remove();
                        viewer.appendChild(newAnchor);
                        p.domCache.anchors[key] = newAnchor;
                    }
                }
            });
        }
    },

    init: function() {
        const self = this;
        let _rafId = null;

        const updateAllProbers = () => {
            if (typeof pointsData === 'undefined') return;
            const spotXEl = document.getElementById('global-spot-x');
            const spotYEl = document.getElementById('global-spot-y');
            
            // 如果不存在滑块，说明身处消费端，则拦截跳过，交由 renderConsumeSVG 自己驱动重算
            if (!spotXEl || !spotYEl) return;

            const azimuth = parseFloat(spotXEl.value);
            const elevation = parseFloat(spotYEl.value);
            
            const viewer = document.querySelector('#workbench-viewer');
            pointsData.forEach(p => {
                if (p.type === 'prober') self.updateProbeMath(p, azimuth, elevation, viewer);
            });

            if (typeof updateSVG === 'function') updateSVG();
        };

        const scheduleUpdate = () => {
            if (_rafId) return;
            _rafId = requestAnimationFrame(() => {
                updateAllProbers();
                _rafId = null;
            });
        };

        // 仅在生产端挂载事件
        const spotXEl = document.getElementById('global-spot-x');
        const spotYEl = document.getElementById('global-spot-y');
        if(spotXEl) spotXEl.addEventListener('input', scheduleUpdate);
        if(spotYEl) spotYEl.addEventListener('input', scheduleUpdate);
        
        if(spotXEl && spotYEl) {
            document.addEventListener('mousemove', (e) => { if (e.buttons === 1) scheduleUpdate(); }, { passive: true });
        }
    },

    getOcclusionReads: function(p, viewer, checkOccluded, isBackFace) {
        let el, elNorm;
        if (p.domCache) {
            el = p.domCache.main; elNorm = p.domCache.anchors['Norm'];
        } else {
            el = viewer.querySelector(`[slot="${p.slot}"]`); elNorm = viewer.querySelector(`[slot="${p.slotNorm}"]`);
        }
        if (!el) return null;
        
        const reads = { type: p.type, p, el, elNorm, isOccluded: checkOccluded(el) || (isBackFace && isBackFace(p.norm)), subEls: {} };
        if (p.subAnchors) {
            Object.keys(p.subAnchors).forEach(key => { 
                reads.subEls[key] = p.domCache ? p.domCache.anchors[key] : viewer.querySelector(`[slot="${p.slot}-${key}"]`); 
            });
        }
        return reads;
    },
    
    onPointerDown: function(slotName, posStr, normStr, hitExact, e, viewer) {
        let finalNx = hitExact.normal.x, finalNy = hitExact.normal.y, finalNz = hitExact.normal.z;
        if (e && e.clientX !== undefined) {
            let nxSum = 0, nySum = 0, nzSum = 0, count = 0; const radius = 8;
            const offsets = [[0,0],[-radius,0],[radius,0],[0,-radius],[0,radius],[-radius,-radius],[radius,radius],[-radius,radius],[radius,-radius]];
            for (let [dx, dy] of offsets) {
                const h = viewer.positionAndNormalFromPoint(e.clientX + dx, e.clientY + dy);
                if (h != null) { nxSum += h.normal.x; nySum += h.normal.y; nzSum += h.normal.z; count++; }
            }
            if (count > 0) { const len = Math.hypot(nxSum, nySum, nzSum); if (len > 0.0001) { finalNx = nxSum/len; finalNy = nySum/len; finalNz = nzSum/len; } }
        }
        const nx = finalNx; const ny = finalNy; const nz = finalNz;
        normStr = `${nx.toFixed(4)}m ${ny.toFixed(4)}m ${nz.toFixed(4)}m`; 
        
        const azimuth = parseFloat(typeof defaultSpotX !== 'undefined' ? defaultSpotX : 0);
        const elevation = parseFloat(typeof defaultSpotY !== 'undefined' ? defaultSpotY : 45);

        const pData = {
            id: pointIndex, type: 'prober', slot: slotName,
            slotNorm: `hotspot-prober-norm-${pointIndex}`,
            pos: posStr, posNorm: posStr, norm: normStr, baseNorm: [nx, ny, nz], subAnchors: {},
            color: defaultColor || '#ffbb33', hidden: false, hideInList: false,
            text: '分析中...', 
            probeData: { angle: 0, displayAngle: 0, lastAngleTime: 0, state: 'init', lightDir: [0, 1, 0], toneColor: '#fff', toneBg: 'rgba(0,0,0,0.8)' }
        };
        
        // 调用集中引擎瞬间补齐所有 3D 定位锚点
        this.updateProbeMath(pData, azimuth, elevation, null);
        pData.text = this.getToneData(pData.probeData.angle).text;
        
        pointsData.push(pData);
        this.mountDOM(pData, viewer);
        
        if (typeof statusMsg !== 'undefined') statusMsg.innerText = `受光探针 ${pointIndex} 已放置`;
        pointIndex++;
        if (typeof renderState !== 'undefined') renderState();
        if (typeof updateSVG !== 'undefined') updateSVG();
    },
    
    // 渲染通用管线提取（为生产端和消费端提供同样的无缝输出）
    _drawCore: function(item, htmlStr, ctx, isHighlight) {
        const p = item.p; const el = item.el; const elNorm = item.elNorm;
        const color = ctx.color || p.color || '#00ccff'; 
        if(!el || !elNorm) return htmlStr;
        
        // 判断高亮状态，如果身处高亮焦点则不透，否则使用传入的默认环境透明度
        const baseOpacity = isHighlight ? 1 : parseFloat(ctx.defaultOpacity || '1');
        
        const domAlpha = ctx.getRenderAlpha(item.isOccluded, 1);
        el.style.opacity = domAlpha; el.style.visibility = domAlpha <= 0 ? 'hidden' : 'visible';
        
        if (isHighlight !== undefined) {
            if (isHighlight) el.classList.add('active'); else el.classList.remove('active');
        }
        
        const finalSvgAlpha = ctx.getRenderAlpha(item.isOccluded, baseOpacity);
        if (finalSvgAlpha > 0) {
            const r0 = el.getBoundingClientRect(); const rn = elNorm.getBoundingClientRect();
            if(r0.width === 0 || (r0.left === 0 && r0.top === 0)) return htmlStr;

            const x0 = r0.left + r0.width / 2, y0 = r0.top + r0.height / 2;
            const xn = rn.left + rn.width / 2, yn = rn.top + rn.height / 2;

            const s = item.subEls || {};
            const get2D = (elem) => {
                if(!elem) return null; const r = elem.getBoundingClientRect();
                if(r.width === 0 && r.height === 0) return null;
                return { x: r.left + r.width/2, y: r.top + r.height/2 };
            };
            const pL = get2D(s.Light), pR = get2D(s.Refl);
            const LT = get2D(s.L_Tip), LP1 = get2D(s.L_P1), LP2 = get2D(s.L_P2), LP3 = get2D(s.L_P3);
            const RT = get2D(s.R_Tip), RP1 = get2D(s.R_P1), RP2 = get2D(s.R_P2), RP3 = get2D(s.R_P3);

            let sectorPath = null, tx = x0, ty = y0;
            if (pL) {
                const radius = 45;
                const d1x = xn - x0, d1y = yn - y0; const d2x = pL.x - x0, d2y = pL.y - y0;
                const l1 = Math.hypot(d1x, d1y), l2 = Math.hypot(d2x, d2y);
                if(l1 >= 1 && l2 >= 1) {
                    const n1x = d1x/l1, n1y = d1y/l1; const n2x = d2x/l2, n2y = d2y/l2;
                    const sx = x0 + n1x * radius, sy = y0 + n1y * radius; const ex = x0 + n2x * radius, ey = y0 + n2y * radius;
                    const sweep = (n1x * n2y - n1y * n2x) >= 0 ? 1 : 0;
                    sectorPath = `M ${x0} ${y0} L ${sx} ${sy} A ${radius} ${radius} 0 0 ${sweep} ${ex} ${ey} Z`;

                    let bx = n1x + n2x, by = n1y + n2y; let bLen = Math.hypot(bx, by);
                    if (bLen < 0.001) { bx = -n1y; by = n1x; bLen = 1; }
                    const textRadius = 28;
                    tx = x0 + (bx / bLen) * textRadius; ty = y0 + (by / bLen) * textRadius;
                }
            }

            const tc = p.probeData.toneColor || '#ffffff';
            const angleText = p.probeData.displayAngle !== undefined ? p.probeData.displayAngle + '°' : '';

            // 【消费端适配核心】：添加巨大的 SVG 虚拟隐形碰撞域，让移动端手指能轻松点中探针触发高亮！
            if (isHighlight !== undefined) {
                htmlStr += `<circle class="svg-hit-path" data-id="${p.id}" cx="${x0}" cy="${y0}" r="25" fill="transparent" stroke="transparent" style="pointer-events:auto; cursor:pointer;" />`;
            }

            if (sectorPath) {
                htmlStr += `<path d="${sectorPath}" fill="${tc}" opacity="${finalSvgAlpha * 0.6}" stroke="none" style="pointer-events: none; transition: fill 0.2s;" />`;
                htmlStr += `<text x="${tx}" y="${ty}" fill="#ffffff" font-size="10" font-weight="bold" font-family="sans-serif" text-anchor="middle" dominant-baseline="central" opacity="${finalSvgAlpha}" style="pointer-events:none; filter: drop-shadow(0 0 2px rgba(0,0,0,0.9));">${angleText}</text>`;
            }

            const drawFacet = (pA, pB, pC, overlayCol, overlayOp, baseColor, alpha) => {
                if(!pA || !pB || !pC) return;
                const cross = (pB.x - pA.x) * (pC.y - pA.y) - (pB.y - pA.y) * (pC.x - pA.x);
                if (cross > 0) {
                    htmlStr += `<polygon points="${pA.x},${pA.y} ${pB.x},${pB.y} ${pC.x},${pC.y}" fill="${baseColor}" opacity="${alpha}" stroke="${baseColor}" stroke-width="1.5" stroke-linejoin="round" style="pointer-events:none;" />`;
                    if (overlayOp > 0) htmlStr += `<polygon points="${pA.x},${pA.y} ${pB.x},${pB.y} ${pC.x},${pC.y}" fill="${overlayCol}" opacity="${overlayOp * alpha}" style="pointer-events:none;" />`;
                }
            };
            const draw3DArrow = (tip, p1, p2, p3, baseColor, alpha) => {
                drawFacet(tip, p1, p2, '#ffffff', 0.3, baseColor, alpha); drawFacet(tip, p2, p3, '#000000', 0.2, baseColor, alpha);
                drawFacet(tip, p3, p1, '#000000', 0.5, baseColor, alpha); drawFacet(p1, p3, p2, '#000000', 0.7, baseColor, alpha);
            };

            htmlStr += `<line x1="${x0}" y1="${y0}" x2="${xn}" y2="${yn}" stroke="${color}" stroke-width="2.5" opacity="${finalSvgAlpha}" style="pointer-events: none; filter: drop-shadow(0 0 2px ${color});" />`;
            htmlStr += `<circle cx="${xn}" cy="${yn}" r="2" fill="${color}" opacity="${finalSvgAlpha}" style="pointer-events: none;" />`; 

            if (pL) {
                const isBacklight = p.probeData.angle > 90;
                const lightAlpha = isBacklight ? finalSvgAlpha * 0.15 : finalSvgAlpha;
                const filterBlur = isBacklight ? 'none' : 'drop-shadow(0 0 3px #ffaa00)';

                htmlStr += `<line x1="${x0}" y1="${y0}" x2="${pL.x}" y2="${pL.y}" stroke="#ffcc00" stroke-width="2.5" stroke-dasharray="4,4" opacity="${lightAlpha}" style="pointer-events: none; filter: ${filterBlur};" />`;
                draw3DArrow(LT, LP1, LP2, LP3, '#ffcc00', lightAlpha);
                htmlStr += `<circle cx="${pL.x}" cy="${pL.y}" r="3" fill="#ffffff" stroke="#ffcc00" stroke-width="1.5" opacity="${lightAlpha}" style="pointer-events: none;" />`; 
            }

            if (pR && p.probeData.angle <= 90) {
                const reflAlpha = finalSvgAlpha * 0.6; 
                htmlStr += `<line x1="${x0}" y1="${y0}" x2="${pR.x}" y2="${pR.y}" stroke="#88ccff" stroke-width="2" stroke-dasharray="4,4" opacity="${reflAlpha}" style="pointer-events: none; filter: drop-shadow(0 0 3px #88ccff);" />`;
                draw3DArrow(RT, RP1, RP2, RP3, '#88ccff', reflAlpha * 1.2);
            }

            htmlStr += `<circle cx="${x0}" cy="${y0}" r="2.5" fill="#ffffff" opacity="${finalSvgAlpha}" style="pointer-events: none;" />`;
        }
        return htmlStr;
    },
    
    // 原生生产端渲染 (无缝接入)
    renderSVG: function(item, htmlStr, ctx) {
        return this._drawCore(item, htmlStr, ctx, undefined);
    },

    // 核心重构：专为消费端环境打造的自适应反射计算器
    renderConsumeSVG: function(item, htmlStr, ctx) {
        const p = item.p;
        
        // 探知到快照下发了全新的聚光灯设定 (比如进入了下一帧快照)
        if (ctx.lightData) {
            const sX = parseFloat(ctx.lightData.sX);
            const sY = parseFloat(ctx.lightData.sY);
            // 只要发现光照被强行更改了，立刻激活自愈机制，重新推算所有箭头的 3D 归属
            if (p.probeData.lastSX !== sX || p.probeData.lastSY !== sY) {
                const viewer = document.querySelector('#workbench-viewer');
                this.updateProbeMath(p, sX, sY, viewer);
                
                // 由于 3D 刚转移，model-viewer 需要一帧去重新映射 2D 坐标。
                // 暂时略过本帧残像的绘制，并主动追发一次刷新令其在下一帧重生。
                requestAnimationFrame(() => {
                    if (typeof updateSVG === 'function') updateSVG();
                });
                return htmlStr; 
            }
        }
        // 如果环境已经稳定，则直接套用标准渲染即可，并传入高亮焦点状态
        return this._drawCore(item, htmlStr, ctx, ctx.isHighlight);
    },

    mountDOM: function(p, viewer) {
        const el = document.createElement('div'); 
        el.className = 'ink-anchor ink-mid show-text'; 
        el.setAttribute('slot', p.slot); 
        el.setAttribute('data-position', p.pos); 
        el.setAttribute('data-normal', p.norm); 
        el.setAttribute('data-visibility-attribute', 'visible'); 
        el.setAttribute('visible', ''); 
        el.setAttribute('data-id', p.id); 
        
        const tc = p.probeData.toneColor || '#fff';
        const tb = p.probeData.toneBg || 'rgba(15,15,20,0.9)';
        
        el.innerHTML = `<div class="HotspotAnnotation prober-label" style="display: block !important; left: 18px !important; top: -12px !important; padding: 4px 8px; background: ${tb}; border-left: 3px solid ${tc}; font-size: 11px; white-space: nowrap; transition: background 0.2s, border-color 0.2s, color 0.2s; box-shadow: 0 4px 10px rgba(0,0,0,0.5); font-weight: bold; letter-spacing: 0.5px; color: ${tc};">${p.text}</div>`; 
        
        const cid = p.id; 
        el.addEventListener('click', function(evt) { 
            if(window.tourState && window.tourState.isActive) return; 
            if(typeof updateSVG !== 'undefined') updateSVG(); 
            if(window.scrollToListItem) window.scrollToListItem(cid); 
        }); 
        viewer.appendChild(el);

        p.domCache = { main: el, label: el.querySelector('.prober-label'), anchors: {} };

        const createAnchor = (s, pos, key) => {
            if(!s || !pos) return;
            const a = document.createElement('div'); a.className = 'ink-anchor';
            a.setAttribute('slot', s); a.setAttribute('data-position', pos);
            a.setAttribute('data-visibility-attribute', 'visible'); a.setAttribute('visible', '');
            viewer.appendChild(a);
            p.domCache.anchors[key] = a;
        };
        createAnchor(p.slotNorm, p.posNorm, 'Norm');
        if (p.subAnchors) {
            Object.keys(p.subAnchors).forEach(key => { createAnchor(`${p.slot}-${key}`, p.subAnchors[key], key); });
        }
    },
    
    unmountDOM: function(p, viewer) { 
        if (p.domCache) {
            if (p.domCache.main) p.domCache.main.remove();
            Object.values(p.domCache.anchors).forEach(a => { if (a) a.remove(); });
        } else {
            const remove = s => { if(s){ const el = viewer.querySelector(`[slot="${s}"]`); if(el) el.remove(); } };
            remove(p.slot); remove(p.slotNorm);
            if (p.subAnchors) { Object.keys(p.subAnchors).forEach(key => remove(`${p.slot}-${key}`)); }
        }
    }
});

setTimeout(() => {
    const plugin = window.AnnotationPluginManager.getPlugin('prober');
    if (plugin && plugin.init) plugin.init();
}, 200);