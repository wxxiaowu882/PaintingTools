const { chromium } = require("playwright");
const BASE = "http://127.0.0.1:8765";

(async () => {
  const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle"] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 960 } });
  await page.goto(`${BASE}/?_=${Date.now()}`, { waitUntil: "load", timeout: 120000 });
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

  const pts = [
    { name: "ear_upper", nx: 0.72, ny: 0.35 },
    { name: "ear_lobe", nx: 0.72, ny: 0.48 },
    { name: "ear_mid", nx: 0.70, ny: 0.42 },
  ];

  await page.evaluate(() => window.__boneMorph.debugClearMeshColors());
  await page.keyboard.down("Alt");
  await page.mouse.click(box.x + box.width * 0.58, box.y + box.height * 0.46);
  await page.keyboard.up("Alt");
  await page.waitForTimeout(300);

  const before = await page.evaluate((pts) => {
    const bm = window.__boneMorph;
    return pts.map((p) => {
      const s = bm.debugSamplePickAtNdc(p.nx, p.ny);
      const d = bm.debugSamplePickAtNdc(p.nx, p.ny, "Deform");
      const st = bm.debugSamplePickAtNdc(p.nx, p.ny, "Static");
      return { ...p, any: s, deform: d, static: st };
    });
  }, pts);

  await page.evaluate(() => window.__boneMorph.setScopeHsl(-56 / 360, 0.85, 0, { notify: true, immediate: true }));
  await page.waitForTimeout(600);

  const after = await page.evaluate((pts) => {
    const bm = window.__boneMorph;
    const paint = bm.debugAtlasPaintStats();
    const probe = bm.debugEarGeometryProbe("L");
    return {
      pts: pts.map((p) => {
        const s = bm.debugSamplePickAtNdc(p.nx, p.ny);
        return { ...p, hex: s?.pick?.hex, px: s?.pick?.px, mesh: s?.mesh?.name };
      }),
      paint,
      probe,
    };
  }, pts);

  console.log(JSON.stringify({ before, after }, null, 2));
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
