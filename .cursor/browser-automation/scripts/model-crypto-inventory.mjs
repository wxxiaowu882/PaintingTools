#!/usr/bin/env node
/** 只读摸底：docs/m 与 docs/json 对 model 路径的引用 */
import fs from 'fs';
import path from 'path';

function walkJson(dir, acc = []) {
  for (const n of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, n.name);
    if (n.isDirectory()) walkJson(p, acc);
    else if (n.isFile() && /\.json$/i.test(n.name)) acc.push(p);
  }
  return acc;
}

const modelFiles = fs.readdirSync('docs/m').filter((f) => fs.statSync(path.join('docs/m', f)).isFile());
const glb = modelFiles.filter((f) => /\.glb$/i.test(f));
const png = modelFiles.filter((f) => /\.png$/i.test(f));

const jsonFiles = walkJson('docs/json');
const refCount = new Map();
const jsonHit = [];
const pathRe = /(?:^|[^\w./-])(\/?docs\/model\/[^"'\\\s]+\.(?:glb|png))/gi;

for (const f of jsonFiles) {
  const t = fs.readFileSync(f, 'utf8');
  const hits = new Set();
  let m;
  const re = /\/?docs\/model\/[^"'\\\s]+\.(?:glb|png)/gi;
  while ((m = re.exec(t))) hits.add(m[0].replace(/^\/+/, '').replace(/\\/g, '/'));
  if (hits.size) {
    jsonHit.push({ file: f.replace(/\\/g, '/'), n: hits.size, samples: [...hits].slice(0, 3) });
    for (const h of hits) refCount.set(h, (refCount.get(h) || 0) + 1);
  }
}

const byName = new Map();
for (const [k, c] of refCount) {
  const name = k.split('/').pop();
  byName.set(name, (byName.get(name) || 0) + c);
}

const top = [...byName.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
const onDisk = new Set(glb.map((f) => f.toLowerCase()));
const missing = [...byName.keys()].filter((n) => !onDisk.has(n.toLowerCase()) && !/\.png$/i.test(n)).slice(0, 15);

console.log(
  JSON.stringify(
    {
      model: { glb: glb.length, png: png.length },
      json: { total: jsonFiles.length, withModelRef: jsonHit.length, uniquePaths: refCount.size, uniqueNames: byName.size },
      topReferencedNames: top,
      missingNameSample: missing,
      jsonFoldersHint: [...new Set(jsonHit.map((j) => j.file.split('/').slice(0, 3).join('/')))].slice(0, 25)
    },
    null,
    2
  )
);
