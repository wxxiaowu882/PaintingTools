/**
 * Selftest: temporalis-like island texture synth (refined color mask, no bleed).
 * Run: BASE_URL=http://127.0.0.1:8765 node scripts/bone-morph-texture-synth-temporalis.js
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE = process.env.BASE_URL || "http://127.0.0.1:8765";
const BUILD_ID = "geom-island-texture-synth-20260903f";
const outDir = path.join(
  __dirname,
  "..",
  "runs",
  `${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}-morph-texture-temporalis`
);
fs.mkdirSync(outDir, { recursive: true });

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: !!ok, detail: detail || "" });
  console.log(ok ? "✓" : "✗", name, detail ? `— ${detail}` : "");
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--ignore-gpu-blocklist"],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 960 } });
  await page.goto(`${BASE}/?_=${Date.now()}`, {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });

  await page.waitForFunction(
    () => {
      const sel = document.querySelector("#projectSelect");
      if (!sel) return false;
      if (sel.options.length > 0 && sel.options[0].value) return true;
      return sel.options.length > 0 && /暂无工程|加载失败/.test(sel.options[0].textContent || "");
    },
    { timeout: 60000 }
  );

  const hasProject = await page.evaluate(() => {
    const sel = document.querySelector("#projectSelect");
    return !!(sel && sel.value);
  });
  if (!hasProject) {
    await page.click("#btnNewFromEuro");
    await page.waitForFunction(
      () => {
        const sel = document.querySelector("#projectSelect");
        return !!(sel && sel.value);
      },
      { timeout: 180000 }
    );
  }

  await page.waitForFunction(() => !!window.__boneMorph?.getRoot?.(), { timeout: 180000 });
  await page.waitForFunction(
    () => window.__boneMorph?.getState?.()?.islandScanDone === true,
    { timeout: 180000 }
  );

  const buildId = await page.evaluate(() => window.__boneMorph?.getBuildId?.() || "");
  check("build id", buildId === BUILD_ID, buildId);

  await page.click('[data-morph-tab="color"]');
  await page.waitForTimeout(300);

  const pick = await page.evaluate(() => {
    const st = window.__boneMorph.getState();
    let best = null;
    for (const g of st.colorIslandGroups || []) {
      const key = `${g.meshKey || ""} ${g.meshRawName || ""}`.toLowerCase();
      if (!/deform|变形/.test(key)) continue;
      for (const isl of g.islands || []) {
        if (isl.pixelCount < 50000 || isl.pixelCount > 120000) continue;
        if (!best || Math.abs(isl.pixelCount - 94000) < Math.abs(best.pixelCount - 94000)) {
          best = isl;
        }
      }
    }
    return best;
  });
  check("found medium-large island (~temporalis size)", !!pick, JSON.stringify(pick));

  await page.evaluate(
    (token) => {
      window.__boneMorph.clearIslandTextureSynth?.();
      window.__boneMorph.setIslandChecked([token]);
      window.__boneMorph.setHslScope("parts");
      window.__boneMorph.setIslandTextureSynthParams({
        seed: 42,
        similarity: 0.75,
        blockScale: 24,
      });
    },
    pick.token
  );

  await page.evaluate(() => window.__boneMorph.runIslandTextureSynth());
  await page.waitForFunction(
    () => !window.__boneMorph.getState().islandTextureSynthBusy,
    { timeout: 120000 }
  );

  const after = await page.evaluate((token) => {
    const st = window.__boneMorph.getState();
    const parsed = token.split("::");
    const meshKey = parsed[0];
    const regionId = parsed[1];
    let mesh = null;
    window.__boneMorph.getRoot().traverse((o) => {
      if (o.isMesh && (o.name === meshKey || o.uuid === meshKey)) mesh = o;
    });
    const atlas = mesh?.userData?.bmAtlas;
    if (!atlas) return { ok: false, reason: "no atlas" };
    const geomMask = atlas.masks?.[regionId];
    if (!geomMask) return { ok: false, reason: "no mask" };
    const d = atlas.live.data;
    const o = atlas.orig.data;
    let geomPx = 0;
    let synthChanged = 0;
    let geomUnchanged = 0;
    let outsideChanged = 0;
    let outlierCount = 0;
    let maxOutlier = 0;
    let foreignHueSpikes = 0;
    const changedColors = [];
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let changedN = 0;
    for (let p = 0; p < geomMask.length; p++) {
      if (geomMask[p]) geomPx++;
      const di = p * 4;
      const dr = Math.abs(d[di] - o[di]);
      const dg = Math.abs(d[di + 1] - o[di + 1]);
      const db = Math.abs(d[di + 2] - o[di + 2]);
      const diff = dr + dg + db;
      if (diff === 0) {
        if (geomMask[p]) geomUnchanged++;
        continue;
      }
      if (geomMask[p]) {
        synthChanged++;
        sumR += d[di];
        sumG += d[di + 1];
        sumB += d[di + 2];
        changedN++;
        if (changedColors.length < 200) changedColors.push([d[di], d[di + 1], d[di + 2]]);
      } else {
        outsideChanged++;
      }
      if (diff > 100) {
        outlierCount++;
        if (diff > maxOutlier) maxOutlier = diff;
      }
    }
    const meanR = sumR / (changedN || 1);
    const meanG = sumG / (changedN || 1);
    const meanB = sumB / (changedN || 1);
    for (const c of changedColors) {
      const dist = Math.abs(c[0] - meanR) + Math.abs(c[1] - meanG) + Math.abs(c[2] - meanB);
      if (dist > 120) foreignHueSpikes++;
    }
    let varMeanR = 0;
    let varMeanG = 0;
    let varMeanB = 0;
    const n = changedColors.length || 1;
    for (const c of changedColors) {
      varMeanR += c[0];
      varMeanG += c[1];
      varMeanB += c[2];
    }
    varMeanR /= n;
    varMeanG /= n;
    varMeanB /= n;
    let variance = 0;
    for (const c of changedColors) {
      variance +=
        (c[0] - varMeanR) ** 2 + (c[1] - varMeanG) ** 2 + (c[2] - varMeanB) ** 2;
    }
    variance /= n;
    const others = [];
    window.__boneMorph.getRoot().traverse((obj) => {
      if (!obj.isMesh || obj === mesh || !obj.userData?.bmAtlas) return;
      const a = obj.userData.bmAtlas;
      let changed = 0;
      const od = a.orig.data;
      const ld = a.live?.data || od;
      for (let i = 0; i < od.length; i += 4) {
        if (od[i] !== ld[i] || od[i + 1] !== ld[i + 1] || od[i + 2] !== ld[i + 2]) changed++;
      }
      others.push({ name: obj.name, changedPixels: changed });
    });
    let normalChanged = 0;
    const normalAtlas = mesh.userData?.bmNormalAtlas;
    if (normalAtlas) {
      const no = normalAtlas.orig.data;
      const nl = normalAtlas.live.data;
      for (let p = 0; p < geomMask.length; p++) {
        if (!geomMask[p]) continue;
        const di = p * 4;
        if (no[di] !== nl[di] || no[di + 1] !== nl[di + 1] || no[di + 2] !== nl[di + 2]) normalChanged++;
      }
    }
    return {
      ok: true,
      geomPx,
      synthChanged,
      geomUnchanged,
      outsideChanged,
      outlierCount,
      maxOutlier,
      foreignHueSpikes,
      variance,
      others,
      normalChanged,
      synthCount: st.islandTextureSynthCheckedCount,
    };
  }, pick.token);

  check("synth completed", after.ok && after.synthCount >= 1, JSON.stringify(after));
  check(
    "normal map fibers reshuffled (visible on colourcoded muscles)",
    after.normalChanged >= 2000,
    `normalChanged=${after.normalChanged}`
  );
  check(
    "refined synth region changed (not whole geometry island)",
    after.synthChanged >= 2000 && after.synthChanged < after.geomPx * 0.85,
    `changed=${after.synthChanged} geom=${after.geomPx}`
  );
  check("no atlas leak outside refined mask", after.outsideChanged === 0, `outside=${after.outsideChanged}`);
  check(
    "other meshes untouched",
    after.others.every((m) => m.changedPixels === 0),
    JSON.stringify(after.others)
  );
  check(
    "no saturated foreign hue spikes in changed pixels",
    after.foreignHueSpikes < 40,
    `spikes=${after.foreignHueSpikes}`
  );

  const hash1 = await page.evaluate((token) => {
    const parsed = token.split("::");
    let mesh = null;
    window.__boneMorph.getRoot().traverse((o) => {
      if (o.isMesh && o.name === parsed[0]) mesh = o;
    });
    const atlas = mesh.userData.bmAtlas;
    const geomMask = atlas.masks[parsed[1]];
    const d = atlas.live.data;
    const o = atlas.orig.data;
    let h = 0;
    for (let p = 0; p < geomMask.length; p++) {
      if (!geomMask[p]) continue;
      const i = p * 4;
      if (o[i] === d[i] && o[i + 1] === d[i + 1] && o[i + 2] === d[i + 2]) continue;
      h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) | 0;
    }
    return h;
  }, pick.token);

  await page.evaluate(() => {
    window.__boneMorph.setIslandTextureSynthParams({ seed: 9999 });
    return window.__boneMorph.runIslandTextureSynth();
  });
  await page.waitForFunction(
    () => !window.__boneMorph.getState().islandTextureSynthBusy,
    { timeout: 120000 }
  );

  const hash2 = await page.evaluate((token) => {
    const parsed = token.split("::");
    let mesh = null;
    window.__boneMorph.getRoot().traverse((o) => {
      if (o.isMesh && o.name === parsed[0]) mesh = o;
    });
    const atlas = mesh.userData.bmAtlas;
    const geomMask = atlas.masks[parsed[1]];
    const d = atlas.live.data;
    const o = atlas.orig.data;
    let h = 0;
    for (let p = 0; p < geomMask.length; p++) {
      if (!geomMask[p]) continue;
      const i = p * 4;
      if (o[i] === d[i] && o[i + 1] === d[i + 1] && o[i + 2] === d[i + 2]) continue;
      h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) | 0;
    }
    return h;
  }, pick.token);

  check(
    "different seed reorders stripe pattern",
    hash1 !== hash2,
    `h1=${hash1} h2=${hash2}`
  );

  const shot = path.join(outDir, "viewport.png");
  await page.screenshot({ path: shot, fullPage: false });
  fs.writeFileSync(path.join(outDir, "checks.json"), JSON.stringify(checks, null, 2));
  await browser.close();

  const failed = checks.filter((c) => !c.ok);
  if (failed.length) {
    console.error("FAILED", failed);
    process.exit(1);
  }
  console.log("OK", outDir);
})();
