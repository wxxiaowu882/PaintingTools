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
      fetchJson(PUBLIC_CONFIG).then(function (cfg) {
        if (cfg && cfg.policy) _policy = cfg.policy;
        if (cfg && cfg.tiers) _tiers = cfg.tiers;
      }).catch(function () {
        return Promise.all([
          fetchJson(POLICY_URL).then(function (p) { _policy = p; }),
          fetchJson(TIERS_URL).then(function (t) { _tiers = t; })
        ]);
      }).catch(function () {
        if (!_policy) _policy = { version: 0, resources: {}, defaultRequire: 'free' };
        if (!_tiers) _tiers = { tiers: [] };
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

  function sceneUrl(sandbox, name) {
    return API_SCENE
      + '?sandbox=' + encodeURIComponent(sandbox || currentSandbox())
      + '&name=' + encodeURIComponent(name || '');
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
          return {
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
                  locked: locked ? true : sc.meta.locked
                }
              : (locked ? { locked: true } : {}),
            __listOnly: true,
            __membershipLocked: locked ? true : undefined
          };
        });
      });
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
    });
  }

  /**
   * 分批拉取缩略图；每批回调 onBatch(items)，便于 UI 逐批上屏。
   * 首批默认 8 张（首屏），之后每批 12。
   */
  function hydrateCatalogThumbs(sandbox, onBatch) {
    var sb = sandbox || currentSandbox();
    var offset = 0;
    var first = true;
    var cancelled = false;

    function step() {
      if (cancelled) return Promise.resolve();
      var limit = first ? 8 : 12;
      first = false;
      return fetchCatalogThumbsBatch(sb, offset, limit).then(function (batch) {
        if (cancelled) return;
        if (typeof onBatch === 'function') {
          try { onBatch(batch.items || []); } catch (_e) {}
        }
        if (batch.done) return;
        offset = batch.nextOffset != null ? batch.nextOffset : offset + (batch.items ? batch.items.length : 0);
        // 让出主线程，方便浏览器先画上本批图
        return new Promise(function (resolve) {
          setTimeout(function () { resolve(step()); }, 0);
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

  /** 进课：拉取单课全文 */
  function fetchScene(sandbox, name) {
    var sb = sandbox || currentSandbox();
    var n = String(name || '').trim();
    if (!n) return Promise.reject(new Error('缺少场景名'));
    return fetchJson(sceneUrl(sb, n)).then(function (data) {
      if (data && data.ok && data.scene) {
        if (data.locked || data.scene.__membershipLocked) {
          var err = new Error('need_member');
          err.locked = true;
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
        var hit = arr.find(function (s) { return s && String(s.name || '').trim() === n; });
        if (!hit) throw new Error('场景不存在');
        var filtered = filterScenesClientSide([hit], sb)[0];
        if (filtered && filtered.__membershipLocked) {
          var e2 = new Error('need_member');
          e2.locked = true;
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
      return saveEntitlement(Object.assign({}, data.entitlement, { source: 'server' }));
    });
  }

  function registerAccount(opts) {
    var o = opts || {};
    return postJson(API_REGISTER, {
      phone: o.phone,
      password: o.password,
      wechatNote: o.wechatNote || '',
      deviceId: getDeviceId(),
      deviceLabel: o.deviceLabel || guessDeviceLabel()
    }).then(function (res) {
      if (!res.r.ok || !res.data || !res.data.ok) {
        throw new Error((res.data && res.data.error) || '注册失败');
      }
      saveEntitlement(Object.assign({}, res.data.entitlement, { source: 'account' }));
      return res.data;
    });
  }

  function loginAccount(opts) {
    var o = opts || {};
    return postJson(API_LOGIN, {
      phone: o.phone,
      password: o.password,
      wechatNote: o.wechatNote || '',
      deviceId: getDeviceId(),
      deviceLabel: o.deviceLabel || guessDeviceLabel()
    }).then(function (res) {
      if (!res.r.ok || !res.data || !res.data.ok) {
        throw new Error((res.data && res.data.error) || '登录失败');
      }
      saveEntitlement(Object.assign({}, res.data.entitlement, { source: 'account' }));
      return res.data;
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
    saveEntitlement({ tierId: 'free', level: 'free', expiresAt: null, source: 'cleared' });
    return fetch(API_ME, { method: 'DELETE', credentials: 'same-origin' }).catch(function () {
      return null;
    });
  }

  function memberPageUrl(extraQuery) {
    var q = extraQuery ? ('?' + extraQuery) : '';
    return '/member' + q;
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
        '<div style="font-size:11px;letter-spacing:0.12em;color:rgba(245,215,110,0.9);margin-bottom:8px">会员内容</div>' +
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
          '">前往兑换</button>' +
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
    // 列表卡片可能 pointerup+click 连点两次；短窗内只弹一次
    if (now - _upgradePromptAt < 800) return;
    _upgradePromptAt = now;

    var label = (detail && detail.rule && detail.rule.label) ? String(detail.rule.label) : '';
    var title = label ? ('「' + label + '」需要会员') : '此内容需要会员';
    var body = '开通后可学习标注为会员的课程与功能。可先兑换，再回来继续。';

    function goRedeem() {
      var ret = '';
      try { ret = encodeURIComponent(global.location.pathname + global.location.search); } catch (_e) {}
      global.location.href = memberPageUrl(ret ? ('return=' + ret) : '');
    }

    try {
      var modal = ensureUpgradeModal();
      if (!modal) {
        if (global.confirm(title + ' 前往兑换页？')) goRedeem();
        return;
      }
      modal.querySelector('.mu-title').textContent = title;
      modal.querySelector('.mu-body').textContent = body;
      modal.style.display = 'flex';

      var okBtn = modal.querySelector('.mu-ok');
      var cancelBtn = modal.querySelector('.mu-cancel');
      function onOk() { cleanup(); goRedeem(); }
      function onCancel() { cleanup(); }
      function onBackdrop(e) { if (e.target === modal) cleanup(); }
      function onKey(e) { if (e.key === 'Escape') cleanup(); }
      function cleanup() {
        hideUpgradeModal();
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
        modal.removeEventListener('click', onBackdrop);
        global.document.removeEventListener('keydown', onKey);
      }
      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
      modal.addEventListener('click', onBackdrop);
      global.document.addEventListener('keydown', onKey);
      try { okBtn.focus(); } catch (_f) {}
    } catch (_e2) {
      try {
        if (global.confirm(title + ' 前往兑换页？')) goRedeem();
      } catch (_e3) {
        goRedeem();
      }
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
    getDeviceId: getDeviceId,
    registerAccount: registerAccount,
    loginAccount: loginAccount,
    fetchDevices: fetchDevices,
    removeDevice: removeDevice,
    refreshFromServer: refreshFromServer,
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
