import { SOLID_RASTER_AREA_LIGHT_RIG } from '../Config/PaintingConfig.js';

// 消费端 Solid.html 与生产端 Solid_Portrait_Create 共用：主光强度换算、灯体构造（含 rect 光栅降级）、
// 轨道位置、色温表、尺寸防抖与强度拖动策略。**强度倍率与灯体角度/尺寸公式仅允许在本文件常量区维护。**
// 拖动强度时只改 three.js Light.intensity，避免每帧销毁 shadow map / 整灯重建；松手 change 再完整 buildEnvironment。

/** 与控制面板 `lightIntensity` range（min 0.2 max 8）一致 */
export function clampSolidLightIntensitySlider(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1.7;
  return Math.max(0.2, Math.min(8, n));
}

function _getSolidSizeBounds() {
  try {
    const cfg = SOLID_RASTER_AREA_LIGHT_RIG || {};
    const min = Number(cfg.sizeMin);
    const max = Number(cfg.sizeMax);
    const sizeMin = Number.isFinite(min) ? min : 1.0;
    const sizeMax = Number.isFinite(max) ? max : 15.0;
    return { sizeMin, sizeMax: Math.max(sizeMin + 1e-6, sizeMax) };
  } catch (_e) {
    return { sizeMin: 1.0, sizeMax: 15.0 };
  }
}

/** 与控制面板 `lightSize` range（min = rig.sizeMin, max = rig.sizeMax）一致 */
export function clampSolidLightSizeSlider(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1.9;
  const b = _getSolidSizeBounds();
  return Math.max(b.sizeMin, Math.min(b.sizeMax, n));
}

/** 与控制面板 `lightTemp` range（min 30 max 90）一致 */
export function clampSolidLightTempSlider(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 38;
  return Math.max(30, Math.min(90, n));
}

/** 光栅交互态统一口径（消费/生产一致） */
export function getSolidUnifiedInteractionState() {
  try {
    const w = (typeof window !== 'undefined') ? window : null;
    if (!w) return false;
    return !!(
      w._orbitInteracting ||
      (w.transformControl && w.transformControl.dragging) ||
      (w._planeXZDrag && w._planeXZDrag.active)
    );
  } catch (_e) {
    return false;
  }
}

const SOLID_SPOT_ANGLE = Math.PI / 5.5;
const SOLID_SPOT_PENUMBRA = 0.5;
const SOLID_RECT_RASTER_SPOT_ANGLE = Math.PI / 3.2;
const SOLID_RECT_RASTER_SPOT_PENUMBRA = 0.75;

function _clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function _sizeT(lightSize) {
  const n = Number(lightSize);
  if (!Number.isFinite(n)) return 0.3;
  const b = _getSolidSizeBounds();
  return _clamp01((n - b.sizeMin) / Math.max(1e-6, b.sizeMax - b.sizeMin));
}

function _ptSizeMapped(lightSize) {
  const s = clampSolidLightSizeSlider(lightSize);
  const b = _getSolidSizeBounds();
  const span = Math.max(1e-6, b.sizeMax - b.sizeMin);
  const t = _clamp01((s - b.sizeMin) / span);
  // 追光稳态：保留“size 越大越柔”的历史语义，但压缩高区间增速，降低大 size 噪点/发黑风险。
  return b.sizeMin + span * Math.pow(t, 0.72) * 0.58;
}

function _isPtSizeDecoupledTemp() {
  // 临时稳定策略（按需求）：size 先不进入追光参数，避免高 size 导致发黑/噪点尖峰。
  return true;
}

/**
 * 光栅单主光近似：size 增大时优先拓宽受光面过渡（spot/rect-raster 的 cone soft-edge），
 * 同时做轻微能量补偿，避免“越大越亮”。
 */
function _applySolidRasterPhysicalSizeApprox(light, lightType, lightSize, useAdvancedRender) {
  if (!light || useAdvancedRender) return;
  const t = _sizeT(lightSize);
  if (lightType === 'spot' || (lightType === 'rect' && light.isSpotLight)) {
    const baseA = lightType === 'rect' ? SOLID_RECT_RASTER_SPOT_ANGLE : SOLID_SPOT_ANGLE;
    const baseP = lightType === 'rect' ? SOLID_RECT_RASTER_SPOT_PENUMBRA : SOLID_SPOT_PENUMBRA;
    const angScale = 1.0 + 0.14 * t;
    light.angle = Math.min(Math.PI / 2 - 0.02, baseA * angScale);
    light.penumbra = Math.min(0.96, baseP + 0.36 * t);
    // 轻微补偿防止 cone 扩展造成主观变亮
    light.intensity = light.intensity * (1.0 - 0.16 * t);
  }
}

