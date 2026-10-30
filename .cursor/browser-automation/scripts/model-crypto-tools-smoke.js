#!/usr/bin/env node
/**
 * 第 3 步冒烟：GLB 管理器 + Create 双轨 / 导出加密口径
 *
 * 需仓库根静态服务（常见 18080）：
 *   SMOKE_BASE=http://127.0.0.1:18080 node scripts/model-crypto-tools-smoke.js
 */
require('./_playwright-browsers-path.js');
const { chromium } = require('playwright');

const BASE = String(process.env.SMOKE_BASE || 'http://127.0.0.1:18080').replace(/\/$/, '');
const encSeg = (s) => s.split('/').map(encodeURIComponent).join('/');
const MGR = `${BASE}/${encSeg('自用工具文件_不部署/GBL管理器/Glb管理器.html')}`;
const CREATE = `${BASE}/${encSeg('自用工具文件_不部署/石膏人像沙盒场景生成/Solid_Portrait_Create.html')}`;

async function main() {
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String((e && e.message) || e)));

  // --- GLB 管理器：密文载入手术台 + UI 后缀 + 源码胶水 ---
  await page.goto(MGR, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => typeof window.__AGENT_LOAD_GLB_BUFFER__ === 'function', {
    timeout: 60000
  });
  const mgr = await page.evaluate(async () => {
    const encRes = await fetch('/docs/m/_crypto_smoke_Raven.png', { cache: 'no-cache' });
    if (!encRes.ok) throw new Error('smoke png HTTP ' + encRes.status);
    const encBuf = await encRes.arrayBuffer();
    await window.__AGENT_LOAD_GLB_BUFFER__(encBuf, '_crypto_smoke_Raven.png');
    const title = (document.getElementById('current-model-title') || {}).innerText || '';
    const suffix = ((document.getElementById('custom-prompt-suffix') || {}).innerText || '').trim();
    const emptyHidden = (document.getElementById('empty-state') || {}).style.display === 'none';
    return {
      ok: emptyHidden && /_crypto_smoke_Raven\.png/i.test(title),
      title,
      promptSuffix: suffix
    };
  });
  const mgrHtml = await page.content();
  const mgrWired =
    /model-crypto\/ModelCrypto\.js/.test(mgrHtml) &&
    /writeEncryptedModelFile/.test(mgrHtml) &&
    /toGlbArrayBuffer/.test(mgrHtml) &&
    /encryptGlb/.test(mgrHtml);

  // --- Create：双轨胶水 + 密文 fetch→解密→parse（与消费端同算法）---
  await page.goto(CREATE, { waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForSelector('#scene-loader', { state: 'hidden', timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const createHtml = await page.content();
  const createWired =
    /model-crypto\/ModelCrypto\.js/.test(createHtml) &&
    /solidCreateFetchParseGlb/.test(createHtml) &&
    /toGlbArrayBuffer/.test(createHtml);

  const createParse = await page.evaluate(async () => {
    const mod = await import('/docs/js/model-crypto/ModelCrypto.js');
    const { toGlbArrayBuffer, isOurContainer, isProbablyGlb } = mod;
    const { GLTFLoader } = await import('/docs/js/three_164/examples/jsm/loaders/GLTFLoader.js');
    const { DRACOLoader } = await import('/docs/js/three_164/examples/jsm/loaders/DRACOLoader.js');
    const raw = await (
      await fetch('/docs/m/_crypto_smoke_Raven.png', { cache: 'no-cache' })
    ).arrayBuffer();
    if (!isOurContainer(raw)) throw new Error('样例非 PTGL');
    const glb = await toGlbArrayBuffer(raw);
    if (!isProbablyGlb(glb)) throw new Error('解密后非 glb');
    const loader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath('/docs/js/three_164/examples/jsm/libs/draco/gltf/');
    loader.setDRACOLoader(draco);
    const gltf = await loader.parseAsync(glb, '/docs/m/_crypto_smoke_Raven.png');
    let meshCount = 0;
    gltf.scene.traverse((o) => {
      if (o.isMesh) meshCount++;
    });
    // 生产页入口是否暴露（插入密文路径靠它）
    const hasAdd = typeof window.addEditorGLB === 'function';
    return { ok: meshCount > 0, meshCount, hasAdd };
  });

  // 再走一遍真实 addEditorGLB（若已就绪）
  let createInsert = { skipped: true };
  if (createParse && createParse.hasAdd) {
    try {
      createInsert = await page.evaluate(async () => {
        const url = '../../docs/m/_crypto_smoke_Raven.png';
        return await new Promise((resolve, reject) => {
          const t = setTimeout(() => reject(new Error('addEditorGLB 超时 90s')), 90000);
          const prevAlert = window.alert;
          window.alert = (msg) => {
            clearTimeout(t);
            window.alert = prevAlert;
            reject(new Error('alert: ' + msg));
          };
          try {
            window.addEditorGLB(url);
          } catch (e) {
            clearTimeout(t);
            window.alert = prevAlert;
            reject(e);
            return;
          }
          const tick = () => {
            const sel = window.selectedObj;
            const urlHit =
              sel &&
              sel.userData &&
              /_crypto_smoke_Raven\.png/i.test(String(sel.userData.url || ''));
            if (urlHit) {
              clearTimeout(t);
              window.alert = prevAlert;
              resolve({ ok: true, via: 'selectedObj', url: String(sel.userData.url) });
              return;
            }
            setTimeout(tick, 250);
          };
          tick();
        });
      });
    } catch (e) {
      createInsert = { ok: false, error: String((e && e.message) || e) };
    }
  }

  const solidHtml = await (await page.request.get(BASE + '/Solid')).text();
  const solidWired =
    /model-crypto\/ModelCrypto\.js/.test(solidHtml) && /toGlbArrayBuffer/.test(solidHtml);

  await browser.close();

  const insertOk = !!(createInsert && (createInsert.skipped || createInsert.ok));
  const result = {
    ok:
      !!(mgr && mgr.ok && mgr.promptSuffix === '.png' && mgrWired) &&
      !!(createWired && createParse && createParse.ok) &&
      insertOk &&
      !!solidWired &&
      errors.length === 0,
    mgr: { ...mgr, wired: mgrWired },
    create: { wired: createWired, parse: createParse, insert: createInsert },
    solidWired,
    pageErrors: errors.slice(0, 8)
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
