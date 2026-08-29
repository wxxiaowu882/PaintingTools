/**
 * Load / apply identity & expression presets (data/presets/).
 * Left rail UI: 身份 / 表情 tabs + scrollable thumb list.
 */

const PRESETS_BASE = './data/presets/';
const STORAGE_PRESET_TAB = 'gnmWorkshop.presetRailTab.v1';

export async function loadPresetManifest() {
  const res = await fetch(PRESETS_BASE + 'manifest.json');
  if (!res.ok) throw new Error('无法加载预设清单');
  return res.json();
}

export async function loadPresetFile(file) {
  const res = await fetch(PRESETS_BASE + file);
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

  const rndBtn = document.createElement('button');
  rndBtn.type = 'button';
  rndBtn.className = 'preset-chip preset-chip-action preset-chip-rail';
  rndBtn.title = '在合理范围内随机扰动身份维';
  rndBtn.innerHTML =
    '<span class="preset-swatch" style="background:#00d2ff"></span><span class="preset-chip-label">随机身份</span>';
  rndBtn.addEventListener('click', () => onRandomIdentity?.());
  idList.appendChild(rndBtn);

  const idChips = [];
  for (const item of manifest.identities || []) {
    const chip = makeChip(item, async () => {
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
