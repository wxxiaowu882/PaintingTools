#!/usr/bin/env node
/**
 * 第 4 步小批验收：5 个密文 .png 均可 toGlbArrayBuffer + parse；
 * 抽样 JSON 路径已是 .png；Solid 入口仍 wired。
 */
require('./_playwright-browsers-path.js');
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = String(process.env.SMOKE_BASE || 'http://127.0.0.1:18080').replace(/\/$/, '');
const FILES = [
  '石膏头像_女中青年_05_opt_石膏白.png',
  '石膏头像_男中青年_IpMan2V_opt.png',
  '石膏头像_女中青年_02_opt_石膏白.png',
  '真人头像_男_光头亚裔侧脸01_opt.png',
  '石膏头像_男中青年_大超亨利卡维尔_头像.png'
];

async function main() {
  const sampleJson = path.join(
    __dirname,
    '../../../docs/json/沙盒_头部造型规律/102_亚男叶问_【外轮廓规律】正面.json'
  );
  const jtxt = fs.readFileSync(sampleJson, 'utf8');
  if (!/IpMan2V_opt\.png/.test(jtxt)) throw new Error('抽样 JSON 未改成 .png');
  if (/IpMan2V_opt\.glb/.test(jtxt)) throw new Error('抽样 JSON 仍含 .glb');

  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String((e && e.message) || e)));

  await page.goto(`${BASE}/Solid`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(2000);

  const result = await page.evaluate(async (files) => {
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
      const url = '/docs/m/' + encodeURIComponent(name).replace(/%2F/g, '/');
      // encodeURIComponent 会编码中文，路径需分段
      const parts = name.split('/').map(encodeURIComponent).join('/');
      const res = await fetch('/docs/m/' + parts, { cache: 'no-cache' });
      if (!res.ok) throw new Error(name + ' HTTP ' + res.status);
      const raw = await res.arrayBuffer();
      if (!isOurContainer(raw)) throw new Error(name + ' 非 PTGL');
      const t0 = performance.now();
      const glb = await toGlbArrayBuffer(raw);
      const ms = performance.now() - t0;
      if (!isProbablyGlb(glb)) throw new Error(name + ' 解密后非 glb');
      const gltf = await loader.parseAsync(glb, '/docs/m/' + name);
      let meshCount = 0;
      gltf.scene.traverse((o) => {
        if (o.isMesh) meshCount++;
      });
      out.push({ name, ok: meshCount > 0, meshCount, decryptMs: Math.round(ms * 10) / 10 });
    }
    return out;
  }, FILES);

  const solidHtml = await (await page.request.get(BASE + '/Solid')).text();
  const solidWired =
    /model-crypto\/ModelCrypto\.js/.test(solidHtml) && /toGlbArrayBuffer/.test(solidHtml);

  await browser.close();

  const allOk = result.every((r) => r.ok) && solidWired && errors.length === 0;
  console.log(JSON.stringify({ ok: allOk, result, solidWired, pageErrors: errors.slice(0, 5) }, null, 2));
  if (!allOk) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
