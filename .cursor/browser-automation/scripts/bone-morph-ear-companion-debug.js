const { chromium } = require("playwright");
const BASE = "http://127.0.0.1:8765";

(async () => {
  const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle"] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 960 } });
  await page.goto(`${BASE}/?_=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(
    () => !!window.__boneMorph && (document.getElementById("viewerStatus")?.textContent || "").includes("拧形"),
    { timeout: 180000 }
  );
  await page.waitForTimeout(800);
  const canvas = page.locator("#viewerHost canvas");
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.22, box.y + box.height * 0.4, { steps: 14 });
  await page.mouse.up();
  await page.waitForTimeout(400);

  const info = await page.evaluate(() => {
    const bm = window.__boneMorph;
    const rows = [];
    for (const pt of [
      { nx: 0.64, ny: 0.48 },
      { nx: 0.65, ny: 0.48 },
      { nx: 0.67, ny: 0.42 },
    ]) {
      const hits = bm.debugPickAtNdc(pt.nx, pt.ny);
      const best = bm.debugFloodPickAtNdc(pt.nx, pt.ny)?.best;
      rows.push({
        pt,
        best,
        hits: hits?.map((h) => ({
          mesh: h.mesh,
          dist: Number(h.dist.toFixed(4)),
          rgb: h.origRgb?.slice(0, 3),
        })),
      });
    }
    return rows;
  });
  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})();
