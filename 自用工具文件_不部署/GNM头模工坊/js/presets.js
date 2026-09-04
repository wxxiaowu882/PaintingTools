/**
 * Load / apply identity & expression presets (data/presets/).
 * Left rail UI: 身份 / 表情 tabs + scrollable thumb list + 用户自定义身份。
 */
import {
  loadCustomIdentities,
  createCustomIdentity,
  updateCustomIdentity,
  deleteCustomIdentity,
  exportCustomIdentitiesFile,
  importCustomIdentitiesFile,
} from './custom-identities.js';
import { openIdentitySampleModal } from './identity-sample-modal.js';

const PRESETS_BASE = './data/presets/';
const PRESETS_CACHE = '20260831-asian11';
const STORAGE_PRESET_TAB = 'gnmWorkshop.presetRailTab.v1';

export async function loadPresetManifest() {
  const res = await fetch(PRESETS_BASE + `manifest.json?v=${PRESETS_CACHE}`);
  if (!res.ok) throw new Error('无法加载预设清单');
  return res.json();
}

export async function loadPresetFile(file) {
  const res = await fetch(PRESETS_BASE + `${file}?v=${PRESETS_CACHE}`);
  if (!res.ok) throw new Error(`无法加载预设 ${file}`);
  return res.json();
}

export function applyIdentityPreset(model, identity) {
  if (!identity || identity.length !== model.identityDim) {
    throw new Error(`身份维数不匹配：${identity?.length} / ${model.identityDim}`);
  }
  model.setIdentityVector(Float32Array.from(identity));
}

export function applyExpressionPreset(model, expression) {
  if (!expression || expression.length !== model.expressionDim) {
    throw new Error(`表情维数不匹配：${expression?.length} / ${model.expressionDim}`);
  }
  model.setExpressionVector(Float32Array.from(expression));
}

