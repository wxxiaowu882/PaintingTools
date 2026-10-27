#!/usr/bin/env node
/**
 * 正式发版前：把测站 MEMBERSHIP_KV 的 policy_live 同步到
 * 1) 仓库 docs/membership/access-policy.json（随静态资源上传）
 * 2) 正式站 KV policy_live（避免旧线上覆盖盖住文件）
 *
 * 用法（仓库根）：
 *   node docs/membership/sync-policy-staging-to-prod.mjs
 * 环境变量：
 *   SKIP_POLICY_SYNC=1  跳过（紧急发版）
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const OUT_FILE = path.join(REPO, 'docs/membership/access-policy.json');

// wrangler.toml 中的 namespace id
const STAGING_KV = '050dc9b4fa834d27918dd32f54ecde09';
const PROD_KV = 'e556d7993e374d31bc8d693a6273f337';
const KEY = 'policy_live';

function run(cmd, args, opts) {
  const r = spawnSync(cmd, args, Object.assign({ encoding: 'utf8', cwd: REPO }, opts || {}));
  return r;
}

function main() {
  if (process.env.SKIP_POLICY_SYNC === '1') {
    console.log('[policy-sync] SKIP_POLICY_SYNC=1，跳过');
    return;
  }

  console.log('[policy-sync] 读取测站 KV', KEY, '…');
  const get = run('npx', ['wrangler', 'kv', 'key', 'get', KEY, '--namespace-id=' + STAGING_KV], {
    maxBuffer: 8 * 1024 * 1024
  });
  if (get.status !== 0) {
    console.error('[policy-sync] 读取测站失败:\n' + (get.stderr || get.stdout || ''));
    process.exit(1);
  }
  const raw = String(get.stdout || '').trim();
  // 测站尚未涂色/保存过：跳过，不覆盖正式站（也不阻断发版）
  if (!raw || /value not found|404|Error/i.test(raw) && raw[0] !== '{') {
    console.log('[policy-sync] 测站尚无 policy_live，跳过同步（正式站保持原样）');
    return;
  }
  let policy;
  try {
    policy = JSON.parse(raw);
  } catch (e) {
    console.error('[policy-sync] 测站内容不是合法 JSON:', e.message);
    process.exit(1);
  }
  if (!policy || typeof policy !== 'object' || !policy.resources) {
    console.log('[policy-sync] 测站策略无 resources，跳过同步');
    return;
  }

  delete policy._source;
  policy.updated = new Date().toISOString().slice(0, 10);
  policy.notes = (policy.notes || '') + '';
  const text = JSON.stringify(policy, null, 2) + '\n';
  fs.writeFileSync(OUT_FILE, text, 'utf8');
  console.log('[policy-sync] 已写入', path.relative(REPO, OUT_FILE), 'resources=', Object.keys(policy.resources).length);

  const tmp = path.join(REPO, 'docs/membership/.policy_live_prod_tmp.json');
  fs.writeFileSync(tmp, JSON.stringify(policy), 'utf8');
  console.log('[policy-sync] 写入正式站 KV…');
  const put = run('npx', ['wrangler', 'kv', 'key', 'put', KEY, '--namespace-id=' + PROD_KV, '--path', tmp]);
  try { fs.unlinkSync(tmp); } catch (_e) {}
  if (put.status !== 0) {
    console.error('[policy-sync] 写入正式站 KV 失败:\n' + (put.stderr || put.stdout || ''));
    process.exit(1);
  }
  console.log('[policy-sync] OK：测站策略 → 文件 + 正式 KV');
}

main();
