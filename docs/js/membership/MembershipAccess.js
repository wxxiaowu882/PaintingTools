/**
 * 会员访问（轻耦合客户端）
 * - 权益：以 /api/membership/me（签名 Cookie）为准；localStorage 仅缓存展示
 * - 策略：docs/membership/access-policy.json
 * - 课表：优先 /api/membership/catalog；生产环境禁止回退到未过滤静态全文
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'wuxiao_membership_entitlement_v1';
  var DEVICE_KEY = 'wuxiao_device_id_v1';
  var POLICY_URL = '/docs/membership/access-policy.json';
  var TIERS_URL = '/docs/membership/tiers.json';
  var PUBLIC_CONFIG = '/api/membership/public-config';
  var API_REDEEM = '/api/membership/redeem';
  var API_ME = '/api/membership/me';
  var API_CATALOG = '/api/membership/catalog';
  var API_SCENE = '/api/membership/scene';
  var API_REGISTER = '/api/membership/account/register';
  var API_LOGIN = '/api/membership/account/login';
  var PROMO_REF_KEY = 'pt_promo_ref';
  var _promoInfo = null;
  var API_DEVICES = '/api/membership/account/devices';

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

  function getDeviceId() {
    try {
      var id = localStorage.getItem(DEVICE_KEY);
      if (id && id.length >= 8) return id;
      id = 'dev_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(DEVICE_KEY, id);
      return id;
    } catch (_e) {
      return 'dev_ephemeral_' + String(Date.now());
    }
  }

  function postJson(url, body) {
    return fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(function (r) {
      return r.json().then(function (data) {
        return { r: r, data: data };
      });
    });
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
      // 缓存登录态与高级会员，供弱网展示；真正门禁以 Cookie/服务端为准
      if (_entitlement && (_entitlement.level === 'member' || _entitlement.level === 'user' || _entitlement.accountId)) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(_entitlement));
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch (_e) {}
    notify();
    return _entitlement;
  }

  function normalizeRequire(req) {
    var r = String(req == null ? 'public' : req).toLowerCase().trim();
    if (r === 'member' || r === 'premium') return 'member';
    if (r === 'user' || r === 'registered') return 'user';
    return 'public';
  }

  function normalizeEntitlement(obj) {
    if (!obj) return { tierId: 'free', level: 'guest', expiresAt: null, source: 'default' };
    var accountId = obj.accountId || null;
    var deviceId = obj.deviceId || null;
    var tierId = String(obj.tierId || obj.tier || 'free');
    var level = String(obj.level || '').toLowerCase();
    if (level === 'free') level = accountId ? 'user' : 'guest';
    if (level !== 'member' && level !== 'user' && level !== 'guest') {
      level = accountId ? 'user' : (tierId !== 'free' && tierId !== 'guest' && tierId !== 'user' ? 'member' : 'guest');
    }
    if (level === 'guest' && accountId) level = 'user';
    var expiresAt = obj.expiresAt == null ? null : Number(obj.expiresAt);
    if (level === 'member' && expiresAt != null && isFinite(expiresAt) && expiresAt > 0 && expiresAt < nowMs()) {
      return {
        tierId: 'free',
        level: accountId ? 'user' : 'guest',
        expiresAt: null,
        source: 'expired',
        accountId: accountId,
        deviceId: deviceId
      };
    }
    return {
      tierId: tierId,
      level: level,
      expiresAt: (expiresAt != null && isFinite(expiresAt) && expiresAt > 0) ? expiresAt : null,
      source: obj.source || 'local',
      redeemedAt: obj.redeemedAt || null,
      accountId: accountId,
      deviceId: deviceId
    };
  }

  function getEntitlement() {
    if (_entitlement) return normalizeEntitlement(_entitlement);
    _entitlement = loadStoredEntitlement() || { tierId: 'free', level: 'guest', expiresAt: null, source: 'default' };
    return _entitlement;
  }

  /** guest | user | member */
  function getAccessLevel() {
    var e = getEntitlement();
    if (e.level === 'member') return 'member';
    if (e.level === 'user' || e.accountId) return 'user';
    return 'guest';
  }

  function meetsRequire(require) {
    var level = getAccessLevel();
    var req = normalizeRequire(require);
    if (req === 'public') return true;
    if (req === 'user') return level === 'user' || level === 'member';
    if (req === 'member') return level === 'member';
    return true;
  }

  /** 是否高级会员（付费有效） */
  function isMemberActive() {
    return getAccessLevel() === 'member';
  }

  /** 列表/按钮短标；完整说明只在 promptUpgrade 弹窗里 */
  function badgeLabelForRequire(require) {
    var req = normalizeRequire(require);
    // 短于 Member，与 Pro 同为克制短标
    if (req === 'user') return '会员';
    if (req === 'member') return 'Pro';
    return '';
  }

  /** surface: dark（黑按钮/深底）| light（白按钮/浅底） */
  function badgeInk(require, surface) {
    var isUser = normalizeRequire(require) === 'user';
    var dark = surface === 'dark';
    // 叠标：字色与描边强对比。深底用浅字（近白/亮金），浅底用深字
    if (isUser) {
      return dark ? '#f3fff8' : '#146b45';
    }
    return dark ? '#fff4c8' : '#7a5c0a';
  }

  function badgeTitleForLabel(text) {
    if (text === 'Pro') return '高级会员尊享';
    if (text === '会员') return '会员免费';
    return text || '';
  }

  /** 细描边（行内短标用）；勿写 text-shadow spread（非法会被整条丢弃） */
  function badgeStrokeShadow(surface) {
    if (surface === 'dark') {
      return (
        '-0.7px -0.7px 0 rgba(0,0,0,0.9),0.7px -0.7px 0 rgba(0,0,0,0.9),' +
        '-0.7px 0.7px 0 rgba(0,0,0,0.9),0.7px 0.7px 0 rgba(0,0,0,0.9),' +
        '0 1px 2px rgba(0,0,0,0.45)'
      );
    }
    return (
      '-0.55px -0.55px 0 #fff,0.55px -0.55px 0 #fff,' +
      '-0.55px 0.55px 0 #fff,0.55px 0.55px 0 #fff,' +
      '0 0.5px 1.5px rgba(50,46,40,0.18)'
    );
  }

  /** 按钮叠标：半透明低饱和底 + 白字（类 NEW，不旋转；宁淡勿厚） */
  function stickerFillCss(require) {
    var isUser = normalizeRequire(require) === 'user';
    // 会员灰绿 / Pro 暖金；再透一档（约 0.5），避免厚价签感
    var bg = isUser ? 'rgba(48, 82, 66, 0.5)' : 'rgba(120, 94, 40, 0.5)';
    var border = isUser ? 'rgba(255,255,255,0.38)' : 'rgba(255,255,255,0.4)';
    return {
      bg: bg,
      border: border,
      color: '#fffef8'
    };
  }

  /**
   * 描边短标 / 叠标
   * place: tr|br|inline|sticker
   * sticker/tr：右上角可探出的小色底标签；inline：Solid 行内仍用描边字
   */
  function outlineBadgeCss(require, place, opts) {
    var surface = (opts && opts.surface) || (place === 'inline' ? 'dark' : 'light');
    var compact = !!(opts && opts.compact);
    if (place === 'inline') {
      var color = badgeInk(require, surface);
      var thin = badgeStrokeShadow(surface);
      return (
        'position:static;display:inline;margin:0 0 0 4px;padding:0;border:none;border-radius:0;' +
        'background:transparent !important;vertical-align:baseline;' +
        'font-size:10px;line-height:1.15;font-weight:600;letter-spacing:0.06em;' +
        'font-family:inherit;color:' + color + ';' +
        'text-shadow:' + thin + ';' +
        'pointer-events:none;white-space:nowrap;flex:none;box-shadow:none;'
      );
    }
    if (place === 'sticker' || place === 'tr') {
      var fill = stickerFillCss(require);
      var size = compact ? '9px' : '10px';
      var pad = compact ? '1px 5px' : '2px 6px';
      // inset：略探出；insetStrict：完全角内（晓阶 app-shell 防裁切）
      // floatOut / compact：往右上外侧探，避免压住 checkbox 本体
      var inset = !!(opts && opts.inset) || compact;
      var top = inset ? (compact ? '-6px' : '-4px') : '-7px';
      var right = inset ? (compact ? '-10px' : '-4px') : '-6px';
      if (opts && opts.insetStrict) {
        top = compact ? '2px' : '3px';
        right = compact ? '2px' : '4px';
      }
      if (opts && opts.floatOut) {
        top = '-10px';
        right = '-14px';
      }
      if (compact) {
        size = '8px';
        pad = '1px 4px';
      }
      return (
        'position:absolute;right:' + right + ';top:' + top + ';left:auto;bottom:auto;z-index:8;' +
        'font-size:' + size + ';line-height:1.15;font-weight:600;letter-spacing:0.04em;' +
        'font-family:inherit;padding:' + pad + ';margin:0;' +
        'border:1px solid ' + fill.border + ';border-radius:3px;' +
        'background:' + fill.bg + ' !important;' +
        'color:' + fill.color + ';' +
        '-webkit-text-stroke:0;text-shadow:0 0.5px 1px rgba(0,0,0,0.22);' +
        'box-shadow:0 1px 2px rgba(0,0,0,0.1);' +
        'pointer-events:none;white-space:nowrap;transform:none;'
      );
    }
    var pos = 'right:8px;bottom:6px;left:auto;top:auto;';
    var ink = badgeInk(require, surface);
    var shadow = badgeStrokeShadow(surface);
    return (
      'position:absolute;' + pos + 'z-index:6;' +
      'font-size:10px;line-height:1;font-weight:600;letter-spacing:0.1em;' +
      'font-family:inherit;padding:0;margin:0;border:none;border-radius:0;' +
      'background:transparent !important;box-shadow:none;' +
      'color:' + ink + ';' +
      'text-shadow:' + shadow + ';' +
      'pointer-events:none;white-space:nowrap;transform:none;'
    );
  }

  /** PC 宽屏课表丝带略放大；移动端保持原尺寸（特性检测，不用 UA） */
  function ribbonScalePc() {
    try {
      return !!(global.matchMedia && global.matchMedia('(min-width: 900px)').matches);
    } catch (_e) {
      return false;
    }
  }

  /** Solid / Portrait 课表：角内裁切盒 + 斜角丝带 */
  function attachLockRibbon(hostEl, text, require) {
    if (!hostEl) return null;
    var req = normalizeRequire(require);
    var isUser = req === 'user';
    // 会员字色贴灰绿底、再降对比，勿近白抢眼，不得盖过 Pro 暖金
    var ink = isUser ? 'rgba(152, 176, 162, 0.78)' : badgeInk(req, 'dark');
    var ribbonBg = isUser ? 'rgba(36, 48, 40, 0.82)' : 'rgba(52, 44, 28, 0.86)';
    var pc = ribbonScalePc();
    var box = pc ? 64 : 48;
    var stripW = pc ? 86 : 68;
    var stripRight = pc ? -26 : -20;
    var stripBottom = pc ? 10 : 8;
    var fontPx = pc ? 10 : 8;
    var badge = hostEl.querySelector('.membership-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'membership-badge';
      try {
        if (getComputedStyle(hostEl).position === 'static') hostEl.style.position = 'relative';
      } catch (_ePos) {}
      hostEl.appendChild(badge);
    } else if (badge.parentElement !== hostEl) {
      try { hostEl.appendChild(badge); } catch (_eRe) {}
    }
    badge.style.cssText =
      'position:absolute;right:0;bottom:0;left:auto;top:auto;z-index:3;' +
      'width:' + box + 'px;height:' + box + 'px;padding:0;margin:0;border:none;border-radius:0;' +
      'background:transparent;overflow:hidden;pointer-events:none;box-shadow:none;';
    var strip = badge.querySelector('.membership-badge-strip');
    if (!strip) {
      strip = document.createElement('span');
      strip.className = 'membership-badge-strip';
      badge.appendChild(strip);
    }
    strip.style.cssText =
      'position:absolute;right:' + stripRight + 'px;bottom:' + stripBottom + 'px;left:auto;top:auto;' +
      'width:' + stripW + 'px;padding:2px 0;text-align:center;' +
      'font-size:' + fontPx + 'px;line-height:1.15;font-weight:500;letter-spacing:0.04em;' +
      'color:' + ink + ';background:' + ribbonBg + ';' +
      'border:none;border-radius:0;box-shadow:none;' +
      'transform:rotate(-45deg);transform-origin:center center;' +
      'pointer-events:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    strip.textContent = text || '';
    badge.title = badgeTitleForLabel(text);
    return badge;
  }

  /** 涂色模式短标签：游客 / 会员 / 高级 */
  function paintLabelForRequire(require) {
    var req = normalizeRequire(require);
    if (req === 'user') return '会员';
    if (req === 'member') return '高级';
    return '游客';
  }

  /** 点一下轮换：游客 → 会员 → 高级 → 游客 */
  function nextRequireCycle(require) {
    var req = normalizeRequire(require);
    if (req === 'public') return 'user';
    if (req === 'user') return 'member';
    return 'public';
  }

  function setLocalPolicy(pol) {
    if (!pol || typeof pol !== 'object') return _policy;
    _policy = pol;
    notify();
    return _policy;
  }

  function adminCheckSession() {
    return fetch('/api/membership/admin/overview', {
      credentials: 'same-origin',
      cache: 'no-cache'
    }).then(function (r) {
      return r.json().then(function (data) {
        return { ok: !!(r.ok && data && data.ok), status: r.status, data: data, needLogin: !!(data && data.needLogin) };
      }).catch(function () {
        return { ok: false, status: r.status, data: null, needLogin: r.status === 401 };
      });
    }).catch(function (e) {
      return { ok: false, status: 0, data: null, error: String(e && e.message || e) };
    });
  }

  /** 运营涂色：改单条资源档位（需已登录运营台 Cookie） */
  function adminSetResourceRequire(resourceId, require, label) {
    var id = String(resourceId || '').trim();
    if (!id) return Promise.reject(new Error('缺少资源 id'));
    var req = normalizeRequire(require);
    return fetch('/api/membership/admin/policy', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ set: { id: id, require: req, label: label || id } })
    }).then(function (r) {
      return r.json().then(function (data) {
        if (!r.ok || !data || !data.ok) {
          var err = new Error((data && data.error) || ('HTTP ' + r.status));
          err.status = r.status;
          err.needLogin = !!(data && data.needLogin);
          err.data = data;
          throw err;
        }
        if (data.policy) setLocalPolicy(data.policy);
        return data;
      });
    });
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
      fetchJson(PUBLIC_CONFIG).then(function (cfg) {
        if (cfg && cfg.policy) _policy = cfg.policy;
        if (cfg && cfg.tiers) _tiers = cfg.tiers;
      }).catch(function () {
        return Promise.all([
          fetchJson(POLICY_URL).then(function (p) { _policy = p; }),
          fetchJson(TIERS_URL).then(function (t) { _tiers = t; })
        ]);
      }).catch(function () {
        if (!_policy) _policy = { version: 0, resources: {}, defaultRequire: 'public' };
        if (!_tiers) _tiers = { tiers: [] };
      }),
      refreshFromServer().catch(function () { /* 无 API 时保留本地缓存（仅本地开发） */ })
    ]).then(function () { return api; });
    return _ready;
  }

  function capturePromoRefFromUrl() {
    try {
      var u = new URL(global.location.href);
      var ref = String(u.searchParams.get('ref') || '').trim().toUpperCase();
      if (ref && /^[A-Z0-9]{6,12}$/.test(ref)) {
        global.localStorage.setItem(PROMO_REF_KEY, ref);
      }
    } catch (_e) {}
  }

  function getStoredPromoRef() {
    try {
      return String(global.localStorage.getItem(PROMO_REF_KEY) || '').trim().toUpperCase();
    } catch (_e2) {
      return '';
    }
  }

  function getPromoInfo() {
    return _promoInfo;
  }

  function refreshFromServer() {
    capturePromoRefFromUrl();
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
      if (data.promoUrl || data.promoCode || data.referral) {
        _promoInfo = {
          promoUrl: data.promoUrl || null,
          promoCode: data.promoCode || null,
          referral: data.referral || null,
          referralStats: data.referralStats || null
        };
      } else if (!(data.accessLevel === 'user' || data.accessLevel === 'member')) {
        _promoInfo = null;
      }
      return data;
    });
  }

  function ruleFor(resourceId) {
    var pol = _policy || { resources: {}, defaultRequire: 'public' };
    var res = (pol.resources && pol.resources[resourceId]) || null;
    if (!res || res.enabled === false) {
      return {
        require: normalizeRequire(pol.defaultRequire || 'public'),
        enabled: false,
        resourceId: resourceId
      };
    }
    return {
      require: normalizeRequire(res.require || pol.defaultRequire || 'public'),
      enabled: true,
      probe: !!res.probe,
      label: res.label || resourceId,
      resourceId: resourceId
    };
  }

  function canAccess(resourceId) {
    var rule = ruleFor(resourceId);
    var ent = getEntitlement();
    var level = getAccessLevel();
    if (!rule.enabled || normalizeRequire(rule.require) === 'public') {
      return { ok: true, reason: 'public', rule: rule, entitlement: ent, accessLevel: level };
    }
    if (meetsRequire(rule.require)) {
      return { ok: true, reason: rule.require, rule: rule, entitlement: ent, accessLevel: level };
    }
    var need = normalizeRequire(rule.require);
    return {
      ok: false,
      reason: need === 'user' ? 'need_user' : 'need_member',
      needLevel: need,
      rule: rule,
      entitlement: ent,
      accessLevel: level
    };
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

  /** Solid 控制面板模块（环境光 / 空气透视 / 景深 / 色阶概括），非 Tab 按钮 */
  function modResourceId(modKey) {
    return 'ui:solid:mod:' + String(modKey || '');
  }

  function featureResourceId(page, key) {
    return 'feature:' + String(page || '') + ':' + String(key || '');
  }

  function uiResourceId(page, key) {
    return 'ui:' + String(page || '') + ':' + String(key || '');
  }

  function currentSandbox() {
    try {
      var u = new URL(global.location.href);
      return (u.searchParams.get('sandbox') || 'geometry').toLowerCase();
    } catch (_e) {
      return 'geometry';
    }
  }

  function catalogUrl(sandbox, opts) {
    var o = opts || {};
    var q = '?sandbox=' + encodeURIComponent(sandbox || currentSandbox());
    if (o.thumbs) {
      q += '&thumbs=1';
      if (o.offset != null) q += '&offset=' + encodeURIComponent(String(o.offset));
      if (o.limit != null) q += '&limit=' + encodeURIComponent(String(o.limit));
    }
    return API_CATALOG + q;
  }

  function sceneUrl(sandbox, nameOrOpts) {
    var o = (nameOrOpts && typeof nameOrOpts === 'object')
      ? nameOrOpts
      : { name: nameOrOpts };
    var q = '?sandbox=' + encodeURIComponent(sandbox || currentSandbox());
    if (o.uid) q += '&uid=' + encodeURIComponent(String(o.uid));
    if (o.id) q += '&id=' + encodeURIComponent(String(o.id));
    if (o.name) q += '&name=' + encodeURIComponent(String(o.name));
    return API_SCENE + q;
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
    return list.map(function (sc) {
      var rid = sceneResourceId(sandbox, sc);
      if (!rid) return sc;
      var gate = canAccess(rid);
      if (!gate.ok) {
        var stripped = stripScenePayload(sc);
        if (stripped && stripped.meta) stripped.meta.require = gate.needLevel || (gate.rule && gate.rule.require);
        stripped.__require = gate.needLevel || (gate.rule && gate.rule.require);
        return stripped;
      }
      return sc;
    });
  }

  function fetchCatalog(sandbox) {
    var sb = sandbox || currentSandbox();
    // 列表轻量（无 dataURL 缩略图 / 无 items），避免首屏卡在「获取场景配置」数十秒
    // Solid 启动脚本可能已并行预取同一 sandbox 的课表，优先复用，省一轮等待
    var pref = null;
    try {
      if (global.__solidCatalogPrefetch && global.__solidBootSandbox === sb) {
        pref = global.__solidCatalogPrefetch;
        global.__solidCatalogPrefetch = null;
      }
    } catch (_ePref) { pref = null; }
    var network = pref
      ? Promise.resolve(pref).then(function (data) {
          if (data && data.ok && Array.isArray(data.scenes)) return data;
          return fetchJson(catalogUrl(sb));
        }).catch(function () { return fetchJson(catalogUrl(sb)); })
      : fetchJson(catalogUrl(sb));
    return network.then(function (data) {
      if (data && data.ok && Array.isArray(data.scenes)) {
        if (data.entitlement) saveEntitlement(data.entitlement);
        return data.scenes;
      }
      throw new Error('catalog_invalid');
    }).catch(function (err) {
      if (!isLocalHost()) {
        throw new Error('课表安全接口不可用，请稍后重试（生产环境不回退公开全文）');
      }
      var staticMap = {
        geometry: '/docs/json/沙盒_几何体静物/沙盒_几何体静物.json',
        portrait: '/docs/json/沙盒_肖像光影沙盒/沙盒_肖像光影沙盒.json',
        headform: '/docs/json/沙盒_头部造型规律/沙盒_头部造型规律.json'
      };
      var url = staticMap[sb] || staticMap.geometry;
      return fetchJson(url).then(function (raw) {
        var arr = Array.isArray(raw) ? raw : [raw];
        return filterScenesClientSide(arr, sb).map(function (sc) {
          if (!sc || typeof sc !== 'object') return sc;
          // 本地回退也按列表卡裁剪，行为与线上一致
          var locked = !!sc.__membershipLocked || !!(sc.meta && sc.meta.locked);
          // 锁课档位必须带到列表卡：否则点进弹窗会默认成高级会员文案
          var needReq =
            sc.__require ||
            (sc.meta && sc.meta.require) ||
            null;
          var card = {
            name: sc.name,
            thumbnail: '',
            meta: sc.meta
              ? {
                  category: sc.meta.category,
                  detail: sc.meta.detail,
                  description: sc.meta.description,
                  line: sc.meta.line,
                  slot: sc.meta.slot,
                  lessonTabLabel: sc.meta.lessonTabLabel,
                  modelLabel: sc.meta.modelLabel,
                  modelId: sc.meta.modelId,
                  material: sc.meta.material,
                  gender: sc.meta.gender,
                  age: sc.meta.age,
                  region: sc.meta.region,
                  locked: locked ? true : sc.meta.locked,
                  require: needReq || sc.meta.require
                }
              : (locked
                ? { locked: true, require: needReq || undefined }
                : {}),
            __listOnly: true,
            __membershipLocked: locked ? true : undefined,
            __require: needReq || undefined
          };
          if (sc.uid != null && String(sc.uid).trim() !== '') card.uid = String(sc.uid).trim();
          if (sc.id != null && String(sc.id).trim() !== '') card.id = String(sc.id).trim();
          return card;
        });
      });
    });
  }

  var _localThumbSceneCache = Object.create(null);

  function localCatalogStaticUrl(sandbox) {
    var map = {
      geometry: '/docs/json/沙盒_几何体静物/沙盒_几何体静物.json',
      portrait: '/docs/json/沙盒_肖像光影沙盒/沙盒_肖像光影沙盒.json',
      headform: '/docs/json/沙盒_头部造型规律/沙盒_头部造型规律.json'
    };
    return map[sandbox] || map.geometry;
  }

  function sliceLocalThumbBatch(arr, offset, limit) {
    var start = Math.max(0, Number(offset) || 0);
    var lim = Math.max(1, Math.min(24, Number(limit) || 10));
    var end = Math.min(arr.length, start + lim);
    var items = [];
    for (var i = start; i < end; i++) {
      var s = arr[i];
      if (!s) continue;
      var m = (s && s.meta) || {};
      var row = {
        index: i,
        name: s && s.name,
        thumbnail: s && s.thumbnail != null ? String(s.thumbnail) : '',
        modelId: m.modelId != null ? String(m.modelId) : '',
        slot: m.slot != null ? String(m.slot) : '',
        line: m.line != null ? String(m.line) : ''
      };
      if (s.uid != null && String(s.uid).trim() !== '') row.uid = String(s.uid).trim();
      if (s.id != null && String(s.id).trim() !== '') row.id = String(s.id).trim();
      items.push(row);
    }
    return {
      items: items,
      nextOffset: end,
      done: end >= arr.length,
      total: arr.length
    };
  }

  /** localhost 无 Functions：从静态全文按批切缩略图（与线上 thumbs 批接口对齐） */
  function fetchLocalCatalogThumbsBatch(sandbox, offset, limit) {
    var sb = sandbox || currentSandbox();
    if (_localThumbSceneCache[sb]) {
      return Promise.resolve(sliceLocalThumbBatch(_localThumbSceneCache[sb], offset, limit));
    }
    return fetchJson(localCatalogStaticUrl(sb)).then(function (raw) {
      var arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
      _localThumbSceneCache[sb] = arr;
      return sliceLocalThumbBatch(arr, offset, limit);
    });
  }

  /** 单批缩略图（渐进补全用） */
  function fetchCatalogThumbsBatch(sandbox, offset, limit) {
    var sb = sandbox || currentSandbox();
    return fetchJson(catalogUrl(sb, {
      thumbs: true,
      offset: offset == null ? 0 : offset,
      limit: limit == null ? 10 : limit
    })).then(function (data) {
      if (data && data.ok && Array.isArray(data.items)) {
        return {
          items: data.items,
          nextOffset: data.nextOffset,
          done: !!data.done,
          total: data.total
        };
      }
      // 兼容旧版一次性全文 thumbs
      if (data && data.ok && Array.isArray(data.scenes)) {
        return {
          items: data.scenes.map(function (s, i) {
            var m = (s && s.meta) || {};
            return {
              index: i,
              name: s && s.name,
              thumbnail: s && s.thumbnail,
              modelId: m.modelId != null ? String(m.modelId) : '',
              slot: m.slot != null ? String(m.slot) : '',
              line: m.line != null ? String(m.line) : ''
            };
          }),
          nextOffset: data.scenes.length,
          done: true,
          total: data.scenes.length
        };
      }
      throw new Error('catalog_thumbs_invalid');
    }).catch(function (err) {
      if (!isLocalHost()) throw err;
      return fetchLocalCatalogThumbsBatch(sb, offset, limit);
    });
  }

  /**
   * 分批拉取缩略图；每批回调 onBatch(items)，便于 UI 逐批上屏。
   * 缩略图为小 dataURL（约 3KB），慢主要来自「按课表顺序串行分批」而非单张过大。
   * 批略加大、批间让出约 20ms：加快后半段上屏，仍避免与进课/滚动抢主线程。
   */
  function hydrateCatalogThumbs(sandbox, onBatch) {
    var sb = sandbox || currentSandbox();
    var offset = 0;
    var first = true;
    var cancelled = false;

    function step() {
      if (cancelled) return Promise.resolve();
      // 首批略小保证尽快出图；后续加大以减少肖像长课表的串行轮数
      var limit = first ? 8 : 16;
      first = false;
      return fetchCatalogThumbsBatch(sb, offset, limit).then(function (batch) {
        if (cancelled) return;
        if (typeof onBatch === 'function') {
          try { onBatch(batch.items || []); } catch (_e) {}
        }
        if (batch.done) return;
        offset = batch.nextOffset != null ? batch.nextOffset : offset + (batch.items ? batch.items.length : 0);
        // 让出主线程，方便浏览器先画上本批图、响应进课点击
        return new Promise(function (resolve) {
          setTimeout(function () { resolve(step()); }, 20);
        });
      });
    }

    var p = step().catch(function () { /* 缩略图失败不影响列表 */ });
    p.cancel = function () { cancelled = true; };
    return p;
  }

  /** @deprecated 请用 hydrateCatalogThumbs；保留以免旧调用断裂 */
  function fetchCatalogThumbs(sandbox) {
    var all = [];
    return hydrateCatalogThumbs(sandbox, function (items) {
      for (var i = 0; i < items.length; i++) all.push(items[i]);
    }).then(function () { return all; });
  }

  /** 进课：拉取单课全文（优先 uid / id，名称兜底） */
  function fetchScene(sandbox, nameOrOpts) {
    var sb = sandbox || currentSandbox();
    var o = (nameOrOpts && typeof nameOrOpts === 'object')
      ? nameOrOpts
      : { name: nameOrOpts };
    var wantUid = String(o.uid || '').trim();
    var wantId = String(o.id || '').trim();
    var n = String(o.name || '').trim();
    if (!wantUid && !wantId && !n) return Promise.reject(new Error('缺少场景标识'));
    return fetchJson(sceneUrl(sb, { uid: wantUid, id: wantId, name: n })).then(function (data) {
      if (data && data.ok && data.scene) {
        if (data.locked || data.scene.__membershipLocked) {
          var need = data.require || (data.scene.meta && data.scene.meta.require) || 'member';
          var err = new Error(need === 'user' ? 'need_user' : 'need_member');
          err.locked = true;
          err.needLevel = need;
          err.scene = data.scene;
          throw err;
        }
        return data.scene;
      }
      throw new Error((data && data.error) || '场景加载失败');
    }).catch(function (err) {
      if (err && err.locked) throw err;
      if (!isLocalHost()) throw err;
      // localhost 无 Functions 时从静态全文里找
      var staticMap = {
        geometry: '/docs/json/沙盒_几何体静物/沙盒_几何体静物.json',
        portrait: '/docs/json/沙盒_肖像光影沙盒/沙盒_肖像光影沙盒.json',
        headform: '/docs/json/沙盒_头部造型规律/沙盒_头部造型规律.json'
      };
      return fetchJson(staticMap[sb] || staticMap.geometry).then(function (raw) {
        var arr = Array.isArray(raw) ? raw : raw ? [raw] : [];
        var hit = null;
        if (wantUid) hit = arr.find(function (s) { return s && String(s.uid || '').trim() === wantUid; }) || null;
        if (!hit && wantId) hit = arr.find(function (s) { return s && String(s.id || '').trim() === wantId; }) || null;
        if (!hit && n) hit = arr.find(function (s) { return s && String(s.name || '').trim() === n; }) || null;
        if (!hit) throw new Error('场景不存在');
        var filtered = filterScenesClientSide([hit], sb)[0];
        if (filtered && filtered.__membershipLocked) {
          var need2 = filtered.__require || (filtered.meta && filtered.meta.require) || 'member';
          var e2 = new Error(need2 === 'user' ? 'need_user' : 'need_member');
          e2.locked = true;
          e2.needLevel = need2;
          e2.scene = filtered;
          throw e2;
        }
        return filtered || hit;
      });
    });
  }

  function redeem(code) {
    return postJson(API_REDEEM, {
      code: String(code || '').trim(),
      deviceId: getDeviceId()
    }).then(function (res) {
      var r = res.r;
      var data = res.data;
      if (r.status === 404) {
        throw new Error(isLocalHost()
          ? '当前是静态本地预览，没有兑换后台。请用测试站或正式站兑换。'
          : '兑换服务未部署，请稍后重试');
      }
      if (!r.ok || !data || !data.ok) {
        throw new Error((data && data.error) || ('兑换失败 HTTP ' + r.status));
      }
      saveEntitlement(Object.assign({}, data.entitlement, { source: 'server' }));
      return data;
    });
  }

  function registerAccount(opts) {
    var o = opts || {};
    capturePromoRefFromUrl();
    return postJson(API_REGISTER, {
      phone: o.phone,
      password: o.password,
      wechatNote: o.wechatNote || '',
      deviceId: getDeviceId(),
      deviceLabel: o.deviceLabel || guessDeviceLabel(),
      ref: o.ref || getStoredPromoRef() || undefined
    }).then(function (res) {
      if (!res.r.ok || !res.data || !res.data.ok) {
        throw new Error((res.data && res.data.error) || '注册失败');
      }
      saveEntitlement(Object.assign({}, res.data.entitlement, { source: 'account' }));
      return refreshFromServer().then(function () { return res.data; });
    });
  }

  function loginAccount(opts) {
    var o = opts || {};
    capturePromoRefFromUrl();
    return postJson(API_LOGIN, {
      phone: o.phone,
      password: o.password,
      wechatNote: o.wechatNote || '',
      deviceId: getDeviceId(),
      deviceLabel: o.deviceLabel || guessDeviceLabel(),
      ref: o.ref || getStoredPromoRef() || undefined
    }).then(function (res) {
      if (!res.r.ok || !res.data || !res.data.ok) {
        throw new Error((res.data && res.data.error) || '登录失败');
      }
      saveEntitlement(Object.assign({}, res.data.entitlement, { source: 'account' }));
      return refreshFromServer().then(function () { return res.data; });
    });
  }

  function fetchDevices() {
    return fetch(API_DEVICES, { credentials: 'same-origin' }).then(function (r) {
      return r.json().then(function (data) {
        if (!r.ok || !data || !data.ok) {
          throw new Error((data && data.error) || '无法读取设备列表');
        }
        return data.account;
      });
    });
  }

  function removeDevice(deviceId) {
    return fetch(API_DEVICES, {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceId: deviceId })
    }).then(function (r) {
      return r.json().then(function (data) {
        if (!r.ok || !data || !data.ok) {
          throw new Error((data && data.error) || '移除失败');
        }
        if (data.entitlement) saveEntitlement(data.entitlement);
        return data;
      });
    });
  }

  function guessDeviceLabel() {
    try {
      var ua = navigator.userAgent || '';
      if (/iPhone|iPad/i.test(ua)) return '苹果设备';
      if (/Android/i.test(ua)) return '安卓设备';
      if (/Windows/i.test(ua)) return 'Windows 电脑';
      if (/Mac/i.test(ua)) return 'Mac';
      return '浏览器';
    } catch (_e) {
      return '设备';
    }
  }

  function clearEntitlement() {
    saveEntitlement({ tierId: 'free', level: 'guest', expiresAt: null, source: 'cleared' });
    return fetch(API_ME, { method: 'DELETE', credentials: 'same-origin' }).catch(function () {
      return null;
    });
  }

  function memberPageUrl(hashOrQuery) {
    var s = String(hashOrQuery || '');
    if (s.charAt(0) === '#') return '/member' + s;
    if (s.charAt(0) === '?') return '/member' + s;
    if (s.indexOf('=') >= 0 || s.indexOf('&') >= 0) return '/member?' + s;
    if (s) return '/member#' + s.replace(/^#/, '');
    return '/member';
  }

  var _upgradePromptAt = 0;
  var _upgradeModalEl = null;

  function ensureUpgradeModal() {
    if (_upgradeModalEl && _upgradeModalEl.isConnected) return _upgradeModalEl;
    var root = global.document && global.document.body;
    if (!root) return null;
    var wrap = global.document.createElement('div');
    wrap.id = 'membership-upgrade-modal';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.style.cssText = [
      'display:none',
      'position:fixed',
      'inset:0',
      'z-index:12000',
      'align-items:center',
      'justify-content:center',
      'padding:max(20px, env(safe-area-inset-top)) 20px max(20px, env(safe-area-inset-bottom))',
      'box-sizing:border-box',
      'background:rgba(6,8,12,0.62)',
      'backdrop-filter:blur(10px)',
      '-webkit-backdrop-filter:blur(10px)'
    ].join(';');
    wrap.innerHTML =
      '<div class="mu-card" style="' +
        'width:min(400px,100%);' +
        'border-radius:16px;' +
        'border:1px solid rgba(255,255,255,0.12);' +
        'background:linear-gradient(165deg,rgba(36,40,48,0.96),rgba(18,20,26,0.98));' +
        'box-shadow:0 24px 64px rgba(0,0,0,0.45);' +
        'padding:22px 22px 18px;' +
        'color:#f3f1ec;' +
        'font-family:\"Microsoft YaHei\",\"PingFang SC\",sans-serif;' +
      '">' +
        '<div class="mu-eyebrow" style="font-size:11px;letter-spacing:0.12em;color:rgba(245,215,110,0.9);margin-bottom:8px">会员内容</div>' +
        '<div class="mu-title" style="font-size:1.15rem;font-weight:600;line-height:1.35;margin:0 0 8px"></div>' +
        '<p class="mu-body" style="margin:0 0 18px;font-size:0.92rem;line-height:1.55;color:rgba(243,241,236,0.72)"></p>' +
        '<div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap">' +
          '<button type="button" class="mu-cancel" style="' +
            'font:inherit;min-width:96px;padding:10px 16px;border-radius:10px;cursor:pointer;' +
            'background:transparent;color:rgba(243,241,236,0.88);border:1px solid rgba(255,255,255,0.18)' +
          '">稍后再说</button>' +
          '<button type="button" class="mu-ok" style="' +
            'font:inherit;min-width:120px;padding:10px 16px;border-radius:10px;cursor:pointer;' +
            'background:#f5d76e;color:#1a160c;border:none;font-weight:600' +
          '">前往开通</button>' +
        '</div>' +
      '</div>';
    root.appendChild(wrap);
    _upgradeModalEl = wrap;
    return wrap;
  }

  function hideUpgradeModal() {
    if (_upgradeModalEl) _upgradeModalEl.style.display = 'none';
  }

  function promptUpgrade(detail) {
    var now = Date.now();
    // 弹窗已开 / 短窗连点：只保留一次；勿因 debounce 导致「只闪一下没框」
    try {
      if (_upgradeModalEl && _upgradeModalEl.isConnected &&
          global.getComputedStyle(_upgradeModalEl).display === 'flex') {
        return;
      }
    } catch (_eOpen) {}
    if (now - _upgradePromptAt < 450) return;
    _upgradePromptAt = now;

    var need = normalizeRequire(
      (detail && detail.needLevel) ||
      (detail && detail.rule && detail.rule.require) ||
      (detail && detail.reason === 'need_user' ? 'user' : 'member')
    );
    var label = (detail && detail.rule && detail.rule.label) ? String(detail.rule.label) : '';
    var nameHint = (detail && detail.sceneName) ? String(detail.sceneName) : '';
    var subject = label || nameHint || '此内容';
    var onDismiss = detail && typeof detail.onDismiss === 'function' ? detail.onDismiss : null;
    var title;
    var body;
    var okText;
    var hash;
    if (need === 'user') {
      title = '「' + subject + '」会员免费';
      body = '注册成为会员后即可免费使用。注册免费，还可多设备同步登录。';
      okText = '去注册';
      hash = 'account';
    } else {
      title = '「' + subject + '」高级会员尊享';
      body = '开通高级会员后可学习此类场景与功能。请先登录会员账号再兑换，权益可同步到其它设备。';
      okText = '查看权益与兑换';
      hash = 'benefits';
    }

    function goMember() {
      var ret = '';
      try { ret = encodeURIComponent(global.location.pathname + global.location.search); } catch (_e) {}
      var q = ret ? ('?return=' + ret) : '';
      global.location.href = '/member' + q + '#' + hash;
    }

    function fireDismiss() {
      if (!onDismiss) return;
      try { onDismiss(); } catch (_eD) {}
      onDismiss = null;
    }

    try {
      var modal = ensureUpgradeModal();
      if (!modal) {
        // confirm 取消也要回课表；延后到下一任务，避免与列表同一次手势抢点
        global.setTimeout(function () {
          var ok = false;
          try { ok = !!global.confirm(title + ' 前往会员页？'); } catch (_eC) { ok = false; }
          if (ok) goMember();
          else fireDismiss();
        }, 0);
        return;
      }
      var eye = modal.querySelector('.mu-eyebrow');
      if (eye) eye.textContent = need === 'user' ? '会员免费' : '高级会员尊享';
      modal.querySelector('.mu-title').textContent = title;
      modal.querySelector('.mu-body').textContent = body;
      var okBtn = modal.querySelector('.mu-ok');
      var cancelBtn = modal.querySelector('.mu-cancel');
      okBtn.textContent = okText;
      // 挡住同一指/鼠标抬起误点「前往开通」，避免未确认就跳会员页
      modal.style.pointerEvents = 'none';
      okBtn.style.pointerEvents = 'none';
      cancelBtn.style.pointerEvents = 'none';
      modal.style.display = 'flex';

      var armed = false;
      var armTimer = null;
      function onOk(e) {
        if (!armed) {
          try { if (e) { e.preventDefault(); e.stopPropagation(); } } catch (_e) {}
          return;
        }
        cleanup(false);
        goMember();
      }
      function onCancel(e) {
        if (!armed) {
          try { if (e) { e.preventDefault(); e.stopPropagation(); } } catch (_e) {}
          return;
        }
        cleanup(true);
      }
      function onBackdrop(e) {
        if (!armed) return;
        if (e.target === modal) cleanup(true);
      }
      function onKey(e) { if (armed && e.key === 'Escape') cleanup(true); }
      function cleanup(dismissed) {
        if (armTimer) {
          try { global.clearTimeout(armTimer); } catch (_eT) {}
          armTimer = null;
        }
        hideUpgradeModal();
        modal.style.pointerEvents = '';
        okBtn.style.pointerEvents = '';
        cancelBtn.style.pointerEvents = '';
        okBtn.removeEventListener('click', onOk, true);
        cancelBtn.removeEventListener('click', onCancel, true);
        modal.removeEventListener('click', onBackdrop);
        global.document.removeEventListener('keydown', onKey);
        if (dismissed) fireDismiss();
      }
      okBtn.addEventListener('click', onOk, true);
      cancelBtn.addEventListener('click', onCancel, true);
      modal.addEventListener('click', onBackdrop);
      global.document.addEventListener('keydown', onKey);
      armTimer = global.setTimeout(function () {
        armed = true;
        modal.style.pointerEvents = '';
        okBtn.style.pointerEvents = '';
        cancelBtn.style.pointerEvents = '';
        armTimer = null;
      }, 420);
    } catch (_e2) {
      try {
        global.setTimeout(function () {
          try {
            if (global.confirm(title + ' 前往会员页？')) goMember();
            else fireDismiss();
          } catch (_e3) {
            fireDismiss();
          }
        }, 0);
      } catch (_e4) {
        fireDismiss();
      }
    }
  }

  var api = {
    ready: ensureReady,
    canAccess: canAccess,
    ruleFor: ruleFor,
    getEntitlement: getEntitlement,
    getAccessLevel: getAccessLevel,
    meetsRequire: meetsRequire,
    normalizeRequire: normalizeRequire,
    badgeLabelForRequire: badgeLabelForRequire,
    badgeTitleForLabel: badgeTitleForLabel,
    outlineBadgeCss: outlineBadgeCss,
    attachLockRibbon: attachLockRibbon,
    paintLabelForRequire: paintLabelForRequire,
    nextRequireCycle: nextRequireCycle,
    setLocalPolicy: setLocalPolicy,
    adminCheckSession: adminCheckSession,
    adminSetResourceRequire: adminSetResourceRequire,
    isMemberActive: isMemberActive,
    redeem: redeem,
    clearEntitlement: clearEntitlement,
    getDeviceId: getDeviceId,
    registerAccount: registerAccount,
    loginAccount: loginAccount,
    fetchDevices: fetchDevices,
    removeDevice: removeDevice,
    refreshFromServer: refreshFromServer,
    capturePromoRefFromUrl: capturePromoRefFromUrl,
    getStoredPromoRef: getStoredPromoRef,
    getPromoInfo: getPromoInfo,
    fetchCatalog: fetchCatalog,
    fetchCatalogThumbs: fetchCatalogThumbs,
    fetchCatalogThumbsBatch: fetchCatalogThumbsBatch,
    hydrateCatalogThumbs: hydrateCatalogThumbs,
    fetchScene: fetchScene,
    catalogUrl: catalogUrl,
    sceneUrl: sceneUrl,
    filterScenesClientSide: filterScenesClientSide,
    sceneResourceId: sceneResourceId,
    tabResourceId: tabResourceId,
    modResourceId: modResourceId,
    featureResourceId: featureResourceId,
    uiResourceId: uiResourceId,
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
