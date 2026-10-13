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
// 单槽优先：流水线传 SLOT= 时勿被父进程遗留的 SLOTS= 整表覆盖
const SLOTS = ALL_V
  ? ['V06', 'V07', 'V02', 'V01', 'V03', 'V04', 'V05a', 'V05b']
  : process.env.SLOT
    ? [String(process.env.SLOT).trim()].filter(Boolean)
    : (process.env.SLOTS || 'V06')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const runsRoot = path.join(__dirname, '..', 'runs', `${stamp}-vision-auto`);
fs.mkdirSync(runsRoot, { recursive: true });
const SKIP_TEACH = process.env.SKIP_TEACH === '1';
const SKIP_PROPOSE_SHOT = process.env.SKIP_PROPOSE_SHOT === '1';

async function softShot(page, filePath, label) {
  try {
    await page.screenshot({ path: filePath, timeout: 60000 });
    return true;
  } catch (e) {
    console.warn('[softShot]', label || filePath, String(e && e.message ? e.message : e));
    return false;
  }
}

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
  const MODEL_ID = process.env.MODEL_ID || 'male_bald_asian_01';
  const hit = lib.findScene(slot, MODEL_ID);
  if (!hit) throw new Error(MODEL_ID + ' missing ' + slot);
  const ref = lib.findScene(slot, 'reference');
  const scenePath = path.join(lib.jsonDir, hit.f);
  const sceneId = hit.d.id;
  const cam = (((hit.d.items || [])[0] || {}).camera) || hit.d.camera || null;
  const landmarks = lib.listLandmarks(slot);
  if (!landmarks.length) throw new Error('no cards for ' + slot);

  const log = { slot, scene: hit.f, landmarks, placed: [] };

  // teach（可选；失败不阻断定点）
  if (ref && !SKIP_TEACH) {
    try {
      await lib.openSceneData(page, ref.d);
      await lib.applyCamera(page, (((ref.d.items || [])[0] || {}).camera) || null);
      await lib.setAnnosVisible(page, true);
      await softShot(page, path.join(outDir, 'teach_annos.png'), slot + '/teach');
    } catch (e) {
      console.warn('[teach]', slot, String(e && e.message ? e.message : e));
    }
  }

  // 每次从磁盘读最新（避免写点后内存对象过期）
  let live = JSON.parse(fs.readFileSync(scenePath, 'utf8'));
  await lib.openSceneData(page, live);
  await lib.applyCamera(page, cam);
  await lib.setAnnosVisible(page, false);

  for (const lm of landmarks) {
    const prop = await lib.proposeCandidates(page, lm, slot);
    fs.writeFileSync(path.join(outDir, `propose_${lm}.json`), JSON.stringify(prop, null, 2));
    const cands = prop.candidates || [];
    // 空候选不再直接跳过：后面 between / 兜底仍可能落点
    if (!cands.length) {
      console.warn(`[${slot}] ${lm} no candidates, will try between/fallback`);
    } else {
    try {
      await lib.overlayCandidates(page, cands);
      if (!SKIP_PROPOSE_SHOT) {
        await softShot(page, path.join(outDir, `propose_${lm}.png`), slot + '/propose_' + lm);
      }
      await lib.clearOverlay(page);
    } catch (e) {
      console.warn('[propose-shot]', slot, lm, String(e && e.message ? e.message : e));
      try {
        await lib.clearOverlay(page);
      } catch (_e) {}
    }
    }

    const card = lib.getCard(slot, lm);
    // 避免多点塌缩到同一命中：若与已写点过近则换下一候选
    const used = log.placed.filter((p) => p.ok && p.localPos).map((p) => p.localPos);
    let placed = null;
    let usedCand = null;

    // preferBetween：邻点已齐时优先插值贴面（窄头 farCheek 常空）
    if (card && Array.isArray(card.between) && card.between.length === 2 && (card.preferBetween || process.env.BETWEEN === '1')) {
      const a = log.placed.find((p) => p.ok && String(p.lm) === String(card.between[0]));
      const b = log.placed.find((p) => p.ok && String(p.lm) === String(card.between[1]));
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
            usedCand = { i: 'between', u: trial.u, v: trial.v };
            console.log(`[${slot}] ${lm} between`, card.between.join('-'), placed.localPos);
          }
        }
      }
    }

    for (const rec of cands) {
      if (placed) break;
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
    if (!placed && cands.length) {
      // 兜底仍用推荐
      const rec = prop.recommended || cands[0];
      placed = await rayPlaceNudge(page, rec.u, rec.v);
      usedCand = rec;
    }
    // propose 空或全撞：邻点插值兜底（不要求 preferBetween）
    if ((!placed || !placed.ok) && card && Array.isArray(card.between) && card.between.length === 2) {
      const a = log.placed.find((p) => p.ok && String(p.lm) === String(card.between[0]));
      const b = log.placed.find((p) => p.ok && String(p.lm) === String(card.between[1]));
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
            usedCand = { i: 'between-fallback', u: trial.u, v: trial.v };
            console.log(`[${slot}] ${lm} between-fallback`, card.between.join('-'), placed.localPos);
          }
        }
      }
    }
    if (!placed || !placed.ok) {
      log.placed.push({ lm, ok: false, reason: (placed && placed.reason) || (cands.length ? 'no hit' : 'no candidates'), rec: usedCand });
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

  // verify：注入写后 JSON，不必重载整库
  live = JSON.parse(fs.readFileSync(scenePath, 'utf8'));
  await lib.openSceneData(page, live);
  await lib.applyCamera(page, cam);
  await lib.setAnnosVisible(page, true);
  await softShot(page, path.join(outDir, 'verify.png'), slot + '/verify');

  // status
  const data = JSON.parse(fs.readFileSync(scenePath, 'utf8'));
  const fail = log.placed.filter((p) => !p.ok);
  const mid = process.env.MODEL_ID || 'male_bald_asian_01';
  const label =
    process.env.MODEL_LABEL ||
    (mid === 'male_ipman_01'
      ? '叶问'
      : mid === 'male_bald_asian_01'
        ? '光头亚裔'
        : mid === 'female_euro_02'
          ? '欧女'
          : mid === 'male_euro_aaron_01'
            ? '欧男'
            : mid === 'female_05'
              ? '女05'
              : mid);
  data.meta = Object.assign({}, data.meta || {}, {
    status: fail.length ? 'vision_place_partial' : 'vision_place_pending_qa',
    modelId: mid,
    modelRole: 'contrast',
    modelLabel: label
  });
  fs.writeFileSync(scenePath, JSON.stringify(data));
  lib.rebuildAggregate();

  fs.writeFileSync(path.join(outDir, 'log.json'), JSON.stringify(log, null, 2));
  return log;
}

(async () => {
  const browser = await lib.launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(`http://127.0.0.1:${port}/Solid?sandbox=headform&skipPerf=1`, {
    waitUntil: 'domcontentloaded',
    timeout: 120000
  });
  await page.waitForFunction(
    () => !!(window.__solidHost && typeof window.switchScene === 'function'),
    null,
    { timeout: 180000 }
  );
  // 不必等 100+ 聚合索引；后续 openSceneData 单关注入
  await page.waitForTimeout(1500);

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
  const allOk = summary.length > 0 && summary.every((s) => s.ok);
  console.log(JSON.stringify({ ok: allOk, runsRoot, summary }, null, 2));
  await browser.close();
  process.exit(allOk ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
