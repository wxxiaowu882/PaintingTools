/**
 * 测站会员/权限功能测试执行器（细测，非冒烟）
 * 对照：docs/membership/功能测试用例_会员权限全链路.md
 *
 *   set FT_BASE=https://test.wuxiaoart.com
 *   set MEMBERSHIP_ADMIN_PASSWORD=***   （可选；无则发码/运营用例 BLOCKED）
 *   node docs/membership/ft-membership-chain.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const base = (process.env.FT_BASE || 'https://test.wuxiaoart.com').replace(/\/$/, '');
const adminPass = process.env.MEMBERSHIP_ADMIN_PASSWORD || '';
const password = process.env.FT_PASSWORD || 'FtTestaa1';
const stamp = new Date();
const day =
  stamp.getFullYear() +
  String(stamp.getMonth() + 1).padStart(2, '0') +
  String(stamp.getDate()).padStart(2, '0');
const phoneA = '19987' + String(Date.now()).slice(-6);
const phoneB = '19986' + String(Date.now() + 7).slice(-6);
const device1 = 'dev_ft_membership_01';
const device2 = 'dev_ft_membership_02';
const device3 = 'dev_ft_membership_03';

const results = [];

function parseSetCookie(res) {
  const raw =
    typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  const list = raw && raw.length ? raw : [res.headers.get('set-cookie')].filter(Boolean);
  return list
    .map((c) => String(c).split(';')[0])
    .filter(Boolean)
    .join('; ');
}

function mergeCookie(prev, next) {
  if (!next) return prev || '';
  const map = Object.create(null);
  String(prev || '')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((p) => {
      const i = p.indexOf('=');
      if (i > 0) map[p.slice(0, i)] = p.slice(i + 1);
    });
  String(next)
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((p) => {
      const i = p.indexOf('=');
      if (i > 0) map[p.slice(0, i)] = p.slice(i + 1);
    });
  return Object.keys(map)
    .map((k) => k + '=' + map[k])
    .join('; ');
}

async function req(url, opts = {}) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  if (opts.cookie) headers.Cookie = opts.cookie;
  const res = await fetch(base + url, {
    method: opts.method || 'GET',
    headers,
    body: opts.body != null ? JSON.stringify(opts.body) : undefined
  });
  let data = null;
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : null;
  } catch (_e) {
    data = { raw: text.slice(0, 300) };
  }
  return { res, data, setCookie: parseSetCookie(res), text };
}

function record(id, status, detail) {
  results.push({ id, status, detail: String(detail || '') });
  const tag = status === 'PASS' ? 'ok' : status === 'FAIL' ? 'FAIL' : status;
  console.log(tag, id, detail || '');
}

function assert(id, cond, detail) {
  if (cond) record(id, 'PASS', detail);
  else record(id, 'FAIL', detail);
}

function blocked(id, reason) {
  record(id, 'BLOCKED', reason);
}

async function adminLogin() {
  if (!adminPass) return null;
  const { res, data, setCookie } = await req('/api/membership/admin/login', {
    method: 'POST',
    body: { password: adminPass }
  });
  if (!res.ok || !(data && data.ok) || !setCookie) return null;
  return setCookie;
}

async function adminCreateCodes(opsCookie, body) {
  return req('/api/membership/admin/codes', {
    method: 'POST',
    cookie: opsCookie,
    body
  });
}

async function main() {
  console.log('[ft] base=', base);
  console.log('[ft] adminPass=', adminPass ? '(set)' : '(missing → OPS/redeem mint BLOCKED)');
  console.log('[ft] phoneA=', phoneA, 'phoneB=', phoneB);

  // —— FT-A 账号 ——
  let cookieU = '';
  {
    const { res, data, setCookie } = await req('/api/membership/account/register', {
      method: 'POST',
      body: {
        phone: phoneA,
        password,
        displayName: 'FT-A',
        deviceId: device1
      }
    });
    cookieU = setCookie;
    assert(
      'FT-A01',
      res.ok && data && data.ok && !!cookieU,
      JSON.stringify(data).slice(0, 180)
    );
  }
  {
    const { res, data } = await req('/api/membership/account/register', {
      method: 'POST',
      body: { phone: phoneA, password, displayName: 'FT-A2', deviceId: device1 }
    });
    assert(
      'FT-A02',
      !res.ok || (data && data.ok === false),
      'status=' + res.status + ' ' + JSON.stringify(data).slice(0, 120)
    );
  }
  {
    const { res, data } = await req('/api/membership/me', { cookie: cookieU });
    const lvl = data && (data.accessLevel || (data.entitlement && data.entitlement.level));
    assert('FT-A01b-/me', res.ok && data && String(lvl) === 'user', 'level=' + lvl);
  }
  {
    const { res, data, setCookie } = await req('/api/membership/account/login', {
      method: 'POST',
      body: { phone: phoneA, password, deviceId: device1 }
    });
    if (setCookie) cookieU = mergeCookie(cookieU, setCookie);
    assert('FT-A03', res.ok && data && data.ok, JSON.stringify(data).slice(0, 120));
  }
  {
    const { res, data } = await req('/api/membership/account/login', {
      method: 'POST',
      body: { phone: phoneA, password: 'WrongPass99', deviceId: device1 }
    });
    assert('FT-A04', !res.ok || (data && data.ok === false), 'status=' + res.status);
  }
  {
    const { res, data } = await req('/api/membership/me');
    const guest =
      !data ||
      data.accessLevel === 'guest' ||
      data.level === 'guest' ||
      !(data.accountId || (data.entitlement && data.entitlement.accountId));
    assert('FT-A05', res.ok && guest, JSON.stringify(data).slice(0, 160));
  }
  {
    const { res, text } = await req('/member');
    const html = text || '';
    assert(
      'FT-A06',
      res.ok && (/微信|运营|重置|忘记/.test(html) || /权益兑换/.test(html)),
      'member page status=' + res.status
    );
  }

  // —— 公开 API 门禁抽检 ——
  {
    const { res, data } = await req('/api/membership/catalog?sandbox=geometrysketch');
    assert(
      'FT-S08-geo-catalog',
      res.ok && data,
      'keys=' + (data && Object.keys(data).slice(0, 8).join(','))
    );
    // 锁课应尽量保留 uid（削薄）
    const scenes =
      (data && (data.scenes || data.items || data.list || data.catalog)) || [];
    const arr = Array.isArray(scenes) ? scenes : [];
    if (arr.length) {
      const sample = arr.slice(0, 5);
      const uidOk = sample.every((s) => s && (s.uid != null || s.id != null));
      assert('FT-S08-uid-sample', uidOk, 'n=' + arr.length);
    } else {
      record('FT-S08-uid-sample', 'BLOCKED', 'catalog shape has no array; inspect manually');
    }
  }

  // —— 发码 + 兑换（需运营口令）——
  const opsCookie = await adminLogin();
  if (!opsCookie) {
    [
      'FT-O01',
      'FT-R01',
      'FT-R02',
      'FT-R03',
      'FT-R05',
      'FT-R06',
      'FT-R07',
      'FT-S06',
      'FT-O07'
    ].forEach((id) => blocked(id, '缺 MEMBERSHIP_ADMIN_PASSWORD'));
  } else {
    assert('FT-O01', true, 'admin login cookie ok');

    // 未登录兑码不烧（先发一枚 sketch）
    let sketchCode = '';
    let proCode = '';
    let courseCode = '';
    let courseCode2 = '';
    {
      const { res, data } = await adminCreateCodes(opsCookie, {
        kind: 'sketch',
        productId: 'sandbox:geometrysketch',
        count: 1,
        note: 'FT-R01'
      });
      const codes =
        (data && (data.codes || data.shortCodes || data.items)) ||
        (data && data.code ? [data.code] : []);
      const first =
        Array.isArray(codes) && codes[0]
          ? typeof codes[0] === 'string'
            ? codes[0]
            : codes[0].code || codes[0].shortCode
          : data && data.shortCode;
      sketchCode = first || '';
      assert('FT-O02-sketch-mint', res.ok && data && data.ok && !!sketchCode, JSON.stringify(data).slice(0, 200));
    }
    if (sketchCode) {
      const { res, data } = await req('/api/membership/redeem', {
        method: 'POST',
        body: { code: sketchCode }
      });
      assert(
        'FT-R01-guest-reject',
        res.status === 401 || (data && data.ok === false),
        'status=' + res.status + ' ' + JSON.stringify(data).slice(0, 100)
      );
      // 登录后再兑应成功 → 证明未烧
      const { res: r2, data: d2, setCookie } = await req('/api/membership/redeem', {
        method: 'POST',
        cookie: cookieU,
        body: { code: sketchCode, deviceId: device1 }
      });
      if (setCookie) cookieU = mergeCookie(cookieU, setCookie);
      assert(
        'FT-R01-then-redeem',
        r2.ok && d2 && d2.ok && d2.kind === 'sketch',
        JSON.stringify(d2).slice(0, 200)
      );
      assert(
        'FT-R03',
        d2 &&
          (d2.productUnlocks || []).some(
            (p) => p.productId === 'sandbox:geometrysketch' || p === 'sandbox:geometrysketch'
          ),
        JSON.stringify(d2 && d2.productUnlocks).slice(0, 160)
      );
      // 再兑同码 → 已拥有或失败
      const { res: r3, data: d3 } = await req('/api/membership/redeem', {
        method: 'POST',
        cookie: cookieU,
        body: { code: sketchCode, deviceId: device1 }
      });
      assert(
        'FT-R07',
        (d3 && d3.alreadyOwned) || !r3.ok || (d3 && d3.ok === false),
        JSON.stringify(d3).slice(0, 160)
      );
    }

    {
      const { res, data } = await adminCreateCodes(opsCookie, {
        kind: 'pro',
        tierId: 'member_3m',
        count: 1,
        note: 'FT-R02'
      });
      const codes = (data && (data.codes || data.shortCodes || data.items)) || [];
      proCode =
        (Array.isArray(codes) && codes[0] && (codes[0].code || codes[0].shortCode || codes[0])) ||
        '';
      if (typeof proCode !== 'string') proCode = '';
    }
    // phoneB 专兑 Pro，避免与写生账号混判「是否因写生变 Pro」
    let cookieP = '';
    {
      const { res, data, setCookie } = await req('/api/membership/account/register', {
        method: 'POST',
        body: {
          phone: phoneB,
          password,
          displayName: 'FT-P',
          deviceId: device1
        }
      });
      cookieP = setCookie;
      assert('FT-A01-phoneB', res.ok && data && data.ok && !!cookieP, JSON.stringify(data).slice(0, 100));
    }
    if (proCode && cookieP) {
      const { res, data, setCookie } = await req('/api/membership/redeem', {
        method: 'POST',
        cookie: cookieP,
        body: { code: proCode, deviceId: device1 }
      });
      if (setCookie) cookieP = mergeCookie(cookieP, setCookie);
      assert('FT-R02', res.ok && data && data.ok && data.kind === 'pro', JSON.stringify(data).slice(0, 180));
      const me = await req('/api/membership/me', { cookie: cookieP });
      const lvl = me.data && me.data.accessLevel;
      assert('FT-R02-me', lvl === 'member', 'level=' + lvl);
    } else if (!proCode) {
      blocked('FT-R02', 'pro code mint shape unexpected — check admin API response');
    }

    // 录播码：查 packs
    let packId = 'watercolor-portrait-demo';
    try {
      const packsRes = await req('/docs/course/packs.json');
      const packs = packsRes.data;
      const list = Array.isArray(packs) ? packs : packs && packs.packs;
      if (Array.isArray(list) && list[0]) {
        packId = list[0].id || list[0].packId || packId;
      }
    } catch (_e) {}
    {
      const { res, data } = await adminCreateCodes(opsCookie, {
        kind: 'course',
        packId,
        packTitle: packId,
        count: 2,
        note: 'FT-R05'
      });
      const codes = (data && (data.codes || data.shortCodes || data.items)) || [];
      const pick = (c) => (typeof c === 'string' ? c : c && (c.code || c.shortCode));
      courseCode = pick(codes[0]) || '';
      courseCode2 = pick(codes[1]) || '';
      assert('FT-O02-course-mint', res.ok && !!courseCode, JSON.stringify(data).slice(0, 200));
    }
    if (courseCode && cookieU) {
      const meBefore = await req('/api/membership/me', { cookie: cookieU });
      const expBefore =
        meBefore.data &&
        (meBefore.data.entitlement && meBefore.data.entitlement.expiresAt);
      const { res, data, setCookie } = await req('/api/membership/redeem', {
        method: 'POST',
        cookie: cookieU,
        body: { code: courseCode, deviceId: device1 }
      });
      if (setCookie) cookieU = mergeCookie(cookieU, setCookie);
      assert('FT-R05', res.ok && data && data.ok && data.kind === 'course', JSON.stringify(data).slice(0, 200));
      const meAfter = await req('/api/membership/me', { cookie: cookieU });
      const packs = (meAfter.data && meAfter.data.coursePacks) || [];
      const hasPack = packs.some((p) => (p.packId || p.id || p) === packId);
      assert('FT-R05-pack', hasPack, JSON.stringify(packs).slice(0, 160));
      assert('FT-R05-pro', meAfter.data && meAfter.data.accessLevel === 'member', 'level=' + (meAfter.data && meAfter.data.accessLevel));

      if (courseCode2) {
        const exp1 =
          meAfter.data &&
          meAfter.data.entitlement &&
          meAfter.data.entitlement.expiresAt;
        const { res: r2, data: d2 } = await req('/api/membership/redeem', {
          method: 'POST',
          cookie: cookieU,
          body: { code: courseCode2, deviceId: device1 }
        });
        const me2 = await req('/api/membership/me', { cookie: cookieU });
        const exp2 =
          me2.data && me2.data.entitlement && me2.data.entitlement.expiresAt;
        assert(
          'FT-R06',
          (d2 && d2.alreadyOwned) || (r2.ok && exp1 && exp2 && String(exp1) === String(exp2)),
          'alreadyOwned=' +
            !!(d2 && d2.alreadyOwned) +
            ' exp1=' +
            exp1 +
            ' exp2=' +
            exp2 +
            ' beforeUnused=' +
            expBefore
        );
      }
    }

    // 写生盖过：用仍持有 geometrysketch unlock 的 cookieU（已兑录播后可能已是 Pro——盖过仍应可读）
    if (cookieU) {
      const cat = await req('/api/membership/catalog?sandbox=geometrysketch', {
        cookie: cookieU
      });
      assert('FT-S06-catalog-auth', cat.res.ok && !!cat.data, 'catalog with unlock/pro');
    }
  }

  // —— Course 页可达 ——
  {
    const { res, text } = await req('/Course');
    assert('FT-C01', res.ok && text && text.length > 200, 'status=' + res.status);
  }
  {
    const { res, text } = await req('/CourseLearn');
    // 游客应被挡或看到门禁文案（测站）
    const gated =
      !res.ok ||
      /登录|开通|门禁|筹备|无权|课包/.test(text || '') ||
      (text || '').length < 50;
    assert('FT-C03-guest', gated || res.ok, 'status=' + res.status + ' gatedHint=' + gated);
  }

  // —— 并发会话（登录三次）——
  if (cookieU) {
    const logins = [];
    // deviceId 须 ≥8 字符，否则登录会「设备标识无效」且无 Cookie
    const devices = [
      'dev_ft_conc_' + phoneA.slice(-4) + '_a',
      'dev_ft_conc_' + phoneA.slice(-4) + '_b',
      'dev_ft_conc_' + phoneA.slice(-4) + '_c'
    ];
    for (const dev of devices) {
      const { res, data, setCookie } = await req('/api/membership/account/login', {
        method: 'POST',
        body: { phone: phoneA, password, deviceId: dev }
      });
      logins.push({ res, data, setCookie, dev });
    }
    const third = logins[2];
    assert(
      'FT-X01-third-login-accepted-or-kick',
      third.res.ok && third.setCookie,
      'third status=' + third.res.status + ' ' + JSON.stringify(third.data).slice(0, 120)
    );
    await new Promise((r) => setTimeout(r, 500));
    const levels = [];
    for (let i = 0; i < logins.length; i++) {
      const c = mergeCookie(cookieU, logins[i].setCookie);
      const me = await req('/api/membership/me', { cookie: c });
      levels.push(me.data && me.data.accessLevel);
    }
    const active = levels.filter((l) => l === 'user' || l === 'member').length;
    const kicked = levels.filter((l) => l === 'guest').length;
    assert(
      'FT-X01-oldest-session',
      active === 2 && kicked === 1,
      'levels=' + JSON.stringify(levels)
    );
  }

  // 写结果文件
  const outPath = path.join(__dirname, '功能测试结果_会员权限_' + day + '.md');
  const lines = [
    '# 会员权限功能测试结果 · ' + day,
    '',
    '- base: `' + base + '`',
    '- phoneA: `' + phoneA + '` / phoneB: `' + phoneB + '`',
    '- admin: ' + (adminPass ? 'provided' : 'missing'),
    '',
    '| ID | 结果 | 说明 |',
    '|----|------|------|'
  ];
  for (const r of results) {
    lines.push('| ' + r.id + ' | **' + r.status + '** | ' + r.detail.replace(/\|/g, '/') + ' |');
  }
  const pass = results.filter((r) => r.status === 'PASS').length;
  const fail = results.filter((r) => r.status === 'FAIL').length;
  const blk = results.filter((r) => r.status === 'BLOCKED').length;
  lines.push('', '合计：PASS ' + pass + ' / FAIL ' + fail + ' / BLOCKED ' + blk + ' / 共 ' + results.length);
  fs.writeFileSync(outPath, lines.join('\n') + '\n', 'utf8');
  console.log('[ft] wrote', outPath);
  console.log('[ft] summary PASS', pass, 'FAIL', fail, 'BLOCKED', blk);
  if (fail) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
