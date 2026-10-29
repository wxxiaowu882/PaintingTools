/**
 * Shared marker for "shell wait/tool failed → nudge Agent once on stop".
 * Marker lives under os.tmpdir so it is never committed.
 */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const FAIL_RE =
  /FAILED\s+in\s+shell|Waited\s+for\s+.+?\|FAILED|notify_on_output.+fail|timed?\s*out\s+waiting|AwaitShell.+fail/i;

function workspaceKey(roots) {
  const root = (Array.isArray(roots) && roots[0]) || process.cwd();
  return crypto.createHash('sha1').update(String(root)).digest('hex').slice(0, 12);
}

function markerPath(roots) {
  return path.join(os.tmpdir(), `cursor-pt-auto-resume-${workspaceKey(roots)}.json`);
}

function writeMarker(roots, payload) {
  const file = markerPath(roots);
  const body = {
    at: new Date().toISOString(),
    ...payload,
  };
  fs.writeFileSync(file, JSON.stringify(body), 'utf8');
  return file;
}

function readMarker(roots) {
  const file = markerPath(roots);
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function clearMarker(roots) {
  const file = markerPath(roots);
  try {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  } catch {
    /* ignore */
  }
}

function textLooksLikeShellFail(text) {
  return FAIL_RE.test(String(text || ''));
}

function collectShellText(input) {
  if (!input || typeof input !== 'object') return '';
  const chunks = [];
  for (const k of [
    'output',
    'stdout',
    'stderr',
    'result',
    'error',
    'message',
    'command',
  ]) {
    const v = input[k];
    if (typeof v === 'string' && v) chunks.push(v);
  }
  if (input.result && typeof input.result === 'object') {
    for (const k of ['output', 'stdout', 'stderr', 'message']) {
      const v = input.result[k];
      if (typeof v === 'string' && v) chunks.push(v);
    }
  }
  return chunks.join('\n');
}

module.exports = {
  FAIL_RE,
  markerPath,
  writeMarker,
  readMarker,
  clearMarker,
  textLooksLikeShellFail,
  collectShellText,
};
