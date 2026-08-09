window.AnnotationStyleUtil = window.AnnotationStyleUtil || {
    // 按标注色亮度自动选描边：偏亮→深边，偏暗→浅边（2A）
    contrastBorder: function(hex) {
        let h = String(hex || '#888888').replace('#', '').trim();
        if (h.length === 3) h = h.split('').map(c => c + c).join('');
        if (h.length !== 6) h = '888888';
        const r = parseInt(h.slice(0, 2), 16) || 0;
        const g = parseInt(h.slice(2, 4), 16) || 0;
        const b = parseInt(h.slice(4, 6), 16) || 0;
        const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        return lum > 0.45 ? '#1a1a1a' : '#f2f2f2';
    },
    applyDotStyle: function(el, color, fillAlpha, hexToRgba, glow) {
        if (!el) return;
        const border = this.contrastBorder(color);
        el.style.boxSizing = 'border-box';
        el.style.border = '1.5px solid ' + border;
        el.style.backgroundColor = hexToRgba(color, fillAlpha);
        el.style.boxShadow = glow ? ('0 0 8px ' + hexToRgba(color, Math.min(1, fillAlpha + 0.15))) : 'none';
    }
};

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
        const defaultText = `区域 ${pointIndex}`; pointsData.push({ id: pointIndex, type: 'point', slot: slotName, pos: posStr, norm: normStr, text: defaultText, color: defaultColor, hidden: false, showTextOnLoad: true });
        this.mountDOM(pointsData[pointsData.length-1], viewer);
    },
    renderSVG: function(item, htmlStr, ctx) {
        const color = ctx.color; const el = item.el;
        const isActive = el.classList.contains('show-text');
        const baseOpacity = parseFloat(ctx.defaultOpacity);
        const domAlpha = ctx.getRenderAlpha(item.isOccluded, 1);
        el.style.opacity = domAlpha; el.style.visibility = domAlpha <= 0 ? 'hidden' : 'visible';
        window.AnnotationStyleUtil.applyDotStyle(el, color, baseOpacity, ctx.hexToRgba, isActive);
        return htmlStr;
    },
    renderConsumeSVG: function(item, htmlStr, ctx) {
        const isHighlight = ctx.isHighlight; const color = ctx.color; const el = item.el;
        const domAlpha = ctx.getRenderAlpha(item.isOccluded, 1);
        el.style.opacity = domAlpha; el.style.visibility = domAlpha <= 0 ? 'hidden' : 'visible';
        if (isHighlight) el.classList.add('active'); else el.classList.remove('active');
        /* 填充固定 50% 透明；激活用亮黄 */
        const fillColor = isHighlight ? '#ffd54a' : color;
        window.AnnotationStyleUtil.applyDotStyle(el, fillColor, 0.5, ctx.hexToRgba, isHighlight);
        el.style.transform = isHighlight ? 'scale(1.2)' : 'none';
        return htmlStr;
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
