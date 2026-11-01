#!/usr/bin/env node
/**
 * 第 4 步：受控改写 docs/json 内 docs/m/*.glb → *.png
 *
 * 安全规则（质量优先）：
 * - 仅当磁盘上已存在对应 .png 且魔数为 PTGL 时才改路径
 * - 改前备份触及的 JSON
 *
 *   node docs/js/model-crypto/batch-rewrite-json-paths.mjs --from-disk --dry-run
 *   node docs/js/model-crypto/batch-rewrite-json-paths.mjs --from-disk
 *   node docs/js/model-crypto/batch-rewrite-json-paths.mjs --manifest ...
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isOurContainer } from './ModelCrypto.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const jsonRoot = path.join(repoRoot, 'docs/json');
const modelDir = path.join(repoRoot, 'docs/m');

function parseArgs(argv) {
  const out = {
    dryRun: false,
    fromDisk: false,
    manifest: null,
    reportPath: path.join(__dirname, 'rewrite-last-report.json')
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--from-disk') out.fromDisk = true;
    else if (a === '--manifest') out.manifest = path.resolve(repoRoot, argv[++i]);
    else if (a === '--report') out.reportPath = path.resolve(repoRoot, argv[++i]);
    else if (a === '--help' || a === '-h') out.help = true;
  }
  if (!out.fromDisk && !out.manifest) {
    out.manifest = path.join(__dirname, 'migrate-manifest-v1.json');
  }
  return out;
}

function walkJson(dir, acc = []) {
  for (const n of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, n.name);
    if (n.isDirectory()) walkJson(p, acc);
    else if (n.isFile() && /\.json$/i.test(n.name)) acc.push(p);
  }
  return acc;
}

function stripExt(name) {
  return String(name).replace(/\.(glb|png)$/i, '');
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function pngIsReady(baseNameNoExt) {
  const p = path.join(modelDir, baseNameNoExt + '.png');
  if (!fs.existsSync(p)) return false;
  try {
    // 读够 isOurContainer 最小长度（头 20 + GCM tag 16）
    const fd = fs.openSync(p, 'r');
    const buf = Buffer.alloc(48);
    const n = fs.readSync(fd, buf, 0, 48, 0);
    fs.closeSync(fd);
    return n >= 36 && isOurContainer(buf.subarray(0, n));
  } catch (_e) {
    return false;
  }
}

function buildAllowedBases(args) {
  if (args.fromDisk) {
    // 磁盘上所有已就绪的密文 basename
    return fs
      .readdirSync(modelDir)
      .filter((f) => /\.png$/i.test(f))
      .map((f) => stripExt(f))
      .filter((b) => pngIsReady(b))
      .sort((a, b) => a.localeCompare(b, 'zh'));
  }
  const man = JSON.parse(fs.readFileSync(args.manifest, 'utf8'));
  const files = Array.isArray(man.files) ? man.files : [];
  return files.map((f) => stripExt(f)).filter((b) => pngIsReady(b));
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(
      'Usage: node docs/js/model-crypto/batch-rewrite-json-paths.mjs (--from-disk | --manifest path) [--dry-run]'
    );
    process.exit(0);
  }

  const bases = buildAllowedBases(args);
  if (!bases.length) throw new Error('没有可改写的就绪密文（PTGL .png）');

  // 长名优先，避免短名前缀误伤（虽有边界 \\b，仍更稳）
  bases.sort((a, b) => b.length - a.length);
  const replacers = bases.map((b) => ({
    base: b,
    // 兼容旧 docs/model 与现行 docs/m
    re: new RegExp(`(/?docs\\/(?:m|model)\\/${escapeRegExp(b)})\\.glb\\b`, 'gi')
  }));

  function rewriteText(text) {
    let after = text;
    let n = 0;
    const hitBases = new Set();
    for (const r of replacers) {
      after = after.replace(r.re, (full, p1) => {
        n++;
        hitBases.add(r.base);
        return `${p1}.png`;
      });
    }
    return { after, n, hitBases: [...hitBases] };
  }

  const allJson = walkJson(jsonRoot);
  const touched = [];
  let totalReplacements = 0;
  const skippedStillGlb = new Map(); // basename -> count still needing png

  // 先扫残留：JSON 里仍有 .glb，但 png 未就绪
  const staleRe = /\/?docs\/(?:m|model)\/([^"'\\\s]+)\.glb\b/gi;
  for (const fp of allJson) {
    const before = fs.readFileSync(fp, 'utf8');
    let m;
    while ((m = staleRe.exec(before))) {
      const base = path.basename(m[1]);
      if (!pngIsReady(base)) {
        skippedStillGlb.set(base, (skippedStillGlb.get(base) || 0) + 1);
      }
    }
    const { after, n } = rewriteText(before);
    if (n > 0 && after !== before) {
      touched.push({
        file: path.relative(repoRoot, fp).replace(/\\/g, '/'),
        replacements: n
      });
      totalReplacements += n;
    }
  }

  const skippedList = [...skippedStillGlb.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => ({ name: name + '.glb', count }));

  if (!args.dryRun && touched.length) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const backupRoot = path.join(
      repoRoot,
      '.cursor/browser-automation/runs',
      `model-crypto-json-backup-${ts}`
    );
    fs.mkdirSync(backupRoot, { recursive: true });
    for (const t of touched) {
      const abs = path.join(repoRoot, t.file);
      const dest = path.join(backupRoot, t.file);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(abs, dest);
    }
    for (const t of touched) {
      const abs = path.join(repoRoot, t.file);
      const before = fs.readFileSync(abs, 'utf8');
      const { after } = rewriteText(before);
      fs.writeFileSync(abs, after, 'utf8');
    }
    const summary = {
      dryRun: false,
      fromDisk: args.fromDisk,
      ok: true,
      backupRoot: path.relative(repoRoot, backupRoot).replace(/\\/g, '/'),
      readyPngBases: bases.length,
      filesTouched: touched.length,
      totalReplacements,
      skippedNoReadyPng: skippedList.slice(0, 40),
      skippedTruncated: skippedList.length > 40
    };
    fs.writeFileSync(
      args.reportPath,
      JSON.stringify({ summary, touched, skippedNoReadyPng: skippedList }, null, 2),
      'utf8'
    );
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const summary = {
    dryRun: args.dryRun,
    fromDisk: args.fromDisk,
    ok: true,
    readyPngBases: bases.length,
    filesTouched: touched.length,
    totalReplacements,
    skippedNoReadyPng: skippedList.slice(0, 40),
    skippedTruncated: skippedList.length > 40,
    touchedSample: touched.slice(0, 40),
    touchedTruncated: touched.length > 40
  };
  fs.writeFileSync(
    args.reportPath,
    JSON.stringify({ summary, touched, skippedNoReadyPng: skippedList }, null, 2),
    'utf8'
  );
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
