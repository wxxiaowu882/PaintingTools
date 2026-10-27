/**
 * XStudio 画布左右换图 / 全量 Gallery 池 / 历史排除 / 闲置 3s / 按下闪一下
 * PORT=18080 PLAYWRIGHT_CHANNEL=msedge node scripts/qa-xstudio-img-nav.js
 */
require('./_playwright-browsers-path');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const PORT = process.env.PORT || '18080';
const BASE = process.env.BASE_URL || `http://127.0.0.1:${PORT}`;
const outDir = path.join(__dirname, '..', 'runs', 'qa-xstudio-img-nav');
const poolFile = path.join(__dirname, '..', '..', '..', 'docs', 'js', 'xstudio-gallery-pool.json');

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const diskPool = JSON.parse(fs.readFileSync(poolFile, 'utf8'));
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || 'msedge',
    headless: true
  });
  const context = await browser.newContext({ viewport: { width: 393, height: 852 } });
  const page = await context.newPage();
  page.setDefaultTimeout(90000);

  // 清 IDB，强制冷启动走全量随机池（不黏住旧历史）
  await page.goto(`${BASE}/XStudio?_qa=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      const req = indexedDB.deleteDatabase('xstudio');
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
  });
  await page.goto(`${BASE}/XStudio?_qa=${Date.now()}_fresh`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => typeof window.navGoNext === 'function' && typeof window.ensureGalleryPool === 'function', null, { timeout: 30000 });
  await page.waitForFunction(() => document.getElementById('paletteImg') && document.getElementById('paletteImg').style.display !== 'none' && document.getElementById('paletteImg').naturalWidth > 0, null, { timeout: 60000 });

  const poolInfo = await page.evaluate(async () => {
    const pool = await window.ensureGalleryPool();
    return {
      len: pool.length,
      sample: pool.slice(0, 3),
      bootPath: (window.imgNavState.entries[0] && window.imgNavState.entries[0].path) || null,
      demoOnly: pool.length <= 12
    };
  });

  const t0 = await page.evaluate(() => {
    const img = document.getElementById('paletteImg');
    const prev = document.getElementById('xstudio-img-nav-prev');
    const next = document.getElementById('xstudio-img-nav-next');
    return {
      src: img && img.src,
      prevVisible: !!(prev && prev.classList.contains('is-visible')),
      nextVisible: !!(next && next.classList.contains('is-visible')),
      entries: window.imgNavState.entries.length,
      index: window.imgNavState.index,
      idleMs: (() => {
        // 探测 pokeImgNavIdle 定时：通过 monkey 不可读闭包，改为测 immersive 实际延迟
        return null;
      })()
    };
  });

  const srcA = await page.evaluate(() => document.getElementById('paletteImg').src);
  await page.click('#xstudio-img-nav-next');
  await page.waitForTimeout(900);
  const srcB = await page.evaluate(() => document.getElementById('paletteImg').src);
  await page.click('#xstudio-img-nav-next');
  await page.waitForTimeout(900);
  const srcC = await page.evaluate(() => document.getElementById('paletteImg').src);
  await page.click('#xstudio-img-nav-prev');
  await page.waitForTimeout(900);
  const srcBack = await page.evaluate(() => document.getElementById('paletteImg').src);

  // 历史栈 gallery path 互斥：再抽 8 次随机路径，不得命中栈内已有
  const excludeCheck = await page.evaluate(async () => {
    const hist = new Set(window.imgNavState.entries.filter(e => e.kind === 'gallery').map(e => e.path));
    const hits = [];
    for (let i = 0; i < 12; i++) {
      const p = await window.pickRandomGalleryPath();
      if (hist.has(p)) hits.push(p);
    }
    return { histSize: hist.size, hist: [...hist], hits, poolLen: (await window.ensureGalleryPool()).length };
  });

  // 按下闪一下：is-pressed 瞬时加深，移除后回到半透明
  const pressFlash = await page.evaluate(async () => {
    const btn = document.getElementById('xstudio-img-nav-next');
    document.getElementById('stage').classList.remove('xstudio-nav-immersive');
    btn.classList.add('is-pressed');
    await new Promise(r => setTimeout(r, 80));
    const during = +getComputedStyle(btn).opacity;
    btn.classList.remove('is-pressed');
    await new Promise(r => setTimeout(r, 420));
    const after = +getComputedStyle(btn).opacity;
    return { during, after, deepened: during >= 0.8, restored: after <= 0.55 };
  });

  // 闲置约 3s：用真实 poke（不改短）测 immersive
  await page.evaluate(() => {
    if (typeof window.pokeImgNavIdle === 'function') window.pokeImgNavIdle();
    else {
      const stage = document.getElementById('stage');
      stage.classList.remove('xstudio-nav-immersive');
      // 触发展示：模拟点 stage
      stage.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    }
  });
  // pokeImgNavIdle 未挂 window —— 用 stage pointerdown 触发绑定里的 bump
  await page.dispatchEvent('#stage', 'pointerdown');
  await page.waitForTimeout(200);
  const at200 = await page.evaluate(() => document.getElementById('stage').classList.contains('xstudio-nav-immersive'));
  await page.waitForTimeout(2800);
  const at3s = await page.evaluate(() => document.getElementById('stage').classList.contains('xstudio-nav-immersive'));
  await page.dispatchEvent('#stage', 'pointerdown');
  await page.waitForTimeout(150);
  const afterPoke = await page.evaluate(() => !document.getElementById('stage').classList.contains('xstudio-nav-immersive'));

  // persist
  await page.click('#xstudio-img-nav-next');
  await page.waitForTimeout(1200);
  const beforeReload = await page.evaluate(() => document.getElementById('paletteImg').src);
  await page.waitForTimeout(400);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('paletteImg') && document.getElementById('paletteImg').naturalWidth > 0, null, { timeout: 60000 });
  await page.waitForTimeout(800);
  const afterReload = await page.evaluate(() => document.getElementById('paletteImg').src);

  const histPaths = await page.evaluate(() =>
    (window.imgNavState.entries || []).filter(e => e.kind === 'gallery').map(e => e.path)
  );
  const bootNotOnlyDemo = poolInfo.len >= 100 && !poolInfo.demoOnly;
  const pathNotInDemoOnly = (() => {
    // 冷启动路径应来自全池；多次 next 路径也应多样
    return histPaths.some(p => !p.includes('当粉帽遇见暖阳') && !diskPool.slice(0, 12).includes(p)) || histPaths.length >= 2;
  })();

  const report = {
    diskPoolLen: diskPool.length,
    poolInfo,
    t0,
    srcA: srcA.slice(-50),
    srcB: srcB.slice(-50),
    srcC: srcC.slice(-50),
    srcBack: srcBack.slice(-50),
    nextChanged: srcA !== srcB,
    next2Changed: srcB !== srcC,
    backRestored: srcBack === srcB,
    excludeCheck,
    pressFlash,
    idle: { at200, at3s, afterPoke },
    beforeReload: beforeReload.slice(-60),
    afterReload: afterReload.slice(-60),
    persistOk: (() => {
      try {
        const a = new URL(beforeReload); const b = new URL(afterReload);
        return a.pathname === b.pathname || beforeReload === afterReload;
      } catch (_e) { return beforeReload === afterReload; }
    })(),
    bootNotOnlyDemo,
    pathNotInDemoOnly,
    histPaths
  };

  const ok = !!(
    report.nextChanged &&
    report.next2Changed &&
    report.backRestored &&
    report.idle.at200 === false &&
    report.idle.at3s === true &&
    report.idle.afterPoke &&
    report.persistOk &&
    report.t0.prevVisible &&
    report.poolInfo.len >= 400 &&
    report.excludeCheck.hits.length === 0 &&
    report.pressFlash.deepened &&
    report.pressFlash.restored &&
    report.bootNotOnlyDemo
  );
  const out = { report, ok };
  fs.writeFileSync(path.join(outDir, 'result.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
  if (!ok) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
