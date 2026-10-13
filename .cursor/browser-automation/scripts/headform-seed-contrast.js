/**
 * 通用：自大本参考关种子对比套（101–209 / 17 槽）
 *
 * 用法示例：
 *   MODEL_ID=female_euro_02 MODEL_LABEL=欧女 FILE_TOKEN=欧女 \
 *     MODEL_URL='/docs/model/石膏头像_女中青年_02_opt_石膏白.glb' \
 *     SCALE=5.8 node scripts/headform-seed-contrast.js
 *
 *   MODEL_ID=male_euro_aaron_01 MODEL_LABEL=欧男 FILE_TOKEN=欧男 \
 *     MODEL_URL='/docs/model/石膏头像_男中青年_AARON%20PAUL_opt.glb' \
 *     SCALE=5.8 node scripts/headform-seed-contrast.js
 */
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const jsonDir = path.join(repoRoot, 'docs', 'json', '沙盒_头部造型规律');

const MODEL_URL_RAW = process.env.MODEL_URL;
const MODEL_ID = process.env.MODEL_ID;
const MODEL_LABEL = process.env.MODEL_LABEL;
const FILE_TOKEN = process.env.FILE_TOKEN || MODEL_LABEL;
const SCALE = Number(process.env.SCALE || '5.8');
const RE = /^(\d+[A-Za-z]?)_(.+)\.json$/i;

/** Git Bash 会把 /docs/... 转成 D:/Git/docs/...；统一收成站点根路径 */
function normalizeModelUrl(u) {
  let x = String(u || '').trim().replace(/\\/g, '/');
  x = x.replace(/^[A-Za-z]:\/+Git\/docs\/model\//i, '/docs/model/');
  x = x.replace(/^[A-Za-z]:\/+.*\/docs\/model\//i, '/docs/model/');
  x = x.replace(/^(\.\.\/)+docs\/model\//i, '/docs/model/');
  if (x.startsWith('docs/model/')) x = '/' + x;
  if (!x.startsWith('/docs/model/')) {
    throw new Error('MODEL_URL must be under /docs/model/, got: ' + u);
  }
  // JSON 里保留真实空格；浏览器会自行编码
  x = x.replace(/%20/g, ' ');
  return x;
}

const KNOWN_TOKENS = ['女05', '光头亚裔', '叶问', '欧女', '欧男'];
const KNOWN_IDS = ['female_05', 'male_bald_asian_01', 'male_ipman_01', 'female_euro_02', 'male_euro_aaron_01'];

if (!MODEL_URL_RAW || !MODEL_ID || !MODEL_LABEL) {
  console.error('Need MODEL_URL, MODEL_ID, MODEL_LABEL');
  process.exit(1);
}

const MODEL_URL = normalizeModelUrl(MODEL_URL_RAW);

const CONTRAST_PLAIN =
  `\n\n本场景是同一课的对比个体（${MODEL_LABEL}）。点位框架与参考模（大本）一致，请对照凹凸强弱与宽窄差异。\n\n`;
const CONTRAST_RICH =
  `<br><br>本场景是同一课的对比个体（${MODEL_LABEL}）。点位框架与参考模（大本）一致，请对照凹凸强弱与宽窄差异。`;

function listScenes() {
  return fs.readdirSync(jsonDir).filter((n) => RE.test(n));
}

function isReference(f, d) {
  if (d.meta && d.meta.modelRole === 'reference') return true;
  if (KNOWN_TOKENS.some((t) => f.includes(t))) return false;
  if (d.meta && KNOWN_IDS.includes(d.meta.modelId)) return false;
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
  const outName = `${lesson}_${FILE_TOKEN}_${rest}.json`;
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
  const tag = `对比个体（${MODEL_LABEL}）`;
  if (!kp.includes(tag)) {
    kp = kp.replace(/\n+$/, '') + CONTRAST_PLAIN;
  }
  if (!kpr.includes(tag)) {
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
console.log('[seed] DONE', MODEL_LABEL, 'created', created.length, 'aggregate', n);
