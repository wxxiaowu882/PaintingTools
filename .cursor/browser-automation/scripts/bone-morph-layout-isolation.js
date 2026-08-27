/**
 * Hard selftest:
 * 1) Morph layout: Base15 left / Euro right, equal viewport sizes
 * 2) Muscle recolor isolation: painting region A must not bleed into region B
 * 3) Regression: flood pick + paint + clear still works
 *
 * Must ALL pass before asking user to accept.
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const RUNS = path.resolve(__dirname, "../runs");
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outDir = path.join(RUNS, `${stamp}-morph-layout-isolation`);
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
  await page.waitForTimeout(1000);

  // ——— 1) Layout ———
  const layout = await page.evaluate(() => {
    const cards = [...document.querySelectorAll(".stage.morph > .card")];
    const base = document.getElementById("morphBaseFrame");
    const euro = document.getElementById("viewerHostMorph");
    const br = base?.getBoundingClientRect();
    const er = euro?.getBoundingClientRect();
    return {
      card0: cards[0]?.querySelector("h2")?.textContent?.trim() || "",
      card1: cards[1]?.querySelector("h2")?.textContent?.trim() || "",
      base: br
        ? { x: br.x, y: br.y, w: br.width, h: br.height }
        : null,
      euro: er
        ? { x: er.x, y: er.y, w: er.width, h: er.height }
        : null,
    };
  });

  check(
    "Base15 is left card",
    /^Base15/.test(layout.card0),
    layout.card0
  );
  check(
    "Euro is right card",
    /欧版/.test(layout.card1),
    layout.card1
  );
  check(
    "Base left of Euro (x)",
    !!(layout.base && layout.euro && layout.base.x < layout.euro.x - 20),
    JSON.stringify({ baseX: layout.base?.x, euroX: layout.euro?.x })
  );

  const dw = Math.abs((layout.base?.w || 0) - (layout.euro?.w || 0));
  const dh = Math.abs((layout.base?.h || 0) - (layout.euro?.h || 0));
  check(
    "viewport widths equal (±8px)",
    dw <= 8 && (layout.base?.w || 0) > 200,
    `dw=${dw.toFixed(1)} base=${layout.base?.w?.toFixed(1)} euro=${layout.euro?.w?.toFixed(1)}`
  );
  check(
    "viewport heights equal (±8px)",
    dh <= 8 && (layout.base?.h || 0) > 200,
    `dh=${dh.toFixed(1)} base=${layout.base?.h?.toFixed(1)} euro=${layout.euro?.h?.toFixed(1)}`
  );

  await page.screenshot({
    path: path.join(outDir, "01-layout.png"),
    fullPage: true,
  });

  // ——— 2) Isolation probes ———
  const iso = await page.evaluate(() => window.__boneMorph.debugIsolationProbe("Deform"));
  check(
    "isolation: paint A does not bleed into B",
    !!(iso && iso.ok && iso.bleed === 0),
    JSON.stringify(iso)
  );
  check(
    "isolation: A actually painted",
    !!(iso && iso.paintedA > 80),
    `paintedA=${iso?.paintedA}`
  );

  const tg = await page.evaluate(() =>
    window.__boneMorph.debugTemporalisGaleaIsolation()
  );
  check(
    "temporalis/galea: muscle paint leaves galea intact",
    !!(tg && tg.ok && tg.bleed === 0),
    JSON.stringify(tg)
  );

  // ——— 3) Temporalis-ish vs galea-ish via NDC sweep ———
  // Collect several distinct flood regions from 3D picks; paint smallest-of-two neighbors
  const picks = await page.evaluate(() => {
    const out = [];
    const seen = new Set();
    for (let y = 0.75; y >= -0.15; y -= 0.1) {
      for (let x = -0.55; x <= 0.55; x += 0.08) {
        const r = window.__boneMorph.debugPickAtNdc(x, y);
        if (!r || !r.ok || r.selectedRegionPixels < 120) continue;
        if (!/Deform|Static/i.test(r.selectedMeshKey || "")) continue;
        const key = `${r.selectedRegionKey}|${r.selectedRegionHex}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ ...r, nx: x, ny: y });
        if (out.length >= 14) return out;
      }
    }
    return out;
  });
  check("ndc region catalog", picks.length >= 2, `n=${picks.length}`);

  let crossBleed = { ok: false, reason: "skipped" };
  if (picks.length >= 2) {
    // Sort by pixel count; try pairs with different hex
    const sorted = picks.slice().sort((a, b) => a.selectedRegionPixels - b.selectedRegionPixels);
    let pair = null;
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        if (sorted[i].selectedRegionHex !== sorted[j].selectedRegionHex) {
          pair = [sorted[i], sorted[j]];
          break;
        }
      }
      if (pair) break;
    }
    if (!pair) pair = [sorted[0], sorted[1]];

    crossBleed = await page.evaluate(([A, B]) => {
      const bm = window.__boneMorph;
      // Snapshot B's flood mask pixels' orig colors via pick B then read atlas
      bm.debugPickAtNdc(B.nx, B.ny);
      const stB = bm.getState();
      const root = bm.getRoot();
      let mesh = null;
      root.traverse((o) => {
        if (o.isMesh && (o.name || "") === stB.selectedMeshKey) mesh = o;
      });
      if (!mesh?.userData?.bmAtlas) return { ok: false, reason: "no mesh B" };
      const atlas = mesh.userData.bmAtlas;
      const maskB = atlas.masks[stB.selectedRegionKey];
      if (!maskB) return { ok: false, reason: "no mask B", rid: stB.selectedRegionKey };
      const o = atlas.orig.data;
      const samples = [];
      for (let p = 0; p < maskB.length; p++) {
        if (!maskB[p]) continue;
        const i = p * 4;
        samples.push([p, o[i], o[i + 1], o[i + 2]]);
        if (samples.length > 8000) break;
      }

      bm.clearSelectedMeshColor();
      bm.debugPickAtNdc(A.nx, A.ny);
      const painted = bm.debugPaintSelected("#ff00aa");
      const img = atlas.ctx.getImageData(0, 0, atlas.w, atlas.h).data;
      let bleed = 0;
      let unchanged = 0;
      for (const [p, r, g, b] of samples) {
        const i = p * 4;
        if (img[i] === 255 && img[i + 1] === 0 && img[i + 2] === 170) bleed++;
        else if (img[i] === r && img[i + 1] === g && img[i + 2] === b) unchanged++;
      }
      bm.clearSelectedMeshColor();
      return {
        ok: painted.ok && bleed === 0,
        bleed,
        unchanged,
        sampleN: samples.length,
        paintedA: painted.pixels,
        A: {
          hex: A.selectedRegionHex,
          px: A.selectedRegionPixels,
          ndc: [A.nx, A.ny],
        },
        B: {
          hex: B.selectedRegionHex,
          px: B.selectedRegionPixels,
          ndc: [B.nx, B.ny],
        },
      };
    }, pair);

    check(
      "ndc cross-region: A paint leaves B intact",
      !!(crossBleed && crossBleed.ok && crossBleed.bleed === 0),
      JSON.stringify(crossBleed)
    );
  }

  await page.screenshot({ path: path.join(outDir, "02-isolation.png") });

  // ——— 4) Basic pick/paint/clear regression ———
  let pick = null;
  for (const p of picks) {
    if (p.selectedRegionPixels > 80 && p.selectedRegionPixels < 120000) {
      pick = p;
      break;
    }
  }
  if (!pick && picks[0]) pick = picks[0];

  if (pick) {
    await page.evaluate(([x, y]) => window.__boneMorph.debugPickAtNdc(x, y), [
      pick.nx,
      pick.ny,
    ]);
    const painted = await page.evaluate(() =>
      window.__boneMorph.debugPaintSelected("#00ff66")
    );
    check(
      "regression paint green",
      painted.ok && painted.pixels > 80,
      JSON.stringify(painted)
    );
    await page.evaluate(() => window.__boneMorph.clearSelectedMeshColor());
    const cleared = await page.evaluate(() => {
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
      let n = 0;
      for (let i = 0; i < img.length; i += 4) {
        if (img[i] === 0 && img[i + 1] === 255 && img[i + 2] === 102) n++;
      }
      return n;
    });
    check("regression clear green", cleared < 20, `remain=${cleared}`);
  } else {
    check("regression pick available", false, "no pick");
  }

  // ——— 5) View switch still updates Base15 label (nth-child fix) ———
  await page.click('[data-view="front"]');
  await page.waitForTimeout(400);
  const label = await page.evaluate(
    () =>
      document.querySelector(".stage.morph .card:nth-child(1) h2 span")
        ?.textContent || ""
  );
  check("Base15 view label → front", label === "front", `label=${label}`);

  await page.screenshot({
    path: path.join(outDir, "03-final.png"),
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
