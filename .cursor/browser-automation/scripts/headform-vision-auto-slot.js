/**
 * 单槽自动视觉定点：一页内对所有语义卡点 propose→推荐 UV→射线落面，
 * 写完 JSON 后只 reload 一次并出 teach+verify 截图。
 *
 * 用法：
 *   SLOT=V06 node scripts/headform-vision-auto-slot.js
 *   SLOTS=V06,V07,V01 node scripts/headform-vision-auto-slot.js
 *   ALL_V=1 node ...   # V01–V07 + V05a/b
 */
require('./_playwright-browsers-path');
const fs = require('fs');
const path = require('path');
const lib = require('./headform-vision-place-lib');

const port = process.env.PORT ? Number(process.env.PORT) : 18080;
const ALL_V = process.env.ALL_V === '1';
const SLOTS = ALL_V
  ? ['V06', 'V07', 'V02', 'V01', 'V03', 'V04', 'V05a', 'V05b']
  : (process.env.SLOTS || process.env.SLOT || 'V06')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const runsRoot = path.join(__dirname, '..', 'runs', `${stamp}-vision-auto`);
fs.mkdirSync(runsRoot, { recursive: true });

async function rayPlaceNudge(page, u, v) {
  const tries = [
    [u, v],
    [u + 0.008, v],
    [u - 0.008, v],
    [u, v + 0.008],
    [u, v - 0.008],
    [u + 0.012, v + 0.006],
    [u + 0.015, v]
  ];
  for (const [uu, vv] of tries) {
    const r = await lib.rayPlace(page, uu, vv);
    if (r && r.ok) return Object.assign(r, { u: uu, v: vv });
  }
  return { ok: false, reason: 'no hit after nudge', u, v };
}

async function runSlot(page, slot) {
  const outDir = path.join(runsRoot, slot);
  fs.mkdirSync(outDir, { recursive: true });
  const hit = lib.findScene(slot, 'male_bald_asian_01');
  if (!hit) throw new Error('bald missing ' + slot);
  const ref = lib.findScene(slot, 'reference');
  const scenePath = path.join(lib.jsonDir, hit.f);
  const sceneId = hit.d.id;
  const cam = (((hit.d.items || [])[0] || {}).camera) || hit.d.camera || null;
  const landmarks = lib.listLandmarks(slot);
  if (!landmarks.length) throw new Error('no cards for ' + slot);

  const log = { slot, scene: hit.f, landmarks, placed: [] };

  // teach
  if (ref) {
    await lib.openScene(page, ref.d.id);
    await lib.applyCamera(page, (((ref.d.items || [])[0] || {}).camera) || null);
    await lib.setAnnosVisible(page, true);
    await page.screenshot({ path: path.join(outDir, 'teach_annos.png') });
  }

  await lib.openScene(page, sceneId);
  await lib.applyCamera(page, cam);
  await lib.setAnnosVisible(page, false);

  for (const lm of landmarks) {
    const prop = await lib.proposeCandidates(page, lm, slot);
    fs.writeFileSync(path.join(outDir, `propose_${lm}.json`), JSON.stringify(prop, null, 2));
    const cands = prop.candidates || [];
    if (!cands.length) {
      log.placed.push({ lm, ok: false, reason: 'no candidates' });
      continue;
    }
    await lib.overlayCandidates(page, cands);
    await page.screenshot({ path: path.join(outDir, `propose_${lm}.png`) });
    await lib.clearOverlay(page);

    // 避免多点塌缩到同一命中：若与已写点过近则换下一候选
    const used = log.placed.filter((p) => p.ok && p.localPos).map((p) => p.localPos);
    let placed = null;
    let usedCand = null;
    for (const rec of cands) {
      const trial = await rayPlaceNudge(page, rec.u, rec.v);
      if (!trial.ok) continue;
      const tooClose = used.some((lp) => {
        const dx = lp[0] - trial.localPos[0];
        const dy = lp[1] - trial.localPos[1];
        const dz = lp[2] - trial.localPos[2];
        return Math.sqrt(dx * dx + dy * dy + dz * dz) < 0.012;
      });
      if (tooClose) continue;
      placed = trial;
      usedCand = rec;
      break;
    }
    if (!placed) {
      // 兜底仍用推荐
      const rec = prop.recommended || cands[0];
      placed = await rayPlaceNudge(page, rec.u, rec.v);
      usedCand = rec;
    }
    if (!placed || !placed.ok) {
      log.placed.push({ lm, ok: false, reason: (placed && placed.reason) || 'no hit', rec: usedCand });
      continue;
    }
    let tmpl = null;
    if (ref) {
      tmpl = ((((ref.d.items || [])[0] || {}).annotations) || []).find((a) => String(a.text) === String(lm));
    }
    lib.writeLandmark(scenePath, lm, placed, tmpl, slot);
    log.placed.push({
      lm,
      ok: true,
      u: placed.u,
      v: placed.v,
      localPos: placed.localPos,
      recommend: usedCand && usedCand.i
    });
    console.log(`[${slot}] ${lm} ok`, placed.localPos);
  }

  // one reload + verify
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Array.isArray(window.customScenes) && window.customScenes.length > 0, null, {
    timeout: 180000
  });
  await lib.openScene(page, sceneId);
  await lib.applyCamera(page, cam);
  await lib.setAnnosVisible(page, true);
  await page.screenshot({ path: path.join(outDir, 'verify.png') });

  // status
  const data = JSON.parse(fs.readFileSync(scenePath, 'utf8'));
  const fail = log.placed.filter((p) => !p.ok);
  data.meta = Object.assign({}, data.meta || {}, {
    status: fail.length ? 'vision_place_partial' : 'vision_place_pending_qa',
    modelId: 'male_bald_asian_01',
    modelRole: 'contrast',
    modelLabel: '光头亚裔'
  });
  fs.writeFileSync(scenePath, JSON.stringify(data));
  lib.rebuildAggregate();

  fs.writeFileSync(path.join(outDir, 'log.json'), JSON.stringify(log, null, 2));
  return log;
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

  const summary = [];
  for (const slot of SLOTS) {
    console.log('=== SLOT', slot);
    try {
      const log = await runSlot(page, slot);
      summary.push({
        slot,
        ok: log.placed.every((p) => p.ok),
        n: log.placed.length,
        fail: log.placed.filter((p) => !p.ok).map((p) => p.lm)
      });
    } catch (e) {
      console.error(slot, e);
      summary.push({ slot, ok: false, error: String(e && e.message ? e.message : e) });
    }
  }

  fs.writeFileSync(path.join(runsRoot, 'summary.json'), JSON.stringify({ slots: SLOTS, summary }, null, 2));
  console.log(JSON.stringify({ ok: true, runsRoot, summary }, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
