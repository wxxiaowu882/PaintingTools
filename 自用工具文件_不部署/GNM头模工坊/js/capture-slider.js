/**
 * Tembrica-style slider: pointer capture so drag continues off-track / into 3D view.
 */
export function createCaptureSlider({
  min = -3,
  max = 3,
  step = 0.01,
  value = 0,
  onInput,
  onPointerDown,
  onPointerUp,
}) {
  const root = document.createElement('div');
  root.className = 'cap-slider';
  root.setAttribute('role', 'slider');
  root.tabIndex = 0;

  const track = document.createElement('div');
  track.className = 'cap-slider-track';
  const fill = document.createElement('div');
  fill.className = 'cap-slider-fill';
  const thumb = document.createElement('div');
  thumb.className = 'cap-slider-thumb';
  track.appendChild(fill);
  track.appendChild(thumb);
  root.appendChild(track);

  let current = clamp(Number(value), min, max);
  let dragging = false;

  function clamp(v, a, b) {
    return Math.min(b, Math.max(a, v));
  }

  function quantize(v) {
    if (!step) return v;
    const n = Math.round((v - min) / step) * step + min;
    return clamp(Number(n.toFixed(6)), min, max);
  }

  function ratioFromClientX(clientX) {
    const rect = track.getBoundingClientRect();
    const w = Math.max(rect.width, 1);
    return clamp((clientX - rect.left) / w, 0, 1);
  }

  function applyVisual() {
    const t = (current - min) / (max - min || 1);
    fill.style.width = `${t * 100}%`;
    thumb.style.left = `${t * 100}%`;
    root.setAttribute('aria-valuenow', String(current));
    root.setAttribute('aria-valuemin', String(min));
    root.setAttribute('aria-valuemax', String(max));
  }

  function setValue(v, { silent = false } = {}) {
    current = quantize(clamp(v, min, max));
    applyVisual();
    if (!silent) onInput?.(current);
  }

  function fromPointer(e) {
    const r = ratioFromClientX(e.clientX);
    setValue(min + r * (max - min));
  }

  const onMove = (e) => {
    if (!dragging) return;
    e.preventDefault();
    fromPointer(e);
  };

  const onUp = (e) => {
    if (!dragging) return;
    dragging = false;
    try {
      root.releasePointerCapture(e.pointerId);
    } catch (_) {}
    root.classList.remove('is-dragging');
    onPointerUp?.(current);
  };

  root.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    dragging = true;
    root.classList.add('is-dragging');
    root.setPointerCapture(e.pointerId);
    onPointerDown?.(current);
    fromPointer(e);
  });
  root.addEventListener('pointermove', onMove);
  root.addEventListener('pointerup', onUp);
  root.addEventListener('pointercancel', onUp);

  root.addEventListener('keydown', (e) => {
    const d = step || 0.01;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      setValue(current - d);
      onPointerUp?.(current);
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      setValue(current + d);
      onPointerUp?.(current);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setValue(min);
      onPointerUp?.(current);
    } else if (e.key === 'End') {
      e.preventDefault();
      setValue(max);
      onPointerUp?.(current);
    }
  });

  applyVisual();

  return {
    el: root,
    get value() {
      return current;
    },
    setValue(v, opts) {
      setValue(v, opts);
    },
    get dragging() {
      return dragging;
    },
  };
}