function mulberry32(a) {
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomizeIdentity(model, opts = {}) {
  const scale = opts.scale ?? 1.15;
  const seed = opts.seed ?? (Math.floor(Math.random() * 1e9) ^ Date.now());
  const rnd = mulberry32(seed >>> 0);
  const out = new Float32Array(model.identityDim);
  const base = opts.base;
  for (let i = 0; i < model.identityDim; i++) {
    const b = base ? Number(base[i]) || 0 : 0;
    const amp = i < 170 ? scale : scale * 0.35;
    const noise = (rnd() - 0.5) * 2 * amp;
    let v = b + noise;
    if (Math.abs(v) < 0.05) v = 0;
    out[i] = Math.max(-2.8, Math.min(2.8, v));
  }
  model.setIdentityVector(out);
  return { seed, vector: out };
}

/**
 * Mount left preset rail (身份 / 表情 tabs).
 * @param {HTMLElement} bodyEl  #preset-rail-body
 * @param {object} opts
 */
export async function mountPresetRail(bodyEl, opts) {
  const {
    manifest,
    onIdentity,
    onExpression,
    onRandomIdentity,
    thumbPreviewer,
    onStatus,
    railRoot,
  } = opts;

  bodyEl.innerHTML = '';

  const idPanel = document.createElement('div');
  idPanel.className = 'preset-rail-panel is-active';
  idPanel.dataset.presetPanel = 'identity';

  const exPanel = document.createElement('div');
  exPanel.className = 'preset-rail-panel';
  exPanel.dataset.presetPanel = 'expression';

  const idList = document.createElement('div');
  idList.className = 'preset-rail-list';
  const exList = document.createElement('div');
  exList.className = 'preset-rail-list';

  const clearBuiltinSelectionSoft = () => {
    idList
      .querySelectorAll('.preset-chip:not(.preset-chip-custom).is-selected')
      .forEach((c) => c.classList.remove('is-selected'));
  };

  const toolbar = document.createElement('div');
  toolbar.className = 'preset-toolbar';
  idList.appendChild(toolbar);

  const semanticBtn = document.createElement('button');
  semanticBtn.type = 'button';
  semanticBtn.className = 'btn preset-toolbar-btn';
  semanticBtn.title = '官方语义采样：性别/族裔预览确认后加入「我的身份」';
  semanticBtn.textContent = '语义采样';

  const rndBtn = document.createElement('button');
  rndBtn.type = 'button';
  rndBtn.className = 'btn preset-toolbar-btn';
  rndBtn.title = '在合理范围内随机扰动身份维（噪声，非官方语义采样）';
  rndBtn.textContent = '随机身份';

  toolbar.appendChild(semanticBtn);
  toolbar.appendChild(rndBtn);

  let clearCustomSelection = () => {};
  const customApi = mountCustomIdentitySection(idList, {
    getModel: opts.getModel,
    thumbPreviewer,
    toolbarEl: toolbar,
    onApply: (entry) => {
      onIdentity?.({ name: entry.name, identity: entry.identity });
      opts.onCustomSelected?.(entry.id);
    },
    onStatus,
    clearBuiltinSelection: clearBuiltinSelectionSoft,
  });
  clearCustomSelection = () => customApi.clearSelection();

  semanticBtn.addEventListener('click', async () => {
    try {
      await openIdentitySampleModal({
        model: opts.getModel?.(),
        onStatus,
        onListRefresh: async () => {
          await customApi.refresh();
        },
        onSelectCustom: async (id) => {
          clearBuiltinSelectionSoft();
          customApi.setSelectedId?.(id);
          await customApi.refresh();
        },
        onConfirmed: (entry) => {
          onIdentity?.({ name: entry.name, identity: entry.identity });
          opts.onCustomSelected?.(entry.id);
        },
      });
    } catch (err) {
      alert(err.message || String(err));
      onStatus?.(err.message || String(err));
    }
  });
  rndBtn.addEventListener('click', () => {
    clearCustomSelection();
    onRandomIdentity?.();
  });

  const railDivider = document.createElement('div');
  railDivider.className = 'preset-rail-divider';
  railDivider.setAttribute('role', 'separator');
  railDivider.title = '我的身份 / 自带身份';
  idList.appendChild(railDivider);

  const idChips = [];
  for (const item of manifest.identities || []) {
    const chip = makeChip(item, async () => {
      clearCustomSelection();
      const data = await loadPresetFile(item.file);
      onIdentity?.(data);
    });
    idChips.push({ item, chip });
    idList.appendChild(chip);
  }

  const exChips = [];
  for (const item of manifest.expressions || []) {
    const chip = makeChip(item, async () => {
      const data = await loadPresetFile(item.file);
      onExpression?.(data);
    });
    exChips.push({ item, chip });
    exList.appendChild(chip);
  }

  const note = document.createElement('p');
  note.className = 'preset-disclaimer';
  note.textContent = manifest.disclaimer || '统计采样，非真人';

  idPanel.appendChild(idList);
  idPanel.appendChild(note.cloneNode(true));
  exPanel.appendChild(exList);
  exPanel.appendChild(note);

  bodyEl.appendChild(idPanel);
  bodyEl.appendChild(exPanel);

  const root = railRoot || bodyEl.closest('#preset-rail');
  const tabs = root?.querySelectorAll('.preset-rail-tab') || [];
  let active = localStorage.getItem(STORAGE_PRESET_TAB) || 'identity';
  if (active !== 'identity' && active !== 'expression') active = 'identity';

  const setTab = (id) => {
    active = id;
    localStorage.setItem(STORAGE_PRESET_TAB, id);
    tabs.forEach((t) => t.classList.toggle('is-active', t.dataset.presetTab === id));
    idPanel.classList.toggle('is-active', id === 'identity');
    exPanel.classList.toggle('is-active', id === 'expression');
  };

  tabs.forEach((t) => {
    t.addEventListener('click', () => setTab(t.dataset.presetTab));
  });
  setTab(active);

  if (thumbPreviewer) {
    onStatus?.('正在生成预设预览图…');
    await new Promise((r) => setTimeout(r, 30));
    for (const { item, chip } of idChips) {
      try {
        const data = await loadPresetFile(item.file);
        const url = thumbPreviewer.renderPack({ identity: data.identity });
        setChipThumb(chip, url);
      } catch (err) {
        console.warn('identity thumb failed', item.id, err);
      }
      await new Promise((r) => setTimeout(r, 0));
    }
    for (const { item, chip } of exChips) {
      try {
        const data = await loadPresetFile(item.file);
        const url = thumbPreviewer.renderPack({ expression: data.expression });
        setChipThumb(chip, url);
      } catch (err) {
        console.warn('expression thumb failed', item.id, err);
      }
      await new Promise((r) => setTimeout(r, 0));
    }
    onStatus?.('预设预览就绪');
  }

  return { customIdentities: customApi };
}

/**
 * 左侧身份栏：用户自定义身份（localStorage + 文件导入导出）。
 */
export function mountCustomIdentitySection(listEl, opts) {
  const { getModel, thumbPreviewer, onApply, onStatus, clearBuiltinSelection, toolbarEl } = opts;
  let selectedId = null;

  const host = toolbarEl || listEl;

  const btnNew = document.createElement('button');
  btnNew.type = 'button';
  btnNew.className = 'btn preset-toolbar-btn';
  btnNew.title = '把当前头模存为新的自定义身份';
  btnNew.textContent = '新建';
  host.appendChild(btnNew);

  const btnSave = document.createElement('button');
  btnSave.type = 'button';
  btnSave.className = 'btn preset-toolbar-btn';
  btnSave.title = '覆盖保存当前选中的自定义身份';
  btnSave.textContent = '保存';
  btnSave.disabled = true;
  host.appendChild(btnSave);

  const btnExport = document.createElement('button');
  btnExport.type = 'button';
  btnExport.className = 'btn preset-toolbar-btn';
  btnExport.title = '导出自定义身份 JSON';
  btnExport.textContent = '导出';
  host.appendChild(btnExport);

  const btnImport = document.createElement('button');
  btnImport.type = 'button';
  btnImport.className = 'btn preset-toolbar-btn';
  btnImport.title = '导入身份 JSON 文件';
  btnImport.textContent = '导入';
  host.appendChild(btnImport);

  const title = document.createElement('div');
  title.className = 'preset-section-title';
  title.textContent = '我的身份';
  listEl.appendChild(title);

  const customList = document.createElement('div');
  customList.className = 'preset-rail-list preset-custom-list';
  listEl.appendChild(customList);

  const syncSaveBtn = () => {
    btnSave.disabled = !selectedId;
  };

  const clearCustomSelection = () => {
    customList.querySelectorAll('.preset-chip.is-selected').forEach((c) => c.classList.remove('is-selected'));
    selectedId = null;
    syncSaveBtn();
  };

  const selectChip = (chip, id) => {
    clearCustomSelection();
    selectedId = id;
    chip.classList.add('is-selected');
    syncSaveBtn();
    clearBuiltinSelection?.();
  };

  const renderList = async () => {
    customList.innerHTML = '';
    const items = loadCustomIdentities();
    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'muted';
      empty.style.margin = '4px 2px 8px';
      empty.textContent = '暂无，调好后点「新建」';
      customList.appendChild(empty);
      if (selectedId && !items.find((x) => x.id === selectedId)) {
        selectedId = null;
        syncSaveBtn();
      }
      return;
    }
    for (const item of items) {
      const chip = makeCustomChip(
        item,
        () => {
          selectChip(chip, item.id);
          onApply?.(item);
        },
        async () => {
          if (selectedId === item.id) {
            selectedId = null;
            syncSaveBtn();
          }
          await renderList();
        },
        (newName) => {
          onStatus?.(`已改名「${newName}」（已写入磁盘 JSON）`);
        }
      );
      if (item.id === selectedId) chip.classList.add('is-selected');
      customList.appendChild(chip);
      if (thumbPreviewer) {
        try {
          const url = thumbPreviewer.renderPack({ identity: item.identity });
          setChipThumb(chip, url);
        } catch (err) {
          console.warn('custom thumb failed', item.id, err);
        }
      }
    }
    syncSaveBtn();
  };

  btnNew.addEventListener('click', () => {
    const model = getModel?.();
    if (!model) return;
    const name = prompt('输入新身份名称：', '我的骨相');
    if (name == null) return;
    const trimmed = name.trim();
    if (!trimmed) {
      alert('名称不能为空');
      return;
    }
    const entry = createCustomIdentity(trimmed, model.identity);
    clearBuiltinSelection?.();
    selectedId = entry.id;
    renderList().then(() => {
      const chip = customList.querySelector(`[data-custom-id="${entry.id}"]`);
      if (chip) chip.classList.add('is-selected');
      syncSaveBtn();
    });
    onStatus?.(`已新建身份「${entry.name}」`);
  });

  btnSave.addEventListener('click', async () => {
    const model = getModel?.();
    if (!model || !selectedId) return;
    const cur = loadCustomIdentities().find((x) => x.id === selectedId);
    if (!cur) return;
    const rename = prompt('保存身份（可修改名称）：', cur.name);
    if (rename == null) return;
    const trimmed = rename.trim();
    if (!trimmed) {
      alert('名称不能为空');
      return;
    }
    try {
      await updateCustomIdentity(selectedId, { name: trimmed, identity: model.identity });
      await renderList();
      onStatus?.(`已保存身份「${trimmed}」`);
    } catch (err) {
      alert(err.message || String(err));
    }
  });

  btnExport.addEventListener('click', () => {
    const items = loadCustomIdentities();
    if (!items.length) {
      alert('还没有可导出的自定义身份');
      return;
    }
    exportCustomIdentitiesFile('gnm_custom_identities.json');
    onStatus?.(`已导出 ${items.length} 个自定义身份`);
  });

  btnImport.addEventListener('click', () => {
    document.getElementById('custom-id-import')?.click();
  });

  const api = {
    selectedId: () => selectedId,
    setSelectedId: (id) => {
      selectedId = id;
      syncSaveBtn();
    },
    clearSelection: clearCustomSelection,
    refresh: renderList,
    async importFile(file) {
      const result = await importCustomIdentitiesFile(file);
      await renderList();
      onStatus?.(`导入完成：新增 ${result.added} · 更新 ${result.updated}`);
      return result;
    },
  };

  renderList();
  return api;
}

