import * as THREE from 'three';
window.annoDataList = [];
window.annoCounter = 0;
window.AnnotationManager = {
    selectedId: null,
    isPlacing: false,
    activeData: null,
    _cachedControls: null,
    _cachedScene: null,
    _anchorDrag: null,
    _anchorDragOrbitWasEnabled: null,
    ANCHOR_DOT_R: 3,
    ANCHOR_DOT_R_SEL: 4,
    ANCHOR_RING_R: 6,

    onSceneHit: function (context) {
        if (window.currentEditorMode !== 'annotate') return;
        const ev = context.event;
        const shiftHeld = ev.shiftKey || (typeof ev.getModifierState === 'function' && ev.getModifierState('Shift'));
        if (!shiftHeld) return;
        this.createLeader(context.targetObj, context.hitPoint, context.worldNormal);
        this.activeData = window.annoDataList[window.annoDataList.length - 1];
        this.isPlacing = true;
        this._cachedControls = context.controls;
        if (this._cachedControls) this._cachedControls.enabled = false;
        if (window.showToast) window.showToast('已锁定锚点：请移动鼠标确定文字位置，松开 Alt 或 Shift 完成。');
    },
    onGlobalPointerMove: function (context) {
        if (window.currentEditorMode !== 'annotate') return;
        if (this.isPlacing && this.activeData) {
            const vw = Math.max(1, window.__solidAnnoViewportW || window.innerWidth || 1);
            const vh = Math.max(1, window.__solidAnnoViewportH || window.innerHeight || 1);
            this.activeData.dx = context.event.clientX - context.startX;
            this.activeData.dy = context.event.clientY - context.startY;
            this.activeData.dxN = this.activeData.dx / vw;
            this.activeData.dyN = this.activeData.dy / vh;
            // 同时记录“跟模型走”的长度：确保 PC/手机形态一致（不随屏幕宽窄变短/变长）
            try {
                const cam = this._cachedCamera;
                if (cam && this.activeData.anchorObj) {
                    const px = this._pxPerWorldAtAnchor(cam, this.activeData.anchorObj);
                    if (px && px.pxPerWorldX > 1e-6 && px.pxPerWorldY > 1e-6) {
                        this.activeData.dxW = this.activeData.dx / px.pxPerWorldX;
                        this.activeData.dyW = this.activeData.dy / px.pxPerWorldY;
                    }
                }
            } catch (_e) {}
            window.needsUpdate = true;
        }
    },
    cancelInteractivePlacing: function () {
        if (!this.isPlacing) return;
        this.isPlacing = false;
        this.activeData = null;
        if (this._cachedControls) {
            this._cachedControls.enabled = true;
            this._cachedControls = null;
        }
        if (typeof window.needsUpdate !== 'undefined') window.needsUpdate = true;
    },

    onKeyUp: function (event) {
        if (!this.isPlacing || (event.key !== 'Alt' && event.key !== 'Shift')) return;
        this.cancelInteractivePlacing();
        if (window.currentEditorMode === 'annotate' && window.showToast) window.showToast('引线已放置。');
    },
    onBeforePointerDown: function () {
        if (window.currentEditorMode === 'annotate' && this.isPlacing) return true;
    },
    onGlobalPointerUp: function () {
        if (window.currentEditorMode === 'annotate' && this.isPlacing) return true;
    },

    onClearScene: function () {
        if (!window.annoDataList) return;
        this.cancelInteractivePlacing();
        this._cancelAnchorDrag();
        window.annoDataList.forEach(data => {
            if (data.anchorObj && data.anchorObj.parent) data.anchorObj.parent.remove(data.anchorObj);
            const dom = document.getElementById('dom_' + data.id);
            if (dom) dom.remove();
            if (data.svgPath) data.svgPath.remove();
            if (data.svgGlowPath) data.svgGlowPath.remove();
            if (data.svgCircle) data.svgCircle.remove();
            if (data.svgAnchorRing) data.svgAnchorRing.remove();
            if (typeof data.cleanupEvents === 'function') data.cleanupEvents();
        });
        window.annoDataList = [];
        this.selectedId = null;
        this.isPlacing = false;
        this.activeData = null;
        this._cachedControls = null;
        const handlesSvg = document.getElementById('anno-anchor-handles');
        if (handlesSvg) handlesSvg.innerHTML = '';
    },

    onLoadItem: function (ctx) {
        if (!ctx.itemData.annotations) return;
        const leaders = ctx.itemData.annotations.filter(a => {
            const k = a.annotationKind || (a.text != null ? 'leader' : 'colorSample');
            return k !== 'colorSample';
        });
        const safeData = leaders.filter(a => !window.annoDataList.some(exist => exist.id === a.id)).map(a => {
            if (!a.baseScale || a.baseScale === 0) a.baseScale = 1;
            return a;
        });
        if (safeData.length > 0) this.restoreAnnotations(ctx.obj, safeData);
    },
    onLoadGround: function (ctx) {
        if (!ctx.sceneData.groundAnnotations) return;
        const leaders = ctx.sceneData.groundAnnotations.filter(a => {
            const k = a.annotationKind || (a.text != null ? 'leader' : 'colorSample');
            return k !== 'colorSample';
        });
        const safeData = leaders.filter(a => !window.annoDataList.some(exist => exist.id === a.id)).map(a => {
            if (!a.baseScale || a.baseScale === 0) a.baseScale = 1;
            return a;
        });
        if (safeData.length > 0) this.restoreAnnotations(ctx.obj, safeData);
    },
    onSaveItemData: function (context) {
        const annos = this.extractSaveData(context.obj);
        if (annos.length > 0) context.itemData.annotations = annos;
    },
    onSaveGroundData: function (context) {
        const annos = this.extractSaveData(context.obj);
        if (annos.length > 0) context.sceneData.groundAnnotations = annos;
    },

    extractSaveData: function (obj) {
        const annotations = [];
        if (!obj || !obj.children) return annotations;
        obj.children.forEach(c => {
            if (!c.name || !c.name.startsWith('anno_')) return;
            const aData = window.annoDataList.find(a => a.id === c.name);
            if (!aData) return;
            const vw = Math.max(1, window.__solidAnnoViewportW || window.innerWidth || 1);
            const vh = Math.max(1, window.__solidAnnoViewportH || window.innerHeight || 1);
            const richSave = aData.textRich ? this.sanitizeLabelRichHtml(String(aData.textRich)) : '';
            let norm = [0, 1, 0];
            if (c.userData.localNormal) {
                norm = [
                    parseFloat(c.userData.localNormal.x.toFixed(3)),
                    parseFloat(c.userData.localNormal.y.toFixed(3)),
                    parseFloat(c.userData.localNormal.z.toFixed(3))
                ];
            }
            const entry = {
                id: aData.id,
                annotationKind: 'leader',
                text: aData.text,
                textRich: richSave || undefined,
                detailText: aData.detailText != null ? String(aData.detailText) : '',
                collapsed: !!aData.collapsed,
                color: aData.color,
                dx: aData.dx,
                dy: aData.dy,
                dxN: typeof aData.dxN === 'number' ? parseFloat(aData.dxN.toFixed(6)) : (typeof aData.dx === 'number' ? parseFloat((aData.dx / vw).toFixed(6)) : 0),
                dyN: typeof aData.dyN === 'number' ? parseFloat(aData.dyN.toFixed(6)) : (typeof aData.dy === 'number' ? parseFloat((aData.dy / vh).toFixed(6)) : 0),
                dxW: typeof aData.dxW === 'number' ? parseFloat(aData.dxW.toFixed(6)) : undefined,
                dyW: typeof aData.dyW === 'number' ? parseFloat(aData.dyW.toFixed(6)) : undefined,
                localPos: [
                    parseFloat(c.position.x.toFixed(4)),
                    parseFloat(c.position.y.toFixed(4)),
                    parseFloat(c.position.z.toFixed(4))
                ],
                localNormal: norm,
                baseDist: aData.baseDist,
                baseScale: aData.baseScale
            };
            if (aData.labelShape === 'circle') entry.labelShape = 'circle';
            if (typeof aData.occludeDot === 'number' && isFinite(aData.occludeDot)) {
                entry.occludeDot = parseFloat(aData.occludeDot.toFixed(2));
            }
            annotations.push(entry);
        });
        return annotations;
    },

    onDrawSnapshot: function (context) {
        if (!window.annoDataList) return;
        const ctx2 = context.ctx, rect = context.rect;
        const scaleX = 256 / rect.width, scaleY = 256 / rect.height;
        window.annoDataList.forEach(data => {
            if (data.isBehind || data.isOccluded) return;
            const ax = data.screenX, ay = data.screenY, ax1 = ax + data.scaledDx, ay1 = ay + data.scaledDy, amidX = ax + data.scaledDx * 0.5;
            const tx = (ax - rect.left) * scaleX, ty = (ay - rect.top) * scaleY, tx1 = (ax1 - rect.left) * scaleX, ty1 = (ay1 - rect.top) * scaleY, tmidX = (amidX - rect.left) * scaleX;
            ctx2.strokeStyle = data.color;
            ctx2.lineWidth = 1.5;
            ctx2.beginPath();
            ctx2.moveTo(tx, ty);
            ctx2.lineTo(tmidX, ty1);
            ctx2.lineTo(tx1, ty1);
            ctx2.stroke();
            ctx2.fillStyle = data.color;
            ctx2.beginPath();
            ctx2.arc(tx, ty, 3, 0, Math.PI * 2);
            ctx2.fill();
            ctx2.font = '11px Inter, sans-serif';
            const snapText = String(data.text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')[0];
            const textWidth = ctx2.measureText(snapText).width;
            const boxW = textWidth + 16, boxH = 20;
            ctx2.fillStyle = window.AnnotationManager.getDarkBg(data.color);
            ctx2.fillRect(tx1 - boxW / 2, ty1 - boxH / 2, boxW, boxH);
            ctx2.strokeStyle = data.color;
            ctx2.lineWidth = 1;
            ctx2.strokeRect(tx1 - boxW / 2, ty1 - boxH / 2, boxW, boxH);
            ctx2.fillStyle = '#ffffff';
            ctx2.textAlign = 'center';
            ctx2.textBaseline = 'middle';
            ctx2.fillText(snapText, tx1, ty1);
        });
    },

    getDarkBg: function (hex) {
        let c = hex.replace('#', '');
        if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
        const r = parseInt(c.substring(0, 2), 16), g = parseInt(c.substring(2, 4), 16), b = parseInt(c.substring(4, 6), 16);
        return `rgba(${(r * 0.2) | 0}, ${(g * 0.2) | 0}, ${(b * 0.2) | 0}, 0.85)`;
    },

    normalizeHexColor: function (hex) {
        if (!hex) return '';
        let c = String(hex).trim();
        if (!c.startsWith('#')) return '';
        c = c.slice(1);
        if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
        if (!/^[0-9a-fA-F]{6}$/.test(c)) return '';
        return '#' + c.toLowerCase();
    },

    parseColorToHex: function (colorStr) {
        if (!colorStr) return '';
        const s = String(colorStr).trim();
        const hex = this.normalizeHexColor(s);
        if (hex) return hex;
        const m = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
        if (!m) return '';
        const clamp = (n) => Math.max(0, Math.min(255, parseInt(n, 10) || 0));
        const r = clamp(m[1]), g = clamp(m[2]), b = clamp(m[3]);
        return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
    },

    extractElementColor: function (node) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) return '';
        try {
            if (node.style && node.style.color) {
                const hex = this.parseColorToHex(node.style.color);
                if (hex) return hex;
            }
        } catch (_e) {}
        const style = node.getAttribute('style') || '';
        const hexMatch = style.match(/(?:^|;)\s*color\s*:\s*(#[0-9a-fA-F]{3,8})/i);
        if (hexMatch) {
            const hex = this.normalizeHexColor(hexMatch[1]);
            if (hex) return hex;
        }
        const rgbMatch = style.match(/(?:^|;)\s*color\s*:\s*rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
        if (rgbMatch) {
            return this.parseColorToHex('rgb(' + rgbMatch[1] + ',' + rgbMatch[2] + ',' + rgbMatch[3] + ')');
        }
        return '';
    },

    isBoldStyleElement: function (node) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
        const tag = node.tagName.toLowerCase();
        if (tag === 'strong' || tag === 'b') return true;
        if (tag === 'span') {
            const fw = node.style && node.style.fontWeight;
            return fw === 'bold' || fw === '700' || (fw && parseInt(fw, 10) >= 700);
        }
        return false;
    },

    getAnnoBoldColor: function () {
        const DEFAULT = '#ffd966';
        try {
            const picker = document.getElementById('anno-bold-color-picker');
            if (picker && picker.value) return picker.value;
            const cached = localStorage.getItem('solid_anno_bold_color_cache');
            const norm = this.normalizeHexColor(cached);
            if (norm) return norm;
        } catch (_e) {}
        return DEFAULT;
    },

    applyBoldColorToSelection: function (div) {
        if (!document.queryCommandState('bold')) return;
        const color = this.getAnnoBoldColor();
        const sel = window.getSelection();
        if (!sel || !sel.rangeCount) return;
        const range = sel.getRangeAt(0);
        const painted = new Set();

        const isBoldElement = (el) => {
            if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
            const tag = el.tagName.toLowerCase();
            if (tag === 'strong' || tag === 'b') return true;
            if (tag === 'span') {
                const fw = el.style && el.style.fontWeight;
                return fw === 'bold' || fw === '700' || (fw && parseInt(fw, 10) >= 700);
            }
            return false;
        };

        const paint = (el) => {
            if (!el || painted.has(el) || !isBoldElement(el)) return;
            painted.add(el);
            const tag = el.tagName.toLowerCase();
            if (tag === 'span') {
                const strong = document.createElement('strong');
                strong.style.color = this.normalizeHexColor(color) || color;
                while (el.firstChild) strong.appendChild(el.firstChild);
                el.parentNode.replaceChild(strong, el);
                painted.add(strong);
                return;
            }
            el.style.color = this.normalizeHexColor(color) || color;
        };

        const walkUp = (node) => {
            let n = node;
            if (n.nodeType === Node.TEXT_NODE) n = n.parentNode;
            while (n && n !== div) {
                if (isBoldElement(n)) { paint(n); return; }
                n = n.parentNode;
            }
        };

        walkUp(range.startContainer);
        walkUp(range.endContainer);
        walkUp(range.commonAncestorContainer);

        div.querySelectorAll('strong, b, span[style*="font-weight"]').forEach(el => {
            if (!isBoldElement(el)) return;
            try {
                if (typeof range.intersectsNode === 'function' && range.intersectsNode(el)) paint(el);
            } catch (_e) { paint(el); }
        });
    },

    toggleLabelBoldWithColor: function (div) {
        const wasBold = document.queryCommandState('bold');
        document.execCommand('bold', false, null);
        if (wasBold) return;
        const apply = () => this.applyBoldColorToSelection(div);
        apply();
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(apply);
    },

    /** 小标签富文本：仅保留 strong/br，统一为 strong；strong 仅保留白名单 color；无加粗则返回空串 */
    sanitizeLabelRichHtml: function (rawHtml) {
        if (!rawHtml) return '';
        const tmp = document.createElement('div');
        tmp.innerHTML = String(rawHtml);
        const out = document.createElement('div');
        const walk = (node, parentOut) => {
            if (node.nodeType === Node.TEXT_NODE) {
                parentOut.appendChild(document.createTextNode(node.textContent));
                return;
            }
            if (node.nodeType !== Node.ELEMENT_NODE) return;
            const tag = node.tagName.toLowerCase();
            if (tag === 'strong' || tag === 'b' || this.isBoldStyleElement(node)) {
                const s = document.createElement('strong');
                const hex = this.extractElementColor(node);
                if (hex) s.style.color = hex;
                node.childNodes.forEach(c => walk(c, s));
                parentOut.appendChild(s);
            } else if (tag === 'br') {
                parentOut.appendChild(document.createElement('br'));
            } else {
                node.childNodes.forEach(c => walk(c, parentOut));
            }
        };
        tmp.childNodes.forEach(c => walk(c, out));
        const html = out.innerHTML;
        return /<strong/i.test(html) ? html : '';
    },

    labelPlainText: function (str) {
        return String(str || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    },

    getLabelTextEl: function (div) {
        if (!div) return null;
        return div.querySelector('.anno-leader-text') || div;
    },

    syncLabelFromDOM: function (data, div) {
        const textEl = this.getLabelTextEl(div);
        data.text = this.labelPlainText(textEl.innerText || '');
        const rich = this.sanitizeLabelRichHtml(textEl.innerHTML);
        if (rich) data.textRich = rich;
        else delete data.textRich;
    },

    applyLabelToDOM: function (div, data) {
        const textEl = this.getLabelTextEl(div);
        if (data.textRich) textEl.innerHTML = data.textRich;
        else textEl.textContent = data.text != null ? String(data.text) : '';
    },

    /** 折叠态 UI；短文测高后可能隐藏按钮。编辑中强制展开。 */
    measureFirstLineWidth: function (textEl) {
        if (!textEl) return 0;
        try {
            const range = document.createRange();
            range.selectNodeContents(textEl);
            const rects = range.getClientRects();
            if (!rects || !rects.length) return textEl.getBoundingClientRect().width || 0;
            const top = rects[0].top;
            let left = rects[0].left;
            let right = rects[0].right;
            for (let i = 1; i < rects.length; i++) {
                const r = rects[i];
                if (Math.abs(r.top - top) > 0.75) break;
                left = Math.min(left, r.left);
                right = Math.max(right, r.right);
            }
            return Math.max(0, right - left);
        } catch (_e) {
            return 0;
        }
    },

    /** 与 CSS max-width 对齐：桌面 min(88vw,360)，手机为近全屏宽的 80%（封顶 576） */
    getLabelMaxWidthPx: function () {
        const vw = Math.max(1, window.innerWidth || 1);
        try {
            if (window.matchMedia && window.matchMedia('(max-width: 899px)').matches) {
                return Math.min(Math.max(0, vw - 4) * 0.8, 576);
            }
        } catch (_e) {}
        return Math.min(vw * 0.88, 360);
    },

    invalidateExpandedWidth: function (data) {
        if (!data) return;
        try { delete data._labelExpandedWidthPx; } catch (_e) { data._labelExpandedWidthPx = null; }
        try { delete data._labelCircleDiameterPx; } catch (_e2) { data._labelCircleDiameterPx = null; }
    },

    isCircleLabel: function (data) {
        return !!(data && data.labelShape === 'circle');
    },

    /**
     * 圆形标签：正圆、小内边距、文字居中、隐藏收起；直径随内容变大（最小约 18px）。
     * 矩形：去掉 is-circle，清 inline 宽高后交还现有折叠/展开逻辑。
     */
    applyLabelShapeUI: function (data) {
        const div = data && data.domEl;
        if (!div) return;
        const textEl = this.getLabelTextEl(div);
        const btn = div.querySelector('.anno-collapse-btn');
        const editing = div.classList.contains('editing');
        if (!this.isCircleLabel(data)) {
            div.classList.remove('is-circle');
            div.style.height = '';
            div.style.minWidth = '';
            div.style.minHeight = '';
            if (!editing) {
                // 宽由 applyCollapsedUI / refreshCollapseButton 接管
            }
            return;
        }
        data.collapsed = false;
        div.classList.remove('collapsed');
        div.classList.add('is-circle');
        if (btn) btn.style.display = 'none';
        div.classList.remove('has-collapse-btn');
        if (textEl) {
            textEl.style.width = '';
            textEl.style.height = '';
        }
        // 每次重算直径，避免改 padding/字号后仍用旧缓存导致单字不居中
        try { delete data._labelCircleDiameterPx; } catch (_eE) { data._labelCircleDiameterPx = null; }
        let d = 0;
        const prevW = div.style.width;
        const prevH = div.style.height;
        const prevMinW = div.style.minWidth;
        const prevMinH = div.style.minHeight;
        try {
            div.style.width = 'max-content';
            div.style.height = 'auto';
            div.style.minWidth = '';
            div.style.minHeight = '';
            void div.offsetWidth;
            let w = Math.ceil(div.getBoundingClientRect().width);
            let h = Math.ceil(div.getBoundingClientRect().height);
            try {
                if (textEl) {
                    const cs = window.getComputedStyle(div);
                    const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0)
                        + (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0);
                    const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0)
                        + (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
                    // 用文字内容盒尺寸，避免 line-height 把单字圆拉成竖椭圆观感
                    const tw = Math.ceil(textEl.scrollWidth || textEl.offsetWidth || 0);
                    const th = Math.ceil(textEl.scrollHeight || textEl.offsetHeight || 0);
                    const content = Math.max(tw, th);
                    w = Math.max(w, content + padX);
                    h = Math.max(h, content + padY);
                }
            } catch (_ePad) {}
            d = Math.max(18, w, h);
            if (!editing && d > 1) data._labelCircleDiameterPx = d;
        } catch (_eM) {
            d = 18;
        } finally {
            if (!(d > 1)) {
                div.style.width = prevW;
                div.style.height = prevH;
                div.style.minWidth = prevMinW;
                div.style.minHeight = prevMinH;
            }
        }
        if (d > 1) {
            div.style.width = d + 'px';
            div.style.height = d + 'px';
            div.style.minWidth = d + 'px';
            div.style.minHeight = d + 'px';
        }
    },

    /**
     * 展开宽只算一次（会话内）：短文跟内容，长文封顶 maxW。
     * 折叠/拖动不得冲掉 _labelExpandedWidthPx。
     * 注意：标签是 absolute + left 居中，width:auto 的 shrink-to-fit 可用宽约半屏，
     * 绝不能直接 getBoundingClientRect；必须用 max-content 测固有宽再封顶。
     */
    ensureExpandedWidthPx: function (data) {
        if (!data) return 0;
        if (this.isCircleLabel(data)) return 0;
        const cached = data._labelExpandedWidthPx;
        if (cached > 0 && isFinite(cached)) return cached;
        const div = data.domEl;
        const textEl = this.getLabelTextEl(div);
        if (!div || !textEl) return 0;
        if (div.classList.contains('editing')) return 0;
        const wasCollapsed = div.classList.contains('collapsed');
        const prevDivW = div.style.width;
        const prevTextW = textEl.style.width;
        const prevMaxW = div.style.maxWidth;
        try {
            div.classList.remove('collapsed');
            textEl.style.width = '';
            div.style.maxWidth = 'none';
            div.style.width = 'max-content';
            void div.offsetWidth;
            let natural = Math.ceil(div.getBoundingClientRect().width);
            try {
                const cs = window.getComputedStyle(div);
                const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0)
                    + (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0);
                const sw = Math.ceil((textEl.scrollWidth || 0) + pad);
                if (sw > natural) natural = sw;
            } catch (_ePad) {}
            const maxW = Math.floor(this.getLabelMaxWidthPx());
            let w = natural;
            if (maxW > 0 && w > maxW) w = maxW;
            // 未布局完成时不缓存，留给下次 ensure 再测
            if (!(w > 1)) return 0;
            data._labelExpandedWidthPx = w;
            return w;
        } catch (_e) {
            return 0;
        } finally {
            if (wasCollapsed) div.classList.add('collapsed');
            else div.classList.remove('collapsed');
            div.style.maxWidth = prevMaxW;
            div.style.width = prevDivW;
            textEl.style.width = prevTextW;
        }
    },

    applyExpandedWidthStyle: function (data) {
        const div = data && data.domEl;
        if (!div) return;
        if (this.isCircleLabel(data)) {
            this.applyLabelShapeUI(data);
            return;
        }
        const w = this.ensureExpandedWidthPx(data);
        if (w > 0) div.style.width = w + 'px';
    },

    applyCollapsedUI: function (data) {
        const div = data && data.domEl;
        if (!div) return;
        if (this.isCircleLabel(data)) {
            this.applyLabelShapeUI(data);
            return;
        }
        const textEl = this.getLabelTextEl(div);
        const btn = div.querySelector('.anno-collapse-btn');
        const editing = div.classList.contains('editing');
        const collapsed = !editing && !!data.collapsed;
        if (editing) {
            if (textEl) textEl.style.width = '';
            div.classList.remove('collapsed');
            if (btn) {
                btn.textContent = '\u2212';
                btn.setAttribute('aria-label', '收起');
                btn.setAttribute('title', '收起');
            }
            return;
        }
        // 先确保有展开基准宽，再改展示形态（折叠不得 delete 基准）
        this.ensureExpandedWidthPx(data);
        if (textEl) textEl.style.width = '';
        if (collapsed) {
            // 在展开宽下测首行，避免与全文换行无关的 shrink-to-fit 漂移
            div.classList.remove('collapsed');
            this.applyExpandedWidthStyle(data);
            void div.offsetWidth;
            const w = textEl ? this.measureFirstLineWidth(textEl) : 0;
            div.style.width = '';
            div.classList.add('collapsed');
            if (textEl && w > 0) textEl.style.width = Math.ceil(w) + 'px';
        } else {
            div.classList.remove('collapsed');
            this.applyExpandedWidthStyle(data);
        }
        if (btn) {
            btn.textContent = collapsed ? '\u22EF\u00BB' : '\u2212';
            btn.setAttribute('aria-label', collapsed ? '展开' : '收起');
            btn.setAttribute('title', collapsed ? '展开全文' : '收起');
        }
    },

    refreshCollapseButton: function (data) {
        const div = data && data.domEl;
        if (!div) return;
        if (this.isCircleLabel(data)) {
            this.applyLabelShapeUI(data);
            return;
        }
        const textEl = this.getLabelTextEl(div);
        const btn = div.querySelector('.anno-collapse-btn');
        if (!btn || !textEl) return;
        if (div.classList.contains('editing')) {
            btn.style.display = 'none';
            div.classList.remove('collapsed');
            textEl.style.width = '';
            return;
        }
        const wasCollapsed = div.classList.contains('collapsed');
        div.classList.remove('collapsed');
        div.classList.add('has-collapse-btn');
        // 用稳定展开宽测高，避免宽度未锁定时 scrollHeight 抖动
        this.ensureExpandedWidthPx(data);
        this.applyExpandedWidthStyle(data);
        const cs = window.getComputedStyle(textEl);
        let lineH = parseFloat(cs.lineHeight);
        if (!lineH || !isFinite(lineH)) {
            const fs = parseFloat(cs.fontSize) || 11;
            lineH = fs * 1.45;
        }
        const h = textEl.scrollHeight;
        const needsBtn = h > lineH * 1.5 + 1;
        btn.style.display = needsBtn ? '' : 'none';
        div.classList.toggle('has-collapse-btn', needsBtn);
        if (wasCollapsed && needsBtn) div.classList.add('collapsed');
        this.applyCollapsedUI(data);
        if (!needsBtn) {
            data.collapsed = false;
            div.classList.remove('collapsed');
            this.applyExpandedWidthStyle(data);
        }
    },

    toggleCollapsed: function (data) {
        if (!data) return;
        if (this.isCircleLabel(data)) return;
        data.collapsed = !data.collapsed;
        this.applyCollapsedUI(data);
        this.refreshCollapseButton(data);
        window.needsUpdate = true;
        if (!window.__SOLID_CONSUMER__) {
            try { if (typeof window.markDraftDirty === 'function') window.markDraftDirty(); } catch (_e) {}
        }
    },

    _isUnderRoot: function (obj, root) {
        let cur = obj;
        while (cur) {
            if (cur === root) return true;
            cur = cur.parent;
        }
        return false;
    },
    _worldNormalFromHit: function (hit) {
        return hit.face
            ? hit.face.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld)).normalize()
            : new THREE.Vector3(0, 1, 0);
    },
    _raycastHitOnParent: function (clientX, clientY, parentObj) {
        if (!parentObj || !this._cachedCamera || !this._cachedScene) return null;
        if (!this._raycaster) this._raycaster = new THREE.Raycaster();
        if (!this._ndc) this._ndc = new THREE.Vector2();
        this._ndc.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
        this._raycaster.setFromCamera(this._ndc, this._cachedCamera);
        const intersects = this._raycaster.intersectObjects(this._cachedScene.children, true)
            .filter(res => res.object.isMesh && res.object.visible && res.object.name !== 'transformControl' && !(res.object.name && res.object.name.includes('helper')));
        for (let i = 0; i < intersects.length; i++) {
            const res = intersects[i];
            if (res.object === parentObj || this._isUnderRoot(res.object, parentObj)) return res;
        }
        return null;
    },
    _canInteractAnchorDrag: function (data, e) {
        if (window.__SOLID_CONSUMER__) return false;
        if (this.isPlacing) return false;
        if (data.domEl && data.domEl.classList.contains('editing')) return false;
        if (window.PluginManager && window.PluginManager.shouldBlockAnnoSelection(e)) return false;
        if (e && e.button != null && e.button !== 0) return false;
        if (this.selectedId !== data.id) return false;
        return true;
    },
    _applyAnchorFromWorldHit: function (data, worldPoint, worldNormal) {
        const anchor = data.anchorObj;
        const parent = anchor && anchor.parent;
        if (!parent || !worldPoint) return;
        anchor.position.copy(parent.worldToLocal(worldPoint.clone()));
        if (worldNormal) {
            const localNormalPt = parent.worldToLocal(worldPoint.clone().add(worldNormal));
            anchor.userData.localNormal = localNormalPt.sub(anchor.position).normalize();
        }
    },
    _pauseOrbitForAnchorDrag: function () {
        if (this._anchorDragOrbitWasEnabled !== null) return;
        try {
            if (window.controls) {
                this._anchorDragOrbitWasEnabled = !!window.controls.enabled;
                window.controls.enabled = false;
            } else { this._anchorDragOrbitWasEnabled = null; }
        } catch (_e) { this._anchorDragOrbitWasEnabled = null; }
    },
    _resumeOrbitForAnchorDrag: function () {
        if (this._anchorDragOrbitWasEnabled !== null) {
            try { if (window.controls) window.controls.enabled = this._anchorDragOrbitWasEnabled; } catch (_e2) {}
            this._anchorDragOrbitWasEnabled = null;
        }
    },
    _syncAnchorHandle: function (data, isSelected) {
        if (!data) return;
        const canDrag = isSelected && !window.__SOLID_CONSUMER__;
        const dragging = !!(this._anchorDrag && this._anchorDrag.dataId === data.id);
        const dotR = canDrag ? this.ANCHOR_DOT_R_SEL : this.ANCHOR_DOT_R;
        if (data.svgCircle) data.svgCircle.setAttribute('r', String(dotR));
        if (data.svgAnchorRing) {
            data.svgAnchorRing.setAttribute('r', String(this.ANCHOR_RING_R));
            data.svgAnchorRing.setAttribute('stroke', data.color);
            data.svgAnchorRing.style.pointerEvents = canDrag ? 'auto' : 'none';
            data.svgAnchorRing.style.cursor = dragging ? 'grabbing' : (canDrag ? 'grab' : 'default');
        }
    },
    _ensureAnchorHandlesSvg: function () {
        this.ensureDOM();
        const layer = document.getElementById('anno-layer');
        if (!layer) return null;
        let handles = document.getElementById('anno-anchor-handles');
        if (!handles) {
            const ns = 'http://www.w3.org/2000/svg';
            handles = document.createElementNS(ns, 'svg');
            handles.id = 'anno-anchor-handles';
            handles.setAttribute('style', 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:100001;overflow:visible;');
            layer.appendChild(handles);
        }
        return handles;
    },
    _createAnchorRingElement: function (data, handlesSvg) {
        const ns = 'http://www.w3.org/2000/svg';
        const mgr = this;
        const ring = document.createElementNS(ns, 'circle');
        ring.setAttribute('r', String(this.ANCHOR_RING_R));
        ring.setAttribute('fill', 'transparent');
        ring.setAttribute('stroke', data.color);
        ring.setAttribute('stroke-width', '1.5');
        ring.setAttribute('opacity', '0.85');
        ring.style.pointerEvents = 'none';
        ring.style.display = 'none';
        ring.addEventListener('pointerdown', e => { mgr._beginAnchorDrag(data, e); }, { passive: false });
        handlesSvg.appendChild(ring);
        data.svgAnchorRing = ring;
    },
    /** 锚点拖动手柄置于 #anno-layer 顶层，避免被标签 div 挡住；热更新场景补建 */
    _ensureAnchorRing: function (data) {
        if (!data || window.__SOLID_CONSUMER__) return;
        const handlesSvg = this._ensureAnchorHandlesSvg();
        if (!handlesSvg) return;
        if (data.svgAnchorRing && data.svgAnchorRing.parentNode === handlesSvg) return;
        if (data.svgAnchorRing && data.svgAnchorRing.parentNode) {
            data.svgAnchorRing.remove();
            data.svgAnchorRing = null;
        }
        if (!data.svgAnchorRing) this._createAnchorRingElement(data, handlesSvg);
    },
    _cleanupAnchorDragListeners: function () {
        const st = this._anchorDrag;
        if (!st || !st.captureEl) return;
        if (st.onMove) {
            try { st.captureEl.removeEventListener('pointermove', st.onMove, { passive: false }); } catch (_e1) { try { st.captureEl.removeEventListener('pointermove', st.onMove); } catch (_e1b) {} }
        }
        if (st.onUp) {
            st.captureEl.removeEventListener('pointerup', st.onUp);
            st.captureEl.removeEventListener('pointercancel', st.onUp);
        }
    },
    _cancelAnchorDrag: function () {
        const st = this._anchorDrag;
        if (!st) return;
        this._cleanupAnchorDragListeners();
        this._anchorDrag = null;
        this._resumeOrbitForAnchorDrag();
    },
    _endAnchorDrag: function (e) {
        const st = this._anchorDrag;
        if (!st) return;
        if (e && st.pointerId !== undefined && e.pointerId !== undefined && e.pointerId !== st.pointerId) return;
        const data = window.annoDataList.find(a => a.id === st.dataId);
        this._cleanupAnchorDragListeners();
        if (st.captureEl && e) { try { st.captureEl.releasePointerCapture(e.pointerId); } catch (_eRel) {} }
        const moved = st.moved;
        this._anchorDrag = null;
        this._resumeOrbitForAnchorDrag();
        if (data) this._syncAnchorHandle(data, this.selectedId === data.id);
        if (moved) {
            window.needsUpdate = true;
            window.lightMoved = true;
            try { if (typeof window.markDraftDirty === 'function') window.markDraftDirty(); } catch (_e) {}
        }
    },
    _moveAnchorDrag: function (e) {
        const st = this._anchorDrag;
        if (!st || !e) return;
        if (st.pointerId !== undefined && e.pointerId !== undefined && e.pointerId !== st.pointerId) return;
        const data = window.annoDataList.find(a => a.id === st.dataId);
        if (!data || !data.anchorObj || !data.anchorObj.parent) return;
        const hit = this._raycastHitOnParent(e.clientX, e.clientY, data.anchorObj.parent);
        if (!hit) return;
        const wn = this._worldNormalFromHit(hit);
        this._applyAnchorFromWorldHit(data, hit.point, wn);
        st.moved = true;
        window.needsUpdate = true;
        try { if (e.cancelable) e.preventDefault(); } catch (_ePrev) {}
    },
    _beginAnchorDrag: function (data, e) {
        if (!this._canInteractAnchorDrag(data, e)) return;
        if (this._anchorDrag) this._endAnchorDrag(e);
        e.stopPropagation();
        e.preventDefault();
        const captureEl = e.currentTarget;
        const onMove = ev => this._moveAnchorDrag(ev);
        const onUp = ev => this._endAnchorDrag(ev);
        this._anchorDrag = { dataId: data.id, pointerId: e.pointerId, captureEl: captureEl, onMove: onMove, onUp: onUp, moved: false };
        this._syncAnchorHandle(data, true);
        this._pauseOrbitForAnchorDrag();
        try { captureEl.setPointerCapture(e.pointerId); } catch (_eCap) {}
        captureEl.addEventListener('pointermove', onMove, { passive: false });
        captureEl.addEventListener('pointerup', onUp);
        captureEl.addEventListener('pointercancel', onUp);
    },

    highlightSelected: function () {
        document.querySelectorAll('.anno-dom').forEach(el => {
            el.style.boxShadow = 'none';
            el.style.borderColor = el.dataset.color || '#00d2ff';
            el.style.zIndex = '99999';
        });
        window.annoDataList.forEach(data => {
            this._ensureAnchorRing(data);
            this._syncAnchorHandle(data, false);
        });
        const picker = document.getElementById('obj-color-picker');
        if (this.selectedId !== null) {
            const el = document.getElementById('dom_' + this.selectedId);
            const data = window.annoDataList.find(a => a.id === this.selectedId);
            if (el) {
                el.style.boxShadow = '0 0 10px rgba(255, 255, 255, 0.8)';
                el.style.borderColor = '#fff';
                el.style.zIndex = '100000';
            }
            if (data) {
                this._ensureAnchorRing(data);
                this._syncAnchorHandle(data, true);
                if (picker) picker.value = data.color;
            }
        }
        if (picker) {
            picker.disabled = false;
            picker.style.opacity = '1';
            picker.style.cursor = 'pointer';
        }
    },

    ensureDOM: function () {
        const cssText = `
                    #anno-layer { position: absolute; top: 0; left: 0; width: 100vw; height: 100vh; pointer-events: none; z-index: 50 !important; overflow: hidden; }
                    #anno-svg { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; }
                    #anno-anchor-handles { position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 100001 !important; overflow: visible; }
                    .anno-dom { position: absolute; transform: translate(-50%, -50%); pointer-events: auto; font-family: 'Inter', sans-serif; }
                    .anno-leader-label { border: 1px solid #0df; color: #fff; padding: 4px 8px; font-size: 11px; line-height: 1.45; box-sizing: border-box; text-align: left; max-width: min(88vw, 360px); cursor: pointer; user-select: none; border-radius: 2px; transition: opacity 0.2s; display: inline-block; vertical-align: top; touch-action: none; -webkit-user-select: none; }
                    .anno-leader-label.is-circle { border-radius: 50%; padding: 1px; text-align: center; display: inline-flex; align-items: center; justify-content: center; max-width: none; overflow: hidden; line-height: 1; }
                    .anno-leader-label.is-circle .anno-leader-text { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; max-width: 100%; margin: 0; padding: 0; box-sizing: border-box; text-align: center; line-height: 1; white-space: pre-wrap; word-break: break-word; }
                    .anno-leader-label.is-circle .anno-collapse-btn { display: none !important; }
                    .anno-leader-label.is-circle.editing { padding: 2px !important; display: inline-flex !important; align-items: center; justify-content: center; max-height: none; overflow: visible; line-height: 1; }
                    .anno-leader-label.is-circle.editing .anno-leader-text { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; outline: none; }
                    .anno-leader-label.has-collapse-btn { /* − 叠右上角，不占独立一列 */ }
                    .anno-leader-text { display: block; white-space: pre-wrap; word-break: break-word; max-width: 100%; box-sizing: border-box; }
                    .anno-leader-label.collapsed { width: fit-content; max-width: min(88vw, 360px); padding-right: 30px; }
                    .anno-leader-label.collapsed .anno-leader-text { max-height: 1.45em; overflow: hidden; }
                    .anno-collapse-btn { position: absolute; top: 2px; right: 2px; z-index: 2; display: inline-flex; align-items: center; justify-content: center; width: auto; height: calc(11px * 1.45); min-width: calc(11px * 1.45); min-height: calc(11px * 1.45); margin: 0; padding: 0 3px; border: none; border-radius: 2px; background: rgba(0,0,0,0.28); color: #fff; font-size: 14px; font-weight: 700; line-height: 1; text-align: center; cursor: pointer; pointer-events: auto; -webkit-tap-highlight-color: transparent; user-select: none; box-sizing: border-box; }
                    .anno-leader-label.collapsed .anno-collapse-btn { top: 50%; right: 4px; transform: translateY(-50%); font-size: 15px; font-weight: 600; padding: 0 4px; letter-spacing: 0; }
                    .anno-collapse-btn:active { background: rgba(0,0,0,0.45); }
                    .anno-leader-label strong { font-weight: 700; }
                    .anno-leader-label.editing { background: #fff !important; color: #000; outline: none; border-color: #fff !important; box-shadow: 0 0 10px rgba(0,210,255,0.5) !important; user-select: text !important; cursor: text !important; max-height: min(50vh, 320px); overflow-y: auto; -webkit-overflow-scrolling: touch; padding-right: 8px; display: inline-block; touch-action: auto; }
                    .anno-leader-label.editing .anno-leader-text { max-height: none; overflow: visible; outline: none; width: auto !important; }
                    .anno-leader-label.editing .anno-collapse-btn { display: none !important; }
                    .anno-leader-label.editing strong { font-weight: 700; }
                    @media (max-width: 899px) {
                      .anno-leader-label:not(.collapsed) { max-width: min(calc((100vw - 4px) * 0.8), 576px); }
                      .anno-leader-label.collapsed { max-width: min(calc((100vw - 4px) * 0.8), 576px); padding-right: 32px; }
                    }
                `;
        let style = document.getElementById('anno-style-inject');
        if (!style) {
            style = document.createElement('style');
            style.id = 'anno-style-inject';
            document.head.appendChild(style);
        }
        style.innerHTML = cssText;
        if (!document.getElementById('anno-layer')) {
            const layer = document.createElement('div');
            layer.id = 'anno-layer';
            layer.innerHTML = '<svg id="anno-svg"></svg>';
            document.body.appendChild(layer);
        }
    },

    createLeader: function (targetObj, worldPoint, worldNormal) {
        try {
            this.ensureDOM();
            window.annoCounter++;
            const id = 'anno_' + Date.now() + '_' + window.annoCounter;
            const anchor = new THREE.Object3D();
            targetObj.worldToLocal(anchor.position.copy(worldPoint));
            anchor.name = id;
            if (worldNormal) {
                const localNormalPt = targetObj.worldToLocal(worldPoint.clone().add(worldNormal));
                anchor.userData.localNormal = localNormalPt.sub(anchor.position).normalize();
            } else {
                anchor.userData.localNormal = new THREE.Vector3(0, 1, 0);
            }
            targetObj.add(anchor);
            const color = document.getElementById('obj-color-picker')?.value || '#00d2ff';
            const annoData = {
                id, targetUUID: targetObj.uuid, anchorObj: anchor,
                text: '引线 ' + window.annoCounter, detailText: '', collapsed: false, color, dx: 0, dy: 0, dxN: 0, dyN: 0, dxW: 0, dyW: 0, isOccluded: false
            };
            window.annoDataList.push(annoData);
            this.buildDOM(annoData);
            window.needsUpdate = true;
            window.lightMoved = true;
            if (window.PluginManager && typeof window.PluginManager.setExclusiveSelection === 'function') {
                window.PluginManager.setExclusiveSelection(this, id);
            } else {
                this.selectedId = id;
                this.highlightSelected();
            }
        } catch (e) { console.error(e); }
    },

    buildDOM: function (data) {
        const layer = document.getElementById('anno-layer');
        const svg = document.getElementById('anno-svg');
        const div = document.createElement('div');
        div.className = 'anno-dom anno-leader-label';
        div.id = 'dom_' + data.id;
        const textEl = document.createElement('div');
        textEl.className = 'anno-leader-text';
        div.appendChild(textEl);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'anno-collapse-btn';
        btn.textContent = '\u2212';
        btn.setAttribute('aria-label', '收起');
        btn.style.display = 'none';
        div.appendChild(btn);
        data.domEl = div;
        this.applyLabelToDOM(div, data);
        div.style.borderColor = data.color;
        div.style.backgroundColor = this.getDarkBg(data.color);
        div.dataset.color = data.color;
        const onCollapsePointer = (e) => {
            e.preventDefault();
            e.stopPropagation();
            window.AnnotationManager.toggleCollapsed(data);
        };
        btn.addEventListener('pointerdown', onCollapsePointer);
        btn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
        div.addEventListener('click', e => { e.stopPropagation(); });
        div.addEventListener('dblclick', e => {
            if (window.__SOLID_CONSUMER__) return;
            if (e.target === btn || (btn.contains && btn.contains(e.target))) return;
            e.stopPropagation();
            if (window.PluginManager && typeof window.PluginManager.setExclusiveSelection === 'function') {
                window.PluginManager.setExclusiveSelection(window.AnnotationManager, data.id);
            } else {
                window.AnnotationManager.selectedId = data.id;
                window.AnnotationManager.highlightSelected();
            }
            window.AnnotationManager.applyLabelToDOM(div, data);
            div.classList.add('editing');
            div.classList.remove('collapsed');
            textEl.style.width = '';
            if (!window.AnnotationManager.isCircleLabel(data)) {
                div.style.width = '';
                div.style.height = '';
                div.style.minWidth = '';
                div.style.minHeight = '';
            } else {
                window.AnnotationManager.applyLabelShapeUI(data);
            }
            btn.style.display = 'none';
            textEl.contentEditable = true;
            textEl.style.cursor = 'text';
            div.style.cursor = 'text';
            textEl.focus();
            const selection = window.getSelection();
            const range = document.createRange();
            range.selectNodeContents(textEl);
            selection.removeAllRanges();
            selection.addRange(range);
        });
        textEl.addEventListener('blur', () => {
            window.AnnotationManager.syncLabelFromDOM(data, div);
            textEl.contentEditable = false;
            div.classList.remove('editing');
            div.style.cursor = 'pointer';
            textEl.style.cursor = '';
            window.AnnotationManager.applyLabelToDOM(div, data);
            window.AnnotationManager.invalidateExpandedWidth(data);
            if (window.AnnotationManager.isCircleLabel(data)) {
                window.AnnotationManager.applyLabelShapeUI(data);
            } else {
                window.AnnotationManager.refreshCollapseButton(data);
            }
            window.needsUpdate = true;
        });
        textEl.addEventListener('paste', (e) => {
            if (!textEl.isContentEditable) return;
            e.preventDefault();
            try {
                const raw = (e.clipboardData || window.clipboardData).getData('text/plain');
                if (raw == null) return;
                const plain = String(raw).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
                document.execCommand('insertText', false, plain);
            } catch (_e) {}
        });
        textEl.addEventListener('keydown', e => {
            if (textEl.isContentEditable && (e.key === 'b' || e.key === 'B') && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                e.stopPropagation();
                try { window.AnnotationManager.toggleLabelBoldWithColor(textEl); } catch (_eBold) {}
                return;
            }
            if (e.key === 'Delete' || e.key === 'Backspace') e.stopPropagation();
            if (textEl.isContentEditable && e.key === 'Enter') e.stopPropagation();
        });
        // 拖动：生产端 mouse；消费端 pointer 绑在标签上（勿挂 window 非 passive，避免手机卡死）
        // 4A：只改内存 dx/dy，不写 JSON
        let isDragging = false, startX, startY, startDx, startDy, isMoved = false;
        let dragPointerId = null, pendingConsumerTap = false, orbitWasEnabled = null;
        function solidAnnoApplyLabelDrag(clientX, clientY) {
            const vw = Math.max(1, window.__solidAnnoViewportW || window.innerWidth || 1);
            const vh = Math.max(1, window.__solidAnnoViewportH || window.innerHeight || 1);
            data.dx = startDx + (clientX - startX);
            data.dy = startDy + (clientY - startY);
            data.dxN = data.dx / vw;
            data.dyN = data.dy / vh;
            try {
                const cam = window.AnnotationManager._cachedCamera;
                if (cam && data.anchorObj) {
                    const px = window.AnnotationManager._pxPerWorldAtAnchor(cam, data.anchorObj);
                    if (px && px.pxPerWorldX > 1e-6 && px.pxPerWorldY > 1e-6) {
                        data.dxW = data.dx / px.pxPerWorldX;
                        data.dyW = data.dy / px.pxPerWorldY;
                    }
                }
            } catch (_e) {}
            window.needsUpdate = true;
        }
        function solidAnnoPauseOrbit() {
            if (orbitWasEnabled !== null) return;
            try {
                if (window.controls) {
                    orbitWasEnabled = !!window.controls.enabled;
                    window.controls.enabled = false;
                }
            } catch (_e) {}
            try { window.__solidAnnoLabelDragging = true; } catch (_e2) {}
        }
        function solidAnnoResumeOrbit() {
            try { window.__solidAnnoLabelDragging = false; } catch (_e) {}
            if (orbitWasEnabled !== null) {
                try { if (window.controls) window.controls.enabled = orbitWasEnabled; } catch (_e2) {}
                orbitWasEnabled = null;
            }
        }
        function solidAnnoLockLabelWidth() {
            // 用会话内展开基准宽，禁止中途 getBoundingClientRect 重算
            try {
                if (data.collapsed) return;
                window.AnnotationManager.applyExpandedWidthStyle(data);
            } catch (_e) {}
        }
        function solidAnnoUnlockLabelWidth() {
            // 销毁清理：不冲掉其它逻辑；DOM 即将移除
            try { window.AnnotationManager.applyCollapsedUI(data); } catch (_e2) {}
        }
        function solidAnnoConsumerToggleSelect() {
            if (window.PluginManager && typeof window.PluginManager.setExclusiveSelection === 'function') {
                if (window.AnnotationManager.selectedId === data.id) {
                    window.PluginManager.setExclusiveSelection(window.AnnotationManager, null);
                } else {
                    window.PluginManager.setExclusiveSelection(window.AnnotationManager, data.id);
                }
            }
        }
        if (window.__SOLID_CONSUMER__) {
            const onPtrMove = e => {
                if (!isDragging) return;
                if (dragPointerId != null && e.pointerId !== dragPointerId) return;
                if (Math.abs(e.clientX - startX) > 3 || Math.abs(e.clientY - startY) > 3) {
                    if (!isMoved) {
                        isMoved = true;
                        pendingConsumerTap = false;
                        solidAnnoLockLabelWidth();
                        solidAnnoPauseOrbit();
                    }
                }
                if (!isMoved) return;
                try { if (e.cancelable) e.preventDefault(); } catch (_ePrev) {}
                solidAnnoApplyLabelDrag(e.clientX, e.clientY);
            };
            const onPtrUp = e => {
                if (!isDragging) return;
                if (dragPointerId != null && e.pointerId !== dragPointerId) return;
                const doTap = pendingConsumerTap && !isMoved;
                isDragging = false;
                dragPointerId = null;
                pendingConsumerTap = false;
                try { div.releasePointerCapture(e.pointerId); } catch (_eRel) {}
                solidAnnoResumeOrbit();
                // 拖完后保持锁定宽度，避免 inline-block 松手后 shrink-to-fit 重算变宽/变窄
                if (doTap) solidAnnoConsumerToggleSelect();
            };
            div.addEventListener('pointerdown', e => {
                if (window.PluginManager && window.PluginManager.shouldBlockAnnoSelection(e)) return;
                if (e.target === btn || (btn.contains && btn.contains(e.target))) return;
                if (e.button != null && e.button !== 0) return;
                isDragging = true;
                isMoved = false;
                dragPointerId = e.pointerId;
                startX = e.clientX;
                startY = e.clientY;
                startDx = data.dx;
                startDy = data.dy;
                pendingConsumerTap = true;
                try { div.setPointerCapture(e.pointerId); } catch (_eCap) {}
                e.stopPropagation();
                if (e.pointerType === 'touch' || e.pointerType === 'pen') {
                    try { e.preventDefault(); } catch (_ePrev2) {}
                }
            }, { passive: false });
            div.addEventListener('pointermove', onPtrMove, { passive: false });
            div.addEventListener('pointerup', onPtrUp);
            div.addEventListener('pointercancel', onPtrUp);
            data.cleanupEvents = () => {
                try { div.removeEventListener('pointermove', onPtrMove, { passive: false }); } catch (_e1) { try { div.removeEventListener('pointermove', onPtrMove); } catch (_e1b) {} }
                div.removeEventListener('pointerup', onPtrUp);
                div.removeEventListener('pointercancel', onPtrUp);
                isDragging = false;
                dragPointerId = null;
                pendingConsumerTap = false;
                solidAnnoResumeOrbit();
                solidAnnoUnlockLabelWidth();
            };
        } else {
            div.addEventListener('pointerdown', e => {
                if (window.PluginManager && window.PluginManager.shouldBlockAnnoSelection(e)) return;
                if (e.target === btn || (btn.contains && btn.contains(e.target))) return;
                e.stopPropagation();
                if (!textEl.isContentEditable) {
                    if (window.PluginManager && typeof window.PluginManager.setExclusiveSelection === 'function') {
                        window.PluginManager.setExclusiveSelection(window.AnnotationManager, data.id);
                    } else {
                        window.AnnotationManager.selectedId = data.id;
                        window.AnnotationManager.highlightSelected();
                    }
                }
            });
            div.addEventListener('mousedown', e => {
                if (e.target === btn || (btn.contains && btn.contains(e.target))) return;
                if (textEl.isContentEditable) { e.stopPropagation(); return; }
                isDragging = true;
                isMoved = false;
                startX = e.clientX;
                startY = e.clientY;
                startDx = data.dx;
                startDy = data.dy;
                e.stopPropagation();
            });
            const onMouseMove = e => {
                if (!isDragging) return;
                if (Math.abs(e.clientX - startX) > 3 || Math.abs(e.clientY - startY) > 3) {
                    if (!isMoved) {
                        isMoved = true;
                        solidAnnoLockLabelWidth();
                    }
                }
                if (!isMoved) return;
                solidAnnoApplyLabelDrag(e.clientX, e.clientY);
            };
            const onMouseUp = () => { isDragging = false; };
            window.addEventListener('mousemove', onMouseMove);
            window.addEventListener('mouseup', onMouseUp);
            data.cleanupEvents = () => {
                window.removeEventListener('mousemove', onMouseMove);
                window.removeEventListener('mouseup', onMouseUp);
            };
        }
        layer.appendChild(div);
        const ns = 'http://www.w3.org/2000/svg';
        const glowPath = document.createElementNS(ns, 'path');
        glowPath.setAttribute('fill', 'none');
        glowPath.setAttribute('stroke', data.color);
        glowPath.setAttribute('stroke-width', '6');
        glowPath.setAttribute('opacity', '0.2');
        svg.appendChild(glowPath);
        data.svgGlowPath = glowPath;
        const path = document.createElementNS(ns, 'path');
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', data.color);
        path.setAttribute('stroke-width', '1.5');
        svg.appendChild(path);
        data.svgPath = path;
        const circle = document.createElementNS(ns, 'circle');
        circle.setAttribute('r', String(window.AnnotationManager.ANCHOR_DOT_R));
        circle.setAttribute('fill', data.color);
        circle.style.pointerEvents = 'none';
        svg.appendChild(circle);
        data.svgCircle = circle;
        this._ensureAnchorRing(data);
        const scheduleCollapseRefresh = () => {
            try {
                if (window.AnnotationManager.isCircleLabel(data)) window.AnnotationManager.applyLabelShapeUI(data);
                else window.AnnotationManager.refreshCollapseButton(data);
            } catch (_e) {}
        };
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(() => requestAnimationFrame(scheduleCollapseRefresh));
        } else {
            setTimeout(scheduleCollapseRefresh, 0);
        }
    },

    updateScreenPositions: function (camera) {
        if (window.annoDataList.length === 0) return;
        this._cachedCamera = camera;
        if (!this._poolInit) {
            this._tempV = new THREE.Vector3();
            this._normalMatrix = new THREE.Matrix3();
            this._viewDir = new THREE.Vector3();
            this._currentWorldNormal = new THREE.Vector3();
            this._rightW = new THREE.Vector3();
            this._upW = new THREE.Vector3();
            this._scratchW = new THREE.Vector3();
            this._poolInit = true;
        }
        window.annoDataList.forEach(data => {
            if (!data.anchorObj) return;
            data.anchorObj.getWorldPosition(this._tempV);
            const dist = camera.position.distanceTo(this._tempV);
            const safeDist = Math.max(dist, 0.1);
            const modelScaleX = data.anchorObj.parent ? data.anchorObj.parent.scale.x : 1;
            if (!data.baseDist) {
                data.baseDist = safeDist;
                data.baseScale = modelScaleX;
            }
            let lineScale = (data.baseDist / safeDist) * (modelScaleX / data.baseScale);
            lineScale = Math.max(0.1, Math.min(lineScale, 10.0));
            data.currentScale = lineScale;
            const textScale = 1.0;
            if (data.anchorObj.parent && data.anchorObj.userData.localNormal) {
                this._normalMatrix.getNormalMatrix(data.anchorObj.parent.matrixWorld);
                this._currentWorldNormal.copy(data.anchorObj.userData.localNormal).applyMatrix3(this._normalMatrix).normalize();
                this._viewDir.copy(camera.position).sub(this._tempV).normalize();
                data.isOccluded = this._currentWorldNormal.dot(this._viewDir) < (typeof data.occludeDot === 'number' && isFinite(data.occludeDot) ? data.occludeDot : -0.05);
            } else {
                data.isOccluded = false;
            }
            this._tempV.project(camera);
            const isBehind = this._tempV.z > 1.0 || this._tempV.z < -1.0;
            const x = (this._tempV.x * 0.5 + 0.5) * window.innerWidth;
            const y = (-(this._tempV.y * 0.5) + 0.5) * window.innerHeight;
            const opacity = isBehind ? '0' : (data.isOccluded ? '0.2' : '1');
            const pointerEvents = (isBehind || data.isOccluded) ? 'none' : 'auto';
            // 形态一致：优先用“跟模型走”的长度（dxW/dyW），让 PC/手机看到的相对比例一致
            const px = this._pxPerWorldAtAnchor(camera, data.anchorObj);
            const hasWorld = (typeof data.dxW === 'number') || (typeof data.dyW === 'number');
            const scaledDx = hasWorld && px ? (Number(data.dxW || 0) * px.pxPerWorldX) : ((typeof data.dx === 'number' ? data.dx : 0) * lineScale);
            const scaledDy = hasWorld && px ? (Number(data.dyW || 0) * px.pxPerWorldY) : ((typeof data.dy === 'number' ? data.dy : 0) * lineScale);
            data.screenX = x;
            data.screenY = y;
            data.scaledDx = scaledDx;
            data.scaledDy = scaledDy;
            data.isBehind = isBehind;
            // 同步回像素缓存，保证后续拖拽以当前视图为基准
            data.dx = scaledDx;
            data.dy = scaledDy;
            if (data.domEl) {
                data.domEl.style.left = (x + scaledDx) + 'px';
                data.domEl.style.top = (y + scaledDy) + 'px';
                data.domEl.style.opacity = opacity;
                data.domEl.style.pointerEvents = pointerEvents;
                data.domEl.style.transform = `translate(-50%, -50%) scale(${textScale})`;
            }
            if (data.svgPath && data.svgCircle && !isNaN(x)) {
                if (!isBehind && !data.isOccluded) {
                    const x1 = x + scaledDx;
                    const y1 = y + scaledDy;
                    const midX = x + scaledDx * 0.5;
                    const dStr = `M ${x} ${y} L ${midX} ${y1} L ${x1} ${y1}`;
                    if (data.svgGlowPath) {
                        data.svgGlowPath.setAttribute('d', dStr);
                        data.svgGlowPath.setAttribute('opacity', '0.2');
                    }
                    data.svgPath.setAttribute('d', dStr);
                    data.svgPath.setAttribute('opacity', '0.8');
                    data.svgCircle.setAttribute('cx', x);
                    data.svgCircle.setAttribute('cy', y);
                    data.svgCircle.setAttribute('opacity', '0.8');
                    if (this.selectedId === data.id || data.svgAnchorRing) this._ensureAnchorRing(data);
                    if (data.svgAnchorRing) {
                        const canDrag = this.selectedId === data.id && !window.__SOLID_CONSUMER__;
                        data.svgAnchorRing.setAttribute('cx', String(x));
                        data.svgAnchorRing.setAttribute('cy', String(y));
                        data.svgAnchorRing.setAttribute('opacity', '0.85');
                        data.svgAnchorRing.style.display = canDrag ? '' : 'none';
                    }
                } else {
                    if (data.svgGlowPath) data.svgGlowPath.setAttribute('opacity', '0');
                    data.svgPath.setAttribute('opacity', '0');
                    data.svgCircle.setAttribute('opacity', '0');
                    if (data.svgAnchorRing) data.svgAnchorRing.style.display = 'none';
                }
            }
        });
    },

    clearAll: function () {
        this._cancelAnchorDrag();
        window.annoDataList.forEach(data => {
            if (data.cleanupEvents) data.cleanupEvents();
            if (data.anchorObj && data.anchorObj.parent) data.anchorObj.parent.remove(data.anchorObj);
        });
        window.annoDataList = [];
        const layer = document.getElementById('anno-layer');
        if (layer) layer.querySelectorAll('.anno-dom').forEach(el => el.remove());
        const svg = document.getElementById('anno-svg');
        if (svg) svg.innerHTML = '';
        const handlesSvg = document.getElementById('anno-anchor-handles');
        if (handlesSvg) handlesSvg.innerHTML = '';
        this.selectedId = null;
    },

    restoreAnnotations: function (obj, annos) {
        if (!annos) return;
        this.ensureDOM();
        annos.forEach(a => {
            window.annoCounter++;
            const vw = Math.max(1, window.__solidAnnoViewportW || window.innerWidth || 1);
            const vh = Math.max(1, window.__solidAnnoViewportH || window.innerHeight || 1);
            const _dxN = (typeof a.dxN === 'number') ? a.dxN : null;
            const _dyN = (typeof a.dyN === 'number') ? a.dyN : null;
            const _dx = (_dxN !== null) ? (_dxN * vw) : (a.dx || 0);
            const _dy = (_dyN !== null) ? (_dyN * vh) : (a.dy || 0);
            const anchor = new THREE.Object3D();
            anchor.position.set(a.localPos[0], a.localPos[1], a.localPos[2]);
            anchor.name = a.id;
            anchor.userData.localNormal = a.localNormal
                ? new THREE.Vector3(a.localNormal[0], a.localNormal[1], a.localNormal[2])
                : new THREE.Vector3(0, 1, 0);
            obj.add(anchor);
            const _loadedRich = a.textRich ? this.sanitizeLabelRichHtml(String(a.textRich)) : '';
            const annoData = {
                id: a.id, targetUUID: obj.uuid, anchorObj: anchor,
                text: a.text || '引线',
                detailText: a.detailText != null ? String(a.detailText) : '',
                collapsed: a.collapsed === true,
                color: a.color || '#00d2ff',
                dx: _dx,
                dy: _dy,
                dxN: (_dxN !== null) ? _dxN : (typeof _dx === 'number' ? (_dx / vw) : 0),
                dyN: (_dyN !== null) ? _dyN : (typeof _dy === 'number' ? (_dy / vh) : 0),
                dxW: (typeof a.dxW === 'number') ? a.dxW : 0,
                dyW: (typeof a.dyW === 'number') ? a.dyW : 0,
                isOccluded: false
            };
            if (_loadedRich) annoData.textRich = _loadedRich;
            if (a.labelShape === 'circle') annoData.labelShape = 'circle';
            if (a.baseDist) annoData.baseDist = a.baseDist;
            if (a.baseScale) annoData.baseScale = a.baseScale;
            if (typeof a.occludeDot === 'number' && isFinite(a.occludeDot)) annoData.occludeDot = a.occludeDot;
            window.annoDataList.push(annoData);
            this.buildDOM(annoData);
        });
    },

    getDetailText: function (id) {
        const data = window.annoDataList.find(a => a.id === id);
        return data ? (data.detailText || '') : '';
    }
};

