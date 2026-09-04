import {
  isModifiedCoeff,
  pcaSliderRange,
  STORAGE_COMMON_KEY,
  STORAGE_EXPR_KEY,
  STORAGE_DIRTY_ONLY,
  STORAGE_EYE_SYNC,
  STORAGE_ACTIVE_TAB,
} from './extras.js';
import { createCaptureSlider } from './capture-slider.js';
import { getParamLabel, setParamLabel, onParamLabelsChange } from './param-labels.js';
import {
  getHeadEffectClusters,
  renameIdentityCluster,
  onIdentityTaxonomyChange,
} from './identity-taxonomy.js';
import {
  loadFavoriteKeys,
  isFavorite,
  toggleFavorite,
  makeFavoriteKey,
} from './param-favorites.js';

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'className') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function')
      node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== false && v != null) node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

const TABS = [
  { id: 'bone', label: '骨相' },
  { id: 'expr', label: '表情' },
  { id: 'fav', label: '收藏' },
  { id: 'pose', label: '姿态' },
  { id: 'vis', label: '显示' },
  { id: 'all', label: '全部' },
];

export class ControlsUI {
  constructor(root, controlsConfig, handlers) {
    this.root = root;
    this.cfg = controlsConfig;
    this.handlers = handlers;
    this.model = null;
    this.commonIds = this._loadCommonIds();
    this.expressionIds = this._loadExpressionIds();
    this.showDirtyOnly = localStorage.getItem(STORAGE_DIRTY_ONLY) === '1';
    this.eyeSync = localStorage.getItem(STORAGE_EYE_SYNC) !== '0';
    this.activeTab = localStorage.getItem(STORAGE_ACTIVE_TAB) || 'bone';
    this._sliderRefs = new Map();
    this._dragging = false;
    this._openAdvGroups = new Set();
    this._unsubParamLabels = onParamLabelsChange(() => this._refreshParamLabels());
    this._unsubTaxonomy = onIdentityTaxonomyChange(() => {
      if (this.activeTab === 'all') this._buildAdvanced();
    });
    this.renderShell();
  }

  _displayParamLabel(labelStore, defaultLabel) {
    if (!labelStore) return defaultLabel;
    return getParamLabel(labelStore.section, labelStore.key) ?? defaultLabel;
  }

