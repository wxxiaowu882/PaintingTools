/**
 * 自大本参考关种子「光头亚裔」对比套（17 槽）
 * - 清空标注/虚线，等待 screen remap
 * - 写全 modelId / modelRole / modelLabel
 * - 文案追加「对比个体（光头亚裔）」段
 * 用法：SCALE=5.8 node scripts/headform-seed-bald-asian.js
 */
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');
const MODEL_URL = '/docs/model/真人头像_男_光头亚裔侧脸01_opt.glb';
const MODEL_ID = 'male_bald_asian_01';
const MODEL_LABEL = '光头亚裔';
const SCALE = Number(process.env.SCALE || '5.8');
const RE = /^(\d+[A-Za-z]?)_(.+)\.json$/i;

const CONTRAST_PLAIN =
  '\n\n本场景是同一课的对比个体（光头亚裔）。点位框架与参考模（大本）一致，请对照凹凸强弱与宽窄差异。\n\n';
const CONTRAST_RICH =
  '<br><br>本场景是同一课的对比个体（光头亚裔）。点位框架与参考模（大本）一致，请对照凹凸强弱与宽窄差异。';

function listScenes() {
  return fs.readdirSync(jsonDir).filter((n) => RE.test(n));
}

function isReference(f, d) {
  if (d.meta && d.meta.modelRole === 'reference') return true;
  if (f.includes('女05') || f.includes('光头亚裔')) return false;
  if ((d.meta && d.meta.modelId) === 'female_05') return false;
  if ((d.meta && d.meta.modelId) === MODEL_ID) return false;
  const url = String((((d.items || [])[0] || {}).url) || '');
  return /大本|蝙蝠侠|布鲁斯/i.test(url) || !(d.meta && d.meta.modelId);
}

function rebuildAggregate() {
  function lessonNum(name) {
    const m = String(name).match(/^(\d+)/);
    return m ? Number(m[1]) : 0;
  }
  const all = listScenes();
  all.sort((a, b) => {
    const ma = a.match(RE);
    const mb = b.match(RE);
    const na = lessonNum(ma[1]);
    const nb = lessonNum(mb[1]);
    if (na !== nb) return na - nb;
    const la = ma[1].replace(/^\d+/, '');
    const lb = mb[1].replace(/^\d+/, '');
    if (la !== lb) return la.localeCompare(lb, 'zh-CN');
    const da = JSON.parse(fs.readFileSync(path.join(jsonDir, a), 'utf8'));
    const db = JSON.parse(fs.readFileSync(path.join(jsonDir, b), 'utf8'));
    const ra = da.meta && da.meta.modelRole === 'reference' ? 0 : 1;
    const rb = db.meta && db.meta.modelRole === 'reference' ? 0 : 1;
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b, 'zh-CN', { numeric: true });
  });
  fs.writeFileSync(
    path.join(jsonDir, '沙盒_头部造型规律.json'),
    JSON.stringify(all.map((n) => JSON.parse(fs.readFileSync(path.join(jsonDir, n), 'utf8'))))
  );
  return all.length;
}

const created = [];
for (const f of listScenes()) {
  const d = JSON.parse(fs.readFileSync(path.join(jsonDir, f), 'utf8'));
  if (!isReference(f, d)) continue;
  const m = f.match(RE);
  const lesson = m[1];
  const rest = m[2];
  const outName = `${lesson}_光头亚裔_${rest}.json`;
  const outPath = path.join(jsonDir, outName);
  const slot = (d.meta && d.meta.slot) || '';
  const clone = JSON.parse(JSON.stringify(d));
  clone.id = `${slot}_${MODEL_ID}`;
  clone.meta = Object.assign({}, clone.meta || {}, {
    modelId: MODEL_ID,
    modelRole: 'contrast',
    modelLabel: MODEL_LABEL,
    status: 'seed_contrast'
  });
  let kp = String(clone.meta.keyPoints || '');
  let kpr = String(clone.meta.keyPointsRich || '');
  if (!kp.includes('对比个体（光头亚裔）')) {
    kp = kp.replace(/\n+$/, '') + CONTRAST_PLAIN;
  }
  if (!kpr.includes('对比个体（光头亚裔）')) {
    kpr = kpr.replace(/(<br>\s*)+$/i, '') + CONTRAST_RICH;
  }
  clone.meta.keyPoints = kp;
  clone.meta.keyPointsRich = kpr;
  if (clone.env) clone.env.lightIndicatorEnabled = false;
  const item = clone.items && clone.items[0];
  if (!item) throw new Error('no item in ' + f);
  item.url = MODEL_URL;
  item.pos = [0, 0, 0];
  item.rot = [0, 0, 0];
  item.scale = [SCALE, SCALE, SCALE];
  item.mat = 'origin';
  item.annotations = [];
  item.dashedLines = [];
  fs.writeFileSync(outPath, JSON.stringify(clone));
  created.push(outName);
  console.log('[seed]', outName, 'slot', slot, 'scale', SCALE);
}

const n = rebuildAggregate();
console.log('[seed] DONE created', created.length, 'aggregate', n);
