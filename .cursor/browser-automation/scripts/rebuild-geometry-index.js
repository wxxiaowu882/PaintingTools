/**
 * 把「沙盒_几何体静物」下以数字开头的单课 JSON 合成统合清单。
 * 用法：node scripts/rebuild-geometry-index.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const dir = path.join(repoRoot, 'docs', 'json', '沙盒_几何体静物');
const masterName = '沙盒_几何体静物.json';

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

const outPath = path.join(dir, masterName);
fs.writeFileSync(outPath, JSON.stringify(merged));

console.log(JSON.stringify({
  files: names.length,
  merged: merged.length,
  skipped,
  out: outPath
}, null, 2));
