/**
 * plugin-bezier.js — 贝塞尔曲线标注（model-viewer / pointsData）
 * type: "bezier"；projected:false 可编辑锚点+柄（SVG C）；projected:true 贴面折线（SVG L）
 * 语义对齐 Solid Plugin_DashedLine，宿主用 positionAndNormalFromPoint，不引入 Three。
 */
(function () {
    const DEFAULTS = {
        strokeWidth: 4.5,
        opacity: 0.9,
        capR: 6.5,
        lineStyle: 'dashed',
        strokeMin: 1,
        strokeMax: 6,
        opacityMin: 0.15,
        opacityMax: 1,
        capRMin: 0.5,
        capRMax: 12,
        lineStyles: { dashed: '6, 6', solid: 'none', dotted: '2, 5' },
        anchorR: 5,
        handleR: 4.5,
        handleHitR: 14,
        projectMaxPts: 100,
        nearDist: 0.015
    };

    function clampNum(v, lo, hi, fallback) {
        const n = (typeof v === 'number') ? v : parseFloat(v);
        if (!isFinite(n)) return fallback;
        return Math.max(lo, Math.min(hi, n));
    }

    function parsePos(posStr) {
        if (!posStr) return null;
        const a = String(posStr).replace(/m/g, '').trim().split(/\s+/).map(Number);
        if (a.length < 3 || !a.every(isFinite)) return null;
        return { x: a[0], y: a[1], z: a[2] };
    }

    function formatPos(v) {
        return `${Number(v.x).toFixed(4)}m ${Number(v.y).toFixed(4)}m ${Number(v.z).toFixed(4)}m`;
    }

    function formatNorm(v) {
        return `${Number(v.x).toFixed(4)}m ${Number(v.y).toFixed(4)}m ${Number(v.z).toFixed(4)}m`;
    }

    function arrFromOffset(o) {
        if (!o) return null;
        return [parseFloat(Number(o.x).toFixed(4)), parseFloat(Number(o.y).toFixed(4)), parseFloat(Number(o.z).toFixed(4))];
    }

    function offsetFromArr(a) {
        if (!a || !Array.isArray(a) || a.length < 3) return null;
        const o = { x: a[0], y: a[1], z: a[2] };
        return (isFinite(o.x) && isFinite(o.y) && isFinite(o.z)) ? o : null;
    }

    function dist3(a, b) {
        return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    }

    function add3(a, b) {
        return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
    }

    function sub3(a, b) {
        return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
    }

    function scale3(a, s) {
        return { x: a.x * s, y: a.y * s, z: a.z * s };
    }

    function normalize3(a) {
        const L = Math.hypot(a.x, a.y, a.z) || 1;
        return { x: a.x / L, y: a.y / L, z: a.z / L };
    }

    function cubicEval(p0, p1, p2, p3, t, out) {
        const u = 1 - t, uu = u * u, uuu = uu * u, tt = t * t, ttt = tt * t;
        out.x = uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x;
        out.y = uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y;
        return out;
    }

    function isConsumer() {
        return !!(window.tourState !== undefined && !document.getElementById('tool-mode-select'));
    }

    function getViewer() {
        return document.querySelector('#workbench-viewer') || document.querySelector('model-viewer');
    }

    function toast(msg, isErr) {
        if (typeof flashToast === 'function') flashToast(msg, isErr);
        else if (typeof statusMsg !== 'undefined' && statusMsg) {
            statusMsg.innerText = msg || '';
            statusMsg.style.color = isErr ? '#f88' : '#ccc';
        }
    }

    function normalizeLineStyle(v) {
        const s = (v == null) ? '' : String(v).toLowerCase();
        if (s === 'solid' || s === 'dotted' || s === 'dashed') return s;
        return DEFAULTS.lineStyle;
    }

    function getAppearance(p) {
        return {
            strokeWidth: clampNum(p && p.strokeWidth, DEFAULTS.strokeMin, DEFAULTS.strokeMax, DEFAULTS.strokeWidth),
            opacity: clampNum(p && p.opacity, DEFAULTS.opacityMin, DEFAULTS.opacityMax, DEFAULTS.opacity),
            capR: clampNum(p && p.capR, DEFAULTS.capRMin, DEFAULTS.capRMax, DEFAULTS.capR),
            lineStyle: normalizeLineStyle(p && p.lineStyle)
        };
    }

    function dashFor(lineStyle) {
        const key = normalizeLineStyle(lineStyle);
        const d = DEFAULTS.lineStyles[key];
        return d != null ? d : DEFAULTS.lineStyles.dashed;
    }

    function isProjected(p) {
        if (!p || p.type !== 'bezier' || !p.dots) return false;
        if (p.projected === true) return true;
        if (p.dots.length > 2) {
            const hasHandle = p.dots.some(d => d.handleIn || d.handleOut);
            if (!hasHandle) return true;
        }
        return false;
    }

    function isEditable(p) {
        return !!(p && p.type === 'bezier' && p.dots && p.dots.length >= 2 && !isProjected(p));
    }

    function ensureDefaultHandles(p) {
        if (!p || !p.dots || p.dots.length < 2) return;
        const dots = p.dots;
        for (let i = 0; i < dots.length; i++) {
            const d = dots[i];
            const pos = parsePos(d.pos);
            if (!pos) continue;
            if (i === 0) {
                d.handleIn = null;
                if (!d.handleOut) {
                    const next = parsePos(dots[1].pos);
                    if (next) d.handleOut = arrFromOffset(scale3(sub3(next, pos), 1 / 3));
                }
            } else if (i === dots.length - 1) {
                d.handleOut = null;
                if (!d.handleIn) {
                    const prev = parsePos(dots[i - 1].pos);
                    if (prev) d.handleIn = arrFromOffset(scale3(sub3(prev, pos), 1 / 3));
                }
            } else {
                const prev = parsePos(dots[i - 1].pos);
                const next = parsePos(dots[i + 1].pos);
                if (!prev || !next) continue;
                let tan = sub3(next, prev);
                if (Math.hypot(tan.x, tan.y, tan.z) < 1e-12) tan = { x: 1, y: 0, z: 0 };
                else tan = normalize3(tan);
                const dIn = dist3(pos, prev) / 3;
                const dOut = dist3(next, pos) / 3;
                if (!d.handleIn) d.handleIn = arrFromOffset(scale3(tan, -dIn));
                if (!d.handleOut) d.handleOut = arrFromOffset(scale3(tan, dOut));
            }
        }
    }

    function stripHandles(p) {
        if (!p || !p.dots) return;
        p.dots.forEach(d => {
            d.handleIn = null;
            d.handleOut = null;
            delete d.handleIn;
            delete d.handleOut;
        });
    }

    function syncMidFields(p) {
        if (!p || !p.dots || !p.dots.length) return;
        const mid = Math.floor(p.dots.length / 2);
        p.midIndex = mid;
        const md = p.dots[mid];
        p.slot = md.slot;
        p.pos = md.pos;
        p.norm = md.norm;
    }

    function updateHotspotPose(viewer, slot, posStr, normStr) {
        const el = viewer.querySelector(`[slot="${slot}"]`);
        if (el) {
            el.setAttribute('data-position', posStr);
            el.setAttribute('data-normal', normStr);
        }
        try {
            if (viewer && typeof viewer.updateHotspot === 'function') {
                viewer.updateHotspot({ name: slot, position: posStr, normal: normStr });
            }
        } catch (_e) {}
    }

    function screenOfEl(el) {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const ok = (r.width > 0.5 || r.height > 0.5) && isFinite(r.left) && isFinite(r.top)
            && (Math.abs(r.left) > 0.5 || Math.abs(r.top) > 0.5 || r.width > 1);
        // 排除尚未挂到视图（常落在 0,0 且尺寸为 0）
        if (!ok) return { x: 0, y: 0, ok: false };
        return { x: r.left + r.width / 2, y: r.top + r.height / 2, ok: true };
    }

    /** 仅弦投影（丢失离弦分量；仅作最后兜底） */
    function approxHandleScreenChord(sA, sB, wA, wB, wH) {
        if (!sA || !sB || !wA || !wB || !wH) return null;
        const cx = wB.x - wA.x, cy = wB.y - wA.y, cz = wB.z - wA.z;
        const len2 = cx * cx + cy * cy + cz * cz;
        if (len2 < 1e-12) return { x: sA.x, y: sA.y, ok: true };
        const t = ((wH.x - wA.x) * cx + (wH.y - wA.y) * cy + (wH.z - wA.z) * cz) / len2;
        return { x: sA.x + (sB.x - sA.x) * t, y: sA.y + (sB.y - sA.y) * t, ok: true };
    }

    function getThreeCamera(viewer) {
        if (!viewer) return null;
        try {
            const syms = Object.getOwnPropertySymbols(viewer);
            let scene = null, controls = null;
            for (let i = 0; i < syms.length; i++) {
                const d = String(syms[i]);
                if (d.includes('scene')) scene = viewer[syms[i]];
                if (d.includes('controls')) controls = viewer[syms[i]];
            }
            if (controls && controls.getCamera) {
                const c = controls.getCamera();
                if (c) return c;
            }
            if (controls && controls.camera) return controls.camera;
            if (scene && scene.camera) return scene.camera;
        } catch (_e) {}
        return null;
    }

    /**
     * 用锚点对标定「世界→屏幕」尺度，保留离弦分量（手柄可离开弦线显示）。
     * 旧版只做弦投影，导致柄圆点永远贴在线上。
     */
    function approxHandleScreen(viewer, sA, sB, wA, wB, wH) {
        if (!sA || !wA || !wH) return null;
        const cam = getThreeCamera(viewer);
        if (cam && sB && wB) {
            try {
                if (typeof cam.updateMatrixWorld === 'function') cam.updateMatrixWorld(true);
                const e = cam.matrixWorld.elements;
                const right = { x: e[0], y: e[1], z: e[2] };
                const up = { x: e[4], y: e[5], z: e[6] };
                const dw = sub3(wB, wA);
                const lenS = Math.hypot(sB.x - sA.x, sB.y - sA.y);
                const pred = Math.hypot(
                    dw.x * right.x + dw.y * right.y + dw.z * right.z,
                    -(dw.x * up.x + dw.y * up.y + dw.z * up.z)
                );
                const scale = (pred > 1e-8 && lenS > 1e-3) ? (lenS / pred) : null;
                if (scale != null) {
                    const o = sub3(wH, wA);
                    const ox = o.x * right.x + o.y * right.y + o.z * right.z;
                    const oy = o.x * up.x + o.y * up.y + o.z * up.z;
                    return { x: sA.x + ox * scale, y: sA.y - oy * scale, ok: true };
                }
            } catch (_e) {}
        }
        if (sB && wB) return approxHandleScreenChord(sA, sB, wA, wB, wH);
        return { x: sA.x, y: sA.y, ok: true };
    }

    /**
     * 持久不可见 hotspot：model-viewer 需至少一帧才能给出正确 2D。
     * 同帧读取可能 ok=false，调用方应走 approxHandleScreen。
     */
    function ensureHandleProbe(viewer, slot, worldPos, worldNorm) {
        if (!viewer || !worldPos) return null;
        let el = viewer.querySelector(`[slot="${slot}"]`);
        const posStr = formatPos(worldPos);
        const normStr = formatNorm(worldNorm || { x: 0, y: 1, z: 0 });
        if (!el) {
            el = document.createElement('div');
            el.className = 'ink-anchor bezier-handle-probe';
            el.setAttribute('slot', slot);
            el.setAttribute('data-visibility-attribute', 'visible');
            el.setAttribute('visible', '');
            el.style.cssText = 'width:2px;height:2px;opacity:0;pointer-events:none;';
            viewer.appendChild(el);
        }
        el.setAttribute('data-position', posStr);
        el.setAttribute('data-normal', normStr);
        try {
            if (typeof viewer.updateHotspot === 'function') {
                viewer.updateHotspot({ name: slot, position: posStr, normal: normStr });
            }
        } catch (_e) {}
        return el;
    }

    function handleScreen(viewer, slot, worldHandle, sA, sB, wA, wB, worldNorm) {
        const probe = ensureHandleProbe(viewer, slot, worldHandle, worldNorm);
        const s = screenOfEl(probe);
        if (s && s.ok) return s;
        return approxHandleScreen(viewer, sA, sB, wA, wB, worldHandle);
    }

    /** 手柄拖拽取世界点：与 Solid 一致优先贴面；未命中则用过锚点的相机平面 */
    function worldFromHandlePointer(viewer, clientX, clientY, anchorWorld) {
        if (!viewer || !anchorWorld) return null;
        const hit = viewer.positionAndNormalFromPoint(clientX, clientY);
        if (hit) {
            return {
                position: { x: hit.position.x, y: hit.position.y, z: hit.position.z },
                normal: { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z },
                fromPlane: false
            };
        }
        const cam = getThreeCamera(viewer);
        if (!cam) return null;
        try {
            const rect = viewer.getBoundingClientRect();
            if (rect.width <= 1 || rect.height <= 1) return null;
            const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
            const ndcY = -((clientY - rect.top) / rect.height) * 2 + 1;
            if (typeof cam.updateMatrixWorld === 'function') cam.updateMatrixWorld(true);
            const e = cam.matrixWorld.elements;
            const camPos = { x: e[12], y: e[13], z: e[14] };
            const forward = { x: -e[8], y: -e[9], z: -e[10] };
            const right = { x: e[0], y: e[1], z: e[2] };
            const up = { x: e[4], y: e[5], z: e[6] };
            const fov = (cam.fov != null ? cam.fov : 45) * Math.PI / 180;
            const aspect = rect.width / rect.height;
            const tan = Math.tan(fov / 2);
            const dir = normalize3({
                x: forward.x + right.x * ndcX * tan * aspect + up.x * ndcY * tan,
                y: forward.y + right.y * ndcX * tan * aspect + up.y * ndcY * tan,
                z: forward.z + right.z * ndcX * tan * aspect + up.z * ndcY * tan
            });
            const planeN = normalize3(sub3(camPos, anchorWorld));
            const denom = planeN.x * dir.x + planeN.y * dir.y + planeN.z * dir.z;
            if (Math.abs(denom) <= 1e-8) return null;
            const toA = sub3(anchorWorld, camPos);
            const t = (planeN.x * toA.x + planeN.y * toA.y + planeN.z * toA.z) / denom;
            if (t <= 0) return null;
            return {
                position: add3(camPos, scale3(dir, t)),
                normal: planeN,
                fromPlane: true
            };
        } catch (_e) {
            return null;
        }
    }

    function scheduleSvgRefresh() {
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (typeof updateSVG === 'function') updateSVG();
            });
        });
    }

    function removeHandleProbes(viewer, p) {
        if (!viewer || !p) return;
        const prefix = `bezier-hprobe-${p.id}-`;
        viewer.querySelectorAll(`[slot^="${prefix}"]`).forEach(el => el.remove());
        const pend = viewer.querySelector('[slot="bezier-pending-start"]');
        if (pend) pend.remove();
    }

    function buildScreenPath(p, viewer, dotReads) {
        const editable = isEditable(p);
        let dStr = '';
        const screenAnchors = [];
        let capA = null, capB = null;

        if (!editable) {
            for (let i = 0; i < (dotReads || []).length; i++) {
                const dr = dotReads[i];
                if (!dr || !dr.r) {
                    screenAnchors.push({ x: 0, y: 0, ok: false, isOccluded: true });
                    continue;
                }
                const x = dr.r.left + dr.r.width / 2;
                const y = dr.r.top + dr.r.height / 2;
                screenAnchors.push({ x, y, ok: true, isOccluded: !!dr.isOccluded });
                dStr += `${dStr.length === 0 ? 'M' : 'L'} ${x} ${y} `;
                if (i === 0) capA = { x, y };
                if (i === (dotReads.length - 1)) capB = { x, y };
            }
            return { dStr, screenAnchors, capA, capB, editable: false };
        }

        ensureDefaultHandles(p);
        const dots = p.dots;
        const anchorScr = [];
        for (let i = 0; i < dots.length; i++) {
            const el = viewer.querySelector(`[slot="${dots[i].slot}"]`);
            const s = screenOfEl(el);
            const occ = (dotReads && dotReads[i]) ? !!dotReads[i].isOccluded : false;
            if (s && s.ok) {
                anchorScr.push({ x: s.x, y: s.y, ok: true, isOccluded: occ });
                if (i === 0) capA = { x: s.x, y: s.y };
                if (i === dots.length - 1) capB = { x: s.x, y: s.y };
            } else {
                anchorScr.push({ x: 0, y: 0, ok: false, isOccluded: true });
            }
        }
        screenAnchors.push(...anchorScr);

        for (let i = 0; i < dots.length - 1; i++) {
            const a = dots[i], b = dots[i + 1];
            const pa = parsePos(a.pos), pb = parsePos(b.pos);
            if (!pa || !pb || !anchorScr[i].ok || !anchorScr[i + 1].ok) continue;
            const ho = offsetFromArr(a.handleOut) || { x: 0, y: 0, z: 0 };
            const hi = offsetFromArr(b.handleIn) || { x: 0, y: 0, z: 0 };
            const s0 = anchorScr[i];
            const s3 = anchorScr[i + 1];
            const na = parsePos(a.norm) || { x: 0, y: 1, z: 0 };
            const nb = parsePos(b.norm) || { x: 0, y: 1, z: 0 };
            const s1 = handleScreen(viewer, `bezier-hprobe-${p.id}-${i}-out`, add3(pa, ho), s0, s3, pa, pb, na);
            const s2 = handleScreen(viewer, `bezier-hprobe-${p.id}-${i}-in`, add3(pb, hi), s0, s3, pa, pb, nb);
            if (!s1 || !s1.ok || !s2 || !s2.ok) {
                if (dStr.length === 0) dStr += `M ${s0.x} ${s0.y} `;
                dStr += `L ${s3.x} ${s3.y} `;
                continue;
            }
            if (dStr.length === 0) dStr += `M ${s0.x} ${s0.y} `;
            dStr += `C ${s1.x} ${s1.y} ${s2.x} ${s2.y} ${s3.x} ${s3.y} `;
        }
        return { dStr, screenAnchors, capA, capB, editable: true };
    }

    function buildVisiblePolyline(dotReads) {
        let dStrAll = '';
        let dStrVisible = '';
        let isFirstAll = true, isFirstVis = true;
        (dotReads || []).forEach((dr) => {
            if (!dr || !dr.r) return;
            const x = dr.r.left + dr.r.width / 2;
            const y = dr.r.top + dr.r.height / 2;
            dStrAll += `${isFirstAll ? 'M' : 'L'}${x} ${y} `;
            isFirstAll = false;
            if (dr.isOccluded) {
                isFirstVis = true;
            } else {
                dStrVisible += `${isFirstVis ? 'M' : 'L'}${x} ${y} `;
                isFirstVis = false;
            }
        });
        return { dStrAll, dStrVisible };
    }

    const plugin = {
        id: 'bezier',
        name: '贝塞尔曲线',
        _pending: null,
        _clickArm: null,
        selectedAnchorIndex: null,
        selectedHandleSide: null,
        _drag: null,
        _orbitWasEnabled: null,
        /** 双击插点：记录上一次点在曲线/锚/柄上的时刻，避免 SVG 重绘后原生 dblclick 丢目标 */
        _dblArm: null,
        /** 刚用 pointerdown 插过点时，吞掉随后的原生 dblclick，避免连插两个 */
        _insertGuardUntil: 0,

        getAppearance: getAppearance,
        isEditable: isEditable,
        isProjected: isProjected,
        ensureDefaultHandles: ensureDefaultHandles,

        getOcclusionReads: function (p, viewer, checkOccluded, isBackFace) {
            const midSlot = p.slot || (p.dots && p.dots[p.midIndex || Math.floor(p.dots.length / 2)] && p.dots[p.midIndex || Math.floor(p.dots.length / 2)].slot);
            const midEl = midSlot ? viewer.querySelector(`[slot="${midSlot}"]`) : null;
            const dotReads = [];
            if (p.dots) {
                p.dots.forEach(d => {
                    const el = viewer.querySelector(`[slot="${d.slot}"]`);
                    if (el) {
                        dotReads.push({
                            r: el.getBoundingClientRect(),
                            isOccluded: checkOccluded(el) || (isBackFace && isBackFace(d.norm))
                        });
                    } else {
                        dotReads.push({ r: null, isOccluded: true });
                    }
                });
            }
            return { type: p.type, p, midEl, dotReads };
        },

        onPointerDown: function () {},
        onPointerMove: function () {},
        finish: function () {},

        clearPending: function () {
            this._pending = null;
            this._clickArm = null;
        },

        _placeClick: function (viewer, hit) {
            if (!hit || !hit.position) return;
            const worldPos = { x: hit.position.x, y: hit.position.y, z: hit.position.z };
            const worldNorm = { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z };
            if (!this._pending) {
                this._pending = { worldPos: worldPos, worldNorm: worldNorm };
                toast('已定起点，保持 Alt+Shift 再点终点');
                if (typeof updateSVG !== 'undefined') updateSVG();
                return;
            }
            const a = this._pending;
            if (dist3(a.worldPos, worldPos) < DEFAULTS.nearDist) {
                this.clearPending();
                toast('两点过近，已取消', true);
                if (typeof updateSVG !== 'undefined') updateSVG();
                return;
            }
            this._commitLine(viewer, a.worldPos, a.worldNorm, worldPos, worldNorm);
            this.clearPending();
        },

        _commitLine: function (viewer, posA, normA, posB, normB) {
            const id = (typeof pointIndex !== 'undefined') ? pointIndex : Date.now();
            const color = (typeof defaultColor !== 'undefined') ? defaultColor : '#00d2ff';
            const slotA = `hotspot-bezier-${id}-0`;
            const slotB = `hotspot-bezier-${id}-1`;
            const dots = [
                { slot: slotA, pos: formatPos(posA), norm: formatNorm(normA), handleIn: null, handleOut: null },
                { slot: slotB, pos: formatPos(posB), norm: formatNorm(normB), handleIn: null, handleOut: null }
            ];
            const p = {
                id: id,
                type: 'bezier',
                slot: slotB,
                pos: formatPos(posB),
                norm: formatNorm(normB),
                text: '',
                desc: '',
                dots: dots,
                midIndex: 1,
                color: color,
                hidden: false,
                hideInList: false,
                showTextOnLoad: false,
                projected: false,
                strokeWidth: DEFAULTS.strokeWidth,
                opacity: DEFAULTS.opacity,
                capR: DEFAULTS.capR,
                lineStyle: DEFAULTS.lineStyle
            };
            ensureDefaultHandles(p);
            syncMidFields(p);
            if (typeof window.addAnnotationToList === 'function') window.addAnnotationToList(p);
            else if (typeof pointsData !== 'undefined') pointsData.push(p);
            this.mountDOM(p, viewer);
            if (typeof pointIndex !== 'undefined') pointIndex++;
            if (typeof renderState === 'function') renderState();
            // 预挂柄探针 + 双 rAF，避免首帧 C 0,0 / 探照灯抢走选中
            window.__bezierSuppressClickUntil = Date.now() + 400;
            ensureDefaultHandles(p);
            for (let i = 0; i < p.dots.length - 1; i++) {
                const a = p.dots[i], b = p.dots[i + 1];
                const pa = parsePos(a.pos), pb = parsePos(b.pos);
                if (!pa || !pb) continue;
                const ho = offsetFromArr(a.handleOut) || { x: 0, y: 0, z: 0 };
                const hi = offsetFromArr(b.handleIn) || { x: 0, y: 0, z: 0 };
                ensureHandleProbe(viewer, `bezier-hprobe-${p.id}-${i}-out`, add3(pa, ho), parsePos(a.norm));
                ensureHandleProbe(viewer, `bezier-hprobe-${p.id}-${i}-in`, add3(pb, hi), parsePos(b.norm));
            }
            if (typeof updateSVG === 'function') updateSVG();
            toast('贝塞尔曲线已保存');
            this.selectLine(p.id);
            scheduleSvgRefresh();
            setTimeout(() => {
                this.selectLine(p.id);
                if (typeof window.syncBezierAppearanceUI === 'function') window.syncBezierAppearanceUI();
            }, 50);
            return p;
        },

        mountDOM: function (p, viewer) {
            if (!p || !p.dots || !viewer) return;
            p.dots.forEach((dot, idx) => {
                let el = viewer.querySelector(`[slot="${dot.slot}"]`);
                if (!el) {
                    el = document.createElement('div');
                    el.className = 'ink-anchor';
                    el.setAttribute('slot', dot.slot);
                    el.setAttribute('data-visibility-attribute', 'visible');
                    el.setAttribute('visible', '');
                    viewer.appendChild(el);
                }
                el.setAttribute('data-position', dot.pos);
                el.setAttribute('data-normal', dot.norm);
                const mid = p.midIndex != null ? p.midIndex : Math.floor(p.dots.length / 2);
                if (idx === mid) {
                    el.classList.add('ink-mid');
                    el.setAttribute('data-id', p.id);
                    if (!el.querySelector('.HotspotAnnotation')) {
                        el.innerHTML = `<div class="HotspotAnnotation">${p.text != null ? p.text : ''}</div>`;
                    } else {
                        const ann = el.querySelector('.HotspotAnnotation');
                        if (ann) ann.innerText = p.text != null ? p.text : '';
                    }
                    el.onclick = function (evt) {
                        if (window.tourState && window.tourState.isActive) return;
                        this.classList.toggle('show-text');
                        if (typeof updateSVG !== 'undefined') updateSVG();
                        if (window.scrollToListItem) window.scrollToListItem(p.id);
                        if (typeof selectedPointId !== 'undefined') selectedPointId = p.id;
                        if (typeof window.syncBezierAppearanceUI === 'function') window.syncBezierAppearanceUI();
                    };
                }
            });
        },

        unmountDOM: function (p, viewer) {
            if (!p) return;
            removeHandleProbes(viewer, p);
            if (p.dots) {
                p.dots.forEach(d => {
                    const el = viewer.querySelector(`[slot="${d.slot}"]`);
                    if (el) el.remove();
                });
            }
        },

        remountDots: function (p, viewer) {
            this.unmountDOM(p, viewer);
            this.mountDOM(p, viewer);
        },

        renderPreviewSVG: function (htmlStr, ctx) {
            if (!this._pending) return htmlStr;
            const viewer = getViewer();
            if (!viewer) return htmlStr;
            const probe = ensureHandleProbe(viewer, 'bezier-pending-start', this._pending.worldPos, this._pending.worldNorm);
            const s = screenOfEl(probe);
            if (s && s.ok) {
                const color = (typeof defaultColor !== 'undefined') ? defaultColor : '#00d2ff';
                htmlStr += `<circle cx="${s.x}" cy="${s.y}" r="6" fill="${color}" opacity="0.9" style="pointer-events:none;" />`;
            }
            return htmlStr;
        },

        _renderPathCommon: function (item, htmlStr, ctx, isConsume) {
            const p = item.p;
            const viewer = getViewer();
            if (!viewer || !p.dots) return htmlStr;
            const color = ctx.color;
            const app = getAppearance(p);
            const isActive = item.midEl ? item.midEl.classList.contains('show-text') : false;
            const isHighlight = !!(ctx.isHighlight);
            const baseOpacity = (isConsume ? (isHighlight ? 1 : parseFloat(ctx.defaultOpacity)) : (isActive ? 1 : parseFloat(ctx.defaultOpacity)));
            const lineAlpha = Math.min(1, baseOpacity * app.opacity);
            const someOccluded = (item.dotReads || []).some(dr => dr && dr.isOccluded);
            const ghostAlpha = ctx.getRenderAlpha(true, 1);

            if (item.midEl) {
                const midIdx = p.midIndex != null ? p.midIndex : Math.floor(p.dots.length / 2);
                const midOccluded = item.dotReads[midIdx] && item.dotReads[midIdx].isOccluded;
                const domAlpha = ctx.getRenderAlpha(midOccluded, 1);
                item.midEl.style.opacity = domAlpha;
                item.midEl.style.visibility = domAlpha <= 0 ? 'hidden' : 'visible';
                if (isConsume) {
                    if (isHighlight) item.midEl.classList.add('active');
                    else item.midEl.classList.remove('active');
                }
            }

            const pathInfo = buildScreenPath(p, viewer, item.dotReads);
            const strokeW = (isConsume && isHighlight) ? Math.min(DEFAULTS.strokeMax, app.strokeWidth + 1.5) : app.strokeWidth;
            const dash = dashFor(app.lineStyle);
            const dashAttr = (dash && dash !== 'none') ? ` stroke-dasharray="${dash}"` : '';

            // 命中条
            if (pathInfo.dStr) {
                if (isConsume) {
                    htmlStr += `<path class="svg-hit-path" data-id="${p.id}" d="${pathInfo.dStr}" fill="none" stroke="transparent" stroke-width="28" style="pointer-events: none;" />`;
                } else {
                    htmlStr += `<path class="svg-hit-path" data-bezier-id="${p.id}" d="${pathInfo.dStr}" fill="none" stroke="transparent" stroke-width="28" style="pointer-events: auto; cursor: pointer;" />`;
                }
            }

            if (isProjected(p) || !pathInfo.editable) {
                const poly = buildVisiblePolyline(item.dotReads);
                if (someOccluded && ghostAlpha > 0 && poly.dStrAll) {
                    htmlStr += `<path d="${poly.dStrAll}" fill="none" stroke="${color}" stroke-width="1.5" stroke-dasharray="4,4" opacity="${ghostAlpha}" style="pointer-events:none;" />`;
                }
                if (poly.dStrVisible) {
                    htmlStr += `<path d="${poly.dStrVisible}" fill="none" stroke="${color}" stroke-width="${strokeW}"${dashAttr} opacity="${lineAlpha}" style="pointer-events:none; filter: drop-shadow(0 0 4px ${color});" />`;
                }
            } else {
                // 可编辑：整条 C；若多数锚点遮挡则降透明度
                const occCount = (item.dotReads || []).filter(dr => dr && dr.isOccluded).length;
                const mostlyOcc = occCount >= Math.ceil((item.dotReads || []).length * 0.6);
                const alpha = mostlyOcc ? Math.min(lineAlpha, ghostAlpha > 0 ? ghostAlpha + 0.15 : lineAlpha * 0.35) : lineAlpha;
                if (pathInfo.dStr) {
                    if (mostlyOcc && ghostAlpha > 0) {
                        htmlStr += `<path d="${pathInfo.dStr}" fill="none" stroke="${color}" stroke-width="1.5" stroke-dasharray="4,4" opacity="${ghostAlpha}" style="pointer-events:none;" />`;
                    }
                    htmlStr += `<path d="${pathInfo.dStr}" fill="none" stroke="${color}" stroke-width="${strokeW}"${dashAttr} opacity="${alpha}" style="pointer-events:none; filter: drop-shadow(0 0 4px ${color});" />`;
                }
            }

            // 端点帽
            const caps = [pathInfo.capA, pathInfo.capB];
            caps.forEach(c => {
                if (!c) return;
                htmlStr += `<circle cx="${c.x}" cy="${c.y}" r="${app.capR}" fill="${color}" opacity="${lineAlpha}" style="pointer-events:none;" />`;
            });

            // 生产端编辑叠层
            if (!isConsume && typeof selectedPointId !== 'undefined' && selectedPointId === p.id && isEditable(p)) {
                htmlStr += this._renderEditOverlay(p, pathInfo, color);
            }

            return htmlStr;
        },

        _renderEditOverlay: function (p, pathInfo, color) {
            let html = '';
            const anchors = pathInfo.screenAnchors || [];
            const drag = this._drag;
            for (let i = 0; i < anchors.length; i++) {
                const a = anchors[i];
                if (!a || !a.ok) continue;
                const sel = this.selectedAnchorIndex === i;
                const r = sel ? DEFAULTS.anchorR + 1.5 : DEFAULTS.anchorR;
                html += `<circle class="bezier-anchor-hit" data-bezier-id="${p.id}" data-anchor-i="${i}" cx="${a.x}" cy="${a.y}" r="${r + 8}" fill="transparent" style="pointer-events:auto; cursor:pointer;" />`;
                html += `<circle cx="${a.x}" cy="${a.y}" r="${r}" fill="${sel ? '#fff' : color}" stroke="#111" stroke-width="1.5" opacity="0.95" style="pointer-events:none;" />`;
            }
            if (this.selectedAnchorIndex != null && p.dots[this.selectedAnchorIndex]) {
                const idx = this.selectedAnchorIndex;
                const d = p.dots[idx];
                const pos = parsePos(d.pos);
                const aScr = anchors[idx];
                if (pos && aScr && aScr.ok) {
                    const viewer = getViewer();
                    const sides = [];
                    if (idx > 0 && d.handleIn) sides.push({ side: 'in', off: offsetFromArr(d.handleIn) });
                    if (idx < p.dots.length - 1 && d.handleOut) sides.push({ side: 'out', off: offsetFromArr(d.handleOut) });
                    sides.forEach(s => {
                        if (!s.off) return;
                        let hs = null;
                        // 拖柄中：圆点跟鼠标，避免探针/弦近似把柄压回线上
                        if (drag && drag.type === 'handle' && drag.id === p.id && drag.index === idx
                            && drag.side === s.side && drag.liveScreen) {
                            hs = { x: drag.liveScreen.x, y: drag.liveScreen.y, ok: true };
                        } else {
                            const wp = add3(pos, s.off);
                            const other = (s.side === 'out')
                                ? parsePos(p.dots[Math.min(idx + 1, p.dots.length - 1)].pos)
                                : parsePos(p.dots[Math.max(idx - 1, 0)].pos);
                            const sOther = (s.side === 'out')
                                ? anchors[Math.min(idx + 1, anchors.length - 1)]
                                : anchors[Math.max(idx - 1, 0)];
                            hs = handleScreen(
                                viewer,
                                `bezier-hprobe-${p.id}-edit-${s.side}`,
                                wp,
                                aScr,
                                sOther,
                                pos,
                                other,
                                parsePos(d.norm) || { x: 0, y: 1, z: 0 }
                            );
                        }
                        if (!hs || !hs.ok) return;
                        html += `<line x1="${aScr.x}" y1="${aScr.y}" x2="${hs.x}" y2="${hs.y}" stroke="#ccc" stroke-width="1" opacity="0.7" style="pointer-events:none;" />`;
                        html += `<circle class="bezier-handle-hit" data-bezier-id="${p.id}" data-anchor-i="${idx}" data-handle-side="${s.side}" cx="${hs.x}" cy="${hs.y}" r="${DEFAULTS.handleHitR}" fill="transparent" style="pointer-events:auto; cursor:grab;" />`;
                        html += `<circle cx="${hs.x}" cy="${hs.y}" r="${DEFAULTS.handleR}" fill="#ffd54a" stroke="#333" stroke-width="1" style="pointer-events:none;" />`;
                    });
                }
            }
            return html;
        },

        renderSVG: function (item, htmlStr, ctx) {
            return this._renderPathCommon(item, htmlStr, ctx, false);
        },

        renderConsumeSVG: function (item, htmlStr, ctx) {
            return this._renderPathCommon(item, htmlStr, ctx, true);
        },

        selectLine: function (id) {
            if (typeof selectedPointId !== 'undefined') selectedPointId = id;
            // 选中后默认展开首端锚点柄，便于立刻改形
            const p = (typeof pointsData !== 'undefined') ? pointsData.find(x => x.id === id) : null;
            this.selectedAnchorIndex = (p && isEditable(p) && p.dots && p.dots.length) ? 0 : null;
            this.selectedHandleSide = null;
            this._dblArm = null;
            if (typeof window.scrollToListItem === 'function') window.scrollToListItem(id);
            if (typeof updateSVG === 'function') updateSVG();
            if (typeof window.syncBezierAppearanceUI === 'function') window.syncBezierAppearanceUI();
        },

        /** 取消选中：收起锚点/柄，恢复普通曲线观感 */
        deselectLine: function () {
            const curId = (typeof selectedPointId !== 'undefined') ? selectedPointId : null;
            const p = (curId != null && typeof pointsData !== 'undefined')
                ? pointsData.find(x => x.id === curId) : null;
            this.selectedAnchorIndex = null;
            this.selectedHandleSide = null;
            this._dblArm = null;
            if (p && p.type === 'bezier') {
                if (typeof selectedPointId !== 'undefined') selectedPointId = null;
                try {
                    document.querySelectorAll('.point-item').forEach(n => n.classList.remove('active'));
                } catch (_e) {}
            }
            if (typeof updateSVG === 'function') updateSVG();
            if (typeof window.syncBezierAppearanceUI === 'function') window.syncBezierAppearanceUI();
        },

        _beginDrag: function (type, p, index, side, e) {
            const viewer = getViewer();
            if (!viewer || !isEditable(p)) return;
            e.preventDefault();
            e.stopPropagation();
            window.__bezierSuppressClickUntil = Date.now() + 350;
            this._orbitWasEnabled = viewer.hasAttribute('camera-controls');
            try { viewer.removeAttribute('camera-controls'); } catch (_e) {}
            this._drag = {
                type: type,
                id: p.id,
                index: index,
                side: side,
                mirror: !!(e.shiftKey),
                pointerId: e.pointerId,
                liveScreen: type === 'handle' ? { x: e.clientX, y: e.clientY } : null,
                moved: false
            };
            const onMove = (ev) => this._onDragMove(ev);
            const onUp = (ev) => this._endDrag(ev, onMove, onUp);
            window.addEventListener('pointermove', onMove, { passive: false });
            window.addEventListener('pointerup', onUp);
            window.addEventListener('pointercancel', onUp);
        },

        _onDragMove: function (e) {
            const st = this._drag;
            if (!st) return;
            if (st.pointerId !== undefined && e.pointerId !== undefined && e.pointerId !== st.pointerId) return;
            const viewer = getViewer();
            if (!viewer) return;
            const p = (typeof pointsData !== 'undefined') ? pointsData.find(x => x.id === st.id) : null;
            if (!p || !isEditable(p)) return;
            const dot = p.dots[st.index];
            if (!dot) return;
            try { if (e.cancelable) e.preventDefault(); } catch (_ePrev) {}
            if (st.type === 'anchor') {
                const hit = viewer.positionAndNormalFromPoint(e.clientX, e.clientY);
                if (!hit) return;
                const posStr = formatPos(hit.position);
                const normStr = formatNorm(hit.normal);
                dot.pos = posStr;
                dot.norm = normStr;
                updateHotspotPose(viewer, dot.slot, posStr, normStr);
                syncMidFields(p);
                st.moved = true;
            } else if (st.type === 'handle') {
                const anchor = parsePos(dot.pos);
                if (!anchor) return;
                st.liveScreen = { x: e.clientX, y: e.clientY };
                const hit = worldFromHandlePointer(viewer, e.clientX, e.clientY, anchor);
                if (!hit) return;
                const off = sub3(hit.position, anchor);
                if (st.side === 'in') {
                    dot.handleIn = arrFromOffset(off);
                    if ((e.shiftKey || st.mirror) && st.index < p.dots.length - 1) {
                        dot.handleOut = arrFromOffset(scale3(off, -1));
                    }
                } else {
                    dot.handleOut = arrFromOffset(off);
                    if ((e.shiftKey || st.mirror) && st.index > 0) {
                        dot.handleIn = arrFromOffset(scale3(off, -1));
                    }
                }
                st.moved = true;
            }
            if (typeof updateSVG === 'function') updateSVG();
        },

        _endDrag: function (e, onMove, onUp) {
            window.removeEventListener('pointermove', onMove, { passive: false });
            try { window.removeEventListener('pointermove', onMove); } catch (_e) {}
            window.removeEventListener('pointerup', onUp);
            window.removeEventListener('pointercancel', onUp);
            const viewer = getViewer();
            if (viewer && this._orbitWasEnabled) {
                try { viewer.setAttribute('camera-controls', ''); } catch (_e) {}
            }
            this._orbitWasEnabled = null;
            const wasMoved = !!(this._drag && this._drag.moved);
            this._drag = null;
            window.__bezierSuppressClickUntil = Date.now() + 200;
            if (wasMoved && typeof generateCode === 'function') generateCode();
            if (typeof updateSVG === 'function') updateSVG();
            scheduleSvgRefresh();
        },

        insertAnchorAtClient: function (p, clientX, clientY, opts) {
            if (!isEditable(p) || !p.dots || p.dots.length < 2) return false;
            // 同一双击序列只允许插一次（pointerdown 与 dblclick 会连发）
            if (Date.now() < (this._insertGuardUntil || 0)) return false;
            ensureDefaultHandles(p);
            const viewer = getViewer();
            if (!viewer) return false;
            const loose = !!(opts && opts.loose);
            const thresh = loose ? 96 : 48;
            // 找最近段：优先用已绘制的 SVG path（与所见曲线一致），再回退到控制点重建
            let best = null;
            const out = { x: 0, y: 0 };
            const pathEl = document.querySelector(`#ink-overlay path.svg-hit-path[data-bezier-id="${p.id}"]`);
            if (pathEl && typeof pathEl.getTotalLength === 'function' && typeof pathEl.getPointAtLength === 'function') {
                try {
                    const total = pathEl.getTotalLength();
                    if (total > 1) {
                        const steps = Math.max(24, Math.min(80, Math.round(total / 6)));
                        for (let i = 1; i < steps; i++) {
                            const u = i / steps;
                            const pt = pathEl.getPointAtLength(total * u);
                            const d = Math.hypot(pt.x - clientX, pt.y - clientY);
                            if (!best || d < best.d) best = { d, u, fromPath: true };
                        }
                    }
                } catch (_ePath) {}
            }
            // 按段映射 path 参数 u → seg/t（单段时 u≈t；多段按弧长均匀近似）
            const segCount = p.dots.length - 1;
            if (best && best.fromPath && segCount > 0) {
                if (segCount === 1) {
                    best.seg = 0;
                    best.t = Math.min(0.95, Math.max(0.05, best.u));
                } else {
                    const segF = best.u * segCount;
                    best.seg = Math.min(segCount - 1, Math.max(0, Math.floor(segF)));
                    best.t = Math.min(0.95, Math.max(0.05, segF - best.seg));
                }
            } else {
                best = null;
                for (let seg = 0; seg < p.dots.length - 1; seg++) {
                    const a = p.dots[seg], b = p.dots[seg + 1];
                    const pa = parsePos(a.pos), pb = parsePos(b.pos);
                    if (!pa || !pb) continue;
                    const sA = screenOfEl(viewer.querySelector(`[slot="${a.slot}"]`));
                    const sB = screenOfEl(viewer.querySelector(`[slot="${b.slot}"]`));
                    if (!sA || !sA.ok || !sB || !sB.ok) continue;
                    const ho = offsetFromArr(a.handleOut) || { x: 0, y: 0, z: 0 };
                    const hi = offsetFromArr(b.handleIn) || { x: 0, y: 0, z: 0 };
                    const na = parsePos(a.norm) || { x: 0, y: 1, z: 0 };
                    const nb = parsePos(b.norm) || { x: 0, y: 1, z: 0 };
                    const s1 = handleScreen(viewer, `bezier-hprobe-${p.id}-ins-o`, add3(pa, ho), sA, sB, pa, pb, na);
                    const s2 = handleScreen(viewer, `bezier-hprobe-${p.id}-ins-i`, add3(pb, hi), sA, sB, pa, pb, nb);
                    if (!s1 || !s1.ok || !s2 || !s2.ok) continue;
                    const p0 = { x: sA.x, y: sA.y }, p1 = { x: s1.x, y: s1.y }, p2 = { x: s2.x, y: s2.y }, p3 = { x: sB.x, y: sB.y };
                    for (let i = 1; i < 32; i++) {
                        const t = i / 32;
                        cubicEval(p0, p1, p2, p3, t, out);
                        const d = Math.hypot(out.x - clientX, out.y - clientY);
                        if (!best || d < best.d) best = { d, seg, t };
                    }
                }
            }
            if (!best || best.d > thresh) return false;

            const a = p.dots[best.seg];
            const b = p.dots[best.seg + 1];
            const t = best.t;
            const A = parsePos(a.pos);
            const D = parsePos(b.pos);
            if (!A || !D) return false;
            const B = add3(A, offsetFromArr(a.handleOut) || { x: 0, y: 0, z: 0 });
            const C = add3(D, offsetFromArr(b.handleIn) || { x: 0, y: 0, z: 0 });
            const lerp3 = (u, v, k) => add3(u, scale3(sub3(v, u), k));
            const AB = lerp3(A, B, t);
            const BC = lerp3(B, C, t);
            const CD = lerp3(C, D, t);
            const ABC = lerp3(AB, BC, t);
            const BCD = lerp3(BC, CD, t);
            const ABCD = lerp3(ABC, BCD, t);

            a.handleOut = arrFromOffset(sub3(AB, A));
            b.handleIn = arrFromOffset(sub3(CD, D));

            // 新点落面：优先用拆分点投影到屏再贴面；失败则用拆分点本身
            let newPos = ABCD;
            let newNorm = (() => {
                const na = parsePos(a.norm) || { x: 0, y: 1, z: 0 };
                const nb = parsePos(b.norm) || { x: 0, y: 1, z: 0 };
                return normalize3(lerp3(na, nb, t));
            })();
            const probe = ensureHandleProbe(viewer, `bezier-hprobe-${p.id}-ins-split`, ABCD, newNorm);
            const sSplit = screenOfEl(probe);
            const sx = (sSplit && sSplit.ok) ? sSplit.x : clientX;
            const sy = (sSplit && sSplit.ok) ? sSplit.y : clientY;
            const hit = viewer.positionAndNormalFromPoint(sx, sy)
                || viewer.positionAndNormalFromPoint(clientX, clientY);
            if (hit) {
                newPos = { x: hit.position.x, y: hit.position.y, z: hit.position.z };
                newNorm = { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z };
            }

            const newIdx = best.seg + 1;
            const slot = `hotspot-bezier-${p.id}-${Date.now() % 100000}`;
            const newDot = {
                slot: slot,
                pos: formatPos(newPos),
                norm: formatNorm(newNorm),
                handleIn: arrFromOffset(sub3(ABC, ABCD)),
                handleOut: arrFromOffset(sub3(BCD, ABCD))
            };
            p.dots.splice(newIdx, 0, newDot);
            syncMidFields(p);
            this.remountDots(p, viewer);
            this.selectedAnchorIndex = newIdx;
            this.selectedHandleSide = null;
            this._dblArm = null;
            this._insertGuardUntil = Date.now() + 650;
            if (typeof selectedPointId !== 'undefined') selectedPointId = p.id;
            if (typeof renderState === 'function') renderState();
            if (typeof updateSVG === 'function') updateSVG();
            if (typeof generateCode === 'function') generateCode();
            scheduleSvgRefresh();
            toast('已插入锚点');
            return true;
        },

        deleteSelectedAnchorOrLine: function () {
            if (typeof selectedPointId === 'undefined' || selectedPointId == null) return false;
            const p = pointsData.find(x => x.id === selectedPointId);
            if (!p || p.type !== 'bezier') return false;
            if (isEditable(p) && this.selectedAnchorIndex != null) {
                const idx = this.selectedAnchorIndex;
                if (idx > 0 && idx < p.dots.length - 1 && p.dots.length > 2) {
                    const viewer = getViewer();
                    const removed = p.dots.splice(idx, 1)[0];
                    if (removed && viewer) {
                        const el = viewer.querySelector(`[slot="${removed.slot}"]`);
                        if (el) el.remove();
                    }
                    ensureDefaultHandles(p);
                    syncMidFields(p);
                    this.selectedAnchorIndex = null;
                    this.remountDots(p, viewer);
                    if (typeof renderState === 'function') renderState();
                    if (typeof updateSVG === 'function') updateSVG();
                    if (typeof generateCode === 'function') generateCode();
                    toast('已删除锚点');
                    return true;
                }
            }
            return false; // 交给宿主删整条
        },

        projectSelectedToSurface: function () {
            if (typeof selectedPointId === 'undefined' || selectedPointId == null) {
                toast('请先选中一条贝塞尔曲线', true);
                return { ok: false, reason: 'no_selection' };
            }
            const p = pointsData.find(x => x.id === selectedPointId);
            if (!p || p.type !== 'bezier') {
                toast('请先选中一条贝塞尔曲线', true);
                return { ok: false, reason: 'not_bezier' };
            }
            if (!isEditable(p)) {
                toast('当前已是贴面折线', true);
                return { ok: false, reason: 'already_projected' };
            }
            const viewer = getViewer();
            if (!viewer) return { ok: false, reason: 'no_viewer' };
            ensureDefaultHandles(p);

            // 采样屏幕路径
            const samples = [];
            const out = { x: 0, y: 0 };
            const pathInfo = buildScreenPath(p, viewer, p.dots.map(d => {
                const el = viewer.querySelector(`[slot="${d.slot}"]`);
                return el ? { r: el.getBoundingClientRect(), isOccluded: false } : { r: null, isOccluded: true };
            }));
            // 按段采样
            for (let seg = 0; seg < p.dots.length - 1; seg++) {
                const a = p.dots[seg], b = p.dots[seg + 1];
                const pa = parsePos(a.pos), pb = parsePos(b.pos);
                if (!pa || !pb) continue;
                const sA = screenOfEl(viewer.querySelector(`[slot="${a.slot}"]`));
                const sB = screenOfEl(viewer.querySelector(`[slot="${b.slot}"]`));
                if (!sA || !sA.ok || !sB || !sB.ok) continue;
                const ho = offsetFromArr(a.handleOut) || { x: 0, y: 0, z: 0 };
                const hi = offsetFromArr(b.handleIn) || { x: 0, y: 0, z: 0 };
                const na = parsePos(a.norm) || { x: 0, y: 1, z: 0 };
                const nb = parsePos(b.norm) || { x: 0, y: 1, z: 0 };
                const s1 = handleScreen(viewer, `bezier-hprobe-${p.id}-pj-o${seg}`, add3(pa, ho), sA, sB, pa, pb, na);
                const s2 = handleScreen(viewer, `bezier-hprobe-${p.id}-pj-i${seg}`, add3(pb, hi), sA, sB, pa, pb, nb);
                if (!s1 || !s1.ok || !s2 || !s2.ok) continue;
                const p0 = { x: sA.x, y: sA.y }, p1 = { x: s1.x, y: s1.y }, p2 = { x: s2.x, y: s2.y }, p3 = { x: sB.x, y: sB.y };
                const pixLen = Math.hypot(p3.x - p0.x, p3.y - p0.y) + Math.hypot(p1.x - p0.x, p1.y - p0.y) + Math.hypot(p2.x - p3.x, p2.y - p3.y);
                let n = Math.round(pixLen / 6) + 1;
                n = Math.max(8, Math.min(40, n));
                for (let i = 0; i < n; i++) {
                    if (seg > 0 && i === 0) continue;
                    const t = n === 1 ? 0 : (i / (n - 1));
                    cubicEval(p0, p1, p2, p3, t, out);
                    samples.push({ x: out.x, y: out.y });
                }
            }
            if (samples.length < 3) {
                toast('曲线过短，投面失败', true);
                return { ok: false, reason: 'too_short' };
            }

            const newDots = [];
            for (let i = 0; i < samples.length; i++) {
                if (newDots.length >= DEFAULTS.projectMaxPts) break;
                const hit = viewer.positionAndNormalFromPoint(samples[i].x, samples[i].y);
                if (!hit) continue;
                // 抽稀：与上一点过近则跳过
                if (newDots.length > 0) {
                    const prev = parsePos(newDots[newDots.length - 1].pos);
                    if (prev && dist3(prev, hit.position) < 0.004) continue;
                }
                newDots.push({
                    slot: `hotspot-bezier-${p.id}-p${newDots.length}`,
                    pos: formatPos(hit.position),
                    norm: formatNorm(hit.normal)
                });
            }
            if (newDots.length < 3) {
                toast('有效命中过少，未改原线', true);
                return { ok: false, reason: 'too_few_hits', pointCount: newDots.length };
            }

            this.unmountDOM(p, viewer);
            p.dots = newDots;
            p.projected = true;
            stripHandles(p);
            syncMidFields(p);
            this.selectedAnchorIndex = null;
            this.selectedHandleSide = null;
            this.mountDOM(p, viewer);
            if (typeof renderState === 'function') renderState();
            if (typeof updateSVG === 'function') updateSVG();
            if (typeof generateCode === 'function') generateCode();
            if (typeof window.syncBezierAppearanceUI === 'function') window.syncBezierAppearanceUI();
            toast('已投到面（' + newDots.length + ' 点）');
            return { ok: true, pointCount: newDots.length };
        },

        unprojectSelected: function () {
            if (typeof selectedPointId === 'undefined' || selectedPointId == null) {
                toast('请先选中一条贝塞尔曲线', true);
                return { ok: false, reason: 'no_selection' };
            }
            const p = pointsData.find(x => x.id === selectedPointId);
            if (!p || p.type !== 'bezier') {
                toast('请先选中一条贝塞尔曲线', true);
                return { ok: false, reason: 'not_bezier' };
            }
            if (isEditable(p) && p.dots.length === 2) {
                toast('已是可编辑贝塞尔');
                return { ok: true, reason: 'already_true' };
            }
            const viewer = getViewer();
            if (!viewer || !p.dots || p.dots.length < 2) return { ok: false, reason: 'bad_data' };
            const first = p.dots[0];
            const last = p.dots[p.dots.length - 1];
            this.unmountDOM(p, viewer);
            p.dots = [
                { slot: `hotspot-bezier-${p.id}-0`, pos: first.pos, norm: first.norm, handleIn: null, handleOut: null },
                { slot: `hotspot-bezier-${p.id}-1`, pos: last.pos, norm: last.norm, handleIn: null, handleOut: null }
            ];
            p.projected = false;
            delete p.projected;
            ensureDefaultHandles(p);
            syncMidFields(p);
            this.selectedAnchorIndex = null;
            this.mountDOM(p, viewer);
            if (typeof renderState === 'function') renderState();
            if (typeof updateSVG === 'function') updateSVG();
            if (typeof generateCode === 'function') generateCode();
            if (typeof window.syncBezierAppearanceUI === 'function') window.syncBezierAppearanceUI();
            toast('已取消投面（还原为可编辑贝塞尔）');
            return { ok: true };
        },

        applyAppearance: function (partial) {
            if (typeof selectedPointId === 'undefined' || selectedPointId == null) return null;
            const p = pointsData.find(x => x.id === selectedPointId);
            if (!p || p.type !== 'bezier') return null;
            if (partial.strokeWidth != null) p.strokeWidth = clampNum(partial.strokeWidth, DEFAULTS.strokeMin, DEFAULTS.strokeMax, DEFAULTS.strokeWidth);
            if (partial.opacity != null) p.opacity = clampNum(partial.opacity, DEFAULTS.opacityMin, DEFAULTS.opacityMax, DEFAULTS.opacity);
            if (partial.capR != null) p.capR = clampNum(partial.capR, DEFAULTS.capRMin, DEFAULTS.capRMax, DEFAULTS.capR);
            if (partial.lineStyle != null) p.lineStyle = normalizeLineStyle(partial.lineStyle);
            if (typeof updateSVG === 'function') updateSVG();
            if (typeof generateCode === 'function') generateCode();
            return getAppearance(p);
        },

        init: function () {
            const self = this;
            const viewer = getViewer();
            if (!viewer) return;
            // 建线：Alt+Shift 点击（按下武装，抬起且位移小则定点）
            viewer.addEventListener('pointerdown', (e) => {
                if (isConsumer()) return;
                const modeSel = document.getElementById('tool-mode-select');
                if (!modeSel || modeSel.value !== 'bezier') return;
                if (!e.altKey || !e.shiftKey || e.button !== 0) return;
                e.preventDefault();
                e.stopPropagation();
                const hit = viewer.positionAndNormalFromPoint(e.clientX, e.clientY);
                if (!hit) return;
                self._clickArm = {
                    x: e.clientX,
                    y: e.clientY,
                    hit: {
                        position: { x: hit.position.x, y: hit.position.y, z: hit.position.z },
                        normal: { x: hit.normal.x, y: hit.normal.y, z: hit.normal.z }
                    }
                };
            }, true);

            window.addEventListener('pointerup', (e) => {
                if (isConsumer()) return;
                const arm = self._clickArm;
                if (!arm) return;
                self._clickArm = null;
                const modeSel = document.getElementById('tool-mode-select');
                if (!modeSel || modeSel.value !== 'bezier') return;
                if (Math.hypot(e.clientX - arm.x, e.clientY - arm.y) > 8) return;
                self._placeClick(viewer, arm.hit);
            });

            // 点选 / 锚点 / 柄：委托在 ink-overlay 上（updateSVG 重绘后仍有效——用 document 捕获）
            document.addEventListener('pointerdown', (e) => {
                if (isConsumer()) return;
                if (e.altKey) return;
                if (e.button !== 0) return;
                const t = e.target;
                if (!t || !t.closest) return;

                // —— 双击插点（真实序列）：第一次点选会重绘 SVG，原生 dblclick 常打到新叠的锚/柄上而失败
                const bezEl = t.closest('.bezier-handle-hit, .bezier-anchor-hit, path.svg-hit-path[data-bezier-id]');
                if (bezEl) {
                    const id = parseInt(bezEl.getAttribute('data-bezier-id'), 10);
                    const p0 = pointsData.find(x => x.id === id);
                    if (p0 && isEditable(p0)) {
                        const now = Date.now();
                        const arm = self._dblArm;
                        const isSecond = e.detail === 2
                            || (arm && arm.id === id && (now - arm.t) < 450
                                && Math.hypot(e.clientX - arm.x, e.clientY - arm.y) < 28);
                        if (isSecond) {
                            e.preventDefault();
                            e.stopPropagation();
                            self._dblArm = null;
                            window.__bezierSuppressClickUntil = Date.now() + 400;
                            self.selectLine(id);
                            self.insertAnchorAtClient(p0, e.clientX, e.clientY, { loose: true });
                            return;
                        }
                        self._dblArm = { t: now, x: e.clientX, y: e.clientY, id: id };
                    }
                }

                const handleHit = t.closest('.bezier-handle-hit');
                if (handleHit) {
                    const id = parseInt(handleHit.getAttribute('data-bezier-id'), 10);
                    const idx = parseInt(handleHit.getAttribute('data-anchor-i'), 10);
                    const side = handleHit.getAttribute('data-handle-side');
                    const p = pointsData.find(x => x.id === id);
                    if (p) {
                        self.selectLine(id);
                        self.selectedAnchorIndex = idx;
                        self.selectedHandleSide = side;
                        self._beginDrag('handle', p, idx, side, e);
                    }
                    return;
                }
                const anchorHit = t.closest('.bezier-anchor-hit');
                if (anchorHit) {
                    const id = parseInt(anchorHit.getAttribute('data-bezier-id'), 10);
                    const idx = parseInt(anchorHit.getAttribute('data-anchor-i'), 10);
                    const p = pointsData.find(x => x.id === id);
                    if (p) {
                        self.selectLine(id);
                        if (self.selectedAnchorIndex === idx) {
                            self._beginDrag('anchor', p, idx, null, e);
                        } else {
                            self.selectedAnchorIndex = idx;
                            self.selectedHandleSide = null;
                            if (typeof updateSVG === 'function') updateSVG();
                            // 同一次按下也可开始拖
                            self._beginDrag('anchor', p, idx, null, e);
                        }
                    }
                    return;
                }
                const pathHit = t.closest('[data-bezier-id]');
                if (pathHit && pathHit.classList.contains('svg-hit-path')) {
                    const id = parseInt(pathHit.getAttribute('data-bezier-id'), 10);
                    if (!isNaN(id)) self.selectLine(id);
                }
            }, true);

            // 插点只走上方 pointerdown 双击检测，不再监听原生 dblclick——
            // 否则会与第二次 pointerdown 各插一次，变成一次双击加两个锚点。

            // 模式切换清 pending
            const modeSel = document.getElementById('tool-mode-select');
            if (modeSel) {
                modeSel.addEventListener('change', () => {
                    self.clearPending();
                    self._dblArm = null;
                    if (typeof updateSVG === 'function') updateSVG();
                });
            }
        }
    };

    window.AnnotationPluginManager.register(plugin);
    window.BezierAnnotation = plugin;
    setTimeout(() => { if (plugin.init) plugin.init(); }, 120);
})();
