/**
 * 欧女/欧男全流水线：按槽顺序跑 auto-slot，失败槽用 fix 补钉，写进度文件。
 * MODEL_ID=female_euro_02 MODEL_LABEL=欧女 node scripts/headform-euro-pipeline.js
 */
require('./_playwright-browsers-path');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const MODEL_ID = process.env.MODEL_ID;
const MODEL_LABEL = process.env.MODEL_LABEL;
if (!MODEL_ID || !MODEL_LABEL) {
  console.error('Need MODEL_ID MODEL_LABEL');
  process.exit(1);
}

const SLOTS = (process.env.SLOTS || 'V06,V07,V02,V01,V03,V04,V05a,V05b,L05,L01,L09,L02,L03,L06,L08,L04,L07')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const progressPath = path.join(
  __dirname,
  '..',
  'runs',
  `_euro-pipeline-${MODEL_LABEL}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
);
const progress = { MODEL_ID, MODEL_LABEL, started: new Date().toISOString(), slots: [] };
fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2));

function runNode(script, extraEnv) {
  const env = {
    ...process.env,
    PLAYWRIGHT_CHANNEL: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    MODEL_ID,
    MODEL_LABEL,
    PORT: process.env.PORT || '18080',
    // 流水线默认跳过 teach/propose 截图，只保留 verify，加快批量定点
    SKIP_TEACH: process.env.SKIP_TEACH || '1',
    SKIP_PROPOSE_SHOT: process.env.SKIP_PROPOSE_SHOT || '1',
    // 默认精扫；显式 FAST=1 才粗扫（V01 粗扫曾大面积空候选）
    FAST: process.env.FAST || '0',
    ...extraEnv
  };
  // 单槽时清掉父进程遗留的 SLOTS，避免 auto-slot 一次跑完全表
  if (extraEnv && extraEnv.SLOT && !extraEnv.SLOTS) {
    delete env.SLOTS;
    delete env.ALL_V;
  }
  const r = spawnSync(process.execPath, [path.join(__dirname, script)], {
    cwd: __dirname,
    env,
    stdio: 'inherit'
  });
  return r.status === 0;
}

for (const slot of SLOTS) {
  console.log('\n######## SLOT', slot, MODEL_LABEL, '########');
  const ok = runNode('headform-vision-auto-slot.js', { SLOT: slot });
  const entry = { slot, autoOk: ok, at: new Date().toISOString() };
  if (!ok) {
    console.log('auto failed, try whole-slot fix', slot);
    entry.fixOk = runNode('headform-vision-fix.js', { SLOT: slot, FORCE: '1' });
  }
  progress.slots.push(entry);
  progress.updated = new Date().toISOString();
  fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2));
}

progress.finished = new Date().toISOString();
fs.writeFileSync(progressPath, JSON.stringify(progress, null, 2));
console.log('PIPELINE DONE', progressPath);
const fails = progress.slots.filter((s) => !s.autoOk && !s.fixOk);
process.exit(fails.length ? 1 : 0);
