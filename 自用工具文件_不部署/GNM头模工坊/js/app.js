import { GNMHeadModel, parseContainer } from './vendor/GNMModel.js';
import { WorkshopViewport, TARGET_HEIGHT_CM } from './viewport.js';
import { ControlsUI } from './controls-ui.js';
import { exportGnmGlb } from './export-glb.js';
import { importGnmGlbFile, applyPackToModel } from './import-glb.js';
import { createDefaultVisibility } from './extras.js';
import {
  loadPresetManifest,
  mountPresetRail,
  applyIdentityPreset,
  applyExpressionPreset,
  randomizeIdentity,
} from './presets.js';
import { ThumbPreviewer } from './thumb-preview.js';
import { EuroMuscleMap, peekMuscleMapFromGlb } from './euro-muscle-map.js';
import { EuroPuppet } from './euro-puppet.js';
import { saveLastBakePack, loadLastBakePack } from './bake-pack-cache.js';

const MODEL_URL = './data/gnm/gnm_head_web.bin';
const CONTROLS_URL = './data/controls.json';
const MODEL_CACHE = 'gnm-workshop-v1';

const $ = (sel) => document.querySelector(sel);

async function fetchWithProgress(url, onProgress) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
  const total = Number(response.headers.get('Content-Length')) || 0;
  if (!response.body || !total) {
    const buf = await response.arrayBuffer();
    onProgress?.(1);
    return buf;
  }
  const reader = response.body.getReader();
  const data = new Uint8Array(total);
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (received + value.length > total) {
      const chunks = [data.subarray(0, received), value];
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        chunks.push(next.value);
      }
      const length = chunks.reduce((n, c) => n + c.length, 0);
      const out = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
      }
      onProgress?.(1);
      return out.buffer;
    }
    data.set(value, received);
    received += value.length;
    onProgress?.(received / total);
  }
  return data.buffer.byteLength === received ? data.buffer : data.slice(0, received).buffer;
}

async function fetchModelBuffer(url, onProgress) {
  try {
    const cache = await caches.open(MODEL_CACHE);
    const hit = await cache.match(url);
    if (hit) {
      onProgress?.(1);
      return await hit.arrayBuffer();
    }
    const buf = await fetchWithProgress(url, onProgress);
    await cache.put(
      url,
      new Response(buf.slice(0), { headers: { 'Content-Type': 'application/octet-stream' } })
    );
    return buf;
  } catch (_) {
    return await fetchWithProgress(url, onProgress);
  }
}

function setStatus(msg) {
  const el = $('#status-text');
  if (el) el.textContent = msg;
}

function setProgress(frac, label) {
  const wrap = $('#loading-overlay');
  const bar = $('#loading-bar');
  const text = $('#loading-label');
  if (wrap) wrap.style.display = frac >= 1 ? 'none' : 'flex';
  if (bar) bar.style.width = `${Math.round(Math.min(1, Math.max(0, frac)) * 100)}%`;
  if (text && label) text.textContent = label;
}

