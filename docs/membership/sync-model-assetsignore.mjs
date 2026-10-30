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

function collectReferencedBasenames() {
  const names = new Set();
  // 只认完整模型后缀；文件名可含空格（勿用 \\s 截断）；兼容残留 docs/model
  const re = /\/?docs\/(?:m|model)\/([^"']+\.(?:glb|png|gltf))/gi;
  for (const f of walkJson(JSON_ROOT)) {
    const t = fs.readFileSync(f, 'utf8');
    let m;
    while ((m = re.exec(t))) {
      const base = path.basename(String(m[1]).replace(/\\/g, '/'));
      if (base) names.add(base);
    }
  }
  return names;
}

function buildAllowlist(refNames) {
  if (!fs.existsSync(MODEL_DIR)) {
    return { allow: [], missing: [...refNames], oversized: [] };
  }
  const onDisk = new Set(
    fs.readdirSync(MODEL_DIR).filter((f) => fs.statSync(path.join(MODEL_DIR, f)).isFile())
  );
  const allow = [];
  const missing = [];
  const oversized = [];
  for (const name of [...refNames].sort((a, b) => a.localeCompare(b, 'zh'))) {
    if (!onDisk.has(name)) {
      missing.push(name);
      continue;
    }
    const sz = fs.statSync(path.join(MODEL_DIR, name)).size;
    if (sz > MAX_ASSET_BYTES) {
      oversized.push({ name, bytes: sz });
      continue;
    }
    allow.push(name);
  }
  return { allow, missing, oversized };
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
  const refNames = collectReferencedBasenames();
  const { allow, missing, oversized } = buildAllowlist(refNames);
  const block = renderAutoBlock(allow);
  const next = upsertAssetsIgnore(block);

  const summary = {
    ok: true,
    dryRun,
    referencedNames: refNames.size,
    allowCount: allow.length,
    missingCount: missing.length,
    oversizedCount: oversized.length,
    missingSample: missing.slice(0, 20),
    oversized
  };

  if (dryRun) {
    console.log(JSON.stringify(summary, null, 2));
    console.log('--- block preview (first 12 lines) ---');
    console.log(block.split('\n').slice(0, 12).join('\n'));
    return;
  }

  fs.writeFileSync(ASSETSIGNORE, next, 'utf8');
  console.log(JSON.stringify(summary, null, 2));
  console.log('[sync-model-assetsignore] wrote .assetsignore allowlist:', allow.length, 'files');
}

main();
