/**
 * 只重钉指定槽的指定点（或整槽），带去重。
 * SLOT=V04 ONLY=8,E 或 SLOT=V01（整槽）
 */
require('./_playwright-browsers-path');
const fs = require('fs');
const path = require('path');
const lib = require('./headform-vision-place-lib');

const SLOT = process.env.SLOT || 'V04';
const ONLY = (process.env.ONLY || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const port = process.env.PORT ? Number(process.env.PORT) : 18080;
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outDir = path.join(__dirname, '..', 'runs', `${stamp}-vision-fix-${SLOT}`);
fs.mkdirSync(outDir, { recursive: true });

async function rayPlaceNudge(page, u, v) {
  for (const [uu, vv] of [
    [u, v],
    [u + 0.01, v],
    [u - 0.01, v],
    [u, v + 0.01],
    [u, v - 0.01],
    [u + 0.02, v],
    [u + 0.015, v + 0.01]
  ]) {
    const r = await lib.rayPlace(page, uu, vv);
    if (r && r.ok) return Object.assign(r, { u: uu, v: vv });
  }
  return { ok: false, reason: 'no hit' };
}

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

  const hit = lib.findScene(SLOT, 'male_bald_asian_01');
  if (!hit) throw new Error('missing ' + SLOT);
  const ref = lib.findScene(SLOT, 'reference');
  const scenePath = path.join(lib.jsonDir, hit.f);
  const landmarks = ONLY.length ? ONLY : lib.listLandmarks(SLOT);
  const cam = (((hit.d.items || [])[0] || {}).camera) || hit.d.camera || null;

  await lib.openScene(page, hit.d.id);
  await lib.applyCamera(page, cam);
  await lib.setAnnosVisible(page, false);

  const FORCE = process.env.FORCE === '1';
  const data0 = JSON.parse(fs.readFileSync(scenePath, 'utf8'));
  // FORCE 只放开「正在重钉」的点；其它已有点仍占位，避免钉到别人身上
  const used = (((data0.items || [])[0] || {}).annotations || [])
    .filter((a) => !landmarks.includes(String(a.text)))
    .map((a) => a.localPos)
    .filter(Boolean);

  const log = [];
  for (const lm of landmarks) {
    const card = lib.getCard(SLOT, lm);
    let placed = null;
    // 仅 preferBetween / BETWEEN=1 时优先邻点；FORCE  alone 不抢先，避免远端颊点被插值漂到鼻唇
    if (card && Array.isArray(card.between) && card.between.length === 2 && (card.preferBetween || process.env.BETWEEN === '1')) {
      const dataNow = JSON.parse(fs.readFileSync(scenePath, 'utf8'));
      const annNow = (((dataNow.items || [])[0] || {}).annotations) || [];
      const a = annNow.find((x) => String(x.text) === String(card.between[0]));
      const b = annNow.find((x) => String(x.text) === String(card.between[1]));
      if (a && a.localPos && b && b.localPos) {
        const trial = await lib.placeBetweenNeighbors(page, a.localPos, b.localPos, {
          bias: card.betweenBias != null ? card.betweenBias : 0.5,
          zNudge: card.betweenZNudge != null ? card.betweenZNudge : 0.01,
          xNudge: card.betweenXNudge != null ? card.betweenXNudge : 0,
          yNudge: card.betweenYNudge != null ? card.betweenYNudge : 0,
          preferFar:
            !card.noPreferFar &&
            !!(card.band && (card.band.side === 'farCheek' || card.band.side === 'farCheekInset')),
          preferFront: !!(card.band && (card.band.preferFront || card.band.side === 'chinL' || card.band.side === 'chinC'))
        });
          if (trial && trial.ok) {
          const minDist = card.betweenMinDist != null ? card.betweenMinDist : 0.006;
          let nearest = Infinity;
          used.forEach((lp) => {
            const dx = lp[0] - trial.localPos[0];
            const dy = lp[1] - trial.localPos[1];
            const dz = lp[2] - trial.localPos[2];
            nearest = Math.min(nearest, Math.sqrt(dx * dx + dy * dy + dz * dz));
          });
          if (nearest >= minDist) {
            placed = trial;
            console.log('between-first', lm, card.between.join('-'), placed.localPos);
          } else if (card.preferBetween && nearest >= minDist * 0.45) {
            // 自锚下移点易贴邻点：preferBetween 时放宽半档，避免整点失败留旧错位
            placed = trial;
            console.log('between-first soft', lm, card.between.join('-'), placed.localPos, 'near', +nearest.toFixed(4));
          } else {
            console.log('between-first tooClose', lm, 'near', +nearest.toFixed(4));
          }
        }
      }
    }
    const prop = await lib.proposeCandidates(page, lm, SLOT);
    fs.writeFileSync(path.join(outDir, `propose_${lm}.json`), JSON.stringify(prop, null, 2));
    const cands = prop.candidates || [];
    if (!placed) {
      for (const rec of cands) {
        const trial = await rayPlaceNudge(page, rec.u, rec.v);
        if (!trial.ok) continue;
        const tooClose = used.some((lp) => {
          const dx = lp[0] - trial.localPos[0];
          const dy = lp[1] - trial.localPos[1];
          const dz = lp[2] - trial.localPos[2];
          return Math.sqrt(dx * dx + dy * dy + dz * dz) < 0.008;
        });
        if (tooClose) continue;
        placed = trial;
        break;
      }
    }
    // 侧光颊切迹等：propose 空/全撞点时用同模邻点语义插值贴面
    if ((!placed || !placed.ok) && card && Array.isArray(card.between) && card.between.length === 2) {
      const dataNow = JSON.parse(fs.readFileSync(scenePath, 'utf8'));
      const annNow = (((dataNow.items || [])[0] || {}).annotations) || [];
      const a = annNow.find((x) => String(x.text) === String(card.between[0]));
      const b = annNow.find((x) => String(x.text) === String(card.between[1]));
      if (a && a.localPos && b && b.localPos) {
        const trial = await lib.placeBetweenNeighbors(page, a.localPos, b.localPos, {
          bias: card.betweenBias != null ? card.betweenBias : 0.5,
          zNudge: card.betweenZNudge != null ? card.betweenZNudge : 0.01,
          xNudge: card.betweenXNudge != null ? card.betweenXNudge : 0,
          yNudge: card.betweenYNudge != null ? card.betweenYNudge : 0,
          preferFar:
            !card.noPreferFar &&
            !!(card.band && (card.band.side === 'farCheek' || card.band.side === 'farCheekInset')),
          preferFront: !!(card.band && (card.band.preferFront || card.band.side === 'chinL' || card.band.side === 'chinC'))
        });
        if (trial && trial.ok) {
          const minDist = card.betweenMinDist != null ? card.betweenMinDist : 0.008;
          const tooClose = used.some((lp) => {
            const dx = lp[0] - trial.localPos[0];
            const dy = lp[1] - trial.localPos[1];
            const dz = lp[2] - trial.localPos[2];
            return Math.sqrt(dx * dx + dy * dy + dz * dz) < minDist;
          });
          if (!tooClose) {
            placed = trial;
            console.log('between', lm, card.between.join('-'), placed.localPos);
          } else {
            console.log('between tooClose', lm);
          }
        }
      }
    }
    if (!placed || !placed.ok) {
      log.push({ lm, ok: false });
      continue;
    }
    let tmpl = null;
    if (ref) tmpl = ((((ref.d.items || [])[0] || {}).annotations) || []).find((a) => String(a.text) === String(lm));
    lib.writeLandmark(scenePath, lm, placed, tmpl, SLOT);
    used.push(placed.localPos);
    log.push({ lm, ok: true, localPos: placed.localPos });
    console.log('fix', lm, placed.localPos);
  }

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Array.isArray(window.customScenes) && window.customScenes.length > 0, null, {
    timeout: 180000
  });
  await lib.openScene(page, hit.d.id);
  await lib.applyCamera(page, cam);
  await lib.setAnnosVisible(page, true);
  await page.screenshot({ path: path.join(outDir, 'verify.png') });

  const data = JSON.parse(fs.readFileSync(scenePath, 'utf8'));
  data.meta.status = log.every((x) => x.ok) ? 'vision_place_pending_qa' : 'vision_place_partial';
  fs.writeFileSync(scenePath, JSON.stringify(data));
  lib.rebuildAggregate();
  fs.writeFileSync(path.join(outDir, 'log.json'), JSON.stringify(log, null, 2));
  console.log(JSON.stringify({ ok: true, outDir, log }, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
