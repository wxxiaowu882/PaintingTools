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

    function forceWebKitFilterRebind(el, fRef) {
        if (!el) return;
        try { el.style.webkitFilter = 'none'; el.style.filter = 'none'; } catch (_e0) {}
        try { void el.offsetWidth; } catch (_e1) {}
        try { el.style.webkitFilter = fRef; el.style.filter = fRef; } catch (_e2) {}
    }

    // iOS：滑块高频调用 apply 时做 rAF 合帧，避免在 WebKit 上出现“滞后追帧 + 反复无效重绘”的浪费。
    let iosApplyRaf = 0;
    let iosPendingLevels = null;
    function scheduleIosApply(levels) {
        iosPendingLevels = levels;
        if (iosApplyRaf) return;
        iosApplyRaf = requestAnimationFrame(() => {
            iosApplyRaf = 0;
            const v = iosPendingLevels;
            iosPendingLevels = null;
            if (v == null) return;
            applyNow(v);
        });
    }

    function applyNow(levels) {
        window.posterizeLevel = levels;
        const canvasContainer = getContainer();
        const targetCanvas = getTargetCanvas(canvasContainer);
        if (!canvasContainer) return;

        // 缓存：避免同一 levels 重复触发 WebKit 的昂贵重绘链路
        if (window.__solidPosterizeLastLevels === levels && levels !== 0) {
            // iOS 下仍可能需要强制 copy 一次（例如上一帧 overlay 未准备好）
            if (isIosHost() && window.__solidPosterizeForceNextIosCopy) {
                try { refreshOverlayFromWebGL(); } catch (_e) {}
            }
        } else {
            window.__solidPosterizeLastLevels = levels;
        }

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

            // 仅当 tableStr 变化时才更新 SVG filter（避免 iOS 上频繁 clone 带来的重排）
            if (window.__solidPosterizeLastTableStr !== tableStr) {
                window.__solidPosterizeLastTableStr = tableStr;
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
                const fRef = 'url(#posterize-filter)';
                if (isIosHost()) {
                    const ov = ensureOverlay();
                    if (ov) {
                        ov.style.zIndex = '';
                        ov.style.display = 'block';
                        // WebKit 核心修复：强制重新绑定 filter，避免“tableValues 已更新但画面不变”
                        forceWebKitFilterRebind(ov, fRef);
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
                        // 强制至少拷贝 1~2 帧，避免 overlay 像素仍是旧帧造成“滑块没反应”的错觉
                        window.__solidPosterizeForceNextIosCopy = true;
                        window.__solidPosterizeAccSkipTick = 0;
                        try { refreshOverlayFromWebGL(); } catch (_e0) {}
                        requestAnimationFrame(() => { try { refreshOverlayFromWebGL(); } catch (_e1) {} });
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

    function apply(levels) {
        // iOS：合帧以减少 WebKit 下的“追帧重绘浪费”，并提升 slider 反馈一致性
        if (isIosHost()) {
            scheduleIosApply(levels);
            return;
        }
        applyNow(levels);
    }

    function init(options) {
        const opts = options || {};
        if (opts.containerId) state.containerId = String(opts.containerId);
        if (Object.prototype.hasOwnProperty.call(opts, 'iosHost')) state.iosHost = !!opts.iosHost;
        if (typeof opts.getLogger === 'function') state.getLogger = opts.getLogger;
    }

    window.PosterizeShared = { init, apply, syncLayout, ensureOverlay, refreshOverlayFromWebGL };
})();

