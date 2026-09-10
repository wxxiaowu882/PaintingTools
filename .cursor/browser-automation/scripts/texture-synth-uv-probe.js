const { chromium } = require("playwright");
const BASE = process.env.BASE_URL || "http://127.0.0.1:8765";
const SEED = 6;
const PROBES = [
  [0.34, 0.38],
  [0.36, 0.42],
  [0.32, 0.35],
];

(async () => {
  const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle"] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 960 } });
  await page.goto(`${BASE}/?_=${Date.now()}`, { waitUntil: "commit", timeout: 180000 });
  await page.waitForFunction(() => window.__boneMorph?.getState?.()?.islandScanDone === true, {
    timeout: 180000,
  });
  await page.click('[data-morph-tab="color"]');
  const island = await page.evaluate(() => {
    for (const g of window.__boneMorph.getState().colorIslandGroups || []) {
      for (const isl of g.islands || []) {
        if (isl.regionId === "gi_18") return isl.token;
      }
    }
    return null;
  });
  await page.evaluate((token) => {
    window.__boneMorph.clearIslandTextureSynth();
    window.__boneMorph.setIslandChecked([token]);
  }, island);
  await page.waitForFunction(() => !window.__boneMorph.getState().islandTextureSynthBusy, {
    timeout: 120000,
  });
  await page.waitForFunction(() => window.__setMorphSideView?.() === true);
  await page.evaluate(() => {
    document.getElementById("islandPreviewDock").hidden = true;
  });

  async function sample(sim, block) {
    return page.evaluate(
      async ({ token, seed, sim, block, probes }) => {
        window.__boneMorph.setIslandTextureSynthParams({
          seed,
          similarity: sim / 100,
          blockScale: block,
        });
        await window.__boneMorph.runIslandTextureSynth();
        const hash = window.__boneMorph.debugTextureSynthAtlasHash(token);
        const canvas = document.querySelector("#viewerHostMorph canvas, #viewerHost canvas");
        const rect = canvas.getBoundingClientRect();
        const out = { hash, hits: [] };
        for (const [nx, ny] of probes) {
          const x = rect.left + nx * rect.width;
          const y = rect.top + ny * rect.height;
          const el = document.elementFromPoint(x, y);
          out.hits.push({
            nx,
            ny,
            el: el?.tagName,
            sample: window.__boneMorph.debugPickAtlasAtClient?.(x, y) || null,
          });
        }
        return out;
      },
      { token: island, seed: SEED, sim, block, probes: PROBES }
    );
  }

  const a = await sample(72, 36);
  const b = await sample(42, 10);
  await browser.close();
  console.log(JSON.stringify({ a, b }, null, 2));
})();
