/**
 * 语义身份采样预览弹层：调参预览，确认后才写入「我的身份」。
 */
import {
  loadIdentitySampler,
  sampleIdentity,
  defaultSampleName,
  genderContrastDistance,
  pickSeedWithGenderContrast,
  describeCondition,
  DEFAULT_MIN_GENDER_DIST,
  GENDER_LABELS,
  ETHNICITY_LABELS,
  ETHNICITY,
} from './identity-sampler.js';
import { createCustomIdentity } from './custom-identities.js';
import { SamplePreviewViewport } from './sample-preview-viewport.js';

function el(tag, props = {}, kids = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'className') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v != null) node.setAttribute(k, v);
  }
  for (const c of kids) {
    if (c == null) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

function newSeed() {
  return (Math.floor(Math.random() * 1e9) ^ Date.now()) >>> 0;
}

/**
 * @param {object} opts
 * @param {import('./vendor/GNMModel.js').GNMHeadModel} opts.model
 * @param {() => void} [opts.onStatus]
 * @param {(entry: object) => void} [opts.onConfirmed] 确认后回调（已入库 + 应用前由调用方 apply）
 * @param {() => Promise<void>|void} [opts.onListRefresh]
 * @param {(id: string) => void} [opts.onSelectCustom]
 */
export async function openIdentitySampleModal(opts) {
  const { model, onStatus, onConfirmed, onListRefresh, onSelectCustom } = opts;
  if (!model) throw new Error('模型未就绪');

  onStatus?.('加载语义采样权重…');
  await loadIdentitySampler();

  const state = {
    gender: 0, // 0=纯女 1=纯男（官方条件端点）
    genderIntensity: 1, // 1=官方端点；>1 为可选外推（默认不用，避免怪异）
    ethnicityA: ETHNICITY.ASIAN,
    ethnicityB: ETHNICITY.ASIAN,
    ethnicityMix: 0,
    seed: newSeed(),
    vector: null,
    name: '',
    autoPickSeed: true,
  };

  let previewer = null;
  let closed = false;
  let debounceTimer = null;

  const overlay = el('div', { className: 'modal-overlay identity-sample-overlay' });
  const box = el('div', { className: 'modal-box identity-sample-modal' });

  const title = el('h3', { text: '语义身份采样（预览确认）' });
  const hint = el('p', {
    className: 'muted identity-sample-hint',
    text: '接线已与官方核对。默认用官方条件端点采样（不做强度外推）。程序用「同种子纯女/纯男身份距」自动挑种子；也可关掉后手改种子。按住「对照纯男」可瞬看同种子纯男。「性别特征强度」仅作可选外推，拧大容易不自然。',
  });

  const layout = el('div', { className: 'identity-sample-layout' });
  const previewPane = el('div', { className: 'identity-sample-preview-pane' });
  const previewWrap = el('div', { className: 'identity-sample-preview-wrap' });
  const previewCanvas = el('canvas', {
    className: 'identity-sample-preview-canvas',
  });
  previewWrap.appendChild(previewCanvas);
  const previewHint = el('div', {
    className: 'muted identity-sample-orbit-hint',
    text: '拖拽旋转 · 滚轮缩放 · 右键平移',
  });
  const previewStatus = el('div', { className: 'muted', text: '生成中…' });
  const historyNav = el('div', { className: 'identity-sample-nav' });
  const btnHistBack = el('button', {
    type: 'button',
    className: 'btn',
    text: '← 上一个',
    title: '回到上一版已生成的预览',
    disabled: 'true',
  });
  const btnHistFwd = el('button', {
    type: 'button',
    className: 'btn',
    text: '下一个 →',
    title: '前进到更新一版预览',
    disabled: 'true',
  });
  const histPos = el('span', { className: 'identity-sample-nav-pos', text: '0 / 0' });
  historyNav.appendChild(btnHistBack);
  historyNav.appendChild(btnHistFwd);
  historyNav.appendChild(histPos);
  previewPane.appendChild(previewWrap);
  previewPane.appendChild(previewHint);
  previewPane.appendChild(previewStatus);
  previewPane.appendChild(historyNav);

  const controls = el('div', { className: 'identity-sample-controls' });

  const genderQuick = el('div', { className: 'identity-sample-quick' });
  const btnPureF = el('button', { type: 'button', className: 'btn btn-mini', text: '纯女' });
  const btnPureM = el('button', { type: 'button', className: 'btn btn-mini', text: '纯男' });
  const btnCompareM = el('button', {
    type: 'button',
    className: 'btn btn-mini',
    text: '按住·对照纯男',
    title: '按住期间预览同一种子的官方纯男，松开回到当前设置',
  });
  genderQuick.appendChild(btnPureF);
  genderQuick.appendChild(btnPureM);
  genderQuick.appendChild(btnCompareM);

  const condReadout = el('div', {
    className: 'muted identity-sample-cond',
    text: '条件向量：…',
  });

  const genderLabel = el('label', { className: 'identity-sample-field' });
  genderLabel.appendChild(el('span', { text: '性别混合（左=官方纯女 → 右=官方纯男）' }));
  const genderRange = el('input', {
    type: 'range',
    min: '0',
    max: '1',
    step: '0.01',
    value: String(state.gender),
  });
  const genderVal = el('span', { className: 'identity-sample-val', text: genderText(state.gender) });
  genderLabel.appendChild(genderRange);
  genderLabel.appendChild(genderVal);

  const intensityLabel = el('label', { className: 'identity-sample-field' });
  intensityLabel.appendChild(el('span', { text: '性别特征强度（1=官方端点；>1 外推加强）' }));
  const intensityRange = el('input', {
    type: 'range',
    min: '0.8',
    max: '5',
    step: '0.05',
    value: String(state.genderIntensity),
  });
  const intensityVal = el('span', {
    className: 'identity-sample-val',
    text: intensityText(state.genderIntensity),
  });
  intensityLabel.appendChild(intensityRange);
  intensityLabel.appendChild(intensityVal);

  const ethALabel = el('label', { className: 'identity-sample-field' });
  ethALabel.appendChild(el('span', { text: '族裔 A（官方四类）' }));
  const ethA = el('select');
  ETHNICITY_LABELS.forEach((name, i) => {
    const o = el('option', { value: String(i), text: name });
    if (i === state.ethnicityA) o.selected = true;
    ethA.appendChild(o);
  });
  ethALabel.appendChild(ethA);

  const ethBLabel = el('label', { className: 'identity-sample-field' });
  ethBLabel.appendChild(el('span', { text: '族裔 B（与 A 混合）' }));
  const ethB = el('select');
  ETHNICITY_LABELS.forEach((name, i) => {
    const o = el('option', { value: String(i), text: name });
    if (i === state.ethnicityB) o.selected = true;
    ethB.appendChild(o);
  });
  ethBLabel.appendChild(ethB);

  const mixLabel = el('label', { className: 'identity-sample-field' });
  mixLabel.appendChild(el('span', { text: '族裔混合（0=全 A → 1=全 B；A=B 时无效）' }));
  const mixRange = el('input', {
    type: 'range',
    min: '0',
    max: '1',
    step: '0.01',
    value: String(state.ethnicityMix),
  });
  const mixVal = el('span', { className: 'identity-sample-val', text: state.ethnicityMix.toFixed(2) });
  mixLabel.appendChild(mixRange);
  mixLabel.appendChild(mixVal);

  const seedRow = el('label', { className: 'identity-sample-field' });
  seedRow.appendChild(el('span', { text: '随机种子' }));
  const seedInput = el('input', {
    type: 'number',
    className: 'identity-sample-seed',
    value: String(state.seed),
  });
  seedRow.appendChild(seedInput);

  const autoRow = el('label', { className: 'identity-sample-auto' });
  const autoCheck = el('input', { type: 'checkbox' });
  autoCheck.checked = state.autoPickSeed;
  autoRow.appendChild(autoCheck);
  autoRow.appendChild(
    document.createTextNode(
      ` 自动挑种子（女↔男距 ≥ ${DEFAULT_MIN_GENDER_DIST}，最多试 24 次；取达标或最佳）`
    )
  );

  const nameLabel = el('label', { className: 'identity-sample-field' });
  nameLabel.appendChild(el('span', { text: '入库名称' }));
  const nameInput = el('input', {
    type: 'text',
    className: 'identity-sample-name',
    value: '',
    maxlength: '64',
  });
  nameLabel.appendChild(nameInput);

  controls.appendChild(genderQuick);
  controls.appendChild(genderLabel);
  controls.appendChild(intensityLabel);
  controls.appendChild(ethALabel);
  controls.appendChild(ethBLabel);
  controls.appendChild(mixLabel);
  controls.appendChild(seedRow);
  controls.appendChild(autoRow);
  controls.appendChild(nameLabel);
  controls.appendChild(condReadout);

  layout.appendChild(previewPane);
  layout.appendChild(controls);

  const actions = el('div', { className: 'modal-actions' });
  const btnCancel = el('button', { type: 'button', className: 'btn', text: '取消' });
  const btnReseed = el('button', { type: 'button', className: 'btn', text: '换种子' });
  const btnConfirm = el('button', {
    type: 'button',
    className: 'btn primary',
    text: '确认加入我的身份',
  });
  actions.appendChild(btnCancel);
  actions.appendChild(btnReseed);
  actions.appendChild(btnConfirm);

  box.appendChild(title);
  box.appendChild(hint);
  box.appendChild(layout);
  box.appendChild(actions);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  function genderText(g) {
    if (g <= 0.02) return `官方纯女 ${g.toFixed(2)}`;
    if (g >= 0.98) return `官方纯男 ${g.toFixed(2)}`;
    if (g <= 0.15) return `偏女 ${g.toFixed(2)}`;
    if (g >= 0.85) return `偏男 ${g.toFixed(2)}`;
    return `混合 ${g.toFixed(2)}（${GENDER_LABELS[0]}/${GENDER_LABELS[1]}）`;
  }

  function intensityText(v) {
    if (v <= 1.02) return `${v.toFixed(2)}（官方强度）`;
    return `${v.toFixed(2)}（外推加强）`;
  }

  function sampleOpts() {
    return {
      gender: state.gender,
      genderIntensity: state.genderIntensity,
      ethnicityA: state.ethnicityA,
      ethnicityB: state.ethnicityB,
      ethnicityMix: state.ethnicityMix,
      seed: state.seed,
    };
  }

  function refreshNameDefault() {
    if (!nameInput.dataset.userEdited) {
      state.name = defaultSampleName(sampleOpts());
      nameInput.value = state.name;
    }
  }

  let comparingMale = false;
  let contrastCache = null;
  let lastPickInfo = null;

  /** @type {Array<object>} */
  const history = [];
  let historyIndex = -1;
  let applyingHistory = false;

  function syncGenderQuick() {
    const g = state.gender;
    btnPureF.classList.toggle('is-pressed', g <= 0.02);
    btnPureM.classList.toggle('is-pressed', g >= 0.98);
  }

  function syncHistoryNav() {
    btnHistBack.disabled = historyIndex <= 0;
    btnHistFwd.disabled = historyIndex < 0 || historyIndex >= history.length - 1;
    histPos.textContent =
      history.length === 0 ? '0 / 0' : `${historyIndex + 1} / ${history.length}`;
  }

  function cloneVec(v) {
    return v ? Array.from(v) : null;
  }

  function takeSnapshot() {
    return {
      gender: state.gender,
      genderIntensity: state.genderIntensity,
      ethnicityA: state.ethnicityA,
      ethnicityB: state.ethnicityB,
      ethnicityMix: state.ethnicityMix,
      seed: state.seed,
      vector: cloneVec(state.vector),
      name: nameInput.value,
      nameUserEdited: !!nameInput.dataset.userEdited,
      contrastCache: contrastCache
        ? {
            dist: contrastCache.dist,
            female: cloneVec(contrastCache.female),
            male: cloneVec(contrastCache.male),
          }
        : null,
      lastPickInfo: lastPickInfo ? { ...lastPickInfo } : null,
      autoPickSeed: state.autoPickSeed,
    };
  }

  function pushHistory() {
    if (applyingHistory || !state.vector) return;
    if (historyIndex >= 0 && historyIndex < history.length - 1) {
      history.length = historyIndex + 1;
    }
    history.push(takeSnapshot());
    // 防止拖滑条刷出过长历史
    if (history.length > 50) {
      const drop = history.length - 50;
      history.splice(0, drop);
      historyIndex -= drop;
    }
    historyIndex = history.length - 1;
    syncHistoryNav();
  }

  function applySnapshot(snap) {
    applyingHistory = true;
    try {
      comparingMale = false;
      state.gender = snap.gender;
      state.genderIntensity = snap.genderIntensity;
      state.ethnicityA = snap.ethnicityA;
      state.ethnicityB = snap.ethnicityB;
      state.ethnicityMix = snap.ethnicityMix;
      state.seed = snap.seed;
      state.vector = cloneVec(snap.vector);
      state.autoPickSeed = !!snap.autoPickSeed;
      contrastCache = snap.contrastCache
        ? {
            dist: snap.contrastCache.dist,
            female: cloneVec(snap.contrastCache.female),
            male: cloneVec(snap.contrastCache.male),
          }
        : null;
      lastPickInfo = snap.lastPickInfo ? { ...snap.lastPickInfo } : null;

      genderRange.value = String(state.gender);
      genderVal.textContent = genderText(state.gender);
      intensityRange.value = String(state.genderIntensity);
      intensityVal.textContent = intensityText(state.genderIntensity);
      ethA.value = String(state.ethnicityA);
      ethB.value = String(state.ethnicityB);
      mixRange.value = String(state.ethnicityMix);
      mixVal.textContent = state.ethnicityMix.toFixed(2);
      seedInput.value = String(state.seed);
      autoCheck.checked = state.autoPickSeed;
      if (snap.nameUserEdited) {
        nameInput.dataset.userEdited = '1';
        nameInput.value = snap.name || '';
        state.name = nameInput.value;
      } else {
        delete nameInput.dataset.userEdited;
        refreshNameDefault();
      }
      const desc = describeCondition(sampleOpts());
      condReadout.textContent = `官方条件（已核对）：${desc.text}`;
      syncGenderQuick();
      renderPreview();
      syncHistoryNav();
      onStatus?.(`历史预览 ${historyIndex + 1}/${history.length} · 种子 #${state.seed}`);
    } finally {
      applyingHistory = false;
    }
  }

  function goHistory(delta) {
    const next = historyIndex + delta;
    if (next < 0 || next >= history.length) return;
    historyIndex = next;
    applySnapshot(history[historyIndex]);
  }

  function renderPreview() {
    if (closed || !previewer || !state.vector) return;
    try {
      previewer.resize();
      const show = comparingMale && contrastCache?.male ? contrastCache.male : state.vector;
      previewer.setIdentity(show, { reframe: !previewer._framed });
      const boost =
        state.genderIntensity > 1.02 ? ` · 强度 ${state.genderIntensity.toFixed(2)}` : '';
      let contrast = '';
      if (contrastCache != null) {
        const ok = contrastCache.dist >= DEFAULT_MIN_GENDER_DIST;
        contrast = ` · 女↔男距 ${contrastCache.dist.toFixed(2)}${ok ? '（达标）' : '（未达阈值）'}`;
      }
      if (lastPickInfo?.auto) {
        contrast += ` · 自动试 ${lastPickInfo.attempts} 次`;
      }
      const mode = comparingMale ? ' · 对照：纯男' : '';
      previewStatus.textContent = `种子 ${state.seed}${boost}${contrast}${mode}`;
    } catch (err) {
      previewStatus.textContent = `预览失败：${err.message || err}`;
    }
  }

  /**
   * @param {{ forceAutoPick?: boolean, keepSeed?: boolean }} [regenOpts]
   */
  function regenerate(regenOpts = {}) {
    try {
      comparingMale = false;
      const doAuto =
        (state.autoPickSeed || regenOpts.forceAutoPick) && !regenOpts.keepSeed;
      if (doAuto) {
        previewStatus.textContent = '自动挑选性别差够大的种子…';
        const picked = pickSeedWithGenderContrast({
          ...sampleOpts(),
          seed: newSeed(),
          minDist: DEFAULT_MIN_GENDER_DIST,
          // 纯女时多试几轮，更容易抽到女↔男差够大的种子
          maxAttempts: state.gender <= 0.15 ? 36 : 24,
        });
        state.seed = picked.seed;
        seedInput.value = String(state.seed);
        contrastCache = {
          dist: picked.dist,
          female: picked.female,
          male: picked.male,
        };
        lastPickInfo = {
          auto: true,
          attempts: picked.attempts,
          met: picked.met,
        };
      } else {
        contrastCache = genderContrastDistance(sampleOpts());
        lastPickInfo = { auto: false, attempts: 1, met: contrastCache.dist >= DEFAULT_MIN_GENDER_DIST };
      }
      state.vector = sampleIdentity(sampleOpts());
      const desc = describeCondition(sampleOpts());
      condReadout.textContent = `官方条件（已核对）：${desc.text}`;
      refreshNameDefault();
      syncGenderQuick();
      renderPreview();
      pushHistory();
      onStatus?.(
        doAuto
          ? `自动选种 #${state.seed} · 女↔男距 ${contrastCache.dist.toFixed(2)}${
              lastPickInfo.met ? '' : '（取最佳）'
            }`
          : `预览采样 #${state.seed}`
      );
    } catch (err) {
      previewStatus.textContent = err.message || String(err);
      onStatus?.(err.message || String(err));
    }
  }

  function scheduleRegen(opts = { keepSeed: true }) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => regenerate(opts), 80);
  }

  function close() {
    if (closed) return;
    closed = true;
    clearTimeout(debounceTimer);
    overlay.remove();
    try {
      previewer?.dispose?.();
    } catch (_) {
      /* ignore */
    }
    previewer = null;
  }

  function setGender(g) {
    state.gender = Math.min(1, Math.max(0, g));
    genderRange.value = String(state.gender);
    genderVal.textContent = genderText(state.gender);
    syncGenderQuick();
    scheduleRegen();
  }

  syncGenderQuick();
  syncHistoryNav();

  btnPureF.addEventListener('click', () => setGender(0));
  btnPureM.addEventListener('click', () => setGender(1));
  btnHistBack.addEventListener('click', () => goHistory(-1));
  btnHistFwd.addEventListener('click', () => goHistory(1));

  const endCompare = () => {
    if (!comparingMale) return;
    comparingMale = false;
    renderPreview();
  };
  btnCompareM.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (!contrastCache?.male) return;
    comparingMale = true;
    btnCompareM.setPointerCapture?.(e.pointerId);
    renderPreview();
  });
  btnCompareM.addEventListener('pointerup', endCompare);
  btnCompareM.addEventListener('pointercancel', endCompare);
  btnCompareM.addEventListener('pointerleave', endCompare);

  genderRange.addEventListener('input', () => {
    state.gender = Number(genderRange.value);
    genderVal.textContent = genderText(state.gender);
    syncGenderQuick();
    scheduleRegen();
  });
  intensityRange.addEventListener('input', () => {
    state.genderIntensity = Number(intensityRange.value);
    intensityVal.textContent = intensityText(state.genderIntensity);
    scheduleRegen();
  });
  ethA.addEventListener('change', () => {
    state.ethnicityA = Number(ethA.value) | 0;
    scheduleRegen(state.autoPickSeed ? { forceAutoPick: true } : { keepSeed: true });
  });
  ethB.addEventListener('change', () => {
    state.ethnicityB = Number(ethB.value) | 0;
    scheduleRegen(state.autoPickSeed ? { forceAutoPick: true } : { keepSeed: true });
  });
  mixRange.addEventListener('input', () => {
    state.ethnicityMix = Number(mixRange.value);
    mixVal.textContent = state.ethnicityMix.toFixed(2);
    scheduleRegen(state.autoPickSeed ? { forceAutoPick: true } : { keepSeed: true });
  });
  autoCheck.addEventListener('change', () => {
    state.autoPickSeed = !!autoCheck.checked;
  });

  seedInput.addEventListener('change', () => {
    state.seed = (Number(seedInput.value) || 0) >>> 0;
    seedInput.value = String(state.seed);
    // 手改种子：按该种子生成，不自动另挑
    regenerate({ keepSeed: true });
  });
  nameInput.addEventListener('input', () => {
    nameInput.dataset.userEdited = '1';
    state.name = nameInput.value;
  });

  btnReseed.addEventListener('click', () => {
    // 换种子：无论是否勾选自动，都重新搜索一颗达标种子
    regenerate({ forceAutoPick: true });
  });

  btnCancel.addEventListener('click', () => {
    close();
    onStatus?.('已取消语义采样');
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      close();
      onStatus?.('已取消语义采样');
    }
  });

  btnConfirm.addEventListener('click', async () => {
    if (!state.vector) {
      alert('尚未生成预览');
      return;
    }
    const name = (nameInput.value || state.name || defaultSampleName(sampleOpts())).trim();
    if (!name) {
      alert('名称不能为空');
      return;
    }
    try {
      btnConfirm.disabled = true;
      const entry = createCustomIdentity(name, state.vector);
      await onSelectCustom?.(entry.id);
      await onListRefresh?.();
      onConfirmed?.(entry);
      close();
      onStatus?.(`已加入我的身份「${entry.name}」`);
    } catch (err) {
      btnConfirm.disabled = false;
      alert(err.message || String(err));
    }
  });

  try {
    previewer = new SamplePreviewViewport(previewCanvas, model);
    requestAnimationFrame(() => {
      if (closed || !previewer) return;
      previewer.resize();
      if (state.vector) previewer.setIdentity(state.vector, { reframe: true });
    });
    regenerate();
  } catch (err) {
    previewStatus.textContent = err.message || String(err);
    alert(err.message || String(err));
    close();
  }
}
