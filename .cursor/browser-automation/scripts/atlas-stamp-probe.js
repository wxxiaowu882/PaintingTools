const { chromium } = require("playwright");

(async () => {
  const page = await (await chromium.launch({ headless: true })).newPage({ viewport: { width: 1600, height: 960 } });
  await page.goto(`http://127.0.0.1:8765/?_=${Date.now()}`, { waitUntil: "commit", timeout: 180000 });
  await page.waitForFunction(() => window.__boneMorph?.getState?.()?.islandScanDone === true, { timeout: 180000 });

  const token = await page.evaluate(() => {
    for (const g of window.__boneMorph.getState().colorIslandGroups || []) {
      for (const isl of g.islands || []) if (isl.regionId === "gi_18") return isl.token;
    }
    return null;
  });

  async function run(sim, blk) {
    await page.evaluate(
      async ({ token, sim, blk }) => {
        window.__boneMorph.clearIslandTextureSynth();
        window.__boneMorph.setIslandChecked([token]);
        window.__boneMorph.setIslandTextureSynthParams({ seed: 6, similarity: sim / 100, blockScale: blk });
        await window.__boneMorph.runIslandTextureSynth();
      },
      { token, sim, blk }
    );
    await page.waitForFunction(() => !window.__boneMorph.getState().islandTextureSynthBusy, { timeout: 120000 });
    return page.evaluate((token) => {
      const [meshName, regionId] = token.split("::");
      let mesh = null;
      window.__boneMorph.getRoot().traverse((o) => {
        if (o.isMesh && o.name === meshName) mesh = o;
      });
      const atlas = mesh?.userData?.bmAtlas;
      const na = mesh?.userData?.bmNormalAtlas;
      const mask = atlas?.masks?.[regionId];
      let samples = [];
      let ai = 0;
      let ni = 0;
      for (let p = 0; p < (mask?.length || 0); p++) {
        if (!mask[p]) continue;
        const di = p * 4;
        const oa = atlas.orig.data;
        const la = atlas.live.data;
        const on = na?.orig?.data;
        const ln = na?.live?.data;
        if (la[di] !== oa[di] || la[di + 1] !== oa[di + 1] || la[di + 2] !== oa[di + 2]) ai++;
        if (ln && (ln[di] !== on[di] || ln[di + 1] !== on[di + 1] || ln[di + 2] !== on[di + 2])) ni++;
        if (samples.length < 5) samples.push([la[di], la[di + 1], la[di + 2], ln?.[di], ln?.[di + 1], ln?.[di + 2]]);
      }
      const mat = mesh?.material?.map ? mesh.material : mesh?.material?.[0];
      const ns = mat?.normalScale ? [mat.normalScale.x, mat.normalScale.y] : null;
      return { build: window.__boneMorph.getBuildId(), ai, ni, samples, normalScale: ns };
    }, token);
  }

  const a = await run(70, 24);
  const b = await run(42, 10);
  console.log("A", a);
  console.log("B", b);

  // stamp pure colors test
  await page.evaluate((token) => {
    const [meshName, regionId] = token.split("::");
    let mesh = null;
    window.__boneMorph.getRoot().traverse((o) => {
      if (o.isMesh && o.name === meshName) mesh = o;
    });
    const atlas = mesh.userData.bmAtlas;
    const mask = atlas.masks[regionId];
    const d = atlas.live.data;
    for (let p = 0; p < mask.length; p++) {
      if (!mask[p]) continue;
      const di = p * 4;
      d[di] = 255;
      d[di + 1] = 0;
      d[di + 2] = 0;
    }
    atlas.ctx.putImageData(atlas.live, 0, 0);
    atlas.tex.needsUpdate = true;
  }, token);

  await page.click('[data-morph-tab="color"]');
  const canvas = page.locator("#viewerHostMorph canvas, #viewerHost canvas").first();
  const box = await canvas.boundingBox();
  await page.screenshot({ path: ".cursor/browser-automation/runs/atlas-probe-red.png", clip: box });
  console.log("red stamp screenshot saved");
  await page.browser().close();
})();
