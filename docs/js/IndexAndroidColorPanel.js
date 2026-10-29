/**
 * 首页色立体选色：安卓 WebView/Chrome 原生 color 控件过简，用轻量 HSV 面板替代。
 * Win / iOS 仍走原生 input[type=color]（本模块不介入）。
 */
(function (global) {
  'use strict';

  function isAndroid() {
    try {
      return /Android/i.test(navigator.userAgent || '');
    } catch (_e) {
      return false;
    }
  }

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function hsvToRgb(h, s, v) {
    h = ((h % 360) + 360) % 360;
    s = clamp(s, 0, 1);
    v = clamp(v, 0, 1);
    var c = v * s;
    var x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    var m = v - c;
    var r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; }
    else if (h < 120) { r = x; g = c; }
    else if (h < 180) { g = c; b = x; }
    else if (h < 240) { g = x; b = c; }
    else if (h < 300) { r = x; b = c; }
    else { r = c; b = x; }
    return {
      r: Math.round((r + m) * 255),
      g: Math.round((g + m) * 255),
      b: Math.round((b + m) * 255)
    };
  }

  function rgbToHex(r, g, b) {
    function h(n) {
      var s = clamp(n, 0, 255).toString(16);
      return s.length === 1 ? '0' + s : s;
    }
    return '#' + h(r) + h(g) + h(b);
  }

  function hexToRgb(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return { r: 255, g: 255, b: 255 };
    var n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b);
    var d = max - min;
    var h = 0;
    if (d !== 0) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    var s = max === 0 ? 0 : d / max;
    return { h: h, s: s, v: max };
  }

  /**
   * @param {object} opts
   * @param {HTMLInputElement} opts.nativeInput
   * @param {HTMLElement} opts.hotspot
   * @param {function(string):void} opts.onColor  hex 如 #rrggbb
   */
  function attach(opts) {
    // 走导出名，便于验收临时覆盖；生产默认仍是 UA 安卓检测
    var androidCheck =
      (global.IndexAndroidColorPanel && global.IndexAndroidColorPanel.isAndroid) || isAndroid;
    if (!androidCheck()) return { active: false };
    var nativeInput = opts && opts.nativeInput;
    var hotspot = opts && opts.hotspot;
    var onColor = opts && opts.onColor;
    if (!nativeInput || !hotspot || typeof onColor !== 'function') return { active: false };

    nativeInput.style.pointerEvents = 'none';
    nativeInput.tabIndex = -1;

    var state = { h: 0, s: 0, v: 1, open: false, dragging: null };
    var overlay = null;
    var svCanvas = null;
    var hueCanvas = null;
    var swatchEl = null;
    var hexEl = null;

    function ensureUi() {
      if (overlay) return;
      overlay = document.createElement('div');
      overlay.id = 'index-android-color-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.style.cssText =
        'display:none;position:fixed;inset:0;z-index:9500;align-items:flex-end;justify-content:center;' +
        'background:rgba(0,0,0,0.55);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);' +
        'padding:0 0 max(16px,env(safe-area-inset-bottom));box-sizing:border-box;';

      var card = document.createElement('div');
      card.style.cssText =
        'width:min(92vw,360px);margin:0 auto 12px;padding:18px 16px 14px;border-radius:18px;' +
        'background:rgba(18,18,20,0.96);border:1px solid rgba(255,255,255,0.12);' +
        'box-shadow:0 18px 48px rgba(0,0,0,0.55);font-family:Inter,\"PingFang SC\",\"Microsoft YaHei\",sans-serif;' +
        'color:rgba(255,255,255,0.9);';

      var title = document.createElement('div');
      title.textContent = '选择颜色';
      title.style.cssText =
        'font-size:13px;letter-spacing:0.14em;font-weight:300;margin-bottom:14px;text-align:center;' +
        'color:rgba(255,255,255,0.55);';

      svCanvas = document.createElement('canvas');
      svCanvas.width = 280;
      svCanvas.height = 180;
      svCanvas.style.cssText =
        'display:block;width:100%;height:auto;border-radius:12px;touch-action:none;cursor:crosshair;';

      hueCanvas = document.createElement('canvas');
      hueCanvas.width = 280;
      hueCanvas.height = 22;
      hueCanvas.style.cssText =
        'display:block;width:100%;height:22px;margin-top:12px;border-radius:999px;touch-action:none;cursor:pointer;';

      var row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:12px;margin-top:14px;';

      swatchEl = document.createElement('div');
      swatchEl.style.cssText =
        'width:36px;height:36px;border-radius:50%;flex:none;' +
        'border:1px solid rgba(255,255,255,0.25);box-shadow:0 0 0 1px rgba(0,0,0,0.35) inset;';

      hexEl = document.createElement('div');
      hexEl.style.cssText =
        'flex:1;font-size:13px;letter-spacing:0.12em;font-weight:200;color:rgba(255,255,255,0.7);';

      var done = document.createElement('button');
      done.type = 'button';
      done.textContent = '完成';
      done.style.cssText =
        'border:none;border-radius:10px;padding:10px 16px;cursor:pointer;' +
        'background:#fff;color:#111;font-size:13px;letter-spacing:0.08em;font-weight:400;';

      row.appendChild(swatchEl);
      row.appendChild(hexEl);
      row.appendChild(done);
      card.appendChild(title);
      card.appendChild(svCanvas);
      card.appendChild(hueCanvas);
      card.appendChild(row);
      overlay.appendChild(card);
      document.body.appendChild(overlay);

      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) close();
      });
      done.addEventListener('click', function (e) {
        e.preventDefault();
        close();
      });

      bindDrag(svCanvas, function (nx, ny) {
        state.s = clamp(nx, 0, 1);
        state.v = clamp(1 - ny, 0, 1);
        emit();
        paint();
      });
      bindDrag(hueCanvas, function (nx) {
        state.h = clamp(nx, 0, 1) * 360;
        emit();
        paint();
      });
    }

    function bindDrag(el, fn) {
      function pos(ev) {
        var t = ev.touches && ev.touches[0] ? ev.touches[0] : ev;
        var r = el.getBoundingClientRect();
        return {
          x: (t.clientX - r.left) / Math.max(1, r.width),
          y: (t.clientY - r.top) / Math.max(1, r.height)
        };
      }
      function start(ev) {
        ev.preventDefault();
        state.dragging = el;
        var p = pos(ev);
        fn(p.x, p.y);
      }
      function move(ev) {
        if (state.dragging !== el) return;
        ev.preventDefault();
        var p = pos(ev);
        fn(p.x, p.y);
      }
      function end() {
        if (state.dragging === el) state.dragging = null;
      }
      el.addEventListener('pointerdown', start);
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
    }

    function paintSv() {
      var ctx = svCanvas.getContext('2d');
      var w = svCanvas.width, h = svCanvas.height;
      var rgb = hsvToRgb(state.h, 1, 1);
      var grdX = ctx.createLinearGradient(0, 0, w, 0);
      grdX.addColorStop(0, '#fff');
      grdX.addColorStop(1, 'rgb(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ')');
      ctx.fillStyle = grdX;
      ctx.fillRect(0, 0, w, h);
      var grdY = ctx.createLinearGradient(0, 0, 0, h);
      grdY.addColorStop(0, 'rgba(0,0,0,0)');
      grdY.addColorStop(1, '#000');
      ctx.fillStyle = grdY;
      ctx.fillRect(0, 0, w, h);
      var cx = state.s * w, cy = (1 - state.v) * h;
      ctx.beginPath();
      ctx.arc(cx, cy, 7, 0, Math.PI * 2);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, 7, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    function paintHue() {
      var ctx = hueCanvas.getContext('2d');
      var w = hueCanvas.width, h = hueCanvas.height;
      var grd = ctx.createLinearGradient(0, 0, w, 0);
      for (var i = 0; i <= 6; i++) {
        var rgb = hsvToRgb(i * 60, 1, 1);
        grd.addColorStop(i / 6, 'rgb(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ')');
      }
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, w, h);
      var x = (state.h / 360) * w;
      ctx.fillStyle = '#fff';
      ctx.fillRect(x - 2, 0, 4, h);
      ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.strokeRect(x - 2, 0, 4, h);
    }

    function paint() {
      paintSv();
      paintHue();
      var rgb = hsvToRgb(state.h, state.s, state.v);
      var hex = rgbToHex(rgb.r, rgb.g, rgb.b);
      swatchEl.style.background = hex;
      hexEl.textContent = hex.toUpperCase();
    }

    function emit() {
      var rgb = hsvToRgb(state.h, state.s, state.v);
      var hex = rgbToHex(rgb.r, rgb.g, rgb.b);
      try { nativeInput.value = hex; } catch (_e) {}
      onColor(hex);
    }

    function open() {
      ensureUi();
      var cur = hexToRgb(nativeInput.value || '#ffffff');
      var hsv = rgbToHsv(cur.r, cur.g, cur.b);
      state.h = hsv.h; state.s = hsv.s; state.v = hsv.v;
      overlay.style.display = 'flex';
      state.open = true;
      paint();
    }

    function close() {
      if (!overlay) return;
      overlay.style.display = 'none';
      state.open = false;
      state.dragging = null;
    }

    hotspot.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (state.open) close();
      else open();
    }, true);

    return { active: true, open: open, close: close };
  }

  global.IndexAndroidColorPanel = { isAndroid: isAndroid, attach: attach };
})(typeof window !== 'undefined' ? window : globalThis);
