#!/usr/bin/env node
/**
 * 正式站 MEMBERSHIP_KV 加密备份 → 历史备份文件/membership-kv/（已 gitignore）
 *
 * 用法（仓库根）：
 *   node docs/membership/backup-membership-kv.mjs
 *   node docs/membership/backup-membership-kv.mjs --env=staging
 *   node docs/membership/backup-membership-kv.mjs --decrypt=路径.enc.json
 *
 * 环境变量：
 *   SKIP_KV_BACKUP=1     跳过（供发版 bat）
 *   REQUIRE_KV_BACKUP=1  失败时非 0 退出（默认失败也 exit 1；发版 bat 可选择不阻断）
 *
 * 加密钥：历史备份文件/membership-kv/_backup.key（首次自动生成；勿提交 git）
 * 也可设 MEMBERSHIP_KV_BACKUP_KEY=64位hex（32字节）覆盖文件钥。
 */
import { spawnSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');

const PROD_KV = 'e556d7993e374d31bc8d693a6273f337';
const STAGING_KV = '050dc9b4fa834d27918dd32f54ecde09';

const OUT_DIR = path.join(REPO, '历史备份文件', 'membership-kv');
const KEY_FILE = path.join(OUT_DIR, '_backup.key');
const BULK_CHUNK = 80;
/** 限速桶无恢复价值，跳过以缩小备份 */
const SKIP_PREFIXES = ['rl:'];

function parseArgs(argv) {
  const out = { env: 'prod', decrypt: '', help: false };
  for (const a of argv.slice(2)) {
    if (a === '--help' || a === '-h') out.help = true;
    else if (a === '--env=staging' || a === '--staging') out.env = 'staging';
    else if (a === '--env=prod' || a === '--prod') out.env = 'prod';
    else if (a.startsWith('--decrypt=')) out.decrypt = a.slice('--decrypt='.length);
    else if (a === '--decrypt' && argv[argv.indexOf(a) + 1]) {
      out.decrypt = argv[argv.indexOf(a) + 1];
    }
  }
  return out;
}

function escapeCmdArg(a) {
  const s = String(a);
  if (/[\s"&<>^|]/u.test(s)) return '"' + s.replace(/"/g, '\\"') + '"';
  return s;
}

function runNpx(args) {
  const base = {
    encoding: 'utf8',
    cwd: REPO,
    maxBuffer: 64 * 1024 * 1024,
    windowsHide: true
  };
  if (process.platform === 'win32') {
    const line = 'npx ' + args.map(escapeCmdArg).join(' ');
    return spawnSync('cmd.exe', ['/d', '/s', '/c', line], base);
  }
  return spawnSync('npx', args, base);
}

function combinedOut(r) {
  return String((r && r.stdout) || '') + String((r && r.stderr) || '');
}

function ensureOutDir() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

function loadOrCreateKey() {
  const envHex = String(process.env.MEMBERSHIP_KV_BACKUP_KEY || '').trim();
  if (/^[0-9a-fA-F]{64}$/.test(envHex)) {
    return Buffer.from(envHex, 'hex');
  }
  ensureOutDir();
  if (fs.existsSync(KEY_FILE)) {
    const raw = fs.readFileSync(KEY_FILE, 'utf8').trim();
    if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, 'hex');
    const buf = fs.readFileSync(KEY_FILE);
    if (buf.length === 32) return buf;
    throw new Error('密钥文件格式无效：' + KEY_FILE);
  }
  const key = crypto.randomBytes(32);
  fs.writeFileSync(KEY_FILE, key.toString('hex') + '\n', { encoding: 'utf8', mode: 0o600 });
  console.log('[kv-backup] 已生成加密钥（勿提交 git）：', path.relative(REPO, KEY_FILE));
  return key;
}

function encryptPayload(plainObj, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plain = Buffer.from(JSON.stringify(plainObj), 'utf8');
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    alg: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: enc.toString('base64'),
    meta: {
      createdAt: new Date().toISOString(),
      keyCount: plainObj && plainObj.keys ? Object.keys(plainObj.keys).length : 0,
      env: plainObj && plainObj.env,
      namespaceId: plainObj && plainObj.namespaceId
    }
  };
}

function decryptFile(encPath, key) {
  const raw = JSON.parse(fs.readFileSync(encPath, 'utf8'));
  if (!raw || raw.v !== 1 || raw.alg !== 'aes-256-gcm') {
    throw new Error('不支持的备份格式');
  }
  const iv = Buffer.from(raw.iv, 'base64');
  const tag = Buffer.from(raw.tag, 'base64');
  const data = Buffer.from(raw.ciphertext, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(data), decipher.final()]);
  return JSON.parse(plain.toString('utf8'));
}

