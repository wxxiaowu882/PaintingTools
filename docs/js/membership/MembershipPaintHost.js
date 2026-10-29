/**
 * 跨页权限涂色宿主（Portrait_c / GR / XStudio / ARSketch）。
 * 依赖先加载 MembershipAccess.js。Solid 仍用 Plugin_MembershipPaint。
 * 仅测试/本机环境显示「权限涂色」；生产站永不挂 FAB。
 */
(function (global) {
  'use strict';
  var MA = global.MembershipAccess;
  if (!MA) return;

  /** 测站 / 本机才允许运营涂色 UI；www 正式站绝不出现 */
  function isPaintEnv() {
    try {
      var h = String((global.location && location.hostname) || '').toLowerCase();
      if (!h || h === 'localhost' || h === '127.0.0.1') return true;
      if (h === 'test.wuxiaoart.com') return true;
      if (/\.workers\.dev$/i.test(h) && /staging/i.test(h)) return true;
      return false;
    } catch (_e) {
      return false;
    }
  }

  function isAndroidShell() {
    try {
      if (global.__SHELL_VERSION__) return true;
      if (document.documentElement && document.documentElement.classList.contains('wuxiao-android-shell')) return true;
    } catch (_e) {}
    return false;
  }

  /** 壳内禁止 window.open（多窗口易闪退）；同页进运营台 */
  function openMemberOps() {
    try {
      if (isAndroidShell()) {
        global.location.assign('/member-ops');
        return;
      }
      global.open('/member-ops', '_blank', 'noopener');
    } catch (_e) {
      try { global.location.assign('/member-ops'); } catch (_e2) {}
    }
  }

  // 非涂色环境：不挂 FAB，但保留 guard / markLockedEl（正式站仍要门禁）
  var _paintUiEnabled = isPaintEnv();

  var _paintOn = false;
  var _busy = false;
  var _fab = null;
  var _toast = null;
  var _targets = [];
  var _markFns = [];
  var _booted = false;

  function chipColor(req) {
    var r = MA.normalizeRequire(req);
    if (r === 'user') return { bg: 'rgba(46,134,193,0.92)', fg: '#fff' };
    if (r === 'member') return { bg: 'rgba(183,134,11,0.92)', fg: '#fff' };
    return { bg: 'rgba(90,90,90,0.88)', fg: '#eee' };
  }

  function ensureToast() {
    if (_toast) return _toast;
    _toast = document.createElement('div');
    _toast.id = 'membership-paint-toast';
    _toast.style.cssText =
      'display:none;position:fixed;left:50%;bottom:88px;transform:translateX(-50%);z-index:10050;' +
      'max-width:86vw;padding:8px 14px;border-radius:8px;background:rgba(20,20,20,0.88);color:#fff;' +
      'font-size:13px;pointer-events:none;box-shadow:0 4px 16px rgba(0,0,0,0.35)';
    document.body.appendChild(_toast);
    return _toast;
  }

  function showToast(msg, isErr) {
    var el = ensureToast();
    el.textContent = String(msg || '');
    el.style.background = isErr ? 'rgba(160,40,40,0.92)' : 'rgba(20,20,20,0.88)';
    el.style.display = 'block';
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () { el.style.display = 'none'; }, 2200);
  }

  function requireOf(rid) {
    var rule = MA.ruleFor(rid);
    return MA.normalizeRequire(rule && rule.require);
  }

  function styleChip(el, req) {
    var c = chipColor(req);
    el.textContent = MA.paintLabelForRequire(req);
    el.setAttribute('data-require', MA.normalizeRequire(req));
    el.style.background = c.bg;
    el.style.color = c.fg;
  }

  function onChipClick(ev) {
    ev.preventDefault();
    ev.stopPropagation();
    if (!_paintOn || _busy) return;
    var el = ev.currentTarget;
    var rid = el.getAttribute('data-paint-id');
    if (!rid) return;
    var cur = el.getAttribute('data-require') || requireOf(rid);
    var next = MA.nextRequireCycle(cur);
    var label = el.getAttribute('data-paint-label') || rid;
    _busy = true;
    el.style.opacity = '0.55';
    MA.adminSetResourceRequire(rid, next, label).then(function () {
      styleChip(el, next);
      showToast(label + ' → ' + MA.paintLabelForRequire(next));
    }).catch(function (err) {
      if (err && err.needLogin) {
        showToast('请先打开运营台登录，再回来涂色', true);
        setPaint(false);
      } else {
        showToast((err && err.message) || '保存失败', true);
      }
    }).then(function () {
      _busy = false;
      el.style.opacity = '1';
    });
  }

  function makeChip(rid, label, req) {
    var el = document.createElement('button');
    el.type = 'button';
    el.className = 'membership-paint-chip';
    el.setAttribute('data-paint-id', rid);
    if (label) el.setAttribute('data-paint-label', label);
    el.style.cssText =
      'position:absolute;top:6px;left:6px;z-index:5;font-size:11px;padding:3px 8px;border-radius:4px;' +
      'border:none;cursor:pointer;line-height:1.2;max-width:48%;overflow:hidden;text-overflow:ellipsis;' +
      'white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,0.35)';
    styleChip(el, req);
    el.addEventListener('click', onChipClick);
    return el;
  }

  function ensureFab() {
    if (!_paintUiEnabled) return null;
    if (_fab && _fab.isConnected) return _fab;
    if (!document.body) return null;
    var existing = document.getElementById('membership-paint-fab');
    if (existing) {
      _fab = existing;
      return _fab;
    }
    _fab = document.createElement('button');
    _fab.type = 'button';
    _fab.id = 'membership-paint-fab';
    _fab.textContent = '权限涂色';
    _fab.title = '运营：点开后点标签轮换档位（游客→会员→高级）';
    _fab.style.cssText =
      'position:fixed;right:12px;bottom:72px;z-index:10040;padding:8px 12px;border-radius:20px;' +
      'border:1px solid rgba(255,255,255,0.25);background:rgba(30,30,30,0.82);color:#f0f0f0;' +
      'font-size:13px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,0.35)';
    _fab.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      togglePaint();
    });
    document.body.appendChild(_fab);
    return _fab;
  }

  function setFabActive(on) {
    if (!_fab) return;
    _fab.textContent = on ? '涂色中·点此结束' : '权限涂色';
    _fab.style.background = on ? 'rgba(183,134,11,0.95)' : 'rgba(30,30,30,0.82)';
    _fab.style.color = on ? '#111' : '#f0f0f0';
    try { document.body.classList.toggle('membership-paint-on', !!on); } catch (_e) {}
  }

  function applyTargets() {
    for (var i = 0; i < _targets.length; i++) {
      var t = _targets[i];
      if (!t || !t.rid) continue;
      var el = typeof t.getEl === 'function' ? t.getEl() : t.el;
      if (!el) continue;
      var chip = el.querySelector && el.querySelector('.membership-paint-chip[data-paint-id="' + t.rid + '"]');
      if (!_paintOn) {
        if (chip) chip.remove();
        continue;
      }
      try {
        if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
      } catch (_e) {}
      var req = requireOf(t.rid);
      var label = t.label || t.rid;
      if (!chip) {
        chip = makeChip(t.rid, label, req);
        if (t.chipStyle && typeof t.chipStyle === 'object') {
          Object.keys(t.chipStyle).forEach(function (k) { chip.style[k] = t.chipStyle[k]; });
        }
        el.appendChild(chip);
      } else {
        chip.setAttribute('data-paint-label', label);
        styleChip(chip, req);
      }
    }
    for (var j = 0; j < _markFns.length; j++) {
      try { _markFns[j](_paintOn); } catch (_eM) {}
    }
  }

  function setPaint(on) {
    _paintOn = !!on;
    setFabActive(_paintOn);
    applyTargets();
  }

  function togglePaint() {
    if (!_paintUiEnabled) return;
    if (_paintOn) {
      setPaint(false);
      showToast('已结束涂色');
      return;
    }
    MA.adminCheckSession().then(function (st) {
      if (!st.ok) {
        showToast('请先打开运营台登录（同站点）', true);
        openMemberOps();
        return;
      }
      setPaint(true);
      showToast('涂色已开：点标签轮换 游客→会员→高级');
    });
  }

  function guard(rid, label) {
    try {
      var gate = MA.canAccess(rid);
      if (!gate.ok) {
        MA.promptUpgrade(Object.assign({}, gate, {
          rule: Object.assign({}, gate.rule || {}, { label: label || (gate.rule && gate.rule.label) || rid })
        }));
        return false;
      }
    } catch (_e) {}
    return true;
  }

  /**
   * 锁态短标：不置灰宿主。
   * opts.place: 'tr' 按钮右上描边 | 'ribbon' 课表斜角丝带（与 Solid 一致） | 'br' 兼容旧信息区描边
   */
  function clearCornerPad(el) {
    if (!el || !el.getAttribute) return;
    if (!el.getAttribute('data-membership-pad')) return;
    try {
      var orig = el.getAttribute('data-membership-pad-orig');
      if (orig == null || orig === '') el.style.paddingRight = '';
      else el.style.paddingRight = orig;
    } catch (_e) {}
    try {
      el.removeAttribute('data-membership-pad');
      el.removeAttribute('data-membership-pad-orig');
    } catch (_e2) {}
  }

  /** 右上角描边短标预留内边距，避免压住按钮/芯片文字 */
  function ensureCornerPad(el, compact) {
    if (!el || el.getAttribute('data-membership-pad')) return;
    try {
      var cs = getComputedStyle(el);
      var cur = cs.paddingRight || '0px';
      el.setAttribute('data-membership-pad-orig', el.style.paddingRight || '');
      el.setAttribute('data-membership-pad', '1');
      var px = parseFloat(cur) || 0;
      // 角内叠标更吃右侧空间，多留一点避免压末字
      el.style.paddingRight = px + (compact ? 28 : 38) + 'px';
    } catch (_e) {}
  }

  function markLockedEl(el, rid, label, opts) {
    if (!el || !rid) return;
    var gate = MA.canAccess(rid);
    var pageBadge = el.querySelector && el.querySelector('.membership-page-badge');
    var ribbon = el.querySelector && el.querySelector('.membership-badge');
    if (gate.ok) {
      el.classList.remove('membership-locked');
      el.style.opacity = '';
      if (pageBadge) pageBadge.remove();
      if (ribbon) ribbon.remove();
      clearCornerPad(el);
      return;
    }
    el.classList.add('membership-locked');
    el.style.opacity = '';
    var need = gate.needLevel || (gate.rule && gate.rule.require) || 'member';
    var text = MA.badgeLabelForRequire
      ? (MA.badgeLabelForRequire(need) || '会员')
      : '会员';
    var place = (opts && opts.place) || 'tr';
    var title = MA.badgeTitleForLabel ? MA.badgeTitleForLabel(text) : (text === 'Pro' ? '高级会员尊享' : '会员免费');

    // Portrait / 课表：与 Solid 同款角内斜带
    if (place === 'ribbon' && MA.attachLockRibbon) {
      if (pageBadge) pageBadge.remove();
      try {
        if (el.style.overflow === 'visible') el.style.overflow = '';
      } catch (_eOv) {}
      MA.attachLockRibbon(el, text, need);
      return;
    }

    var mount = el;
    if (place === 'br') {
      var info = el.querySelector && el.querySelector('.course-info');
      if (info) mount = info;
    }
    if (ribbon) ribbon.remove();
    var isChip = !!(mount && mount.classList && mount.classList.contains('tab-chip'));
    var useInline = place === 'inline' || !!(opts && opts.inline);
    var surface = (opts && opts.surface) || 'light';
    var compact = !!(opts && opts.compact) || isChip;
    // 默认：NEW 感右上角叠标（可探出边框）；仅显式 inline 时行内
    var useSticker = !useInline && place !== 'br';

    if (!pageBadge) {
      pageBadge = document.createElement('span');
      pageBadge.className = 'membership-page-badge';
      mount.appendChild(pageBadge);
    } else if (pageBadge.parentElement !== mount) {
      try { mount.appendChild(pageBadge); } catch (_e3) {}
    }

    if (useInline) {
      clearCornerPad(mount);
      if (MA.outlineBadgeCss) {
        pageBadge.style.cssText = MA.outlineBadgeCss(need, 'inline', { surface: surface });
      } else {
        pageBadge.style.cssText =
          'display:inline;margin-left:4px;font-size:9px;font-weight:600;background:transparent;border:none;' +
          'color:rgba(70,118,98,0.96);pointer-events:none;white-space:nowrap;';
      }
    } else if (useSticker) {
      // 晓阶 app-shell 裁切 → 角内；晓色/芯片等默认右上外侧，勿 padding 撑大按钮
      var insetStrict = !!(opts && opts.insetStrict);
      if (!insetStrict && mount.classList) {
        if (
          mount.classList.contains('btn-cta') ||
          mount.classList.contains('btn-secondary') ||
          mount.id === 'btn-save-four-panel' ||
          mount.id === 'btn-save-poster'
        ) {
          insetStrict = true;
        }
      }
      var floatOut =
        !insetStrict &&
        (!!(opts && opts.floatOut) ||
          !!(mount.classList && (
            mount.classList.contains('ar-sketch-chk-host') ||
            mount.classList.contains('modal-import-btn') ||
            mount.classList.contains('box-inline-share-btn') ||
            mount.classList.contains('tab-chip')
          )));
      // 仅角内叠标才加右侧 padding；外侧小标禁止撑长按钮
      if (insetStrict) ensureCornerPad(mount, compact);
      else clearCornerPad(mount);
      try {
        if (getComputedStyle(mount).position === 'static') mount.style.position = 'relative';
      } catch (_e) {}
      try {
        mount.style.overflow = 'visible';
      } catch (_eOv) {}
      try {
        var p = mount.parentElement;
        if (p && p.classList) {
          if (p.classList.contains('tabs-container') || p.id === 'modalTabs') {
            var pt = parseFloat(getComputedStyle(p).paddingTop) || 0;
            if (pt < 10) p.style.paddingTop = '10px';
          } else if (p.classList.contains('bottom-actions') || p.classList.contains('modal-header-left') || p.classList.contains('modal-header')) {
            if (getComputedStyle(p).overflow === 'hidden') p.style.overflow = 'visible';
          }
        }
      } catch (_eP) {}
      try {
        if (mount.classList && (mount.classList.contains('modal-import-btn') || mount.classList.contains('box-inline-share-btn'))) {
          mount.style.overflow = 'visible';
        }
      } catch (_eBtn) {}
      if (MA.outlineBadgeCss) {
        pageBadge.style.cssText = MA.outlineBadgeCss(need, 'sticker', {
          surface: surface,
          compact: compact,
          inset: !floatOut,
          insetStrict: insetStrict,
          floatOut: floatOut
        });
      } else {
        pageBadge.style.cssText =
          'position:absolute;right:-8px;top:-8px;z-index:8;font-size:10px;font-weight:700;' +
          'background:rgba(120,94,40,0.5);border:none;color:#fffef8;' +
          'pointer-events:none;white-space:nowrap;transform:none;';
      }
    } else {
      try {
        if (getComputedStyle(mount).position === 'static') mount.style.position = 'relative';
      } catch (_e2) {}
      if (MA.outlineBadgeCss) {
        pageBadge.style.cssText = MA.outlineBadgeCss(need, 'br', { surface: surface });
      }
    }
    pageBadge.textContent = text;
    pageBadge.title = title;
  }

  function boot() {
    if (!_paintUiEnabled) {
      _booted = true;
      MA.onChange(function () { applyTargets(); });
      return;
    }
    if (_booted) {
      // ready 早于 body 时上次可能空跑；允许补挂 FAB
      if (!ensureFab()) {
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', function () { ensureFab(); }, { once: true });
        }
      }
      return;
    }
    _booted = true;
    if (!ensureFab()) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { ensureFab(); }, { once: true });
      } else {
        setTimeout(function () { ensureFab(); }, 0);
      }
    }
    MA.onChange(function () { applyTargets(); });
  }

  global.MembershipPaintHost = {
    boot: function () {
      MA.ready().then(boot);
    },
    isOn: function () { return _paintOn; },
    setOn: setPaint,
    toggle: togglePaint,
    showToast: showToast,
    /** targets: [{ rid, label, el|getEl, chipStyle? }] */
    setTargets: function (list) {
      _targets = Array.isArray(list) ? list : [];
      applyTargets();
    },
    addMarkFn: function (fn) {
      if (typeof fn === 'function') _markFns.push(fn);
    },
    refresh: applyTargets,
    guard: guard,
    markLockedEl: markLockedEl,
    requireOf: requireOf,
    makeChip: makeChip,
    isPaintEnv: isPaintEnv
  };

  MA.ready().then(boot);
})(typeof window !== 'undefined' ? window : globalThis);
