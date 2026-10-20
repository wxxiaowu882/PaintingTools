/**
 * 按生产端 mergeAllScenes 规则，把「沙盒_头部造型规律」下
 * 以数字开头的单课 JSON 合成统合清单。
 * 用法：node scripts/rebuild-headform-index.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const dir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const masterName = '沙盒_头部造型规律.json';

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

const lines = { view: 0, light: 0, other: 0 };
for (const s of merged) {
  const line = s && s.meta ? s.meta.line : '';
  if (line === 'view' || line === 'light') lines[line] += 1;
  else lines.other += 1;
}

console.log(JSON.stringify({
  files: names.length,
  merged: merged.length,
  skipped,
  lines,
  out: outPath
}, null, 2));
