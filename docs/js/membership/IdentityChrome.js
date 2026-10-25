/**
 * 菜单遮罩右上角身份条（正式）
 * - 仅菜单打开时显示；不进目录列表
 * - 状态来自 MembershipAccess；点击前往 /member
 */
(function () {
  'use strict';

  var MA = null;

  function injectStyles() {
    var style = document.getElementById('pt-id-chrome-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'pt-id-chrome-style';
      document.head.appendChild(style);
    }
    style.textContent = [
      '.pt-id-chrome, .pt-id-chrome * { box-sizing: border-box; }',
      '.pt-id-chrome {',
      '  font-family: Inter, "PingFang SC", "Microsoft YaHei", sans-serif;',
      '  -webkit-font-smoothing: antialiased;',
      '  cursor: pointer; user-select: none;',
      '  -webkit-tap-highlight-color: transparent;',
      '}',
      '.pt-id-chrome:focus-visible { outline: 1px solid rgba(255,255,255,0.22); outline-offset: 2px; }',
      '.pt-id-chrome--bar {',
      '  position: absolute;',
      '  top: calc(env(safe-area-inset-top, 0px) + 18px);',
      '  right: max(18px, env(safe-area-inset-right, 0px));',
      '  z-index: 3;',
      '  display: none; align-items: center; gap: 8px;',
      '  margin: 0; padding: 6px 2px;',
      '  background: transparent; border: none;',
      '  color: rgba(255,255,255,0.78);',
      '  font-size: 11px; letter-spacing: 0.16em; font-weight: 400;',
      '  line-height: 1; max-width: min(46vw, 200px);',
      '}',
      '#global-menu-overlay.active .pt-id-chrome--bar { display: inline-flex; }',
      '.pt-id-chrome__title {',
      '  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;',
      '  color: rgba(255,255,255,0.82);',
      '  transition: color .25s ease;',
      '}',
      '.pt-id-chrome__sep { opacity: 0.55; font-size: 10px; letter-spacing: 0; }',
      '.pt-id-chrome__cta {',
      '  white-space: nowrap; color: rgba(255,255,255,0.7); letter-spacing: 0.12em;',
      '}',
      '.pt-id-chrome[data-tier="user"] .pt-id-chrome__title { color: rgba(250, 236, 200, 0.9); }',
      '.pt-id-chrome[data-tier="member"] .pt-id-chrome__title { color: rgba(255, 224, 120, 0.95); }',
      /* 清理演示版误留节点 */
      '#pt-id-demo-chrome, #pt-id-demo-menu, #pt-id-demo-corner, .menu-container > .pt-id-demo--menu { display: none !important; }'
    ].join('\n');
  }

  function tierFromAccess() {
    var level = 'guest';
    try {
      if (MA && typeof MA.getAccessLevel === 'function') level = MA.getAccessLevel() || 'guest';
    } catch (_e) {}
    if (level === 'member') {
      return { id: 'member', title: '高级会员', cta: '', hash: '' };
    }
    if (level === 'user') {
      return { id: 'user', title: '会员', cta: '', hash: '#account' };
    }
    return { id: 'guest', title: '游客', cta: '登录', hash: '#account' };
  }

  function withReturnParam(url) {
    try {
      var path = (window.location.pathname || '/') + (window.location.search || '');
      if (!path || path.indexOf('/member') === 0) return url;
      var u = new URL(url, window.location.origin);
      u.searchParams.set('return', path);
      return u.pathname + u.search + u.hash;
    } catch (_e) {
      return url;
    }
  }

  function goMember(hash) {
    var url = '/member';
    try {
      if (MA && typeof MA.memberPageUrl === 'function') url = MA.memberPageUrl(hash || '');
      else if (hash) url = '/member' + hash;
    } catch (_e) {
      if (hash) url = '/member' + hash;
    }
    url = withReturnParam(url);
    try {
      if (typeof window.zoomAndNavigate === 'function') {
        window.zoomAndNavigate(url);
        return;
      }
    } catch (_e2) {}
    window.location.href = url;
  }

  function onActivate(e) {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    var t = tierFromAccess();
    goMember(t.hash);
  }

  function removeDemoNodes() {
    ['pt-id-demo-chrome', 'pt-id-demo-menu', 'pt-id-demo-corner'].forEach(function (id) {
      var n = document.getElementById(id);
      if (n && n.parentNode) n.parentNode.removeChild(n);
    });
    try { localStorage.removeItem('pt_identity_chrome_demo_tier'); } catch (_e) {}
  }

  function ensureBar() {
    var overlay = document.getElementById('global-menu-overlay');
    if (!overlay) return null;
    var existing = document.getElementById('pt-id-chrome');
    if (existing) {
      if (existing.parentNode !== overlay) overlay.appendChild(existing);
      return existing;
    }
    var el = document.createElement('button');
    el.type = 'button';
    el.id = 'pt-id-chrome';
    el.className = 'pt-id-chrome pt-id-chrome--bar';
    el.addEventListener('click', onActivate);
    overlay.appendChild(el);
    return el;
  }

  function paint(el) {
    if (!el) return;
    var t = tierFromAccess();
    el.setAttribute('data-tier', t.id);
    el.title = t.id === 'guest' ? '登录 / 注册会员' : '打开会员页';
    if (t.cta) {
      el.innerHTML =
        '<span class="pt-id-chrome__title">' + t.title + '</span>' +
        '<span class="pt-id-chrome__sep" aria-hidden="true">·</span>' +
        '<span class="pt-id-chrome__cta">' + t.cta + '</span>';
    } else {
      el.innerHTML = '<span class="pt-id-chrome__title">' + t.title + '</span>';
    }
  }

  function refresh() {
    removeDemoNodes();
    paint(ensureBar());
  }

  function bindMembership() {
    MA = window.MembershipAccess || null;
    if (!MA) return;
    try {
      if (typeof MA.ready === 'function') {
        MA.ready().then(refresh).catch(refresh);
      }
    } catch (_e) {}
    try {
      if (typeof MA.onChange === 'function') MA.onChange(refresh);
    } catch (_e2) {}
    try {
      window.addEventListener('membership:change', refresh);
    } catch (_e3) {}
    refresh();
  }

  function loadMembershipAccess(done) {
    if (window.MembershipAccess) {
      done();
      return;
    }
    if (document.querySelector('script[data-pt-membership-access]')) {
      var wait = 0;
      var t = setInterval(function () {
        wait += 1;
        if (window.MembershipAccess || wait > 50) {
          clearInterval(t);
          done();
        }
      }, 100);
      return;
    }
    var s = document.createElement('script');
    s.src = '/docs/js/membership/MembershipAccess.js';
    s.async = true;
    s.setAttribute('data-pt-membership-access', '1');
    s.onload = function () { done(); };
    s.onerror = function () { done(); };
    document.head.appendChild(s);
  }

  function boot() {
    injectStyles();
    loadMembershipAccess(bindMembership);
    var tries = 0;
    var timer = setInterval(function () {
      tries += 1;
      refresh();
      if (document.getElementById('global-menu-overlay') || tries > 40) clearInterval(timer);
    }, 120);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
