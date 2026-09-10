const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

(async () => {
  const outDir = path.join(__dirname, "..", "runs");
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  page.on("dialog", async (d) => {
    try {
      await d.accept();
    } catch {}
  });

  await page.goto("http://127.0.0.1:8765/?_=" + Date.now(), {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForFunction(
    () => [...document.getElementById("projectSelect").options].some((o) => /耳/.test(o.textContent)),
    null,
    { timeout: 60000 }
  );
  const pid = await page.evaluate(
    () => [...document.getElementById("projectSelect").options].find((o) => /耳/.test(o.textContent)).value
  );
  await page.selectOption("#projectSelect", pid);
  await page.waitForFunction(
    () => !!window.__boneMorph?.getRoot?.() && String(window.__boneMorph.getBuildId?.()).includes("20260908j"),
    null,
    { timeout: 120000 }
  );
  await page.waitForTimeout(2500);

  const build = await page.evaluate(() => window.__boneMorph.getBuildId());
  const tip = await page.evaluate(() => {
    document.querySelector('[data-morph-tab="anchors"]')?.click();
    return true;
  });
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    window.__boneMorph.setAnchorToolMode("brush");
    window.__boneMorph.setBrushStrength(0.13);
    window.__boneMorph.setBrushSoftness(1);
    window.__boneMorph.setBrushSign(1);
  });
  await page.waitForTimeout(200);
  const tipText = await page.evaluate(() => document.querySelector(".lm-stat")?.textContent || "");

  const canvas = page.locator("canvas").first();
  const box = await canvas.boundingBox();

  // side view + zoom
  await page.mouse.move(box.x + 160, box.y + 420);
  await page.mouse.down();
  await page.mouse.move(box.x + 400, box.y + 400);
  await page.mouse.up();
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.4);
  for (let i = 0; i < 10; i++) await page.mouse.wheel(0, -120);
  await page.waitForTimeout(400);

  async function whiteOnMesh() {
    // hide preview so it doesn't count as white sieve
    await page.evaluate(() => {
      window.__boneMorph.getRoot()?.traverse?.(() => {});
      const st = window.__boneMorph.getState?.();
      // exit brush preview by temporarily toggling? keep brush but move pointer off
    });
    // move pointer off canvas to hide hover preview path
    await page.mouse.move(box.x + 10, box.y + 10);
    await page.waitForTimeout(100);
    const buf = await canvas.screenshot();
    return page.evaluate(async (b64) => {
      const img = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = "data:image/png;base64," + b64;
      });
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext("2d");
      ctx.drawImage(img, 0, 0);
      // mesh sits in center; ignore pure white far background corners by requiring neighbors gray
      const x0 = Math.floor(img.width * 0.3);
      const y0 = Math.floor(img.height * 0.15);
      const w = Math.floor(img.width * 0.45);
      const h = Math.floor(img.height * 0.55);
      const d = ctx.getImageData(x0, y0, w, h).data;
      let white = 0;
      let gray = 0;
      const n = w * h;
      for (let i = 0; i < n; i++) {
        const o = i * 4;
        const r = d[o],
          g = d[o + 1],
          b = d[o + 2];
        const l = (r + g + b) / 3;
        if (l > 40 && l < 210) gray++;
        // sieve punctures: near-white speckles surrounded by mid-gray (not full bg)
        if (l > 235 && r > 230 && g > 230 && b > 230) white++;
      }
      return { white, gray, n, whiteRatio: white / n };
    }, buf.toString("base64"));
  }

  const beforePath = path.join(outDir, "sieve-j-before.png");
  await canvas.screenshot({ path: beforePath });
  const beforeW = await whiteOnMesh();

  // aggressive mouse stroke (add)
  const sx = box.x + box.width * 0.55;
  const sy = box.y + box.height * 0.4;
  await page.evaluate(() => {
    window.__boneMorph.setBrushSign(1);
    window.__boneMorph.setBrushStrength(0.13);
    window.__boneMorph.setBrushSoftness(1);
  });
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  for (let i = 0; i < 16; i++) await page.mouse.move(sx + i * 5, sy - i * 2.5);
  await page.mouse.up();
  await page.waitForTimeout(400);

  // subtract stroke overlapping
  await page.evaluate(() => window.__boneMorph.setBrushSign(-1));
  await page.mouse.move(sx + 20, sy - 10);
  await page.mouse.down();
  for (let i = 0; i < 14; i++) await page.mouse.move(sx + 20 + i * 4, sy - 10 - i * 2);
  await page.mouse.up();
  await page.waitForTimeout(400);

  const afterPath = path.join(outDir, "sieve-j-after.png");
  await canvas.screenshot({ path: afterPath });
  const afterW = await whiteOnMesh();

  // API stamps
  await page.selectOption("#projectSelect", pid);
  await page.waitForFunction(() => !!window.__boneMorph?.getRoot?.(), null, { timeout: 120000 });
  await page.waitForTimeout(2000);
  const stamps = await page.evaluate(() => {
    const out = [];
    for (const sign of [1, -1, 1, -1]) {
      out.push(
        window.__boneMorph.selftestBrushStamp({ strength: 0.13, softness: 1, sign, radius: 0.0192 })
      );
    }
    return out;
  });
  const afterApiPath = path.join(outDir, "sieve-j-after-api.png");
  await canvas.screenshot({ path: afterApiPath });

  const whiteSpike = afterW.whiteRatio - beforeW.whiteRatio;
  const stampsOk = stamps.every((s) => s.ok && s.degenerateRatio === 0 && s.volRatio < 1.2);
  // allow tiny noise; sieve from user shot is a dense white cluster
  const sieve = whiteSpike > 0.015 || afterW.white > beforeW.white + 800;
  const ok = build.includes("20260908j") && stampsOk && !sieve;

  console.log(
    JSON.stringify(
      {
        build,
        tipText,
        beforeW,
        afterW,
        whiteSpike,
        stampsOk,
        stamps: stamps.map((s) => ({
          ok: s.ok,
          moved: s.moved,
          maxDisp: s.maxDisp,
          deg: s.degenerateRatio,
          sign: s.strength,
        })),
        sieve,
        ok,
        beforePath,
        afterPath,
        afterApiPath,
      },
      null,
      2
    )
  );

  await browser.close();
  process.exit(ok ? 0 : 2);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
