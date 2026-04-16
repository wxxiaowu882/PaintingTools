/**
 * 安装氛围/景深的宿主胶水函数（供 ControlPanel 调用）。
 * 目标：两端 window 状态字段一致，并把 “needsUpdate/lightMoved” 的副作用交给宿主注入。
 */
export function installSolidAtmosphereHostBindings(options) {
  const { markNeedsUpdate } = options || {};

  window.changeAtmosphere = function changeAtmosphere(enabled, density, config) {
    window.isFogEnabled = !!enabled;
    window.fogDensity = Number.isFinite(Number(density)) ? Number(density) : (window.fogDensity ?? 0.02);

    // config 可能是对象（新版）或数值（旧版 noise），保持兼容
    if (config !== undefined) window.fogNoise = config;

    if (window.AtmosphereManager && typeof window.AtmosphereManager.updateParams === 'function') {
      try { window.AtmosphereManager.updateParams(window.isFogEnabled, window.fogDensity, config); } catch (_e) {}
    }

    if (typeof markNeedsUpdate === 'function') {
      try { markNeedsUpdate('atmosphere'); } catch (_e) {}
    } else {
      window.needsUpdate = true;
    }
  };

  window.changeDoF = function changeDoF(enabled, aperture, focus) {
    if (window.DoFManager && typeof window.DoFManager.updateParams === 'function') {
      try { window.DoFManager.updateParams(!!enabled, aperture, focus); } catch (_e) {}
    }
    if (window.AtmosphereManager && typeof window.AtmosphereManager.updateDoFParams === 'function') {
      try { window.AtmosphereManager.updateDoFParams(!!enabled, aperture, focus); } catch (_e) {}
    }

    if (typeof markNeedsUpdate === 'function') {
      try { markNeedsUpdate('dof'); } catch (_e) {}
    } else {
      window.needsUpdate = true;
    }
  };
}

