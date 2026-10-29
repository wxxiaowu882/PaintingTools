#!/usr/bin/env node
/**
 * stop:
 * 1) If shell-fail marker (or abnormal stop status) → smart resume followup (最多连续 2 次)
 * 2) Else if completed and browser-automation/runs has temp artifacts → cleanup remind
 *
 * loop_limit in hooks.json = 2；脚本在 loop_count >= 2 时不再 followup。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const {
  readMarker,
  clearMarker,
} = require('./auto-resume-marker.js');

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

function isUserAbort(status) {
  const s = String(status || '').toLowerCase();
  return (
    s === 'aborted' ||
    s === 'abort' ||
    s === 'cancelled' ||
    s === 'canceled' ||
    s === 'stopped'
  );
}

function isErrorStop(status) {
  const s = String(status || '').toLowerCase();
  return (
    s === 'error' ||
    s === 'failed' ||
    s === 'failure' ||
    s === 'errored'
  );
}

function main() {
  let input = {};
  try {
    input = JSON.parse(readStdin() || '{}');
  } catch {
    process.stdout.write('{}');
    return;
  }

  const roots = Array.isArray(input.workspace_roots)
    ? input.workspace_roots
    : [];
  const status = input.status;

  // Already followed up twice in this stop-loop → stop chaining
  if (Number(input.loop_count || 0) >= 2) {
    clearMarker(roots);
    process.stdout.write('{}');
    return;
  }

  // User manually stopped → never auto-resume
  if (isUserAbort(status)) {
    clearMarker(roots);
    process.stdout.write('{}');
    return;
  }

  const marker = readMarker(roots);
  const shouldResume = Boolean(marker) || isErrorStop(status);

  if (shouldResume) {
    clearMarker(roots);
    const hint = marker && marker.snippet ? `（线索：${marker.snippet}）` : '';
    const followup_message =
      '上一轮因终端等待/工具失败中断' +
      hint +
      '。请根据已有终端与对话输出判断：关键步骤若已成功则只做收尾核对；未完成则从失败点续跑，勿重复已成功的部署/上传。不要再次死等同一段易超时的输出字符串；改用短轮询、查状态接口，或直接根据已打印的 URL/结果验收。';
    process.stdout.write(JSON.stringify({ followup_message }));
    return;
  }

  // Only nudge cleanup on successful completion
  if (status && status !== 'completed') {
    process.stdout.write('{}');
    return;
  }

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
