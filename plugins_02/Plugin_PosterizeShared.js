(() => {
    const state = {
        containerId: 'canvas-container',
        iosHost: null,
        getLogger: null
    };

    function detectIosHost() {
        try {
            return /iPhone|iPad|iPod/i.test(navigator.userAgent || '') ||
                (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        } catch (_e) { return false; }
    }

    function isIosHost() {
        return state.iosHost === null ? detectIosHost() : !!state.iosHost;
    }

    function log(msg) {
        try {
            const logger = typeof state.getLogger === 'function' ? state.getLogger() : null;
            if (typeof logger === 'function') logger(msg);
        } catch (_e) {}
    }

    function getContainer() {
        return document.getElementById(state.containerId);
    }

    function getTargetCanvas(container) {
        return container ? container.querySelector('canvas:not(#posterize-2d-overlay)') : null;
    }

    function syncLayout() {
        const container = getContainer();
        const ov = document.getElementById('posterize-2d-overlay');
        const glc = getTargetCanvas(container);
        if (!ov || !glc) return;
        ov.style.width = glc.clientWidth + 'px';
        ov.style.height = glc.clientHeight + 'px';
    }

    function ensureOverlay() {
        const container = getContainer();
        if (!container) return null;
        let ov = document.getElementById('posterize-2d-overlay');
        if (ov) return ov;
        const glc = getTargetCanvas(container);
        if (!glc) return null;
        ov = document.createElement('canvas');
        ov.id = 'posterize-2d-overlay';
        ov.setAttribute('aria-hidden', 'true');
        ov.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;z-index:0;display:none';
        container.appendChild(ov);
        syncLayout();
        return ov;
    }

    function refreshOverlayFromWebGL() {
        if (!window.posterizeLevel) return;
        const ov = document.getElementById('posterize-2d-overlay');
        const container = getContainer();
        const glc = getTargetCanvas(container);
        if (!ov || !glc || ov.style.display === 'none') return;

        if (window.__solidPosterizeForceNextIosCopy) {
            window.__solidPosterizeForceNextIosCopy = false;
        } else {
            try {
                if (window.pathTracer && window.useAdvancedRender) {
                    const ts = (window._solidPt && window._solidPt.targetSamples) ? window._solidPt.targetSamples : 200;
                    if (window.pathTracer.samples < ts && !window._orbitInteracting) {
                        window.__solidPosterizeAccSkipTick = (window.__solidPosterizeAccSkipTick || 0) + 1;
                        if ((window.__solidPosterizeAccSkipTick % 2) === 0) return;
                    }
                }
            } catch (_eSkip) {}
        }

        const iosScale = window._orbitInteracting ? 0.56 : 1;
        const tw = Math.max(1, Math.floor(glc.width * iosScale));
        const th = Math.max(1, Math.floor(glc.height * iosScale));
        if (ov.width !== tw || ov.height !== th) {
            ov.width = tw;
            ov.height = th;
            ov._solidPosterize2dCtx = null;
        }

        let ctx = ov._solidPosterize2dCtx;
        if (!ctx) {
            try { ctx = ov.getContext('2d', { alpha: true, desynchronized: true }); }
            catch (_eCtx) { ctx = ov.getContext('2d'); }
            ov._solidPosterize2dCtx = ctx;
        }
        if (!ctx) return;
        try {
            if (iosScale >= 0.999) ctx.drawImage(glc, 0, 0);
            else ctx.drawImage(glc, 0, 0, glc.width, glc.height, 0, 0, tw, th);
        } catch (_eDraw) {}
    }

    function apply(levels) {
        window.posterizeLevel = levels;
        const canvasContainer = getContainer();
        const targetCanvas = getTargetCanvas(canvasContainer);
        if (!canvasContainer) return;

        if (levels === 0) {
            const po = document.getElementById('posterize-2d-overlay');
            if (po) {
                po.style.display = 'none';
                po.style.webkitFilter = 'none';
                po.style.filter = 'none';
                po._solidPosterize2dCtx = null;
            }
            window.__solidPosterizeForceNextIosCopy = false;
            window.__solidPosterizeAccSkipTick = 0;
            canvasContainer.style.isolation = '';
            canvasContainer.style.transform = '';
            canvasContainer.style.webkitFilter = 'none';
            canvasContainer.style.filter = 'none';
            if (targetCanvas) {
                targetCanvas.style.webkitFilter = 'none';
                targetCanvas.style.filter = 'none';
                targetCanvas.style.opacity = '';
                targetCanvas.style.position = '';
                targetCanvas.style.zIndex = '';
            }
            const poly3dLayer = document.getElementById('poly3d-layer');
            if (poly3dLayer) poly3dLayer.style.zIndex = '';
            log('[Engine-色阶] 已成功重置为空');
        } else {
            const denom = Math.max(1, levels - 1);
            const tableArr = [];
            for (let i = 0; i < levels; i++) tableArr.push((i / denom).toFixed(4));
            const tableStr = tableArr.join(',');

            const xfer = document.getElementById('posterize-transfer');
            if (xfer) {
                ['feFuncR', 'feFuncG', 'feFuncB'].forEach((tag) => {
                    const el = xfer.getElementsByTagName(tag)[0];
                    if (el) el.setAttribute('tableValues', tableStr);
                });
            }
            const filterNode = document.getElementById('posterize-filter');
            if (filterNode && filterNode.parentNode) {
                const clone = filterNode.cloneNode(true);
                filterNode.parentNode.replaceChild(clone, filterNode);
            }

            canvasContainer.style.isolation = '';
            canvasContainer.style.transform = '';
            canvasContainer.style.webkitFilter = 'none';
            canvasContainer.style.filter = 'none';
            if (targetCanvas) {
                targetCanvas.style.webkitFilter = 'none';
                targetCanvas.style.filter = 'none';
            }

            void canvasContainer.offsetWidth;
            requestAnimationFrame(() => {
                if (isIosHost()) {
                    const fRef = 'url(#posterize-filter)';
                    const ov = ensureOverlay();
                    if (ov) {
                        ov.style.zIndex = '';
                        ov.style.webkitFilter = fRef;
                        ov.style.filter = fRef;
                        ov.style.display = 'block';
                        if (targetCanvas) {
                            targetCanvas.style.opacity = '0';
                            targetCanvas.style.position = '';
                            targetCanvas.style.zIndex = '';
                        }
                        const poly3dLayer = document.getElementById('poly3d-layer');
                        if (poly3dLayer) {
                            poly3dLayer.style.zIndex = '';
                            if (poly3dLayer.parentNode === canvasContainer) canvasContainer.appendChild(poly3dLayer);
                        }
                        syncLayout();
                        window.__solidPosterizeForceNextIosCopy = true;
                        window.__solidPosterizeAccSkipTick = 0;
                        refreshOverlayFromWebGL();
                    }
                    log(`[Engine-色阶] iOS/WebKit：2D叠层 + 页内 CSS url(#posterize-filter), 阶梯: ${tableStr.substring(0, 20)}...`);
                } else {
                    const po = document.getElementById('posterize-2d-overlay');
                    if (po) {
                        po.style.display = 'none';
                        po.style.webkitFilter = 'none';
                        po.style.filter = 'none';
                        po._solidPosterize2dCtx = null;
                    }
                    if (targetCanvas) {
                        targetCanvas.style.opacity = '';
                        targetCanvas.style.position = '';
                        targetCanvas.style.zIndex = '';
                    }
                    const poly3dLayer = document.getElementById('poly3d-layer');
                    if (poly3dLayer) poly3dLayer.style.zIndex = '';
                    const fRef = 'url(#posterize-filter)';
                    canvasContainer.style.webkitFilter = fRef;
                    canvasContainer.style.filter = fRef;
                    log(`[Engine-色阶] PC：#canvas-container + 页内 ${fRef}，阶梯: ${tableStr.substring(0, 20)}...`);
                }
            });
        }

        const slider = document.getElementById('posterizeSlider');
        const valDisp = document.getElementById('posterizeVal');
        if (slider && valDisp) {
            const sliderVal = levels === 0 ? 0 : (21 - levels);
            slider.value = sliderVal;
            valDisp.innerText = levels === 0 ? '无' : levels + '阶';
        }
    }

    function init(options) {
        const opts = options || {};
        if (opts.containerId) state.containerId = String(opts.containerId);
        if (Object.prototype.hasOwnProperty.call(opts, 'iosHost')) state.iosHost = !!opts.iosHost;
        if (typeof opts.getLogger === 'function') state.getLogger = opts.getLogger;
    }

    window.PosterizeShared = { init, apply, syncLayout, ensureOverlay, refreshOverlayFromWebGL };
})();

