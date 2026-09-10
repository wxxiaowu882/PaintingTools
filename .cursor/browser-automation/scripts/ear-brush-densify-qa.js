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
    () => !!window.__boneMorph?.getRoot?.() && String(window.__boneMorph.getBuildId?.()).includes("20260908k"),
    null,
    { timeout: 120000 }
  );
  await page.waitForTimeout(2500);

  const build = await page.evaluate(() => window.__boneMorph.getBuildId());
  await page.evaluate(() => {
    document.querySelector('[data-morph-tab="anchors"]')?.click();
    window.__boneMorph.setAnchorToolMode("brush");
    window.__boneMorph.setBrushStrength(0.42);
    window.__boneMorph.setBrushSoftness(0.57);
    window.__boneMorph.setBrushSign(1);
  });
  await page.waitForTimeout(300);
  const tip = await page.evaluate(() => {
    window.__boneMorph.setAnchorToolMode("brush");
    // force panel refresh via onChange path
    window.__boneMorph.setBrushStrength(0.42);
    return [...document.querySelectorAll(".lm-stat")].map((el) => el.textContent).join(" | ");
  });

  const r1 = await page.evaluate(() =>
    window.__boneMorph.selftestBrushStamp({ strength: 0.42, softness: 0.57, sign: 1, radius: 0.0192 })
  );
  const r2 = await page.evaluate(() =>
    window.__boneMorph.selftestBrushStamp({ strength: 0.42, softness: 0.57, sign: 1, radius: 0.0192 })
  );
  const r3 = await page.evaluate(() =>
    window.__boneMorph.selftestBrushStamp({ strength: 0.42, softness: 0.57, sign: 1, radius: 0.0192 })
  );

  const canvas = page.locator("canvas").first();
  const shot = path.join(outDir, "densify-brush-k.png");
  await canvas.screenshot({ path: shot });

  const densified = r1.densified || r2.densified || r3.densified || r3.vertsAfter > r1.vertsBefore;
  const ok =
    build.includes("20260908k") &&
    r1.ok &&
    r2.ok &&
    r3.ok &&
    densified &&
    r3.degenerateRatio === 0 &&
    r3.vertsAfter > r1.vertsBefore;

  console.log(
    JSON.stringify(
      {
        build,
        tip,
        r1: {
          ok: r1.ok,
          densified: r1.densified,
          vertsBefore: r1.vertsBefore,
          vertsAfter: r1.vertsAfter,
          trisBefore: r1.trisBefore,
          trisAfter: r1.trisAfter,
          moved: r1.moved,
          deg: r1.degenerateRatio,
        },
        r2: { densified: r2.densified, vertsAfter: r2.vertsAfter, trisAfter: r2.trisAfter },
        r3: { densified: r3.densified, vertsAfter: r3.vertsAfter, trisAfter: r3.trisAfter, deg: r3.degenerateRatio },
        densified,
        ok,
        shot,
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
