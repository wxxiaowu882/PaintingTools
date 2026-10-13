/**
 * 将欧男全系列场景 GLB 俯仰统一为与 102_欧男 相同的 rot.x（默认 +3° / 0.052）
 * 仅改 items[].type==='glb' 的 rot[0]，保留 rot[1]/rot[2]。
 *
 * 用法：
 *   node scripts/headform-patch-ouman-pitch-all.js
 *   DEG=3 node scripts/headform-patch-ouman-pitch-all.js
 *   DRY=1 node scripts/headform-patch-ouman-pitch-all.js
 */
const fs = require('fs');
const path = require('path');
const lib = require('./headform-vision-place-lib');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const deg = Number(process.env.DEG != null ? process.env.DEG : 3);
const dry = process.env.DRY === '1' || process.env.DRY === 'true';
if (!Number.isFinite(deg)) {
  console.error('DEG must be a number');
  process.exit(1);
}
const rx = Number(((deg * Math.PI) / 180).toFixed(3));

const files = fs
  .readdirSync(jsonDir)
  .filter((n) => n.includes('欧男') && n.endsWith('.json'))
  .sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }));

if (!files.length) {
  console.error('no 欧男 scene files');
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
  const after = [rx, Number(before[1] || 0), Number(before[2] || 0)];
  item.rot = after;
  if (!dry) fs.writeFileSync(fp, JSON.stringify(data), 'utf8');
  report.push({ file: name, before, after });
}

if (!dry) lib.rebuildAggregate();

console.log(
  JSON.stringify(
    {
      deg,
      rx,
      dry,
      count: report.length,
      aggregate: dry ? 'skipped' : 'rebuilt',
      report
    },
    null,
    2
  )
);
