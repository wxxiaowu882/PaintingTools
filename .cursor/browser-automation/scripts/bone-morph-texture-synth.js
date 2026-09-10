/**
 * Selftest: island texture synthesis (image quilting).
 * Run: BASE_URL=http://127.0.0.1:8765 node scripts/bone-morph-texture-synth.js
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE = process.env.BASE_URL || "http://127.0.0.1:8765";
const outDir = path.join(
  __dirname,
  "..",
  "runs",
  `${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}-morph-texture-synth`
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

  await page.waitForFunction(() => !!window.__boneMorph?.getRoot?.(), {
    timeout: 180000,
  });
  await page.waitForFunction(
    () => window.__boneMorph?.getState?.()?.islandScanDone === true,
    { timeout: 180000 }
  );
  await page.click('[data-morph-tab="color"]');
  await page.waitForTimeout(300);

  const st0 = await page.evaluate(() => window.__boneMorph.getState());
  check(
    "build id includes texture-synth",
    /texture-synth/i.test(st0.buildId || ""),
    st0.buildId
  );
  check(
    "texture synth params present",
    st0.islandTextureSynthParams && typeof st0.islandTextureSynthParams.seed === "number",
    JSON.stringify(st0.islandTextureSynthParams)
  );

  const pick = await page.evaluate(() => {
    const st = window.__boneMorph.getState();
    for (const g of st.colorIslandGroups || []) {
      const key = `${g.meshKey || ""} ${g.meshRawName || ""}`.toLowerCase();
      if (!/deform|变形/.test(key)) continue;
      const gi18 = (g.islands || []).find((isl) => isl.regionId === "gi_18");
      if (gi18) return gi18;
    }
    let best = null;
    let bestScore = -1;
    for (const g of st.colorIslandGroups || []) {
      const key = `${g.meshKey || ""} ${g.meshRawName || ""}`.toLowerCase();
      if (!/deform|变形/.test(key)) continue;
      for (const isl of g.islands || []) {
        if (isl.pixelCount < 8000) continue;
        const hex = (isl.previewHex || "#808080").replace("#", "");
        const r = parseInt(hex.slice(0, 2), 16) / 255;
        const gch = parseInt(hex.slice(2, 4), 16) / 255;
        const b = parseInt(hex.slice(4, 6), 16) / 255;
        const sat = Math.max(r, gch, b) - Math.min(r, gch, b);
        const score = isl.pixelCount * (0.2 + sat * 3);
        if (score > bestScore) {
          bestScore = score;
          best = isl;
        }
      }
    }
    return best;
  });
  check("found large deform island for synth", !!pick, JSON.stringify(pick));

  await page.evaluate((token) => {
    window.__boneMorph.clearIslandTextureSynth?.();
    window.__boneMorph.setIslandChecked([token]);
    window.__boneMorph.setHslScope("parts");
    window.__boneMorph.setIslandTextureSynthParams({
      seed: 77,
      similarity: 0.72,
      blockScale: 22,
    });
  }, pick.token);

  await page.evaluate(() => window.__boneMorph.runIslandTextureSynth());
  await page.waitForFunction(
    () => !window.__boneMorph.getState().islandTextureSynthBusy,
    { timeout: 120000 }
  );
  await page.waitForTimeout(400);

  const samplePixels = await page.evaluate((token) => {
    const st = window.__boneMorph.getState();
    const parsed = token.split("::");
    const meshKey = parsed[0];
    const regionId = parsed[1];
    let mesh = null;
    window.__boneMorph.getRoot().traverse((o) => {
      if (o.isMesh && (o.name === meshKey || o.uuid === meshKey)) mesh = o;
    });
    if (!mesh) {
      window.__boneMorph.getRoot().traverse((o) => {
        if (o.isMesh && o.userData?.bmAtlas) {
          const mk = o.name || o.uuid;
          if (mk === meshKey) mesh = o;
        }
      });
    }
    const atlas = mesh?.userData?.bmAtlas;
    if (!atlas) return { ok: false, reason: "no atlas" };
    const isl = (mesh.userData.bmIslands || []).find((x) => x.regionId === regionId);
    const mask = isl?.mask;
    if (!mask) return { ok: false, reason: "no mask" };
    const inside = [];
    const outside = [];
    const orig = atlas.orig.data;
    const live = atlas.live?.data || orig;
    for (let p = 0; p < mask.length; p++) {
      if (!mask[p]) {
        if (outside.length < 8) {
          const i = p * 4;
          outside.push([live[i], live[i + 1], live[i + 2]]);
        }
        continue;
      }
      if (inside.length < 32) {
        const i = p * 4;
        inside.push({
          orig: [orig[i], orig[i + 1], orig[i + 2]],
          live: [live[i], live[i + 1], live[i + 2]],
        });
      }
    }
    return { ok: true, insideCount: inside.length, outsideCount: outside.length, inside, outside };
  }, pick.token);
  check("sampled mask pixels", samplePixels.ok, JSON.stringify(samplePixels));

  const afterSynth = await page.evaluate((token) => {
    const st = window.__boneMorph.getState();
    const parsed = token.split("::");
    const meshKey = parsed[0];
    const regionId = parsed[1];
    let mesh = null;
    window.__boneMorph.getRoot().traverse((o) => {
      if (o.isMesh && (o.name === meshKey || o.uuid === meshKey)) mesh = o;
    });
    const atlas = mesh?.userData?.bmAtlas;
    const isl = (mesh.userData.bmIslands || []).find((x) => x.regionId === regionId);
    const geomMask = isl?.mask;
    if (!geomMask) return { ok: false, reason: "no mask" };
    const orig = atlas.orig.data;
    const live = atlas.live.data;
    let insideDiff = 0;
    let insideSame = 0;
    let outsideDiff = 0;
    for (let p = 0; p < geomMask.length; p++) {
      const i = p * 4;
      const od =
        Math.abs(orig[i] - live[i]) +
        Math.abs(orig[i + 1] - live[i + 1]) +
        Math.abs(orig[i + 2] - live[i + 2]);
      if (geomMask[p]) {
        if (od > 0) insideDiff++;
        else insideSame++;
      } else if (od > 0) outsideDiff++;
    }
    return {
      synthCount: st.islandTextureSynthCount,
      checkedSynth: st.islandTextureSynthCheckedCount,
      insideDiff,
      insideSame,
      outsideDiff,
      busy: st.islandTextureSynthBusy,
    };
  }, pick.token);

  check("synth completed not busy", !afterSynth.busy, JSON.stringify(afterSynth));
  check(
    "island texture synth cache populated",
    afterSynth.synthCount >= 1,
    `count=${afterSynth.synthCount}`
  );
  check(
    "inside mask pixels changed from orig",
    afterSynth.insideDiff >= 500,
    `insideDiff=${afterSynth.insideDiff} insideSame=${afterSynth.insideSame}`
  );
  check(
    "outside geometry island unchanged",
    afterSynth.outsideDiff === 0,
    `outsideDiff=${afterSynth.outsideDiff}`
  );

  const seed1 = await page.evaluate(() => {
    window.__boneMorph.setIslandTextureSynthParams({ seed: 11111 });
    return window.__boneMorph.runIslandTextureSynth();
  });
  await page.waitForFunction(
    () => !window.__boneMorph.getState().islandTextureSynthBusy,
    { timeout: 120000 }
  );

  const hash1 = await page.evaluate((token) => {
    const parsed = token.split("::");
    let mesh = null;
    window.__boneMorph.getRoot().traverse((o) => {
      if (o.isMesh && o.name === parsed[0]) mesh = o;
    });
    const atlas = mesh.userData.bmAtlas;
    const isl = mesh.userData.bmIslands.find((x) => x.regionId === parsed[1]);
    const geomMask = isl.mask;
    let h = 0;
    const d = atlas.live.data;
    const o = atlas.orig.data;
    for (let p = 0; p < geomMask.length; p++) {
      if (!geomMask[p]) continue;
      const i = p * 4;
      if (o[i] === d[i] && o[i + 1] === d[i + 1] && o[i + 2] === d[i + 2]) continue;
      h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) | 0;
    }
    return h;
  }, pick.token);

  await page.evaluate(() => {
    window.__boneMorph.setIslandTextureSynthParams({ seed: 22222 });
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
    const isl = mesh.userData.bmIslands.find((x) => x.regionId === parsed[1]);
    const geomMask = isl.mask;
    let h = 0;
    const d = atlas.live.data;
    const o = atlas.orig.data;
    for (let p = 0; p < geomMask.length; p++) {
      if (!geomMask[p]) continue;
      const i = p * 4;
      if (o[i] === d[i] && o[i + 1] === d[i + 1] && o[i + 2] === d[i + 2]) continue;
      h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) | 0;
    }
    return h;
  }, pick.token);

  check(
    "different seed produces different inside hash",
    hash1 !== hash2,
    `h1=${hash1} h2=${hash2} run1=${JSON.stringify(seed1?.done?.length)}`
  );

  check(
    "texture synth UI controls exist",
    await page.evaluate(() => {
      return !!(
        document.getElementById("islandTextureReroll") &&
        document.getElementById("islandTextureSimilarity") &&
        document.getElementById("islandTextureBlockScale")
      );
    }),
    ""
  );

  const report = { ok: checks.every((c) => c.ok), checks, outDir };
  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(report.ok ? "OK" : "FAIL", outDir);
  await browser.close();
  process.exit(report.ok ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
