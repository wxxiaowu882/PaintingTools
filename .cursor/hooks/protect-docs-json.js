#!/usr/bin/env node
/**
 * preToolUse: block Agent Write/StrReplace/Delete on authoritative docs/json.
 * Production scripts via Shell are not blocked here.
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

function normalizePath(p) {
  return String(p || '')
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '');
}

/** True if path is under docs/json (repo-relative or absolute). */
function isDocsJsonPath(p) {
  const n = normalizePath(p);
  if (!n) return false;
  if (/(^|\/)docs\/json(\/|$)/i.test(n)) return true;
  // Windows absolute with mixed separators already normalized
  if (/\/docs\/json(\/|$)/i.test(n)) return true;
  return false;
}

function extractPaths(toolInput) {
  if (!toolInput || typeof toolInput !== 'object') return [];
  const keys = ['path', 'file_path', 'target_file', 'filePath'];
  const out = [];
  for (const k of keys) {
    if (typeof toolInput[k] === 'string' && toolInput[k]) out.push(toolInput[k]);
  }
  if (Array.isArray(toolInput.paths)) {
    for (const p of toolInput.paths) {
      if (typeof p === 'string') out.push(p);
    }
  }
  return out;
}

function main() {
  let input = {};
  const raw = readStdin();
  try {
    input = raw ? JSON.parse(raw) : {};
  } catch {
    process.stdout.write(JSON.stringify({ permission: 'allow' }));
    return;
  }

  const toolName = String(input.tool_name || input.tool || '');
  const mutating =
    /^(Write|StrReplace|Delete|EditNotebook)$/i.test(toolName) ||
    /write|strreplace|delete|editnotebook/i.test(toolName);

  if (!mutating) {
    process.stdout.write(JSON.stringify({ permission: 'allow' }));
    return;
  }

  const toolInput = input.tool_input || input.input || {};
  const paths = extractPaths(toolInput);
  const hit = paths.find(isDocsJsonPath);

  if (hit) {
    const msg =
      '已拦截：禁止用手改 `docs/json` 权威产物。请走生产工具/既有生成脚本；消费端只做基础容错。';
    process.stdout.write(
      JSON.stringify({
        permission: 'deny',
        user_message: msg,
        agent_message:
          msg +
          ' 若确需更新 JSON，应运行生产端导出/合并脚本，而不是 Write/StrReplace/Delete 直接改文件。路径：' +
          hit,
      })
    );
    return;
  }

  process.stdout.write(JSON.stringify({ permission: 'allow' }));
}

main();
