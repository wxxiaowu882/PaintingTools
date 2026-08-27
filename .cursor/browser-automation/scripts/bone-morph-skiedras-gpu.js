/**
 * Probe: Skiedras atlas after HSL vs GPU map wiring; dump atlas crops.
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const RUNS = path.resolve(__dirname, "../runs");
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outDir = path.join(RUNS, `${stamp}-skiedras-gpu`);
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
  await page.waitForTimeout(800);

  const info = await page.evaluate(() => {
    const root = window.__boneMorph.getRoot();
    let sk = null;
    let deform = null;
    root.traverse((o) => {
      if (!o.isMesh) return;
      if (/skiedras/i.test(o.name || "")) sk = o;
      if (/deform/i.test(o.name || "")) deform = o;
    });
    function analyze(mesh) {
      if (!mesh) return null;
      const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      const atlas = mesh.userData.bmAtlas;
      const map = mat?.map;
      const o = atlas.orig.data;
      const cur = atlas.ctx.getImageData(0, 0, atlas.w, atlas.h).data;
      let n = 0;
      let sr = 0,
        sg = 0,
        sb = 0;
      let cr = 0,
        cg = 0,
        cb = 0;
      let stillGreen = 0;
      const samples = [];
      for (let i = 0; i < o.length; i += 4) {
        const r = o[i],
          g = o[i + 1],
          b = o[i + 2];
        if (!(g > r + 20 && g > b + 10 && g > 100)) continue;
        n++;
        sr += r;
        sg += g;
        sb += b;
        cr += cur[i];
        cg += cur[i + 1];
        cb += cur[i + 2];
        if (cur[i + 1] > cur[i] + 20 && cur[i + 1] > cur[i + 2] + 10) stillGreen++;
        if (samples.length < 8) {
          samples.push({
            orig: [r, g, b],
            cur: [cur[i], cur[i + 1], cur[i + 2]],
          });
        }
      }
      return {
        name: mesh.name,
        visible: mesh.visible,
        renderOrder: mesh.renderOrder,
        mapIsAtlasTex: !!(map && atlas && map === atlas.tex),
        mapUuid: map?.uuid,
        atlasTexUuid: atlas?.tex?.uuid,
        needsUpdate: atlas?.tex?.needsUpdate,
        matType: mat?.type,
        matName: mat?.name,
        color: mat?.color?.getHexString?.(),
        transparent: mat?.transparent,
        opacity: mat?.opacity,
        depthWrite: mat?.depthWrite,
        depthTest: mat?.depthTest,
        greenCount: n,
        stillGreen,
        avgOrig: n ? [Math.round(sr / n), Math.round(sg / n), Math.round(sb / n)] : null,
        avgCur: n ? [Math.round(cr / n), Math.round(cg / n), Math.round(cb / n)] : null,
        samples,
        atlasSize: atlas ? [atlas.w, atlas.h] : null,
      };
    }
    return { skiedras: analyze(sk), deform: analyze(deform) };
  });

  // dump skiedras atlas PNG via toDataURL
  const dumps = await page.evaluate(() => {
    const root = window.__boneMorph.getRoot();
    const out = {};
    root.traverse((o) => {
      if (!o.isMesh || !o.userData?.bmAtlas) return;
      const n = o.name || "";
      if (!/skiedras|deform/i.test(n)) return;
      out[n] = o.userData.bmAtlas.canvas.toDataURL("image/png");
    });
    return out;
  });
  for (const [name, dataUrl] of Object.entries(dumps)) {
    const b64 = dataUrl.replace(/^data:image\/png;base64,/, "");
    const safe = name.replace(/[^\w.-]+/g, "_");
    fs.writeFileSync(path.join(outDir, `atlas-${safe}.png`), Buffer.from(b64, "base64"));
  }

  fs.writeFileSync(path.join(outDir, "info.json"), JSON.stringify(info, null, 2));
  await page.locator("#viewerHostMorph").screenshot({
    path: path.join(outDir, "viewer.png"),
  });
  console.log(JSON.stringify(info, null, 2));
  await browser.close();
  console.log("wrote", outDir);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
