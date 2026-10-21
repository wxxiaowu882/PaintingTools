/**
 * 头部造型规律：取消「欧男大本 = 参考模」身份。
 * - 删除 meta.modelRole（不再区分 reference / contrast）
 * - 去掉解析文案中「对比个体…参考模（欧男大本）…」整段
 *
 * 用法：node scripts/headform-equalize-models.js [--dry-run]
 */
'use strict';

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const masterName = '沙盒_头部造型规律.json';
const dryRun = process.argv.includes('--dry-run');

const PLAIN_RE =
  /\n*\s*本场景是同一课的对比个体（[^）\n]+）。点位框架与参考模（[^）\n]+）一致，请对照凹凸强弱与宽窄差异。\s*/g;
const RICH_RE =
  /(?:<br\s*\/?>|\n)*\s*本场景是同一课的对比个体（[^）<]+）。点位框架与参考模（[^）<]+）一致，请对照凹凸强弱与宽窄差异。\s*/gi;

function listSceneFiles() {
  return fs.readdirSync(jsonDir).filter((n) => {
    return n.endsWith('.json') && n !== masterName && /^\d{1,10}[A-Za-z]?_/.test(n);
  });
}

function cleanText(s, isRich) {
  if (s == null) return s;
  let t = String(s);
  t = t.replace(isRich ? RICH_RE : PLAIN_RE, '');
  // 收尾多余空行 / 尾部 br
  t = t.replace(/(\r?\n){3,}/g, '\n\n').replace(/(?:<br\s*\/?>\s*){3,}/gi, '<br><br>');
  t = t.replace(/(?:\r?\n)+$/g, '').replace(/(?:<br\s*\/?>\s*)+$/gi, '');
  return t;
}

let touched = 0;
let roleCleared = 0;
let textCleared = 0;
const samples = [];

for (const name of listSceneFiles()) {
  const fp = path.join(jsonDir, name);
  const data = JSON.parse(fs.readFileSync(fp, 'utf8'));
  if (!data.meta || typeof data.meta !== 'object') data.meta = {};
  let changed = false;

  if (data.meta.modelRole != null) {
    delete data.meta.modelRole;
    roleCleared += 1;
    changed = true;
  }

  const beforeKp = data.meta.keyPoints;
  const beforeKpr = data.meta.keyPointsRich;
  const beforeDetail = data.meta.detail;

  if (beforeKp != null) {
    const next = cleanText(beforeKp, false);
    if (next !== beforeKp) {
      data.meta.keyPoints = next;
      textCleared += 1;
      changed = true;
    }
  }
  if (beforeKpr != null) {
    const next = cleanText(beforeKpr, true);
    if (next !== beforeKpr) {
      data.meta.keyPointsRich = next;
      changed = true;
    }
  }
  if (beforeDetail != null) {
    const next = cleanText(beforeDetail, false);
    if (next !== beforeDetail) {
      data.meta.detail = next;
      changed = true;
    }
  }

  if (changed) {
    touched += 1;
    if (samples.length < 6) samples.push(name);
    if (!dryRun) fs.writeFileSync(fp, JSON.stringify(data));
  }
}

console.log(JSON.stringify({
  dryRun,
  touched,
  roleCleared,
  textCleared,
  samples
}, null, 2));