// 以锚点处的“1个世界单位”换算成多少像素：用于让引线长度跟模型保持一致
window.AnnotationManager._pxPerWorldAtAnchor = function(camera, anchorObj) {
    try {
        if (!camera || !anchorObj) return null;
        if (!this._scratchW) this._scratchW = new THREE.Vector3();
        if (!this._rightW) this._rightW = new THREE.Vector3();
        if (!this._upW) this._upW = new THREE.Vector3();
        const p0 = this._tempV || new THREE.Vector3();
        anchorObj.getWorldPosition(p0);
        this._rightW.set(1, 0, 0).applyQuaternion(camera.quaternion).normalize();
        this._upW.set(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
        const toPx = (w) => {
            const v = this._scratchW.copy(w).project(camera);
            return { x: (v.x * 0.5 + 0.5) * window.innerWidth, y: (-(v.y * 0.5) + 0.5) * window.innerHeight };
        };
        const a = toPx(p0);
        const b = toPx(p0.clone().add(this._rightW));
        const c = toPx(p0.clone().add(this._upW));
        const pxPerWorldX = Math.max(1e-6, Math.hypot(b.x - a.x, b.y - a.y));
        const pxPerWorldY = Math.max(1e-6, Math.hypot(c.x - a.x, c.y - a.y));
        return { pxPerWorldX, pxPerWorldY };
    } catch (_e) { return null; }
};

window.addEventListener('keydown', e => {
    if (e.key !== 'Delete') return;
    if (document.activeElement && document.activeElement.isContentEditable) return;
    const id = window.AnnotationManager.selectedId;
    if (id === null) return;
    const idx = window.annoDataList.findIndex(a => a.id === id);
    if (idx > -1) {
        const data = window.annoDataList[idx];
        if (window.AnnotationManager._anchorDrag && window.AnnotationManager._anchorDrag.dataId === id) {
            window.AnnotationManager._cancelAnchorDrag();
        }
        if (data.anchorObj && data.anchorObj.parent) data.anchorObj.parent.remove(data.anchorObj);
        const div = document.getElementById('dom_' + id);
        if (div) div.remove();
        if (data.svgGlowPath) data.svgGlowPath.remove();
        if (data.svgPath) data.svgPath.remove();
        if (data.svgCircle) data.svgCircle.remove();
        if (data.svgAnchorRing) data.svgAnchorRing.remove();
        if (data.cleanupEvents) data.cleanupEvents();
        window.annoDataList.splice(idx, 1);
        window.needsUpdate = true;
        window.lightMoved = true;
    }
    window.AnnotationManager.selectedId = null;
});

const colorPicker = document.getElementById('obj-color-picker');
if (colorPicker) {
    colorPicker.addEventListener('input', e => {
        const id = window.AnnotationManager.selectedId;
        if (id === null) return;
        const data = window.annoDataList.find(a => a.id === id);
        if (!data) return;
        data.color = e.target.value;
        const div = document.getElementById('dom_' + id);
        if (div) {
            div.dataset.color = data.color;
            div.style.backgroundColor = window.AnnotationManager.getDarkBg(data.color);
        }
        if (data.svgPath) data.svgPath.setAttribute('stroke', data.color);
        if (data.svgGlowPath) data.svgGlowPath.setAttribute('stroke', data.color);
        if (data.svgCircle) data.svgCircle.setAttribute('fill', data.color);
        if (data.svgAnchorRing) data.svgAnchorRing.setAttribute('stroke', data.color);
        window.needsUpdate = true;
    });
}

window.AnnotationManager.onUpdate = function (context) {
    this._cachedScene = context.scene;
    if (window.showAnnotations !== false && context.camera) {
        this.updateScreenPositions(context.camera);
    }
};

if (window.PluginManager) window.PluginManager.register('Annotation_UI', window.AnnotationManager);
