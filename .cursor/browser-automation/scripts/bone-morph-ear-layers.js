const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const BASE = process.env.BASE_URL || "http://127.0.0.1:8765";
const outDir = path.join(__dirname, "..", "runs", "ear-layer-probe");
fs.mkdirSync(outDir, { recursive: true });

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

  const hits = await page.evaluate(() => {
    const bm = window.__boneMorph;
    const rows = [];
    for (let x = 0.58; x <= 0.72; x += 0.02) {
      for (let y = 0.4; y <= 0.52; y += 0.02) {
        const h = bm.debugPickAtNdc(x, y);
        if (!h?.length) continue;
        rows.push({
          nx: x,
          ny: y,
          top: h.slice(0, 4).map((t) => ({
            mesh: t.mesh,
            dist: Number(t.dist.toFixed(3)),
            rgb: t.origRgb?.slice(0, 3),
          })),
        });
      }
    }
    return rows;
  });
  fs.writeFileSync(path.join(outDir, "hits.json"), JSON.stringify(hits, null, 2));
  console.log("wrote", path.join(outDir, "hits.json"), "rows", hits.length);
  await browser.close();
})();
