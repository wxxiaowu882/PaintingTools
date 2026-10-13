/**
 * 欧女/欧男：外轮廓 ALL_V + 交界 L01–L09 视觉定点
 * MODEL_ID=female_euro_02 MODEL_LABEL=欧女 node scripts/headform-run-euro-vision.js
 */
require('./_playwright-browsers-path');
const { spawnSync } = require('child_process');
const path = require('path');

const MODEL_ID = process.env.MODEL_ID;
const MODEL_LABEL = process.env.MODEL_LABEL;
if (!MODEL_ID || !MODEL_LABEL) {
  console.error('Need MODEL_ID MODEL_LABEL');
  process.exit(1);
}

const env = {
  ...process.env,
  PLAYWRIGHT_CHANNEL: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
  MODEL_ID,
  MODEL_LABEL,
  PORT: process.env.PORT || '18080'
};

function run(label, extraEnv) {
  console.log('\n========', label, '========');
  const r = spawnSync(process.execPath, [path.join(__dirname, 'headform-vision-auto-slot.js')], {
    cwd: __dirname,
    env: { ...env, ...extraEnv },
    stdio: 'inherit',
    timeout: 0
  });
  console.log('======== done', label, 'status', r.status);
  return r.status === 0;
}

const okV = run('ALL_V', { ALL_V: '1' });
const okL = run('ALL_L', { SLOTS: 'L05,L01,L09,L02,L03,L06,L08,L04,L07' });
console.log(JSON.stringify({ MODEL_ID, MODEL_LABEL, okV, okL }, null, 2));
process.exit(okV && okL ? 0 : 1);
