/**
 * 将 AI 视觉整理后的 name / meta 写入肖像沙盒单课 JSON，并重建统合清单。
 * 用法：node scripts/portrait-apply-meta-batch.js path/to/meta-batch.json
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const dir = path.join(repoRoot, 'docs', 'json', '沙盒_肖像光影沙盒');
const batchPath = process.argv[2];
if (!batchPath) {
  console.error('usage: node scripts/portrait-apply-meta-batch.js <batch.json>');
  process.exit(1);
}

const batch = JSON.parse(fs.readFileSync(batchPath, 'utf8'));
const items = Array.isArray(batch) ? batch : (batch.items || []);
let updated = 0;

for (const row of items) {
  const n = Number(row.n);
  if (!n) continue;
  const pad = String(n).padStart(2, '0');
  const candidates = [
    `${n}_${pad}.json`,
    `${n}_${n}.json`,
    `${pad}_${pad}.json`
  ];
  let file = null;
  for (const c of candidates) {
    const p = path.join(dir, c);
    if (fs.existsSync(p)) { file = p; break; }
  }
  if (!file) {
    // numeric prefix search
    const hit = fs.readdirSync(dir).find((name) => name.startsWith(n + '_') && name.endsWith('.json'));
    if (hit) file = path.join(dir, hit);
  }
  if (!file) {
    console.warn('missing file for', n);
    continue;
  }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (row.name != null) data.name = String(row.name);
  if (!data.meta || typeof data.meta !== 'object') data.meta = {};
  const m = data.meta;
  if (row.material) { m.material = row.material; m.category = row.material; }
  if (row.gender) m.gender = row.gender;
  if (row.age) m.age = row.age;
  if (row.region) m.region = row.region;
  if (row.detail != null) m.detail = String(row.detail);
  fs.writeFileSync(file, JSON.stringify(data));
  updated += 1;
  console.log('updated', path.basename(file), '->', data.name);
}

const rebuild = spawnSync(process.execPath, [path.join(__dirname, 'rebuild-portrait-index.js')], {
  cwd: path.join(__dirname, '..'),
  encoding: 'utf8'
});
process.stdout.write(rebuild.stdout || '');
process.stderr.write(rebuild.stderr || '');
console.log(JSON.stringify({ updated, rebuildStatus: rebuild.status }, null, 2));
process.exit(rebuild.status === 0 ? 0 : 1);
