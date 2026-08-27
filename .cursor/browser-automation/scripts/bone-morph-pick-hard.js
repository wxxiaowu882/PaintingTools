/**
 * Hard selftest: bone morph muscle pick (flood-fill) + recolor.
 * Must pass before asking user to accept.
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const RUNS = path.resolve(__dirname, "../runs");
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outDir = path.join(RUNS, `${stamp}-morph-pick-hard`);
fs.mkdirSync(outDir, { recursive: true });

const BASE = process.env.BASE_URL || "http://127.0.0.1:8765";

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--ignore-gpu-blocklist"],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const report = { ok: true, checks: [], logs: [] };
  const check = (name, pass, detail) => {
    report.checks.push({ name, pass: !!pass, detail: detail || "" });
    if (!pass) report.ok = false;
    console.log(`${pass ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`);
  };

  page.on("pageerror", (e) => {
    report.logs.push("pageerror:" + e.message);
    console.warn("pageerror", e.message);
  });
  page.on("console", (msg) => {
    const t = msg.text();
    if (/bone_morph|error|Error/i.test(t)) report.logs.push(t);
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
  await page.waitForTimeout(800);

  const atlas = await page.evaluate(() => window.__boneMorph.debugAtlasStats("Deform"));
  check("deform atlas ready", !!(atlas && atlas.w > 0), JSON.stringify(atlas));

  // Sweep NDC picks until flood region found on Deform
  let pick = null;
  const candidates = [];
  for (let y = 0.6; y >= -0.2; y -= 0.12) {
    for (let x = -0.35; x <= 0.35; x += 0.1) {
      candidates.push([x, y]);
    }
  }
  for (const [nx, ny] of candidates) {
    const r = await page.evaluate(
      ([x, y]) => window.__boneMorph.debugPickAtNdc(x, y),
      [nx, ny]
    );
    if (r && r.ok && r.selectedRegionPixels > 80 && /Deform|Static/i.test(r.selectedMeshKey || "")) {
      pick = { ...r, nx, ny };
      break;
    }
  }
  check(
    "flood pick succeeded",
    !!pick,
    pick
      ? `${pick.selectedMeshKey} ${pick.selectedRegionHex} px=${pick.selectedRegionPixels} ndc=${pick.nx},${pick.ny}`
      : "no region"
  );

  await page.screenshot({ path: path.join(outDir, "01-after-pick.png") });

  if (pick) {
    const painted = await page.evaluate(() =>
      window.__boneMorph.debugPaintSelected("#ff00aa")
    );
    check(
      "paint magenta on atlas",
      painted.ok && painted.pixels > 80,
      JSON.stringify(painted)
    );

    // Same-evaluate recount to avoid cross-evaluate races
    const counted = await page.evaluate(() => {
      const st = window.__boneMorph.getState();
      const root = window.__boneMorph.getRoot();
      let mesh = null;
      root.traverse((o) => {
        if (o.isMesh && (o.name || "") === st.selectedMeshKey) mesh = o;
      });
      if (!mesh) {
        root.traverse((o) => {
          if (o.isMesh && (o.name || "").includes("Deform") && o.userData.bmAtlas)
            mesh = o;
        });
      }
      const atlas = mesh?.userData?.bmAtlas;
      if (!atlas) return { n: -1, reason: "no atlas", key: st.selectedMeshKey };
      const img = atlas.ctx.getImageData(0, 0, atlas.w, atlas.h).data;
      let n = 0;
      for (let i = 0; i < img.length; i += 4) {
        if (img[i] > 240 && img[i + 1] < 20 && img[i + 2] > 150 && img[i + 2] < 190)
          n++;
      }
      // also exact
      let n2 = 0;
      for (let i = 0; i < img.length; i += 4) {
        if (img[i] === 255 && img[i + 1] === 0 && img[i + 2] === 170) n2++;
      }
      return { n, n2, name: mesh.name, key: st.selectedMeshKey };
    });
    check(
      "magenta visible on selected atlas",
      counted.n2 > 80 || counted.n > 80,
      JSON.stringify(counted)
    );

    await page.evaluate(() => window.__boneMorph.clearSelectedMeshColor());
    await page.waitForTimeout(200);
    const afterClear = await page.evaluate(() => {
      const st = window.__boneMorph.getState();
      const root = window.__boneMorph.getRoot();
      let mesh = null;
      root.traverse((o) => {
        if (o.isMesh && (o.name || "").includes("Deform") && o.userData.bmAtlas)
          mesh = o;
      });
      const img = mesh.userData.bmAtlas.ctx.getImageData(
        0,
        0,
        mesh.userData.bmAtlas.w,
        mesh.userData.bmAtlas.h
      ).data;
      let n2 = 0;
      for (let i = 0; i < img.length; i += 4) {
        if (img[i] === 255 && img[i + 1] === 0 && img[i + 2] === 170) n2++;
      }
      return { n2, stillHasRegion: !!(st.meshColors?.[st.selectedMeshKey]?.[st.selectedRegionKey]) };
    });
    check(
      "clear removes magenta",
      afterClear.n2 < 20,
      JSON.stringify(afterClear)
    );

    // UI HSL path
    await page.evaluate(([x, y]) => window.__boneMorph.debugPickAtNdc(x, y), [
      pick.nx,
      pick.ny,
    ]);
    await page.waitForTimeout(300);
    const hslEnabled = await page.evaluate(
      () => !document.getElementById("morphHslH")?.disabled
    );
    check("HSL sliders enabled after pick", hslEnabled);

    const hslPaint = await page.evaluate(() => {
      const h = document.getElementById("morphHslH");
      h.value = "120";
      h.dispatchEvent(new Event("input", { bubbles: true }));
      h.dispatchEvent(new Event("change", { bubbles: true }));
      return window.__boneMorph.getState().regionHsl;
    });
    check(
      "UI HSL hue writes state",
      Math.abs((hslPaint?.dh || 0) - 120 / 360) < 0.02,
      JSON.stringify(hslPaint)
    );

    // API path still supports flat debug paint
    await page.evaluate(([x, y]) => window.__boneMorph.debugPickAtNdc(x, y), [
      pick.nx,
      pick.ny,
    ]);
    const greenPaint = await page.evaluate(() =>
      window.__boneMorph.debugPaintSelected("#00ff66")
    );
    check(
      "debug flat paint green",
      greenPaint.ok && greenPaint.pixels > 80,
      JSON.stringify(greenPaint)
    );

    // Button path: 选肌 mode + real mouse click
    await page.click("#morphPickMesh");
    const box = await page.locator("#viewerHostMorph canvas").boundingBox();
    // map ndc-ish to canvas: ndc x -1..1 -> left-right
    const cx = box.x + box.width * (0.5 + pick.nx * 0.45);
    const cy = box.y + box.height * (0.5 - pick.ny * 0.45);
    await page.mouse.click(cx, cy);
    await page.waitForTimeout(400);
    const afterClick = await page.evaluate(() => {
      const st = window.__boneMorph.getState();
      return {
        key: st.selectedMeshKey,
        rid: st.selectedRegionKey,
        px: st.selectedRegionPixels,
        pickMode: st.pickMuscleMode,
      };
    });
    check(
      "mouse pick via 选肌 button",
      !!afterClick.rid && afterClick.px > 80 && !afterClick.pickMode,
      JSON.stringify(afterClick)
    );
  }

  await page.screenshot({ path: path.join(outDir, "02-after-recolor.png"), fullPage: true });

  // 2D mode still works
  await page.click('[data-mode="side"]');
  await page.waitForSelector("#frameBase", { timeout: 15000 });
  check("2d side ok", !!(await page.$("#frameBase")));

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
