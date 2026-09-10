const { chromium } = require("playwright");

const BASE = process.env.BASE_URL || "http://127.0.0.1:8765";
const SEED = 6;

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

  async function synth(sim, block) {
    return page.evaluate(
      async ({ token, seed, sim, block }) => {
        window.__boneMorph.setIslandTextureSynthParams({
          seed,
          similarity: sim / 100,
          blockScale: block,
        });
        const res = await window.__boneMorph.runIslandTextureSynth();
        const st = window.__boneMorph.getState();
        return {
          res,
          params: st.islandTextureSynthParams,
          synthCount: st.islandTextureSynthCount,
          checkedSynthCount: st.islandTextureSynthCheckedCount,
          lastError: st.islandTextureSynthLastError,
        };
      },
      { token: island, seed: SEED, sim, block }
    );
  }

  async function readAtlasSamples(token) {
    return page.evaluate((token) => {
      const deform = document.querySelector("canvas");
      if (!deform) return { err: "no canvas" };
      const bm = window.__boneMorph;
      const st = bm.getState();
      const groups = st.colorIslandGroups || [];
      let islInfo = null;
      for (const g of groups) {
        for (const isl of g.islands || []) {
          if (isl.token === token) islInfo = isl;
        }
      }
      return {
        synthCount: st.islandTextureSynthCount,
        checkedSynthCount: st.islandTextureSynthCheckedCount,
        previewHex: islInfo?.previewHex,
        build: st.buildId,
      };
    }, token);
  }

  const a = await synth(72, 36);
  const snapA = await page.evaluate((token) => {
    const meshes = window.__boneMorph.getState().meshes || [];
    for (const m of meshes) {
      const atlas = m.userData?.bmAtlas;
      if (!atlas?.live?.data) continue;
      const entry = window.__boneMorph.getState().islandTextureSynth?.[token];
      if (!entry?.bbox) continue;
      const { x, y, w, h } = entry.bbox;
      const d = atlas.live.data;
      const samples = [];
      for (let i = 0; i < 20; i++) {
        const col = (i * 17) % w;
        const row = (i * 13) % h;
        const p = (y + row) * atlas.w + (x + col);
        const di = p * 4;
        samples.push([d[di], d[di + 1], d[di + 2]]);
      }
      return { samples, w: atlas.w, h: atlas.h };
    }
    return null;
  }, island);

  const b = await synth(42, 10);
  const snapB = await page.evaluate((token) => {
    const meshes = window.__boneMorph.getState().meshes || [];
    for (const m of meshes) {
      const atlas = m.userData?.bmAtlas;
      if (!atlas?.live?.data) continue;
      const entry = window.__boneMorph.getState().islandTextureSynth?.[token];
      if (!entry?.bbox) continue;
      const { x, y, w, h } = entry.bbox;
      const d = atlas.live.data;
      const samples = [];
      for (let i = 0; i < 20; i++) {
        const col = (i * 17) % w;
        const row = (i * 13) % h;
        const p = (y + row) * atlas.w + (x + col);
        const di = p * 4;
        samples.push([d[di], d[di + 1], d[di + 2]]);
      }
      return { samples };
    }
    return null;
  }, island);

  let liveDiff = 0;
  if (snapA?.samples && snapB?.samples) {
    for (let i = 0; i < snapA.samples.length; i++) {
      const pa = snapA.samples[i];
      const pb = snapB.samples[i];
      if (pa[0] !== pb[0] || pa[1] !== pb[1] || pa[2] !== pb[2]) liveDiff++;
    }
  }

  let cachePixelDiff = 0;
  if (a.entry?.sample && b.entry?.sample) {
    for (let i = 0; i < Math.min(a.entry.sample.length, b.entry.sample.length); i++) {
      if (a.entry.sample[i] !== b.entry.sample[i]) cachePixelDiff++;
    }
  }

  const fullDiff = await page.evaluate(
    ({ token, simA, blockA, simB, blockB }) => {
      const st = window.__boneMorph.getState();
      const entry = st.islandTextureSynth?.[token];
      if (!entry?.pixels?.length || !entry?.bbox) return null;
      const meshes = st.meshes || [];
      let mesh = null;
      for (const m of meshes) {
        if (m.userData?.bmAtlas) {
          mesh = m;
          break;
        }
      }
      if (!mesh) return null;
      const atlas = mesh.userData.bmAtlas;
      const { x, y, w, h } = entry.bbox;
      const d = atlas.live?.data || atlas.orig?.data;
      let diff = 0;
      let n = 0;
      for (let row = 0; row < h; row += 2) {
        for (let col = 0; col < w; col += 2) {
          const p = (y + row) * atlas.w + (x + col);
          const di = p * 4;
          n++;
          const li = (row * w + col) * 4;
          const dr =
            Math.abs(d[di] - entry.pixels[li]) +
            Math.abs(d[di + 1] - entry.pixels[li + 1]) +
            Math.abs(d[di + 2] - entry.pixels[li + 2]);
          if (dr > 8) diff++;
        }
      }
      return { liveMatchesCachePct: Math.round((100 * (n - diff)) / n), n };
    },
    { token: island, simA: 72, blockA: 36, simB: 42, blockB: 10 }
  );

  const pixelHash = await page.evaluate((token) => {
    const entry = window.__boneMorph.getState().islandTextureSynth?.[token];
    if (!entry?.pixels) return null;
    let h = 0;
    for (let i = 0; i < entry.pixels.length; i += 97) h = (h * 31 + entry.pixels[i]) >>> 0;
    return h;
  }, island);

  await browser.close();
  console.log(
    JSON.stringify(
      {
        island,
        a,
        b,
        liveSampleDiff: liveDiff,
        cacheSampleDiff: cachePixelDiff,
        fullDiff,
        pixelHash,
        snapA,
        snapB,
      },
      null,
      2
    )
  );
})();
