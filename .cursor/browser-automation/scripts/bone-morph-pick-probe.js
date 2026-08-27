/**
 * Probe pick quality at ear / neck / back ROIs.
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const RUNS = path.resolve(__dirname, "../runs");
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outDir = path.join(RUNS, `${stamp}-morph-pick-probe`);
fs.mkdirSync(outDir, { recursive: true });
const BASE = process.env.BASE_URL || "http://127.0.0.1:8765";

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--ignore-gpu-blocklist"],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 960 } });
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

  // side view for ear/back
  const sideBtn = page.locator("#viewerHostMorph button", { hasText: "侧" });
  if (await sideBtn.count()) {
    await sideBtn.first().click().catch(() => {});
    await page.waitForTimeout(400);
  }

  const sideProbe = await page.evaluate(() => {
    const bm = window.__boneMorph;
    const rois = {
      ear: [0.72, 0.42],
      neckSide: [0.55, 0.7],
      backUpper: [0.35, 0.45],
      occiput: [0.4, 0.25],
    };
    const out = {};
    for (const [k, [nx, ny]] of Object.entries(rois)) {
      const hits = bm.debugPickAtNdc(nx, ny) || [];
      out[k] = hits.slice(0, 5).map((h) => {
        // also flood from this UV if possible
        return h;
      });
      // try programmatic pick flood sizes via internal sample
      if (hits[0] && hits[0].uv) {
        const root = bm.getRoot();
        let mesh = null;
        root.traverse((o) => {
          if (o.isMesh && o.name === hits[0].mesh) mesh = o;
        });
        if (mesh && mesh.userData.bmAtlas) {
          const a = mesh.userData.bmAtlas;
          const u = hits[0].uv[0];
          const v = hits[0].uv[1];
          const flipY = !!a.tex.flipY;
          const x = Math.min(a.w - 1, Math.max(0, Math.floor(u * a.w)));
          const y = Math.min(
            a.h - 1,
            Math.max(0, Math.floor((flipY ? 1 - v : v) * a.h))
          );
          // use debugGrayCoverageProbe style — call flood via pickMuscle path
          const st = bm.debugFloodAtMeshUv?.(mesh.name, u, v);
          out[k + "_flood"] = st || { mesh: mesh.name, x, y, uv: [u, v] };
        }
      }
    }
    return out;
  });

  // Add debugFloodAtMeshUv if missing — inline flood via evaluate rewrite
  const floods = await page.evaluate(() => {
    const bm = window.__boneMorph;
    // expose temporary by reusing pick simulation
    const root = bm.getRoot();
    function floodAt(meshName, nx, ny) {
      // use ray first
      const hits = bm.debugPickAtNdc(nx, ny) || [];
      const results = [];
      for (const h of hits.slice(0, 6)) {
        let mesh = null;
        root.traverse((o) => {
          if (o.isMesh && o.name === h.mesh) mesh = o;
        });
        if (!mesh?.userData?.bmAtlas || !h.uv) {
          results.push({ mesh: h.mesh, noAtlas: true });
          continue;
        }
        // Trigger pick path: set pointer and call internal — use apply via public
        // Approximate: read orig + run same flood by copying algorithm from page
        // Use __boneMorph.debugPickFlood if we add it — for now count via ensure
        const a = mesh.userData.bmAtlas;
        const flipY = !!a.tex.flipY;
        const x = Math.min(a.w - 1, Math.max(0, Math.floor(h.uv[0] * a.w)));
        const y = Math.min(
          a.h - 1,
          Math.max(0, Math.floor((flipY ? 1 - h.uv[1] : h.uv[1]) * a.h))
        );
        const i = (y * a.w + x) * 4;
        const o = a.orig.data;
        results.push({
          mesh: h.mesh,
          dist: h.dist,
          uv: h.uv,
          rgb: [o[i], o[i + 1], o[i + 2]],
          transparent: h.transparent,
        });
      }
      return results;
    }
    return {
      ear: floodAt("ear", 0.72, 0.42),
      neck: floodAt("neck", 0.55, 0.7),
      back: floodAt("back", 0.32, 0.5),
    };
  });

  // Front neck
  const frontBtn = page.locator("#viewerHostMorph button", { hasText: "前" });
  if (await frontBtn.count()) {
    await frontBtn.first().click().catch(() => {});
    await page.waitForTimeout(400);
  }
  const front = await page.evaluate(() => {
    const bm = window.__boneMorph;
    return {
      neckL: bm.debugPickAtNdc(0.4, 0.72),
      neckR: bm.debugPickAtNdc(0.6, 0.72),
      neckC: bm.debugPickAtNdc(0.5, 0.75),
    };
  });

  // Add debugFloodPick and measure
  await page.evaluate(() => {
    // monkey: compute flood size using canvas seed from pick
  });

  const withFlood = await page.evaluate(() => {
    const bm = window.__boneMorph;
    // Inject flood helper onto window using same code path as pick
    // by clicking pick mode and synthesizing — instead duplicate flood from getState
    if (!bm.debugFloodFromNdc) {
      // We'll add properly in bone_morph; approximate with gray probe seeds
      return { needApi: true, gray: bm.debugGrayCoverageProbe() };
    }
    return {
      ear: bm.debugFloodFromNdc(0.72, 0.42),
      neck: bm.debugFloodFromNdc(0.55, 0.7),
    };
  });

  const report = { sideProbe, floods, front, withFlood };
  fs.writeFileSync(path.join(outDir, "probe.json"), JSON.stringify(report, null, 2));
  await page.locator("#viewerHostMorph").screenshot({
    path: path.join(outDir, "side.png"),
  });
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
