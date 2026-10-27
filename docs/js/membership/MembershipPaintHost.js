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

  function markLockedEl(el, rid, label) {
    if (!el || !rid) return;
    var gate = MA.canAccess(rid);
    var badge = el.querySelector && el.querySelector('.membership-page-badge');
    if (gate.ok) {
      el.classList.remove('membership-locked');
      el.style.opacity = '';
      if (badge) badge.remove();
      return;
    }
    el.classList.add('membership-locked');
    el.style.opacity = '0.55';
    var text = MA.badgeLabelForRequire
      ? (MA.badgeLabelForRequire(gate.needLevel || (gate.rule && gate.rule.require)) || '会员')
      : '会员';
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'membership-page-badge';
      badge.style.cssText =
        'position:absolute;top:6px;right:6px;z-index:2;font-size:10px;padding:2px 6px;border-radius:4px;' +
        'background:rgba(0,0,0,0.65);color:#f5d76e;pointer-events:none;';
      try {
        if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
      } catch (_e) {}
      el.appendChild(badge);
    }
    badge.textContent = text;
    badge.title = label || rid;
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