function listAllKeys(namespaceId) {
  const names = [];
  // 分前缀拉取，降低单次 list 截断风险（账号/码量上来后更稳）
  const prefixes = ['acct:', 'phone:', 'code:', 'promo:', 'refaward:', 'ops:', 'stats:day:', 'policy_', 'tiers_'];
  const seen = new Set();
  function ingest(arr) {
    for (const item of arr) {
      const name = item && item.name != null ? String(item.name) : '';
      if (!name || seen.has(name)) continue;
      if (SKIP_PREFIXES.some((p) => name.startsWith(p))) continue;
      seen.add(name);
      names.push(name);
    }
  }
  for (const prefix of prefixes) {
    const r = runNpx([
      'wrangler',
      'kv',
      'key',
      'list',
      '--namespace-id=' + namespaceId,
      '--prefix=' + prefix,
      '--remote'
    ]);
    if (r.status !== 0) {
      throw new Error('kv key list 失败 (' + prefix + '):\n' + combinedOut(r).trim());
    }
    const text = String((r && r.stdout) || '').trim();
    let arr;
    try {
      arr = JSON.parse(text);
    } catch (_e) {
      throw new Error('kv key list 非 JSON (' + prefix + '):\n' + text.slice(0, 500));
    }
    if (!Array.isArray(arr)) throw new Error('kv key list 结果不是数组 (' + prefix + ')');
    ingest(arr);
    if (arr.length >= 1000) {
      console.warn('[kv-backup] 前缀', prefix, '一次 list 达 1000，可能有截断；请稍后检查或联系加分页');
    }
  }
  return names.sort();
}

function extractJsonBlob(text) {
  const s = String(text || '');
  const startObj = s.indexOf('{');
  const startArr = s.indexOf('[');
  let start = -1;
  let end = -1;
  if (startObj >= 0 && (startArr < 0 || startObj < startArr)) {
    start = startObj;
    end = s.lastIndexOf('}');
  } else if (startArr >= 0) {
    start = startArr;
    end = s.lastIndexOf(']');
  }
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(s.slice(start, end + 1));
  } catch (_e) {
    return null;
  }
}

function getOne(namespaceId, k, map) {
  const one = runNpx([
    'wrangler',
    'kv',
    'key',
    'get',
    k,
    '--namespace-id=' + namespaceId,
    '--remote'
  ]);
  if (one.status !== 0) {
    console.warn('[kv-backup] 跳过读失败键:', k);
    return;
  }
  map[k] = String(one.stdout || '');
}

