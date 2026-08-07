/**
 * 童画师讲解（对外显示名；字段仍为 meta.keyPoints / keyPointsRich）
 * - meta.keyPoints / meta.keyPointsRich（与 meta.detail 列表摘要分离）
 * - 消费端：右上固定按钮 + 阅读板；打开/关闭不碰追光
 * - 生产端：bindProducerEditor 富文本编辑
 */
(function () {
    'use strict';

    const STYLE_ID = 'solid-scene-keypoints-style';
    const BTN_ID = 'solid-scene-keypoints-btn';
    const MODAL_ID = 'solid-scene-keypoints-modal';
    const BODY_ID = 'solid-scene-keypoints-body';

    let _inited = false;
    let _hasContent = false;
    let _orbitWasEnabled = null;

    function plainText(str) {
        // contenteditable 空行常变成 \n\n\n；消费端 pre-wrap 会显示成两行空，压成最多一个空行
        return String(str || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n{3,}/g, '\n\n');
    }

    function lastOutIsBr(parentOut) {
        const last = parentOut && parentOut.lastChild;
        return !!(last && last.nodeType === Node.ELEMENT_NODE && last.tagName === 'BR');
    }

    function normalizeHexColor(input) {
        if (!input) return '';
        let s = String(input).trim();
        if (!s) return '';
        if (s[0] !== '#') s = '#' + s;
        if (/^#[0-9a-fA-F]{3}$/.test(s)) {
            return ('#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]).toLowerCase();
        }
        if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
        if (/^#[0-9a-fA-F]{8}$/.test(s)) return ('#' + s.slice(1, 7)).toLowerCase();
        return '';
    }

    function parseColorToHex(s) {
        if (!s) return '';
        s = String(s).trim();
        const hex = normalizeHexColor(s);
        if (hex) return hex;
        const m = s.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
        if (!m) return '';
        const clamp = (n) => Math.max(0, Math.min(255, parseInt(n, 10) || 0));
        const r = clamp(m[1]), g = clamp(m[2]), b = clamp(m[3]);
        return '#' + [r, g, b].map(x => x.toString(16).padStart(2, '0')).join('');
    }

    function extractElementColor(node) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) return '';
        try {
            if (node.style && node.style.color) {
                const hex = parseColorToHex(node.style.color);
                if (hex) return hex;
            }
        } catch (_e) {}
        const style = node.getAttribute('style') || '';
        const hexMatch = style.match(/(?:^|;)\s*color\s*:\s*(#[0-9a-fA-F]{3,8})/i);
        if (hexMatch) {
            const hex = normalizeHexColor(hexMatch[1]);
            if (hex) return hex;
        }
        const rgbMatch = style.match(/(?:^|;)\s*color\s*:\s*rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
        if (rgbMatch) {
            return parseColorToHex('rgb(' + rgbMatch[1] + ',' + rgbMatch[2] + ',' + rgbMatch[3] + ')');
        }
        return '';
    }

    function isBoldStyleElement(node) {
        if (!node || node.nodeType !== Node.ELEMENT_NODE) return false;
        const tag = node.tagName.toLowerCase();
        if (tag === 'strong' || tag === 'b') return true;
        if (tag === 'span') {
            const fw = node.style && node.style.fontWeight;
            return fw === 'bold' || fw === '700' || (fw && parseInt(fw, 10) >= 700);
        }
        return false;
    }

    function appendBr(parentOut) {
        if (!parentOut) return;
        parentOut.appendChild(document.createElement('br'));
    }

    /** 文本中的 \\n 一律变成 br（消费端 rich 用 white-space:normal 时，裸 \\n 会被折叠成空格） */
    function appendTextWithBreaks(parentOut, text) {
        const parts = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
        for (let i = 0; i < parts.length; i++) {
            if (parts[i]) parentOut.appendChild(document.createTextNode(parts[i]));
            if (i < parts.length - 1) appendBr(parentOut);
        }
    }

    /** 白名单：strong(+color) / br；块级展平为内容 + br；文本换行转为 br */
    function sanitizeKeyPointsRichHtml(rawHtml) {
        if (!rawHtml) return '';
        const tmp = document.createElement('div');
        tmp.innerHTML = String(rawHtml);
        const out = document.createElement('div');

        const walk = (node, parentOut) => {
            if (node.nodeType === Node.TEXT_NODE) {
                appendTextWithBreaks(parentOut, node.textContent);
                return;
            }
            if (node.nodeType !== Node.ELEMENT_NODE) return;
            const tag = node.tagName.toLowerCase();
            if (tag === 'strong' || tag === 'b' || isBoldStyleElement(node)) {
                const s = document.createElement('strong');
                const hex = extractElementColor(node);
                if (hex) s.style.color = hex;
                node.childNodes.forEach(c => walk(c, s));
                parentOut.appendChild(s);
            } else if (tag === 'br') {
                appendBr(parentOut);
            } else if (tag === 'div' || tag === 'p' || tag === 'li') {
                // 裸文本后接块级时，Chrome 常见「第一行 + <div>第二行</div>」——块前必须补 br，否则会拼成一行
                if (parentOut.childNodes.length > 0 && !lastOutIsBr(parentOut)) {
                    appendBr(parentOut);
                }
                const beforeLen = parentOut.childNodes.length;
                node.childNodes.forEach(c => walk(c, parentOut));
                if (parentOut.childNodes.length === beforeLen) {
                    // 空块（含仅占位的空行）
                    appendBr(parentOut);
                } else if (!lastOutIsBr(parentOut)) {
                    appendBr(parentOut);
                }
            } else {
                node.childNodes.forEach(c => walk(c, parentOut));
            }
        };
        tmp.childNodes.forEach(c => walk(c, out));
        while (out.lastChild && out.lastChild.nodeType === Node.ELEMENT_NODE && out.lastChild.tagName === 'BR') {
            out.removeChild(out.lastChild);
        }
        // 连续 br 最多保留 2 个（一个空行）
        const nodes = Array.prototype.slice.call(out.childNodes);
        let run = 0;
        nodes.forEach(n => {
            if (n.nodeType === Node.ELEMENT_NODE && n.tagName === 'BR') {
                run++;
                if (run > 2 && n.parentNode) n.parentNode.removeChild(n);
            } else {
                run = 0;
            }
        });
        const html = out.innerHTML;
        return /<strong/i.test(html) ? html : '';
    }

    /** 纯文本回填编辑器：用 br 表达换行，避免只靠 textContent+\\n 在部分路径丢失 */
    function plainToEditorHtml(plain) {
        const p = plainText(plain);
        if (!p) return '';
        const div = document.createElement('div');
        appendTextWithBreaks(div, p);
        return div.innerHTML;
    }

    function plainFromHtml(htmlOrEl) {
        if (!htmlOrEl) return '';
        if (typeof htmlOrEl === 'string') {
            const d = document.createElement('div');
            d.innerHTML = htmlOrEl;
            return plainText(d.innerText || '');
        }
        return plainText(htmlOrEl.innerText || '');
    }

    function metaHasKeyPoints(meta) {
        if (!meta || typeof meta !== 'object') return false;
        const plain = plainText(meta.keyPoints != null ? meta.keyPoints : '');
        const rich = meta.keyPointsRich != null ? sanitizeKeyPointsRichHtml(String(meta.keyPointsRich)) : '';
        return !!(plain.trim() || rich);
    }

    function injectStyle() {
        if (document.getElementById(STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = `
            /* 与三杠同列同热区；三杠为 flex-end 右贴齐，圆标同样右对齐才视觉落同一竖列 */
            #${BTN_ID} {
                position: fixed;
                top: 64px;
                right: 20px;
                width: 44px;
                height: 44px;
                display: none;
                align-items: center;
                justify-content: flex-end;
                box-sizing: border-box;
                padding: 0;
                margin: 0;
                cursor: pointer;
                z-index: 7002;
                background: transparent;
                color: #ffd966;
                border: none;
                border-radius: 0;
                box-shadow: none;
                opacity: 0.92;
                transform: translateY(calc(env(safe-area-inset-top, 0px) - 16px));
                -webkit-tap-highlight-color: transparent;
                user-select: none;
                transition: opacity 0.2s ease;
            }
            #${BTN_ID} .solid-kp-badge {
                width: 26px;
                height: 26px;
                border-radius: 50%;
                box-sizing: border-box;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                border: 1px solid rgba(255, 217, 102, 0.55);
                background: rgba(255, 217, 102, 0.12);
                color: #ffd966;
                animation: solid-kp-badge-pulse 2.8s ease-in-out infinite;
            }
            #${BTN_ID}:hover .solid-kp-badge {
                border-color: rgba(255, 217, 102, 0.85);
                background: rgba(255, 217, 102, 0.2);
                color: #ffe9a8;
            }
            #${BTN_ID}.solid-kp-visible { display: flex; }
            #${BTN_ID} svg {
                width: 15px;
                height: 15px;
                display: block;
                pointer-events: none;
            }
            @keyframes solid-kp-badge-pulse {
                0%, 100% { box-shadow: 0 0 0 0 rgba(255, 217, 102, 0); }
                50% { box-shadow: 0 0 0 3px rgba(255, 217, 102, 0.18); }
            }
            body.immersive-mode #${BTN_ID} {
                opacity: 0 !important;
                pointer-events: none !important;
            }
            #${MODAL_ID} {
                display: none;
                position: fixed;
                inset: 0;
                z-index: 7100;
                background: rgba(0, 0, 0, 0.55);
                align-items: center;
                justify-content: center;
                padding: 16px;
                box-sizing: border-box;
                opacity: 0;
                transition: opacity 0.25s ease;
            }
            #${MODAL_ID}.solid-kp-open {
                display: flex;
                opacity: 1;
            }
            #${MODAL_ID} .solid-kp-panel {
                position: relative;
                width: min(92vw, 440px);
                max-height: min(70vh, 560px);
                background: rgba(18, 18, 20, 0.94);
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: 12px;
                box-shadow: 0 12px 40px rgba(0, 0, 0, 0.55);
                display: flex;
                flex-direction: column;
                overflow: hidden;
                font-family: 'Inter', 'Microsoft YaHei', 'PingFang SC', sans-serif;
            }
            @media (max-width: 899px) {
                #${MODAL_ID} {
                    align-items: flex-end;
                    padding: 0;
                }
                #${MODAL_ID} .solid-kp-panel {
                    width: 100%;
                    max-width: none;
                    max-height: 70vh;
                    border-radius: 14px 14px 0 0;
                    border-bottom: none;
                }
            }
            #${MODAL_ID} .solid-kp-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 12px 14px 8px 16px;
                flex-shrink: 0;
                border-bottom: 1px solid rgba(255, 255, 255, 0.08);
            }
            #${MODAL_ID} .solid-kp-title {
                color: rgba(255, 255, 255, 0.88);
                font-size: 14px;
                font-weight: 500;
                letter-spacing: 0.08em;
            }
            #${MODAL_ID} .solid-kp-close {
                width: 28px;
                height: 28px;
                border: none;
                border-radius: 6px;
                background: rgba(255, 255, 255, 0.08);
                color: rgba(255, 255, 255, 0.55);
                font-size: 18px;
                line-height: 28px;
                text-align: center;
                cursor: pointer;
                padding: 0;
                -webkit-tap-highlight-color: transparent;
            }
            #${MODAL_ID} .solid-kp-scroll {
                overflow-y: auto;
                overflow-x: hidden;
                -webkit-overflow-scrolling: touch;
                padding: 14px 16px 20px;
                flex: 1;
                min-height: 0;
            }
            #${BODY_ID} {
                margin: 0;
                color: rgba(220, 222, 228, 0.92);
                font-size: 14px;
                line-height: 1.65;
                font-weight: 300;
                white-space: pre-wrap;
                word-break: break-word;
            }
            #${BODY_ID} strong {
                font-weight: 700;
            }
            /* 生产端编辑区（由 bindProducerEditor 挂载） */
            .solid-kp-producer-wrap { display: flex; flex-direction: column; gap: 6px; }
            .solid-kp-producer-toolbar {
                display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
            }
            .solid-kp-producer-toolbar button {
                font-size: 11px; padding: 3px 8px; border-radius: 4px; cursor: pointer;
                background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.18);
                color: #eee;
            }
            .solid-kp-producer-toolbar button:active { background: rgba(255,255,255,0.16); }
            .solid-kp-producer-editor {
                min-height: 120px; max-height: 280px; overflow-y: auto;
                padding: 6px 8px; font-size: 11px; line-height: 1.45;
                background: rgba(0,0,0,0.45); border: 1px solid rgba(255,255,255,0.18);
                border-radius: 4px; color: #eee; outline: none;
                white-space: pre-wrap; word-break: break-word;
                -webkit-user-select: text; user-select: text;
            }
            .solid-kp-producer-editor:empty:before {
                content: attr(data-placeholder);
                color: rgba(255,255,255,0.28);
                pointer-events: none;
            }
        `;
        document.head.appendChild(style);
    }

    function ensureDom() {
        injectStyle();
        if (!document.getElementById(BTN_ID)) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.id = BTN_ID;
            btn.title = '童画师讲解';
            btn.setAttribute('aria-label', '童画师讲解');
            // 圆标 + 书页：与「?」同为圆标语言，黄系强调要点入口
            btn.innerHTML =
                '<span class="solid-kp-badge" aria-hidden="true">' +
                '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
                '<path d="M5 4.8c0-.44.36-.8.8-.8H12v16H5.8A.8.8 0 0 1 5 19.2V4.8Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>' +
                '<path d="M19 4.8c0-.44-.36-.8-.8-.8H12v16h6.2a.8.8 0 0 0 .8-.8V4.8Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>' +
                '<path d="M12 4v16" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
                '<path d="M7.2 8h2.2M7.2 11h2.2M14.6 8h2.2M14.6 11h2.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" opacity="0.85"/>' +
                '</svg>' +
                '</span>';
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                api.toggle();
            });
            document.body.appendChild(btn);
        }
        if (!document.getElementById(MODAL_ID)) {
            const modal = document.createElement('div');
            modal.id = MODAL_ID;
            modal.setAttribute('aria-hidden', 'true');
            modal.innerHTML =
                '<div class="solid-kp-panel" role="dialog" aria-modal="true" aria-labelledby="solid-kp-title">' +
                '<div class="solid-kp-header">' +
                '<span class="solid-kp-title" id="solid-kp-title">童画师讲解</span>' +
                '<button type="button" class="solid-kp-close" aria-label="关闭">×</button>' +
                '</div>' +
                '<div class="solid-kp-scroll"><div id="' + BODY_ID + '"></div></div>' +
                '</div>';
            modal.addEventListener('click', () => { api.close(); });
            const panel = modal.querySelector('.solid-kp-panel');
            if (panel) panel.addEventListener('click', (e) => { e.stopPropagation(); });
            const closeBtn = modal.querySelector('.solid-kp-close');
            if (closeBtn) closeBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); api.close(); });
            document.body.appendChild(modal);
        }
    }

    function pauseOrbitOnly() {
        if (_orbitWasEnabled !== null) return;
        try {
            if (window.controls) {
                _orbitWasEnabled = !!window.controls.enabled;
                window.controls.enabled = false;
            }
        } catch (_e) {}
    }

    function resumeOrbitOnly() {
        if (_orbitWasEnabled === null) return;
        try {
            if (window.controls) window.controls.enabled = _orbitWasEnabled;
        } catch (_e) {}
        _orbitWasEnabled = null;
    }

    function renderBody(meta) {
        const body = document.getElementById(BODY_ID);
        if (!body) return;
        const richRaw = meta && meta.keyPointsRich != null ? String(meta.keyPointsRich) : '';
        const rich = sanitizeKeyPointsRichHtml(richRaw);
        if (rich) {
            // pre-wrap：即使残留裸 \\n 也不会被折叠；正常 br 换行同样生效
            body.style.whiteSpace = 'pre-wrap';
            body.innerHTML = rich;
            return;
        }
        const plain = plainText(meta && meta.keyPoints != null ? meta.keyPoints : '');
        body.style.whiteSpace = 'pre-wrap';
        body.textContent = plain;
    }

    const api = {
        sanitizeKeyPointsRichHtml: sanitizeKeyPointsRichHtml,
        plainFromHtml: plainFromHtml,
        plainText: plainText,
        normalizeHexColor: normalizeHexColor,

        init: function () {
            if (_inited) return api;
            // 仅消费端挂按钮/阅读板；生产端只用 bindProducerEditor
            if (!window.__SOLID_CONSUMER__) return api;
            ensureDom();
            _inited = true;
            return api;
        },

        isOpen: function () {
            const modal = document.getElementById(MODAL_ID);
            return !!(modal && modal.classList.contains('solid-kp-open'));
        },

        syncFromScene: function (meta) {
            if (!window.__SOLID_CONSUMER__) return;
            this.init();
            if (!_inited) return;
            ensureDom();
            // 切场景先关面板，避免旧文残留；不碰追光
            this.close();
            const btn = document.getElementById(BTN_ID);
            _hasContent = metaHasKeyPoints(meta);
            if (!_hasContent) {
                if (btn) btn.classList.remove('solid-kp-visible');
                const body = document.getElementById(BODY_ID);
                if (body) { body.textContent = ''; body.innerHTML = ''; }
                return;
            }
            renderBody(meta || {});
            if (btn) btn.classList.add('solid-kp-visible');
        },

        open: function () {
            if (!_hasContent) return;
            this.init();
            ensureDom();
            const modal = document.getElementById(MODAL_ID);
            if (!modal) return;
            pauseOrbitOnly();
            modal.style.display = 'flex';
            modal.setAttribute('aria-hidden', 'false');
            requestAnimationFrame(() => {
                modal.classList.add('solid-kp-open');
            });
        },

        close: function () {
            const modal = document.getElementById(MODAL_ID);
            if (!modal) {
                resumeOrbitOnly();
                return;
            }
            modal.classList.remove('solid-kp-open');
            modal.setAttribute('aria-hidden', 'true');
            resumeOrbitOnly();
            setTimeout(() => {
                if (!modal.classList.contains('solid-kp-open')) {
                    modal.style.display = 'none';
                }
            }, 260);
        },

        toggle: function () {
            if (this.isOpen()) this.close();
            else this.open();
        },

        /** 从生产端编辑器读出存盘字段 */
        readProducerFields: function (editorEl) {
            if (!editorEl) return { keyPoints: '', keyPointsRich: '' };
            const keyPoints = plainFromHtml(editorEl);
            const keyPointsRich = sanitizeKeyPointsRichHtml(editorEl.innerHTML);
            return { keyPoints, keyPointsRich };
        },

        /** 回填生产端编辑器 */
        writeProducerFields: function (editorEl, meta) {
            if (!editorEl) return;
            const rich = meta && meta.keyPointsRich != null ? sanitizeKeyPointsRichHtml(String(meta.keyPointsRich)) : '';
            if (rich) {
                editorEl.innerHTML = rich;
                return;
            }
            const plain = plainText(meta && meta.keyPoints != null ? meta.keyPoints : '');
            editorEl.innerHTML = plainToEditorHtml(plain);
        },

        /**
         * 在 rootEl 内挂载工具条 + contenteditable
         * @returns {{ editorEl, getFields, setFields, destroy }}
         */
        bindProducerEditor: function (opts) {
            const rootEl = opts && opts.rootEl;
            const onDirty = opts && typeof opts.onDirty === 'function' ? opts.onDirty : null;
            if (!rootEl) return null;
            injectStyle();
            rootEl.innerHTML = '';
            rootEl.classList.add('solid-kp-producer-wrap');

            const toolbar = document.createElement('div');
            toolbar.className = 'solid-kp-producer-toolbar';
            const boldBtn = document.createElement('button');
            boldBtn.type = 'button';
            boldBtn.textContent = '粗体';
            boldBtn.title = '选中文字：有粗体则全部去粗去色；无粗体则全部加粗上色（Ctrl+B）';
            const colorLabel = document.createElement('label');
            colorLabel.style.cssText = 'display:inline-flex;align-items:center;gap:4px;font-size:11px;color:#bbb;';
            colorLabel.textContent = '粗体色';
            const colorInput = document.createElement('input');
            colorInput.type = 'color';
            colorInput.value = '#ffd966';
            colorInput.style.cssText = 'width:22px;height:22px;padding:0;border:none;background:none;cursor:pointer;';
            colorLabel.appendChild(colorInput);
            toolbar.appendChild(boldBtn);
            toolbar.appendChild(colorLabel);

            const editor = document.createElement('div');
            editor.className = 'solid-kp-producer-editor';
            editor.contentEditable = 'true';
            editor.setAttribute('data-placeholder', opts.placeholder || '写本场景要传达的知识（可较长）。列表简介请用上方「场景说明」。');
            editor.spellcheck = false;

            rootEl.appendChild(toolbar);
            rootEl.appendChild(editor);

            function getBoldColor() {
                return normalizeHexColor(colorInput.value) || '#ffd966';
            }

            function isBoldElement(el) {
                if (!el || el.nodeType !== Node.ELEMENT_NODE) return false;
                const tag = el.tagName.toLowerCase();
                if (tag === 'strong' || tag === 'b') return true;
                if (tag === 'span') {
                    const fw = el.style && el.style.fontWeight;
                    return fw === 'bold' || fw === '700' || (fw && parseInt(fw, 10) >= 700);
                }
                return false;
            }

            function nodeInEditor(node) {
                if (!node) return false;
                try {
                    if (node === editor) return true;
                    if (typeof editor.contains === 'function') return editor.contains(node);
                } catch (_e) {}
                return false;
            }

            /** 非空且落在编辑器内的选区；空选区返回 null */
            function getEditorRange() {
                const sel = window.getSelection();
                if (!sel || !sel.rangeCount) return null;
                const range = sel.getRangeAt(0);
                if (!range || range.collapsed) return null;
                if (!nodeInEditor(range.commonAncestorContainer)) return null;
                return range;
            }

            function ancestorHasBold(node) {
                let n = node;
                if (n && n.nodeType === Node.TEXT_NODE) n = n.parentNode;
                while (n && n !== editor) {
                    if (isBoldElement(n)) return true;
                    n = n.parentNode;
                }
                return false;
            }

            function fragmentHasBold(root) {
                if (!root) return false;
                if (root.nodeType === Node.ELEMENT_NODE && isBoldElement(root)) return true;
                if (typeof root.querySelectorAll !== 'function') {
                    if (root.childNodes) {
                        for (let i = 0; i < root.childNodes.length; i++) {
                            if (fragmentHasBold(root.childNodes[i])) return true;
                        }
                    }
                    return false;
                }
                if (root.querySelector('strong, b')) return true;
                const spans = root.querySelectorAll('span');
                for (let i = 0; i < spans.length; i++) {
                    if (isBoldElement(spans[i])) return true;
                }
                return false;
            }

            function rangeHasBold(range) {
                if (!range) return false;
                if (ancestorHasBold(range.startContainer) || ancestorHasBold(range.endContainer)) return true;
                try {
                    const cloned = range.cloneContents();
                    if (fragmentHasBold(cloned)) return true;
                } catch (_e) {}
                return false;
            }

            function unwrapElement(el) {
                if (!el || !el.parentNode) return;
                const parent = el.parentNode;
                while (el.firstChild) parent.insertBefore(el.firstChild, el);
                parent.removeChild(el);
            }

            function stripColorAndEmptyShells(el) {
                if (!el || el.nodeType !== Node.ELEMENT_NODE) return;
                try {
                    if (el.style) {
                        el.style.removeProperty('color');
                        if (el.style.fontWeight === 'normal' || el.style.fontWeight === '400') {
                            el.style.removeProperty('font-weight');
                        }
                    }
                    el.removeAttribute('color');
                    const st = el.getAttribute('style');
                    if (st != null && !String(st).replace(/[\s;]/g, '')) el.removeAttribute('style');
                    const tag = el.tagName.toLowerCase();
                    if ((tag === 'span' || tag === 'font') && !el.getAttribute('style') && !el.className && !el.id) {
                        unwrapElement(el);
                    }
                } catch (_e) {}
            }

            /** 展平块级、unwrap 粗体；stripColors 时清掉所有 color */
            function normalizeFragmentInline(frag, stripColors) {
                if (!frag) return;
                const kids = Array.prototype.slice.call(frag.childNodes || []);
                kids.forEach(node => {
                    if (node.nodeType !== Node.ELEMENT_NODE) return;
                    const tag = node.tagName.toLowerCase();
                    if (tag === 'div' || tag === 'p' || tag === 'li') {
                        normalizeFragmentInline(node, stripColors);
                        const parent = node.parentNode;
                        if (!parent) return;
                        while (node.firstChild) parent.insertBefore(node.firstChild, node);
                        parent.insertBefore(document.createElement('br'), node);
                        parent.removeChild(node);
                        return;
                    }
                    if (isBoldElement(node)) {
                        normalizeFragmentInline(node, stripColors);
                        if (stripColors) stripColorAndEmptyShells(node);
                        unwrapElement(node);
                        return;
                    }
                    normalizeFragmentInline(node, stripColors);
                    if (stripColors) stripColorAndEmptyShells(node);
                    else if (tag === 'span' || tag === 'font') stripColorAndEmptyShells(node);
                });
                // 去掉末尾多余 br
                while (frag.lastChild && frag.lastChild.nodeType === Node.ELEMENT_NODE && frag.lastChild.tagName === 'BR') {
                    if (frag.childNodes.length === 1) break;
                    frag.removeChild(frag.lastChild);
                }
            }

            function reselectNodes(first, last) {
                if (!first || !last) return;
                try {
                    const sel = window.getSelection();
                    if (!sel) return;
                    const nr = document.createRange();
                    nr.setStartBefore(first);
                    nr.setEndAfter(last);
                    sel.removeAllRanges();
                    sel.addRange(nr);
                } catch (_e) {}
            }

            function unboldSelection(range) {
                const frag = range.extractContents();
                normalizeFragmentInline(frag, true);
                try {
                    const list = Array.prototype.slice.call(
                        frag.querySelectorAll ? frag.querySelectorAll('span, font, strong, b') : []
                    );
                    list.forEach(el => {
                        if (!el.parentNode) return;
                        if (isBoldElement(el)) unwrapElement(el);
                        else stripColorAndEmptyShells(el);
                    });
                } catch (_e) {}
                const first = frag.firstChild;
                const last = frag.lastChild;
                range.insertNode(frag);
                reselectNodes(first, last);
            }

            function boldSelection(range) {
                const frag = range.extractContents();
                normalizeFragmentInline(frag, true);
                const strong = document.createElement('strong');
                strong.style.color = getBoldColor();
                while (frag.firstChild) strong.appendChild(frag.firstChild);
                if (!strong.childNodes.length) {
                    range.collapse(true);
                    return;
                }
                range.insertNode(strong);
                reselectNodes(strong, strong);
            }

            function cleanupEmptyFormatTags() {
                try {
                    editor.querySelectorAll('strong, b, span, font').forEach(el => {
                        if (!el || !el.parentNode) return;
                        if (el.childNodes.length === 0 || (el.textContent === '' && !el.querySelector('br'))) {
                            el.parentNode.removeChild(el);
                        }
                    });
                } catch (_e) {}
            }

            function toggleSelectionBold() {
                const range = getEditorRange();
                if (!range) return;
                if (rangeHasBold(range)) unboldSelection(range);
                else boldSelection(range);
                cleanupEmptyFormatTags();
                if (onDirty) onDirty();
            }

            boldBtn.addEventListener('mousedown', (e) => {
                e.preventDefault();
                toggleSelectionBold();
            });
            editor.addEventListener('input', () => { if (onDirty) onDirty(); });
            editor.addEventListener('keydown', (e) => {
                if ((e.key === 'b' || e.key === 'B') && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    toggleSelectionBold();
                }
            });
            editor.addEventListener('paste', (e) => {
                e.preventDefault();
                try {
                    const raw = (e.clipboardData || window.clipboardData).getData('text/plain');
                    if (raw == null) return;
                    const plain = plainText(String(raw));
                    document.execCommand('insertText', false, plain);
                } catch (_e) {}
                if (onDirty) onDirty();
            });

            return {
                editorEl: editor,
                getFields: function () {
                    return api.readProducerFields(editor);
                },
                setFields: function (meta) {
                    api.writeProducerFields(editor, meta || {});
                },
                destroy: function () {
                    try { rootEl.innerHTML = ''; } catch (_e) {}
                }
            };
        }
    };

    window.SolidSceneKeyPoints = api;
    // 不自动挂消费 UI：等 Solid 设好 __SOLID_CONSUMER__ 后由 syncFromScene / init 触发
})();
