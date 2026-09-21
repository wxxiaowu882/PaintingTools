#!/usr/bin/env node
/**
 * beforeShellExecution: block obvious hand-edits that redirect/write into docs/json.
 * Production scripts that write JSON internally (no shell redirect) are allowed.
 */
'use strict';

const fs = require('fs');

function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function main() {
  let input = {};
  try {
    input = JSON.parse(readStdin() || '{}');
  } catch {
    process.stdout.write(JSON.stringify({ permission: 'allow' }));
    return;
  }

  const cmd = String(input.command || '');
  const n = cmd.replace(/\\/g, '/');

  if (!/docs\/json\//i.test(n)) {
    process.stdout.write(JSON.stringify({ permission: 'allow' }));
    return;
  }

  const denyPatterns = [
    /(?:^|[;&|]\s*)(?:cat|tee|echo|printf)\b[\s\S]{0,200}(?:>|>>)\s*["']?[^"'|;]*docs\/json\//i,
    /(?:>|>>)\s*["']?[^"'|;]*docs\/json\//i,
    /\bsed\b[\s\S]{0,80}-i[\s\S]{0,120}docs\/json\//i,
    /\b(?:cp|mv|copy|Copy-Item|Move-Item)\b[\s\S]{0,240}docs\/json\//i,
    /\b(?:Set-Content|Add-Content|Out-File|ni|New-Item)\b[\s\S]{0,160}docs\/json\//i,
    /\b(?:python|node|ruby)\s+-c\b[\s\S]{0,200}docs\/json\//i,
  ];

  if (denyPatterns.some((re) => re.test(n))) {
    const msg =
      '已拦截：Shell 疑似手改 `docs/json`。请用生产工具/仓库内生成脚本，不要重定向、复制或 sed 直接写权威 JSON。';
    process.stdout.write(
      JSON.stringify({
        permission: 'deny',
        user_message: msg,
        agent_message: msg + ' 命令：' + cmd.slice(0, 240),
      })
    );
    return;
  }

  process.stdout.write(JSON.stringify({ permission: 'allow' }));
}

main();
