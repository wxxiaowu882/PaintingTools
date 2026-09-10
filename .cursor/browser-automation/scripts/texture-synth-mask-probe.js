const { chromium } = require("playwright");
const BASE = process.env.BASE_URL || "http://127.0.0.1:8765";

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
    window.__boneMorph.setIslandChecked([token]);
  }, island);
  await page.waitForFunction(() => !window.__boneMorph.getState().islandTextureSynthBusy, {
    timeout: 120000,
  });
  await page.waitForFunction(() => window.__setMorphSideView?.() === true);
  const out = await page.evaluate(() => {
    const groups = window.__boneMorph.getState().colorIslandGroups || [];
    const deform = groups.find((g) => /deform/i.test(`${g.meshKey} ${g.meshRawName}`));
    const gi18 = deform?.islands?.find((i) => i.regionId === "gi_18");
    const probes = [
      [0.34, 0.38],
      [0.36, 0.42],
      [0.30, 0.30],
      [0.38, 0.45],
    ];
    const canvas = document.querySelector("#viewerHostMorph canvas, #viewerHost canvas");
    const rect = canvas.getBoundingClientRect();
    const hits = probes.map(([nx, ny]) => {
      const x = rect.left + nx * rect.width;
      const y = rect.top + ny * rect.height;
      return window.__boneMorph.debugPickAtlasAtClient(x, y);
    });
    return window.__boneMorph.debugFindIslandOwnersForPixels?.(hits.map((h) => h?.px).filter(Boolean)) || {
      gi18,
      hits,
    };
  });
  await browser.close();
  console.log(JSON.stringify(out, null, 2));
})();
