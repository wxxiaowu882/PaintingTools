window.AnnotationPluginManager.register({
    id: 'leader', name: '经典引出线', currentLeaderData: null, isActiveDrawing: false, startX: 0, startY: 0,
    getOcclusionReads: function(p, viewer, checkOccluded, isBackFace) {
        const el = viewer.querySelector(`[slot="${p.slot}"]`);
        if (el) return { type: p.type, p, el, isOccluded: checkOccluded(el) || (isBackFace && isBackFace(p.norm)) }; return null;
    },
    init: function() {
        const viewer = document.querySelector('#workbench-viewer'); if(!viewer) return;
        const finishDraw = () => { if (this.isActiveDrawing) { this.isActiveDrawing = false; if (this.currentLeaderData) { if(typeof renderState !== 'undefined') renderState(); if(typeof updateSVG !== 'undefined') updateSVG(); const statusMsg = document.getElementById('status-msg'); if(statusMsg) statusMsg.innerText = `引出线 ${pointIndex} 绘制完成`; pointIndex++; this.currentLeaderData = null; } } };
        viewer.addEventListener('pointerdown', (e) => { const modeSelect = document.getElementById('tool-mode-select'); if (modeSelect && modeSelect.value === 'leader' && e.altKey && e.shiftKey && e.button === 0) { e.preventDefault(); e.stopPropagation(); if (!this.isActiveDrawing) { const hit = viewer.positionAndNormalFromPoint(e.clientX, e.clientY); if (hit) { this.isActiveDrawing = true; this.startX = e.clientX; this.startY = e.clientY; const posStr = `${hit.position.x.toFixed(4)}m ${hit.position.y.toFixed(4)}m ${hit.position.z.toFixed(4)}m`; const normStr = `${hit.normal.x.toFixed(4)}m ${hit.normal.y.toFixed(4)}m ${hit.normal.z.toFixed(4)}m`; this.currentLeaderData = { id: pointIndex, type: 'leader', slot: `hotspot-leader-${pointIndex}`, pos: posStr, norm: normStr, text: `引线 ${pointIndex}`, dx: 0, dy: 0, color: defaultColor, hidden: false, hideInList: false }; pointsData.push(this.currentLeaderData); this.mountDOM(this.currentLeaderData, viewer); const el = viewer.querySelector(`[slot="${this.currentLeaderData.slot}"]`); if(el) el.classList.add('show-text'); if(typeof updateSVG !== 'undefined') updateSVG(); } } } });
        viewer.addEventListener('pointermove', (e) => { if (this.isActiveDrawing && this.currentLeaderData) { if (!e.altKey || !e.shiftKey) { finishDraw(); return; } this.currentLeaderData.dx = e.clientX - this.startX; this.currentLeaderData.dy = e.clientY - this.startY; const el = viewer.querySelector(`[slot="${this.currentLeaderData.slot}"]`); if (el) { const ann = el.querySelector('.HotspotAnnotation'); if (ann) ann.style.transform = `translate(${this.currentLeaderData.dx}px, ${this.currentLeaderData.dy}px)`; } requestAnimationFrame(() => { if(typeof updateSVG !== 'undefined') updateSVG(); }); } });
        window.addEventListener('keyup', (e) => { if (this.isActiveDrawing && (e.key === 'Alt' || e.key === 'Shift')) { finishDraw(); } });
    },
    onPointerDown: function() {}, onPointerMove: function() {}, finish: function() {}, 
    renderSVG: function(item, htmlStr, ctx) {
        const p = item.p; const color = ctx.color; const el = item.el; if(!el) return htmlStr;
        const isActive = el.classList.contains('show-text'); const baseOpacity = isActive ? 1 : parseFloat(ctx.defaultOpacity);
        const domAlpha = ctx.getRenderAlpha(item.isOccluded, 1); el.style.opacity = domAlpha; el.style.visibility = domAlpha <= 0 ? 'hidden' : 'visible'; 
        const finalSvgAlpha = ctx.getRenderAlpha(item.isOccluded, baseOpacity);
        if (finalSvgAlpha > 0) {
            const r = el.getBoundingClientRect(); const x0 = r.left + r.width/2; const y0 = r.top + r.height/2; const toggleCode = `document.querySelector('[slot=${p.slot}]').classList.toggle('show-text');updateSVG();if(window.scrollToListItem)window.scrollToListItem(${p.id});`;
            htmlStr += `<circle cx="${x0}" cy="${y0}" r="4" fill="${color}" opacity="${finalSvgAlpha}" style="pointer-events: auto; cursor: pointer; filter: drop-shadow(0 0 4px ${color});" onclick="${toggleCode}" />`;
            if (isActive) { const x1 = x0 + p.dx; const y1 = y0 + p.dy; const midX = x0 + p.dx * 0.5; const dStr = `M ${x0} ${y0} L ${midX} ${y1} L ${x1} ${y1}`; htmlStr += `<path d="${dStr}" fill="none" stroke="transparent" stroke-width="20" style="pointer-events: auto; cursor: pointer;" onclick="${toggleCode}" />`; htmlStr += `<path d="${dStr}" fill="none" stroke="${color}" stroke-width="2" opacity="${finalSvgAlpha}" style="pointer-events: none; filter: drop-shadow(0 0 3px ${color});" />`; }
        } return htmlStr;
    },
    renderConsumeSVG: function(item, htmlStr, ctx) {
        const p = item.p; const isHighlight = ctx.isHighlight; const color = ctx.color; const el = item.el; if(!el) return htmlStr;
        const baseOpacity = isHighlight ? 1 : parseFloat(ctx.defaultOpacity); const domAlpha = ctx.getRenderAlpha(item.isOccluded, 1); el.style.opacity = domAlpha; el.style.visibility = domAlpha <= 0 ? 'hidden' : 'visible';
        if(isHighlight) el.classList.add('active'); else el.classList.remove('active'); const finalSvgAlpha = ctx.getRenderAlpha(item.isOccluded, baseOpacity);
        if (finalSvgAlpha > 0) {
            const r = el.getBoundingClientRect(); const x0 = r.left + r.width/2; const y0 = r.top + r.height/2; htmlStr += `<circle class="svg-hit-path" data-id="${p.id}" cx="${x0}" cy="${y0}" r="15" fill="transparent" style="pointer-events: auto; cursor: pointer;" />`; htmlStr += `<circle cx="${x0}" cy="${y0}" r="4" fill="${color}" opacity="${finalSvgAlpha}" style="pointer-events: none; filter: drop-shadow(0 0 4px ${color});" />`;
            if (isHighlight) { const x1 = x0 + p.dx; const y1 = y0 + p.dy; const midX = x0 + p.dx * 0.5; const dStr = `M ${x0} ${y0} L ${midX} ${y1} L ${x1} ${y1}`; htmlStr += `<path class="svg-hit-path" data-id="${p.id}" d="${dStr}" fill="none" stroke="transparent" stroke-width="20" style="pointer-events: auto; cursor: pointer;" />`; htmlStr += `<path d="${dStr}" fill="none" stroke="${color}" stroke-width="2" opacity="${finalSvgAlpha}" style="pointer-events: none; filter: drop-shadow(0 0 3px ${color});" />`; }
        } return htmlStr;
    },
    mountDOM: function(p, viewer) {
        const el = document.createElement('div'); el.className = 'ink-anchor ink-mid'; el.setAttribute('slot', p.slot); el.setAttribute('data-position', p.pos); el.setAttribute('data-normal', p.norm); el.setAttribute('data-visibility-attribute', 'visible'); el.setAttribute('visible', ''); el.setAttribute('data-id', p.id); const dx = p.dx || 50; const dy = p.dy || -50; el.innerHTML = `<div class="HotspotAnnotation" style="left: 0 !important; top: -22px !important; transform: translate(${dx}px, ${dy}px); padding: 3px 8px; background: rgba(10,10,15,0.85); border: 1px solid ${p.color||'#0df'}; font-size: 11px; white-space: nowrap;">${p.text}</div>`; const cid = p.id; el.addEventListener('click', function(evt) { if(window.tourState && window.tourState.isActive) return; this.classList.toggle('show-text'); if(typeof updateSVG !== 'undefined') updateSVG(); if(window.scrollToListItem) window.scrollToListItem(cid); }); viewer.appendChild(el);
    },
    unmountDOM: function(p, viewer) { const el = viewer.querySelector(`[slot="${p.slot}"]`); if(el) el.remove(); }
});
setTimeout(() => { const plugin = window.AnnotationPluginManager.getPlugin('leader'); if(plugin && plugin.init) plugin.init(); }, 100);