#!/usr/bin/env node
/**
 * 明文 .glb → 本地备份目录（默认 历史备份文件/，gitignore）→ 校验 → 再删 docs/m 明文。
 * 仅当每个 .glb 都有对应密文 .png 时才允许删除。
 *
 *   node docs/js/model-crypto/backup-then-delete-plain-glb.mjs --dry-run
 *   node docs/js/model-crypto/backup-then-delete-plain-glb.mjs
 *   node docs/js/model-crypto/backup-then-delete-plain-glb.mjs --backup-only
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const modelDir = path.join(repoRoot, 'docs/m');

function parseArgs(argv) {
  const out = {
    dryRun: false,
    backupOnly: false,
    stamp: new Date().toISOString().slice(0, 10)
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--backup-only') out.backupOnly = true;
    else if (a === '--stamp') out.stamp = argv[++i];
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

function listGlbs() {
  return fs
    .readdirSync(modelDir)
    .filter((f) => /\.glb$/i.test(f) && fs.statSync(path.join(modelDir, f)).isFile())
    .sort((a, b) => a.localeCompare(b, 'zh'));
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(
      'Usage: node docs/js/model-crypto/backup-then-delete-plain-glb.mjs [--dry-run] [--backup-only] [--stamp YYYY-MM-DD]'
    );
    process.exit(0);
  }

  const backupRoot = path.join(repoRoot, '历史备份文件', `model-glb-plain-${args.stamp}`);
  const glbs = listGlbs();
  const missingPng = [];
  for (const name of glbs) {
    const base = name.replace(/\.glb$/i, '');
    if (!fs.existsSync(path.join(modelDir, base + '.png'))) missingPng.push(name);
  }
  if (missingPng.length) {
    console.error(JSON.stringify({ ok: false, error: 'missing_png_for_glb', missingPng }, null, 2));
    process.exit(1);
  }

  if (args.dryRun) {
    let bytes = 0;
    for (const n of glbs) bytes += fs.statSync(path.join(modelDir, n)).size;
    console.log(
      JSON.stringify(
        {
          dryRun: true,
          ok: true,
          glbCount: glbs.length,
          bytesTotal: bytes,
          backupRoot: path.relative(repoRoot, backupRoot).replace(/\\/g, '/'),
          willDeleteAfterBackup: !args.backupOnly
        },
        null,
        2
      )
    );
    return;
  }

  fs.mkdirSync(backupRoot, { recursive: true });
  const copied = [];
  const errors = [];
  console.error(`[backup] ${glbs.length} → ${backupRoot}`);
  for (let i = 0; i < glbs.length; i++) {
    const name = glbs[i];
    const src = path.join(modelDir, name);
    const dest = path.join(backupRoot, name);
    try {
      fs.copyFileSync(src, dest);
      const ss = fs.statSync(src).size;
      const ds = fs.statSync(dest).size;
      if (ss !== ds) throw new Error('size mismatch ' + ss + ' vs ' + ds);
      copied.push({ name, bytes: ss });
    } catch (e) {
      errors.push({ name, error: String(e && e.message ? e.message : e) });
    }
    if ((i + 1) % 50 === 0 || i === glbs.length - 1) {
      console.error(`[backup] ${i + 1}/${glbs.length}`);
    }
  }

  if (errors.length || copied.length !== glbs.length) {
    const summary = { ok: false, stage: 'backup', copied: copied.length, errors };
    fs.writeFileSync(
      path.join(backupRoot, '_backup-manifest.json'),
      JSON.stringify(summary, null, 2),
      'utf8'
    );
    console.log(JSON.stringify(summary, null, 2));
    process.exit(1);
  }

  // 二次核对：备份目录文件数与逐文件大小
  const backupGlbs = fs.readdirSync(backupRoot).filter((f) => /\.glb$/i.test(f));
  if (backupGlbs.length !== glbs.length) {
    console.log(
      JSON.stringify(
        { ok: false, stage: 'verify_count', expected: glbs.length, actual: backupGlbs.length },
        null,
        2
      )
    );
    process.exit(1);
  }
  for (const name of glbs) {
    const ss = fs.statSync(path.join(modelDir, name)).size;
    const ds = fs.statSync(path.join(backupRoot, name)).size;
    if (ss !== ds) {
      console.log(JSON.stringify({ ok: false, stage: 'verify_size', name, ss, ds }, null, 2));
      process.exit(1);
    }
  }

  const bytesTotal = copied.reduce((a, b) => a + b.bytes, 0);
  const manifest = {
    summary: {
      ok: true,
      stamp: args.stamp,
      backupRoot: path.relative(repoRoot, backupRoot).replace(/\\/g, '/'),
      sourceCount: glbs.length,
      copiedCount: copied.length,
      bytesTotal,
      deletedFromModel: false
    },
    files: copied
  };
  fs.writeFileSync(path.join(backupRoot, '_backup-manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  if (args.backupOnly) {
    console.log(JSON.stringify(manifest.summary, null, 2));
    return;
  }

  console.error(`[delete] removing ${glbs.length} plaintext .glb from docs/m`);
  const deleted = [];
  for (const name of glbs) {
    fs.unlinkSync(path.join(modelDir, name));
    deleted.push(name);
  }
  const remainGlb = fs.readdirSync(modelDir).filter((f) => /\.glb$/i.test(f));
  const remainPng = fs.readdirSync(modelDir).filter((f) => /\.png$/i.test(f));
  manifest.summary.deletedFromModel = true;
  manifest.summary.deletedCount = deleted.length;
  manifest.summary.remainGlbInModel = remainGlb.length;
  manifest.summary.remainPngInModel = remainPng.length;
  fs.writeFileSync(path.join(backupRoot, '_backup-manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  if (remainGlb.length !== 0) {
    console.log(JSON.stringify({ ok: false, stage: 'post_delete', remainGlb }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify(manifest.summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
