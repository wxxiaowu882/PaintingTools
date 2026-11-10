#!/usr/bin/env node
/**
 * 只读拉取测站 MEMBERSHIP_KV 的 policy_live → docs/membership/.policy_live_staging_pull.json
 * （不写 KV；供 name→uid 迁移作底稿）
 *
 * 用法：node docs/membership/pull-policy-staging.mjs
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const STAGING_KV = '050dc9b4fa834d27918dd32f54ecde09';
const OUT = path.join(__dirname, '.policy_live_staging_pull.json');

function escapeCmdArg(a) {
  const s = String(a);
  if (/[\s"&<>^|]/u.test(s)) return '"' + s.replace(/"/g, '\\"') + '"';
  return s;
}

function runNpx(args) {
  const base = {
    encoding: 'utf8',
    cwd: REPO,
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  };
  if (process.platform === 'win32') {
    const line = 'npx ' + args.map(escapeCmdArg).join(' ');
    return spawnSync('cmd.exe', ['/d', '/s', '/c', line], base);
  }
  return spawnSync('npx', args, base);
}

const get = runNpx(['wrangler', 'kv', 'key', 'get', 'policy_live', '--namespace-id=' + STAGING_KV]);
const out = String(get.stdout || '') + String(get.stderr || '');
if (get.error) {
  console.error('无法启动 wrangler:', get.error.message);
  process.exit(1);
}
if (get.status !== 0) {
  console.error('读取测站失败:\n' + out.trim());
  process.exit(1);
}
const raw = String(get.stdout || '').trim();
if (!raw.startsWith('{') && !raw.startsWith('[')) {
  console.error('测站内容不是 JSON:\n' + raw.slice(0, 400));
  process.exit(1);
}
const doc = JSON.parse(raw);
fs.writeFileSync(OUT, JSON.stringify(doc, null, 2) + '\n', 'utf8');
const keys = Object.keys(doc.resources || {});
const scene = keys.filter((k) => k.startsWith('scene:'));
const bySb = {};
for (const k of scene) {
  const m = k.match(/^scene:([^:]+):/);
  const sb = m ? m[1] : '?';
  bySb[sb] = (bySb[sb] || 0) + 1;
}
console.log(
  JSON.stringify(
    {
      out: OUT,
      version: doc.version,
      updated: doc.updated,
      defaultRequire: doc.defaultRequire,
      totalResources: keys.length,
      sceneKeys: scene.length,
      nameKeys: scene.filter((k) => k.includes(':name:')).length,
      uidKeys: scene.filter((k) => k.includes(':uid:')).length,
      bySandbox: bySb,
    },
    null,
    2
  )
);
