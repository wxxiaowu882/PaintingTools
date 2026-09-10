/**
 * Probe: flat muscle wrinkle atlas differs between seeds?
 */
const { chromium } = require("playwright");

const BASE = process.env.BASE_URL || "http://127.0.0.1:8765";

(async () => {
  const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle"] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 960 } });
  await page.goto(`${BASE}/?_=${Date.now()}`, { waitUntil: "commit", timeout: 180000 });
  await page.waitForFunction(() => window.__boneMorph?.getState?.()?.islandScanDone === true, {
    timeout: 180000,
  });

  const token = await page.evaluate(() => {
    for (const g of window.__boneMorph.getState().colorIslandGroups || []) {
      if (!/deform|变形/i.test(`${g.meshKey} ${g.meshRawName}`)) continue;
      for (const isl of g.islands || []) {
        if (isl.regionId === "gi_18") return isl.token;
      }
    }
    return null;
  });

  async function sample(seed) {
    await page.evaluate(
      ({ token, s }) => {
        window.__boneMorph.clearIslandTextureSynth?.();
        window.__boneMorph.setIslandChecked([token]);
        window.__boneMorph.setIslandTextureSynthParams({ seed: s, similarity: 0.5, blockScale: 24 });
      },
      { token, s: seed }
    );
    await page.evaluate(() => window.__boneMorph.runIslandTextureSynth());
    await page.waitForFunction(() => !window.__boneMorph.getState().islandTextureSynthBusy, {
      timeout: 120000,
    });
    return page.evaluate((token) => {
      const parsed = token.split("::");
      let mesh = null;
      window.__boneMorph.getRoot().traverse((o) => {
        if (o.isMesh && o.name === parsed[0]) mesh = o;
      });
      const atlas = mesh?.userData?.bmAtlas;
      const mask =
        atlas?.masks?.[parsed[1]] ||
        mesh?.userData?.bmIslands?.find((x) => x.regionId === parsed[1])?.mask;
      let diff = 0;
      let samples = [];
      const o = atlas?.orig?.data;
      const l = atlas?.live?.data;
      if (mask && o && l) {
        for (let p = 0; p < mask.length; p += 17) {
          if (!mask[p]) continue;
          const di = p * 4;
          if (o[di] !== l[di] || o[di + 1] !== l[di + 1] || o[di + 2] !== l[di + 2]) diff++;
          if (samples.length < 6) samples.push([l[di], l[di + 1], l[di + 2]]);
        }
      }
      return {
        buildId: window.__boneMorph.getBuildId?.(),
        diff,
        samples,
        flat: mesh?.userData?.bmAtlas && window.__boneMorph.getState().islandTextureSynth,
      };
    }, token);
  }

  const a = await sample(17);
  const b = await sample(99173);

  let pixelDiff = 0;
  const cmp = await page.evaluate(
    ({ token, seedA, seedB }) => {
      // re-run both and compare live buffers - done via two-step below
      return { ok: true };
    },
    { token, seedA: 17, seedB: 99173 }
  );

  // Compare A and B by sampling again with stored approach
  await page.evaluate(
    ({ token, s }) => {
      window.__boneMorph.clearIslandTextureSynth?.();
      window.__boneMorph.setIslandChecked([token]);
      window.__boneMorph.setIslandTextureSynthParams({ seed: s, similarity: 0.5, blockScale: 24 });
    },
    { token, s: 17 }
  );
  await page.evaluate(() => window.__boneMorph.runIslandTextureSynth());
  await page.waitForFunction(() => !window.__boneMorph.getState().islandTextureSynthBusy);
  const bufA = await page.evaluate((token) => {
    const parsed = token.split("::");
    let mesh = null;
    window.__boneMorph.getRoot().traverse((o) => {
      if (o.isMesh && o.name === parsed[0]) mesh = o;
    });
    const atlas = mesh?.userData?.bmAtlas;
    const mask = atlas?.masks?.[parsed[1]];
    const l = atlas?.live?.data;
    const out = [];
    if (mask && l) {
      for (let p = 0; p < mask.length; p++) {
        if (!mask[p]) continue;
        const di = p * 4;
        out.push(l[di], l[di + 1], l[di + 2]);
      }
    }
    return out;
  }, token);

  await page.evaluate(
    ({ token, s }) => {
      window.__boneMorph.clearIslandTextureSynth?.();
      window.__boneMorph.setIslandChecked([token]);
      window.__boneMorph.setIslandTextureSynthParams({ seed: s, similarity: 0.5, blockScale: 24 });
    },
    { token, s: 99173 }
  );
  await page.evaluate(() => window.__boneMorph.runIslandTextureSynth());
  await page.waitForFunction(() => !window.__boneMorph.getState().islandTextureSynthBusy);
  const bufB = await page.evaluate((token) => {
    const parsed = token.split("::");
    let mesh = null;
    window.__boneMorph.getRoot().traverse((o) => {
      if (o.isMesh && o.name === parsed[0]) mesh = o;
    });
    const atlas = mesh?.userData?.bmAtlas;
    const mask = atlas?.masks?.[parsed[1]];
    const l = atlas?.live?.data;
    const out = [];
    if (mask && l) {
      for (let p = 0; p < mask.length; p++) {
        if (!mask[p]) continue;
        const di = p * 4;
        out.push(l[di], l[di + 1], l[di + 2]);
      }
    }
    return out;
  }, token);

  for (let i = 0; i < Math.min(bufA.length, bufB.length); i += 3) {
    if (bufA[i] !== bufB[i] || bufA[i + 1] !== bufB[i + 1] || bufA[i + 2] !== bufB[i + 2]) pixelDiff++;
  }

  console.log(
    JSON.stringify(
      {
        buildId: a.buildId,
        seed17: a,
        seed99173: b,
        atlasPixelDiffBetweenSeeds: pixelDiff,
        totalMaskPixels: bufA.length / 3,
        pct: ((100 * pixelDiff) / (bufA.length / 3)).toFixed(2),
      },
      null,
      2
    )
  );
  await browser.close();
})();
