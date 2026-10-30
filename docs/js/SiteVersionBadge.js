/**
 * 版本号：显示在首页头像「关于」弹窗内（不再用右下角角标）
 * - 浏览器：站戳，如 1029A
 * - App 壳：V{壳戳}.{站戳}，如 V1021B.1029A
 */
(function () {
  'use strict';

  var TARGET_ID = 'indexAboutVersion';
  var LEGACY_BADGE_ID = 'shell-version-badge';
  var JSON_URL = '/docs/site-version.json';
  var cachedWeb = '';

  function removeLegacyCornerBadge() {
    try {
      var old = document.getElementById(LEGACY_BADGE_ID);
      if (old && old.parentNode) old.parentNode.removeChild(old);
    } catch (_e) {}
  }

  function shellStamp() {
    try {
      var s = window.__SHELL_BUILD_STAMP__;
      if (s && String(s).trim()) return String(s).trim().toUpperCase();
    } catch (_e) {}
    return '';
  }

  function inShell() {
    if (shellStamp()) return true;
    try {
      if (window.__SHELL_VERSION__) return true;
      if (document.documentElement && document.documentElement.classList.contains('wuxiao-android-shell')) {
        return true;
      }
    } catch (_e2) {}
    return false;
  }

  function formatLabel(webStamp) {
    var web = String(webStamp || '').trim().toUpperCase();
    if (!web) return '';
    var shell = shellStamp();
    if (shell) return 'V' + shell + '.' + web;
    if (inShell()) {
      var legacy = '';
      try { legacy = String(window.__SHELL_VERSION__ || '').trim(); } catch (_e3) {}
      return legacy ? ('V' + legacy + '.' + web) : web;
    }
    return web;
  }

  function paint(webStamp) {
    removeLegacyCornerBadge();
    var web = String(webStamp || cachedWeb || '').trim().toUpperCase();
    if (!web) return;
    cachedWeb = web;
    try { window.__SITE_WEB_STAMP__ = web; } catch (_e4) {}
    var el = document.getElementById(TARGET_ID);
    if (!el) return;
    var label = formatLabel(web);
    el.textContent = label;
    var shell = shellStamp();
    if (shell) el.title = '壳 ' + shell + ' · 站 ' + web;
    else el.title = '站点版本 ' + web;
    el.hidden = !label;
  }

  function normalizeStamp(raw) {
    var stamp = String(raw || '').trim();
    if (stamp && stamp.charAt(0).toUpperCase() === 'W') stamp = stamp.slice(1);
    return stamp;
  }

  function boot() {
    removeLegacyCornerBadge();
    if (typeof fetch !== 'function') return;
    fetch(JSON_URL + '?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (doc) {
        if (!doc) return;
        paint(normalizeStamp(doc.webStamp || doc.webLabel || ''));
      })
      .catch(function () {});
  }

  function onAboutOpen() {
    if (cachedWeb) paint(cachedWeb);
    else boot();
  }

  try {
    window.__paintSiteVersionBadge = paint;
    window.__refreshSiteVersionBadge = boot;
  } catch (_e5) {}

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
  setTimeout(boot, 800);
  setTimeout(boot, 2000);

  // 关于弹窗打开时再刷一次（壳注入可能较晚）
  document.addEventListener('click', function (e) {
    try {
      var t = e.target;
      if (!t) return;
      if (t.closest && (t.closest('.avatar-o') || t.closest('#indexAboutModal'))) {
        setTimeout(onAboutOpen, 0);
      }
    } catch (_e6) {}
  }, true);
})();