/** @deprecated use mountPresetRail */
export async function mountPresetStrip(container, opts) {
  return mountPresetRail(container, opts);
}

function setChipThumb(chip, dataUrl) {
  const sw = chip.querySelector('.preset-swatch');
  if (!sw) return;
  sw.classList.add('has-thumb');
  sw.style.backgroundImage = `url(${dataUrl})`;
  sw.style.backgroundSize = 'cover';
  sw.style.backgroundPosition = 'center 18%';
  sw.style.backgroundColor = 'transparent';
}

function makeChip(item, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'preset-chip preset-chip-rail';
  btn.title = `${item.name}${item.note ? ' — ' + item.note : ''}`;
  const sw = document.createElement('span');
  sw.className = 'preset-swatch';
  sw.style.background = item.hue || '#666';
  const lab = document.createElement('span');
  lab.className = 'preset-chip-label';
  lab.textContent = item.name;
  btn.appendChild(sw);
  btn.appendChild(lab);
  btn.addEventListener('click', () => {
    btn.parentElement?.querySelectorAll('.preset-chip.is-selected').forEach((c) => {
      c.classList.remove('is-selected');
    });
    btn.classList.add('is-selected');
    onClick().catch((err) => {
      console.error(err);
      alert(err.message || String(err));
    });
  });
  return btn;
}

