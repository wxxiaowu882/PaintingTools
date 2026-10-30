#!/usr/bin/env node
/**
 * 轻伪装：docs/json 内 docs/model → docs/m（受控脚本，带备份）
 *
 *   node docs/membership/rewrite-model-dir-to-m.mjs --dry-run
 *   node docs/membership/rewrite-model-dir-to-m.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const JSON_ROOT = path.join(REPO, 'docs/json');

function walkJson(dir, acc = []) {
  for (const n of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, n.name);
    if (n.isDirectory()) walkJson(p, acc);
    else if (n.isFile() && /\.json$/i.test(n.name)) acc.push(p);
  }
  return acc;
}

function rewriteText(text) {
  // 覆盖 /docs/model、docs/model、../docs/model 等
  const re = /(^|[^A-Za-z0-9_])(\/?|(?:\.\.\/)+)docs\/model\//g;
  let n = 0;
  const after = text.replace(re, (full, pre, lead) => {
    n++;
    return pre + lead + 'docs/m/';
  });
  return { after, n };
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const files = walkJson(JSON_ROOT);
  const touched = [];
  let total = 0;
  for (const fp of files) {
    const before = fs.readFileSync(fp, 'utf8');
    const { after, n } = rewriteText(before);
    if (n > 0 && after !== before) {
      touched.push({ file: path.relative(REPO, fp).replace(/\\/g, '/'), n });
      total += n;
    }
  }

  if (dryRun) {
    console.log(JSON.stringify({ dryRun: true, filesTouched: touched.length, total, sample: touched.slice(0, 15) }, null, 2));
    return;
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupRoot = path.join(REPO, '.cursor/browser-automation/runs', `model-dir-m-json-backup-${ts}`);
  fs.mkdirSync(backupRoot, { recursive: true });
  for (const t of touched) {
    const abs = path.join(REPO, t.file);
    const dest = path.join(backupRoot, t.file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(abs, dest);
  }
  for (const t of touched) {
    const abs = path.join(REPO, t.file);
    const before = fs.readFileSync(abs, 'utf8');
    const { after } = rewriteText(before);
    fs.writeFileSync(abs, after, 'utf8');
  }
  console.log(
    JSON.stringify(
      {
        dryRun: false,
        ok: true,
        backupRoot: path.relative(REPO, backupRoot).replace(/\\/g, '/'),
        filesTouched: touched.length,
        total
      },
      null,
      2
    )
  );
}

main();
