/**
 * Probe: do temporalis/masseter albedo have stripe variation to shuffle?
 * Run: BASE_URL=http://127.0.0.1:8765 node scripts/bone-morph-texture-stripe-probe.js
 */
const { chromium } = require("playwright");

const BASE = process.env.BASE_URL || "http://127.0.0.1:8765";

function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  const l = (mx + mn) / 2;
  if (d < 1e-6) return { h: 0, s: 0, l };
  let h;
  if (mx === r) h = ((g - b) / d) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: (((h * 60) % 360) + 360) % 360, s: l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn), l };
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--ignore-gpu-blocklist"],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 960 } });
  await page.goto(`${BASE}/?_=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 120000 });

  await page.waitForFunction(
    () => {
      const sel = document.querySelector("#projectSelect");
      return sel && (sel.value || /暂无工程/.test(sel.options[0]?.textContent || ""));
    },
    { timeout: 60000 }
  );
  const hasProject = await page.evaluate(() => !!document.querySelector("#projectSelect")?.value);
  if (!hasProject) {
    await page.click("#btnNewFromEuro");
    await page.waitForFunction(() => !!document.querySelector("#projectSelect")?.value, {
      timeout: 180000,
    });
  }
  await page.waitForFunction(() => window.__boneMorph?.getState?.()?.islandScanDone === true, {
    timeout: 180000,
  });

  const report = await page.evaluate(() => {
    function islandStats(mesh, regionId) {
      const atlas = mesh.userData?.bmAtlas;
      const isl = (mesh.userData.bmIslands || []).find((x) => x.regionId === regionId);
      if (!atlas || !isl) return null;
      const mask = isl.mask;
      const o = atlas.orig.data;
      let n = 0;
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let minL = 1;
      let maxL = 0;
      let hueSpread = 0;
      const hues = [];
      let neighborContrast = 0;
      let neighborN = 0;
      const w = atlas.w;
      for (let p = 0; p < mask.length; p++) {
        if (!mask[p]) continue;
        const i = p * 4;
        const r = o[i];
        const g = o[i + 1];
        const b = o[i + 2];
        sumR += r;
        sumG += g;
        sumB += b;
        n++;
        const hsl = (() => {
          const rr = r / 255;
          const gg = g / 255;
          const bb = b / 255;
          const mx = Math.max(rr, gg, bb);
          const mn = Math.min(rr, gg, bb);
          const d = mx - mn;
          const l = (mx + mn) / 2;
          if (d < 1e-6) return { h: 0, s: 0, l };
          let h;
          if (mx === rr) h = ((gg - bb) / d) % 6;
          else if (mx === gg) h = (bb - rr) / d + 2;
          else h = (rr - gg) / d + 4;
          return { h: (((h * 60) % 360) + 360) % 360, s: l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn), l };
        })();
        minL = Math.min(minL, hsl.l);
        maxL = Math.max(maxL, hsl.l);
        hues.push(hsl.h);
        const x = p % w;
        const y = (p / w) | 0;
        if (x + 1 < w && mask[p + 1]) {
          const j = (p + 1) * 4;
          neighborContrast +=
            Math.abs(r - o[j]) + Math.abs(g - o[j + 1]) + Math.abs(b - o[j + 2]);
          neighborN++;
        }
      }
      if (n > 1) {
        const meanH = hues.reduce((a, b) => a + b, 0) / hues.length;
        hueSpread = Math.sqrt(hues.reduce((s, h) => s + (h - meanH) ** 2, 0) / hues.length);
      }
      const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      return {
        regionId,
        label: isl.label,
        previewHex: isl.previewHex,
        pixels: n,
        meanRgb: [Math.round(sumR / n), Math.round(sumG / n), Math.round(sumB / n)],
        lightnessRange: [minL, maxL],
        lightnessSpan: maxL - minL,
        hueSpreadDeg: hueSpread,
        avgNeighborContrast: neighborN ? neighborContrast / neighborN : 0,
        hasNormalMap: !!mat?.normalMap,
        hasRoughnessMap: !!mat?.roughnessMap,
        hasBumpMap: !!mat?.bumpMap,
        mapSize: atlas.w + "x" + atlas.h,
      };
    }

    let deform = null;
    window.__boneMorph.getRoot().traverse((o) => {
      if (o.isMesh && /deform/i.test(o.name || "") && o.userData?.bmAtlas) deform = o;
    });
    if (!deform) return { ok: false, reason: "no deform mesh" };

    const islands = deform.userData.bmIslands || [];
    const temporalis = islands.find((x) => x.previewHex === "#81c490" || x.regionId === "gi_18");
    const masseter = islands.find((x) => {
      const [r, g, b] = x.seedRgb || [0, 0, 0];
      return r > 140 && g < 110 && b < 110;
    });
    const grayNeck = islands
      .filter((x) => {
        const [r, g, b] = x.seedRgb || [0, 0, 0];
        const rr = r / 255;
        const gg = g / 255;
        const bb = b / 255;
        const mx = Math.max(rr, gg, bb);
        const mn = Math.min(rr, gg, bb);
        const d = mx - mn;
        const l = (mx + mn) / 2;
        const s = d < 1e-6 ? 0 : l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
        return s < 0.15 && l > 0.45 && l < 0.75 && x.pixelCount > 30000;
      })
      .sort((a, b) => b.pixelCount - a.pixelCount)[0];

    function mapNeighborContrast(atlas, mask) {
      if (!atlas) return 0;
      const o = atlas.orig.data;
      const w = atlas.w;
      let sum = 0;
      let n = 0;
      for (let p = 0; p < mask.length; p++) {
        if (!mask[p] || (p + 1) % w === 0 || !mask[p + 1]) continue;
        const i = p * 4;
        const j = (p + 1) * 4;
        sum += Math.abs(o[i] - o[j]) + Math.abs(o[i + 1] - o[j + 1]) + Math.abs(o[i + 2] - o[j + 2]);
        n++;
      }
      return n ? sum / n : 0;
    }

    return {
      ok: true,
      mesh: deform.name,
      temporalis: temporalis
        ? {
            ...islandStats(deform, temporalis.regionId),
            normalNeighborContrast: mapNeighborContrast(
              deform.userData.bmNormalAtlas,
              temporalis.mask
            ),
          }
        : null,
      masseter: masseter ? islandStats(deform, masseter.regionId) : null,
      grayNeck: grayNeck ? islandStats(deform, grayNeck.regionId) : null,
      coloredSamples: islands
        .filter((x) => x.pixelCount > 5000)
        .slice(0, 8)
        .map((x) => ({
          regionId: x.regionId,
          previewHex: x.previewHex,
          label: x.label,
        })),
    };
  });

  console.log(JSON.stringify(report, null, 2));
  await browser.close();
})();
