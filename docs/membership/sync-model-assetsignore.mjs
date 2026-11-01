#!/usr/bin/env node
/**
 * 发版前：根据 docs/json 里引用的 docs/m/*（兼容残留 docs/model），重写 .assetsignore 白名单段。
 * 未引用的模型不上传 Cloudflare（仍留在本地仓库）。
 *
 *   node docs/membership/sync-model-assetsignore.mjs
 *   node docs/membership/sync-model-assetsignore.mjs --dry-run
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const JSON_ROOT = path.join(REPO, 'docs/json');
const MODEL_DIR = path.join(REPO, 'docs/m');
const ASSETSIGNORE = path.join(REPO, '.assetsignore');
const BEGIN = '# BEGIN AUTO model-deploy-allowlist';
const END = '# END AUTO model-deploy-allowlist';
const MAX_ASSET_BYTES = 25 * 1024 * 1024;
const MODEL_URL_PREFIX = 'docs/m';

function walkJson(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const n of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, n.name);
    if (n.isDirectory()) walkJson(p, acc);
    else if (n.isFile() && /\.json$/i.test(n.name)) acc.push(p);
  }
  return acc;
}

/** 收集课表引用的相对路径（相对 docs/m；兼容 docs/model） */
function collectReferencedRels() {
  const rels = new Set();
  // 只认完整模型后缀；文件名可含空格；兼容残留 docs/model
  const re = /\/?docs\/(?:m|model)\/([^"']+\.(?:glb|png|gltf))/gi;
  for (const f of walkJson(JSON_ROOT)) {
    const t = fs.readFileSync(f, 'utf8');
    let m;
    while ((m = re.exec(t))) {
      const rel = String(m[1]).replace(/\\/g, '/').replace(/^model\//, '');
      if (rel) rels.add(rel);
    }
  }
  return rels;
}

/** 在 docs/m 下递归找与 basename 同名的文件（优先根目录） */
function findModelRelByBasename(base) {
  const rootHit = path.join(MODEL_DIR, base);
  if (fs.existsSync(rootHit) && fs.statSync(rootHit).isFile()) return base;
  const stack = [MODEL_DIR];
  while (stack.length) {
    const dir = stack.pop();
    for (const n of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, n.name);
      if (n.isDirectory()) stack.push(p);
      else if (n.isFile() && n.name === base) {
        return path.relative(MODEL_DIR, p).split(path.sep).join('/');
      }
    }
  }
  return null;
}

function buildAllowlist(refRels) {
  if (!fs.existsSync(MODEL_DIR)) {
    return { allow: [], missing: [...refRels], oversized: [], resolvedFromSubdir: [] };
  }
  const allow = [];
  const missing = [];
  const oversized = [];
  const resolvedFromSubdir = [];
  for (const rel of [...refRels].sort((a, b) => a.localeCompare(b, 'zh'))) {
    const exact = path.join(MODEL_DIR, rel);
    let useRel = null;
    if (fs.existsSync(exact) && fs.statSync(exact).isFile()) {
      useRel = rel;
    } else {
      const byBase = findModelRelByBasename(path.basename(rel));
      if (byBase) {
        useRel = byBase;
        if (byBase !== rel) resolvedFromSubdir.push({ wanted: rel, found: byBase });
      }
    }
    if (!useRel) {
      missing.push(rel);
      continue;
    }
    const sz = fs.statSync(path.join(MODEL_DIR, useRel)).size;
    if (sz > MAX_ASSET_BYTES) {
      oversized.push({ name: useRel, bytes: sz });
      continue;
    }
    if (!allow.includes(useRel)) allow.push(useRel);
  }
  allow.sort((a, b) => a.localeCompare(b, 'zh'));
  return { allow, missing, oversized, resolvedFromSubdir };
}

function renderAutoBlock(allow) {
  return [
    BEGIN,
    '# 由 docs/membership/sync-model-assetsignore.mjs 根据 docs/json 引用自动生成',
    '# docs/m 默认不上传；仅放行课表引用到的文件（Workers 单文件 ≤25MiB）',
    // 旧目录若残留也不上传
    'docs/model/**',
    MODEL_URL_PREFIX + '/**',
    '!' + MODEL_URL_PREFIX + '/',
    ...allow.map((n) => '!' + MODEL_URL_PREFIX + '/' + n),
    END
  ].join('\n');
}

function upsertAssetsIgnore(block) {
  let cur = fs.existsSync(ASSETSIGNORE) ? fs.readFileSync(ASSETSIGNORE, 'utf8') : '';
  cur = cur.replace(/\r\n/g, '\n');
  const start = cur.indexOf(BEGIN);
  const endIdx = cur.indexOf(END);
  if (start >= 0 && endIdx > start) {
    const afterEnd = endIdx + END.length;
    cur = cur.slice(0, start) + cur.slice(afterEnd);
  }
  // 旧手写超大文件行可留着作备注；有全目录忽略后不依赖它们
  cur = cur.replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').replace(/\n+$/g, '\n');
  return cur + '\n' + block + '\n';
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const refRels = collectReferencedRels();
  const { allow, missing, oversized, resolvedFromSubdir } = buildAllowlist(refRels);
  const block = renderAutoBlock(allow);
  const next = upsertAssetsIgnore(block);

  const summary = {
    ok: true,
    dryRun,
    referencedRels: refRels.size,
    allowCount: allow.length,
    missingCount: missing.length,
    oversizedCount: oversized.length,
    resolvedFromSubdirCount: (resolvedFromSubdir || []).length,
    missingSample: missing.slice(0, 20),
    resolvedFromSubdirSample: (resolvedFromSubdir || []).slice(0, 10),
    oversized
  };

  // 公网口径：课表必须指密文 .png；明文 .glb 默认阻断发版（--allow-plain-glb 才放行）
  const allowPlainGlb = process.argv.includes('--allow-plain-glb');
  const plainGlbRefs = [...refRels].filter((r) => /\.glb$/i.test(r));
  const allowHasGlb = allow.filter((r) => /\.glb$/i.test(r));

  // 缺文件 / 路径落在子目录却未扁平：发版会空场景——默认阻断（--allow-missing 才放行）
  const allowMissing = process.argv.includes('--allow-missing');
  let bad =
    missing.length > 0 || (resolvedFromSubdir || []).length > 0;
  if ((resolvedFromSubdir || []).length) {
    console.warn(
      '[sync-model-assetsignore] FAIL: JSON 路径与磁盘不一致（模型在子目录）。' +
        '请先: node docs/membership/scan-and-fix-model-refs.mjs --fix-subdir'
    );
  }
  if (missing.length) {
    console.warn(
      '[sync-model-assetsignore] FAIL: 课表引用的模型本地缺失，线上会空场景:',
      missing.slice(0, 15).join(', ')
    );
  }
  if (plainGlbRefs.length || allowHasGlb.length) {
    summary.plainGlbRefCount = plainGlbRefs.length;
    summary.plainGlbRefSample = plainGlbRefs.slice(0, 15);
    summary.allowGlbSample = allowHasGlb.slice(0, 15);
    if (!allowPlainGlb) {
      bad = true;
      console.warn(
        '[sync-model-assetsignore] FAIL: 课表仍引用明文 .glb（公网须用加密 .png）。' +
          '请先加密并改路径: node docs/js/model-crypto/batch-migrate.mjs --all && ' +
          'node docs/js/model-crypto/batch-rewrite-json-paths.mjs --from-disk'
      );
      console.warn('  sample:', plainGlbRefs.slice(0, 8).join(', ') || allowHasGlb.slice(0, 8).join(', '));
    }
  }

  if (dryRun) {
    console.log(JSON.stringify(summary, null, 2));
    console.log('--- block preview (first 12 lines) ---');
    console.log(block.split('\n').slice(0, 12).join('\n'));
    if (bad && !allowMissing) process.exitCode = 1;
    return;
  }

  fs.writeFileSync(ASSETSIGNORE, next, 'utf8');
  console.log(JSON.stringify(summary, null, 2));
  console.log('[sync-model-assetsignore] wrote .assetsignore allowlist:', allow.length, 'files');
  if (bad && !(allowMissing && !plainGlbRefs.length && !allowHasGlb.length) && !allowPlainGlb) {
    // 明文 glb 即使用 --allow-missing 也不放行，除非显式 --allow-plain-glb
    if (plainGlbRefs.length || allowHasGlb.length) {
      console.error('[sync-model-assetsignore] 已写白名单，但因明文 .glb 退出码=1（阻断发版）');
      process.exit(1);
    }
  }
  if (bad && !allowMissing) {
    console.error('[sync-model-assetsignore] 已写白名单，但因缺失/子目录问题退出码=1（阻断发版）');
    process.exit(1);
  }
}

main();
