/**
 * 将「头骨详解 / 骨点详解」的 modelSrc 切到加密 baked 模型。
 * 用法：node .cursor/browser-automation/scripts/portrait-patch-skull-baked-model.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const dir = path.join(repoRoot, 'docs', 'json', '结构_头骨骨点肌肉');
const NEW_SRC = '../docs/m/头骨_Skull Parts_opt_baked_opt.png';
const FILES = ['01 头骨详解.json', '02 骨点详解.json'];

const updated = [];
for (const name of FILES) {
  const file = path.join(dir, name);
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const prev = data.modelSrc;
  data.modelSrc = NEW_SRC;
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
  updated.push({ file: name, prev, next: data.modelSrc });
}

console.log(JSON.stringify({ ok: true, updated }, null, 2));
