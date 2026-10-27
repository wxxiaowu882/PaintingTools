/**
 * XStudio 混色/配方算法回归：CMYK 往返、水彩稀释、固定目标色 ΔE
 * PORT=18080 PLAYWRIGHT_CHANNEL=msedge node scripts/qa-xstudio-mix-algorithm.js
 */
require('./_playwright-browsers-path');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PORT = process.env.PORT || '18080';
const BASE = process.env.BASE_URL || `http://127.0.0.1:${PORT}`;
const outDir = path.join(__dirname, '..', 'runs', 'qa-xstudio-mix-algorithm');

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true
  });
  const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
  page.setDefaultTimeout(90000);
  await page.goto(`${BASE}/XStudio?_qa=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => typeof window.solveRecipe === 'function' && typeof window.mixPigments === 'function' && typeof window.getDeltaE === 'function', null, { timeout: 30000 });

  const report = await page.evaluate(() => {
    const near = (a, b, tol = 2) => Math.abs(a - b) <= tol;
    // --- CMYK 往返 ---
    const samples = [
      [255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255], [0, 0, 0],
      [128, 128, 128], [255, 247, 0], [220, 0, 40]
    ];
    const roundtrips = samples.map(rgb => {
      const cmyk = window.rgbToCmyk(...rgb);
      const back = window.cmykToRgb(...cmyk);
      // 标准：纯红应 m=y=1,c=k=0
      return { rgb, cmyk, back, ok: near(back[0], rgb[0]) && near(back[1], rgb[1]) && near(back[2], rgb[2]) };
    });
    const redCmyk = window.rgbToCmyk(255, 0, 0);
    const redCmykOk = Math.abs(redCmyk[0]) < 0.02 && Math.abs(redCmyk[1] - 1) < 0.02 && Math.abs(redCmyk[2] - 1) < 0.02 && Math.abs(redCmyk[3]) < 0.02;

    // 旧 bug：(c-k)/(1-k)^2 对灰阶会严重偏离；正确灰 128→k≈0.5,c=m=y=0
    const grayCmyk = window.rgbToCmyk(128, 128, 128);
    const grayOk = Math.abs(grayCmyk[0]) < 0.05 && Math.abs(grayCmyk[1]) < 0.05 && Math.abs(grayCmyk[2]) < 0.05 && Math.abs(grayCmyk[3] - (1 - 128 / 255)) < 0.05;

    // --- 水彩稀释 vs 油画加白 ---
    const midYellow = { id: 'medium-yellow', name: '中黄', rgb: [255, 230, 0], hex: '#FFE600' };
    const water = { id: 'water', name: '水', rgb: [255, 255, 255], hex: '#FFFFFF', isWater: true };
    const titanium = { id: 'titanium-white', name: '钛白', rgb: [255, 255, 255], hex: '#FFFFFF' };
    const prevMode = window.currentMode;
    // force watercolor
    const modeWater = 'watercolor', modeOil = 'oil';
    // currentMode is let in page - may not be on window; set via setMode if exists
    if (typeof window.setMode === 'function') window.setMode('watercolor');
    else { try { currentMode = 'watercolor'; } catch (_e) {} }
    const wcMix = window.mixPigments([
      { pigment: midYellow, amount: 40 },
      { pigment: water, amount: 60, isWater: true }
    ]);
    if (typeof window.setMode === 'function') window.setMode('oil');
    else { try { currentMode = 'oil'; } catch (_e) {} }
    const oilMix = window.mixPigments([
      { pigment: midYellow, amount: 40 },
      { pigment: titanium, amount: 60 }
    ]);
    // 水彩加水应明显提亮；且与油画加白不必完全相同
    const wcBright = (wcMix[0] + wcMix[1] + wcMix[2]) / 3;
    const oilBright = (oilMix[0] + oilMix[1] + oilMix[2]) / 3;
    const pureY = window.mixPigments([{ pigment: midYellow, amount: 100 }]);
    const pureBright = (pureY[0] + pureY[1] + pureY[2]) / 3;

    // --- 固定目标色求解（标准24池）---
    const std24 = (window.PRESET_TABS || []).find(t => t.id === 'std24');
    const all = window.ALL_PIGMENTS || [];
    const ids = std24 ? std24.ids : [];
    const pigments = ids.map(id => all.find(p => p.id === id)).filter(Boolean);
    // 注入 activePool
    if (typeof window.setMode === 'function') window.setMode('oil');
    window.globalSession.activePool = pigments.slice();
    const whiteP = pigments.find(p => p.id === 'titanium-white') || titanium;
    if (!window.globalSession.activePool.find(p => p.id === 'titanium-white')) {
      window.globalSession.activePool.push(whiteP);
    }
    // 清禁用
    if (window.disabledPigmentIds && window.disabledPigmentIds.clear) window.disabledPigmentIds.clear();

    const targets = [
      { name: '肤色粉', rgb: [232, 180, 160] },
      { name: '天蓝', rgb: [120, 170, 220] },
      { name: '草绿', rgb: [90, 140, 70] },
      { name: '朱红偏亮', rgb: [240, 80, 50] },
      { name: '接近纯黄', rgb: [250, 230, 40] },
      { name: '中灰', rgb: [140, 140, 140] }
    ];
    const solves = targets.map(t => {
      const r = window.solveRecipe(t.rgb[0], t.rgb[1], t.rgb[2], true);
      const names = (r.recipe || []).map(x => x.pigment.name + ':' + Math.round(x.amount));
      return { name: t.name, target: t.rgb, minError: r.minError, n: (r.recipe || []).length, names, mix: r.mixRGB };
    });

    // 水彩再测一目标
    if (typeof window.setMode === 'function') window.setMode('watercolor');
    window.globalSession.activePool = pigments.filter(p => p.id !== 'titanium-white').concat([water]);
    const wcSolve = window.solveRecipe(200, 160, 140, true);

    // --- 回归：粗水比例停在次优时，精修必须压到更优（用户实测 11%→13% 水）---
    const sap = all.find(p => p.id === 'sap-green') || { id: 'sap-green', name: '树汁绿', rgb: [80, 125, 42], hex: '#507D2A' };
    const my = all.find(p => p.id === 'medium-yellow') || midYellow;
    const coarseWater = [
      { pigment: sap, amount: 62 },
      { pigment: my, amount: 27 },
      { pigment: water, amount: 11, isWater: true }
    ];
    // 用粗配方混出色当「目标」，再人为把水定在次优；精修应找回更低 optCost
    const synthTarget = window.mixPigments([
      { pigment: sap, amount: 61 },
      { pigment: my, amount: 26 },
      { pigment: water, amount: 13, isWater: true }
    ]);
    const eCoarse = window.getOptCost(synthTarget, window.mixPigments(coarseWater));
    const refined = window.refineRecipePureDeltaE(synthTarget, coarseWater.map(x => ({ ...x })), water);
    const eRefined = window.getOptCost(synthTarget, window.mixPigments(refined));
    const waterAmt = (refined.find(x => x.isWater || (x.pigment && (x.pigment.isWater || x.pigment.id === 'water'))) || {}).amount || 0;
    // 全自动求解也应接近精修（不得停在明显更差的粗水格）；minError 仍为展示用 CIEDE2000
    window.globalSession.activePool = [sap, my, water];
    if (window.disabledPigmentIds && window.disabledPigmentIds.clear) window.disabledPigmentIds.clear();
    const autoOnSynth = window.solveRecipe(synthTarget[0], synthTarget[1], synthTarget[2], true);
    const optAuto = window.getOptCost(synthTarget, autoOnSynth.mixRGB);
    const waterRefineOk = eRefined + 1e-6 < eCoarse && waterAmt >= 12 && waterAmt <= 14;
    const autoNearOptOk = optAuto <= eRefined + 0.15;

    // --- 回归：深棕同心圆——CIEDE2000 偏「暖凑近」、optCost 应偏手动纠色相 ---
    if (typeof window.setMode === 'function') window.setMode('oil');
    const sepia = all.find(p => p.id === 'sepia');
    const cobalt = all.find(p => p.id === 'cobalt-blue');
    const payne = all.find(p => p.id === 'paynes-grey');
    const ochre = all.find(p => p.id === 'yellow-ochre');
    const aliz = all.find(p => p.id === 'alizarin-crimson');
    let perceptOk = true, percept = null;
    if (sepia && cobalt && payne && ochre && aliz && typeof window.getOptCost === 'function') {
      const autoRec = [
        { pigment: sepia, amount: 73 }, { pigment: cobalt, amount: 20 },
        { pigment: payne, amount: 6 }, { pigment: ochre, amount: 1 }
      ];
      const manRec = [
        { pigment: sepia, amount: 63 }, { pigment: cobalt, amount: 30 },
        { pigment: payne, amount: 5 }, { pigment: aliz, amount: 2 }, { pigment: ochre, amount: 1 }
      ];
      const autoMix = window.mixPigments(autoRec);
      const manMix = window.mixPigments(manRec);
      const T = [89, 61, 41];
      const deA = window.getDeltaE(T, autoMix), deM = window.getDeltaE(T, manMix);
      const oA = window.getOptCost(T, autoMix), oM = window.getOptCost(T, manMix);
      percept = { T, deA, deM, oA, oM, autoMix, manMix };
      perceptOk = deA < deM && oM < oA;
    }

    // --- 硬回归：橄榄阴影手动方（含树汁绿）——自动不得在 opt/ΔE 上输给该手动方；且可还原混色 ---
    if (typeof window.setMode === 'function') window.setMode('watercolor');
    const umber = all.find(p => p.id === 'raw-umber');
    const prussian = all.find(p => p.id === 'prussian-blue');
    const sapG = all.find(p => p.id === 'sap-green');
    const deepR = all.find(p => p.id === 'alizarin-crimson');
    let neverLoseOk = true, reconstructOk = true, olive = null;
    if (umber && prussian && sapG && deepR) {
      const waterP = { id: 'water', name: '水', rgb: [255, 255, 255], hex: '#FFFFFF', isWater: true };
      const manualOlive = [
        { pigment: umber, amount: 57 }, { pigment: prussian, amount: 29 }, { pigment: sapG, amount: 6 },
        { pigment: deepR, amount: 5 }, { pigment: waterP, amount: 3, isWater: true }
      ];
      const weakAuto = [
        { pigment: umber, amount: 60 }, { pigment: prussian, amount: 30 }, { pigment: deepR, amount: 5 },
        { pigment: waterP, amount: 4, isWater: true }
      ];
      const manMix = window.mixPigments(manualOlive);
      const weakMix = window.mixPigments(weakAuto);
      const boxIds = ['lemon-yellow','cadmium-yellow','vermilion','scarlet','crimson','alizarin-crimson','rose-madder','violet','ultramarine','cobalt-blue','phthalo-blue','prussian-blue','viridian','emerald-green','sap-green','permanent-light-green','burnt-umber','burnt-sienna','raw-umber','paynes-grey'];
      window.globalSession.activePool = boxIds.map(id => all.find(p => p.id === id)).filter(Boolean).concat([waterP]);
      if (window.disabledPigmentIds && window.disabledPigmentIds.clear) window.disabledPigmentIds.clear();
      // 还原：目标=手动混色，自动必须几乎贴零
      const rec = window.solveRecipe(manMix[0], manMix[1], manMix[2], true);
      const recScore = window.recipeScore(manMix, rec.recipe || []);
      reconstructOk = recScore.deltaE <= 0.25 && recScore.optCost <= 0.25;
      // 截图量级目标：自动必须双尺都不输手动，且优于「无树汁绿」弱自动
      let Tshot = null, bestS = 1e9;
      for (let r = 30; r <= 100; r++) for (let g = 30; g <= 100; g++) for (let b = 10; b <= 70; b++) {
        const T = [r, g, b];
        const s = Math.abs(window.getDeltaE(T, manMix) - 4.04) + Math.abs(window.getDeltaE(T, weakMix) - 5.32);
        if (s < bestS) { bestS = s; Tshot = T; }
      }
      const M = window.recipeScore(Tshot, manualOlive);
      const W = window.recipeScore(Tshot, weakAuto);
      const S = window.solveRecipe(Tshot[0], Tshot[1], Tshot[2], true);
      const As = window.recipeScore(Tshot, S.recipe || []);
      neverLoseOk = As.deltaE <= M.deltaE + 0.1 && As.optCost <= M.optCost + 0.1 && As.deltaE < W.deltaE - 0.2;
      olive = {
        Tshot, reconstruct: { de: recScore.deltaE, opt: recScore.optCost, names: (rec.recipe || []).map(x => x.pigment.name + ':' + Math.round(x.amount)) },
        manual: { de: M.deltaE, opt: M.optCost }, weak: { de: W.deltaE, opt: W.optCost },
        solved: { de: As.deltaE, opt: As.optCost, names: (S.recipe || []).map(x => x.pigment.name + ':' + Math.round(x.amount)) }
      };
    }

    if (typeof window.setMode === 'function') window.setMode(prevMode || 'watercolor');

    return {
      roundtripsOk: roundtrips.every(x => x.ok),
      roundtrips,
      redCmykOk,
      grayOk,
      redCmyk,
      grayCmyk,
      wcBright,
      oilBright,
      pureBright,
      wcLighterThanPure: wcBright > pureBright + 5,
      oilLighterThanPure: oilBright > pureBright + 5,
      wcMix,
      oilMix,
      solves,
      maxSolveE: Math.max(...solves.map(s => s.minError)),
      meanSolveE: solves.reduce((a, s) => a + s.minError, 0) / solves.length,
      wcSolveE: wcSolve.minError,
      wcSolveN: (wcSolve.recipe || []).length,
      waterRefine: { eCoarse, eRefined, waterAmt, optAuto, refinedNames: (refined || []).map(x => x.pigment.name + ':' + Math.round(x.amount)), autoNames: (autoOnSynth.recipe || []).map(x => x.pigment.name + ':' + Math.round(x.amount)) },
      waterRefineOk,
      autoNearOptOk,
      percept,
      perceptOk,
      olive,
      reconstructOk,
      neverLoseOk
    };
  });

  const out = {
    report,
    ok:
      report.roundtripsOk &&
      report.redCmykOk &&
      report.grayOk &&
      report.wcLighterThanPure &&
      report.oilLighterThanPure &&
      report.meanSolveE < 3.5 &&
      report.maxSolveE < 8 &&
      report.waterRefineOk &&
      report.autoNearOptOk &&
      report.perceptOk &&
      report.reconstructOk &&
      report.neverLoseOk
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
