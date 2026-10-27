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

  function badgeText(gate, sceneData) {
    var req =
      (gate && gate.needLevel) ||
      (gate && gate.rule && gate.rule.require) ||
      (sceneData && sceneData.__require) ||
      (sceneData && sceneData.meta && sceneData.meta.require) ||
      'member';
    if (MA.badgeLabelForRequire) return MA.badgeLabelForRequire(req) || '会员';
    return req === 'user' ? '会员免费' : '高级会员尊享';
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
          MA.promptUpgrade({
            needLevel: req,
            rule: { label: (data && data.name) || '场景', require: req },
            sceneName: data && data.name
          });
          return;
        }
        var rid = MA.sceneResourceId(MA.currentSandbox(), data);
        if (rid) {
          var gate = MA.canAccess(rid);
          if (!gate.ok) {
            if (window.hwLog) window.hwLog('[MembershipGate] 拦截场景 ' + rid);
            MA.promptUpgrade(gate);
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
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'membership-mod-badge';
          badge.style.cssText =
            'position:absolute;top:4px;right:4px;z-index:3;font-size:10px;padding:2px 6px;border-radius:4px;' +
            'background:rgba(0,0,0,0.65);color:#f5d76e;pointer-events:none;';
          try {
            if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
          } catch (_ePos) {}
          host.appendChild(badge);
        }
        badge.textContent = text;
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
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'membership-badge';
          badge.style.cssText =
            'position:absolute;top:6px;right:6px;z-index:2;font-size:11px;padding:2px 6px;border-radius:4px;' +
            'background:rgba(0,0,0,0.65);color:#f5d76e;pointer-events:none;max-width:46%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
          if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
          el.appendChild(badge);
        }
        badge.textContent = text;
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
