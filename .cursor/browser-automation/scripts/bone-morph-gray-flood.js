/**
 * Step A hard test: gray/ear coverage + chromatic isolation after flood tighten.
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const RUNS = path.resolve(__dirname, "../runs");
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outDir = path.join(RUNS, `${stamp}-morph-gray-flood`);
fs.mkdirSync(outDir, { recursive: true });
const BASE = process.env.BASE_URL || "http://127.0.0.1:8765";

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--ignore-gpu-blocklist"],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 960 } });
  const report = { ok: true, checks: [], outDir };
  const check = (name, pass, detail) => {
    report.checks.push({ name, pass: !!pass, detail: detail || "" });
    if (!pass) report.ok = false;
    console.log(`${pass ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`);
  };

  await page.goto(BASE + "/?_=" + Date.now(), {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.click('[data-mode="morph"]');
  await page.waitForFunction(
    () =>
      !!window.__boneMorph &&
      (document.getElementById("viewerStatusMorph")?.textContent || "").includes(
        "骨相拧形"
      ),
    { timeout: 180000 }
  );
  await page.waitForTimeout(800);

  const gray = await page.evaluate(() =>
    window.__boneMorph.debugGrayCoverageProbe()
  );
  check(
    "gray flood covers wide L + many shades",
    !!(gray && gray.ok),
    JSON.stringify(gray.top || gray)
  );

  const iso = await page.evaluate(() =>
    window.__boneMorph.debugIsolationProbe("Deform")
  );
  check(
    "chromatic isolation still holds",
    !!(iso && iso.ok && iso.bleed === 0),
    JSON.stringify(iso)
  );

  const tg = await page.evaluate(() =>
    window.__boneMorph.debugTemporalisGaleaIsolation()
  );
  check(
    "temporalis/galea isolation",
    !!(tg && tg.ok && tg.bleed === 0),
    JSON.stringify(tg)
  );

  // Occipitalis-like green: mask should include lighter edge fibers (uniq + lRange)
  const occip = await page.evaluate(() => {
    const picks = [];
    for (let y = 0.85; y >= 0.35; y -= 0.08) {
      for (let x = -0.55; x <= 0.55; x += 0.1) {
        const r = window.__boneMorph.debugPickAtNdc(x, y);
        if (!r?.ok || r.selectedRegionPixels < 1500) continue;
        const hex = r.selectedRegionHex || "";
        const g = parseInt(hex.slice(3, 5), 16);
        const red = parseInt(hex.slice(1, 3), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        if (g > red + 15 && g > b) picks.push({ ...r, nx: x, ny: y });
      }
    }
    picks.sort((a, b) => b.selectedRegionPixels - a.selectedRegionPixels);
    const best = picks[0];
    if (!best) return { ok: false, reason: "no green pick" };
    window.__boneMorph.debugPickAtNdc(best.nx, best.ny);
    const st = window.__boneMorph.getState();
    const root = window.__boneMorph.getRoot();
    let mesh = null;
    root.traverse((o) => {
      if (o.isMesh && (o.name || "") === st.selectedMeshKey) mesh = o;
    });
    const atlas = mesh?.userData?.bmAtlas;
    const mask = atlas?.masks?.[st.selectedRegionKey];
    if (!mask) return { ok: false, reason: "no mask", best };
    const o = atlas.orig.data;
    let minL = 1;
    let maxL = 0;
    const uniq = new Set();
    for (let p = 0; p < mask.length; p++) {
      if (!mask[p]) continue;
      const i = p * 4;
      const mx = Math.max(o[i], o[i + 1], o[i + 2]);
      const mn = Math.min(o[i], o[i + 1], o[i + 2]);
      const l = (mx + mn) / 510;
      if (l < minL) minL = l;
      if (l > maxL) maxL = l;
      uniq.add(`${o[i]},${o[i + 1]},${o[i + 2]}`);
    }
    const lRange = maxL - minL;
    return {
      ok: best.selectedRegionPixels >= 2500 && uniq.size >= 20 && lRange >= 0.08,
      px: best.selectedRegionPixels,
      uniq: uniq.size,
      lRange,
      hex: best.selectedRegionHex,
    };
  });
  check(
    "occipitalis-like green includes shade range",
    !!(occip && occip.ok),
    JSON.stringify(occip)
  );

  await page.screenshot({ path: path.join(outDir, "01-gray.png"), fullPage: true });
  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
  await browser.close();
  if (!report.ok) {
    console.error("FAIL", outDir);
    process.exit(1);
  }
  console.log("OK", outDir);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
