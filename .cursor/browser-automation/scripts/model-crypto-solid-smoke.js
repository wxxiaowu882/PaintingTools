#!/usr/bin/env node
/**
 * 第 2 步冒烟：本地 HTTP + 浏览器
 * 1) 密文 _crypto_smoke_Raven.png → toGlbArrayBuffer → glTF 魔数 + parseAsync
 * 2) 明文 .glb 双轨仍通
 *
 * 用法：仓库根静态服务 18080 已起时：
 *   node .cursor/browser-automation/scripts/model-crypto-solid-smoke.js
 */
require('./_playwright-browsers-path.js');
const { chromium } = require('playwright');

const BASE = String(process.env.SMOKE_BASE || 'http://127.0.0.1:18080').replace(/\/$/, '');

async function main() {
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String((e && e.message) || e)));

  await page.goto(`${BASE}/Solid`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForTimeout(2500);

  const result = await page.evaluate(async () => {
    const mod = await import('/docs/js/model-crypto/ModelCrypto.js');
    const { toGlbArrayBuffer, isOurContainer, isProbablyGlb, FAKE_EXT } = mod;

    const encRes = await fetch('/docs/m/_crypto_smoke_Raven.png', { cache: 'no-cache' });
    if (!encRes.ok) throw new Error('smoke png HTTP ' + encRes.status);
    const encBuf = await encRes.arrayBuffer();
    if (!isOurContainer(encBuf)) throw new Error('smoke png 不是 PTGL');
    const t0 = performance.now();
    const glbBuf = await toGlbArrayBuffer(encBuf);
    const decryptMs = performance.now() - t0;
    if (!isProbablyGlb(glbBuf)) throw new Error('解密后不是 glb');

    const plainRes = await fetch('/docs/m/%E5%8A%A8%E7%89%A9_Raven.glb', { cache: 'no-cache' });
    if (!plainRes.ok) throw new Error('plain glb HTTP ' + plainRes.status);
    const plainOut = await toGlbArrayBuffer(await plainRes.arrayBuffer());
    if (!isProbablyGlb(plainOut)) throw new Error('明文轨失败');

    // 与 Solid 同轨：DRACO 解码路径（冒烟样例 Raven 带 KHR_draco）
    const { GLTFLoader } = await import('/docs/js/three_164/examples/jsm/loaders/GLTFLoader.js');
    const { DRACOLoader } = await import('/docs/js/three_164/examples/jsm/loaders/DRACOLoader.js');
    const loader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath('/docs/js/three_164/examples/jsm/libs/draco/gltf/');
    draco.setWorkerLimit(2);
    loader.setDRACOLoader(draco);
    const gltf = await loader.parseAsync(glbBuf, '/docs/m/_crypto_smoke_Raven.png');
    let meshCount = 0;
    gltf.scene.traverse((o) => {
      if (o.isMesh) meshCount++;
    });

    // Solid 入口是否已挂统一包（双轨胶水）
    let solidImportHint = 'unknown';
    try {
      const html = await (await fetch('/Solid', { cache: 'no-cache' })).text();
      solidImportHint = /model-crypto\/ModelCrypto\.js/.test(html) && /toGlbArrayBuffer/.test(html)
        ? 'wired'
        : 'missing';
    } catch (_e) {
      solidImportHint = 'fetch_fail';
    }
    if (solidImportHint !== 'wired') throw new Error('Solid 未接 ModelCrypto: ' + solidImportHint);

    return {
      ok: true,
      fakeExt: FAKE_EXT,
      decryptMs: Math.round(decryptMs * 100) / 100,
      meshCount,
      solidImportHint
    };
  });

  await browser.close();

  if (errors.length) {
    console.error(JSON.stringify({ ok: false, pageErrors: errors.slice(0, 5), result }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify(result, null, 2));
  if (!result || !result.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
