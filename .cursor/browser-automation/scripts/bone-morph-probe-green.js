/**
 * Probe which meshes still hold green / mid-gray after muscles HSL.
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const RUNS = path.resolve(__dirname, "../runs");
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outDir = path.join(RUNS, `${stamp}-morph-probe-green`);
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

  await page.click("#morphHslScopeMuscles");
  await page.evaluate(() => {
    const set = (id, v) => {
      const el = document.getElementById(id);
      el.value = String(v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    set("morphHslH", -85);
    set("morphHslS", 25);
    set("morphHslL", -30);
  });
  await page.waitForTimeout(700);

  const probe = await page.evaluate(() => {
    const bm = window.__boneMorph;
    const root = bm.getRoot();
    const meshes = [];
    root.traverse((o) => {
      if (!o.isMesh) return;
      const n = o.name || "(unnamed)";
      const mat = Array.isArray(o.material) ? o.material[0] : o.material;
      const atlas = o.userData?.bmAtlas;
      const entry = {
        name: n,
        visible: o.visible,
        hasMap: !!(mat && mat.map),
        hasAtlas: !!atlas,
        muscleLike: /deform|static|plasty|acs|skiedras/i.test(n),
        matColor: mat?.color ? mat.color.getHexString() : null,
      };
      if (atlas) {
        const odat = atlas.orig.data;
        const cur = atlas.ctx.getImageData(0, 0, atlas.w, atlas.h).data;
        let greenOrig = 0;
        let greenCur = 0;
        let creamOrig = 0;
        let creamCurSame = 0;
        let midGrayOrig = 0;
        let midGrayChanged = 0;
        let paleOrig = 0;
        let paleChanged = 0;
        for (let i = 0; i < odat.length; i += 4) {
          const r = odat[i];
          const g = odat[i + 1];
          const b = odat[i + 2];
          if (r + g + b < 12) continue;
          const isGreen = g > r + 20 && g > b + 10 && g > 100;
          const isCream = r > 240 && g > 230 && b < 220 && b < g - 20;
          const mx = Math.max(r, g, b);
          const mn = Math.min(r, g, b);
          const isMidGray = mx - mn < 20 && mx > 140 && mx < 200;
          const isPale = mx > 200 && mx - mn < 35;
          const changed =
            cur[i] !== r || cur[i + 1] !== g || cur[i + 2] !== b;
          if (isGreen) {
            greenOrig++;
            if (cur[i + 1] > cur[i] + 20 && cur[i + 1] > cur[i + 2] + 10)
              greenCur++;
          }
          if (isCream) {
            creamOrig++;
            if (!changed) creamCurSame++;
          }
          if (isMidGray) {
            midGrayOrig++;
            if (changed) midGrayChanged++;
          }
          if (isPale) {
            paleOrig++;
            if (changed) paleChanged++;
          }
        }
        entry.stats = {
          greenOrig,
          greenCurStillGreen: greenCur,
          creamOrig,
          creamFrozen: creamCurSame,
          midGrayOrig,
          midGrayChanged,
          paleOrig,
          paleChanged,
        };
      }
      meshes.push(entry);
    });
    return {
      scope: bm.getState().hslScope,
      regionHsl: bm.getState().regionHsl,
      meshes,
    };
  });

  fs.writeFileSync(
    path.join(outDir, "probe.json"),
    JSON.stringify(probe, null, 2)
  );
  console.log(JSON.stringify(probe, null, 2));
  await page.locator("#viewerHostMorph").screenshot({
    path: path.join(outDir, "viewer.png"),
  });
  await browser.close();
  console.log("wrote", outDir);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
