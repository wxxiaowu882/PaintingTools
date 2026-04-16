import * as THREE_NS from 'three';

function clamp01(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function toHexOrNull(v) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  return s;
}

/**
 * 安装环境光 Tab 的宿主胶水函数（供 ControlPanel / SkyEnvLight UI 调用）。
 * 只做“胶水层”：写 window 状态 + 同步 UI + 触发 onSkyEnvSync + 标记渲染更新 +（可选）光栅探针。
 */
export function installSolidEnvHostBindings(options) {
  const {
    THREE = THREE_NS,
    getScene,
    getGround,
    getWalls,
    getLightType,
    buildEnvironment,
    markNeedsUpdate,
    requestRasterProbe,
    triggerSkyEnvSync,
  } = options || {};

  function _getScene() {
    try { return typeof getScene === 'function' ? getScene() : null; } catch (_e) { return null; }
  }
  function _getLightType() {
    try { return typeof getLightType === 'function' ? getLightType() : undefined; } catch (_e) { return undefined; }
  }

  function _triggerSkySync() {
    const scene = _getScene();
    if (!scene) return;
    const lt = _getLightType();
    if (typeof triggerSkyEnvSync === 'function') {
      try { triggerSkyEnvSync({ scene, solidMainLightType: lt }); } catch (_e) {}
      return;
    }
    if (window.PluginManager && typeof window.PluginManager.trigger === 'function') {
      try { window.PluginManager.trigger('onSkyEnvSync', { scene, solidMainLightType: lt }); } catch (_e) {}
    }
  }

  window.setSkyLightScale = function setSkyLightScale(v) {
    window.envSkyLightScale = clamp01(v);
    const el = document.getElementById('env-sky-light-val');
    if (el) el.textContent = Number(window.envSkyLightScale).toFixed(2);
    _triggerSkySync();
    if (typeof markNeedsUpdate === 'function') {
      try { markNeedsUpdate('sky_light_scale'); } catch (_e) {}
    } else {
      // 兼容旧宿主：ControlPanel 仍会写 window.needsUpdate
      window.needsUpdate = true;
    }
    if (typeof requestRasterProbe === 'function') {
      try { requestRasterProbe('sky_light_scale'); } catch (_e) {}
    }
  };

  window.setEnvColor = function setEnvColor(kind, hex) {
    const h = toHexOrNull(hex);
    if (!h) return;
    if (kind === 'wall') window.envWallColor = h;
    else if (kind === 'ground') window.envGroundColor = h;
    else if (kind === 'sky') window.envSkyColor = h;

    // 立即同步可见对象（地面/墙），避免等 buildEnvironment 才更新导致“卡一帧”。
    try {
      if (kind === 'ground') {
        const g = typeof getGround === 'function' ? getGround() : null;
        if (g && g.material && g.material.color) g.material.color.set(h);
      }
      if (kind === 'wall') {
        const ws = typeof getWalls === 'function' ? getWalls() : null;
        if (Array.isArray(ws)) ws.forEach((w) => { if (w && w.material && w.material.color) w.material.color.set(h); });
      }
    } catch (_e) {}

    if (kind === 'sky') {
      _triggerSkySync();
    } else {
      // 非 sky：如果宿主愿意重建环境，则保持原行为（消费端原来不会为了 wall/ground 触发 sky sync）
      // 但有的宿主会在 toggleWall 时 buildEnvironment，这里不强制。
    }

    // 没有插件时仍能看到 sky 背景变化
    if (kind === 'sky') {
      const scene = _getScene();
      if (scene && (!window.PluginManager || typeof window.PluginManager.trigger !== 'function')) {
        try {
          scene.background = new THREE.Color(h);
          scene.backgroundIntensity = 1;
        } catch (_e) {}
      }
    }

    if (typeof markNeedsUpdate === 'function') {
      try { markNeedsUpdate('env_color_' + kind); } catch (_e) {}
    } else {
      window.needsUpdate = true;
    }
    if (typeof requestRasterProbe === 'function') {
      try { requestRasterProbe('env_color_' + kind); } catch (_e) {}
    }
  };

  window.syncEnvColorPickers = function syncEnvColorPickers() {
    const w = document.getElementById('env-wall-color');
    const g = document.getElementById('env-ground-color');
    const s = document.getElementById('env-sky-color');
    if (w) w.value = window.envWallColor || '#cccccc';
    if (g) g.value = window.envGroundColor || '#cccccc';
    if (s) s.value = window.envSkyColor || '#0d0d0f';
    const wchk = document.getElementById('wall-btn-checkbox');
    if (wchk) wchk.checked = !!window.hasWall;
    if (window.SkyEnvLight && typeof window.SkyEnvLight.syncUI === 'function') {
      try { window.SkyEnvLight.syncUI(); } catch (_e) {}
    }
  };

  window.toggleWall = function toggleWall() {
    window.hasWall = !window.hasWall;
    const btn = document.getElementById('wall-btn');
    const wchk = document.getElementById('wall-btn-checkbox');
    if (wchk) wchk.checked = !!window.hasWall;
    if (btn) {
      btn.classList.toggle('active', window.hasWall);
      btn.innerText = window.hasWall ? '☑ 背景墙' : '☐ 背景墙';
    }
    // 与消费端旧实现一致：稍微延迟重建，避免频繁点击造成抖动
    setTimeout(() => {
      if (typeof buildEnvironment === 'function') {
        try { buildEnvironment(); } catch (_e) {}
      }
      if (typeof markNeedsUpdate === 'function') {
        try { markNeedsUpdate('toggle_wall'); } catch (_e) {}
      } else {
        window.needsUpdate = true;
      }
      if (typeof requestRasterProbe === 'function') {
        try { requestRasterProbe('toggle_wall'); } catch (_e) {}
      }
    }, 100);
  };
}

