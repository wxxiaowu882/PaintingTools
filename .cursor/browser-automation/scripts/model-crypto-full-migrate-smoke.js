#!/usr/bin/env node
/**
 * 全量迁移后抽样：若干密文解密+parse；JSON 残留 .glb 仅允许已知缺失；Solid wired。
 */
require('./_playwright-browsers-path.js');
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = String(process.env.SMOKE_BASE || 'http://127.0.0.1:18080').replace(/\/$/, '');
const ALLOWED_STALE = new Set([
  '静物_其它_房子.glb',
  '静物_其它_房子_20260413110850.glb',
  '静物_其它_房子_20260413110859.glb'
]);

function walkJson(dir, acc = []) {
  for (const n of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, n.name);
    if (n.isDirectory()) walkJson(p, acc);
    else if (n.isFile() && /\.json$/i.test(n.name)) acc.push(p);
  }
  return acc;
}

function collectStaleGlbRefs() {
  const re = /\/?docs\/model\/([^"'\\\s]+)\.glb\b/gi;
  const map = new Map();
  for (const f of walkJson(path.join(__dirname, '../../../docs/json'))) {
    const t = fs.readFileSync(f, 'utf8');
    let m;
    while ((m = re.exec(t))) {
      const name = path.basename(m[1]) + '.glb';
      map.set(name, (map.get(name) || 0) + 1);
    }
  }
  return map;
}

async function main() {
  const stale = collectStaleGlbRefs();
  const unexpected = [...stale.keys()].filter((k) => !ALLOWED_STALE.has(k));
  if (unexpected.length) {
    console.error(JSON.stringify({ ok: false, unexpectedStale: unexpected.slice(0, 30), staleCount: stale.size }, null, 2));
    process.exit(1);
  }

  const sample = [
    '石膏头像_男中青年_IpMan2V_opt.png',
    '动物_Raven.png',
    '静物_瓶罐_Krug_opt.png',
    '静物_水果_apple_20260324195226_opt.png',
    '真人头像_男_光头亚裔侧脸01_opt.png'
  ].filter((n) => fs.existsSync(path.join(__dirname, '../../../docs/m', n)));

  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String((e && e.message) || e)));
  await page.goto(`${BASE}/Solid`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(1500);

  const parsed = await page.evaluate(async (files) => {
    const mod = await import('/docs/js/model-crypto/ModelCrypto.js');
    const { toGlbArrayBuffer, isOurContainer, isProbablyGlb } = mod;
    const { GLTFLoader } = await import('/docs/js/three_164/examples/jsm/loaders/GLTFLoader.js');
    const { DRACOLoader } = await import('/docs/js/three_164/examples/jsm/loaders/DRACOLoader.js');
    const loader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath('/docs/js/three_164/examples/jsm/libs/draco/gltf/');
    loader.setDRACOLoader(draco);
    const out = [];
    for (const name of files) {
      const parts = name.split('/').map(encodeURIComponent).join('/');
      const res = await fetch('/docs/m/' + parts, { cache: 'no-cache' });
      if (!res.ok) throw new Error(name + ' HTTP ' + res.status);
      const raw = await res.arrayBuffer();
      if (!isOurContainer(raw)) throw new Error(name + ' 非 PTGL');
      const glb = await toGlbArrayBuffer(raw);
      if (!isProbablyGlb(glb)) throw new Error(name + ' 解密失败');
      const gltf = await loader.parseAsync(glb, '/docs/m/' + name);
      let meshCount = 0;
      gltf.scene.traverse((o) => {
        if (o.isMesh) meshCount++;
      });
      out.push({ name, ok: meshCount > 0, meshCount });
    }
    return out;
  }, sample);

  const solidHtml = await (await page.request.get(BASE + '/Solid')).text();
  const solidWired =
    /model-crypto\/ModelCrypto\.js/.test(solidHtml) && /toGlbArrayBuffer/.test(solidHtml);
  await browser.close();

  const result = {
    ok: parsed.every((p) => p.ok) && solidWired && errors.length === 0 && unexpected.length === 0,
    staleAllowed: [...stale.entries()],
    parsed,
    solidWired,
    pageErrors: errors.slice(0, 5)
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
