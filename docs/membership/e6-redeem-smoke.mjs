/**
 * 测站权益兑换冒烟（需已写入 KV 测试码，见 _e6_codes.json）
 * SMOKE_BASE=https://test.wuxiaoart.com node docs/membership/e6-redeem-smoke.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const base = (process.env.SMOKE_BASE || 'https://test.wuxiaoart.com').replace(/\/$/, '');
const codes = JSON.parse(fs.readFileSync(path.join(__dirname, '_e6_codes.json'), 'utf8'));

function parseSetCookie(res) {
  const raw = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [];
  const list = raw && raw.length ? raw : [res.headers.get('set-cookie')].filter(Boolean);
  return list
    .map((c) => String(c).split(';')[0])
    .filter(Boolean)
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
    data = { raw: text.slice(0, 200) };
  }
  return { res, data, cookie: parseSetCookie(res) };
}

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    failed += 1;
    console.error('FAIL', msg);
  } else {
    console.log('ok', msg);
  }
}

const phone = '19988' + String(Date.now()).slice(-6);
const password = 'TestE6aa';

console.log('[e6] base=', base, 'phone=', phone);

// ⑤ 有效未兑码 + 未登录 → 拒兑
{
  const { res, data } = await req('/api/membership/redeem', {
    method: 'POST',
    body: { code: codes.sketch }
  });
  assert(res.status === 401, '未登录兑写生码 → 401');
  assert(
    data && String(data.error || '').includes('登录'),
    '未登录提示含登录: ' + JSON.stringify(data)
  );
}

// 注册
let cookie = '';
{
  const { res, data, cookie: c } = await req('/api/membership/account/register', {
    method: 'POST',
    body: {
      phone,
      password,
      displayName: 'E6测',
      deviceId: 'dev_e6_smoke_00123456'
    }
  });
  assert(res.ok && data && data.ok, '注册: ' + JSON.stringify(data));
  cookie = c;
  assert(!!cookie, '注册写入 Cookie');
}

// ② 写生码
{
  const { res, data, cookie: c } = await req('/api/membership/redeem', {
    method: 'POST',
    cookie,
    body: { code: codes.sketch, deviceId: 'dev_e6_smoke_00123456' }
  });
  if (c) cookie = c;
  assert(res.ok && data && data.ok, '兑写生: ' + JSON.stringify(data));
  assert(data.kind === 'sketch', 'kind=sketch');
  assert(!data.alreadyOwned, '首次兑写生非已拥有');
  assert(
    (data.productUnlocks || []).some((p) => p.productId === 'sandbox:geometrysketch'),
    'productUnlocks 含 geometrysketch'
  );
  assert(String(data.tip || '').includes('几何'), '提示含产品名: ' + data.tip);
}

// /me
{
  const { res, data } = await req('/api/membership/me', { cookie });
  assert(res.ok && data && data.ok, '/me ok');
  assert(
    (data.productUnlocks || []).some((p) => p.productId === 'sandbox:geometrysketch'),
    '/me productUnlocks'
  );
}

// 课表：在尚未 Pro 时，单品解锁应盖过写生库锁课
{
  const { res, data } = await req(
    '/api/membership/catalog?sandbox=geometrysketch',
    { cookie }
  );
  assert(res.ok && data && data.ok, 'catalog geometrysketch');
  const scenes = data.scenes || [];
  const open = scenes.filter((s) => !(s.__membershipLocked || (s.meta && s.meta.locked)));
  const locked = scenes.length - open.length;
  assert(
    open.length > 0 && locked === 0,
    '写生单品应解锁全库 open=' + open.length + ' locked=' + locked + ' total=' + scenes.length
  );
}

// ③ 录播码
{
  const { res, data, cookie: c } = await req('/api/membership/redeem', {
    method: 'POST',
    cookie,
    body: { code: codes.course, deviceId: 'dev_e6_smoke_00123456' }
  });
  if (c) cookie = c;
  assert(res.ok && data && data.ok, '兑录播: ' + JSON.stringify(data));
  assert(data.kind === 'course', 'kind=course');
  assert(!data.alreadyOwned, '首次兑录播');
  assert(
    (data.coursePacks || []).some((p) => p.packId === 'watercolor-portrait-demo'),
    'coursePacks 含 demo'
  );
  assert(data.accessLevel === 'member' || (data.entitlement && data.entitlement.level === 'member'), '录播后 Pro');
  assert(String(data.tip || '').includes('三年') || String(data.tip || '').includes('永久'), '录播提示: ' + data.tip);
}

// ④ 已拥有再兑写生（第二枚同品码）
{
  assert(!!codes.sketch2, '需要 sketch2 测试码');
  const { res, data, cookie: c } = await req('/api/membership/redeem', {
    method: 'POST',
    cookie,
    body: { code: codes.sketch2, deviceId: 'dev_e6_smoke_00123456' }
  });
  if (c) cookie = c;
  assert(res.ok && data && data.ok, '已拥有再兑写生应成功提示: ' + JSON.stringify(data));
  assert(data.alreadyOwned === true, 'alreadyOwned=true');
  assert(String(data.tip || '').includes('已拥有'), '提示已拥有: ' + data.tip);
}

// 同码再兑 → 已使用
{
  const { res, data } = await req('/api/membership/redeem', {
    method: 'POST',
    cookie,
    body: { code: codes.course, deviceId: 'dev_e6_smoke_00123456' }
  });
  assert(!res.ok, '同码再兑应失败');
  assert(String((data && data.error) || '').includes('已使用'), '提示已使用: ' + JSON.stringify(data));
}

// ① Pro 码（另开账号，避免与录播 Pro 纠缠）
{
  const phone2 = '19987' + String(Date.now()).slice(-6);
  const reg = await req('/api/membership/account/register', {
    method: 'POST',
    body: {
      phone: phone2,
      password,
      displayName: 'E6Pro',
      deviceId: 'dev_e6_smoke_pro_001'
    }
  });
  assert(reg.res.ok && reg.data && reg.data.ok, 'Pro 测试号注册');
  let c2 = reg.cookie;
  const red = await req('/api/membership/redeem', {
    method: 'POST',
    cookie: c2,
    body: { code: codes.pro, deviceId: 'dev_e6_smoke_pro_001' }
  });
  if (red.cookie) c2 = red.cookie;
  assert(red.res.ok && red.data && red.data.ok, '兑 Pro: ' + JSON.stringify(red.data));
  assert(red.data.kind === 'pro' || !red.data.kind || red.data.kind === 'pro', 'kind pro');
  assert(
    red.data.accessLevel === 'member' ||
      (red.data.entitlement && red.data.entitlement.level === 'member'),
    'Pro 开通'
  );
}

if (failed) {
  console.error('\n[e6] FAILED', failed);
  process.exit(1);
}
console.log('\n[e6] all passed');
