/**
 * 安装“辅助 tab”中与宿主无关/可共通的胶水：目前只抽 Posterize。
 * Material（changeMat）耦合 sceneGroup/sysMaterials，暂不在此统一，以免改动业务逻辑。
 */
export function installSolidAssistHostBindings(options) {
  const { markNeedsUpdate, requestRasterProbe, getUseAdvancedRender } = options || {};

  window.changePosterize = function changePosterize(levels) {
    // 优先走 PosterizeShared（两端都 import 了 Plugin_PosterizeShared.js）
    if (window.PosterizeShared && typeof window.PosterizeShared.apply === 'function') {
      try { window.PosterizeShared.apply(levels); } catch (_e) {}
      window.posterizeLevel = levels;
      if (typeof markNeedsUpdate === 'function') {
        try { markNeedsUpdate('posterize'); } catch (_e2) {}
      } else {
        window.needsUpdate = true;
      }
      return;
    }

    // 兼容旧实现：同步 slider 文案
    window.posterizeLevel = levels;
    const slider = document.getElementById('posterizeSlider');
    const valDisp = document.getElementById('posterizeVal');
    if (slider && valDisp) {
      const sliderVal = levels === 0 ? 0 : (21 - levels);
      slider.value = sliderVal;
      valDisp.innerText = levels === 0 ? '无' : (levels + '阶');
    }

    if (typeof markNeedsUpdate === 'function') {
      try { markNeedsUpdate('posterize'); } catch (_e3) {}
    } else {
      window.needsUpdate = true;
    }
    if (typeof requestRasterProbe === 'function') {
      try { requestRasterProbe('posterize'); } catch (_e4) {}
    }
    // 如果宿主在光栅模式需要强制刷新，可由 markNeedsUpdate/requestRasterProbe 负责；这里不直接触碰 renderer/pathTracer。
    if (typeof getUseAdvancedRender === 'function') {
      void getUseAdvancedRender(); // 仅保留扩展点，避免未来接口变更导致 unused
    }
  };
}

