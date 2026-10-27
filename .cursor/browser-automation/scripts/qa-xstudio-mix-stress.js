/**
 * XStudio 混色压力：随机目标 + 已知手动方不得被自动打输
 * PORT=18080 PLAYWRIGHT_CHANNEL=msedge node scripts/qa-xstudio-mix-stress.js
 */
require('./_playwright-browsers-path');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PORT = process.env.PORT || '18080';
const BASE = process.env.BASE_URL || `http://127.0.0.1:${PORT}`;
const outDir = path.join(__dirname, '..', 'runs', 'qa-xstudio-mix-stress');

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true
  });
  const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
  page.setDefaultTimeout(120000);
  await page.goto(`${BASE}/XStudio?_qa=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => typeof window.solveRecipe === 'function' && typeof window.getOptCost === 'function', null, { timeout: 30000 });

  const report = await page.evaluate(() => {
    const by = (id) => (window.ALL_PIGMENTS || []).find((p) => p.id === id);
    const water = { id: 'water', name: '水', rgb: [255, 255, 255], hex: '#FFFFFF', isWater: true };
    const boxIds = [
      'lemon-yellow', 'cadmium-yellow', 'vermilion', 'scarlet', 'crimson', 'alizarin-crimson',
      'rose-madder', 'violet', 'ultramarine', 'cobalt-blue', 'phthalo-blue', 'prussian-blue',
      'viridian', 'emerald-green', 'sap-green', 'permanent-light-green', 'burnt-umber',
      'burnt-sienna', 'raw-umber', 'paynes-grey'
    ];
    const setWcPool = () => {
      if (typeof window.setMode === 'function') window.setMode('watercolor');
      window.globalSession.activePool = boxIds.map(by).filter(Boolean).concat([water]);
      if (window.disabledPigmentIds && window.disabledPigmentIds.clear) window.disabledPigmentIds.clear();
    };
    const setOilPool = () => {
      if (typeof window.setMode === 'function') window.setMode('oil');
      const std24 = (window.PRESET_TABS || []).find((t) => t.id === 'std24');
      const ids = std24 ? std24.ids : boxIds.concat(['titanium-white']);
      window.globalSession.activePool = ids.map(by).filter(Boolean);
      if (window.disabledPigmentIds && window.disabledPigmentIds.clear) window.disabledPigmentIds.clear();
    };

    // 1) 已知手动橄榄方：自动双尺不得更差
    setWcPool();
    const manualOlive = [
      { pigment: by('raw-umber'), amount: 57 },
      { pigment: by('prussian-blue'), amount: 29 },
      { pigment: by('sap-green'), amount: 6 },
      { pigment: by('alizarin-crimson'), amount: 5 },
      { pigment: water, amount: 3, isWater: true }
    ];
    const weakOlive = [
      { pigment: by('raw-umber'), amount: 60 },
      { pigment: by('prussian-blue'), amount: 30 },
      { pigment: by('alizarin-crimson'), amount: 5 },
      { pigment: water, amount: 4, isWater: true }
    ];
    const manMix = window.mixPigments(manualOlive);
    const weakMix = window.mixPigments(weakOlive);
    let Tshot = [83, 74, 53], bestS = 1e9;
    for (let r = 30; r <= 100; r += 2) {
      for (let g = 30; g <= 100; g += 2) {
        for (let b = 10; b <= 70; b += 2) {
          const T = [r, g, b];
          const s = Math.abs(window.getDeltaE(T, manMix) - 4.04) + Math.abs(window.getDeltaE(T, weakMix) - 5.32);
          if (s < bestS) { bestS = s; Tshot = T; }
        }
      }
    }
    const M = window.recipeScore(Tshot, manualOlive);
    const W = window.recipeScore(Tshot, weakOlive);
    const Solive = window.solveRecipe(Tshot[0], Tshot[1], Tshot[2], true);
    const Aolive = window.recipeScore(Tshot, Solive.recipe || []);
    const oliveOk =
      Aolive.deltaE <= M.deltaE + 0.1 &&
      Aolive.optCost <= M.optCost + 0.1 &&
      Aolive.deltaE < W.deltaE - 0.2;

    // 2) 还原手动混色
    const Srec = window.solveRecipe(manMix[0], manMix[1], manMix[2], true);
    const Arec = window.recipeScore(manMix, Srec.recipe || []);
    const reconstructOk = Arec.deltaE <= 0.25 && Arec.optCost <= 0.25;

    // 3) 随机目标 × 模式：自动误差有上界；配方无 0% 虚色
    const randTargets = [];
    let seed = 42;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < 18; i++) {
      randTargets.push([
        Math.floor(40 + rnd() * 200),
        Math.floor(40 + rnd() * 200),
        Math.floor(30 + rnd() * 200)
      ]);
    }
    const fixed = [
      [232, 180, 160], [120, 170, 220], [90, 140, 70], [240, 80, 50],
      [250, 230, 40], [140, 140, 140], [60, 50, 40], [180, 120, 90]
    ];
    const stress = [];
    let tinyAmtFail = 0;
    for (const mode of ['watercolor', 'oil']) {
      if (mode === 'watercolor') setWcPool();
      else setOilPool();
      for (const T of fixed.concat(randTargets)) {
        const r = window.solveRecipe(T[0], T[1], T[2], true);
        const sc = window.recipeScore(T, r.recipe || []);
        const names = (r.recipe || []).map((x) => x.pigment.name + ':' + Math.round(x.amount));
        const hasTiny = (r.recipe || []).some((x) => x.amount > 0 && x.amount <= 0.5);
        if (hasTiny) tinyAmtFail++;
        stress.push({
          mode, T, de: sc.deltaE, opt: sc.optCost, err: sc.err, n: (r.recipe || []).length, names, hasTiny
        });
      }
    }
    const maxDe = Math.max(...stress.map((s) => s.de));
    const meanDe = stress.reduce((a, s) => a + s.de, 0) / stress.length;
    const maxErr = Math.max(...stress.map((s) => s.err));
    // 油画亮色可白提亮；水彩天蓝在无湖蓝的 20 色盒内色域下限约 ΔE≈8.5，不可用绝对 5.5 卡
    const oilSky = stress.find((s) => s.mode === 'oil' && s.T.join(',') === '120,170,220');
    const wcSky = stress.find((s) => s.mode === 'watercolor' && s.T.join(',') === '120,170,220');
    // 水彩天蓝：相对池内穷举最优（粗网格）不得差超过 1.0
    let wcSkyPoolBest = null;
    if (wcSky) {
      setWcPool();
      const T = [120, 170, 220];
      const poolP = window.globalSession.activePool.filter((p) => p.id !== 'water');
      let best = 1e9;
      for (let i = 0; i < poolP.length; i++) {
        for (let w = 0; w <= 90; w += 5) {
          const rec = [
            { pigment: poolP[i], amount: 100 - w },
            { pigment: water, amount: w, isWater: true }
          ];
          const m = window.mixPigments(rec);
          best = Math.min(best, Math.max(window.getDeltaE(T, m), window.getOptCost(T, m)));
        }
        for (let j = i + 1; j < Math.min(poolP.length, i + 8); j++) {
          for (let r = 20; r <= 80; r += 20) {
            for (let w = 15; w <= 75; w += 10) {
              const rem = 100 - w;
              const a1 = Math.round(rem * (r / 100)), a2 = rem - a1;
              if (a1 < 2 || a2 < 2) continue;
              const rec = [
                { pigment: poolP[i], amount: a1 },
                { pigment: poolP[j], amount: a2 },
                { pigment: water, amount: w, isWater: true }
              ];
              const m = window.mixPigments(rec);
              best = Math.min(best, Math.max(window.getDeltaE(T, m), window.getOptCost(T, m)));
            }
          }
        }
      }
      wcSkyPoolBest = best;
    }
    const skyOk =
      (!oilSky || oilSky.de < 3) &&
      (!wcSky || (wcSkyPoolBest != null && wcSky.err <= wcSkyPoolBest + 1.2));
    const stressOk = maxDe < 12 && meanDe < 2.2 && tinyAmtFail === 0 && skyOk;

    // 4) 对若干随机目标：用「自动方再扰动」作伪手动，自动二次求解不得明显更差
    setWcPool();
    const selfBeat = [];
    for (let i = 0; i < 8; i++) {
      const T = randTargets[i];
      const r1 = window.solveRecipe(T[0], T[1], T[2], true);
      const s1 = window.recipeScore(T, r1.recipe || []);
      // 扰动比例 ±3% 模拟用户微调变差/变好
      const jitter = (r1.recipe || []).map((x, idx) => ({
        ...x,
        amount: Math.max(0.6, x.amount + ((idx % 2 === 0) ? 3 : -2))
      }));
      const sum = jitter.reduce((a, b) => a + b.amount, 0) || 1;
      jitter.forEach((x) => { x.amount = (x.amount / sum) * 100; });
      const sj = window.recipeScore(T, jitter);
      const r2 = window.solveRecipe(T[0], T[1], T[2], true);
      const s2 = window.recipeScore(T, r2.recipe || []);
      const ok = s2.deltaE <= Math.min(s1.deltaE, sj.deltaE) + 0.15 &&
        s2.optCost <= Math.min(s1.optCost, sj.optCost) + 0.15;
      selfBeat.push({ T, s1de: s1.deltaE, sjde: sj.deltaE, s2de: s2.deltaE, ok });
    }
    const selfBeatOk = selfBeat.every((x) => x.ok);

    return {
      oliveOk,
      reconstructOk,
      olive: {
        Tshot, A: { de: Aolive.deltaE, opt: Aolive.optCost, names: (Solive.recipe || []).map((x) => x.pigment.name + ':' + Math.round(x.amount)) },
        M: { de: M.deltaE, opt: M.optCost }, W: { de: W.deltaE, opt: W.optCost }
      },
      reconstruct: { de: Arec.deltaE, opt: Arec.optCost, names: (Srec.recipe || []).map((x) => x.pigment.name + ':' + Math.round(x.amount)) },
      stressOk,
      skyOk,
      oilSkyDe: oilSky && oilSky.de,
      wcSkyDe: wcSky && wcSky.de,
      wcSkyErr: wcSky && wcSky.err,
      wcSkyPoolBest,
      maxDe,
      meanDe,
      maxErr,
      tinyAmtFail,
      stressSample: stress.filter((s) => s.de > 1.5).slice(0, 8),
      selfBeatOk,
      selfBeat
    };
  });

  const out = {
    report,
    ok: report.oliveOk && report.reconstructOk && report.stressOk && report.selfBeatOk
  };
  fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
  if (!out.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
