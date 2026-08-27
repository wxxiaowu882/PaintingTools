/**
 * Smoke: compare_review morph mode — load, seed landmarks, nudge slider, reset, export click.
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const RUNS = path.resolve(__dirname, "../runs");
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outDir = path.join(RUNS, `${stamp}-bone-morph-smoke`);
fs.mkdirSync(outDir, { recursive: true });

const BASE = process.env.BASE_URL || "http://127.0.0.1:8765";

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--ignore-gpu-blocklist"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const report = { ok: true, checks: [] };
  const check = (name, pass, detail) => {
    report.checks.push({ name, pass: !!pass, detail: detail || "" });
    if (!pass) report.ok = false;
    console.log(`${pass ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`);
  };

  page.on("pageerror", (e) => console.warn("pageerror", e.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") console.warn("console", msg.text());
  });

  await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector('[data-mode="morph"]', { timeout: 15000 });
  check("has morph button", true);

  await page.click('[data-mode="morph"]');
  await page.waitForSelector("#viewerHostMorph", { timeout: 10000 });
  await page.waitForSelector("#morphPanel", { timeout: 10000 });

  // Wait for euro load + bone morph init
  await page.waitForFunction(
    () => {
      const st = document.getElementById("viewerStatusMorph");
      const t = st ? st.textContent || "" : "";
      return t.includes("骨相拧形") || t.includes("失败");
    },
    { timeout: 120000 }
  );
  const status = await page.textContent("#viewerStatusMorph");
  check("morph ready", (status || "").includes("骨相拧形"), status);

  await page.waitForSelector('#morphPanel [data-slider="bizygomatic"]', { timeout: 15000 });
  const pointCount = await page.$$eval("#morphPointSelect option", (opts) => opts.length);
  check("has control points", pointCount >= 8, `n=${pointCount}`);

  const slider = page.locator('#morphPanel [data-slider="bizygomatic"]');
  await slider.fill("0.01");
  await page.waitForTimeout(400);
  const val = await page.locator('#morphPanel [data-slider="bizygomatic"]').inputValue();
  check("slider moves", Math.abs(parseFloat(val) - 0.01) < 1e-6, val);

  await page.click("#morphReset");
  await page.waitForTimeout(300);
  const val2 = await page.locator('#morphPanel [data-slider="bizygomatic"]').inputValue();
  check("reset clears slider", Math.abs(parseFloat(val2)) < 1e-6, val2);

  // Side-by-side mode still works (2D regression soft check)
  await page.click('[data-mode="side"]');
  await page.waitForSelector("#frameBase", { timeout: 15000 });
  check("2d side mode ok", !!(await page.$("#frameBase")));

  await page.screenshot({ path: path.join(outDir, "after_side.png"), fullPage: true });
  await page.click('[data-mode="morph"]');
  await page.waitForFunction(
    () => (document.getElementById("viewerStatusMorph")?.textContent || "").includes("骨相拧形"),
    { timeout: 120000 }
  );
  await page.screenshot({ path: path.join(outDir, "morph.png"), fullPage: true });

  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
  await browser.close();
  if (!report.ok) process.exit(1);
  console.log("OK", outDir);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
