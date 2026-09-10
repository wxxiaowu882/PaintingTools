/**
 * Probe Static mesh ear cartilage pick coverage.
 */
const { chromium } = require("playwright");

const BASE = process.env.BASE_URL || "http://127.0.0.1:8765";

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--ignore-gpu-blocklist"],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 960 } });
  await page.goto(`${BASE}/?_=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(
    () =>
      !!window.__boneMorph &&
      (document.getElementById("viewerStatus")?.textContent || "").includes("拧形"),
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

  const report = await page.evaluate(() => {
    const bm = window.__boneMorph;
    const rows = [];
    for (let x = 0.68; x <= 0.84; x += 0.02) {
      for (let y = 0.34; y <= 0.52; y += 0.02) {
        const r = bm.debugFloodPickAtNdc(x, y);
        if (!r?.best) continue;
        const b = r.best;
        if (!/static/i.test(b.mesh)) continue;
        rows.push({
          nx: x,
          ny: y,
          px: b.px,
          hex: b.hex,
          label: b.partLabel,
          mesh: b.mesh,
          partKey: b.partKey,
        });
      }
    }
    rows.sort((a, b) => b.px - a.px);
    return rows.slice(0, 12);
  });

  console.log(JSON.stringify(report, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
