/**
 * Hard selftest: gray flood (step A) + three HSL scopes (step B).
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const RUNS = path.resolve(__dirname, "../runs");
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outDir = path.join(RUNS, `${stamp}-morph-hsl-scopes`);
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

  page.on("pageerror", (e) => {
    console.warn("pageerror", e.message);
    report.checks.push({ name: "pageerror", pass: false, detail: e.message });
    report.ok = false;
  });

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
  await page.waitForTimeout(900);

  // ——— UI three scopes ———
  const ui = await page.evaluate(() => ({
    all: !!document.getElementById("morphHslScopeAll"),
    muscles: !!document.getElementById("morphHslScopeMuscles"),
    selected: !!document.getElementById("morphHslScopeSelected"),
    h: !!document.getElementById("morphHslH"),
  }));
  check("UI three scope buttons", ui.all && ui.muscles && ui.selected, JSON.stringify(ui));

  // ——— Step A: gray coverage ———
  const gray = await page.evaluate(() =>
    window.__boneMorph.debugGrayCoverageProbe()
  );
  check(
    "gray flood wide L + shades",
    !!(gray && gray.ok),
    JSON.stringify(gray.top || gray)
  );

  const iso = await page.evaluate(() =>
    window.__boneMorph.debugIsolationProbe("Deform")
  );
  check(
    "chromatic isolation",
    !!(iso && iso.ok && iso.bleed === 0),
    JSON.stringify({
      ok: iso?.ok,
      bleed: iso?.bleed,
      a: iso?.regionA?.hex,
      b: iso?.regionB?.hex,
    })
  );

  // ——— Step B: scope paint counts ———
  const meshList = await page.evaluate(() =>
    window.__boneMorph.getState().meshes.map((m) => ({
      name: m.name,
      isMuscle: m.isMuscleLayer,
      hasAtlas: m.hasAtlas,
    }))
  );
  console.log("meshes", JSON.stringify(meshList));

  const allPaint = await page.evaluate(() =>
    window.__boneMorph.debugCountScopePaint("all", 0.2)
  );
  const musPaint = await page.evaluate(() =>
    window.__boneMorph.debugCountScopePaint("muscles", 0.2)
  );
  check("debugCountScopePaint all", !!(allPaint && allPaint.ok), JSON.stringify(allPaint?.perMesh));
  check("debugCountScopePaint muscles", !!(musPaint && musPaint.ok), JSON.stringify(musPaint?.perMesh));

  const sumChanged = (r) =>
    (r?.perMesh || []).reduce((s, m) => s + (m.changed || 0), 0);
  const allCh = sumChanged(allPaint);
  const musCh = sumChanged(musPaint);
  check(
    "all scope paints ≥ muscles scope",
    allCh >= musCh && allCh > 1000,
    `all=${allCh} muscles=${musCh}`
  );

  const nonMuscleChangedUnderMuscles = (musPaint?.perMesh || [])
    .filter((m) => !m.isMuscle)
    .reduce((s, m) => s + m.changed, 0);
  check(
    "muscles scope leaves non-muscle layers mostly intact",
    nonMuscleChangedUnderMuscles < 50,
    `nonMuscleChanged=${nonMuscleChangedUnderMuscles}`
  );

  // Independent scope values
  await page.evaluate(() => {
    window.__boneMorph.setHslScope("all");
    window.__boneMorph.setScopeHsl(0.1, 0, 0, { notify: false });
    window.__boneMorph.setHslScope("muscles");
    window.__boneMorph.setScopeHsl(0.2, 0, 0, { notify: false });
  });
  const scopes = await page.evaluate(() => window.__boneMorph.getState().scopeHsl);
  check(
    "scopeHsl values independent",
    Math.abs(scopes.all.dh - 0.1) < 1e-6 && Math.abs(scopes.muscles.dh - 0.2) < 1e-6,
    JSON.stringify(scopes)
  );

  // Clear current scope only
  await page.evaluate(() => {
    window.__boneMorph.setHslScope("muscles");
    window.__boneMorph.clearSelectedMeshColor();
  });
  const afterClear = await page.evaluate(() => window.__boneMorph.getState().scopeHsl);
  check(
    "clear muscles keeps all",
    Math.abs(afterClear.muscles.dh) < 1e-6 && Math.abs(afterClear.all.dh - 0.1) < 1e-6,
    JSON.stringify(afterClear)
  );

  // Selected scope: pick + hsl + isolation of neighbor
  await page.evaluate(() => {
    window.__boneMorph.setHslScope("all");
    window.__boneMorph.clearSelectedMeshColor();
    window.__boneMorph.setHslScope("selected");
  });
  let pick = null;
  for (let y = 0.55; y >= 0.05; y -= 0.12) {
    for (let x = -0.4; x <= 0.4; x += 0.12) {
      const r = await page.evaluate(
        ([nx, ny]) => window.__boneMorph.debugPickAtNdc(nx, ny),
        [x, y]
      );
      if (r?.ok && r.selectedRegionPixels > 1500 && r.selectedRegionPixels < 200000) {
        pick = { ...r, nx: x, ny: y };
        break;
      }
    }
    if (pick) break;
  }
  check("selected pick ok", !!pick, pick ? `px=${pick.selectedRegionPixels}` : "none");

  if (pick) {
    await page.evaluate(([x, y]) => window.__boneMorph.debugPickAtNdc(x, y), [
      pick.nx,
      pick.ny,
    ]);
    const painted = await page.evaluate(() =>
      window.__boneMorph.setScopeHsl(0.25, 0, 0, { notify: true })
    );
    check("selected setScopeHsl", !!(painted && painted.ok), JSON.stringify(painted));

    const preserve = await page.evaluate(() =>
      window.__boneMorph.debugHslPreserve(0.18, 0, 0)
    );
    check(
      "selected HSL preserves luminance variation",
      !!(preserve && preserve.ok),
      JSON.stringify(preserve)
    );
  }

  // UI: switch to all enables slider without pick
  await page.click("#morphHslScopeAll");
  await page.waitForTimeout(200);
  const allEnabled = await page.evaluate(
    () => !document.getElementById("morphHslH")?.disabled
  );
  check("全部 scope enables sliders", allEnabled);

  await page.screenshot({
    path: path.join(outDir, "01-scopes.png"),
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
