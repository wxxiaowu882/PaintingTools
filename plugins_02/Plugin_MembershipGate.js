/**
 * 会员门禁插件（轻耦合）
 * - 包装 window.switchScene / window.switchTab
 * - 收费项由 docs/membership/access-policy.json 决定，本文件不写死业务清单
 * - 角标：会员免费 / 高级会员尊享
 * - 网格 MutationObserver 须防抖，且 mark 期间 disconnect，避免重建时 O(n²) 连环卡顿
 */
import '../docs/js/membership/MembershipAccess.js';

(function () {
  'use strict';

  var MA = window.MembershipAccess;
  if (!MA) {
    if (window.hwLog) window.hwLog('[MembershipGate] MembershipAccess 未加载，跳过门禁');
    return;
  }

  function badgeRequire(gate, sceneData) {
    return (
      (gate && gate.needLevel) ||
      (gate && gate.rule && gate.rule.require) ||
      (sceneData && sceneData.__require) ||
      (sceneData && sceneData.meta && sceneData.meta.require) ||
      'member'
    );
  }

  function badgeText(gate, sceneData) {
    var req = badgeRequire(gate, sceneData);
    if (MA.badgeLabelForRequire) return MA.badgeLabelForRequire(req) || '会员';
    return req === 'user' ? '会员免费' : '高级会员尊享';
  }

  /** 模块旁：会员免费=绿字，高级=黄字 */
  function badgeStyle(req, kind) {
    var isUser = MA.normalizeRequire ? MA.normalizeRequire(req) === 'user' : req === 'user';
    var ink = isUser ? 'rgba(168, 214, 186, 0.95)' : 'rgba(232, 210, 150, 0.95)';
    var ribbonBg = isUser
      ? 'linear-gradient(180deg,rgba(52,92,68,0.92),rgba(28,48,36,0.96))'
      : 'linear-gradient(180deg,rgba(92,74,36,0.92),rgba(48,38,18,0.96))';
    if (kind === 'mod') {
      return (
        'display:inline-block;margin-left:8px;vertical-align:middle;flex:none;' +
        'font-size:10px;font-weight:400;padding:0;border:none;border-radius:0;background:transparent;' +
        'color:' + ink + ';pointer-events:none;letter-spacing:0;white-space:nowrap;'
      );
    }
    // 课表：列表项右下角斜角丝带（贴在卡片上，不盖缩略图）
    return (
      'position:absolute;right:-34px;bottom:14px;left:auto;top:auto;z-index:3;' +
      'width:112px;padding:4px 0;text-align:center;' +
      'font-size:9px;line-height:1.2;font-weight:500;letter-spacing:0.04em;' +
      'color:' + ink + ';background:' + ribbonBg + ';' +
      'border:none;border-radius:0;box-shadow:0 1px 0 rgba(255,255,255,0.08) inset,0 2px 8px rgba(0,0,0,0.35);' +
      'transform:rotate(-45deg);transform-origin:center center;' +
      'pointer-events:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'
    );
  }

  /** 课表点锁课后会先关 modal；拦截进景时立刻加取消时都要恢复，避免「空场景」观感 */
  function restoreSceneGridUi() {
    try {
      var modal = document.getElementById('scene-grid-modal');
      if (modal) modal.style.display = 'flex';
      var cards = document.querySelectorAll('#scene-grid-container .scene-item');
      for (var i = 0; i < cards.length; i++) {
        cards[i].style.opacity = '';
        cards[i].style.filter = '';
      }
    } catch (_e) {}
  }

  function wrapSwitchScene() {
    if (typeof window.switchScene !== 'function') return false;
    if (window.switchScene.__membershipWrapped) return true;
    var orig = window.switchScene;
    window.switchScene = function (index) {
      try {
        var scenes = window.customScenes;
        var data = (Array.isArray(scenes) && scenes[index]) ? scenes[index] : null;
        if (data && data.__membershipLocked) {
          if (window.hwLog) window.hwLog('[MembershipGate] 拦截已剥离载荷的场景');
          var req =
            data.__require ||
            (data.meta && data.meta.require) ||
            'member';
          restoreSceneGridUi();
          MA.promptUpgrade({
            needLevel: req,
            rule: { label: (data && data.name) || '场景', require: req },
            sceneName: data && data.name,
            onDismiss: restoreSceneGridUi
          });
          return;
        }
        var rid = MA.sceneResourceId(MA.currentSandbox(), data);
        if (rid) {
          var gate = MA.canAccess(rid);
          if (!gate.ok) {
            if (window.hwLog) window.hwLog('[MembershipGate] 拦截场景 ' + rid);
            restoreSceneGridUi();
            MA.promptUpgrade(Object.assign({}, gate, { onDismiss: restoreSceneGridUi }));
            return;
          }
        }
      } catch (e) {
        if (window.hwLog) window.hwLog('[MembershipGate] switchScene 检查异常: ' + (e && e.message));
      }
      return orig.apply(this, arguments);
    };
    window.switchScene.__membershipWrapped = true;
    return true;
  }

  /** Tab 本身不门禁（可自由切换查看）；收费在模块控件上 */
  function wrapSwitchTab() {
    if (typeof window.switchTab !== 'function') return false;
    window.switchTab.__membershipWrapped = true;
    return true;
  }

  function modId(key) {
    return MA.modResourceId ? MA.modResourceId(key) : ('ui:solid:mod:' + key);
  }

  function guardMod(modKey, label) {
    try {
      var gate = MA.canAccess(modId(modKey));
      if (!gate.ok) {
        if (window.hwLog) window.hwLog('[MembershipGate] 拦截模块 ' + modKey);
        MA.promptUpgrade(Object.assign({}, gate, {
          rule: Object.assign({}, gate.rule || {}, { label: label || (gate.rule && gate.rule.label) || modKey })
        }));
        return false;
      }
    } catch (e) {
      if (window.hwLog) window.hwLog('[MembershipGate] 模块检查异常: ' + (e && e.message));
    }
    return true;
  }

  function wrapNamed(fnName, modKey, label) {
    if (typeof window[fnName] !== 'function') return false;
    if (window[fnName].__membershipWrapped) return true;
    var orig = window[fnName];
    window[fnName] = function () {
      if (!guardMod(modKey, label)) return;
      return orig.apply(this, arguments);
    };
    window[fnName].__membershipWrapped = true;
    return true;
  }

  function wrapPanelMods() {
    var ok = true;
    ok = wrapNamed('toggleFogAdvanced', 'fog', '空气透视') && ok;
    ok = wrapNamed('toggleDoF', 'dof', '景深虚实') && ok;
    ok = wrapNamed('togglePosterize', 'posterize', '色阶概括') && ok;
    ok = wrapNamed('onFogSliderInput', 'fog', '空气透视') && ok;
    ok = wrapNamed('updateFogUI', 'fog', '空气透视') && ok;
    ok = wrapNamed('selectFogType', 'fog', '空气透视') && ok;
    ok = wrapNamed('onDoFSliderInput', 'dof', '景深虚实') && ok;
    ok = wrapNamed('onPosterizeSliderInput', 'posterize', '色阶概括') && ok;
    ok = wrapNamed('toggleWall', 'env', '环境光') && ok;
    ok = wrapNamed('setEnvColor', 'env', '环境光') && ok;
    return ok;
  }

  function markLockedMods() {
    try {
      ['env', 'fog', 'dof', 'posterize'].forEach(function (mod) {
        var host = document.querySelector('[data-membership-mod="' + mod + '"]');
        if (!host) return;
        var gate = MA.canAccess(modId(mod));
        var badge = host.querySelector('.membership-mod-badge');
        if (gate.ok) {
          host.classList.remove('membership-mod-locked');
          host.style.opacity = '';
          if (badge) badge.remove();
          return;
        }
        host.classList.add('membership-mod-locked');
        host.style.opacity = '0.55';
        var text = badgeText(gate);
        var req = badgeRequire(gate);
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'membership-mod-badge';
          var titleEl =
            host.querySelector('.module-title') ||
            host.querySelector('label.module-title') ||
            host.querySelector('label');
          if (titleEl) titleEl.appendChild(badge);
          else host.appendChild(badge);
        }
        badge.style.cssText = badgeStyle(req, 'mod');
        badge.textContent = text;
        badge.title = text;
      });
      // 清掉旧 Tab 灰显
      ['env', 'atmos', 'assist', 'light'].forEach(function (tab) {
        var btn = document.getElementById('btn-tab-' + tab);
        if (!btn) return;
        btn.style.opacity = '';
        if (btn.title && (btn.title.indexOf('会员') >= 0 || btn.title.indexOf('尊享') >= 0)) btn.title = '';
      });
    } catch (_e) {}
  }

  function onLockedModPointer(ev) {
    try {
      if (document.body && document.body.classList.contains('membership-paint-on')) return;
      var t = ev.target;
      var host = t && t.closest && t.closest('[data-membership-mod]');
      if (!host || !host.classList.contains('membership-mod-locked')) return;
      var mod = host.getAttribute('data-membership-mod');
      if (!mod) return;
      ev.preventDefault();
      ev.stopPropagation();
      guardMod(mod, host.getAttribute('data-membership-label') || mod);
    } catch (_e) {}
  }

  var _mo = null;
  var _markTimer = null;
  var _marking = false;

  function markLockedScenesInGrid() {
    if (_marking) return;
    var grid = document.getElementById('scene-grid-container');
    if (!grid || !Array.isArray(window.customScenes)) return;
    _marking = true;
    try {
      if (_mo) _mo.disconnect();
      var byIndex = Object.create(null);
      var cards = grid.querySelectorAll('.scene-item[data-scene-index]');
      for (var c = 0; c < cards.length; c++) {
        var idxAttr = cards[c].getAttribute('data-scene-index');
        byIndex[idxAttr] = cards[c];
      }
      window.customScenes.forEach(function (sc, idx) {
        var el = byIndex[String(idx)];
        if (!el) return;
        var rid = MA.sceneResourceId(MA.currentSandbox(), sc);
        if (!rid) return;
        var gate = MA.canAccess(rid);
        var badge = el.querySelector('.membership-badge');
        if (gate.ok) {
          el.classList.remove('membership-locked');
          if (badge) badge.remove();
          return;
        }
        el.classList.add('membership-locked');
        var text = badgeText(gate, sc);
        var reqSc = badgeRequire(gate, sc);
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'membership-badge';
          try {
            if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
          } catch (_ePos) {}
          // 旧版曾挂在缩略图 wrap 上：统一挂到列表项右下角
          el.appendChild(badge);
        } else if (badge.parentElement !== el) {
          try { el.appendChild(badge); } catch (_eRe) {}
        }
        try {
          // 斜角丝带需露出卡片右下角，避免被 overflow:hidden 裁切
          if (el.style.overflow === 'hidden' || !el.style.overflow) {
            var ov = '';
            try { ov = getComputedStyle(el).overflow; } catch (_eOv) {}
            if (ov === 'hidden') el.style.overflow = 'visible';
          }
        } catch (_eOv2) {}
        badge.style.cssText = badgeStyle(reqSc, 'scene');
        badge.textContent = text;
        badge.title = text;
      });
    } catch (_e) {
    } finally {
      _marking = false;
      try {
        if (_mo && grid.isConnected) _mo.observe(grid, { childList: true, subtree: false });
      } catch (_e2) {}
    }
  }

  function scheduleMarkLockedScenes() {
    if (_markTimer) return;
    _markTimer = setTimeout(function () {
      _markTimer = null;
      markLockedScenesInGrid();
    }, 80);
  }

  function tryWrap() {
    var a = wrapSwitchScene();
    var b = wrapSwitchTab();
    var c = wrapPanelMods();
    if (a && b) {
      markLockedMods();
      return c;
    }
    return false;
  }

  var plugin = {
    onUpdate: function () {
      if (!window.switchScene || !window.switchScene.__membershipWrapped) {
        tryWrap();
      } else {
        wrapPanelMods();
      }
      markLockedMods();
    }
  };

  MA.ready().then(function () {
    var n = 0;
    var timer = setInterval(function () {
      n++;
      if (tryWrap() || n > 80) clearInterval(timer);
    }, 100);
    markLockedMods();
    try {
      document.addEventListener('click', onLockedModPointer, true);
      document.addEventListener('change', onLockedModPointer, true);
    } catch (_eCap) {}
    MA.onChange(function () {
      markLockedMods();
      scheduleMarkLockedScenes();
    });
  });

  try {
    _mo = new MutationObserver(function () { scheduleMarkLockedScenes(); });
    var bootMo = setInterval(function () {
      var grid = document.getElementById('scene-grid-container');
      if (grid) {
        clearInterval(bootMo);
        // 只听直接子节点增删：整表重建会触发一次；勿 subtree 跟 img 加载
        _mo.observe(grid, { childList: true, subtree: false });
        scheduleMarkLockedScenes();
      }
    }, 200);
  } catch (_eMo) {}

  if (window.PluginManager) {
    window.PluginManager.register('MembershipGate', plugin);
  }
})();
