/**
 * Raycast forehead / galea / neck to see which mesh+atlas color is drawn.
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const RUNS = path.resolve(__dirname, "../runs");
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outDir = path.join(RUNS, `${stamp}-raycast-color`);
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

  // frontal
  const frontBtn = page.locator("#viewerHostMorph button", { hasText: "前" });
  if (await frontBtn.count()) {
    await frontBtn.first().click().catch(() => {});
    await page.waitForTimeout(400);
  }

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

  const result = await page.evaluate(() => {
    const bm = window.__boneMorph;
    // Find camera + THREE from morph viewer internals
    const host = document.getElementById("viewerHostMorph");
    const canvas = host?.querySelector("canvas");
    if (!canvas) return { err: "no canvas" };

    // Prefer exposed debug helpers
    const dbg = bm.debugRayMeshes
      ? null
      : null;
    void dbg;

    // Walk closed-over scene via mesh parents
    const root = bm.getRoot();
    let camera = null;
    // Search typical attachments
    let obj = root;
    while (obj) {
      if (obj.isCamera) {
        camera = obj;
        break;
      }
      obj = obj.parent;
    }
    // Fallback: find PerspectiveCamera in scene graph siblings
    if (!camera && root.parent) {
      root.parent.traverse((o) => {
        if (o.isPerspectiveCamera) camera = o;
      });
    }
    if (!camera) {
      // try window.__morphView or similar
      const keys = Object.keys(window).filter((k) => /morph|viewer|three/i.test(k));
      return { err: "no camera", keys, rootParent: root.parent?.type };
    }

    // Need THREE.Raycaster — from mesh constructor
    const T = root.userData?.THREE || window.THREE;
    // Get Raycaster from any mesh's geometry type chain — use bm if exported
    let Raycaster = window.THREE?.Raycaster;
    let Vector2 = window.THREE?.Vector2;
    if (!Raycaster) {
      // steal from prototype chain by creating via eval in module — not available
      return { err: "no THREE global", cameraOk: !!camera };
    }

    const rect = canvas.getBoundingClientRect();
    function hit(nx, ny, label) {
      const mouse = new Vector2(nx * 2 - 1, -(ny * 2 - 1));
      const raycaster = new Raycaster();
      raycaster.setFromCamera(mouse, camera);
      const meshes = [];
      root.traverse((o) => {
        if (o.isMesh && o.visible) meshes.push(o);
      });
      // include transparent: fire all
      raycaster.layers.enableAll?.();
      const hits = raycaster.intersectObjects(meshes, false);
      const out = [];
      for (const h of hits.slice(0, 6)) {
        const mesh = h.object;
        const atlas = mesh.userData?.bmAtlas;
        let atlasRgb = null;
        let origRgb = null;
        if (atlas && h.uv) {
          const u = h.uv.x;
          const v = h.uv.y;
          const flipY = !!atlas.tex.flipY;
          const x = Math.min(atlas.w - 1, Math.max(0, Math.floor(u * atlas.w)));
          const y = Math.min(
            atlas.h - 1,
            Math.max(0, Math.floor((flipY ? 1 - v : v) * atlas.h))
          );
          const i = (y * atlas.w + x) * 4;
          const cur = atlas.ctx.getImageData(x, y, 1, 1).data;
          atlasRgb = [cur[0], cur[1], cur[2], cur[3]];
          origRgb = [
            atlas.orig.data[i],
            atlas.orig.data[i + 1],
            atlas.orig.data[i + 2],
            atlas.orig.data[i + 3],
          ];
        }
        out.push({
          label,
          mesh: mesh.name,
          dist: h.distance,
          uv: h.uv ? [h.uv.x, h.uv.y] : null,
          atlasRgb,
          origRgb,
          transparent: !!(Array.isArray(mesh.material)
            ? mesh.material[0]
            : mesh.material
          )?.transparent,
          depthWrite: (Array.isArray(mesh.material)
            ? mesh.material[0]
            : mesh.material
          )?.depthWrite,
        });
      }
      return out;
    }

    return {
      camera: camera.type,
      foreheadL: hit(0.42, 0.22, "foreheadL"),
      foreheadC: hit(0.5, 0.2, "foreheadC"),
      foreheadR: hit(0.58, 0.22, "foreheadR"),
      crown: hit(0.5, 0.08, "crown"),
      temple: hit(0.72, 0.38, "temple"),
      neck: hit(0.5, 0.75, "neck"),
    };
  });

  // If no THREE, inject raycast via bone_morph debug API — add later
  fs.writeFileSync(path.join(outDir, "ray.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await page.locator("#viewerHostMorph").screenshot({
    path: path.join(outDir, "viewer.png"),
  });
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
