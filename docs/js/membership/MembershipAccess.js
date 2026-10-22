/**
 * 会员访问（轻耦合客户端）
 * - 权益：以 /api/membership/me（签名 Cookie）为准；localStorage 仅缓存展示
 * - 策略：docs/membership/access-policy.json
 * - 课表：优先 /api/membership/catalog；生产环境禁止回退到未过滤静态全文
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'wuxiao_membership_entitlement_v1';
  var POLICY_URL = '/docs/membership/access-policy.json';
  var TIERS_URL = '/docs/membership/tiers.json';
  var API_REDEEM = '/api/membership/redeem';
  var API_ME = '/api/membership/me';
  var API_CATALOG = '/api/membership/catalog';

  var _policy = null;
  var _tiers = null;
  var _entitlement = null;
  var _ready = null;
  var _listeners = [];
  var _serverAuthoritative = false;

  function nowMs() { return Date.now(); }

  function isLocalHost() {
    try {
      var h = global.location && global.location.hostname;
      return h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
    } catch (_e) {
      return false;
    }
  }

  function loadStoredEntitlement() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return normalizeEntitlement(JSON.parse(raw));
    } catch (_e) {
      return null;
    }
  }

  function saveEntitlement(ent) {
    _entitlement = normalizeEntitlement(ent);
    try {
      if (_entitlement && _entitlement.level === 'member') {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(_entitlement));
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch (_e) {}
    notify();
    return _entitlement;
  }

  function normalizeEntitlement(obj) {
    if (!obj) return { tierId: 'free', level: 'free', expiresAt: null, source: 'default' };
    var tierId = String(obj.tierId || obj.tier || 'free');
    var level = obj.level || (tierId === 'free' ? 'free' : 'member');
    var expiresAt = obj.expiresAt == null ? null : Number(obj.expiresAt);
    if (level === 'member' && expiresAt != null && isFinite(expiresAt) && expiresAt > 0 && expiresAt < nowMs()) {
      return { tierId: 'free', level: 'free', expiresAt: null, source: 'expired' };
    }
    return {
      tierId: tierId,
      level: level === 'member' ? 'member' : 'free',
      expiresAt: (expiresAt != null && isFinite(expiresAt) && expiresAt > 0) ? expiresAt : null,
      source: obj.source || 'local',
      redeemedAt: obj.redeemedAt || null
    };
  }

  function getEntitlement() {
    if (_entitlement) return normalizeEntitlement(_entitlement);
    _entitlement = loadStoredEntitlement() || { tierId: 'free', level: 'free', expiresAt: null, source: 'default' };
    return _entitlement;
  }

  function isMemberActive() {
    return getEntitlement().level === 'member';
  }

  function notify() {
    var snap = getEntitlement();
    for (var i = 0; i < _listeners.length; i++) {
      try { _listeners[i](snap); } catch (_e) {}
    }
    try {
      global.dispatchEvent(new CustomEvent('membership:change', { detail: snap }));
    } catch (_e2) {}
  }

  function onChange(fn) {
    if (typeof fn !== 'function') return function () {};
    _listeners.push(fn);
    return function () {
      _listeners = _listeners.filter(function (f) { return f !== fn; });
    };
  }

  function fetchJson(url, opts) {
    return fetch(url, Object.assign({ credentials: 'same-origin', cache: 'no-cache' }, opts || {})).then(function (r) {
      if (!r.ok) {
        var err = new Error('HTTP ' + r.status + ' ' + url);
        err.status = r.status;
        throw err;
      }
      return r.json();
    });
  }

  function ensureReady() {
    if (_ready) return _ready;
    _entitlement = loadStoredEntitlement();
    _ready = Promise.all([
      fetchJson(POLICY_URL).then(function (p) { _policy = p; }).catch(function () {
        _policy = { version: 0, resources: {}, defaultRequire: 'free' };
      }),
      fetchJson(TIERS_URL).then(function (t) { _tiers = t; }).catch(function () {
        _tiers = { tiers: [] };
      }),
      refreshFromServer().catch(function () { /* 无 API 时保留本地缓存（仅本地开发） */ })
    ]).then(function () { return api; });
    return _ready;
  }

  function refreshFromServer() {
    return fetch(API_ME, { credentials: 'same-origin', cache: 'no-cache' }).then(function (r) {
      if (r.status === 404) {
        _serverAuthoritative = false;
        return null;
      }
      if (!r.ok) return null;
      _serverAuthoritative = true;
      return r.json();
    }).then(function (data) {
      if (!data || !data.ok) return null;
      if (data.entitlement) {
        // 服务端为准：覆盖本地（含伪造的 localStorage）
        saveEntitlement(Object.assign({}, data.entitlement, { source: data.entitlement.source || 'server' }));
      }
      return data.entitlement || null;
    });
  }

  function ruleFor(resourceId) {
    var pol = _policy || { resources: {}, defaultRequire: 'free' };
    var res = (pol.resources && pol.resources[resourceId]) || null;
    if (!res || res.enabled === false) {
      return { require: pol.defaultRequire || 'free', enabled: false, resourceId: resourceId };
    }
    return {
      require: res.require || 'free',
      enabled: true,
      probe: !!res.probe,
      label: res.label || resourceId,
      resourceId: resourceId
    };
  }

  function canAccess(resourceId) {
    var rule = ruleFor(resourceId);
    if (!rule.enabled || rule.require === 'free') {
      return { ok: true, reason: 'free', rule: rule, entitlement: getEntitlement() };
    }
    if (rule.require === 'member' && isMemberActive()) {
      return { ok: true, reason: 'member', rule: rule, entitlement: getEntitlement() };
    }
    return { ok: false, reason: 'need_member', rule: rule, entitlement: getEntitlement() };
  }

  function sceneResourceId(sandbox, sceneData) {
    var sb = String(sandbox || 'geometry').toLowerCase();
    var name = (sceneData && (sceneData.name || sceneData.title)) ? String(sceneData.name || sceneData.title).trim() : '';
    if (!name) return null;
    return 'scene:' + sb + ':name:' + name;
  }

  function tabResourceId(tabName) {
    return 'ui:solid:tab:' + String(tabName || '');
  }

  function currentSandbox() {
    try {
      var u = new URL(global.location.href);
      return (u.searchParams.get('sandbox') || 'geometry').toLowerCase();
    } catch (_e) {
      return 'geometry';
    }
  }

  function catalogUrl(sandbox) {
    return API_CATALOG + '?sandbox=' + encodeURIComponent(sandbox || currentSandbox());
  }

  function stripScenePayload(scene) {
    if (!scene || typeof scene !== 'object') return scene;
    return {
      name: scene.name,
      thumbnail: scene.thumbnail,
      meta: scene.meta
        ? {
            category: scene.meta.category,
            detail: scene.meta.detail,
            description: scene.meta.description,
            locked: true
          }
        : { locked: true },
      __membershipLocked: true
    };
  }

  /** 本地无 Functions 时的客户端过滤（生产禁止依赖此路径防白嫖） */
  function filterScenesClientSide(scenes, sandbox) {
    var list = Array.isArray(scenes) ? scenes : [];
    if (isMemberActive()) return list;
    return list.map(function (sc) {
      var rid = sceneResourceId(sandbox, sc);
      if (!rid) return sc;
      var gate = canAccess(rid);
      if (!gate.ok) return stripScenePayload(sc);
      return sc;
    });
  }

  function fetchCatalog(sandbox) {
    var sb = sandbox || currentSandbox();
    return fetchJson(catalogUrl(sb)).then(function (data) {
      if (data && data.ok && Array.isArray(data.scenes)) {
        if (data.entitlement) saveEntitlement(data.entitlement);
        if (typeof data.member === 'boolean' && data.member !== isMemberActive()) {
          // 以课表接口侧会员态为准时，可再刷 /me；此处信任过滤结果
        }
        return data.scenes;
      }
      throw new Error('catalog_invalid');
    }).catch(function (err) {
      if (!isLocalHost()) {
        throw new Error('课表安全接口不可用，请稍后重试（生产环境不回退公开全文）');
      }
      // 仅 localhost：回退静态文件 + 客户端按策略剥离
      var staticMap = {
        geometry: '/docs/json/沙盒_几何体静物/沙盒_几何体静物.json',
        portrait: '/docs/json/沙盒_肖像光影沙盒/沙盒_肖像光影沙盒.json',
        headform: '/docs/json/沙盒_头部造型规律/沙盒_头部造型规律.json'
      };
      var url = staticMap[sb] || staticMap.geometry;
      return fetchJson(url).then(function (raw) {
        var arr = Array.isArray(raw) ? raw : [raw];
        return filterScenesClientSide(arr, sb);
      });
    });
  }

  function redeem(code) {
    var body = JSON.stringify({ code: String(code || '').trim() });
    return fetch(API_REDEEM, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: body
    }).then(function (r) {
      return r.json().then(function (data) {
        if (r.status === 404) {
          throw new Error(isLocalHost()
            ? '本地未运行 Pages Functions。请用 wrangler pages dev 或部署后再兑换。'
            : '兑换服务未部署，请稍后重试');
        }
        if (!r.ok || !data || !data.ok) {
          throw new Error((data && data.error) || ('兑换失败 HTTP ' + r.status));
        }
        return saveEntitlement(Object.assign({}, data.entitlement, { source: 'server' }));
      });
    });
  }

  function clearEntitlement() {
    saveEntitlement({ tierId: 'free', level: 'free', expiresAt: null, source: 'cleared' });
    return fetch(API_ME, { method: 'DELETE', credentials: 'same-origin' }).catch(function () {
      return null;
    });
  }

  function memberPageUrl(extraQuery) {
    var q = extraQuery ? ('?' + extraQuery) : '';
    return '/member' + q;
  }

  function promptUpgrade(detail) {
    var msg = '此内容需要会员。前往兑换页开通？';
    if (detail && detail.rule && detail.rule.label) msg = '「' + detail.rule.label + '」需要会员。前往兑换页？';
    try {
      if (global.confirm(msg)) {
        var ret = '';
        try { ret = encodeURIComponent(global.location.pathname + global.location.search); } catch (_e) {}
        global.location.href = memberPageUrl(ret ? ('return=' + ret) : '');
      }
    } catch (_e2) {
      global.location.href = memberPageUrl('');
    }
  }

  var api = {
    ready: ensureReady,
    canAccess: canAccess,
    ruleFor: ruleFor,
    getEntitlement: getEntitlement,
    isMemberActive: isMemberActive,
    redeem: redeem,
    clearEntitlement: clearEntitlement,
    refreshFromServer: refreshFromServer,
    fetchCatalog: fetchCatalog,
    catalogUrl: catalogUrl,
    filterScenesClientSide: filterScenesClientSide,
    sceneResourceId: sceneResourceId,
    tabResourceId: tabResourceId,
    currentSandbox: currentSandbox,
    getPolicy: function () { return _policy; },
    getTiers: function () { return _tiers; },
    onChange: onChange,
    memberPageUrl: memberPageUrl,
    promptUpgrade: promptUpgrade,
    isLocalHost: isLocalHost,
    isServerAuthoritative: function () { return _serverAuthoritative; },
    STORAGE_KEY: STORAGE_KEY
  };

  global.MembershipAccess = api;
  ensureReady();
})(typeof window !== 'undefined' ? window : globalThis);
