/**
 * Selftest: Plastyma (颈阔肌) whole fibrous sheet pick + HSL.
 * Run: BASE_URL=http://127.0.0.1:8765 node scripts/bone-morph-plastyma-sheet.js
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const BASE = process.env.BASE_URL || "http://127.0.0.1:8765";
const outDir = path.join(
  __dirname,
  "..",
  "runs",
  `${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}-morph-plastyma-sheet`
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
    timeout: 60000,
  });
  await page.click("[data-mode=morph]");
  await page.waitForFunction(
    () =>
      !!window.__boneMorph &&
      (document.getElementById("viewerStatusMorph")?.textContent || "").includes(
        "骨相拧形"
      ),
    { timeout: 180000 }
  );
  await page.waitForTimeout(800);

  const canvas = page.locator("#viewerHostMorph canvas");
  const front = page.locator("#viewerHostMorph button", { hasText: "前" });
  if (await front.count()) await front.first().click().catch(() => {});
  await page.waitForTimeout(350);
  const box = await canvas.boundingBox();
  // look down at neck
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.45);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.22, {
    steps: 12,
  });
  await page.mouse.up();
  await page.waitForTimeout(350);

  const probe = await page.evaluate(() => {
    const bm = window.__boneMorph;
    let best = null;
    for (const [nx, ny] of [
      [0.45, 0.72],
      [0.55, 0.72],
      [0.5, 0.7],
      [0.5, 0.75],
      [0.42, 0.7],
      [0.58, 0.7],
    ]) {
      const r = bm.debugFloodPickAtNdc(nx, ny);
      if (!r?.best) continue;
      const score =
        (/plasty/i.test(r.best.mesh) ? 1e6 : 0) + (r.best.px || 0);
      if (!best || score > best._s) best = { ...r.best, nx, ny, _s: score };
    }
    return best;
  });
  console.log("plastymaProbe", JSON.stringify(probe, null, 2));
  check(
    "neck pick is Plastyma whole sheet",
    !!(
      probe &&
      /plasty/i.test(probe.mesh) &&
      probe.regionId === "cq_plastyma_sheet" &&
      probe.px >= 800000
    ),
    JSON.stringify({
      mesh: probe?.mesh,
      id: probe?.regionId,
      label: probe?.partLabel,
      px: probe?.px,
    })
  );

  await page.click("#morphPickMesh");
  await page.waitForTimeout(80);
  const pt = probe || { nx: 0.5, ny: 0.72 };
  await page.mouse.click(box.x + box.width * pt.nx, box.y + box.height * pt.ny);
  await page.waitForTimeout(450);
  const afterPick = await page.evaluate(() => {
    const st = window.__boneMorph.getState();
    return {
      key: st.selectedMeshKey,
      region: st.selectedRegionKey,
      label: st.selectedPartLabel,
      px: st.selectedRegionPixels,
      scope: st.hslScope,
    };
  });
  check(
    "UI selects 颈阔肌 sheet (>=800k px)",
    !!(
      afterPick.region === "cq_plastyma_sheet" &&
      afterPick.label === "颈阔肌" &&
      afterPick.px >= 800000
    ),
    JSON.stringify(afterPick)
  );

  const beforePath = path.join(outDir, "01-plastyma-before.png");
  await canvas.screenshot({ path: beforePath });
  await page.evaluate(() => {
    const set = (id, v) => {
      const el = document.getElementById(id);
      el.value = String(v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    set("morphHslH", 120);
    set("morphHslS", 70);
    set("morphHslL", -15);
  });
  await page.waitForTimeout(550);
  const afterPath = path.join(outDir, "01-plastyma-hsl.png");
  await canvas.screenshot({ path: afterPath });

  const py = `
from PIL import Image
a=Image.open(r'''${beforePath.replace(/\\/g, "/")}''').convert('RGB')
b=Image.open(r'''${afterPath.replace(/\\/g, "/")}''').convert('RGB')
w,h=a.size
n=0; sx=0; sy=0
for y in range(int(0.55*h), int(0.92*h), 2):
  for x in range(int(0.28*w), int(0.72*w), 2):
    pa=a.getpixel((x,y)); pb=b.getpixel((x,y))
    if abs(pa[0]-pb[0])+abs(pa[1]-pb[1])+abs(pa[2]-pb[2])<50: continue
    # became greener / more saturated
    if pb[1]>pa[1]+15 and pb[1]>pb[0]+10:
      n+=1; sx+=x; sy+=y
print(n, round(sx/n/w,3) if n else 0, round(sy/n/h,3) if n else 0)
`;
  const out = spawnSync("python", ["-c", py], { encoding: "utf8" });
  const parts = (out.stdout || "").trim().split(/\s+/);
  const greenN = Number(parts[0] || 0);
  const cx = Number(parts[1] || 0);
  const cy = Number(parts[2] || 0);
  check(
    "plastyma screen pixels strongly recolor (neck band)",
    greenN >= 1200 && cy > 0.55,
    JSON.stringify({ greenN, cx, cy, pick: afterPick })
  );

  // coverage: sheet should be ~all non-black (~1M), not ~0.69M mid-gray only
  const cover = await page.evaluate(() => {
    const st = window.__boneMorph.getState();
    return { px: st.selectedRegionPixels, label: st.selectedPartLabel };
  });
  check(
    "sheet covers fibrous continuum (px>=900k)",
    cover.px >= 900000,
    JSON.stringify(cover)
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
