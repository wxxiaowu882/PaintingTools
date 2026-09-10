/**
 * Selftest: 3D geometry-island coloring + HSL.
 * Run: BASE_URL=http://127.0.0.1:8765 node scripts/bone-morph-semantic-parts.js
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
  `${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}-morph-geom-islands`
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
  } else {
    const cur = await page.evaluate(() => document.querySelector("#projectSelect")?.value || "");
    if (!cur) {
      await page.selectOption("#projectSelect", { index: 0 });
    }
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
    "build id is geom-islands tree",
    /geom-island/i.test(st0.buildId || ""),
    st0.buildId
  );
  check(
    "island scan produced groups",
    (st0.colorIslandGroups || []).length >= 1,
    `groups=${(st0.colorIslandGroups || []).length}`
  );
  const totalIslands = (st0.colorIslandGroups || []).reduce(
    (n, g) => n + (g.islands || []).length,
    0
  );
  check("has geometry islands on model", totalIslands >= 1, `islands=${totalIslands}`);
  const hasGeomLabel = (st0.colorIslandGroups || []).some((g) =>
    (g.islands || []).some((isl) => /几何孤岛|gi_/.test(`${isl.label || ""}${isl.regionId || ""}`))
  );
  check("island labels look like geometry islands", hasGeomLabel, `total=${totalIslands}`);

  await page.evaluate(() => {
    const st = window.__boneMorph.getState();
    const g = st.colorIslandGroups?.[0];
    const isl = g?.islands?.[0];
    if (isl?.token) window.__boneMorph.flashIsland(isl.token);
  });
  await page.waitForTimeout(120);
  const flashMid = await page.evaluate(() => {
    const token = window.__boneMorph.getState().islandHighlightToken;
    let overlay = false;
    window.__boneMorph.getRoot()?.traverse((o) => {
      if (o.name === "__bm_island_highlight") overlay = true;
    });
    return { token, overlay };
  });
  check("flash island active mid-animation", !!flashMid.token && flashMid.overlay, JSON.stringify(flashMid));
  await page.waitForTimeout(700);
  const flashEnd = await page.evaluate(() => {
    const token = window.__boneMorph.getState().islandHighlightToken;
    let overlay = false;
    window.__boneMorph.getRoot()?.traverse((o) => {
      if (o.name === "__bm_island_highlight") overlay = true;
    });
    return { token, overlay };
  });
  check("flash island clears after timeout", !flashEnd.token && !flashEnd.overlay, JSON.stringify(flashEnd));

  const pick = await page.evaluate(() => {
    const st = window.__boneMorph.getState();
    let best = null;
    for (const g of st.colorIslandGroups || []) {
      const key = `${g.meshKey || ""} ${g.meshRawName || ""} ${g.meshLabel || ""}`.toLowerCase();
      if (!/deform|static|变形|静态/.test(key)) continue;
      for (const isl of g.islands || []) {
        if (!best || isl.pixelCount > best.pixelCount) best = isl;
      }
    }
    return best;
  });
  check("found large deform/static island", !!pick && pick.pixelCount >= 2000, JSON.stringify(pick));

  await page.evaluate((token) => {
    window.__boneMorph.setIslandChecked([token]);
    window.__boneMorph.setHslScope("parts");
  }, pick.token);
  await page.waitForTimeout(300);

  const afterCheck = await page.evaluate(() => {
    const st = window.__boneMorph.getState();
    return { scope: st.hslScope, checked: st.islandChecked || [] };
  });
  check(
    "island check enables parts scope",
    afterCheck.scope === "parts" && afterCheck.checked.includes(pick.token),
    JSON.stringify(afterCheck)
  );

  const previewCount = await page.evaluate(() => {
    const dock = document.getElementById("islandPreviewDock");
    return dock ? dock.querySelectorAll(".island-preview-item").length : 0;
  });
  check("checked islands show preview dock", previewCount >= 1, `previews=${previewCount}`);

  const canvas = page.locator("#viewerHost > canvas").first();
  const beforePath = path.join(outDir, "01-before.png");
  await canvas.screenshot({ path: beforePath });
  await page.evaluate(() => {
    const set = (id, v) => {
      const el = document.getElementById(id);
      el.value = String(v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    window.__boneMorph.setHslScope("parts");
    set("morphHslH", 80);
    set("morphHslS", 45);
    set("morphHslL", -6);
  });
  await page.waitForTimeout(500);
  const afterPath = path.join(outDir, "01-island-hsl.png");
  await canvas.screenshot({ path: afterPath });

  const py = `
from PIL import Image
a=Image.open(r'''${beforePath.replace(/\\/g, "/")}''').convert('RGB')
b=Image.open(r'''${afterPath.replace(/\\/g, "/")}''').convert('RGB')
w,h=a.size
n=0
for y in range(h):
  for x in range(w):
    pa=a.getpixel((x,y)); pb=b.getpixel((x,y))
    if abs(pa[0]-pb[0])+abs(pa[1]-pb[1])+abs(pa[2]-pb[2])>40: n+=1
print(n)
`;
  const diffN = Number((spawnSync("python", ["-c", py], { encoding: "utf8" }).stdout || "").trim() || 0);
  check("island HSL changes pixels", diffN >= 80, `diffN=${diffN}`);

  const report = { ok: checks.every((c) => c.ok), checks, outDir };
  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(report.ok ? "OK" : "FAIL", outDir);
  await browser.close();
  process.exit(report.ok ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
