/**
 * 测站角标：仅测试域名右下角固定「测」，正式站不显示。
 * 幂等；可被 GlobalMenu / MembershipAccess 重复加载。
 */
(function () {
  'use strict';

  function isStagingHost() {
    try {
      var h = String((window.location && window.location.hostname) || '').toLowerCase();
      if (h === 'test.wuxiaoart.com') return true;
      if (h.indexOf('soft-voice-f822-staging') >= 0) return true;
      return false;
    } catch (_e) {
      return false;
    }
  }

  function ensure() {
    if (!isStagingHost()) return;
    if (document.getElementById('pt-staging-site-mark')) return;
    var style = document.getElementById('pt-staging-site-mark-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'pt-staging-site-mark-style';
      style.textContent = [
        '#pt-staging-site-mark{',
        'position:fixed;right:max(10px,env(safe-area-inset-right,0px));',
        'bottom:max(10px,env(safe-area-inset-bottom,0px));',
        'z-index:2147483000;pointer-events:none;user-select:none;',
        'font-family:"Microsoft YaHei","PingFang SC",sans-serif;',
        'font-size:13px;font-weight:600;letter-spacing:0.08em;line-height:1;',
        'color:rgba(255,210,120,0.55);',
        'text-shadow:0 1px 2px rgba(0,0,0,0.55);',
        '-webkit-font-smoothing:antialiased;',
        '}'
      ].join('');
      (document.head || document.documentElement).appendChild(style);
    }
    var el = document.createElement('div');
    el.id = 'pt-staging-site-mark';
    el.setAttribute('aria-hidden', 'true');
    el.textContent = '测';
    el.title = '当前为测试站';
    (document.body || document.documentElement).appendChild(el);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensure);
  } else {
    ensure();
  }
  // 晚到的 body（个别入口）再补一次
  setTimeout(ensure, 0);
  setTimeout(ensure, 800);
})();
