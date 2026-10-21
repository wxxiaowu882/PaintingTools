/**
 * 叶问：欧男叶问 → 亚男叶问（文件名 + modelLabel + 文案中的旧标签）
 * 用法：node scripts/headform-rename-ipman-to-yaman.js [--dry-run]
 */
'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const masterName = '沙盒_头部造型规律.json';
const dryRun = process.argv.includes('--dry-run');
const OLD = '欧男叶问';
const NEW = '亚男叶问';

function listScenes() {
  return fs.readdirSync(jsonDir).filter((n) => {
    return n.endsWith('.json') && n !== masterName && /^\d{1,10}[A-Za-z]?_/.test(n);
  });
}

const plan = [];
for (const name of listScenes()) {
  if (!name.includes(OLD) && !name.includes('叶问')) continue;
  const neu = name.split(OLD).join(NEW);
  const fp = path.join(jsonDir, name);
  const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
  const meta = data.meta && typeof data.meta === 'object' ? data.meta : (data.meta = {});
  let changed = name !== neu || meta.modelLabel === OLD || JSON.stringify(data).includes(OLD);
  plan.push({ old: name, neu, changed, label: meta.modelLabel });
}

console.log(JSON.stringify({ dryRun, plan: plan.length, sample: plan.slice(0, 5) }, null, 2));
if (dryRun) process.exit(0);

for (const p of plan) {
  const oldPath = path.join(jsonDir, p.old);
  const data = JSON.parse(fs.readFileSync(oldPath, 'utf8'));
  data.meta = data.meta || {};
  data.meta.modelLabel = NEW;
  const blob = JSON.stringify(data);
  const fixed = JSON.parse(blob.split(OLD).join(NEW));
  // ensure modelId untouched if somehow replaced (shouldn't)
  if (data.meta.modelId) fixed.meta.modelId = data.meta.modelId;
  if (data.id) fixed.id = data.id;
  const newPath = path.join(jsonDir, p.neu);
  fs.writeFileSync(newPath, JSON.stringify(fixed));
  if (p.old !== p.neu && fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
}

console.log(JSON.stringify({ wrote: plan.length, ok: true }, null, 2));
