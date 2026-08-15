// 消费端 Solid.html 与生产端 Solid_Portrait_Create 共用：场景 GLB 加载提示文案。

export const LARGE_SCENE_GLB_THRESHOLD = 6;
export const STALL_HINT_MS = 10000;

export const SOLID_LOAD_PHASES = {
  layout: { id: 'layout', main: '读取场景布局...', lo: 2, hi: 8 },
  glb_load: { id: 'glb_load', main: '', lo: 8, hi: 63 },
  annotations: { id: 'annotations', main: '恢复标注与场景元素...', lo: 63, hi: 83 },
  raster_env: { id: 'raster_env', main: '构建光栅光影...', lo: 83, hi: 90 },
  apply_mat: { id: 'apply_mat', main: '应用材质与灯光...', lo: 90, hi: 95 },
  first_preview: { id: 'first_preview', main: '首帧预览渲染...', lo: 95, hi: 98 },
  stabilize: { id: 'stabilize', main: '正在稳定画面...', lo: 98, hi: 100 },
};

export function getSolidLoadPhaseProgress(phaseId, ratio) {
  const phase = SOLID_LOAD_PHASES[phaseId];
  if (!phase) return 0;
  const r = Math.max(0, Math.min(1, Number(ratio) || 0));
  return phase.lo + (phase.hi - phase.lo) * r;
}

export function formatSolidGlbLoadHint({ done, total, phase, isLargeScene, stalled, overrideMain }) {
  const d = Math.max(0, Number(done) || 0);
  const t = Math.max(0, Number(total) || 0);
  let mainText = overrideMain != null ? String(overrideMain) : '';
  let subText = '';
  const loadingGlb = t > 0 && d < t;
  const large = isLargeScene != null ? !!isLargeScene : t >= LARGE_SCENE_GLB_THRESHOLD;

  if (!mainText) {
    if (loadingGlb) mainText = `正在加载模型 ${d}/${t}`;
    else if (t > 0 && d >= t) mainText = `正在加载模型 ${t}/${t}`;
    else if (phase) mainText = String(phase);
  }

  if (stalled) {
    subText = '仍在下载较大模型，网络较慢时属正常现象';
  } else if (large && loadingGlb) {
    subText = '模型较多，首次进入可能需要 30 秒～1 分钟';
  }

  return { mainText, subText };
}

export function formatSolidLoadPhaseHint({ phaseId, glbDone, glbTotal, stalled, progressRatio, overrideMain }) {
  const phase = SOLID_LOAD_PHASES[phaseId];
  if (!phase) return { mainText: '', subText: '', targetProgress: 0 };

  let mainText = '';
  let subText = '';
  let targetProgress = getSolidLoadPhaseProgress(phaseId, progressRatio != null ? progressRatio : 0);

  if (phaseId === 'glb_load') {
    const glbHint = formatSolidGlbLoadHint({
      done: glbDone,
      total: glbTotal,
      isLargeScene: (Number(glbTotal) || 0) >= LARGE_SCENE_GLB_THRESHOLD,
      stalled: !!stalled,
      overrideMain: overrideMain != null ? overrideMain : undefined,
    });
    mainText = glbHint.mainText;
    subText = glbHint.subText;
    if (progressRatio == null && (Number(glbTotal) || 0) > 0) {
      targetProgress = getSolidLoadPhaseProgress('glb_load', Math.min(1, (Number(glbDone) || 0) / Number(glbTotal)));
    }
  } else if (stalled && phaseId === 'stabilize') {
    mainText = overrideMain != null ? String(overrideMain) : '正在优化显示，马上完成...';
    subText = '仍在下载较大模型，网络较慢时属正常现象';
    targetProgress = Math.max(targetProgress, 98);
  } else {
    mainText = overrideMain != null ? String(overrideMain) : phase.main;
    subText = '';
    if (progressRatio == null) targetProgress = phase.lo;
  }

  return { mainText, subText, targetProgress };
}
