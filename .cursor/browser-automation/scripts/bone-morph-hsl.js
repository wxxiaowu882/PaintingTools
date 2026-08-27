/**
 * Hard selftest: whole-muscle hue selection + HSL (Ctrl+U style) adjust.
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const RUNS = path.resolve(__dirname, "../runs");
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outDir = path.join(RUNS, `${stamp}-morph-hsl`);
fs.mkdirSync(outDir, { recursive: true });

const BASE = process.env.BASE_URL || "http://127.0.0.1:8765";

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--ignore-gpu-blocklist"],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 960 } });
  const report = { ok: true, checks: [], logs: [], outDir };
  const check = (name, pass, detail) => {
    report.checks.push({ name, pass: !!pass, detail: detail || "" });
    if (!pass) report.ok = false;
    console.log(`${pass ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`);
  };

  page.on("pageerror", (e) => {
    report.logs.push("pageerror:" + e.message);
    console.warn("pageerror", e.message);
  });

  await page.goto(BASE + "/?_=" + Date.now(), {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.click('[data-mode="morph"]');
  await page.waitForFunction(
    () =>
      (document.getElementById("viewerStatusMorph")?.textContent || "").includes(
        "骨相拧形"
      ),
    { timeout: 180000 }
  );
  await page.waitForFunction(() => !!window.__boneMorph, { timeout: 30000 });
  await page.waitForTimeout(900);

  // UI: HSL sliders present, no flat color input as primary
  const ui = await page.evaluate(() => ({
    hasH: !!document.getElementById("morphHslH"),
    hasS: !!document.getElementById("morphHslS"),
    hasL: !!document.getElementById("morphHslL"),
    hasFlatColor: !!document.getElementById("morphMeshColor"),
    title: document.querySelector("#morphPanel h3")
      ? [...document.querySelectorAll("#morphPanel h3")].map((h) => h.textContent)
      : [],
  }));
  check("UI has H/S/L sliders", ui.hasH && ui.hasS && ui.hasL, JSON.stringify(ui));
  check("flat color picker removed", !ui.hasFlatColor);
  check(
    "panel mentions 整肌/HSL",
    (ui.title || []).some((t) => /肌肉颜色/.test(t)),
    JSON.stringify(ui.title)
  );

  // Find a sizable chromatic muscle pick
  let pick = null;
  for (let y = 0.7; y >= -0.1; y -= 0.1) {
    for (let x = -0.5; x <= 0.5; x += 0.08) {
      const r = await page.evaluate(
        ([nx, ny]) => window.__boneMorph.debugPickAtNdc(nx, ny),
        [x, y]
      );
      if (
        r &&
        r.ok &&
        r.selectedRegionPixels > 2000 &&
        /Deform|Static/i.test(r.selectedMeshKey || "")
      ) {
        pick = { ...r, nx: x, ny: y };
        if (r.selectedRegionPixels > 8000) break;
      }
    }
    if (pick && pick.selectedRegionPixels > 8000) break;
  }
  check(
    "whole-muscle pick size",
    !!(pick && pick.selectedRegionPixels >= 2000),
    pick
      ? `${pick.selectedMeshKey} ${pick.selectedRegionHex} px=${pick.selectedRegionPixels}`
      : "none"
  );

  if (pick) {
    await page.evaluate(([x, y]) => window.__boneMorph.debugPickAtNdc(x, y), [
      pick.nx,
      pick.ny,
    ]);

    // Hue flood should cover more than old cheb=1 islands: expect unique colors in mask
    const diversity = await page.evaluate(() => {
      const st = window.__boneMorph.getState();
      const root = window.__boneMorph.getRoot();
      let mesh = null;
      root.traverse((o) => {
        if (o.isMesh && (o.name || "") === st.selectedMeshKey) mesh = o;
      });
      const atlas = mesh?.userData?.bmAtlas;
      const mask = atlas?.masks?.[st.selectedRegionKey];
      if (!mask) return { ok: false, reason: "no mask" };
      const o = atlas.orig.data;
      const uniq = new Set();
      let n = 0;
      let minL = 1;
      let maxL = 0;
      for (let p = 0; p < mask.length; p++) {
        if (!mask[p]) continue;
        const i = p * 4;
        uniq.add(`${o[i]},${o[i + 1]},${o[i + 2]}`);
        const l = (Math.max(o[i], o[i + 1], o[i + 2]) + Math.min(o[i], o[i + 1], o[i + 2])) / 510;
        if (l < minL) minL = l;
        if (l > maxL) maxL = l;
        n++;
      }
      return { ok: true, n, uniq: uniq.size, lRange: maxL - minL };
    });
    check(
      "mask spans multiple shades (not single flat color)",
      diversity.ok && diversity.uniq >= 8 && diversity.lRange > 0.04,
      JSON.stringify(diversity)
    );

    const preserve = await page.evaluate(() =>
      window.__boneMorph.debugHslPreserve(0.22, 0, 0)
    );
    check(
      "HSL hue shift preserves luminance variation",
      !!(preserve && preserve.ok),
      JSON.stringify(preserve)
    );

    // UI slider path
    await page.evaluate(([x, y]) => window.__boneMorph.debugPickAtNdc(x, y), [
      pick.nx,
      pick.ny,
    ]);
    await page.waitForTimeout(200);
    const hslUi = await page.evaluate(async () => {
      const h = document.getElementById("morphHslH");
      if (!h || h.disabled) return { ok: false, reason: "slider disabled" };
      h.value = "90";
      h.dispatchEvent(new Event("input", { bubbles: true }));
      h.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((r) => requestAnimationFrame(() => r()));
      const st = window.__boneMorph.getState();
      return {
        ok: Math.abs((st.regionHsl?.dh || 0) - 90 / 360) < 0.02,
        regionHsl: st.regionHsl,
        px: st.selectedRegionPixels,
      };
    });
    check("UI 色相滑条写入 state", hslUi.ok, JSON.stringify(hslUi));

    await page.click("#morphMeshColorReset");
    await page.waitForTimeout(200);
    const afterReset = await page.evaluate(() => {
      const st = window.__boneMorph.getState();
      return {
        dh: st.regionHsl?.dh || 0,
        hasEntry: !!(st.meshColors?.[st.selectedMeshKey]?.[st.selectedRegionKey]),
      };
    });
    check(
      "恢复原色 clears HSL entry",
      Math.abs(afterReset.dh) < 1e-6 && !afterReset.hasEntry,
      JSON.stringify(afterReset)
    );
  }

  // Isolation still holds under hue flood
  const iso = await page.evaluate(() => window.__boneMorph.debugIsolationProbe("Deform"));
  check(
    "isolation A≠B under hue flood",
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

  await page.screenshot({
    path: path.join(outDir, "01-hsl.png"),
    fullPage: true,
  });

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
