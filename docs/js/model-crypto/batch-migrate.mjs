#!/usr/bin/env node
/**
 * 第 4 步：docs/m 下 .glb → 密文同名 .png（默认不删明文）。
 * 写盘前强制：解密往返与明文逐字节一致；已有 PTGL 也会再校验。
 *
 *   node docs/js/model-crypto/batch-migrate.mjs --all --dry-run
 *   node docs/js/model-crypto/batch-migrate.mjs --all
 *   node docs/js/model-crypto/batch-migrate.mjs --manifest docs/js/model-crypto/migrate-manifest-v1.json
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import {
  encryptGlb,
  decryptToGlb,
  isProbablyGlb,
  isOurContainer,
  FAKE_EXT
} from './ModelCrypto.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const modelDir = path.join(repoRoot, 'docs/m');

function parseArgs(argv) {
  const out = {
    dryRun: false,
    all: false,
    manifest: null,
    reportPath: path.join(__dirname, 'migrate-last-report.json')
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--all') out.all = true;
    else if (a === '--manifest') out.manifest = path.resolve(repoRoot, argv[++i]);
    else if (a === '--report') out.reportPath = path.resolve(repoRoot, argv[++i]);
    else if (a === '--help' || a === '-h') out.help = true;
  }
  if (!out.manifest && !out.all) {
    out.manifest = path.join(__dirname, 'migrate-manifest-v1.json');
  }
  return out;
}

function stripExt(name) {
  return String(name).replace(/\.(glb|png)$/i, '');
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function buffersEqual(a, b) {
  const aa = Buffer.isBuffer(a) ? a : Buffer.from(a);
  const bb = Buffer.isBuffer(b) ? b : Buffer.from(b);
  if (aa.byteLength !== bb.byteLength) return false;
  return crypto.timingSafeEqual(aa, bb);
}

function listGlbNames() {
  return fs
    .readdirSync(modelDir)
    .filter((f) => /\.glb$/i.test(f) && fs.statSync(path.join(modelDir, f)).isFile())
    .sort((a, b) => a.localeCompare(b, 'zh'));
}

async function verifyRoundtrip(plainBuf, encBuf) {
  if (!isOurContainer(encBuf)) return 'enc_not_ptgl';
  const back = Buffer.from(await decryptToGlb(encBuf));
  if (!buffersEqual(plainBuf, back)) return 'roundtrip_mismatch';
  return null;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(
      'Usage: node docs/js/model-crypto/batch-migrate.mjs (--all | --manifest path) [--dry-run] [--report path]'
    );
    process.exit(0);
  }

  let files;
  if (args.all) {
    files = listGlbNames();
  } else {
    const man = JSON.parse(fs.readFileSync(args.manifest, 'utf8'));
    files = Array.isArray(man.files) ? man.files : [];
  }
  if (!files.length) throw new Error('没有待处理 .glb');

  const report = [];
  let i = 0;
  for (const name of files) {
    i++;
    const base = stripExt(name) + '.glb';
    const src = path.join(modelDir, base);
    const destName = stripExt(name) + FAKE_EXT;
    const dest = path.join(modelDir, destName);
    const row = { src: base, dest: destName, ok: false };
    if (i % 25 === 0 || i === 1 || i === files.length) {
      console.error(`[migrate] ${i}/${files.length} ${base}`);
    }
    if (!fs.existsSync(src)) {
      row.error = 'missing_glb';
      report.push(row);
      continue;
    }
    const raw = fs.readFileSync(src);
    row.bytesIn = raw.byteLength;
    row.sha256 = sha256(raw);
    if (!isProbablyGlb(raw)) {
      row.error = 'not_glb';
      report.push(row);
      continue;
    }

    if (fs.existsSync(dest)) {
      const existing = fs.readFileSync(dest);
      const verr = await verifyRoundtrip(raw, existing);
      if (!verr) {
        row.ok = true;
        row.skipped = 'png_exists_verified';
        row.bytesOut = existing.byteLength;
        report.push(row);
        continue;
      }
      // 已有 png 但校验失败：干跑标错；正式跑则覆盖重写
      if (args.dryRun) {
        row.error = 'dest_exists_bad:' + verr;
        report.push(row);
        continue;
      }
      row.reencrypt = verr;
    }

    if (args.dryRun) {
      row.ok = true;
      row.dryRun = true;
      report.push(row);
      continue;
    }

    const enc = Buffer.from(await encryptGlb(raw));
    const verr = await verifyRoundtrip(raw, enc);
    if (verr) {
      row.error = 'verify_before_write:' + verr;
      report.push(row);
      continue;
    }
    // 先写临时文件再 rename，避免半截密文
    const tmp = dest + '.tmp';
    fs.writeFileSync(tmp, enc);
    const onDisk = fs.readFileSync(tmp);
    const verr2 = await verifyRoundtrip(raw, onDisk);
    if (verr2) {
      try {
        fs.unlinkSync(tmp);
      } catch (_e) {}
      row.error = 'verify_after_write:' + verr2;
      report.push(row);
      continue;
    }
    fs.renameSync(tmp, dest);
    row.ok = true;
    row.bytesOut = enc.byteLength;
    report.push(row);
  }

  const failed = report.filter((r) => !r.ok);
  const summary = {
    dryRun: args.dryRun,
    all: args.all,
    total: report.length,
    okCount: report.length - failed.length,
    failCount: failed.length,
    ok: failed.length === 0,
    failed: failed.slice(0, 50),
    failedTruncated: failed.length > 50
  };
  fs.writeFileSync(args.reportPath, JSON.stringify({ summary, report }, null, 2), 'utf8');
  console.log(JSON.stringify(summary, null, 2));
  console.error('[migrate] full report → ' + path.relative(repoRoot, args.reportPath));
  process.exit(summary.ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
