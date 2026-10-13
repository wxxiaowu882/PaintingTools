/**
 * 仅修正 102_欧男 场景 GLB 俯仰：rot.x = +3°（约 0.052 rad）
 * 依据：脸局部约朝 +Z 时，+rot.x = 鼻尖下压/收后仰 → 更近「目光平视」；
 * 同课 102_叶问 已用正 rot.x（0.094）纠姿态。确认后再铺其它欧男。
 *
 * 用法：node scripts/headform-patch-ouman-pitch-102.js
 * 可选：DEG=3 或 DEG=-3（若方向反了）
 */
const fs = require('fs');
const path = require('path');
const lib = require('./headform-vision-place-lib');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const fileName = '102_欧男_【外轮廓规律】正面.json';
const filePath = path.join(jsonDir, fileName);

const deg = Number(process.env.DEG != null ? process.env.DEG : 3);
if (!Number.isFinite(deg)) {
  console.error('DEG must be a number');
  process.exit(1);
}
const rx = Number(((deg * Math.PI) / 180).toFixed(3));

const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
const item = (data.items || []).find((it) => it && it.type === 'glb');
if (!item) {
  console.error('no glb item in', fileName);
  process.exit(1);
}
const before = Array.isArray(item.rot) ? item.rot.slice() : [0, 0, 0];
item.rot = [rx, Number(before[1] || 0), Number(before[2] || 0)];
fs.writeFileSync(filePath, JSON.stringify(data), 'utf8');
lib.rebuildAggregate();

console.log(
  JSON.stringify(
    {
      file: fileName,
      deg,
      rotBefore: before,
      rotAfter: item.rot,
      aggregate: 'rebuilt'
    },
    null,
    2
  )
);
