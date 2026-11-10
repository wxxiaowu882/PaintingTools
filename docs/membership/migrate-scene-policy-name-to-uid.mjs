#!/usr/bin/env node
/**
 * 场景权限键：scene:{sandbox}:name:课名 → scene:{sandbox}:uid:短号
 *
 * 口径：课表显示模块内短号；权限 ID = 模块 + 短号（跨模块可同号）。
 * 底稿默认：docs/membership/access-policy.json（测站/正式 KV 的 policy_live 当前为空时以此为准）。
 *
 * 用法（仓库根）：
 *   node docs/membership/migrate-scene-policy-name-to-uid.mjs --dry-run
 *   node docs/membership/migrate-scene-policy-name-to-uid.mjs
 *   node docs/membership/migrate-scene-policy-name-to-uid.mjs --in docs/membership/.policy_static_test_pull.json
 *
 * 选项：
 *   --keep-name   迁完后保留旧 name 键作双读兜底（默认保留）
 *   --drop-name   匹配成功的旧 name 键删除（孤儿 name 仍保留）
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');

const args = process.argv.slice(2);
const dry = args.includes('--dry-run');
const dropName = args.includes('--drop-name');
const keepName = !dropName; // 默认保留
const inIdx = args.indexOf('--in');
const inPath =
  inIdx >= 0 && args[inIdx + 1]
    ? path.resolve(REPO, args[inIdx + 1])
    : path.join(__dirname, 'access-policy.json');
const outPath = inPath;

const CATALOGS = {
  geometry: path.join(REPO, 'docs/json/沙盒_几何体静物/沙盒_几何体静物.json'),
  geometrysketch: path.join(REPO, 'docs/json/沙盒_几何体静物写生/沙盒_几何体静物写生.json'),
  portrait: path.join(REPO, 'docs/json/沙盒_肖像光影沙盒/沙盒_肖像光影沙盒.json'),
  headform: path.join(REPO, 'docs/json/沙盒_头部造型规律/沙盒_头部造型规律.json'),
};

/** Portrait_c 解剖/五官：JSON 无 uid 字段，用文件号当模块内短号 */
const MANUAL_NAME_TO_UID = {
  'scene:anatomy:name:头骨详解': '01',
  'scene:anatomy:name:骨点详解': '02',
  'scene:anatomy:name:肌肉详解': '03',
  'scene:facial:name:耳朵详解': '01',
  'scene:facial:name:鼻子详解': '02',
  'scene:facial:name:嘴巴详解': '03',
  'scene:facial:name:眼眉详解': '04',
  'scene:facial:name:五官综合详解': '05',
};

/** 同名多课（headform 多头模）→ 一条旧 name 规则要复制到全部 uid */
function loadNameToUids(sandbox, filePath) {
  const list = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const map = new Map(); // name -> string[] uids (unique, stable order)
  let multiName = 0;
  for (const s of Array.isArray(list) ? list : []) {
    const name = s && s.name != null ? String(s.name).trim() : '';
    const uid = s && s.uid != null ? String(s.uid).trim() : '';
    if (!name || !uid) continue;
    if (!map.has(name)) map.set(name, []);
    const arr = map.get(name);
    if (!arr.includes(uid)) arr.push(uid);
  }
  for (const [, arr] of map) {
    if (arr.length > 1) multiName += 1;
  }
  return { map, multiName };
}

const bySandbox = {};
const multiNameStats = {};
for (const [sb, p] of Object.entries(CATALOGS)) {
  const { map, multiName } = loadNameToUids(sb, p);
  bySandbox[sb] = map;
  multiNameStats[sb] = multiName;
}

const raw = JSON.parse(fs.readFileSync(inPath, 'utf8'));
const resources = Object.assign({}, raw.resources || {});
const report = {
  in: inPath,
  dry,
  keepName,
  matched: [],
  manual: [],
  orphans: [],
  alreadyUid: [],
  nonScene: 0,
  multiNameStats,
  expandedMulti: 0,
};

const next = {};
for (const [key, rule] of Object.entries(resources)) {
  if (!key.startsWith('scene:')) {
    next[key] = rule;
    report.nonScene += 1;
    continue;
  }
  if (key.includes(':uid:')) {
    next[key] = rule;
    report.alreadyUid.push(key);
    continue;
  }
  const m = key.match(/^scene:([^:]+):name:(.*)$/);
  if (!m) {
    next[key] = rule;
    report.orphans.push({ key, reason: 'unrecognized-scene-key' });
    continue;
  }
  const sb = m[1];
  const name = m[2];
  let uids = [];
  if (MANUAL_NAME_TO_UID[key]) {
    uids = [MANUAL_NAME_TO_UID[key]];
    report.manual.push({ key, uid: uids[0] });
  } else if (bySandbox[sb] && bySandbox[sb].has(name)) {
    uids = bySandbox[sb].get(name).slice();
    report.matched.push({ key, uids, name });
    if (uids.length > 1) report.expandedMulti += 1;
  } else {
    next[key] = rule;
    report.orphans.push({ key, reason: 'no-uid-mapping' });
    continue;
  }
  for (const uid of uids) {
    const nk = 'scene:' + sb + ':uid:' + uid;
    // 同名多 uid：共享旧 name 档位；后写覆盖同键（同档无妨）
    next[nk] = Object.assign({}, rule, {
      label: (rule && rule.label) || name || uid,
    });
  }
  if (keepName) next[key] = rule;
}

raw.resources = next;
raw.updated = new Date().toISOString().slice(0, 10);
if (!raw.version) raw.version = 2;
raw.version = Number(raw.version) || 2;
// 标记 schema，便于运营识别
raw.sceneKeyScheme = 'sandbox+uid';

const summary = {
  matchedNameKeys: report.matched.length,
  manual: report.manual.length,
  expandedMultiNameKeys: report.expandedMulti,
  orphans: report.orphans.length,
  alreadyUid: report.alreadyUid.length,
  nonScene: report.nonScene,
  multiNameStats: report.multiNameStats,
  orphanKeys: report.orphans.map((o) => o.key),
  uidSceneKeys: Object.keys(next).filter((k) => k.includes(':uid:')).length,
  nameSceneKeys: Object.keys(next).filter((k) => k.includes(':name:')).length,
};

console.log(JSON.stringify({ summary, sampleMatched: report.matched.slice(0, 3) }, null, 2));

const reportPath = path.join(__dirname, '.migrate-scene-name-to-uid-report.json');
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log('report', reportPath);

if (dry) {
  console.log('dry-run: no write');
  process.exit(0);
}

fs.writeFileSync(outPath, JSON.stringify(raw, null, 2) + '\n', 'utf8');
console.log('wrote', outPath);