async function main() {
  const canvas = $('#view-canvas');
  const viewport = new WorkshopViewport(canvas);
  let model = null;
  let visibility = [];
  let controlsConfig = null;
  let ui = null;
  let dirty = false;
  let title = 'gnm_head';
  let note = '';
  let lastHeightCm = TARGET_HEIGHT_CM;

  const markDirty = () => {
    dirty = true;
    document.title = '● GNM 头模工坊';
  };
  const clearDirty = () => {
    dirty = false;
    document.title = 'GNM 头模工坊';
  };

  const refreshStatus = (extra) => {
    if (!model) return;
    const base =
      `就绪 · GNM ${model.meta.gnmVersion} · ${model.numVertices} 顶点 · ` +
      `身份 ${model.identityDim} · 表情 ${model.expressionDim} · 包围盒高 ${lastHeightCm.toFixed(1)} cm`;
    setStatus(extra ? `${base} · ${extra}` : base);
  };

  viewport.onHeightChange = (cm) => {
    lastHeightCm = cm;
    refreshStatus();
  };

  window.addEventListener('beforeunload', (e) => {
    if (!dirty) return;
    e.preventDefault();
    e.returnValue = '';
  });

  setProgress(0.02, '加载控件配置…');
  controlsConfig = await (await fetch(CONTROLS_URL)).json();

  setProgress(0.05, '加载完整 GNM 基底…');
  try {
    const buffer = await fetchModelBuffer(MODEL_URL, (p) => {
      setProgress(0.05 + p * 0.9, `加载完整 GNM 基底… ${Math.round(p * 100)}%`);
    });
    const { meta, sections } = parseContainer(buffer);
    model = new GNMHeadModel(meta, sections);
  } catch (err) {
    setProgress(0, '基底缺失');
    $('#loading-label').textContent =
      '未找到 data/gnm/gnm_head_web.bin。请运行: node scripts/prepare-gnm-assets.mjs';
    console.error(err);
    return;
  }

  visibility = createDefaultVisibility(model.meta.componentNames.length);
  viewport.bindModel(model);
  viewport.setVisibility(visibility);
  setProgress(1, '就绪');

  const muscleHint = $('#muscle-hint');
  const muscleMap = new EuroMuscleMap({
    scene: viewport.scene,
    getDisplayPositions: () => viewport.positions,
    getRawPositions: () => viewport.rawPositions,
    getGnmModel: () => model,
    getComponentId: () => model?.componentId,
    getVertexCount: () => model?.numVertices || 0,
    onStatus: (msg) => {
      if (muscleHint) muscleHint.textContent = msg;
    },
  });
  viewport.onAfterRefresh = () => muscleMap.scheduleUpdate();

  if (typeof window !== 'undefined') {
    window.__gnmMuscleDebug = muscleMap;
    window.__gnmWorkshopDebug = {
      getGnmHeadState: () => {
        const kinds = (viewport.gnmHead?.parts || []).map((p) => p.kind);
        const sclera = viewport.gnmHead?.eyeScleraMesh?.material;
        return {
          kinds,
          hasInner: kinds.includes('eyeInner'),
          hasSclera: kinds.includes('eyeSclera'),
          scleraMat: sclera?.type || '',
          scleraTransmission: sclera?.transmission ?? null,
        };
      },
    };
  }

  const bumpMuscle = () => {
    viewport.refreshGeometry(true);
    muscleMap.scheduleUpdate();
  };

  let lastEuroOpacityPct = 75;
  let viewMode = 'both';
  let customIdentitiesApi = null;

  const setGnmOpacityPct = (pct) => {
    const v = Math.max(0, Math.min(100, pct));
    const slider = $('#gnm-opacity');
    if (slider) slider.value = String(v);
    viewport.setOpacity(v / 100);
    const lab = $('#gnm-opacity-val');
    if (lab) lab.textContent = `${v}%`;
  };

  const setEuroOpacityPct = (pct) => {
    const v = Math.max(0, Math.min(100, pct));
    const slider = $('#muscle-opacity');
    if (slider) slider.value = String(v);
    muscleMap.setOpacity(v / 100);
    const lab = $('#muscle-opacity-val');
    if (lab) lab.textContent = `${v}%`;
    if (v > 0) lastEuroOpacityPct = v;
  };

  const syncViewModeButtons = () => {
    $('#btn-view-gnm')?.classList.toggle('is-active', viewMode === 'gnm');
    $('#btn-view-euro')?.classList.toggle('is-active', viewMode === 'euro');
    $('#btn-view-both')?.classList.toggle('is-active', viewMode === 'both');
  };

  const applyViewMode = (mode) => {
    viewMode = mode;
    syncViewModeButtons();
    if (mode === 'gnm') {
      setGnmOpacityPct(100);
      setEuroOpacityPct(0);
    } else if (mode === 'euro') {
      setGnmOpacityPct(0);
      setEuroOpacityPct(100);
    } else {
      setGnmOpacityPct(100);
      setEuroOpacityPct(lastEuroOpacityPct || 75);
    }
  };

  $('#btn-view-gnm')?.addEventListener('click', () => applyViewMode('gnm'));
  $('#btn-view-euro')?.addEventListener('click', () => {
    if (!muscleMap._loaded) {
      alert('请先加载烘焙包');
      return;
    }
    if (!$('#muscle-enable')?.checked) {
      const chk = $('#muscle-enable');
      if (chk) chk.checked = true;
      muscleMap.setEnabled(true);
      muscleMap.scheduleUpdate();
    }
    applyViewMode('euro');
  });
  $('#btn-view-both')?.addEventListener('click', () => {
    if (muscleMap._loaded && !$('#muscle-enable')?.checked) {
      const chk = $('#muscle-enable');
      if (chk) chk.checked = true;
      muscleMap.setEnabled(true);
      muscleMap.scheduleUpdate();
    }
    applyViewMode('both');
  });

  $('#gnm-opacity')?.addEventListener('input', (e) => {
    const v = Number(e.target.value);
    setGnmOpacityPct(v);
    if (v > 0 && muscleMap.opacity > 0) viewMode = 'both';
    else if (v > 0) viewMode = 'gnm';
    else if (muscleMap.opacity > 0) viewMode = 'euro';
    syncViewModeButtons();
  });

  $('#muscle-opacity')?.addEventListener('input', (e) => {
    const v = Number(e.target.value);
    setEuroOpacityPct(v);
    const gnmV = Number($('#gnm-opacity')?.value || 0);
    if (gnmV > 0 && v > 0) viewMode = 'both';
    else if (v > 0) viewMode = 'euro';
    else if (gnmV > 0) viewMode = 'gnm';
    syncViewModeButtons();
  });

  const finishBakePackLoad = () => {
    viewport.refreshGeometry(true);
    muscleMap.rebindTrackers();
    const chk = $('#muscle-enable');
    if (chk) chk.checked = true;
    muscleMap.setEnabled(true);
    muscleMap.scheduleUpdate();
    if (viewMode === 'gnm') applyViewMode('both');
    else if (viewMode === 'euro') applyViewMode('euro');
  };

  const loadBakePackFromBuffer = async (glbBuffer, mapJson, persistMeta = null) => {
    if (!mapJson) mapJson = peekMuscleMapFromGlb(glbBuffer);
    if (!mapJson) throw new Error('未找到映射表（请使用含 extras 的烘焙 GLB 或另附 map.json）');
    await muscleMap.loadPack(glbBuffer, mapJson);
    if (persistMeta) {
      try {
        await saveLastBakePack(glbBuffer, persistMeta);
      } catch (err) {
        console.warn('烘焙包缓存失败', err);
      }
    }
    finishBakePackLoad();
  };

  $('#btn-load-bake')?.addEventListener('click', () => $('#bake-pack-files')?.click());
  $('#bake-pack-files')?.addEventListener('change', async (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = '';
    const glbFile = files.find((f) => /\.glb$/i.test(f.name));
    const mapFile = files.find((f) => /_map\.json$/i.test(f.name) || /\.json$/i.test(f.name));
    if (!glbFile) {
      alert('请选择 *_baked.glb（映射表可内嵌在 GLB 或另附 *_map.json）');
      return;
    }
    try {
      if (muscleHint) muscleHint.textContent = '加载烘焙包…';
      const glbBuffer = await glbFile.arrayBuffer();
      let mapJson = null;
      if (mapFile) mapJson = JSON.parse(await mapFile.text());
      await loadBakePackFromBuffer(glbBuffer, mapJson, {
        fileName: glbFile.name,
        mapJson: mapFile ? mapJson : null,
      });
    } catch (err) {
      alert(err.message || String(err));
      if (muscleHint) muscleHint.textContent = `加载失败：${err.message || err}`;
    }
  });

  $('#muscle-enable')?.addEventListener('change', (ev) => {
    muscleMap.setEnabled(!!ev.target.checked);
    if (muscleMap.enabled) muscleMap.scheduleUpdate();
    else setEuroOpacityPct(0);
  });

  $('#btn-export-euro')?.addEventListener('click', async () => {
    try {
      $('#btn-export-euro').disabled = true;
      const base = (muscleMap.map?.note || title || 'euro_muscle').replace(/[^\w\u4e00-\u9fff\-]+/g, '_');
      await muscleMap.exportMuscleGlb(`${base}_muscle.glb`);
      setStatus(`已导出欧版肌肉 GLB`);
    } catch (err) {
      alert(err.message || String(err));
      setStatus('欧版肌肉导出失败');
    } finally {
      $('#btn-export-euro').disabled = false;
    }
  });

  // 实验：历史版提线木偶（遗留）
  const puppetSel = $('#puppet-version');
  const puppet = new EuroPuppet({
    scene: viewport.scene,
    getDisplayPositions: () => viewport.positions,
    getRawPositions: () => viewport.rawPositions,
    getComponentId: () => model?.componentId,
    getVertexCount: () => model?.numVertices || 0,
    onStatus: () => {},
  });

  const loadPuppetHistoryList = async () => {
    if (!puppetSel) return;
    try {
      const versions = await puppet.fetchHistoryIndex();
      puppetSel.innerHTML = '';
      if (!versions.length) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = '（暂无对齐历史）';
        puppetSel.appendChild(opt);
        return;
      }
      for (const v of versions) {
        const opt = document.createElement('option');
        opt.value = v.id;
        const t = (v.createdAt || '').replace('T', ' ').slice(0, 19);
        const note = v.note ? ` · ${v.note}` : '';
        const warp = v.warpSummary ? ` · ${v.warpSummary}` : '';
        opt.textContent = `${t}${note} · ${v.pointCount || '?'}点${warp}`;
        opt.dataset.meta = JSON.stringify(v);
        puppetSel.appendChild(opt);
      }
      puppetSel.selectedIndex = 0;
    } catch (e) {
      puppetSel.innerHTML = '<option value="">历史加载失败</option>';
      console.warn('puppet history', e);
    }
  };

  loadPuppetHistoryList();

  $('#puppet-version')?.addEventListener('change', async () => {
    const opt = puppetSel?.selectedOptions?.[0];
    if (!opt?.dataset?.meta) return;
    try {
      const meta = JSON.parse(opt.dataset.meta);
      await puppet.loadVersion(meta);
      if ($('#puppet-enable')?.checked) puppet.setEnabled(true);
      puppet.scheduleUpdate();
    } catch (e) {
      alert(e.message || String(e));
    }
  });

  $('#puppet-enable')?.addEventListener('change', (e) => {
    puppet.setEnabled(!!e.target.checked);
    if (puppet.enabled) puppet.scheduleUpdate();
  });

  $('#puppet-rebind')?.addEventListener('click', () => {
    puppet.rebindTrackers();
    puppet.scheduleUpdate();
  });

  ui = new ControlsUI($('#controls-root'), controlsConfig, {
    getVisibility: () => visibility,
    onVisibility: (next) => {
      visibility = next;
      viewport.setVisibility(visibility);
      markDirty();
    },
    onIdentityParam: (index, value) => {
      model.setIdentityParam(index, value);
      markDirty();
      ui.markDirtyUI();
      bumpMuscle();
    },
    onExpressionParam: (index, value) => {
      model.setExpressionParam(index, value);
      markDirty();
      ui.markDirtyUI();
      bumpMuscle();
    },
    onJointRotation: (ji, x, y, z) => {
      model.setJointRotation(ji, x, y, z);
      markDirty();
      ui.markDirtyUI();
      bumpMuscle();
    },
    onResetIdentity: () => {
      model.resetIdentity();
      markDirty();
      ui.syncFromModel();
      bumpMuscle();
    },
    onResetExpression: () => {
      model.resetExpression();
      markDirty();
      ui.syncFromModel();
      bumpMuscle();
    },
    onResetPose: () => {
      model.resetPose();
      markDirty();
      ui.syncFromModel();
      bumpMuscle();
    },
    onResetAll: () => {
      model.resetIdentity();
      model.resetExpression();
      model.resetPose();
      markDirty();
      ui.syncFromModel();
      bumpMuscle();
    },
    onCommonIdsChanged: () => markDirty(),
  });
  ui.setModel(model);

  const wireReset = (sel, fn) => {
    $(sel)?.addEventListener('click', () => {
      fn();
      customIdentitiesApi?.clearSelection?.();
    });
  };
  wireReset('#btn-reset-identity', () => {
    model.resetIdentity();
    markDirty();
    ui.syncFromModel();
    bumpMuscle();
  });
  wireReset('#btn-reset-expression', () => {
    model.resetExpression();
    markDirty();
    ui.syncFromModel();
    bumpMuscle();
  });
  wireReset('#btn-reset-pose', () => {
    model.resetPose();
    markDirty();
    ui.syncFromModel();
    bumpMuscle();
  });
  wireReset('#btn-reset-all', () => {
    model.resetIdentity();
    model.resetExpression();
    model.resetPose();
    markDirty();
    ui.syncFromModel();
    bumpMuscle();
  });

  try {
    const manifest = await loadPresetManifest();
    const thumbs = new ThumbPreviewer(model, { size: 128 });
    const railApi = await mountPresetRail($('#preset-rail-body'), {
      manifest,
      railRoot: $('#preset-rail'),
      thumbPreviewer: thumbs,
      getModel: () => model,
      onStatus: setStatus,
      onIdentity: (data) => {
        applyIdentityPreset(model, data.identity);
        viewport.refreshGeometry(true);
        ui.syncFromModel();
        markDirty();
        muscleMap.scheduleUpdate();
        refreshStatus(`预设：${data.name}`);
      },
      onExpression: (data) => {
        applyExpressionPreset(model, data.expression);
        viewport.refreshGeometry(true);
        ui.syncFromModel();
        markDirty();
        muscleMap.scheduleUpdate();
        refreshStatus(`预设：${data.name}`);
      },
      onRandomIdentity: () => {
        const { seed } = randomizeIdentity(model, { scale: 1.2 });
        viewport.refreshGeometry(true);
        ui.syncFromModel();
        markDirty();
        muscleMap.scheduleUpdate();
        refreshStatus(`随机身份 #${seed}`);
      },
    });
    customIdentitiesApi = railApi?.customIdentities || null;
    viewport.refreshGeometry(true);
    viewport.frameHead();
    viewport.resize();
    refreshStatus();
  } catch (err) {
    console.warn('预设条加载失败', err);
    const body = $('#preset-rail-body');
    if (body) body.textContent = '预设加载失败（可继续手调）';
  }

  $('#field-title').value = title;
  $('#field-title').addEventListener('input', (e) => {
    title = e.target.value.trim() || 'gnm_head';
    markDirty();
  });
  $('#field-note').addEventListener('input', (e) => {
    note = e.target.value;
    markDirty();
  });

  $('#custom-id-import')?.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      await customIdentitiesApi?.importFile?.(file);
    } catch (err) {
      alert(err.message || String(err));
    }
  });

  $('#btn-import').addEventListener('click', () => $('#file-import').click());
  $('#file-import').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      setStatus('正在导入 GLB…');
      const { pack, fileName } = await importGnmGlbFile(file);
      const applied = applyPackToModel(model, pack);
      visibility = applied.visibility;
      if (applied.commonControlIds?.length) {
        ui.saveCommonIds(applied.commonControlIds);
      }
      title = applied.title || fileName.replace(/\.glb$/i, '') || title;
      note = applied.note || '';
      $('#field-title').value = title;
      $('#field-note').value = note;
      viewport.setVisibility(visibility);
      viewport.refreshGeometry(true);
      ui.syncFromModel();
      markDirty();
      refreshStatus(`已导入：${fileName}`);
    } catch (err) {
      console.error(err);
      alert(err.message || String(err));
      setStatus('导入失败');
    }
  });

  const dropZone = $('#viewport-wrap');
  ;['dragenter', 'dragover'].forEach((ev) => {
    dropZone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });
  });
  ;['dragleave', 'drop'].forEach((ev) => {
    dropZone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
    });
  });
  dropZone.addEventListener('drop', async (e) => {
    const file = [...(e.dataTransfer?.files || [])].find((f) => /\.glb$/i.test(f.name));
    if (!file) return;
    try {
      const { pack, fileName } = await importGnmGlbFile(file);
      const applied = applyPackToModel(model, pack);
      visibility = applied.visibility;
      if (applied.commonControlIds?.length) ui.saveCommonIds(applied.commonControlIds);
      title = applied.title || fileName.replace(/\.glb$/i, '');
      note = applied.note || '';
      $('#field-title').value = title;
      $('#field-note').value = note;
      viewport.setVisibility(visibility);
      viewport.refreshGeometry(true);
      ui.syncFromModel();
      markDirty();
      refreshStatus(`已拖入：${fileName}`);
    } catch (err) {
      alert(err.message || String(err));
    }
  });

  $('#btn-export').addEventListener('click', async () => {
    const tier = /** @type {'light'|'standard'|'full'} */ ($('#export-tier').value);
    const useDraco = $('#export-draco').checked;
    try {
      $('#btn-export').disabled = true;
      await exportGnmGlb({
        viewport,
        model,
        visibility,
        commonControlIds: ui.commonIds,
        title,
        note,
        tier,
        useDraco,
        onStatus: setStatus,
      });
      clearDirty();
    } catch (err) {
      console.error(err);
      alert('导出失败：' + (err.message || err));
      setStatus('导出失败');
    } finally {
      $('#btn-export').disabled = false;
    }
  });

  try {
    const saved = await loadLastBakePack();
    if (saved?.glbBuffer?.byteLength) {
      if (muscleHint) muscleHint.textContent = '正在恢复上次烘焙包…';
      await loadBakePackFromBuffer(saved.glbBuffer, saved.mapJson, null);
      refreshStatus(`已恢复烘焙包：${saved.fileName}`);
    }
  } catch (err) {
    console.warn('自动恢复烘焙包失败', err);
    if (muscleHint && !muscleMap._loaded) {
      muscleHint.textContent = '请从「对齐叠显」导出烘焙包（GLB 内已含映射表）后加载';
    }
  }

  refreshStatus();
}

main().catch((err) => {
  console.error(err);
  setProgress(0, String(err.message || err));
});
