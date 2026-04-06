import * as THREE from 'three';

function srgbChannelToLinear(c) {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function hexToRelativeLuminance(hex) {
    if (!hex || typeof hex !== 'string') return 0;
    let h = hex.trim();
    if (h.startsWith('#')) h = h.slice(1);
    if (h.length === 3) {
        h = h.split('').map((ch) => ch + ch).join('');
    }
    if (h.length !== 6) return 0;
    const r = parseInt(h.slice(0, 2), 16) / 255;
    const g = parseInt(h.slice(2, 4), 16) / 255;
    const b = parseInt(h.slice(4, 6), 16) / 255;
    const lr = srgbChannelToLinear(r);
    const lg = srgbChannelToLinear(g);
    const lb = srgbChannelToLinear(b);
    return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

function computeBackgroundIntensity(hex, userScale) {
    const Y = hexToRelativeLuminance(hex);
    const scale = Number.isFinite(userScale) && userScale >= 0 ? userScale : 1;
    const base = 0.04 + 2.15 * Math.pow(Math.min(1, Math.max(0, Y)), 0.68);
    return Math.min(4, Math.max(0.025, base * scale));
}

/** 与主光滑块一致：不低于 0.2 */
function readMainLightUiIntensity() {
    const el = typeof document !== 'undefined' ? document.getElementById('lightIntensity') : null;
    const v = el ? parseFloat(el.value) : NaN;
    const x = Number.isFinite(v) ? v : 1.7;
    return Math.max(0.2, Math.min(5, x));
}

/** 与主光 Tab 中 RectAreaLight 一致：intensity = slider × 18；天光倍率再乘在上面 */
const RECT_COEFF = 18;
/** 略小于早期 520²，减轻路径追踪对大面积光采样成本，仍远大于 Tab 默认面积光 */
const SKY_RECT_WIDTH = 320;
const SKY_RECT_HEIGHT = 320;

window.SkyEnvLight = {
    _skyRect: null,
    _lastSkySyncKey: '',

    _removeSkyRect(scene) {
        if (this._skyRect) {
            if (this._skyRect.parent) this._skyRect.parent.remove(this._skyRect);
            this._skyRect = null;
        }
    },

    /** 切回 Tab 等场景下强制完整同步，避免缓存跳过导致 GPU/场景状态陈旧 */
    invalidateSyncCache() {
        this._lastSkySyncKey = '';
    },

    onSkyEnvSync(context) {
        const scene = context && context.scene;
        if (!scene) return;
        const hex = window.envSkyColor || '#0d0d0f';
        const sc = window.envSkyLightScale;
        const scaleRaw = typeof sc === 'number' && !Number.isNaN(sc) ? sc : 0;
        const scale = Math.min(1, Math.max(0, scaleRaw));
        const uiVal = readMainLightUiIntensity();
        const mode = window.skyEnvLightMatchMainRect ? '1' : '0';
        const cacheKey = `${hex}|${scale}|${uiVal}|${mode}`;
        if (this._lastSkySyncKey === cacheKey && this._skyRect && this._skyRect.parent === scene && window.skyEnvLightMatchMainRect) {
            return;
        }
        if (this._lastSkySyncKey === cacheKey && !window.skyEnvLightMatchMainRect && !this._skyRect) {
            scene.background = new THREE.Color(hex);
            scene.backgroundIntensity = computeBackgroundIntensity(hex, scale);
            return;
        }

        this._lastSkySyncKey = cacheKey;
        scene.background = new THREE.Color(hex);

        if (window.skyEnvLightMatchMainRect) {
            const intensity = uiVal * RECT_COEFF * scale;
            const skyCol = new THREE.Color(hex);

            if (!this._skyRect) {
                this._skyRect = new THREE.RectAreaLight(skyCol.getHex(), intensity, SKY_RECT_WIDTH, SKY_RECT_HEIGHT);
                this._skyRect.userData.isSkyFillLight = true;
                this._skyRect.name = 'SkyFillRectAreaLight';
                scene.add(this._skyRect);
            } else {
                if (this._skyRect.parent !== scene) scene.add(this._skyRect);
                this._skyRect.color.copy(skyCol);
                this._skyRect.intensity = intensity;
                this._skyRect.width = SKY_RECT_WIDTH;
                this._skyRect.height = SKY_RECT_HEIGHT;
            }
            this._skyRect.position.set(0, 80, 0);
            this._skyRect.lookAt(0, 1, 0);

            scene.backgroundIntensity = 1;
        } else {
            this._removeSkyRect(scene);
            scene.backgroundIntensity = computeBackgroundIntensity(hex, scale);
        }
    },

    syncUI() {
        const slider = document.getElementById('env-sky-light-scale');
        const valEl = document.getElementById('env-sky-light-val');
        let v = typeof window.envSkyLightScale === 'number' && !Number.isNaN(window.envSkyLightScale)
            ? window.envSkyLightScale
            : 0;
        v = Math.min(1, Math.max(0, v));
        window.envSkyLightScale = v;
        if (slider) slider.value = String(v);
        if (valEl) valEl.textContent = v.toFixed(2);
    },

    mountUI() {
        const slot = document.getElementById('sky-env-light-slot');
        if (!slot || document.getElementById('env-sky-light-scale')) return;
        const row = document.createElement('div');
        row.className = 'slider-row';
        row.style.cssText = 'flex:1; min-width:0; margin:0; display:flex; align-items:center; gap:4px;';
        row.innerHTML = `
            <input type="range" id="env-sky-light-scale" min="0" max="1" step="0.02" value="0"
                oninput="window.setSkyLightScale(this.value)">
            <span id="env-sky-light-val" class="slider-val" style="width:32px; flex:none; text-align:right;">0.00</span>`;
        slot.appendChild(row);
        this.syncUI();
    },
};

if (window.PluginManager && typeof window.PluginManager.register === 'function') {
    window.PluginManager.register('SkyEnvLight', window.SkyEnvLight);
}
