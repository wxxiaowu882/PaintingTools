/**
 * 强制邻点插值补钉（preferFar 关闭，仅按远颊分择优）
 * MODEL_ID=male_ipman_01 SLOT=V01 ONLY=5,4,C,D node scripts/headform-vision-force-between.js
 */
require('./_playwright-browsers-path');
const fs = require('fs');
const path = require('path');
const lib = require('./headform-vision-place-lib');

const MODEL_ID = process.env.MODEL_ID || 'male_ipman_01';
const MODEL_LABEL = process.env.MODEL_LABEL || (MODEL_ID === 'male_ipman_01' ? '叶问' : '光头亚裔');
const SLOT = process.env.SLOT || 'V01';
const ONLY = (process.env.ONLY || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const port = process.env.PORT ? Number(process.env.PORT) : 18080;

(async () => {
  const browser = await lib.launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`http://127.0.0.1:${port}/Solid?sandbox=headform`, {
    waitUntil: 'domcontentloaded',
    timeout: 120000
  });
  await page.waitForFunction(() => Array.isArray(window.customScenes) && window.customScenes.length > 0, null, {
    timeout: 180000
  });

  const hit = lib.findScene(SLOT, MODEL_ID);
  if (!hit) throw new Error('missing ' + MODEL_ID + ' ' + SLOT);
  const scenePath = path.join(lib.jsonDir, hit.f);
  const cam = (((hit.d.items || [])[0] || {}).camera) || hit.d.camera || null;
  await lib.openScene(page, hit.d.id);
  await lib.applyCamera(page, cam);
  await lib.setAnnosVisible(page, false);

  const landmarks = ONLY.length ? ONLY : lib.listLandmarks(SLOT);
  const log = [];
  for (const lm of landmarks) {
    const card = lib.getCard(SLOT, lm);
    const dataNow = JSON.parse(fs.readFileSync(scenePath, 'utf8'));
    const annNow = (((dataNow.items || [])[0] || {}).annotations) || [];
    let aPos = null;
    let bPos = null;
    if (card && Array.isArray(card.between) && card.between.length === 2) {
      const a = annNow.find((x) => String(x.text) === String(card.between[0]));
      const b = annNow.find((x) => String(x.text) === String(card.between[1]));
      if (a && a.localPos) aPos = a.localPos;
      if (b && b.localPos) bPos = b.localPos;
    }
    // 缺邻点：自锚下移用 3 或已有最近点
    if (!aPos || !bPos) {
      const fallback = annNow.find((x) => String(x.text) === '3') || annNow[0];
      if (fallback && fallback.localPos) {
        aPos = aPos || fallback.localPos;
        bPos = bPos || fallback.localPos;
      }
    }
    if (!aPos || !bPos) {
      console.log('skip no anchor', lm);
      log.push({ lm, ok: false, reason: 'no anchor' });
      continue;
    }
    const trial = await lib.placeBetweenNeighbors(page, aPos, bPos, {
      bias: card && card.betweenBias != null ? card.betweenBias : 0.5,
      zNudge: card && card.betweenZNudge != null ? card.betweenZNudge : 0,
      xNudge: card && card.betweenXNudge != null ? card.betweenXNudge : 0,
      yNudge: card && card.betweenYNudge != null ? card.betweenYNudge : 0,
      preferFar: false,
      preferFront: !!(card && card.band && card.band.preferFront)
    });
    if (!trial || !trial.ok) {
      console.log('miss', lm, trial && trial.reason);
      log.push({ lm, ok: false, reason: (trial && trial.reason) || 'miss' });
      continue;
    }
    process.env.MODEL_ID = MODEL_ID;
    process.env.MODEL_LABEL = MODEL_LABEL;
    lib.writeLandmark(scenePath, lm, trial, null, SLOT);
    console.log('force', lm, trial.localPos, trial.via || '');
    log.push({ lm, ok: true, localPos: trial.localPos });
  }

  const outDir = path.join(
    __dirname,
    '..',
    'runs',
    `${new Date().toISOString().replace(/[:.]/g, '-')}-force-between-${SLOT}`
  );
  fs.mkdirSync(outDir, { recursive: true });
  await lib.openScene(page, hit.d.id);
  await lib.applyCamera(page, cam);
  await lib.setAnnosVisible(page, true);
  await page.screenshot({ path: path.join(outDir, 'verify.png') });
  fs.writeFileSync(path.join(outDir, 'log.json'), JSON.stringify(log, null, 2));
  await browser.close();
  console.log(JSON.stringify({ ok: true, outDir, log }, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
