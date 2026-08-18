// 消费端 Solid.html：全屏 loader 淡出后、首帧 draw + 光影探针就绪前的居中轻提示。

const FADE_MS = 280;
const READY_FRAMES = 2;
const TIMEOUT_MS_MOBILE = 6000;
const TIMEOUT_MS_DESKTOP = 4000;
const DRAW_WEIGHT = 0.35;
const PROBE_WEIGHT = 0.65;

export function createSolidFirstFrameHintController({
  isMobile,
  shouldArm,
  isLoaderVisible,
  log,
}) {
  let root = null;
  let barFill = null;
  let textEl = null;
  let state = 'idle';
  let sceneToken = -1;
  let startedAt = 0;
  let readyFrames = 0;
  let displayProgress = 0;
  let fadeStartAt = 0;
  let drawnThisFrame = false;
  let probeProgress = 0;
  let probeDone = false;

  function _now() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }

  function _timeoutMs() {
    return isMobile ? TIMEOUT_MS_MOBILE : TIMEOUT_MS_DESKTOP;
  }

  function _ensureDom() {
    if (root) return;
    root = document.createElement('div');
    root.id = 'solid-first-frame-hint';
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = '<div id="solid-first-frame-hint-inner"><div id="solid-first-frame-hint-bar-track"><div id="solid-first-frame-hint-bar-fill"></div></div><div id="solid-first-frame-hint-text">首帧渲染中…</div></div>';
    document.body.appendChild(root);
    barFill = root.querySelector('#solid-first-frame-hint-bar-fill');
    textEl = root.querySelector('#solid-first-frame-hint-text');
    root.style.opacity = '0';
    root.style.display = 'none';
  }

  function _setBar(p) {
    const v = Math.max(0, Math.min(100, Number(p) || 0));
    if (barFill) barFill.style.transform = 'scaleX(' + (v / 100) + ')';
  }

  function _setText(msg) {
    if (textEl) textEl.textContent = String(msg || '');
  }

  function _hideDom() {
    if (!root) return;
    root.style.opacity = '0';
    root.style.display = 'none';
  }

  function _showDom() {
    if (!root) return;
    root.style.display = 'flex';
    requestAnimationFrame(() => {
      if (root && state !== 'idle') root.style.opacity = '1';
    });
  }

  function _targetProgress() {
    const drawPart = Math.max(0, Math.min(1, readyFrames / READY_FRAMES));
    const probePart = probeDone ? 1 : Math.max(0, Math.min(1, probeProgress));
    return (drawPart * DRAW_WEIGHT + probePart * PROBE_WEIGHT) * 100;
  }

  function _syncLabel() {
    if (!probeDone) {
      if (probeProgress > 0.01) {
        const n = Math.max(1, Math.round(probeProgress * 3));
        _setText('光影探针 ' + Math.min(3, n) + '/3…');
      } else {
        _setText('正在计算光影…');
      }
      return;
    }
    if (readyFrames < READY_FRAMES) _setText('首帧渲染中…');
    else _setText('即将完成…');
  }

  function _resetVisual() {
    displayProgress = 0;
    readyFrames = 0;
    drawnThisFrame = false;
    probeProgress = 0;
    probeDone = false;
    _setBar(0);
    _setText('正在计算光影…');
  }

  function disarm() {
    state = 'idle';
    sceneToken = -1;
    fadeStartAt = 0;
    _hideDom();
    _resetVisual();
  }

  function arm(opts) {
    if (typeof shouldArm === 'function' && !shouldArm()) return;
    _ensureDom();
    sceneToken = opts && opts.sceneToken != null ? Number(opts.sceneToken) : -1;
    startedAt = _now();
    fadeStartAt = 0;
    _resetVisual();
    state = 'armed';
    if (typeof isLoaderVisible === 'function' && !isLoaderVisible()) {
      _showDom();
    } else {
      _hideDom();
      if (root) root.style.display = 'flex';
    }
  }

  function notifyDraw(opts) {
    if (state === 'idle' || state === 'fading') return;
    const tok = opts && opts.sceneToken != null ? Number(opts.sceneToken) : sceneToken;
    if (tok !== sceneToken) return;
    drawnThisFrame = true;
  }

  function notifyProbeProgress(opts) {
    if (state === 'idle' || state === 'fading') return;
    const ratio = Math.max(0, Math.min(1, Number(opts && opts.ratio) || 0));
    probeProgress = Math.max(probeProgress, ratio);
    if (opts && opts.label) _setText(String(opts.label));
    else _syncLabel();
  }

  function notifyProbeDone(opts) {
    if (state === 'idle' || state === 'fading') return;
    probeDone = true;
    probeProgress = 1;
    if (opts && opts.label) _setText(String(opts.label));
    else _syncLabel();
  }

  function _beginFade() {
    if (state === 'fading' || state === 'idle') return;
    state = 'fading';
    fadeStartAt = _now();
    displayProgress = 100;
    _setBar(100);
  }

  function tick(opts) {
    if (state === 'idle') return;
    const tok = opts && opts.sceneToken != null ? Number(opts.sceneToken) : sceneToken;
    if (tok !== sceneToken) { disarm(); return; }
    if (typeof shouldArm === 'function' && !shouldArm()) { disarm(); return; }

    const loaderUp = typeof isLoaderVisible === 'function' && isLoaderVisible();
    if (loaderUp) {
      if (root) { root.style.opacity = '0'; root.style.display = 'flex'; }
      return;
    }
    if (state === 'armed' || state === 'visible') {
      state = 'visible';
      _showDom();
    }

    if (drawnThisFrame) readyFrames += 1;
    else readyFrames = 0;
    drawnThisFrame = false;

    const elapsed = _now() - startedAt;
    const limit = _timeoutMs();

    if (state === 'fading') {
      const ft = _now() - fadeStartAt;
      if (ft >= FADE_MS) disarm();
      else if (root) root.style.opacity = String(Math.max(0, 1 - ft / FADE_MS));
      return;
    }

    _syncLabel();
    const target = Math.max(displayProgress, Math.min(92, _targetProgress()));
    displayProgress += (target - displayProgress) * 0.18;
    _setBar(displayProgress);

    if (readyFrames >= READY_FRAMES && probeDone) {
      _beginFade();
      return;
    }
    if (elapsed >= limit) _beginFade();
  }

  function isActive() {
    return state !== 'idle';
  }

  return {
    arm,
    disarm,
    notifyDraw,
    notifyProbeProgress,
    notifyProbeDone,
    tick,
    isActive,
  };
}
