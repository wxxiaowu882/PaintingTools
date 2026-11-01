/**
 * 按生产端 mergeAllScenes 规则，合成「沙盒_肖像光影沙盒」统合清单。
 * 可选：删除近重复单课（--dedupe）。
 * 用法：
 *   node scripts/rebuild-portrait-index.js
 *   node scripts/rebuild-portrait-index.js --dedupe
 */
'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const dir = path.join(repoRoot, 'docs', 'json', '沙盒_肖像光影沙盒');
const masterName = '沙盒_肖像光影沙盒.json';

/** 2A 近重复：保留石膏白女01、高模 Baby Head；去掉低模副本 */
const DEDUPE_REMOVE = ['70_70.json', '72_72.json'];

const doDedupe = process.argv.includes('--dedupe');
if (doDedupe) {
  for (const name of DEDUPE_REMOVE) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
      console.log('removed', name);
    } else {
      console.log('skip missing', name);
    }
  }
}

const names = fs.readdirSync(dir).filter((name) => {
  return name.endsWith('.json') && /^\d+/.test(name) && name !== masterName;
});
names.sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));

const merged = [];
const skipped = [];
for (const name of names) {
  const text = fs.readFileSync(path.join(dir, name), 'utf8');
  try {
    merged.push(JSON.parse(text));
  } catch (e) {
    skipped.push(name + ': ' + e.message);
  }
}

/** uid 碰撞会让列表编号错乱（如多课同显「71 ·」）；缺 uid 则口头报号失效 */
const uidMap = new Map();
const uidCollisions = [];
const missingUid = [];
for (let i = 0; i < merged.length; i++) {
  const sc = merged[i];
  const file = names[i];
  const uid = sc && sc.uid != null ? String(sc.uid).trim() : '';
  if (!uid) {
    missingUid.push(file + ':' + ((sc && sc.name) || '?'));
    continue;
  }
  if (uidMap.has(uid)) {
    uidCollisions.push({ uid, a: uidMap.get(uid), b: file + ':' + ((sc && sc.name) || '?') });
  } else {
    uidMap.set(uid, file + ':' + ((sc && sc.name) || '?'));
  }
}
if (uidCollisions.length) {
  console.error('[rebuild-portrait-index] FATAL uid collisions:', JSON.stringify(uidCollisions, null, 2));
  process.exit(1);
}
if (missingUid.length) {
  console.warn('[rebuild-portrait-index] WARN missing uid:', missingUid.slice(0, 20));
}

const outPath = path.join(dir, masterName);
fs.writeFileSync(outPath, JSON.stringify(merged));

console.log(JSON.stringify({
  dedupe: doDedupe,
  files: names.length,
  merged: merged.length,
  skipped,
  uidCount: uidMap.size,
  missingUid: missingUid.length,
  out: outPath
}, null, 2));
