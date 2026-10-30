#!/usr/bin/env node
/**
 * 正式发版后冒烟（只读）：首页 / Solid / 会员公开配置 / 防内嵌头。
 * 用法：node docs/membership/prod-deploy-smoke.mjs
 * 环境变量：SMOKE_BASE=https://wuxiaoart.com（默认正式；测站可改 test）
 */
const BASE = String(process.env.SMOKE_BASE || 'https://wuxiaoart.com').replace(/\/$/, '');

async function head(url) {
  const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
  const headers = {};
  res.headers.forEach((v, k) => {
    headers[k.toLowerCase()] = v;
  });
  return { ok: res.ok, status: res.status, headers, url: res.url };
}

async function getJson(url) {
  const res = await fetch(url, { redirect: 'follow' });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch (_e) {}
  return { ok: res.ok, status: res.status, json, url: res.url };
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  let json = null;
  try {
    json = await res.json();
  } catch (_e) {}
  return { ok: res.ok, status: res.status, json };
}

function need(cond, msg, errors) {
  if (!cond) errors.push(msg);
}

async function main() {
  const errors = [];
  console.log('[smoke] base=', BASE);

  const home = await head(BASE + '/');
  need(home.ok, '首页 HTTP ' + home.status, errors);

  const solid = await head(BASE + '/Solid');
  need(solid.ok, 'Solid HTTP ' + solid.status, errors);
  const xfo = solid.headers['x-frame-options'] || '';
  const csp = solid.headers['content-security-policy'] || '';
  need(/sameorigin/i.test(xfo), 'Solid 缺少 X-Frame-Options: SAMEORIGIN（现=' + (xfo || '无') + '）', errors);
  need(/frame-ancestors\s+'self'/i.test(csp), 'Solid 缺少 CSP frame-ancestors \'self\'（现=' + (csp || '无') + '）', errors);

  const cfg = await getJson(BASE + '/api/membership/public-config');
  need(cfg.ok && cfg.json && cfg.json.ok, 'public-config 不可用 HTTP ' + cfg.status, errors);

  const ver = await getJson(BASE + '/docs/site-version.json');
  const stamp = ver.json && (ver.json.webStamp || ver.json.webLabel);
  need(ver.ok && stamp, 'site-version.json 缺少 webStamp', errors);
  if (stamp) console.log('[smoke] site webStamp=', stamp);

  // 正式站默认要求探针关闭；测站可用 SMOKE_ALLOW_PROBE=1 跳过
  if (process.env.SMOKE_ALLOW_PROBE !== '1') {
    const probe = await postJson(BASE + '/api/membership/redeem', { code: 'PROBE-3M' });
    need(
      !(probe.json && probe.json.ok === true),
      '探针码仍可兑换，正式卖课前须关闭',
      errors
    );
  }

  if (errors.length) {
    console.error('[smoke] FAIL');
    errors.forEach((e) => console.error(' -', e));
    process.exit(1);
  }
  console.log('[smoke] OK：首页 / Solid / 防内嵌头 / public-config / 探针关闭');
}

main().catch((e) => {
  console.error('[smoke] 异常:', e && e.message ? e.message : e);
  process.exit(1);
});
