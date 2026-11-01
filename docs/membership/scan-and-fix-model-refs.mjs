#!/usr/bin/env node
/**
 * 扫描 docs/json 中的 docs/m|model 引用：缺文件 / 落在子目录。
 * 可选：--fix-subdir 把「仅因放在子目录而丢上传」的文件拷到 docs/m 根并改 JSON URL。
 *
 *   node docs/membership/scan-and-fix-model-refs.mjs
 *   node docs/membership/scan-and-fix-model-refs.mjs --fix-subdir
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const JSON_ROOT = path.join(REPO, 'docs/json');
const MODEL_DIR = path.join(REPO, 'docs/m');
const doFix = process.argv.includes('--fix-subdir');

function walkJson(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const n of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, n.name);
    if (n.isDirectory()) walkJson(p, acc);
    else if (n.isFile() && /\.json$/i.test(n.name)) acc.push(p);
  }
  return acc;
}

function walkModels(dir, acc = [], base = MODEL_DIR) {
  if (!fs.existsSync(dir)) return acc;
  for (const n of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, n.name);
    if (n.isDirectory()) walkModels(p, acc, base);
    else if (n.isFile() && /\.(glb|png|gltf)$/i.test(n.name)) {
      acc.push({ abs: p, rel: path.relative(base, p).split(path.sep).join('/') });
    }
  }
  return acc;
}

function main() {
  const re = /\/?docs\/(?:m|model)\/([^"']+\.(?:glb|png|gltf))/gi;
  const byUrl = new Map();
  for (const f of walkJson(JSON_ROOT)) {
    const t = fs.readFileSync(f, 'utf8');
    let m;
    while ((m = re.exec(t))) {
      const rel = String(m[1]).replace(/\\/g, '/');
      const url = '/docs/m/' + rel.replace(/^model\//, '');
      if (!byUrl.has(url)) byUrl.set(url, { rel, files: [] });
      byUrl.get(url).files.push(path.relative(REPO, f).split(path.sep).join('/'));
    }
  }

  const onDisk = walkModels(MODEL_DIR);
  const byBase = new Map();
  for (const x of onDisk) {
    const b = path.basename(x.rel);
    if (!byBase.has(b)) byBase.set(b, []);
    byBase.get(b).push(x);
  }

  const missing = [];
  const subdirOnly = [];
  const ok = [];
  for (const [url, info] of [...byUrl.entries()].sort((a, b) => a[0].localeCompare(b[0], 'zh'))) {
    const abs = path.join(MODEL_DIR, info.rel);
    const existsExact = fs.existsSync(abs) && fs.statSync(abs).isFile();
    const base = path.basename(info.rel);
    const rootAbs = path.join(MODEL_DIR, base);
    const existsRoot = fs.existsSync(rootAbs) && fs.statSync(rootAbs).isFile();
    const inSub = info.rel.includes('/');
    if (existsExact && !inSub) {
      ok.push(url);
      continue;
    }
    if (existsExact && inSub) {
      subdirOnly.push({ url, rel: info.rel, files: info.files, existsRoot });
      continue;
    }
    // not at URL path
    const alts = byBase.get(base) || [];
    missing.push({
      url,
      rel: info.rel,
      files: info.files,
      existsRoot,
      altRels: alts.map((a) => a.rel)
    });
  }

  console.log(JSON.stringify({
    ok: true,
    totalRefs: byUrl.size,
    okRoot: ok.length,
    subdirOnly: subdirOnly.length,
    missing: missing.length,
    subdirOnlySample: subdirOnly,
    missingSample: missing.slice(0, 40)
  }, null, 2));

  if (!doFix) {
    console.log('\n[scan] dry view only. Re-run with --fix-subdir to copy subdir files to docs/m root and rewrite JSON URLs.');
    return;
  }

  let copied = 0;
  let rewrittenFiles = 0;
  for (const row of subdirOnly) {
    const base = path.basename(row.rel);
    const src = path.join(MODEL_DIR, row.rel);
    const dest = path.join(MODEL_DIR, base);
    if (!fs.existsSync(dest)) {
      fs.copyFileSync(src, dest);
      copied++;
      console.log('[copy]', row.rel, '→', base);
    } else {
      console.log('[skip-copy exists]', base);
    }
    const from = '/docs/m/' + row.rel;
    const to = '/docs/m/' + base;
    const from2 = 'docs/m/' + row.rel;
    const to2 = 'docs/m/' + base;
    for (const relJson of row.files) {
      const jp = path.join(REPO, relJson);
      let t = fs.readFileSync(jp, 'utf8');
      const next = t.split(from).join(to).split(from2).join(to2);
      if (next !== t) {
        fs.writeFileSync(jp, next, 'utf8');
        rewrittenFiles++;
        console.log('[rewrite]', relJson);
      }
    }
  }

  // missing but found under alt subdir with same basename → same flatten
  for (const row of missing) {
    if (!row.altRels || !row.altRels.length) continue;
    const pick = row.altRels.find((r) => r.includes('/')) || row.altRels[0];
    const base = path.basename(pick);
    const src = path.join(MODEL_DIR, pick);
    const dest = path.join(MODEL_DIR, base);
    if (!fs.existsSync(dest)) {
      fs.copyFileSync(src, dest);
      copied++;
      console.log('[copy-alt]', pick, '→', base);
    }
    const badRel = row.rel;
    const from = '/docs/m/' + badRel;
    const to = '/docs/m/' + base;
    for (const relJson of row.files) {
      const jp = path.join(REPO, relJson);
      let t = fs.readFileSync(jp, 'utf8');
      const next = t.split(from).join(to).split('docs/m/' + badRel).join('docs/m/' + base);
      if (next !== t) {
        fs.writeFileSync(jp, next, 'utf8');
        rewrittenFiles++;
        console.log('[rewrite-alt]', relJson);
      }
    }
  }

  console.log(JSON.stringify({ fixed: true, copied, rewrittenFiles }, null, 2));
}

main();
