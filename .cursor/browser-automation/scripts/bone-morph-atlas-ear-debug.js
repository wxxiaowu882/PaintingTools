const { chromium } = require("playwright");
const BASE = process.env.BASE_URL || "http://127.0.0.1:8765";

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
    const pick = bm.debugFloodPickAtNdc(0.64, 0.48)?.best;
    if (!pick) return { err: "no pick" };
    const meshInfo = bm.debugAtlasForMesh?.(pick.key);
    const st = bm.getState();
    return { pick, meshInfo, st };
  });
  console.log(JSON.stringify(info, null, 2));

  const atlasAnalysis = await page.evaluate(() => {
    const bm = window.__boneMorph;
    const pick = bm.debugFloodPickAtNdc(0.64, 0.48)?.best;
    if (!pick) return null;
    const root = bm.getRoot();
    let mesh = null;
    root.traverse((o) => {
      if (o.isMesh && (o.name === pick.mesh || o.uuid)) mesh = o;
    });
    // find static mesh
    root.traverse((o) => {
      if (o.isMesh && /static/i.test(o.name)) mesh = o;
    });
    const atlas = mesh?.userData?.bmAtlas;
    if (!atlas) return { err: "no atlas" };
    const w = atlas.w;
    const h = atlas.h;
    const o = atlas.orig.data;
    const sx = Math.round(pick.seedU * w);
    const sy = Math.round((atlas.tex?.flipY ? 1 - pick.seedV : pick.seedV) * h);
    const maxR = 200;
    let cartilage = 0;
    let inMask = 0;
    const colors = {};
    const mask = atlas.masks?.[pick.regionId];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dx = x - sx;
        const dy = y - sy;
        if (dx * dx + dy * dy > maxR * maxR) continue;
        const p = y * w + x;
        const i = p * 4;
        const r = o[i];
        const g = o[i + 1];
        const b = o[i + 2];
        const mx = Math.max(r, g, b);
        const mn = Math.min(r, g, b);
        if (mx - mn > 60 || mx < 80) continue;
        if (r + g + b < 300) continue;
        const key = `${r},${g},${b}`;
        colors[key] = (colors[key] || 0) + 1;
        cartilage++;
        if (mask && mask[p]) inMask++;
      }
    }
    const topColors = Object.entries(colors)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([k, n]) => ({ k, n }));
    return {
      mesh: mesh.name,
      seed: [sx, sy],
      cartilageNear: cartilage,
      inMask,
      maskPx: pick.px,
      topColors,
    };
  });
  console.log("atlas", JSON.stringify(atlasAnalysis, null, 2));
  await browser.close();
})();
