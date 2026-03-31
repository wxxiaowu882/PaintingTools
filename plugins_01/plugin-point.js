window.AnnotationPluginManager.register({
    id: 'point',
    name: '普通表面点位',
    // 自治接口：自己汇报遮挡情况
    getOcclusionReads: function(p, viewer, checkOccluded, isBackFace) {
        const el = viewer.querySelector(`[slot="${p.slot}"]`);
        if (el) return { type: p.type, p, el, isOccluded: checkOccluded(el) || (isBackFace && isBackFace(p.norm)) };
        return null;
    },
    onPointerDown: function(slotName, posStr, normStr) {
        const defaultText = `区域 ${pointIndex}`; pointsData.push({ id: pointIndex, type: 'point', slot: slotName, pos: posStr, norm: normStr, text: defaultText, color: defaultColor, hidden: false });
        this.mountDOM(pointsData[pointsData.length-1], viewer);
    },
    renderSVG: function(item, htmlStr, ctx) {
        const color = ctx.color; const el = item.el;
        const isActive = el.classList.contains('show-text'); const baseOpacity = isActive ? 1 : parseFloat(ctx.defaultOpacity);
        const domAlpha = ctx.getRenderAlpha(item.isOccluded, 1); 
        el.style.opacity = domAlpha; el.style.visibility = domAlpha <= 0 ? 'hidden' : 'visible'; 
        el.style.backgroundColor = ctx.hexToRgba(color, baseOpacity); 
        el.style.boxShadow = isActive ? `0 0 10px ${ctx.hexToRgba(color, baseOpacity)}` : 'none'; return htmlStr;
    },
    renderConsumeSVG: function(item, htmlStr, ctx) {
        const isHighlight = ctx.isHighlight; const color = ctx.color; const el = item.el;
        const baseOpacity = isHighlight ? 1 : parseFloat(ctx.defaultOpacity);
        const domAlpha = ctx.getRenderAlpha(item.isOccluded, 1);
        el.style.opacity = domAlpha; el.style.visibility = domAlpha <= 0 ? 'hidden' : 'visible';
        if(isHighlight) el.classList.add('active'); else el.classList.remove('active');
        el.style.backgroundColor = ctx.hexToRgba(color, baseOpacity);
        el.style.boxShadow = isHighlight ? `0 0 10px ${ctx.hexToRgba(color, baseOpacity)}` : 'none'; el.style.transform = isHighlight ? 'scale(1.2)' : 'none'; return htmlStr;
    },
    mountDOM: function(p, viewer) {
        const el = document.createElement('button'); el.className = 'preview-hotspot';
        el.setAttribute('slot', p.slot); el.setAttribute('data-position', p.pos); el.setAttribute('data-normal', p.norm); el.setAttribute('data-visibility-attribute', 'visible'); el.setAttribute('visible', ''); el.setAttribute('data-id', p.id); 
        el.innerHTML = `<div class="HotspotAnnotation">${p.text}</div>`; const cid = p.id;
        el.addEventListener('click', function(evt) { if(window.tourState && window.tourState.isActive) return; this.classList.toggle('show-text'); if(evt.stopPropagation) evt.stopPropagation(); if(evt.preventDefault) evt.preventDefault(); if(typeof updateSVG !== 'undefined') updateSVG(); if(window.scrollToListItem) window.scrollToListItem(cid); });
        viewer.appendChild(el);
    },
    unmountDOM: function(p, viewer) { const el = viewer.querySelector(`[slot="${p.slot}"]`); if(el) el.remove(); }
});