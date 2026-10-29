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
    return req === 'user' ? '会员' : 'Pro';
  }

  function badgeTitle(text) {
    if (MA.badgeTitleForLabel) return MA.badgeTitleForLabel(text);
    return text === 'Pro' ? '高级会员尊享' : '会员免费';
  }

  /** 文本/标题外包一层（防重复套娃，否则 tab 多切会 DOM 爆炸崩溃） */
  function ensureTextHost(el) {
    if (!el) return null;
    if (el.classList && el.classList.contains('membership-txt-host')) return el;
    var p = el.parentElement;
    if (p && p.classList && p.classList.contains('membership-txt-host')) return p;
    var wrap = document.createElement('span');
    wrap.className = 'membership-txt-host';
    wrap.style.cssText =
      'position:relative;display:inline-flex;align-items:center;vertical-align:middle;flex:none;';
    try {
      el.parentNode.insertBefore(wrap, el);
      wrap.appendChild(el);
    } catch (_e) {
      return el;
    }
    return wrap;
  }

  /**
   * 标题文案右上角色底小标（不压 checkbox / 滑条）。
   * opts.floatOut：略向右上外侧探出，少挡字。
   */
  function ensureCornerBadge(mountEl, key, text, req, opts) {
    if (!mountEl) return;
    var sel = '.membership-mod-badge[data-mod-slot="' + key + '"]';
    try {
      document.querySelectorAll(sel).forEach(function (b) {
        if (b.parentElement !== mountEl) b.remove();
      });
    } catch (_eC) {}
    // 卸掉旧版挂在 checkbox 上的宿主，避免挡点击
    try {
      var stale = mountEl.querySelector && mountEl.querySelector('.membership-chk-host');
      if (stale && stale.parentNode) {
        while (stale.firstChild) stale.parentNode.insertBefore(stale.firstChild, stale);
        stale.remove();
      }
    } catch (_eU) {}
    var badge = mountEl.querySelector(sel);
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'membership-mod-badge';
      badge.setAttribute('data-mod-slot', key);
      mountEl.appendChild(badge);
    }
    try {
      if (getComputedStyle(mountEl).position === 'static') mountEl.style.position = 'relative';
      mountEl.style.overflow = 'visible';
    } catch (_eP) {}
    var floatOut = !(opts && opts.floatOut === false);
    badge.style.cssText = MA.outlineBadgeCss
      ? MA.outlineBadgeCss(req, 'sticker', {
          surface: 'dark',
          compact: true,
          inset: true,
          floatOut: floatOut
        })
      : 'position:absolute;right:-12px;top:-9px;font-size:8px;padding:1px 4px;border-radius:3px;' +
        'background:rgba(120,94,40,0.5);color:#fffef8;pointer-events:none;';
    badge.textContent = text;
    badge.title = badgeTitle(text);
  }

  function ensureInlineBadge(anchorEl, key, text, req, opts) {
    ensureCornerBadge(anchorEl, key, text, req, opts);
  }

  function clearModCornerBadges(host) {
    if (!host) return;
    try {
      host.querySelectorAll('.membership-mod-badge:not([data-mod-slot])').forEach(function (b) {
        b.remove();
      });
    } catch (_e) {}
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
    // 只拦滑条等用户手势；勿包 updateFogUI / toggleFog* / setEnvColor
    // （进公开课灌参会同步 UI，否则会误弹「空气透视」）
    var ok = true;
    ok = wrapNamed('onFogSliderInput', 'fog', '空气透视') && ok;
    ok = wrapNamed('onDoFSliderInput', 'dof', '景深虚实') && ok;
    ok = wrapNamed('onPosterizeSliderInput', 'posterize', '色阶概括') && ok;
    return ok;
  }

  function clearInlineSlots(keys) {
    keys.forEach(function (key) {
      try {
        document.querySelectorAll('.membership-mod-badge[data-mod-slot="' + key + '"]').forEach(function (b) {
          b.remove();
        });
      } catch (_e) {}
    });
  }

  function markLockedMods() {
    try {
      // env：色块旁三处；fog/dof/posterize：标题文案旁
      var envHost = document.querySelector('[data-membership-mod="env"]');
      var fogHost = document.querySelector('[data-membership-mod="fog"]');
      var dofHost = document.querySelector('[data-membership-mod="dof"]');
      var postHost = document.querySelector('[data-membership-mod="posterize"]');

      function setHostLocked(host, locked) {
        if (!host) return;
        if (locked) {
          host.classList.add('membership-mod-locked');
          host.style.opacity = '';
          clearModCornerBadges(host);
        } else {
          host.classList.remove('membership-mod-locked');
          host.style.opacity = '';
          clearModCornerBadges(host);
        }
      }

      var envGate = MA.canAccess(modId('env'));
      setHostLocked(envHost, !envGate.ok);
      if (!envGate.ok) {
        var envText = badgeText(envGate);
        var envReq = badgeRequire(envGate);
        // 背景墙：挂在「背景墙」文案上，不挡 checkbox
        var wallTitle = null;
        try {
          var wallLab = envHost && envHost.querySelector('label');
          wallTitle = wallLab && wallLab.querySelector('span');
        } catch (_eW) {}
        ensureCornerBadge(ensureTextHost(wallTitle), 'env-wall', envText, envReq);
        var groundLabel = null;
        try {
          var spans = envHost ? envHost.querySelectorAll('span') : [];
          for (var gi = 0; gi < spans.length; gi++) {
            if ((spans[gi].textContent || '').trim() === '地面') {
              groundLabel = spans[gi];
              break;
            }
          }
        } catch (_eG) {}
        ensureCornerBadge(ensureTextHost(groundLabel), 'env-ground', envText, envReq);
        var skyLabel = envHost && envHost.querySelector('.slider-label');
        ensureCornerBadge(ensureTextHost(skyLabel), 'env-sky', envText, envReq);
      } else {
        clearInlineSlots(['env-wall', 'env-ground', 'env-sky']);
      }

      var fogGate = MA.canAccess(modId('fog'));
      setHostLocked(fogHost, !fogGate.ok);
      if (!fogGate.ok) {
        // 挂在整段标题 label 右上（字尾外侧），不压 checkbox
        var fogLabel = fogHost && fogHost.querySelector('label.module-title');
        ensureCornerBadge(fogLabel, 'fog-title', badgeText(fogGate), badgeRequire(fogGate));
      } else {
        clearInlineSlots(['fog-title']);
      }

      var dofGate = MA.canAccess(modId('dof'));
      setHostLocked(dofHost, !dofGate.ok);
      if (!dofGate.ok) {
        var dofLabel = dofHost && dofHost.querySelector('label.module-title');
        ensureCornerBadge(dofLabel, 'dof-title', badgeText(dofGate), badgeRequire(dofGate));
      } else {
        clearInlineSlots(['dof-title']);
      }

      var postGate = MA.canAccess(modId('posterize'));
      setHostLocked(postHost, !postGate.ok);
      if (!postGate.ok) {
        var postSpan = postHost && postHost.querySelector('label span');
        ensureCornerBadge(ensureTextHost(postSpan), 'posterize-title', badgeText(postGate), badgeRequire(postGate));
      } else {
        clearInlineSlots(['posterize-title']);
      }

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
        // 角内裁切盒 + 斜带，避免圆角处尖角外溢
        try {
          if (el.style.overflow === 'visible') el.style.overflow = '';
        } catch (_eOv2) {}
        if (MA.attachLockRibbon) {
          MA.attachLockRibbon(el, text, reqSc);
        } else if (!badge) {
          badge = document.createElement('span');
          badge.className = 'membership-badge';
          el.appendChild(badge);
          badge.textContent = text;
          badge.title = badgeTitle(text);
        }
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

  var _modMarkTimer = null;
  function scheduleMarkLockedMods() {
    if (_modMarkTimer) return;
    _modMarkTimer = setTimeout(function () {
      _modMarkTimer = null;
      markLockedMods();
    }, 160);
  }

  var plugin = {
    onUpdate: function () {
      if (!window.switchScene || !window.switchScene.__membershipWrapped) {
        tryWrap();
      } else {
        wrapPanelMods();
      }
      // 勿每帧同步 mark：曾导致 text-host 套娃 / 主线程打满 → 页面崩溃
      scheduleMarkLockedMods();
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
    // 策略 ready 后补打课表角标（避免网格先于 policy 出现时漏标）
    scheduleMarkLockedScenes();
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
