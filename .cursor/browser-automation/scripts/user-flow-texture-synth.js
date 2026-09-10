/**
 * 模拟用户：勾选颞肌，换一版 + 拖相似度/块尺度，侧视截图对比
 */
const { chromium } = require("playwright");
const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

function diffPair(aPath, bPath) {
  const py = `
from PIL import Image
import json
a=Image.open(r'''${aPath.replace(/\\/g, "/")}''').convert('RGB')
b=Image.open(r'''${bPath.replace(/\\/g, "/")}''').convert('RGB')
w,h=a.size
sumd=0; n=0
for y in range(h):
  for x in range(w):
    pa=a.getpixel((x,y)); pb=b.getpixel((x,y))
    sumd += abs(pa[0]-pb[0])+abs(pa[1]-pb[1])+abs(pa[2]-pb[2])
    n += 1
print(json.dumps({'avgPct': round(100*sumd/(n*3*255), 2)}))
`;
  const r = spawnSync("python", ["-c", py], { encoding: "utf8" });
  return JSON.parse((r.stdout || "{}").trim() || "{}");
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle"] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 960 } });
  await page.goto(`http://127.0.0.1:8765/?_=${Date.now()}`, { waitUntil: "commit", timeout: 180000 });
  await page.waitForFunction(() => window.__boneMorph?.getState?.()?.islandScanDone === true, { timeout: 180000 });
  await page.click('[data-morph-tab="color"]');
  await page.waitForTimeout(300);

  const island19 = await page.evaluate(() => {
    for (const g of window.__boneMorph.getState().colorIslandGroups || []) {
      if (!/deform|变形/i.test(`${g.meshKey} ${g.meshRawName}`)) continue;
      for (const isl of g.islands || []) {
        if (/孤岛\s*19|gi_18/.test(isl.label || "") || isl.regionId === "gi_18") {
          return { token: isl.token, label: isl.label, regionId: isl.regionId };
        }
      }
    }
    return null;
  });
  if (!island19) throw new Error("temporalis island not found");
  console.log("island", island19);

  await page.evaluate((token) => {
    window.__boneMorph.setIslandChecked([token]);
    window.__boneMorph.setIslandFocus?.(token);
  }, island19.token);

  const canvas = page.locator("#viewerHostMorph canvas, #viewerHost canvas").first();
  const outDir = path.join(__dirname, "..", "runs", "user-flow-test-04i");
  fs.mkdirSync(outDir, { recursive: true });

  async function rotateSide() {
    const box = await canvas.boundingBox();
    await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.42);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.42, { steps: 16 });
    await page.mouse.up();
    await page.waitForTimeout(500);
  }

  async function shot(name) {
    await rotateSide();
    const box = await canvas.boundingBox();
    const p = path.join(outDir, name);
    await page.screenshot({ path: p, clip: box });
    return p;
  }

  async function waitSynth() {
    await page.waitForFunction(() => !window.__boneMorph.getState().islandTextureSynthBusy, { timeout: 120000 });
    await page.waitForTimeout(500);
  }

  async function setSlider(id, value) {
    await page.locator(`#${id}`).evaluate((el, v) => {
      el.value = String(v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, value);
    await waitSynth();
  }

  const build = await page.evaluate(() => window.__boneMorph.getBuildId());
  console.log("build", build);

  const p0 = await shot("00_checked_no_synth.png");

  await page.click("#islandTextureReroll");
  await waitSynth();
  const p1 = await shot("01_after_reroll.png");

  await setSlider("islandTextureSimilarity", 45);
  const p2 = await shot("02_sim45.png");

  await setSlider("islandTextureSimilarity", 95);
  const p3 = await shot("03_sim95.png");

  await setSlider("islandTextureBlockScale", 10);
  const p4 = await shot("04_block10.png");

  await setSlider("islandTextureBlockScale", 44);
  const p5 = await shot("05_block44.png");

  const diffs = {
    reroll: diffPair(p0, p1).avgPct,
    sim45vs95: diffPair(p2, p3).avgPct,
    block10vs44: diffPair(p4, p5).avgPct,
    baselineVsBlock44: diffPair(p0, p5).avgPct,
  };
  console.log("visual diff %", diffs);

  await browser.close();
  console.log("saved", outDir);
})();
