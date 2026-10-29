#!/usr/bin/env node
/**
 * afterShellExecution: if shell output looks like wait/FAILED, leave a marker
 * so stop hook can inject one smart resume followup.
 */
'use strict';

const fs = require('fs');
const {
  writeMarker,
  textLooksLikeShellFail,
  collectShellText,
} = require('./auto-resume-marker.js');

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
    process.stdout.write('{}');
    return;
  }

  const text = collectShellText(input);
  const exitCode = input.exit_code ?? input.exitCode ?? input.code;
  const failedExit =
    exitCode !== undefined &&
    exitCode !== null &&
    Number(exitCode) !== 0 &&
    !Number.isNaN(Number(exitCode));

  if (!textLooksLikeShellFail(text) && !failedExit) {
    process.stdout.write('{}');
    return;
  }

  // Avoid marking every non-zero exit (too noisy). Prefer explicit FAIL patterns;
  // only use exit code when command looks like a wait/poll helper.
  const cmd = String(input.command || '');
  const waitish = /AwaitShell|notify_on_output|block_until|Waited\s+for/i.test(
    cmd + '\n' + text
  );
  if (!textLooksLikeShellFail(text) && !(failedExit && waitish)) {
    process.stdout.write('{}');
    return;
  }

  const roots = Array.isArray(input.workspace_roots)
    ? input.workspace_roots
    : [];
  writeMarker(roots, {
    reason: textLooksLikeShellFail(text) ? 'shell_fail_pattern' : 'waitish_nonzero',
    command: cmd.slice(0, 240),
    snippet: text.replace(/\s+/g, ' ').slice(0, 280),
  });

  process.stdout.write('{}');
}

main();
