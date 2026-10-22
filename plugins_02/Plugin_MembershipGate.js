/**
 * 会员门禁插件（轻耦合）
 * - 包装 window.switchScene / window.switchTab
 * - 收费项由 docs/membership/access-policy.json 决定，本文件不写死业务清单
 * - 探针场景/Tab 仅用于技术验收；改策略即可开关
 */
import '../docs/js/membership/MembershipAccess.js';

(function () {
  'use strict';

  var MA = window.MembershipAccess;
  if (!MA) {
    if (window.hwLog) window.hwLog('[MembershipGate] MembershipAccess 未加载，跳过门禁');
    return;
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
          if (window.hwLog) window.hwLog('[MembershipGate] 拦截已剥离载荷的会员场景');
          MA.promptUpgrade({ rule: { label: (data && data.name) || '会员场景' } });
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

  function wrapSwitchTab() {
    if (typeof window.switchTab !== 'function') return false;
    if (window.switchTab.__membershipWrapped) return true;
    var orig = window.switchTab;
    window.switchTab = function (tabName) {
      try {
        var rid = MA.tabResourceId(tabName);
        var gate = MA.canAccess(rid);
        if (!gate.ok) {
          if (window.hwLog) window.hwLog('[MembershipGate] 拦截 Tab ' + rid);
          MA.promptUpgrade(gate);
          return;
        }
      } catch (e) {
        if (window.hwLog) window.hwLog('[MembershipGate] switchTab 检查异常: ' + (e && e.message));
      }
      return orig.apply(this, arguments);
    };
    window.switchTab.__membershipWrapped = true;
    return true;
  }

  function markLockedTabs() {
    try {
      ['env', 'atmos', 'assist', 'light'].forEach(function (tab) {
        var btn = document.getElementById('btn-tab-' + tab);
        if (!btn) return;
        var gate = MA.canAccess(MA.tabResourceId(tab));
        if (!gate.ok) {
          btn.style.opacity = '0.55';
          btn.title = (gate.rule && gate.rule.label ? gate.rule.label + ' · ' : '') + '会员';
        } else {
          btn.style.opacity = '';
          if (btn.title && btn.title.indexOf('会员') >= 0) btn.title = '';
        }
      });
    } catch (_e) {}
  }

  function markLockedScenesInGrid() {
    try {
      var grid = document.getElementById('scene-grid-container');
      if (!grid || !Array.isArray(window.customScenes)) return;
      var cards = grid.querySelectorAll('[data-scene-index], .scene-card, .scene-item');
      // 若卡片无 data-scene-index，用名称匹配加角标较脆；仅给可识别的节点标「会员」
      window.customScenes.forEach(function (sc, idx) {
        var rid = MA.sceneResourceId(MA.currentSandbox(), sc);
        if (!rid) return;
        var gate = MA.canAccess(rid);
        if (gate.ok) return;
        var el = grid.querySelector('[data-scene-index="' + idx + '"]');
        if (!el && cards[idx]) el = cards[idx];
        if (!el) return;
        el.classList.add('membership-locked');
        if (!el.querySelector('.membership-badge')) {
          var b = document.createElement('span');
          b.className = 'membership-badge';
          b.textContent = '会员';
          b.style.cssText = 'position:absolute;top:6px;right:6px;z-index:2;font-size:11px;padding:2px 6px;border-radius:4px;background:rgba(0,0,0,0.65);color:#f5d76e;pointer-events:none;';
          if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
          el.appendChild(b);
        }
      });
    } catch (_e) {}
  }

  function tryWrap() {
    var a = wrapSwitchScene();
    var b = wrapSwitchTab();
    if (a && b) {
      markLockedTabs();
      return true;
    }
    return false;
  }

  var plugin = {
    onUpdate: function () {
      // 轻量：控制面板可能晚于本插件就绪
      if (!window.switchTab || !window.switchTab.__membershipWrapped ||
          !window.switchScene || !window.switchScene.__membershipWrapped) {
        tryWrap();
      }
    }
  };

  MA.ready().then(function () {
    var n = 0;
    var timer = setInterval(function () {
      n++;
      if (tryWrap() || n > 80) clearInterval(timer);
    }, 100);
    markLockedTabs();
    MA.onChange(function () {
      markLockedTabs();
      markLockedScenesInGrid();
    });
  });

  // 场景网格重建后补角标
  try {
    var _mo = new MutationObserver(function () { markLockedScenesInGrid(); });
    var bootMo = setInterval(function () {
      var grid = document.getElementById('scene-grid-container');
      if (grid) {
        clearInterval(bootMo);
        _mo.observe(grid, { childList: true, subtree: true });
        markLockedScenesInGrid();
      }
    }, 200);
  } catch (_eMo) {}

  if (window.PluginManager) {
    window.PluginManager.register('MembershipGate', plugin);
  }
})();
