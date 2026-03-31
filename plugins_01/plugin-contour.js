window.AnnotationPluginManager.register({
    id: 'contour', name: '体块环绕线',
    isDrawingContour: false, startX: 0, startY: 0, currentX: 0, currentY: 0,
    getOcclusionReads: function(p, viewer, checkOccluded, isBackFace) {
        const midEl = viewer.querySelector(`[slot="${p.slot || p.dots[p.midIndex || Math.floor(p.dots.length/2)].slot}"]`); const dotReads = [];
        if (p.dots) { p.dots.forEach(d => { const el = viewer.querySelector(`[slot="${d.slot}"]`); if (el) dotReads.push({ r: el.getBoundingClientRect(), isOccluded: checkOccluded(el) || (isBackFace && isBackFace(d.norm)) }); }); }
        return { type: p.type, p, midEl, dotReads };
    },
    onPointerMove: function(e, viewer) {
        if (!this.isDrawingContour) {
            this.isDrawingContour = true;
            window.isDrawing = true;
            this.startX = e.clientX; this.startY = e.clientY;
        }
        this.currentX = e.clientX; this.currentY = e.clientY;
        requestAnimationFrame(() => {
            if(typeof updateSVG !== 'undefined') updateSVG();
            const statusMsg = document.getElementById('status-msg');
            if(statusMsg) statusMsg.innerText = `体块环绕线截取中... (松开按键瞬间生成立体投影)`;
        });
    },
    onPointerDown: function() {},
    finish: function() {
        if (this.isDrawingContour) {
            this.isDrawingContour = false;
            window.isDrawing = false;
            const dist = Math.hypot(this.currentX - this.startX, this.currentY - this.startY);
            if (dist > 20) {
                const viewer = document.querySelector('#workbench-viewer');
                // 核心：基于划线长度，自动生成高密度的切割点（最少10个，每3像素一个点）
                const numSegments = Math.max(10, Math.min(200, Math.floor(dist / 3))); 
                let collectedDots = [];
                for(let i=0; i<=numSegments; i++) {
                    const px = this.startX + (this.currentX - this.startX) * (i / numSegments);
                    const py = this.startY + (this.currentY - this.startY) * (i / numSegments);
                    const hit = viewer.positionAndNormalFromPoint(px, py);
                    if (hit) {
                        const posStr = `${hit.position.x.toFixed(4)}m ${hit.position.y.toFixed(4)}m ${hit.position.z.toFixed(4)}m`;
                        const normStr = `${hit.normal.x.toFixed(4)}m ${hit.normal.y.toFixed(4)}m ${hit.normal.z.toFixed(4)}m`;
                        const slotName = `hotspot-contour-${pointIndex}-${collectedDots.length}`;
                        collectedDots.push({ slot: slotName, pos: posStr, norm: normStr });
                    }
                }
                if (collectedDots.length > 2) {
                    const midIndex = Math.floor(collectedDots.length / 2);
                    const midDot = collectedDots[midIndex];
                    pointsData.push({ id: pointIndex, type: 'contour', slot: midDot.slot, pos: midDot.pos, norm: midDot.norm, text: `截面线 ${pointIndex}`, dots: collectedDots, midIndex: midIndex, color: defaultColor, hidden: false });
                    this.mountDOM(pointsData[pointsData.length-1], viewer);
                    if(typeof renderState !== 'undefined') renderState();
                    if(typeof updateSVG !== 'undefined') updateSVG();
                    const statusMsg = document.getElementById('status-msg');
                    if(statusMsg) statusMsg.innerText = `体块环绕线 ${pointIndex} 完美贴合生成`;
                    pointIndex++;
                } else {
                    const statusMsg = document.getElementById('status-msg');
                    if(statusMsg) statusMsg.innerText = `划线未击中模型主体，截取取消`;
                    if(typeof updateSVG !== 'undefined') updateSVG();
                }
            } else {
                if(typeof updateSVG !== 'undefined') updateSVG();
            }
        }
    },
    renderPreviewSVG: function(htmlStr, ctx) {
        if (this.isDrawingContour) {
            htmlStr += `<line x1="${this.startX}" y1="${this.startY}" x2="${this.currentX}" y2="${this.currentY}" stroke="${defaultColor}" stroke-width="2" stroke-dasharray="4,4" style="pointer-events:none;" />`;
        }
        return htmlStr;
    },
    renderSVG: function(item, htmlStr, ctx) {
        const p = item.p; const color = ctx.color; const isActive = item.midEl ? item.midEl.classList.contains('show-text') : false; 
        const baseOpacity = isActive ? 1 : parseFloat(ctx.defaultOpacity);
        const someOccluded = item.dotReads.some(dr => dr.isOccluded); const ghostAlpha = ctx.getRenderAlpha(true, 1);
        const modelTransp = ghostAlpha > 0 ? Math.min(1, ghostAlpha / 0.9) : 0; // 计算模型透明百分比 (0~1)
        if(item.midEl) { const midOccluded = item.dotReads[p.midIndex||Math.floor(p.dots.length/2)]?.isOccluded; const domAlpha = ctx.getRenderAlpha(midOccluded, 1); item.midEl.style.opacity = domAlpha; item.midEl.style.visibility = domAlpha <= 0 ? 'hidden':'visible'; }
        
        let dStrAll = ''; let dStrVisible = ''; let dStrOccluded = ''; let wasLastVis = false, wasLastOcc = false;
        for (let i = 0; i < item.dotReads.length; i++) {
            const dr = item.dotReads[i]; const px = dr.r.left + dr.r.width/2; const py = dr.r.top + dr.r.height/2;
            dStrAll += `${i===0 ? 'M' : 'L'}${px} ${py} `;
            if (i > 0) {
                const prevDr = item.dotReads[i-1]; const prevPx = prevDr.r.left + prevDr.r.width/2; const prevPy = prevDr.r.top + prevDr.r.height/2;
                if (!dr.isOccluded && !prevDr.isOccluded) { // 纯可见分段
                    if (!wasLastVis) dStrVisible += `M${prevPx} ${prevPy} `;
                    dStrVisible += `L${px} ${py} `; wasLastVis = true; wasLastOcc = false;
                } else { // 被遮挡分段
                    if (!wasLastOcc) dStrOccluded += `M${prevPx} ${prevPy} `;
                    dStrOccluded += `L${px} ${py} `; wasLastOcc = true; wasLastVis = false;
                }
            }
        }
        const midSlot = p.dots[p.midIndex||Math.floor(p.dots.length/2)].slot; 
        htmlStr += `<path d="${dStrAll}" fill="none" stroke="transparent" stroke-width="40" style="pointer-events: auto; cursor: pointer;" onclick="document.querySelector('[slot=&quot;${midSlot}&quot;]').classList.toggle('show-text'); updateSVG(); if(window.scrollToListItem) window.scrollToListItem(${p.id});" />`;
        
        const dashedOp = ghostAlpha * 0.6 * (1 - modelTransp); // 虚线随模型透明逐渐淡出
        if (someOccluded && dashedOp > 0 && dStrOccluded) htmlStr += `<path d="${dStrOccluded}" fill="none" stroke="${color}" stroke-width="1.5" stroke-dasharray="2,4" opacity="${dashedOp}" style="pointer-events: none;" />`;
        
        const occSolidOp = baseOpacity * modelTransp; // 遮挡实线随模型透明逐渐100%浮现
        if (someOccluded && occSolidOp > 0 && dStrOccluded) {
            htmlStr += `<path d="${dStrOccluded}" fill="none" stroke="${color}" stroke-width="6" opacity="${occSolidOp}" stroke-linecap="round" stroke-linejoin="round" style="transition: opacity 0.2s; filter: drop-shadow(0 0 8px ${color}); pointer-events: none;" />`; 
            htmlStr += `<path d="${dStrOccluded}" fill="none" stroke="#ffffff" stroke-width="2" opacity="${occSolidOp * 0.8}" stroke-linecap="round" stroke-linejoin="round" style="pointer-events: none;" />`; 
        }
        if (dStrVisible) { 
            htmlStr += `<path d="${dStrVisible}" fill="none" stroke="${color}" stroke-width="6" opacity="${baseOpacity}" stroke-linecap="round" stroke-linejoin="round" style="transition: opacity 0.2s; filter: drop-shadow(0 0 8px ${color}); pointer-events: none;" />`; 
            htmlStr += `<path d="${dStrVisible}" fill="none" stroke="#ffffff" stroke-width="2" opacity="${baseOpacity * 0.8}" stroke-linecap="round" stroke-linejoin="round" style="pointer-events: none;" />`; 
        } return htmlStr;
    },
    renderConsumeSVG: function(item, htmlStr, ctx) {
        const p = item.p; const isHighlight = ctx.isHighlight; const color = ctx.color; 
        const baseOpacity = isHighlight ? 1 : parseFloat(ctx.defaultOpacity); 
        const someOccluded = item.dotReads.some(dr => dr.isOccluded); const ghostAlpha = ctx.getRenderAlpha(true, 1);
        const modelTransp = ghostAlpha > 0 ? Math.min(1, ghostAlpha / 0.9) : 0;
        if(item.midEl) { const midOccluded = item.dotReads[p.midIndex||Math.floor(p.dots.length/2)]?.isOccluded; const domAlpha = ctx.getRenderAlpha(midOccluded, 1); item.midEl.style.opacity = domAlpha; item.midEl.style.visibility = domAlpha <= 0 ? 'hidden':'visible'; if(isHighlight) item.midEl.classList.add('active'); else item.midEl.classList.remove('active'); }
        
        let dStrAll = ''; let dStrVisible = ''; let dStrOccluded = ''; let wasLastVis = false, wasLastOcc = false;
        for (let i = 0; i < item.dotReads.length; i++) {
            const dr = item.dotReads[i]; const px = dr.r.left + dr.r.width/2; const py = dr.r.top + dr.r.height/2;
            dStrAll += `${i===0 ? 'M' : 'L'}${px} ${py} `;
            if (i > 0) {
                const prevDr = item.dotReads[i-1]; const prevPx = prevDr.r.left + prevDr.r.width/2; const prevPy = prevDr.r.top + prevDr.r.height/2;
                if (!dr.isOccluded && !prevDr.isOccluded) {
                    if (!wasLastVis) dStrVisible += `M${prevPx} ${prevPy} `;
                    dStrVisible += `L${px} ${py} `; wasLastVis = true; wasLastOcc = false;
                } else {
                    if (!wasLastOcc) dStrOccluded += `M${prevPx} ${prevPy} `;
                    dStrOccluded += `L${px} ${py} `; wasLastOcc = true; wasLastVis = false;
                }
            }
        }
        htmlStr += `<path class="svg-hit-path" data-id="${p.id}" d="${dStrAll}" fill="none" stroke="transparent" stroke-width="40" style="pointer-events: none;" />`;
        
        const dashedOp = ghostAlpha * 0.6 * (1 - modelTransp);
        if (someOccluded && dashedOp > 0 && dStrOccluded) htmlStr += `<path d="${dStrOccluded}" fill="none" stroke="${color}" stroke-width="1.5" stroke-dasharray="2,4" opacity="${dashedOp}" style="pointer-events: none;" />`;
        
        const occSolidOp = baseOpacity * modelTransp;
        if (someOccluded && occSolidOp > 0 && dStrOccluded) {
            htmlStr += `<path d="${dStrOccluded}" fill="none" stroke="${color}" stroke-width="6" opacity="${occSolidOp}" stroke-linecap="round" stroke-linejoin="round" style="transition: opacity 0.2s; filter: drop-shadow(0 0 8px ${color}); pointer-events: none;" />`; 
            htmlStr += `<path d="${dStrOccluded}" fill="none" stroke="#ffffff" stroke-width="2" opacity="${occSolidOp * 0.8}" stroke-linecap="round" stroke-linejoin="round" style="pointer-events: none;" />`; 
        }
        if (dStrVisible) { 
            htmlStr += `<path d="${dStrVisible}" fill="none" stroke="${color}" stroke-width="6" opacity="${baseOpacity}" stroke-linecap="round" stroke-linejoin="round" style="transition: opacity 0.2s; filter: drop-shadow(0 0 8px ${color}); pointer-events: none;" />`; 
            htmlStr += `<path d="${dStrVisible}" fill="none" stroke="#ffffff" stroke-width="2" opacity="${baseOpacity * 0.8}" stroke-linecap="round" stroke-linejoin="round" style="pointer-events: none;" />`; 
        } return htmlStr;
    },
    mountDOM: function(p, viewer) { p.dots.forEach((dot, idx) => { const el = document.createElement('div'); el.className = 'ink-anchor'; if (idx === (p.midIndex || Math.floor(p.dots.length/2))) { el.classList.add('ink-mid'); el.innerHTML = `<div class="HotspotAnnotation">${p.text}</div>`; el.setAttribute('data-id', p.id); el.addEventListener('click', function(evt) { if(window.tourState && window.tourState.isActive) return; this.classList.toggle('show-text'); if(typeof updateSVG !== 'undefined') updateSVG(); if(window.scrollToListItem) window.scrollToListItem(p.id); }); } el.setAttribute('slot', dot.slot); el.setAttribute('data-position', dot.pos); el.setAttribute('data-normal', dot.norm); el.setAttribute('data-visibility-attribute', 'visible'); el.setAttribute('visible', ''); viewer.appendChild(el); }); },
    unmountDOM: function(p, viewer) { if (p.dots) { p.dots.forEach(d => { const el = viewer.querySelector(`[slot="${d.slot}"]`); if(el) el.remove(); }); } }
});