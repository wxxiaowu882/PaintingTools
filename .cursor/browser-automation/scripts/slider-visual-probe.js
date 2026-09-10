/**
 * 诊断：颞肌滑块拖动前后，渲染截图 + atlas 像素是否真的变了
 */
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

(async () => {
  const outDir = path.join(__dirname, "..", "runs", "slider-probe");
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle"] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 960 } });
  await page.goto(`http://127.0.0.1:8765/?_=${Date.now()}`, { waitUntil: "commit", timeout: 180000 });
  await page.waitForFunction(() => window.__boneMorph?.getState?.()?.islandScanDone === true, { timeout: 180000 });
  await page.click('[data-morph-tab="color"]');

  const island = await page.evaluate(() => {
    for (const g of window.__boneMorph.getState().colorIslandGroups || []) {
      if (!/deform|变形/i.test(`${g.meshKey} ${g.meshRawName}`)) continue;
      for (const isl of g.islands || []) {
        if (isl.regionId === "gi_18") return { token: isl.token, hex: isl.previewHex };
      }
    }
    return null;
  });
  console.log("island", island);

  await page.evaluate((token) => {
    window.__boneMorph.clearIslandTextureSynth();
    window.__boneMorph.setIslandChecked([token]);
  }, island.token);

  async function runSynth(simPct, block) {
    await page.evaluate(
      ({ simPct, block }) => {
        window.__boneMorph.setIslandTextureSynthParams({
          seed: 6,
          similarity: simPct / 100,
          blockScale: block,
        });
        return window.__boneMorph.runIslandTextureSynth();
      },
      { simPct, block }
    );
    await page.waitForFunction(() => !window.__boneMorph.getState().islandTextureSynthBusy, { timeout: 120000 });
    await page.waitForTimeout(400);
  }

  async function rotateSide() {
    const canvas = page.locator("#viewerHostMorph canvas, #viewerHost canvas").first();
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.42);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.42, { steps: 16 });
    await page.mouse.up();
    await page.waitForTimeout(500);
  }

  async function shot(name) {
    await rotateSide();
    const canvas = page.locator("#viewerHostMorph canvas, #viewerHost canvas").first();
    const box = await canvas.boundingBox();
    await page.screenshot({ path: path.join(outDir, name), clip: box });
  }

  async function readAtlasDiff() {
    return page.evaluate((token) => {
      const [meshName, regionId] = token.split("::");
      let mesh = null;
      window.__boneMorph.getRoot().traverse((o) => {
        if (o.isMesh && o.name === meshName) mesh = o;
      });
      const atlas = mesh?.userData?.bmAtlas;
      const na = mesh?.userData?.bmNormalAtlas;
      const mask = atlas?.masks?.[regionId];
      if (!mask || !atlas) return { error: "no mask" };
      let albedo = 0;
      let normal = 0;
      const oa = atlas.orig.data;
      const la = atlas.live.data;
      const on = na?.orig?.data;
      const ln = na?.live?.data;
      for (let p = 0; p < mask.length; p++) {
        if (!mask[p]) continue;
        const di = p * 4;
        if (oa[di] !== la[di] || oa[di + 1] !== la[di + 1] || oa[di + 2] !== la[di + 2]) albedo++;
        if (on && ln && (on[di] !== ln[di] || on[di + 1] !== ln[di + 1] || on[di + 2] !== ln[di + 2])) normal++;
      }
      const entry = [...window.__boneMorph.getState().islandTextureSynthCount ? [] : []];
      return {
        build: window.__boneMorph.getBuildId(),
        albedoChanged: albedo,
        normalChanged: normal,
        synthCount: window.__boneMorph.getState().islandTextureSynthCheckedCount,
        params: window.__boneMorph.getState().islandTextureSynthParams,
        err: window.__boneMorph.getState().islandTextureSynthLastError,
      };
    }, island.token);
  }

  // 默认参数
  await runSynth(70, 24);
  const d1 = await readAtlasDiff();
  await shot("default_sim70_block24.png");
  console.log("default", d1);

  // 极端滑块
  await runSynth(42, 10);
  const d2 = await readAtlasDiff();
  await shot("extreme_sim42_block10.png");
  console.log("extreme", d2);

  // 通过 UI 滑块再测一次
  await page.evaluate(() => {
    window.__boneMorph.setIslandTextureSynthParams({ seed: 6, similarity: 0.7, blockScale: 24 });
    return window.__boneMorph.runIslandTextureSynth();
  });
  await page.waitForFunction(() => !window.__boneMorph.getState().islandTextureSynthBusy, { timeout: 120000 });
  await shot("ui_before.png");

  const sim = page.locator("#islandTextureSimilarity");
  await sim.evaluate((el) => {
    el.value = "42";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForTimeout(300);
  const block = page.locator("#islandTextureBlockScale");
  await block.evaluate((el) => {
    el.value = "10";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.waitForFunction(() => !window.__boneMorph.getState().islandTextureSynthBusy, { timeout: 120000 });
  await page.waitForTimeout(500);
  await shot("ui_after_slider.png");
  const d3 = await readAtlasDiff();
  console.log("ui after", d3);

  await browser.close();
  console.log("saved", outDir);
})();