function bulkGet(namespaceId, keyNames) {
  const map = Object.create(null);
  const tmpDir = path.join(OUT_DIR, '.tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  for (let i = 0; i < keyNames.length; i += BULK_CHUNK) {
    const chunk = keyNames.slice(i, i + BULK_CHUNK);
    const listFile = path.join(tmpDir, 'keys-' + i + '.json');
    fs.writeFileSync(listFile, JSON.stringify(chunk), 'utf8');
    const r = runNpx([
      'wrangler',
      'kv',
      'bulk',
      'get',
      listFile,
      '--namespace-id=' + namespaceId,
      '--remote'
    ]);
    if (r.status !== 0) {
      console.warn('[kv-backup] bulk get 失败，回退逐条 get（本批 ' + chunk.length + '）');
      for (const k of chunk) getOne(namespaceId, k, map);
      continue;
    }
    // wrangler 常在 JSON 后追加 "Success!"，需截取对象
    const parsed = extractJsonBlob(String(r.stdout || ''));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      Object.keys(parsed).forEach((k) => {
        if (parsed[k] == null) {
          getOne(namespaceId, k, map);
        } else {
          map[k] = typeof parsed[k] === 'string' ? parsed[k] : JSON.stringify(parsed[k]);
        }
      });
      continue;
    }
    console.warn('[kv-backup] bulk 输出无法解析，回退逐条');
    for (const k of chunk) getOne(namespaceId, k, map);
  }
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (_eRm) {}
  return map;
}

function stampName() {
  const d = new Date();
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return (
    d.getFullYear() +
    p(d.getMonth() + 1) +
    p(d.getDate()) +
    '-' +
    p(d.getHours()) +
    p(d.getMinutes()) +
    p(d.getSeconds())
  );
}