  _makeRenamableLabel(labelStore, defaultLabel) {
    const labelEl = el('span', {
      className: 'slider-label is-renamable',
      text: this._displayParamLabel(labelStore, defaultLabel),
      title: labelStore ? '双击可重命名' : undefined,
    });
    if (!labelStore) return labelEl;
    labelEl.dataset.labelSection = labelStore.section;
    labelEl.dataset.labelKey = labelStore.key;
    labelEl.dataset.labelDefault = defaultLabel;
    labelEl.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._beginLabelEdit(labelEl, labelStore, defaultLabel);
    });
    return labelEl;
  }

  _beginLabelEdit(labelEl, labelStore, defaultLabel) {
    if (labelEl.dataset.editing === '1') return;
    labelEl.dataset.editing = '1';
    const current = labelEl.textContent || '';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'slider-label-edit';
    input.value = current;
    labelEl.textContent = '';
    labelEl.appendChild(input);
    input.focus();
    input.select();

    let cancelled = false;
    const finish = () => {
      delete labelEl.dataset.editing;
      if (!cancelled) {
        const next = input.value.trim();
        if (!next || next === defaultLabel) setParamLabel(labelStore.section, labelStore.key, '');
        else setParamLabel(labelStore.section, labelStore.key, next);
      }
      labelEl.textContent = this._displayParamLabel(labelStore, defaultLabel);
    };
    input.addEventListener(
      'blur',
      () => {
        finish();
      },
      { once: true }
    );
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        input.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelled = true;
        input.blur();
      }
    });
  }

  _refreshParamLabels() {
    this.root.querySelectorAll('.slider-label[data-label-section]').forEach((labelEl) => {
      const section = labelEl.dataset.labelSection;
      const key = labelEl.dataset.labelKey;
      const defaultLabel = labelEl.dataset.labelDefault || '';
      if (!section || key == null) return;
      labelEl.textContent = getParamLabel(section, key) ?? defaultLabel;
    });
  }

  _makeFavoriteBtn(favKey) {
    const active = isFavorite(favKey);
    const btn = el('button', {
      type: 'button',
      className: 'btn-fav' + (active ? ' is-active' : ''),
      text: active ? '★' : '☆',
      title: active ? '取消收藏' : '加入收藏',
      'data-fav-key': favKey,
      onClick: (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleFavorite(favKey);
        this._refreshFavoriteIcons();
        this._buildFavorites();
      },
    });
    return btn;
  }

  _refreshFavoriteIcons() {
    this.root.querySelectorAll('.btn-fav[data-fav-key]').forEach((btn) => {
      const key = btn.getAttribute('data-fav-key');
      if (!key) return;
      const active = isFavorite(key);
      btn.classList.toggle('is-active', active);
      btn.textContent = active ? '★' : '☆';
      btn.title = active ? '取消收藏' : '加入收藏';
    });
  }

  _advGroupKey(kind, group) {
    return `${kind}:${group.id}`;
  }

  _syncAdvGroupOpenFromDom() {
    if (!this.advBox) return;
    this.advBox.querySelectorAll('details.group-fold').forEach((det) => {
      const key = det.dataset.groupKey;
      if (!key) return;
      if (det.open) this._openAdvGroups.add(key);
      else this._openAdvGroups.delete(key);
    });
  }

  _bindAdvGroupFold(det, key) {
    det.dataset.groupKey = key;
    det.open = this.showDirtyOnly || this._openAdvGroups.has(key);
    det.addEventListener('toggle', () => {
      if (det.open) this._openAdvGroups.add(key);
      else this._openAdvGroups.delete(key);
    });
  }

  _loadCommonIds() {
    try {
      const raw = localStorage.getItem(STORAGE_COMMON_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length) return arr;
      }
    } catch (_) {}
    return this.cfg.defaultCommonIds.slice();
  }

  _loadExpressionIds() {
    try {
      const raw = localStorage.getItem(STORAGE_EXPR_KEY);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length) return arr;
      }
    } catch (_) {}
    return (this.cfg.defaultExpressionIds || []).slice();
  }

  saveCommonIds(ids) {
    this.commonIds = ids.slice();
    localStorage.setItem(STORAGE_COMMON_KEY, JSON.stringify(this.commonIds));
    this.rebuildLists();
  }

  saveExpressionIds(ids) {
    this.expressionIds = ids.slice();
    localStorage.setItem(STORAGE_EXPR_KEY, JSON.stringify(this.expressionIds));
    this.rebuildLists();
  }

  setModel(model) {
    this.model = model;
    this.rebuildLists();
  }

  setTab(id) {
    this.activeTab = id;
    localStorage.setItem(STORAGE_ACTIVE_TAB, id);
    this.root.querySelectorAll('.tab-btn').forEach((b) => {
      b.classList.toggle('is-active', b.dataset.tab === id);
    });
    this.root.querySelectorAll('.tab-panel').forEach((p) => {
      p.classList.toggle('is-active', p.dataset.tab === id);
    });
  }

  renderShell() {
    this.root.innerHTML = '';

    const tabBar = el('div', { className: 'tab-bar', role: 'tablist' });
    for (const t of TABS) {
      tabBar.appendChild(
        el('button', {
          type: 'button',
          className: 'tab-btn' + (this.activeTab === t.id ? ' is-active' : ''),
          'data-tab': t.id,
          text: t.label,
          onClick: () => this.setTab(t.id),
        })
      );
    }
    this.root.appendChild(tabBar);

    const panels = el('div', { className: 'tab-panels' });

    // 骨相
    const bonePanel = el('div', {
      className: 'tab-panel' + (this.activeTab === 'bone' ? ' is-active' : ''),
      'data-tab': 'bone',
    });
    bonePanel.appendChild(
      el('div', { className: 'panel-block' }, [
        el('div', { className: 'panel-title-row' }, [
          el('div', { className: 'panel-title', text: '常用骨相（身份 PCA）' }),
          el('button', {
            type: 'button',
            className: 'btn-mini',
            text: '配置常用',
            onClick: () => this.openCommonEditor('identity'),
          }),
        ]),
        el('label', { className: 'check-inline' }, [
          el('input', {
            type: 'checkbox',
            checked: this.showDirtyOnly || undefined,
            onChange: (e) => {
              this.showDirtyOnly = e.target.checked;
              localStorage.setItem(STORAGE_DIRTY_ONLY, this.showDirtyOnly ? '1' : '0');
              this.rebuildLists();
            },
          }),
          document.createTextNode(' 仅显示已修改'),
        ]),
        (this.commonBox = el('div', { className: 'slider-list' })),
      ])
    );
    panels.appendChild(bonePanel);

    // 表情
    const exprPanel = el('div', {
      className: 'tab-panel' + (this.activeTab === 'expr' ? ' is-active' : ''),
      'data-tab': 'expr',
    });
    exprPanel.appendChild(
      el('div', { className: 'panel-block' }, [
        el('div', { className: 'panel-title-row' }, [
          el('div', { className: 'panel-title', text: '常用表情（含张嘴）' }),
          el('button', {
            type: 'button',
            className: 'btn-mini',
            text: '配置常用',
            onClick: () => this.openCommonEditor('expression'),
          }),
        ]),
        el('label', { className: 'check-inline' }, [
          el('input', {
            type: 'checkbox',
            checked: this.eyeSync || undefined,
            onChange: (e) => {
              this.eyeSync = e.target.checked;
              localStorage.setItem(STORAGE_EYE_SYNC, this.eyeSync ? '1' : '0');
            },
          }),
          document.createTextNode(' 左右眼区同步（配对滑条）'),
        ]),
        (this.exprBox = el('div', { className: 'slider-list' })),
      ])
    );
    panels.appendChild(exprPanel);

    // 收藏
    const favPanel = el('div', {
      className: 'tab-panel' + (this.activeTab === 'fav' ? ' is-active' : ''),
      'data-tab': 'fav',
    });
    favPanel.appendChild(
      el('div', { className: 'panel-block' }, [
        el('div', { className: 'panel-title', text: '收藏的参数' }),
        el('p', {
          className: 'muted panel-hint',
          text: '在各 Tab 参数名称旁点击 ☆ 加入；再次点击 ★ 可取消。',
        }),
        (this.favBox = el('div', { className: 'slider-list' })),
      ])
    );
    panels.appendChild(favPanel);

    // 姿态
    const posePanel = el('div', {
      className: 'tab-panel' + (this.activeTab === 'pose' ? ' is-active' : ''),
      'data-tab': 'pose',
    });
    posePanel.appendChild(
      el('div', { className: 'panel-block' }, [
        el('div', { className: 'panel-title', text: '姿态关节（预览，导出时烘焙）' }),
        (this.poseBox = el('div', { className: 'slider-list' })),
      ])
    );
    panels.appendChild(posePanel);

    // 显示
    const visPanel = el('div', {
      className: 'tab-panel' + (this.activeTab === 'vis' ? ' is-active' : ''),
      'data-tab': 'vis',
    });
    visPanel.appendChild(
      el('div', { className: 'panel-block' }, [
        el('div', { className: 'panel-title', text: '显示部件' }),
        (this.compBox = el('div', { className: 'check-grid' })),
      ])
    );
    panels.appendChild(visPanel);

    // 全部
    const allPanel = el('div', {
      className: 'tab-panel' + (this.activeTab === 'all' ? ' is-active' : ''),
      'data-tab': 'all',
    });
    allPanel.appendChild(
      el('div', { className: 'panel-block' }, [
        el('div', { className: 'panel-title', text: '全部参数 · 身份 253 + 表情 383' }),
        (this.advBox = el('div', { className: 'adv-box' })),
      ])
    );
    panels.appendChild(allPanel);

    this.root.appendChild(panels);
  }

  openCommonEditor(kind) {
    const isId = kind === 'identity';
    const all = isId ? this.cfg.commonControls : this.cfg.commonExpressionControls || [];
    const selected = new Set(isId ? this.commonIds : this.expressionIds);
    const defaults = isId
      ? this.cfg.defaultCommonIds
      : this.cfg.defaultExpressionIds || [];
    const overlay = el('div', { className: 'modal-overlay' });
    const box = el('div', { className: 'modal-box' }, [
      el('h3', { text: isId ? '配置常用骨相' : '配置常用表情' }),
      el('p', {
        className: 'muted',
        text: '勾选要出现在对应 Tab 的项；完整 253/383 仍在「全部」页。',
      }),
    ]);
    const list = el('div', { className: 'common-editor-list' });
    const order = [
      ...(isId ? this.commonIds : this.expressionIds),
      ...all.map((c) => c.id).filter((id) => !selected.has(id)),
    ];
    for (const id of order) {
      const def = all.find((c) => c.id === id);
      if (!def) continue;
      list.appendChild(
        el('label', { className: 'common-editor-row' }, [
          el('input', {
            type: 'checkbox',
            checked: selected.has(id) || undefined,
            'data-id': id,
          }),
          el('span', { text: def.name }),
          el('span', { className: 'muted', text: def.hint }),
        ])
      );
    }
    box.appendChild(list);
    box.appendChild(
      el('div', { className: 'modal-actions' }, [
        el('button', {
          type: 'button',
          className: 'btn',
          text: '恢复默认',
          onClick: () => {
            if (isId) this.saveCommonIds(defaults.slice());
            else this.saveExpressionIds(defaults.slice());
            overlay.remove();
          },
        }),
        el('button', {
          type: 'button',
          className: 'btn primary',
          text: '保存',
          onClick: () => {
            const ids = [];
            list.querySelectorAll('input[type=checkbox]').forEach((inp) => {
              if (inp.checked) ids.push(inp.getAttribute('data-id'));
            });
            if (!ids.length) {
              alert('请至少保留一项');
              return;
            }
            if (isId) {
              this.saveCommonIds(ids);
              this.handlers.onCommonIdsChanged?.(ids);
            } else {
              this.saveExpressionIds(ids);
            }
            overlay.remove();
          },
        }),
        el('button', {
          type: 'button',
          className: 'btn',
          text: '取消',
          onClick: () => overlay.remove(),
        }),
      ])
    );
    overlay.appendChild(box);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
    document.body.appendChild(overlay);
  }

  rebuildLists() {
    if (!this.model || this._dragging) return;
    this._sliderRefs.clear();
    this._buildComponents();
    this._buildCommonBone();
    this._buildCommonExpr();
    this._buildFavorites();
    this._buildPose();
    this._buildAdvanced();
  }

  _buildComponents() {
    if (!this.compBox) return;
    this.compBox.innerHTML = '';
    const vis = this.handlers.getVisibility?.() || [];
    this.cfg.components.forEach((c) => {
      const checked = vis[c.index] !== false;
      const labelStore = { section: 'component', key: c.id };
      this.compBox.appendChild(
        el('label', { className: 'check-item' }, [
          el('input', {
            type: 'checkbox',
            checked: checked || undefined,
            onChange: (e) => {
              const next = (this.handlers.getVisibility?.() || []).slice();
              next[c.index] = e.target.checked;
              this.handlers.onVisibility?.(next);
            },
          }),
          document.createTextNode(' '),
          this._makeRenamableLabel(labelStore, c.name),
        ])
      );
    });
  }

  _makeSlider({
    key,
    label,
    labelStore,
    defaultLabel,
    hint,
    value,
    min,
    max,
    step,
    dirty,
    onInput,
    onReset,
    favKey,
  }) {
    const builtIn = defaultLabel ?? label;
    const row = el('div', {
      className: 'slider-row' + (dirty ? ' is-dirty' : ''),
      'data-key': key,
    });
    const valEl = el('span', {
      className: 'slider-val',
      text: Number(value).toFixed(2),
    });
    const headChildren = [this._makeRenamableLabel(labelStore, builtIn)];
    if (favKey) headChildren.push(this._makeFavoriteBtn(favKey));
    headChildren.push(
      el('div', { className: 'slider-head-right' }, [
        valEl,
        el('button', {
          type: 'button',
          className: 'btn-reset-one',
          text: '重置',
          title: '将此项归零（中性）',
          onClick: (e) => {
            e.preventDefault();
            e.stopPropagation();
            // 先写模型再同步滑条，避免只改外观
            onInput?.(0);
            slider.setValue(0, { silent: true });
            valEl.textContent = '0.00';
            this._paintDirty(row, false);
          },
        }),
      ])
    );
    const head = el('div', { className: 'slider-head' }, headChildren);
    if (hint) head.title = hint;

    const slider = createCaptureSlider({
      min,
      max,
      step: step || 0.01,
      value,
      onPointerDown: () => {
        this._dragging = true;
        clearTimeout(this._rebuildTimer);
      },
      onInput: (v) => {
        valEl.textContent = v.toFixed(2);
        onInput(v);
        this._paintDirty(row, isModifiedCoeff(v));
      },
      onPointerUp: () => {
        this._dragging = false;
        if (!this.showDirtyOnly) return;
        clearTimeout(this._rebuildTimer);
        this._rebuildTimer = setTimeout(() => this.rebuildLists(), 120);
      },
    });

    row.appendChild(head);
    row.appendChild(slider.el);
    this._sliderRefs.set(key, {
      row,
      slider,
      valEl,
      getValue: () => slider.value,
    });
    return row;
  }

  _paintDirty(row, dirty) {
    row.classList.toggle('is-dirty', !!dirty);
  }

  _buildCommonBone() {
    this.commonBox.innerHTML = '';
    const byId = Object.fromEntries(this.cfg.commonControls.map((c) => [c.id, c]));
    // 保持常用列表原顺序：已修改项就地标黄，不抽到上方、也不从下方移除
    for (const id of this.commonIds) {
      const def = byId[id];
      if (!def) continue;
      const val = this.model.identity[def.index] || 0;
      const dirty = isModifiedCoeff(val);
      if (this.showDirtyOnly && !dirty) continue;
      this.commonBox.appendChild(
        this._makeSlider({
          key: `common:${def.id}`,
          favKey: makeFavoriteKey('identity', def.index),
          labelStore: { section: 'identity', key: String(def.index) },
          defaultLabel: def.name,
          hint: `${def.hint} · 身份维 ${def.index}（${this.model.meta.identityNames?.[def.index] || ''}）`,
          value: val,
          ...pcaSliderRange('identity', def.index),
          dirty,
          onInput: (v) => this.handlers.onIdentityParam?.(def.index, v),
          onReset: () => this.handlers.onIdentityParam?.(def.index, 0)
        })
      );
    }
    if (!this.commonBox.children.length) {
      this.commonBox.appendChild(el('div', { className: 'muted', text: '无匹配项' }));
    }
  }

  _readExpressionUiValue(def) {
    if (def.weights?.length) {
      const w0 = def.weights[0];
      const raw = this.model.expression[w0.index] || 0;
      const s = w0.scale || 1;
      return s ? raw / s : 0;
    }
    const v = this.model.expression[def.index] || 0;
    return def.invert ? -v : v;
  }

  _applyExpressionDef(def, uiValue) {
    if (def.weights?.length) {
      for (const w of def.weights) {
        this.handlers.onExpressionParam?.(w.index, uiValue * (w.scale || 1));
      }
      return;
    }
    const v = def.invert ? -uiValue : uiValue;
    this.handlers.onExpressionParam?.(def.index, v);
    if (this.eyeSync && def.mirrorIndex != null) {
      this.handlers.onExpressionParam?.(def.mirrorIndex, v);
    }
  }

  _setExpression(index, value, mirrorIndex) {
    this.handlers.onExpressionParam?.(index, value);
    if (this.eyeSync && mirrorIndex != null) {
      this.handlers.onExpressionParam?.(mirrorIndex, value);
    }
  }

  _buildCommonExpr() {
    if (!this.exprBox) return;
    this.exprBox.innerHTML = '';
    const list = this.cfg.commonExpressionControls || [];
    const byId = Object.fromEntries(list.map((c) => [c.id, c]));
    for (const id of this.expressionIds) {
      const def = byId[id];
      if (!def) continue;
      const val = this._readExpressionUiValue(def);
      let dirty = isModifiedCoeff(val);
      if (!def.weights && def.mirrorIndex != null) {
        dirty = dirty || isModifiedCoeff(this.model.expression[def.mirrorIndex] || 0);
      }
      if (def.weights) {
        dirty = def.weights.some((w) => isModifiedCoeff(this.model.expression[w.index] || 0));
      }
      if (this.showDirtyOnly && !dirty) continue;
      const rng = def.weights?.length
        ? { min: def.range?.[0] ?? 0, max: def.range?.[1] ?? 5 }
        : pcaSliderRange('expression', def.index);
      const favKey = def.weights?.length
        ? makeFavoriteKey('exprCommon', def.id)
        : makeFavoriteKey('expression', def.index);
      const labelStore = def.weights?.length
        ? { section: 'commonExpression', key: def.id }
        : { section: 'expression', key: String(def.index) };
      this.exprBox.appendChild(
        this._makeSlider({
          key: `expr:${def.id}`,
          favKey,
          labelStore,
          defaultLabel: def.name,
          hint: `${def.hint} · 表情维 ${def.index}${
            def.mirrorIndex != null ? ` / 镜像 ${def.mirrorIndex}` : ''
          }${def.weights ? ' · 多维配方' : ''}`,
          value: val,
          min: rng.min,
          max: rng.max,
          dirty,
          onInput: (v) => this._applyExpressionDef(def, v),
          onReset: () => this._applyExpressionDef(def, 0)
        })
      );
    }
    if (!this.exprBox.children.length) {
      this.exprBox.appendChild(el('div', { className: 'muted', text: '无匹配项' }));
    }
  }

  _buildFavorites() {
    if (!this.favBox) return;
    this.favBox.innerHTML = '';
    const keys = loadFavoriteKeys();
    if (!keys.length) {
      this.favBox.appendChild(
        el('div', { className: 'muted', text: '暂无收藏。在各参数名称旁点击 ☆ 加入收藏。' })
      );
      return;
    }
    let any = false;
    for (const favKey of keys) {
      const row = this._makeSliderFromFavKey(favKey);
      if (!row) continue;
      any = true;
      this.favBox.appendChild(row);
    }
    if (!any) {
      this.favBox.appendChild(el('div', { className: 'muted', text: '收藏项无效或已移除' }));
    }
  }

  _makeSliderFromFavKey(favKey) {
    if (favKey.startsWith('identity:')) {
      const idx = Number(favKey.slice(9));
      if (!Number.isFinite(idx) || idx < 0 || idx >= this.model.identityDim) return null;
      const val = this.model.identity[idx] || 0;
      const builtIn = this._idLabelBuiltin(idx);
      return this._makeSlider({
        key: `fav:${favKey}`,
        favKey,
        labelStore: { section: 'identity', key: String(idx) },
        defaultLabel: builtIn,
        value: val,
        ...pcaSliderRange('identity', idx),
        dirty: isModifiedCoeff(val),
        onInput: (v) => this.handlers.onIdentityParam?.(idx, v),
        onReset: () => this.handlers.onIdentityParam?.(idx, 0)
      });
    }
    if (favKey.startsWith('expression:')) {
      const idx = Number(favKey.slice(11));
      if (!Number.isFinite(idx) || idx < 0 || idx >= this.model.expressionDim) return null;
      const val = this.model.expression[idx] || 0;
      const builtIn = this._exLabelBuiltin(idx);
      return this._makeSlider({
        key: `fav:${favKey}`,
        favKey,
        labelStore: { section: 'expression', key: String(idx) },
        defaultLabel: builtIn,
        value: val,
        ...pcaSliderRange('expression', idx),
        dirty: isModifiedCoeff(val),
        onInput: (v) => this.handlers.onExpressionParam?.(idx, v),
        onReset: () => this.handlers.onExpressionParam?.(idx, 0)
      });
    }
    if (favKey.startsWith('exprCommon:')) {
      const id = favKey.slice(11);
      const def = (this.cfg.commonExpressionControls || []).find((c) => c.id === id);
      if (!def) return null;
      const val = this._readExpressionUiValue(def);
      let dirty = isModifiedCoeff(val);
      if (!def.weights && def.mirrorIndex != null) {
        dirty = dirty || isModifiedCoeff(this.model.expression[def.mirrorIndex] || 0);
      }
      if (def.weights) {
        dirty = def.weights.some((w) => isModifiedCoeff(this.model.expression[w.index] || 0));
      }
      const labelStore = { section: 'commonExpression', key: def.id };
      return this._makeSlider({
        key: `fav:${favKey}`,
        favKey,
        labelStore,
        defaultLabel: def.name,
        hint: def.hint,
        value: val,
        ...(def.weights?.length
          ? { min: def.range?.[0] ?? 0, max: def.range?.[1] ?? 5 }
          : pcaSliderRange('expression', def.index)),
        dirty,
        onInput: (v) => this._applyExpressionDef(def, v),
        onReset: () => this._applyExpressionDef(def, 0)
      });
    }
    if (favKey.startsWith('pose:')) {
      const parts = favKey.slice(5).split(':');
      const jointIndex = Number(parts[0]);
      const axis = Number(parts[1]);
      if (!Number.isFinite(jointIndex) || !Number.isFinite(axis)) return null;
      const j = this.cfg.joints.find((x) => x.index === jointIndex);
      if (!j) return null;
      const axisNames = ['X', 'Y', 'Z'];
      const idx = jointIndex * 3 + axis;
      const val = this.model.rotations[idx] || 0;
      const poseLabel = `${j.name} · ${axisNames[axis] || axis}`;
      return this._makeSlider({
        key: `fav:${favKey}`,
        favKey,
        labelStore: { section: 'pose', key: `${jointIndex}:${axis}` },
        defaultLabel: poseLabel,
        hint: '轴角（弧度）。非张嘴。',
        value: val,
        min: -1.2,
        max: 1.2,
        dirty: isModifiedCoeff(val),
        onInput: (v) => {
          const o = jointIndex * 3;
          const x = axis === 0 ? v : this.model.rotations[o];
          const y = axis === 1 ? v : this.model.rotations[o + 1];
          const z = axis === 2 ? v : this.model.rotations[o + 2];
          this.handlers.onJointRotation?.(jointIndex, x, y, z);
        },
        onReset: () => {
          const o = jointIndex * 3;
          const x = axis === 0 ? 0 : this.model.rotations[o];
          const y = axis === 1 ? 0 : this.model.rotations[o + 1];
          const z = axis === 2 ? 0 : this.model.rotations[o + 2];
          this.handlers.onJointRotation?.(jointIndex, x, y, z);
        },
      });
    }
    return null;
  }

  _buildPose() {
    this.poseBox.innerHTML = '';
    const axes = [
      { axis: 0, name: 'X' },
      { axis: 1, name: 'Y' },
      { axis: 2, name: 'Z' },
    ];
    for (const j of this.cfg.joints) {
      for (const a of axes) {
        const idx = j.index * 3 + a.axis;
        const val = this.model.rotations[idx] || 0;
        const dirty = isModifiedCoeff(val);
        if (this.showDirtyOnly && !dirty) continue;
        const poseLabel = `${j.name} · ${a.name}`;
        this.poseBox.appendChild(
          this._makeSlider({
            key: `pose:${idx}`,
            favKey: makeFavoriteKey('pose', j.index, a.axis),
            labelStore: { section: 'pose', key: `${j.index}:${a.axis}` },
            defaultLabel: poseLabel,
            hint: '轴角（弧度）。非张嘴。',
            value: val,
            min: -1.2,
            max: 1.2,
            dirty,
            onInput: (v) => {
              const o = j.index * 3;
              const x = a.axis === 0 ? v : this.model.rotations[o];
              const y = a.axis === 1 ? v : this.model.rotations[o + 1];
              const z = a.axis === 2 ? v : this.model.rotations[o + 2];
              this.handlers.onJointRotation?.(j.index, x, y, z);
            },
            onReset: () => {
              const o = j.index * 3;
              const x = a.axis === 0 ? 0 : this.model.rotations[o];
              const y = a.axis === 1 ? 0 : this.model.rotations[o + 1];
              const z = a.axis === 2 ? 0 : this.model.rotations[o + 2];
              this.handlers.onJointRotation?.(j.index, x, y, z);
            },
          })
        );
      }
    }
  }

  /**
   * 头颅面骨：按效果簇子折叠；标题可双击改名（写入 identity-taxonomy.json）。
   * @returns {HTMLElement | null}
   */
  _buildHeadTaxonomy(g, parentGroupKey) {
    const clusters = getHeadEffectClusters();
    const wrap = el('div', { className: 'taxonomy-wrap' });

    if (!clusters.length) {
      wrap.appendChild(
        el('p', {
          className: 'muted taxonomy-hint',
          text: '未加载效果簇分类，回退为平铺列表。',
        })
      );
      const inner = el('div', { className: 'slider-list compact' });
      let any = false;
      for (let i = 0; i < g.count; i++) {
        const idx = g.start + i;
        const val = this.model.identity[idx] || 0;
        const dirty = isModifiedCoeff(val);
        if (this.showDirtyOnly && !dirty) continue;
        any = true;
        inner.appendChild(this._makeHeadIdentitySlider(idx));
      }
      if (!any) return null;
      wrap.appendChild(inner);
      return wrap;
    }

    wrap.appendChild(
      el('p', {
        className: 'muted taxonomy-hint',
        text: '按变动幅度相似度聚类；双击簇标题可改名（写入磁盘 JSON）。',
      })
    );

    const covered = new Set();
    let anyCluster = false;
    for (const c of clusters) {
      const clusterKey = `${parentGroupKey}:fx:${c.id}`;
      const sub = el('details', { className: 'group-fold taxonomy-cluster' });
      const title = el('summary', {
        className: 'taxonomy-cluster-summary is-renamable',
        text: `${c.name} · ${c.indices.length} 维`,
        title: '双击改名',
      });
      title.dataset.clusterId = c.id;
      title.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this._beginClusterRename(title, c);
      });
      // 避免双击时折叠来回切换
      title.addEventListener('click', (e) => {
        if (title.dataset.editing === '1') e.preventDefault();
      });
      sub.appendChild(title);

      const inner = el('div', { className: 'slider-list compact' });
      let any = false;
      for (const idx of c.indices) {
        if (idx < g.start || idx >= g.start + g.count) continue;
        covered.add(idx);
        const val = this.model.identity[idx] || 0;
        const dirty = isModifiedCoeff(val);
        if (this.showDirtyOnly && !dirty) continue;
        any = true;
        inner.appendChild(this._makeHeadIdentitySlider(idx));
      }
      if (!any) continue;
      anyCluster = true;
      sub.appendChild(inner);
      this._bindAdvGroupFold(sub, clusterKey);
      wrap.appendChild(sub);
    }

    // 未入簇的维（理论上不应有）
    const orphan = [];
    for (let i = 0; i < g.count; i++) {
      const idx = g.start + i;
      if (!covered.has(idx)) orphan.push(idx);
    }
    if (orphan.length) {
      const sub = el('details', { className: 'group-fold taxonomy-cluster' });
      const orphanKey = `${parentGroupKey}:fx:orphan`;
      sub.appendChild(el('summary', { text: `未分类 · ${orphan.length} 维` }));
      const inner = el('div', { className: 'slider-list compact' });
      let any = false;
      for (const idx of orphan) {
        const val = this.model.identity[idx] || 0;
        const dirty = isModifiedCoeff(val);
        if (this.showDirtyOnly && !dirty) continue;
        any = true;
        inner.appendChild(this._makeHeadIdentitySlider(idx));
      }
      if (any) {
        anyCluster = true;
        sub.appendChild(inner);
        this._bindAdvGroupFold(sub, orphanKey);
        wrap.appendChild(sub);
      }
    }

    return anyCluster ? wrap : null;
  }

  _makeHeadIdentitySlider(idx) {
    const builtIn = this._idLabelBuiltin(idx);
    return this._makeSlider({
      key: `id-all:${idx}`,
      favKey: makeFavoriteKey('identity', idx),
      labelStore: { section: 'identity', key: String(idx) },
      defaultLabel: builtIn,
      value: this.model.identity[idx] || 0,
      ...pcaSliderRange('identity', idx),
      dirty: isModifiedCoeff(this.model.identity[idx] || 0),
      onInput: (v) => this.handlers.onIdentityParam?.(idx, v),
      onReset: () => this.handlers.onIdentityParam?.(idx, 0)
    });
  }

  _beginClusterRename(summaryEl, cluster) {
    if (summaryEl.dataset.editing === '1') return;
    summaryEl.dataset.editing = '1';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'taxonomy-cluster-edit';
    input.value = cluster.name || '';
    input.maxLength = 64;
    const suffix = ` · ${cluster.indices.length} 维`;
    summaryEl.textContent = '';
    summaryEl.appendChild(input);
    input.focus();
    input.select();

    let done = false;
    const finish = async (commit) => {
      if (done) return;
      done = true;
      delete summaryEl.dataset.editing;
      const next = commit ? String(input.value || '').trim() : cluster.name;
      if (commit) {
        if (!next) {
          summaryEl.textContent = `${cluster.name}${suffix}`;
          alert('名称不能为空');
          return;
        }
        try {
          await renameIdentityCluster(cluster.id, next);
          cluster.name = next;
          summaryEl.textContent = `${next}${suffix}`;
          this.handlers.onStatus?.(`已改名效果簇「${next}」`);
        } catch (err) {
          summaryEl.textContent = `${cluster.name}${suffix}`;
          alert(err.message || String(err));
        }
        return;
      }
      summaryEl.textContent = `${cluster.name}${suffix}`;
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
    input.addEventListener('blur', () => finish(true));
  }

  _buildAdvanced() {
    this._syncAdvGroupOpenFromDom();
    this.advBox.innerHTML = '';
    // 保持原分组顺序：已修改就地标黄；不置顶、不从下方移除

    for (const g of this.cfg.identityGroups) {
      const groupKey = this._advGroupKey('id', g);
      const det = el('details', { className: 'group-fold' });
      det.appendChild(
        el('summary', {
          text: `${g.name} · ${g.count} 维（索引 ${g.start}–${g.start + g.count - 1}）`,
        })
      );

      if (g.id === 'head') {
        const headInner = this._buildHeadTaxonomy(g, groupKey);
        if (!headInner) continue;
        det.appendChild(headInner);
      } else {
        const inner = el('div', { className: 'slider-list compact' });
        let any = false;
        for (let i = 0; i < g.count; i++) {
          const idx = g.start + i;
          const val = this.model.identity[idx] || 0;
          const dirty = isModifiedCoeff(val);
          if (this.showDirtyOnly && !dirty) continue;
          any = true;
          const builtIn = this._idLabelBuiltin(idx);
          inner.appendChild(
            this._makeSlider({
              key: `id-all:${idx}`,
              favKey: makeFavoriteKey('identity', idx),
              labelStore: { section: 'identity', key: String(idx) },
              defaultLabel: builtIn,
              value: val,
              ...pcaSliderRange('identity', idx),
              dirty,
              onInput: (v) => this.handlers.onIdentityParam?.(idx, v),
              onReset: () => this.handlers.onIdentityParam?.(idx, 0)
            })
          );
        }
        if (!any) continue;
        det.appendChild(inner);
      }

      this._bindAdvGroupFold(det, groupKey);
      this.advBox.appendChild(det);
    }

    for (const g of this.cfg.expressionGroups) {
      const groupKey = this._advGroupKey('ex', g);
      const det = el('details', { className: 'group-fold' });
      const end = Math.min(g.start + g.count - 1, this.model.expressionDim - 1);
      det.appendChild(
        el('summary', {
          text: `${g.name} · ${g.count} 维（索引 ${g.start}–${end}）`,
        })
      );
      const inner = el('div', { className: 'slider-list compact' });
      let any = false;
      for (let i = 0; i < g.count; i++) {
        const idx = g.start + i;
        if (idx >= this.model.expressionDim) break;
        const val = this.model.expression[idx] || 0;
        const dirty = isModifiedCoeff(val);
        if (this.showDirtyOnly && !dirty) continue;
        any = true;
        const builtIn = this._exLabelBuiltin(idx);
        inner.appendChild(
          this._makeSlider({
            key: `ex-all:${idx}`,
            favKey: makeFavoriteKey('expression', idx),
            labelStore: { section: 'expression', key: String(idx) },
            defaultLabel: builtIn,
            value: val,
            ...pcaSliderRange('expression', idx),
            dirty,
            onInput: (v) => this.handlers.onExpressionParam?.(idx, v),
            onReset: () => this.handlers.onExpressionParam?.(idx, 0)
          })
        );
      }
      if (!any) continue;
      det.appendChild(inner);
      this._bindAdvGroupFold(det, groupKey);
      this.advBox.appendChild(det);
    }

    if (!this.advBox.children.length) {
      this.advBox.appendChild(el('div', { className: 'muted', text: '无匹配项' }));
    }
  }

  _idLabelBuiltin(i) {
    const raw = this.model.meta.identityNames?.[i] || `identity_${i}`;
    const probe = this.cfg.identityProbeLabels?.[String(i)];
    if (probe) return `身份 ${i} · ${probe}`;
    return `身份 ${i} · ${this._zhIdentity(raw)}`;
  }

  _exLabelBuiltin(i) {
    const raw = this.model.meta.expressionNames?.[i] || `expression_${i}`;
    const probe = this.cfg.expressionProbeLabels?.[String(i)];
    if (probe) return `表情 ${i} · ${probe}`;
    return `表情 ${i} · ${this._zhExpression(raw)}`;
  }

  _zhIdentity(n) {
    if (n.startsWith('head_')) return `头外形 PCA ${n.slice(5)}（无官方语义）`;
    if (n.startsWith('eyes_')) return `眼球 PCA ${n.slice(5)}`;
    if (n.startsWith('teeth_')) return `牙齿 PCA ${n.slice(6)}`;
    return n;
  }

  _zhExpression(n) {
    if (n.startsWith('left_eye_region_')) return `左眼区 PCA ${n.slice(16)}`;
    if (n.startsWith('right_eye_region_')) return `右眼区 PCA ${n.slice(17)}`;
    if (n.startsWith('lower_face_region_')) return `下脸 PCA ${n.slice(18)}`;
    if (n.startsWith('tongue_')) return `舌 PCA ${n.slice(7)}`;
    if (n.startsWith('pupils_')) return `瞳孔 PCA ${n.slice(7)}`;
    if (n === 'tongue_mean') return '舌（均值）';
    return n;
  }

  syncFromModel() {
    this.rebuildLists();
  }

  markDirtyUI() {
    if (this._dragging || !this.showDirtyOnly) return;
    clearTimeout(this._rebuildTimer);
    this._rebuildTimer = setTimeout(() => {
      if (!this._dragging) this.rebuildLists();
    }, 200);
  }
}
