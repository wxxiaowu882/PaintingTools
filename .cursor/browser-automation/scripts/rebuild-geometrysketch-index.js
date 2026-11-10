/**
 * 把「沙盒_几何体静物写生」下以数字开头的单课 JSON 合成统合清单。
 * 缺 uid 时按文件名前缀补写（防课表丢课）。
 * 用法：node .cursor/browser-automation/scripts/rebuild-geometrysketch-index.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const dir = path.join(repoRoot, 'docs', 'json', '沙盒_几何体静物写生');
const masterName = '沙盒_几何体静物写生.json';

function uidFromFileName(name) {
  // 与生产端 mergeAllScenes 一致：数字 + 可选字母后缀（如 2403b）
  const m = String(name || '').match(/^(\d{1,10}[A-Za-z]?)/);
  return m ? m[1] : '';
}

const names = fs.readdirSync(dir).filter((name) => {
  return name.endsWith('.json') && /^\d+/.test(name) && name !== masterName;
});
names.sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));

const merged = [];
const skipped = [];
const repaired = [];
const uids = new Map();

for (const name of names) {
  const fp = path.join(dir, name);
  const text = fs.readFileSync(fp, 'utf8');
  try {
    const obj = JSON.parse(text);
    const fileId = uidFromFileName(name);
    let id = obj && obj.uid != null ? String(obj.uid).trim() : '';
    // 文件号为权威：缺 uid 或与文件号不一致时，回写单课并按文件号进统合（防批量合并误写成 001/002）
    if (!fileId) {
      skipped.push(name + ': no numeric prefix');
      continue;
    }
    if (id !== fileId) {
      obj.uid = fileId;
      fs.writeFileSync(fp, JSON.stringify(obj));
      repaired.push(name + ': uid ' + (id || '(empty)') + ' -> ' + fileId);
      id = fileId;
    }
    if (uids.has(id)) {
      throw new Error('uid collision: ' + id + ' in ' + uids.get(id) + ' and ' + name);
    }
    uids.set(id, name);
    merged.push(obj);
  } catch (e) {
    if (String(e.message || e).startsWith('uid collision')) throw e;
    skipped.push(name + ': ' + e.message);
  }
}

const outPath = path.join(dir, masterName);
fs.writeFileSync(outPath, JSON.stringify(merged));

console.log(
  JSON.stringify(
    {
      files: names.length,
      merged: merged.length,
      skipped,
      repaired,
      out: outPath,
      around2403: names.filter((n) => /^2403/.test(n) || n.startsWith('2404')),
    },
    null,
    2
  )
);
