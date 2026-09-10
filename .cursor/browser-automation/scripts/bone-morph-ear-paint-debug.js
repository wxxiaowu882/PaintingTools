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

  const nx = 0.64;
  const ny = 0.48;
  await page.keyboard.down("Alt");
  await page.mouse.click(box.x + box.width * nx, box.y + box.height * ny);
  await page.keyboard.up("Alt");
  await page.waitForTimeout(400);

  const before = await page.evaluate(() => {
    const st = window.__boneMorph.getState();
    return {
      label: st.selectedPartLabel,
      px: st.selectedRegionPixels,
      meshColors: JSON.parse(JSON.stringify(st.meshColors || {})),
    };
  });

  await page.evaluate(() => {
    const r = window.__boneMorph.setScopeHsl(24 / 360, 0.64, 0, { notify: true, immediate: true });
    return r;
  });
  await page.waitForTimeout(500);

  const after = await page.evaluate(() => {
    const st = window.__boneMorph.getState();
    const countMesh = (substr) => {
      let n = 0;
      const root = window.__boneMorph.getRoot();
      let mesh = null;
      root.traverse((o) => {
        if (o.isMesh && o.name.toLowerCase().includes(substr)) mesh = o;
      });
      const atlas = mesh?.userData?.bmAtlas;
      if (!atlas) return { n: 0 };
      const o = atlas.orig.data;
      const d = atlas.ctx.getImageData(0, 0, atlas.w, atlas.h).data;
      for (let i = 0; i < o.length; i += 4) {
        if (Math.abs(o[i] - d[i]) + Math.abs(o[i + 1] - d[i + 1]) + Math.abs(o[i + 2] - d[i + 2]) > 25) n++;
      }
      return { n, mesh: mesh.name };
    };
    return {
      label: st.selectedPartLabel,
      px: st.selectedRegionPixels,
      meshColors: st.meshColors,
      staticChanged: countMesh("static"),
      deformChanged: countMesh("deform"),
    };
  });

  console.log(JSON.stringify({ before, after }, null, 2));
  await browser.close();
})();
