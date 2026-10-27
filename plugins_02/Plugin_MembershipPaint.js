/**
 * 会员权限「涂色」：运营登录后在 Solid 课表 / 面板模块上点标签轮换档位（游客→会员→高级）。
 * 写入 /api/membership/admin/policy { set }；不改业务课表 JSON。
 * Tab 按钮本身不涂；环境光 / 空气透视 / 景深 / 色阶概括按模块涂。
 */
import '../docs/js/membership/MembershipAccess.js';

(function () {
  'use strict';

  var MA = window.MembershipAccess;
  if (!MA) {
    if (window.hwLog) window.hwLog('[MembershipPaint] MembershipAccess 未加载，跳过');
    return;
  }

  var _paintOn = false;
  var _busy = false;
  var _mo = null;
  var _markTimer = null;
  var _fab = null;
  var _toast = null;

  var MOD_DEFS = [
    { mod: 'env', label: '环境光' },
    { mod: 'fog', label: '空气透视' },
    { mod: 'dof', label: '景深虚实' },
    { mod: 'posterize', label: '色阶概括' }
  ];

  function log(msg) {
    try { if (window.hwLog) window.hwLog('[MembershipPaint] ' + msg); } catch (_e) {}
  }

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

  function ensureFab() {
    if (_fab) return _fab;
    _fab = document.createElement('button');
    _fab.type = 'button';
    _fab.id = 'membership-paint-fab';
    _fab.textContent = '权限涂色';
    _fab.title = '运营：点开后在课表/面板模块上点标签轮换档位（游客→会员→高级）';
    _fab.style.cssText =
      'position:fixed;right:12px;bottom:72px;z-index:10040;padding:8px 12px;border-radius:20px;' +
      'border:1px solid rgba(255,255,255,0.25);background:rgba(30,30,30,0.82);color:#f0f0f0;' +
      'font-size:13px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,0.35);backdrop-filter:blur(6px)';
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
      showToast((label.indexOf('scene:') === 0 ? '场景' : label) + ' → ' + MA.paintLabelForRequire(next));
      log('set ' + rid + ' → ' + next);
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

  function markSceneChips() {
    var grid = document.getElementById('scene-grid-container');
    if (!grid || !Array.isArray(window.customScenes)) return;
    var cards = grid.querySelectorAll('.scene-item[data-scene-index]');
    for (var i = 0; i < cards.length; i++) {
      var el = cards[i];
      var idx = parseInt(el.getAttribute('data-scene-index'), 10);
      var sc = window.customScenes[idx];
      if (!sc) continue;
      var rid = MA.sceneResourceId(MA.currentSandbox(), sc);
      if (!rid) continue;
      var req = requireOf(rid);
      var chip = el.querySelector('.membership-paint-chip');
      if (!_paintOn) {
        if (chip) chip.remove();
        continue;
      }
      if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
      if (!chip) {
        chip = makeChip(rid, sc.name || rid, req);
        el.appendChild(chip);
      } else {
        chip.setAttribute('data-paint-id', rid);
        chip.setAttribute('data-paint-label', sc.name || rid);
        styleChip(chip, req);
      }
    }
  }

  function clearLegacyTabChips() {
    try {
      document.querySelectorAll('.membership-paint-chip[data-paint-tab]').forEach(function (c) {
        c.remove();
      });
    } catch (_e) {}
  }

  function markModChips() {
    clearLegacyTabChips();
    MOD_DEFS.forEach(function (d) {
      var host = document.querySelector('[data-membership-mod="' + d.mod + '"]');
      if (!host) return;
      var rid = MA.modResourceId ? MA.modResourceId(d.mod) : ('ui:solid:mod:' + d.mod);
      var label = host.getAttribute('data-membership-label') || d.label;
      var chip = host.querySelector('.membership-paint-chip[data-paint-mod="' + d.mod + '"]');
      if (!_paintOn) {
        if (chip) chip.remove();
        return;
      }
      try {
        if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
      } catch (_e) {}
      var req = requireOf(rid);
      if (!chip) {
        chip = makeChip(rid, label, req);
        chip.setAttribute('data-paint-mod', d.mod);
        chip.style.top = '4px';
        chip.style.right = '4px';
        chip.style.left = 'auto';
        chip.style.maxWidth = '42%';
        host.appendChild(chip);
      } else {
        chip.setAttribute('data-paint-id', rid);
        chip.setAttribute('data-paint-label', label);
        styleChip(chip, req);
      }
    });
  }

  function scheduleMark() {
    if (_markTimer) return;
    _markTimer = setTimeout(function () {
      _markTimer = null;
      markSceneChips();
      markModChips();
    }, 60);
  }

  function onGridCaptureClick(ev) {
    if (!_paintOn) return;
    var t = ev.target;
    if (t && t.closest && t.closest('.membership-paint-chip')) return;
    var card = t && t.closest && t.closest('.scene-item[data-scene-index]');
    if (!card) return;
    ev.preventDefault();
    ev.stopPropagation();
    showToast('涂色中：请点卡片左上角标签改档');
  }

  function bindGridCapture(on) {
    var grid = document.getElementById('scene-grid-container');
    if (!grid) return;
    if (on) grid.addEventListener('click', onGridCaptureClick, true);
    else grid.removeEventListener('click', onGridCaptureClick, true);
  }

  function setPaint(on) {
    _paintOn = !!on;
    setFabActive(_paintOn);
    bindGridCapture(_paintOn);
    if (_paintOn) {
      scheduleMark();
      try {
        if (_mo) {
          var grid = document.getElementById('scene-grid-container');
          if (grid) _mo.observe(grid, { childList: true, subtree: false });
        }
      } catch (_e) {}
    } else {
      markSceneChips();
      markModChips();
    }
  }

  function togglePaint() {
    if (_paintOn) {
      setPaint(false);
      showToast('已结束涂色');
      return;
    }
    MA.adminCheckSession().then(function (st) {
      if (!st.ok) {
        showToast('请先打开 /member-ops 登录运营台（同站点）', true);
        try {
          window.open('/member-ops', '_blank', 'noopener');
        } catch (_e) {}
        return;
      }
      setPaint(true);
      showToast('涂色已开：点标签轮换 游客→会员→高级');
    });
  }

  function boot() {
    ensureFab();
    try {
      _mo = new MutationObserver(function () {
        if (_paintOn) scheduleMark();
      });
    } catch (_eMo) {}
    var n = 0;
    var t = setInterval(function () {
      n++;
      var grid = document.getElementById('scene-grid-container');
      var panel = document.getElementById('main-panel');
      if ((grid && panel) || n > 100) {
        clearInterval(t);
        if (grid && _mo) {
          try { _mo.observe(grid, { childList: true, subtree: false }); } catch (_e) {}
        }
      }
    }, 200);
    MA.onChange(function () {
      if (_paintOn) scheduleMark();
    });
  }

  var plugin = {
    onUpdate: function () {
      if (_paintOn) scheduleMark();
    }
  };

  MA.ready().then(boot);

  if (window.PluginManager) {
    window.PluginManager.register('MembershipPaint', plugin);
  }

  window.MembershipPaint = {
    isOn: function () { return _paintOn; },
    setOn: setPaint,
    toggle: togglePaint,
    showToast: showToast,
    makeChip: makeChip,
    styleChip: styleChip,
    requireOf: requireOf,
    scheduleMark: scheduleMark
  };
})();