/**
 * 传给 `new *Light(color, intensity)` 的标量（与历史三处逻辑一致）。
 * @param {'spot'|'point'|'dir'|'rect'} lightType
 * @param {boolean} useAdvancedRender 对 rect：true 表示按 RectAreaLight 口径（光追）；false 为光栅降级 Spot 口径
 */
export function getSolidMainLightIntensityScalar(lightType, useAdvancedRender, sliderVal) {
  const val = clampSolidLightIntensitySlider(sliderVal);
  if (lightType === 'spot') return val * 300;
  if (lightType === 'point') return val * 250;
  if (lightType === 'dir') return val * 2.8;
  if (lightType === 'rect') {
    if (useAdvancedRender) return val * 18;
    return val * 300;
  }
  return val * 300;
}

/**
 * 将 UI 强度滑块值应用到**已有**主光，不重绑几何/shadow。
 * @param {import('three').Light | null | undefined} mainLight
 * @param {'spot'|'point'|'dir'|'rect'} lightType
 * @param {boolean} useAdvancedRender
 * @param {number} sliderVal
 * @returns {boolean} 是否已写入 intensity（false 表示无主光，宿主应 fallback 到 buildEnvironment）
 */
export function applySolidMainLightIntensityFromSlider(mainLight, lightType, useAdvancedRender, sliderVal) {
  if (!mainLight || !mainLight.isLight) return false;
  if (lightType === 'rect') {
    const adv = !!(useAdvancedRender && mainLight.isRectAreaLight);
    mainLight.intensity = getSolidMainLightIntensityScalar('rect', adv, sliderVal);
    return true;
  }
  mainLight.intensity = getSolidMainLightIntensityScalar(lightType, false, sliderVal);
  return true;
}

/**
 * 将 UI 大小滑块值应用到**已有**主光，避免交互中高频重建。
 * @returns {boolean} 是否已写入 size 参数
 */
export function applySolidMainLightSizeFromSlider(mainLight, lightType, useAdvancedRender, sliderVal) {
  if (!mainLight || !mainLight.isLight) return false;
  const lSize = clampSolidLightSizeSlider(sliderVal);
  if (useAdvancedRender && _isPtSizeDecoupledTemp()) return true;
  if (lightType === 'rect' && useAdvancedRender && mainLight.isRectAreaLight) {
    const ptSize = _ptSizeMapped(lSize);
    const w = 8 * (ptSize / 2 + 0.1);
    const h = 8 * (ptSize / 2 + 0.1);
    mainLight.width = w;
    mainLight.height = h;
    return true;
  }
  const eff = useAdvancedRender ? _ptSizeMapped(lSize) : lSize;
  if ('radius' in mainLight) {
    mainLight.radius = eff;
    return true;
  }
  return false;
}

/**
 * 光追模式下拖动强度：用 updateLights 路径而非 setScene+reset（勿设 lightMoved）。
 * 光栅模式：两标记均可不关，下一帧 render 即反映 intensity。
 */
export function solidLightIntensityDragPathTracerFlags(useAdvancedRender) {
  if (useAdvancedRender) {
    return { lightMoved: false, lightPosUpdated: true };
  }
  return { lightMoved: false, lightPosUpdated: false };
}

/**
 * 与 Solid 宿主中光源尺寸滑块相同的防抖重建，供生产/消费共用。
 * @param {() => void} run 一般为 `() => buildEnvironment()`
 * @param {number} [waitMs=90]
 */
export function createSolidLightSizeRebuildDebouncer(run, waitMs = 90) {
  let timer = 0;
  return {
    schedule() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = 0;
        try {
          run();
        } catch (_e) {}
      }, waitMs);
    },
    cancel() {
      if (timer) {
        clearTimeout(timer);
        timer = 0;
      }
    },
    flush() {
      if (timer) {
        clearTimeout(timer);
        timer = 0;
      }
      try {
        run();
      } catch (_e) {}
    },
  };
}

/**
 * 色温（开尔文，与 UI `state.lightTemp * 100` 一致）→ THREE.Color
 */
