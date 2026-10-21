/**
 * 为肖像光影沙盒新增单课（克隆既有课相机/灯光骨架 + 换 GLB/name/meta）
 * 用法：node scripts/portrait-add-scenes-from-glb.js path/to/batch.json
 * batch: { items: [{ n, name, glb, material, gender, age, region, detail, templateN? }] }
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const dir = path.join(repoRoot, 'docs', 'json', '沙盒_肖像光影沙盒');
const modelDir = path.join(repoRoot, 'docs', 'model');
const batchPath = process.argv[2];
if (!batchPath) {
  console.error('usage: node scripts/portrait-add-scenes-from-glb.js <batch.json>');
  process.exit(1);
}

const batch = JSON.parse(fs.readFileSync(batchPath, 'utf8'));
const items = Array.isArray(batch) ? batch : (batch.items || []);

function loadTemplate(n) {
  const pad = String(n).padStart(2, '0');
  const candidates = [`${n}_${pad}.json`, `${n}_${n}.json`, `${pad}_${pad}.json`];
  for (const c of candidates) {
    const p = path.join(dir, c);
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  }
  const hit = fs.readdirSync(dir).find((name) => name.startsWith(n + '_') && name.endsWith('.json'));
  if (hit) return JSON.parse(fs.readFileSync(path.join(dir, hit), 'utf8'));
  throw new Error('template missing for ' + n);
}

const tinyThumb =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGfAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//Z';

let added = 0;
for (const row of items) {
  const n = Number(row.n);
  if (!n) continue;
  const glbName = String(row.glb || '').replace(/^.*[\\/]/, '');
  const glbAbs = path.join(modelDir, glbName);
  if (!fs.existsSync(glbAbs)) {
    console.warn('missing glb', glbName);
    continue;
  }
  const outName = `${n}_${n}.json`;
  const outPath = path.join(dir, outName);
  if (fs.existsSync(outPath) && !row.overwrite) {
    console.warn('exists skip', outName);
    continue;
  }
  const tpl = loadTemplate(row.templateN || 27);
  const data = JSON.parse(JSON.stringify(tpl));
  data.name = String(row.name);
  data.thumbnail = tinyThumb;
  data.meta = data.meta && typeof data.meta === 'object' ? data.meta : {};
  data.meta.material = row.material || '石膏';
  data.meta.category = row.material || '石膏';
  if (row.gender) data.meta.gender = row.gender;
  if (row.age) data.meta.age = row.age;
  if (row.region) data.meta.region = row.region;
  if (row.detail != null) data.meta.detail = String(row.detail);
  const url = '/docs/model/' + glbName;
  if (!Array.isArray(data.items) || !data.items.length) {
    data.items = [{ type: 'glb', url, pos: [0, 0, 0], rot: [0, 0, 0], scale: [10, 10, 10], mat: 'origin' }];
  } else {
    const glb = data.items.find((x) => x && x.type === 'glb') || data.items[0];
    glb.type = 'glb';
    glb.url = url;
    glb.mat = glb.mat || 'origin';
  }
  fs.writeFileSync(outPath, JSON.stringify(data));
  added += 1;
  console.log('added', outName, '->', data.name, glbName);
}

const rebuild = spawnSync(process.execPath, [path.join(__dirname, 'rebuild-portrait-index.js')], {
  cwd: path.join(__dirname, '..'),
  encoding: 'utf8'
});
process.stdout.write(rebuild.stdout || '');
process.stderr.write(rebuild.stderr || '');
console.log(JSON.stringify({ added, rebuildStatus: rebuild.status }, null, 2));
process.exit(rebuild.status === 0 ? 0 : 1);
