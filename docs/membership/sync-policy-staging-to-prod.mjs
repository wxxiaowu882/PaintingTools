#!/usr/bin/env node
/**
 * 正式发版前：把测站 MEMBERSHIP_KV 的 live 配置同步到
 * 1) 仓库底稿文件（随静态资源上传，作兜底）
 * 2) 正式站同名 KV（线上以 KV 为准，避免旧值盖住）
 *
 * 同步键：
 *   policy_live → docs/membership/access-policy.json + 正式 KV
 *   tiers_live  → docs/membership/tiers.json + 正式 KV（测站有才同步）
 *
 * 口径：测站有有效内容才推；测站没有 → 跳过该键、不阻断发版、不改正式站。
 *
 * 用法（仓库根）：
 *   node docs/membership/sync-policy-staging-to-prod.mjs
 * 环境变量：
 *   SKIP_POLICY_SYNC=1  跳过全部（紧急只发代码）
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');

const STAGING_KV = '050dc9b4fa834d27918dd32f54ecde09';
const PROD_KV = 'e556d7993e374d31bc8d693a6273f337';

const JOBS = [
  {
    key: 'policy_live',
    outFile: path.join(REPO, 'docs/membership/access-policy.json'),
    tmpName: '.policy_live_prod_tmp.json',
    requireResources: true
  },
  {
    key: 'tiers_live',
    outFile: path.join(REPO, 'docs/membership/tiers.json'),
    tmpName: '.tiers_live_prod_tmp.json',
    requireResources: false
  }
];

/** Windows：经 cmd /c 调 npx（直接 spawn npx/npx.cmd 易 ENOENT/EINVAL，尤其中文路径） */
function escapeCmdArg(a) {
  const s = String(a);
  if (/[\s"&<>^|]/u.test(s)) return '"' + s.replace(/"/g, '\\"') + '"';
  return s;
}

function runNpx(args, opts) {
  const base = {
    encoding: 'utf8',
    cwd: REPO,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true
  };
  if (process.platform === 'win32') {
    const line = 'npx ' + args.map(escapeCmdArg).join(' ');
    return spawnSync('cmd.exe', ['/d', '/s', '/c', line], Object.assign(base, opts || {}));
  }
  return spawnSync('npx', args, Object.assign(base, opts || {}));
}

function combinedOut(r) {
  return String((r && r.stdout) || '') + String((r && r.stderr) || '');
}

function isMissingValue(text, status, error) {
  if (error) return false;
  const t = String(text || '');
  if (/value not found/i.test(t)) return true;
  if (!t.trim() && status === 0) return true;
  return false;
}

function looksLikeJsonObject(raw) {
  const s = String(raw || '').trim();
  return s.startsWith('{') || s.startsWith('[');
}

/**
 * @returns {'synced'|'skipped'|'failed'}
 */
function syncOne(job) {
  console.log('[policy-sync] 读取测站 KV', job.key, '…');
  const get = runNpx(['wrangler', 'kv', 'key', 'get', job.key, '--namespace-id=' + STAGING_KV]);
  const out = combinedOut(get);
  if (get.error) {
    console.error('[policy-sync] 无法启动 wrangler（' + job.key + '）:', get.error.message);
    console.error('  提示：确认已安装 Node，且本机可执行 npx wrangler whoami');
    return 'failed';
  }
  if (isMissingValue(out, get.status, get.error)) {
    console.log('[policy-sync] 测站尚无', job.key, '，跳过（正式站保持原样）');
    return 'skipped';
  }
  if (get.status !== 0) {
    console.error('[policy-sync] 读取测站失败（' + job.key + '）:\n' + out.trim());
    return 'failed';
  }

  const raw = String(get.stdout || '').trim();
  if (!looksLikeJsonObject(raw)) {
    console.log('[policy-sync] 测站', job.key, '内容异常，跳过（不阻断）');
    return 'skipped';
  }

  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (e) {
    console.error('[policy-sync] 测站', job.key, '不是合法 JSON:', e.message);
    return 'failed';
  }
  if (!doc || typeof doc !== 'object') {
    console.log('[policy-sync] 测站', job.key, '无效，跳过');
    return 'skipped';
  }
  if (job.requireResources && !doc.resources) {
    console.log('[policy-sync] 测站', job.key, '无 resources，跳过');
    return 'skipped';
  }

  delete doc._source;
  if (job.key === 'policy_live') {
    doc.updated = new Date().toISOString().slice(0, 10);
  }
  const pretty = JSON.stringify(doc, null, 2) + '\n';
  fs.writeFileSync(job.outFile, pretty, 'utf8');
  const hint =
    job.key === 'policy_live' && doc.resources
      ? ' resources=' + Object.keys(doc.resources).length
      : '';
  console.log('[policy-sync] 已写入', path.relative(REPO, job.outFile) + hint);

  const tmp = path.join(REPO, 'docs/membership', job.tmpName);
  fs.writeFileSync(tmp, JSON.stringify(doc), 'utf8');
  console.log('[policy-sync] 写入正式站 KV', job.key, '…');
  const put = runNpx([
    'wrangler',
    'kv',
    'key',
    'put',
    job.key,
    '--namespace-id=' + PROD_KV,
    '--path',
    tmp
  ]);
  try {
    fs.unlinkSync(tmp);
  } catch (_e) {}
  if (put.error) {
    console.error('[policy-sync] 写入正式站失败（启动 wrangler）:', put.error.message);
    return 'failed';
  }
  if (put.status !== 0) {
    console.error('[policy-sync] 写入正式站 KV 失败（' + job.key + '）:\n' + combinedOut(put).trim());
    return 'failed';
  }
  console.log('[policy-sync] OK', job.key, '：测站 → 文件 + 正式 KV');
  return 'synced';
}

function main() {
  if (process.env.SKIP_POLICY_SYNC === '1') {
    console.log('[policy-sync] SKIP_POLICY_SYNC=1，跳过');
    return;
  }

  let failed = 0;
  let synced = 0;
  let skipped = 0;
  for (const job of JOBS) {
    const r = syncOne(job);
    if (r === 'failed') failed += 1;
    else if (r === 'synced') synced += 1;
    else skipped += 1;
  }

  if (failed) {
    console.error('[policy-sync] 失败数=', failed, '（已同步', synced, '跳过', skipped, '）');
    process.exit(1);
  }
  console.log('[policy-sync] 完成：synced=', synced, 'skipped=', skipped);
}

main();