export function solidGetTempColorFromKelvin100(THREE, t) {
  const stops = [
    [3000, 255, 160, 87],
    [4000, 255, 200, 140],
    [5000, 255, 239, 223],
    [6000, 255, 255, 255],
    [7500, 225, 235, 255],
    [9000, 190, 210, 255],
  ];
  let c1 = stops[0];
  let c2 = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (t >= stops[i][0] && t <= stops[i + 1][0]) {
      c1 = stops[i];
      c2 = stops[i + 1];
      break;
    }
  }
  const f = (t - c1[0]) / (c2[0] - c1[0] || 1);
  return new THREE.Color(
    (c1[1] + f * (c2[1] - c1[1])) / 255,
    (c1[2] + f * (c2[2] - c1[2])) / 255,
    (c1[3] + f * (c2[3] - c1[3])) / 255,
  );
}

/**
 * 与 `solidGetTempColorFromKelvin100` 同口径，但复用 out（避免拖动时频繁 new Color 导致 GC 抖动）。
 * @param {typeof import('three')} THREE
 * @param {number} tKelvin100
 * @param {import('three').Color} out
 */
export function solidGetTempColorFromKelvin100Into(THREE, tKelvin100, out) {
  const stops = [
    [3000, 255, 160, 87],
    [4000, 255, 200, 140],
    [5000, 255, 239, 223],
    [6000, 255, 255, 255],
    [7500, 225, 235, 255],
    [9000, 190, 210, 255],
  ];
  let c1 = stops[0];
  let c2 = stops[stops.length - 1];
  for (let i = 0; i < stops.length - 1; i++) {
    if (tKelvin100 >= stops[i][0] && tKelvin100 <= stops[i + 1][0]) {
      c1 = stops[i];
      c2 = stops[i + 1];
      break;
    }
  }
  const f = (tKelvin100 - c1[0]) / (c2[0] - c1[0] || 1);
  const r = (c1[1] + f * (c2[1] - c1[1])) / 255;
  const g = (c1[2] + f * (c2[2] - c1[2])) / 255;
  const b = (c1[3] + f * (c2[3] - c1[3])) / 255;
  if (out && typeof out.setRGB === 'function') out.setRGB(r, g, b);
  return out;
}

/**
 * 与宿主 `updateLightPosition` 内球坐标公式一致。
 * @param {typeof import('three')} THREE
 * @param {{ radius: number; elevation: number|string; azimuth: number|string }} state
 */
export function computeSolidMainLightCartesianPosition(THREE, state) {
  const phi = THREE.MathUtils.degToRad(90 - parseFloat(String(state.elevation)));
  const theta = THREE.MathUtils.degToRad(parseFloat(String(state.azimuth)));
  const r = state.radius;
  return {
    x: r * Math.sin(phi) * Math.cos(theta),
    y: r * Math.cos(phi),
    z: r * Math.sin(phi) * Math.sin(theta),
  };
}

/**
 * 构造主光实例；不负责 scene.remove / shadow dispose（由宿主 `buildEnvironment` 开头处理）。
 * @returns {{ light: import('three').Light; addSpotTargetToScene: boolean }}
 */
export function createSolidMainLight(THREE, { lightType, color, intensitySlider, lightSize, useAdvancedRender }) {
  const val = clampSolidLightIntensitySlider(intensitySlider);
  const lSize = clampSolidLightSizeSlider(lightSize);
  const adv = !!useAdvancedRender;
  const ptSize = (adv && !_isPtSizeDecoupledTemp()) ? _ptSizeMapped(lSize) : 1.9;
  let light;
  let addSpotTargetToScene = false;

  if (lightType === 'spot') {
    const intensity = getSolidMainLightIntensityScalar('spot', false, val);
    light = new THREE.SpotLight(color, intensity);
    light.angle = SOLID_SPOT_ANGLE;
    light.penumbra = SOLID_SPOT_PENUMBRA;
    // IMPORTANT (anti-regression): 在追光中保持历史口径 `radius = size`，
    // 否则会显著削弱聚光灯半影与明暗交界线自然度。
    light.radius = ptSize;
    addSpotTargetToScene = true;
  } else if (lightType === 'point') {
    light = new THREE.PointLight(color, getSolidMainLightIntensityScalar('point', false, val));
    light.radius = ptSize;
  } else if (lightType === 'dir') {
    light = new THREE.DirectionalLight(color, getSolidMainLightIntensityScalar('dir', false, val));
    light.radius = ptSize;
    // Keep directional light direction pipeline identical to spot:
    // target participates in scene graph and world-matrix updates.
    addSpotTargetToScene = true;
  } else if (lightType === 'rect') {
    if (useAdvancedRender) {
      const intensity = getSolidMainLightIntensityScalar('rect', true, val);
      // IMPORTANT (anti-regression): 追光下 RectAreaLight 面积必须随 size 变化（历史基线）。
      const w = 8 * (ptSize / 2 + 0.1);
      const h = 8 * (ptSize / 2 + 0.1);
      light = new THREE.RectAreaLight(color.getHex(), intensity, w, h);
    } else {
      const intensity = getSolidMainLightIntensityScalar('rect', false, val);
      light = new THREE.SpotLight(color, intensity);
      light.angle = SOLID_RECT_RASTER_SPOT_ANGLE;
      light.penumbra = SOLID_RECT_RASTER_SPOT_PENUMBRA;
      light.radius = lSize;
      addSpotTargetToScene = true;
    }
  } else {
    const intensity = getSolidMainLightIntensityScalar('spot', false, val);
    light = new THREE.SpotLight(color, intensity);
    light.angle = SOLID_SPOT_ANGLE;
    light.penumbra = SOLID_SPOT_PENUMBRA;
    light.radius = ptSize;
    addSpotTargetToScene = true;
  }

  _applySolidRasterPhysicalSizeApprox(light, lightType, lSize, adv);

  return { light, addSpotTargetToScene };
}