function makeCustomChip(item, onClick, onDelete, onRenamed) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'preset-chip preset-chip-rail preset-chip-custom';
  btn.dataset.customId = item.id;
  btn.title = `${item.name}（双击改名）`;
  const sw = document.createElement('span');
  sw.className = 'preset-swatch';
  sw.style.background = '#6a8';
  const lab = document.createElement('span');
  lab.className = 'preset-chip-label';
  lab.textContent = item.name;
  lab.title = '双击改名';
  const del = document.createElement('button');
  del.type = 'button';
  del.className = 'preset-chip-del';
  del.textContent = '×';
  del.title = '删除此身份';
  del.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm(`确定删除「${item.name}」？`)) return;
    await deleteCustomIdentity(item.id);
    onDelete?.();
  });

  const beginRename = () => {
    if (lab.querySelector('input')) return;
    const oldName = item.name;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'preset-chip-rename';
    input.value = oldName;
    input.maxLength = 64;
    input.setAttribute('aria-label', '修改身份名称');
    lab.textContent = '';
    lab.appendChild(input);
    input.focus();
    input.select();

    let finished = false;
    const finish = async (commit) => {
      if (finished) return;
      finished = true;
      const next = commit ? String(input.value || '').trim() : oldName;
      if (commit) {
        if (!next) {
          lab.textContent = oldName;
          alert('名称不能为空');
          return;
        }
        if (next === oldName) {
          lab.textContent = oldName;
          return;
        }
        try {
          await updateCustomIdentity(item.id, { name: next });
          item.name = next;
          lab.textContent = next;
          lab.title = '双击改名';
          btn.title = `${next}（双击改名）`;
          onRenamed?.(next);
        } catch (err) {
          lab.textContent = oldName;
          alert(err.message || String(err));
        }
        return;
      }
      lab.textContent = oldName;
    };

    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('mousedown', (e) => e.stopPropagation());
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      }
    });
    input.addEventListener('blur', () => {
      finish(true);
    });
  };

  btn.appendChild(sw);
  btn.appendChild(lab);
  btn.appendChild(del);
  btn.addEventListener('click', (e) => {
    if (e.target === del || e.target.closest?.('.preset-chip-del')) return;
    if (lab.querySelector('input')) return;
    btn.parentElement
      ?.querySelectorAll('.preset-chip.is-selected')
      .forEach((c) => c.classList.remove('is-selected'));
    btn.classList.add('is-selected');
    onClick();
  });
  btn.addEventListener('dblclick', (e) => {
    if (e.target === del || e.target.closest?.('.preset-chip-del')) return;
    e.preventDefault();
    e.stopPropagation();
    beginRename();
  });
  return btn;
}
