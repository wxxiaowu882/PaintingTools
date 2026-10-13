/**
 * 202–209 欧男：在现有 rot.x 上再加 +2°（默认），保留 y/z
 * 用法：node scripts/headform-patch-ouman-pitch-202-209.js
 * 可选：ADD_DEG=2
 */
const fs = require('fs');
const path = require('path');
const lib = require('./headform-vision-place-lib');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const addDeg = Number(process.env.ADD_DEG != null ? process.env.ADD_DEG : 2);
if (!Number.isFinite(addDeg)) {
  console.error('ADD_DEG must be a number');
  process.exit(1);
}
const addRx = (addDeg * Math.PI) / 180;

const files = fs
  .readdirSync(jsonDir)
  .filter((n) => {
    if (!n.includes('欧男') || !n.endsWith('.json')) return false;
    const m = n.match(/^(\d+)/);
    if (!m) return false;
    const num = Number(m[1]);
    return num >= 202 && num <= 209;
  })
  .sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));

if (!files.length) {
  console.error('no matching 202-209 欧男 files');
  process.exit(1);
}

const report = [];
for (const name of files) {
  const fp = path.join(jsonDir, name);
  const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const item = (data.items || []).find((it) => it && it.type === 'glb');
  if (!item) {
    report.push({ file: name, skipped: 'no glb' });
    continue;
  }
  const before = Array.isArray(item.rot) ? item.rot.slice() : [0, 0, 0];
  const after = [
    Number((Number(before[0] || 0) + addRx).toFixed(3)),
    Number(before[1] || 0),
    Number(before[2] || 0)
  ];
  item.rot = after;
  fs.writeFileSync(fp, JSON.stringify(data), 'utf8');
  report.push({ file: name, before, after });
}

lib.rebuildAggregate();
console.log(JSON.stringify({ addDeg, addRx: Number(addRx.toFixed(6)), count: report.length, report }, null, 2));
