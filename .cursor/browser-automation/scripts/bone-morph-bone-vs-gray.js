/**
 * Selftest: mid-gray neck/back adjustable; pale skull frozen; no gray mottling.
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const RUNS = path.resolve(__dirname, "../runs");
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outDir = path.join(RUNS, `${stamp}-morph-bone-vs-gray`);
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

  const probe = await page.evaluate(() =>
    window.__boneMorph.debugBoneAndMottleProbe(0.19)
  );
  check("bone frozen + mid-gray neck adjustable", !!(probe && probe.ok), JSON.stringify(probe));
  check("bone change rate < 2%", !!(probe && probe.boneOk), `rate=${probe?.boneChangeRate}`);
  check(
    "mid-gray change rate > 85%",
    !!(probe && probe.muscleOk),
    `rate=${probe?.midGrayChangeRate} n=${probe?.midGrayTotal}`
  );
  check(
    "gray hue dominance ≥ 85% (no mottle)",
    !!(probe && probe.mottleOk),
    `bins=${probe?.grayHueBins} dom=${probe?.grayHueDominance}`
  );

  // Unit-ish: known RGB samples via evaluate of shift through public apply
  const samples = await page.evaluate(() => {
    // Apply all H=-55 S=19 L=-33 like user screenshot
    const bm = window.__boneMorph;
    bm.setHslScope("all");
    bm.setScopeHsl(-55 / 360, 0.19, -0.33, { notify: false });
    const root = bm.getRoot();
    let mesh = null;
    root.traverse((o) => {
      if (o.isMesh && (o.name || "").includes("Deform") && o.userData.bmAtlas) mesh = o;
    });
    const a = mesh.userData.bmAtlas;
    const o = a.orig.data;
    const img = a.ctx.getImageData(0, 0, a.w, a.h).data;
    function findAndCheck(pred, label) {
      for (let i = 0; i < o.length; i += 4) {
        if (!pred(o[i], o[i + 1], o[i + 2])) continue;
        return {
          label,
          orig: [o[i], o[i + 1], o[i + 2]],
          now: [img[i], img[i + 1], img[i + 2]],
          changed:
            img[i] !== o[i] || img[i + 1] !== o[i + 1] || img[i + 2] !== o[i + 2],
        };
      }
      return { label, missing: true };
    }
    const mid = findAndCheck(
      (r, g, b) =>
        Math.abs(r - 162) <= 4 && Math.abs(g - 162) <= 4 && Math.abs(b - 162) <= 4,
      "midGray162"
    );
    const light = findAndCheck(
      (r, g, b) =>
        Math.abs(r - 175) <= 3 && Math.abs(g - 175) <= 3 && Math.abs(b - 175) <= 3,
      "lightGray175"
    );
    const coolGalea = findAndCheck(
      (r, g, b) =>
        Math.abs(r - 167) <= 6 &&
        Math.abs(g - 180) <= 8 &&
        Math.abs(b - 196) <= 8,
      "coolGaleaDeform"
    );
    // Static cream bone must stay
    let stat = null;
    root.traverse((o) => {
      if (o.isMesh && /static/i.test(o.name || "") && o.userData.bmAtlas) stat = o;
    });
    let cream = { label: "staticCream", missing: true };
    if (stat) {
      const sa = stat.userData.bmAtlas;
      const so = sa.orig.data;
      const simg = sa.ctx.getImageData(0, 0, sa.w, sa.h).data;
      for (let i = 0; i < so.length; i += 4) {
        if (!(so[i] > 240 && so[i + 1] > 230 && so[i + 2] < 220 && so[i + 2] < so[i + 1] - 20))
          continue;
        cream = {
          label: "staticCream",
          orig: [so[i], so[i + 1], so[i + 2]],
          now: [simg[i], simg[i + 1], simg[i + 2]],
          changed:
            simg[i] !== so[i] ||
            simg[i + 1] !== so[i + 1] ||
            simg[i + 2] !== so[i + 2],
        };
        break;
      }
    }
    bm.setScopeHsl(0, 0, 0, { notify: false });
    return { mid, light, coolGalea, cream };
  });
  check(
    "sample mid-gray 162 changes",
    !!(samples.mid && samples.mid.changed && !samples.mid.missing),
    JSON.stringify(samples.mid)
  );
  check(
    "sample light-gray 175 (颈前) changes",
    !!(samples.light && samples.light.changed && !samples.light.missing),
    JSON.stringify(samples.light)
  );
  check(
    "sample Deform cool-gray (galea) changes",
    !!(samples.coolGalea && samples.coolGalea.changed && !samples.coolGalea.missing),
    JSON.stringify(samples.coolGalea)
  );
  check(
    "sample Static cream bone unchanged",
    !!(samples.cream && !samples.cream.missing && !samples.cream.changed),
    JSON.stringify(samples.cream)
  );

  await page.screenshot({ path: path.join(outDir, "01.png"), fullPage: true });
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
