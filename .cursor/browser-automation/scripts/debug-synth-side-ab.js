const { chromium } = require("playwright");
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

(async () => {
  const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle"] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 960 } });
  await page.goto(`http://127.0.0.1:8765/?_=${Date.now()}`, { waitUntil: "commit", timeout: 180000 });
  await page.waitForFunction(() => window.__boneMorph?.getState?.()?.islandScanDone === true, {
    timeout: 180000,
  });
  await page.click('[data-morph-tab="color"]');
  const canvas = page.locator("#viewerHostMorph canvas, #viewerHost canvas").first();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.42);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.42, { steps: 16 });
  await page.mouse.up();
  await page.waitForTimeout(500);

  const outDir = path.join(__dirname, "..", "runs", "debug-synth-side");
  fs.mkdirSync(outDir, { recursive: true });

  async function synthShot(seed, outPath) {
    const token = await page.evaluate(() => {
      for (const g of window.__boneMorph.getState().colorIslandGroups || []) {
        if (!/deform|变形/i.test(`${g.meshKey} ${g.meshRawName}`)) continue;
        for (const isl of g.islands || []) if (isl.regionId === "gi_18") return isl.token;
      }
      return null;
    });
    await page.evaluate(
      async ({ token, seed }) => {
        window.__boneMorph.clearIslandTextureSynth?.();
        window.__boneMorph.setIslandChecked([token]);
        window.__boneMorph.setIslandTextureSynthParams({ seed, similarity: 0.5, blockScale: 24 });
        await window.__boneMorph.runIslandTextureSynth();
      },
      { token, seed }
    );
    await page.waitForTimeout(400);
    const b = await canvas.boundingBox();
    await page.screenshot({ path: outPath, clip: b });
  }

  const a = path.join(outDir, "a.png");
  const b = path.join(outDir, "b.png");
  await synthShot(17, a);
  await synthShot(99173, b);

  const py = `
from PIL import Image
import json
a=Image.open(r'''${a.replace(/\\/g, "/")}''').convert('RGB')
b=Image.open(r'''${b.replace(/\\/g, "/")}''').convert('RGB')
w,h=a.size;c=0;s=0;n=0;md=0
for y in range(h):
  for x in range(w):
    pa=a.getpixel((x,y)); pb=b.getpixel((x,y))
    if sum(pa)>720 or sum(pb)>720: continue
    n+=1;d=abs(pa[0]-pb[0])+abs(pa[1]-pb[1])+abs(pa[2]-pb[2]); s+=d
    if d>=12:c+=1
    if d>md:md=d
print(json.dumps({'build': '${await page.evaluate(() => window.__boneMorph.getBuildId())}', 'changedPct':round(100*c/max(1,n),2),'avg':round(s/max(1,n),2),'maxd':md}))
`;
  const r = spawnSync("python", ["-c", py], { encoding: "utf8" });
  console.log(r.stdout || r.stderr);
  await browser.close();
})();
