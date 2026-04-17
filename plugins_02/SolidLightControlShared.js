// 消费端 Solid.html 与生产端 Solid_Portrait_Create 共用：主光强度换算、灯体构造（含 rect 光栅降级）、
// 轨道位置、色温表、尺寸防抖与强度拖动策略。**强度倍率与灯体角度/尺寸公式仅允许在本文件常量区维护。**
// 拖动强度时只改 three.js Light.intensity，避免每帧销毁 shadow map / 整灯重建；松手 change 再完整 buildEnvironment。

/** 与控制面板 `lightIntensity` range（min 0.2 max 5）一致 */
export function clampSolidLightIntensitySlider(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 1.7;
  return Math.max(0.2, Math.min(5, n));
}

const SOLID_SPOT_ANGLE = Math.PI / 5.5;
const SOLID_SPOT_PENUMBRA = 0.5;
const SOLID_RECT_RASTER_SPOT_ANGLE = Math.PI / 3.2;
const SOLID_RECT_RASTER_SPOT_PENUMBRA = 0.75;

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
  const lSize = Number(lightSize);
  let light;
  let addSpotTargetToScene = false;

  if (lightType === 'spot') {
    const intensity = getSolidMainLightIntensityScalar('spot', false, val);
    light = new THREE.SpotLight(color, intensity);
    light.angle = SOLID_SPOT_ANGLE;
    light.penumbra = SOLID_SPOT_PENUMBRA;
    light.radius = lSize;
    addSpotTargetToScene = true;
  } else if (lightType === 'point') {
    light = new THREE.PointLight(color, getSolidMainLightIntensityScalar('point', false, val));
    light.radius = lSize;
  } else if (lightType === 'dir') {
    light = new THREE.DirectionalLight(color, getSolidMainLightIntensityScalar('dir', false, val));
    light.radius = lSize;
    // Keep directional light direction pipeline identical to spot:
    // target participates in scene graph and world-matrix updates.
    addSpotTargetToScene = true;
  } else if (lightType === 'rect') {
    if (useAdvancedRender) {
      const intensity = getSolidMainLightIntensityScalar('rect', true, val);
      const w = 8 * (lSize / 2 + 0.1);
      const h = 8 * (lSize / 2 + 0.1);
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
    light.radius = lSize;
    addSpotTargetToScene = true;
  }

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
    deps.state.lightSize = parseFloat(e.target.value);
    document.getElementById('sizeVal').innerText = deps.state.lightSize;
    deps.assignPathTracerFlags({ lightMoved: true });
    __debLightSize.schedule();
  });
  document.getElementById('lightSize').addEventListener('change', () => {
    __debLightSize.flush();
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
