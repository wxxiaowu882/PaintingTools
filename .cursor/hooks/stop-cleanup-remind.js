#!/usr/bin/env node
/**
 * stop: if browser-automation/runs has likely temp artifacts, ask agent once to clean.
 * Does not delete files itself (safer); followup_message triggers one cleanup pass.
 */
'use strict';

const fs = require('fs');
const path = require('path');

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function listTempHints(runsDir) {
  if (!fs.existsSync(runsDir)) return [];
  let names = [];
  try {
    names = fs.readdirSync(runsDir);
  } catch {
    return [];
  }
  const re =
    /^(?:_tmp_|tmp-|test_|pw_|debug-|bezier-diag|after-|before-|cmp-)/i;
  return names.filter((n) => re.test(n)).slice(0, 12);
}

function main() {
  let input = {};
  try {
    input = JSON.parse(readStdin() || '{}');
  } catch {
    process.stdout.write('{}');
    return;
  }

  // Only nudge on successful completion; avoid loops on abort/error
  if (input.status && input.status !== 'completed') {
    process.stdout.write('{}');
    return;
  }

  // loop_count: already followed up N times
  if (Number(input.loop_count || 0) > 0) {
    process.stdout.write('{}');
    return;
  }

  const roots = Array.isArray(input.workspace_roots)
    ? input.workspace_roots
    : [];
  const root = roots[0] || process.cwd();
  const runsDir = path.join(
    root,
    '.cursor',
    'browser-automation',
    'runs'
  );
  const hits = listTempHints(runsDir);

  if (!hits.length) {
    process.stdout.write('{}');
    return;
  }

  const followup_message =
    '会话将结束：检测到 `.cursor/browser-automation/runs/` 下可能有过程文件（例如：' +
    hits.slice(0, 5).join(', ') +
    '）。请立即删除其中**不影响后续任务**的无用截图/临时输出；有价值的最终证据可保留。清理完简短确认即可，勿改业务代码。';

  process.stdout.write(JSON.stringify({ followup_message }));
}

main();
