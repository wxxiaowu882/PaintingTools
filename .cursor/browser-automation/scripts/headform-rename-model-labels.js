/**
 * 头部造型规律：按新个体标签重命名单关文件，并回填 meta.modelLabel/modelId/modelRole。
 * 合规：经 node 脚本写 docs/json（非手改）。
 *
 * 用法：
 *   node scripts/headform-rename-model-labels.js --dry-run
 *   node scripts/headform-rename-model-labels.js
 *   node scripts/rebuild-headform-index.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const masterName = '沙盒_头部造型规律.json';
const dryRun = process.argv.includes('--dry-run');

/** 旧文件名中缀 → 新标签（长 token 优先匹配） */
const TOKEN_MAP = [
  { old: '光头亚裔', label: '亚男A', modelId: 'male_bald_asian_01', role: 'contrast' },
  { old: '女05', label: '亚女A', modelId: 'female_05', role: 'contrast' },
  { old: '叶问', label: '亚男叶问', modelId: 'male_ipman_01', role: 'contrast' },
  { old: '欧男叶问', label: '亚男叶问', modelId: 'male_ipman_01', role: 'contrast' },
  { old: '欧女', label: '欧女A', modelId: 'female_euro_02', role: 'contrast' },
  { old: '欧男', label: '欧男亚伦', modelId: 'male_euro_aaron_01', role: 'contrast' }
];

const REF = { label: '欧男大本', modelId: 'male_daben', role: 'reference' };

const KP_REPLACES = [
  ['对比个体（光头亚裔）', '对比个体（亚男A）'],
  ['对比个体（女05）', '对比个体（亚女A）'],
  ['对比个体（叶问）', '对比个体（亚男叶问）'],
  ['对比个体（欧男叶问）', '对比个体（亚男叶问）'],
  ['对比个体（欧女）', '对比个体（欧女A）'],
  ['对比个体（欧男）', '对比个体（欧男亚伦）'],
  ['参考模（大本）', '参考模（欧男大本）']
];

function listSceneFiles() {
  return fs.readdirSync(jsonDir).filter((n) => {
    return n.endsWith('.json') && n !== masterName && /^\d{1,10}[A-Za-z]?_/.test(n);
  });
}

function parseOld(name) {
  const m = String(name).match(/^(\d{1,10}[A-Za-z]?)_(.+)\.json$/i);
  if (!m) return null;
  const lesson = m[1];
  const rest = m[2];
  for (let i = 0; i < TOKEN_MAP.length; i++) {
    const tok = TOKEN_MAP[i];
    if (rest.indexOf(tok.old + '_') === 0) {
      return {
        lesson,
        oldToken: tok.old,
        titleRest: rest.slice(tok.old.length + 1),
        label: tok.label,
        modelId: tok.modelId,
        role: tok.role
      };
    }
  }
  // 参考体：无个体中缀，rest 以【开头
  if (/^【/.test(rest)) {
    return {
      lesson,
      oldToken: '',
      titleRest: rest,
      label: REF.label,
      modelId: REF.modelId,
      role: REF.role
    };
  }
  // 已是新名则跳过识别失败
  return null;
}

function applyKp(text) {
  let s = String(text == null ? '' : text);
  for (let i = 0; i < KP_REPLACES.length; i++) {
    const [a, b] = KP_REPLACES[i];
    if (s.indexOf(a) >= 0) s = s.split(a).join(b);
  }
  return s;
}

function patchData(data, info) {
  if (!data || typeof data !== 'object') return data;
  data.meta = data.meta && typeof data.meta === 'object' ? data.meta : {};
  data.meta.modelLabel = info.label;
  data.meta.modelId = info.modelId;
  data.meta.modelRole = info.role;
  const slot = data.meta.slot != null ? String(data.meta.slot) : '';
  if (slot) data.id = slot + '_' + info.modelId;
  else if (data.id == null || String(data.id).indexOf(info.modelId) < 0) {
    data.id = info.modelId;
  }
  // 修 105A 叶问误写成 aaron id
  if (info.modelId === 'male_ipman_01' && String(data.id || '').indexOf('male_euro_aaron') >= 0) {
    data.id = (slot || 'V05a') + '_male_ipman_01';
  }
  if (data.meta.keyPoints != null) data.meta.keyPoints = applyKp(data.meta.keyPoints);
  if (data.meta.keyPointsRich != null) data.meta.keyPointsRich = applyKp(data.meta.keyPointsRich);
  return data;
}

const files = listSceneFiles();
const plan = [];
const skipped = [];
const already = [];

for (const f of files) {
  // 已是新标签前缀
  if (
    /_(欧男大本|亚男A|亚女A|欧男亚伦|欧女A|亚男叶问|欧男叶问)_/.test(f) ||
    /^\d+[A-Za-z]?_欧男大本_【/.test(f)
  ) {
    already.push(f);
    continue;
  }
  const info = parseOld(f);
  if (!info) {
    skipped.push(f);
    continue;
  }
  const newName = info.lesson + '_' + info.label + '_' + info.titleRest + '.json';
  plan.push({ old: f, neu: newName, info });
}

// 冲突检测
const targets = new Set();
for (const p of plan) {
  if (targets.has(p.neu) || (p.old !== p.neu && fs.existsSync(path.join(jsonDir, p.neu)))) {
    console.error('冲突:', p.old, '->', p.neu);
    process.exit(1);
  }
  targets.add(p.neu);
}

console.log(JSON.stringify({
  dryRun,
  totalFiles: files.length,
  plan: plan.length,
  already: already.length,
  skipped,
  sample: plan.slice(0, 8).map((p) => p.old + ' => ' + p.neu)
}, null, 2));

if (dryRun) process.exit(0);

for (const p of plan) {
  const oldPath = path.join(jsonDir, p.old);
  const newPath = path.join(jsonDir, p.neu);
  const data = JSON.parse(fs.readFileSync(oldPath, 'utf8'));
  patchData(data, p.info);
  fs.writeFileSync(newPath, JSON.stringify(data));
  if (p.old !== p.neu) fs.unlinkSync(oldPath);
}

console.log(JSON.stringify({ wrote: plan.length, ok: true }, null, 2));
