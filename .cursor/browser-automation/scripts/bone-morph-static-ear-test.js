/**
 * Static 耳软骨整耳设色自测
 * Run: node scripts/bone-morph-static-ear-test.js
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE = process.env.BASE_URL || "http://127.0.0.1:8765";
const outDir = path.join(
  __dirname,
  "..",
  "runs",
  `${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}-static-ear`
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
  await page.goto(`${BASE}/?_=${Date.now()}`, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForFunction(
    () =>
      !!window.__boneMorph &&
      (document.getElementById("viewerStatus")?.textContent || "").includes("拧形"),
    { timeout: 180000 }
  );
  await page.waitForTimeout(800);

  const canvas = page.locator("#viewerHost canvas");
  const box = await canvas.boundingBox();
  // side view for ear
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.22, box.y + box.height * 0.4, { steps: 14 });
  await page.mouse.up();
  await page.waitForTimeout(400);

  const earProbe = await page.evaluate(() => {
    const bm = window.__boneMorph;
    let best = null;
    for (let x = 0.58; x <= 0.72; x += 0.02) {
      for (let y = 0.38; y <= 0.54; y += 0.02) {
        const r = bm.debugFloodPickAtNdc(x, y);
        if (!r?.best?.earGeometry) continue;
        const b = r.best;
        if (!/static|deform/i.test(b.mesh)) continue;
        let score = b.px;
        if (b.partLabel === "整耳") score *= 2;
        if (b.px < 18000) score *= 0.2;
        if (b.px > 65000) score *= 0.1;
        if (!best || score > best._s) best = { ...b, nx: x, ny: y, _s: score };
      }
    }
    return best;
  });
  console.log("earProbe", JSON.stringify(earProbe, null, 2));

  check(
    "Static ear pickable with large mask",
    !!(earProbe && earProbe.px >= 18000 && earProbe.px <= 65000 && earProbe.earGeometry),
    JSON.stringify({
      mesh: earProbe?.mesh,
      px: earProbe?.px,
      hex: earProbe?.hex,
      label: earProbe?.partLabel,
      regionId: earProbe?.regionId,
    })
  );

  const pt = earProbe || { nx: 0.64, ny: 0.48 };
  await page.keyboard.down("Alt");
  await page.mouse.click(box.x + box.width * pt.nx, box.y + box.height * pt.ny);
  await page.keyboard.up("Alt");
  await page.waitForTimeout(450);

  const afterPick = await page.evaluate(() => {
    const st = window.__boneMorph.getState();
    return {
      key: st.selectedMeshKey,
      region: st.selectedRegionKey,
      px: st.selectedRegionPixels,
      hex: st.selectedRegionHex,
      label: st.selectedPartLabel,
      scope: st.hslScope,
    };
  });
  check(
    "Alt+click selects whole ear (Static+Deform companions)",
    !!(
      afterPick.key?.toLowerCase().includes("static") &&
      afterPick.px >= 18000 &&
      afterPick.px <= 65000 &&
      afterPick.label === "整耳"
    ),
    JSON.stringify(afterPick)
  );

  const paintStats = await page.evaluate(() => {
    const r = window.__boneMorph.setScopeHsl(24 / 360, 0.64, 0, { notify: true, immediate: true });
    const countMesh = (substr) => {
      let n = 0;
      const root = window.__boneMorph.getRoot();
      let mesh = null;
      root.traverse((o) => {
        if (o.isMesh && o.name.toLowerCase().includes(substr)) mesh = o;
      });
      const atlas = mesh?.userData?.bmAtlas;
      if (!atlas) return 0;
      const o = atlas.orig.data;
      const d = atlas.ctx.getImageData(0, 0, atlas.w, atlas.h).data;
      for (let i = 0; i < o.length; i += 4) {
        if (Math.abs(o[i] - d[i]) + Math.abs(o[i + 1] - d[i + 1]) + Math.abs(o[i + 2] - d[i + 2]) > 25) n++;
      }
      return n;
    };
    return {
      applyOk: r?.ok,
      staticN: countMesh("static"),
      deformN: countMesh("deform"),
      meshColors: Object.keys(window.__boneMorph.getState().meshColors || {}),
    };
  });
  check(
    "HSL paints both Static and Deform ear layers",
    !!(
      paintStats.applyOk &&
      paintStats.staticN >= 10000 &&
      paintStats.deformN >= 8000 &&
      paintStats.meshColors.length >= 2
    ),
    JSON.stringify(paintStats)
  );

  const beforePath = path.join(outDir, "01-ear-before.png");
  await canvas.screenshot({ path: beforePath });
  await page.waitForTimeout(300);
  const afterPath = path.join(outDir, "02-ear-orange.png");
  await canvas.screenshot({ path: afterPath });

  const report = { ok: checks.every((c) => c.ok), checks, outDir, earProbe, afterPick };
  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(report.ok ? "OK" : "FAIL", outDir);
  await browser.close();
  process.exit(report.ok ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
