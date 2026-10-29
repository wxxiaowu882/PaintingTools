/**
 * 肖像沙盒 87：男老年胸像 → 塞内卡，并归入「画室常用」。
 * 用法：node scripts/portrait-patch-87-seneca-studio.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const dir = path.join(repoRoot, 'docs', 'json', '沙盒_肖像光影沙盒');
const scenePath = path.join(dir, '87_87.json');

const data = JSON.parse(fs.readFileSync(scenePath, 'utf8'));
const before = {
  name: data.name,
  material: data.meta && data.meta.material,
  category: data.meta && data.meta.category,
  detail: data.meta && data.meta.detail
};

data.name = '塞内卡';
data.meta = data.meta && typeof data.meta === 'object' ? data.meta : {};
data.meta.material = '画室常用';
data.meta.category = '画室常用';
data.meta.gender = data.meta.gender || '男';
data.meta.age = data.meta.age || '老年';
data.meta.region = data.meta.region || '西方';
data.meta.detail = '塞内卡石膏胸像（画室俗称海盗 / Pseudo-Seneca）。石膏 · 男 · 老年 · 西方';
if (data.uid == null) data.uid = '87';

fs.writeFileSync(scenePath, JSON.stringify(data));

const rebuild = spawnSync(process.execPath, [path.join(__dirname, 'rebuild-portrait-index.js')], {
  cwd: path.join(__dirname, '..'),
  encoding: 'utf8'
});
process.stdout.write(rebuild.stdout || '');
process.stderr.write(rebuild.stderr || '');

const after = {
  name: data.name,
  material: data.meta.material,
  category: data.meta.category,
  detail: data.meta.detail
};
console.log(JSON.stringify({ before, after, rebuildStatus: rebuild.status }, null, 2));
process.exit(rebuild.status === 0 ? 0 : 1);