/**
 * 注册主光六条滑块（与控制面板 id 一致）。宿主在 `setupUIControls` 内调用一次即可。
 * @param {object} deps
 * @param {object} deps.state
 * @param {() => boolean} deps.getUseAdvancedRender
 * @param {() => import('three').Light | null | undefined} deps.getMainLight
 * @param {() => string} deps.getLightType
 * @param {() => void} [deps.updateDirTriggerByValues]
 * @param {() => void} deps.buildEnvironment
 * @param {() => void} deps.updateLightPosition
 * @param {(tKelvin100: number) => import('three').Color} deps.getTempColor
 * @param {(flags: { lightMoved?: boolean; lightPosUpdated?: boolean }) => void} deps.assignPathTracerFlags
 * @param {(reason: string) => void} [deps.requestRasterProbe]
 * @param {() => void} [deps.afterLightTempInput]
 * @param {() => void} [deps.afterLightSizeInput]
 * @param {() => void} [deps.afterLightIntensityInput]
 */
export function installSolidMainLightSliderBindings(deps) {
  const probe = (reason) => {
    try {
      deps.requestRasterProbe?.(reason);
    } catch (_e) {}
  };
  const runDir = () => {
    try {
      deps.updateDirTriggerByValues?.();
    } catch (_e) {}
  };

  // 拖动更顺滑：对 input 事件做 rAF 合帧（每帧最多更新一次灯位/色温），避免高频 input 导致卡顿。
  let _rafPos = 0;
  let _rafTemp = 0;
  let _posDirty = false;
  let _dirDirty = false;
  let _tempDirty = false;
  const _tmpTempColor = (() => {
    try {
      // 依赖宿主/插件已 import three；这里仅为缓存对象，避免每次 new Color
      const c = deps.getTempColor?.(6000);
      if (c && typeof c.clone === 'function') return c.clone();
    } catch (_e) {}
    return null;
  })();

  function _schedulePos() {
    _posDirty = true;
    if (_rafPos) return;
    _rafPos = requestAnimationFrame(() => {
      _rafPos = 0;
      if (!_posDirty) return;
      _posDirty = false;
      deps.updateLightPosition();
      try {
        deps.afterLightDirectionInput?.();
      } catch (_e) {}
    });
  }

  function _scheduleTemp() {
    _tempDirty = true;
    if (_rafTemp) return;
    _rafTemp = requestAnimationFrame(() => {
      _rafTemp = 0;
      if (!_tempDirty) return;
      _tempDirty = false;
      const ml = deps.getMainLight();
      if (ml && ml.color) {
        try {
          if (_tmpTempColor) {
            // 复用 out，避免 GC
            solidGetTempColorFromKelvin100Into(
              { Color: ml.color.constructor },
              deps.state.lightTemp * 100,
              _tmpTempColor,
            );
            if (typeof ml.color.copy === 'function') ml.color.copy(_tmpTempColor);
            else ml.color = _tmpTempColor;
          } else {
            const c = deps.getTempColor(deps.state.lightTemp * 100);
            if (c && typeof ml.color.copy === 'function') ml.color.copy(c);
            else ml.color = c;
          }
        } catch (_e) {
          // fallback：不因色温更新失败而中断交互
          try { ml.color = deps.getTempColor(deps.state.lightTemp * 100); } catch (_e2) {}
        }
      }
      deps.assignPathTracerFlags({ lightPosUpdated: true });
      try {
        deps.afterLightTempInput?.();
      } catch (_e) {}
    });
  }

  document.querySelector('.control-panel').addEventListener('pointerdown', (e) => {
    if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'LABEL' && !e.target.classList.contains('env-btn')) {
      e.stopPropagation();
    }
  });

  document.getElementById('lightAzimuth').addEventListener('input', (e) => {
    deps.state.azimuth = e.target.value;
    document.getElementById('azimuthVal').innerText = deps.state.azimuth;
    _dirDirty = true;
    _schedulePos();
  });
  document.getElementById('lightAzimuth').addEventListener('change', () => {
    if (_dirDirty) { _dirDirty = false; runDir(); }
    probe('light_azimuth');
  });

  document.getElementById('lightElevation').addEventListener('input', (e) => {
    deps.state.elevation = e.target.value;
    document.getElementById('elevationVal').innerText = deps.state.elevation;
    _dirDirty = true;
    _schedulePos();
  });
  document.getElementById('lightElevation').addEventListener('change', () => {
    if (_dirDirty) { _dirDirty = false; runDir(); }
    probe('light_elevation');
  });

  document.getElementById('lightDistance').addEventListener('input', (e) => {
    deps.state.radius = parseFloat(e.target.value);
    document.getElementById('distanceVal').innerText = deps.state.radius;
    _schedulePos();
  });
  document.getElementById('lightDistance').addEventListener('change', () => probe('light_distance'));

  document.getElementById('lightTemp').addEventListener('input', (e) => {
    deps.state.lightTemp = parseInt(e.target.value, 10);
    document.getElementById('tempVal').innerText = deps.state.lightTemp * 100;
    _scheduleTemp();
  });
  document.getElementById('lightTemp').addEventListener('change', () => probe('light_temp'));

  const __debLightSize = createSolidLightSizeRebuildDebouncer(() => {
    try {
      deps.buildEnvironment();
    } catch (_e) {}
  }, 90);
  document.getElementById('lightSize').addEventListener('input', (e) => {
    deps.state.lightSize = clampSolidLightSizeSlider(e.target.value);
    document.getElementById('sizeVal').innerText = deps.state.lightSize;
    let applied = false;
    try {
      applied = applySolidMainLightSizeFromSlider(
        deps.getMainLight(),
        deps.getLightType(),
        deps.getUseAdvancedRender(),
        deps.state.lightSize,
      );
    } catch (_eAp) {
      applied = false;
    }
    try {
      deps.afterLightSizeInput?.();
    } catch (_eAs) {}
    if (deps.getUseAdvancedRender()) {
      if (!_isPtSizeDecoupledTemp()) {
        if (!applied) {
          try { deps.buildEnvironment(); } catch (_eB1) {}
        }
        deps.assignPathTracerFlags({ lightPosUpdated: true });
      }
    } else {
      deps.assignPathTracerFlags(applied ? { lightPosUpdated: true } : { lightMoved: true });
      if (!applied) __debLightSize.schedule();
    }
  });
  document.getElementById('lightSize').addEventListener('change', () => {
    if (deps.getUseAdvancedRender()) {
      if (!_isPtSizeDecoupledTemp()) {
        try { deps.buildEnvironment(); } catch (_eBszPt) {}
        deps.assignPathTracerFlags({ lightMoved: true });
      }
    } else {
      try { deps.buildEnvironment(); } catch (_eBsz) {}
      deps.assignPathTracerFlags({ lightMoved: true });
    }
    probe('light_size');
  });

  document.getElementById('lightIntensity').addEventListener('input', (e) => {
    const v = clampSolidLightIntensitySlider(e.target.value);
    document.getElementById('intensityVal').innerText = v.toFixed(1);
    try {
      if (
        applySolidMainLightIntensityFromSlider(
          deps.getMainLight(),
          deps.getLightType(),
          deps.getUseAdvancedRender(),
          v,
        )
      ) {
        const f = solidLightIntensityDragPathTracerFlags(deps.getUseAdvancedRender());
        deps.assignPathTracerFlags(f);
        try {
          deps.afterLightIntensityInput?.();
        } catch (_eAi) {}
      } else {
        deps.buildEnvironment();
        deps.assignPathTracerFlags({ lightMoved: true });
      }
    } catch (_e) {
      deps.buildEnvironment();
      deps.assignPathTracerFlags({ lightMoved: true });
    }
  });
  document.getElementById('lightIntensity').addEventListener('change', () => {
    try {
      deps.buildEnvironment();
    } catch (_e) {}
    deps.assignPathTracerFlags({ lightMoved: true });
    probe('light_intensity');
  });
}