async function runBackup(envName) {
  const namespaceId = envName === 'staging' ? STAGING_KV : PROD_KV;
  console.log('[kv-backup] 环境:', envName, 'namespace:', namespaceId);
  ensureOutDir();
  const key = loadOrCreateKey();
  console.log('[kv-backup] 列出键…');
  const names = listAllKeys(namespaceId);
  console.log('[kv-backup] 键数（已跳过 rl:）:', names.length);
  console.log('[kv-backup] 拉取值…');
  const values = bulkGet(namespaceId, names);
  const got = Object.keys(values).length;
  console.log('[kv-backup] 已取值:', got);
  const payload = {
    format: 'paintingtools-membership-kv-v1',
    exportedAt: new Date().toISOString(),
    timezoneNote: 'timestamps in values are unix ms; day stats use Asia/Shanghai',
    env: envName,
    namespaceId: namespaceId,
    skippedPrefixes: SKIP_PREFIXES,
    keyCount: got,
    keys: values
  };
  const enc = encryptPayload(payload, key);
  const base = 'membership-kv-' + envName + '-' + stampName();
  const encPath = path.join(OUT_DIR, base + '.enc.json');
  fs.writeFileSync(encPath, JSON.stringify(enc, null, 2), 'utf8');
  // 旁路小清单（无敏感值）：方便目录扫一眼
  const manifest = {
    file: path.basename(encPath),
    env: envName,
    namespaceId: namespaceId,
    keyCount: got,
    createdAt: enc.meta.createdAt,
    sampleKeys: names.slice(0, 12)
  };
  fs.writeFileSync(path.join(OUT_DIR, base + '.manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  console.log('[kv-backup] OK →', path.relative(REPO, encPath));
  console.log('[kv-backup] 解密预览：node docs/membership/backup-membership-kv.mjs --decrypt="' + encPath + '"');
  try {
    appendRemoteBackupHistory(namespaceId, {
      at: enc.meta.createdAt,
      env: envName,
      file: path.basename(encPath),
      manifestFile: base + '.manifest.json',
      keyCount: got,
      localDir: '历史备份文件/membership-kv/',
      keyFile: '历史备份文件/membership-kv/_backup.key',
      trigger: process.env.KV_BACKUP_TRIGGER || 'manual'
    });
  } catch (eHist) {
    console.warn('[kv-backup] 写入运营台备份记录失败（加密文件已生成）:', eHist && eHist.message ? eHist.message : eHist);
  }
  return { ok: true, encPath: encPath, keyCount: got };
}

const HISTORY_KEY = 'ops:backup_history';
const MAX_HISTORY = 40;

/** 把摘要写入同环境 KV，供运营台展示（不含密文） */
function appendRemoteBackupHistory(namespaceId, entry) {
  // --text：避免二进制模式；键名带冒号时用引号更稳
  const get = runNpx([
    'wrangler',
    'kv',
    'key',
    'get',
    HISTORY_KEY,
    '--namespace-id=' + namespaceId,
    '--remote',
    '--text'
  ]);
  let entries = [];
  const getOut = combinedOut(get);
  if (get.status === 0) {
    const text = String(get.stdout || '').trim();
    if (text && !/value not found|404/i.test(text)) {
      const parsed = extractJsonBlob(text);
      if (parsed && Array.isArray(parsed.entries)) entries = parsed.entries.slice();
    }
  } else if (!/404|not found/i.test(getOut)) {
    console.warn('[kv-backup] 读备份记录失败，将覆盖写新列表:', getOut.trim().slice(0, 200));
  }
  entries.unshift(entry);
  if (entries.length > MAX_HISTORY) entries = entries.slice(0, MAX_HISTORY);
  const body = {
    updatedAt: new Date().toISOString(),
    entries: entries
  };
  const json = JSON.stringify(body);
  // 用系统临时目录 + 正斜杠路径；仓库中文路径作 --path 在 Windows 不可靠
  const tmp = path.join(os.tmpdir(), 'pt-membership-backup-history-' + process.pid + '.json');
  fs.writeFileSync(tmp, json, 'utf8');
  const tmpArg = tmp.replace(/\\/g, '/');
  const put = runNpx([
    'wrangler',
    'kv',
    'key',
    'put',
    HISTORY_KEY,
    '--namespace-id=' + namespaceId,
    '--remote',
    '--path=' + tmpArg
  ]);
  try {
    fs.unlinkSync(tmp);
  } catch (_eUn) {}
  const putOut = combinedOut(put);
  if (put.status !== 0) {
    throw new Error(putOut.trim() || 'kv put failed');
  }
  if (!/Writing the contents|Success/i.test(putOut) && putOut.trim()) {
    console.log('[kv-backup] put 输出:', putOut.trim().slice(0, 300));
  }
  console.log('[kv-backup] 已写入运营台备份记录（', HISTORY_KEY, '）共', entries.length, '条');
}

function runDecrypt(encPath) {
  const abs = path.isAbsolute(encPath) ? encPath : path.join(REPO, encPath);
  if (!fs.existsSync(abs)) throw new Error('找不到文件: ' + abs);
  const key = loadOrCreateKey();
  const plain = decryptFile(abs, key);
  const out = abs.replace(/\.enc\.json$/i, '') + '.decrypted.json';
  fs.writeFileSync(out, JSON.stringify(plain, null, 2), 'utf8');
  console.log('[kv-backup] 已解密（含敏感数据，勿外传）→', path.relative(REPO, out));
  console.log('[kv-backup] 键数:', plain.keyCount || (plain.keys && Object.keys(plain.keys).length));
  return { ok: true, out: out };
}

async function main() {
  if (String(process.env.SKIP_KV_BACKUP || '') === '1') {
    console.log('[kv-backup] SKIP_KV_BACKUP=1，跳过');
    process.exit(0);
  }
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(`Usage:
  node docs/membership/backup-membership-kv.mjs [--env=prod|staging]
  node docs/membership/backup-membership-kv.mjs --decrypt=历史备份文件/membership-kv/xxx.enc.json
输出目录: 历史备份文件/membership-kv/
密钥文件: 历史备份文件/membership-kv/_backup.key`);
    process.exit(0);
  }
  try {
    if (args.decrypt) {
      runDecrypt(args.decrypt);
    } else {
      await runBackup(args.env);
    }
    process.exit(0);
  } catch (e) {
    console.error('[kv-backup] FAILED:', e && e.message ? e.message : e);
    process.exit(1);
  }
}

main();
