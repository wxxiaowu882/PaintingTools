#!/usr/bin/env node
/**
 * 正式发版前检查（只读，不打印密钥内容）：
 * 1) Cloudflare Secrets 已配置 MEMBERSHIP_SECRET、MEMBERSHIP_ADMIN_PASSWORD
 * 2) 正式站探针码关闭（KV ops:settings + 线上兑换接口实测）
 *
 * 用法：node docs/membership/prod-deploy-preflight.mjs
 * 环境变量：
 *   SKIP_PREFLIGHT=1     跳过
 *   PREFLIGHT_BASE=url   默认 https://wuxiaoart.com
 */
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const PROD_KV = 'e556d7993e374d31bc8d693a6273f337';
const REQUIRED_SECRETS = ['MEMBERSHIP_SECRET', 'MEMBERSHIP_ADMIN_PASSWORD'];
const BASE = String(process.env.PREFLIGHT_BASE || 'https://wuxiaoart.com').replace(/\/$/, '');

function escapeCmdArg(a) {
  const s = String(a);
  if (/[\s"&<>^|]/u.test(s)) return '"' + s.replace(/"/g, '\\"') + '"';
  return s;
}

function runNpx(args) {
  const base = {
    encoding: 'utf8',
    cwd: REPO,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true
  };
  if (process.platform === 'win32') {
    const line = 'npx ' + args.map(escapeCmdArg).join(' ');
    return spawnSync('cmd.exe', ['/d', '/s', '/c', line], base);
  }
  return spawnSync('npx', args, base);
}

function combined(r) {
  return String((r && r.stdout) || '') + String((r && r.stderr) || '');
}

function fail(msg, errors) {
  errors.push(msg);
}

async function checkProbeHttp(errors) {
  console.log('[preflight] 实测探针码兑换（应拒绝）…', BASE);
  let res;
  try {
    res = await fetch(BASE + '/api/membership/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'PROBE-3M' })
    });
  } catch (e) {
    fail('无法请求兑换接口: ' + (e && e.message ? e.message : e), errors);
    return;
  }
  let body = {};
  try {
    body = await res.json();
  } catch (_e) {}
  if (body && body.ok === true) {
    fail('正式站仍接受探针码 PROBE-3M（须关闭 allowProbeCodes / ALLOW_PROBE_CODES）', errors);
    return;
  }
  const err = String((body && body.error) || '');
  if (!/假码|探针|关闭|测试/.test(err) && res.status === 200 && body && body.ok === false) {
    // 其它拒绝文案也算关着，只告警
    console.log('[preflight] 探针被拒（文案非预期但仍 ok:false）:', err || res.status);
  } else {
    console.log('[preflight] 探针已关闭:', err || ('HTTP ' + res.status));
  }
}

function checkSecrets(errors) {
  console.log('[preflight] 检查正式站 Secrets 名称…');
  // 顶层环境 = 正式；勿传 --env=""（部分 wrangler 子命令不认空 env 名）
  const r = runNpx(['wrangler', 'secret', 'list']);
  if (r.error) {
    fail('无法启动 wrangler secret list: ' + r.error.message, errors);
    return;
  }
  if (r.status !== 0) {
    fail('wrangler secret list 失败:\n' + combined(r).trim(), errors);
    return;
  }
  let list;
  try {
    list = JSON.parse(String(r.stdout || '').trim() || '[]');
  } catch (e) {
    fail('secret list 不是 JSON: ' + e.message, errors);
    return;
  }
  const names = new Set((Array.isArray(list) ? list : []).map((x) => x && x.name).filter(Boolean));
  for (const need of REQUIRED_SECRETS) {
    if (!names.has(need)) {
      fail('缺少 Secret「' + need + '」。请用 Portal「23_设置会员口令」配置。', errors);
    } else {
      console.log('[preflight] Secret 已配置:', need);
    }
  }
}

function checkOpsSettingsKv(errors) {
  console.log('[preflight] 读取正式 KV ops:settings…');
  const r = runNpx([
    'wrangler',
    'kv',
    'key',
    'get',
    'ops:settings',
    '--namespace-id=' + PROD_KV
  ]);
  if (r.error) {
    fail('无法读 ops:settings: ' + r.error.message, errors);
    return;
  }
  const out = combined(r);
  if (/value not found/i.test(out) || (!String(r.stdout || '').trim() && r.status === 0)) {
    console.log('[preflight] 无 ops:settings（探针默认关，除非环境变量 ALLOW_PROBE_CODES=1）');
    return;
  }
  if (r.status !== 0) {
    fail('读 ops:settings 失败:\n' + out.trim(), errors);
    return;
  }
  try {
    const doc = JSON.parse(String(r.stdout || '').trim());
    if (doc && doc.allowProbeCodes === true) {
      fail(
        '正式 KV ops:settings.allowProbeCodes=true。请在运营台关掉「测试假码」后再发版。',
        errors
      );
    } else {
      console.log('[preflight] ops:settings 探针开关=关');
    }
  } catch (e) {
    fail('ops:settings 不是合法 JSON: ' + e.message, errors);
  }
}

async function main() {
  if (process.env.SKIP_PREFLIGHT === '1') {
    console.log('[preflight] SKIP_PREFLIGHT=1，跳过');
    return;
  }
  const errors = [];
  checkSecrets(errors);
  checkOpsSettingsKv(errors);
  await checkProbeHttp(errors);

  if (errors.length) {
    console.error('[preflight] FAIL');
    errors.forEach((e) => console.error(' -', e));
    process.exit(1);
  }
  console.log('[preflight] OK：密钥已配、探针码已关');
}

main().catch((e) => {
  console.error('[preflight] 异常:', e && e.message ? e.message : e);
  process.exit(1);
});
