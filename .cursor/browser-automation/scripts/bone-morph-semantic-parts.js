/**
 * Selftest: semantic colour-class parts (整色块部件) + HSL.
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
  `${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}-morph-semantic-parts`
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

  check(
    "morph panel has 3 tabs",
    (await page.locator("[data-morph-tab]").count()) === 3,
    "拧形/设色/存档"
  );

  const canvas = page.locator("#viewerHostMorph canvas");
  const box = await canvas.boundingBox();

  // side view for ear
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.22, box.y + box.height * 0.4, {
    steps: 14,
  });
  await page.mouse.up();
  await page.waitForTimeout(400);

  const earProbe = await page.evaluate(() => {
    const bm = window.__boneMorph;
    let best = null;
    for (let x = 0.7; x <= 0.82; x += 0.03) {
      for (let y = 0.38; y <= 0.5; y += 0.03) {
        const r = bm.debugFloodPickAtNdc(x, y);
        if (!r?.best) continue;
        const h = r.best.hex || "";
        const rr = parseInt(h.slice(1, 3), 16);
        const gg = parseInt(h.slice(3, 5), 16);
        const bb = parseInt(h.slice(5, 7), 16);
        const mx = Math.max(rr, gg, bb);
        const coolDark = bb >= rr && mx < 160 && mx > 80 && r.best.px >= 4000 && r.best.px <= 120000;
        // 偏好 Deform 暗冷灰局部部件，忌整颅灰
        let score = coolDark ? r.best.px : r.best.px * 0.15;
        if (/deform/i.test(r.best.mesh) && coolDark) score *= 2.5;
        if (r.best.px > 150000) score *= 0.05;
        if (!best || score > best._s) best = { ...r.best, nx: x, ny: y, _s: score };
      }
    }
    return best;
  });
  console.log("earProbe", JSON.stringify(earProbe, null, 2));
  check(
    "ear semantic part pickable",
    !!(earProbe && earProbe.px >= 5000 && earProbe.regionId?.startsWith("cq_")),
    JSON.stringify({
      label: earProbe?.partLabel,
      px: earProbe?.px,
      hex: earProbe?.hex,
      id: earProbe?.regionId,
    })
  );

  await page.click("#morphPickMesh");
  await page.waitForTimeout(80);
  const earPt = earProbe || { nx: 0.76, ny: 0.42 };
  await page.mouse.click(box.x + box.width * earPt.nx, box.y + box.height * earPt.ny);
  await page.waitForTimeout(400);
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
    "UI pick selects cq_ semantic part",
    !!(afterPick.region?.startsWith("cq_") && afterPick.px >= 5000),
    JSON.stringify(afterPick)
  );
  check(
    "pick auto-opens color tab",
    (await page.locator('[data-morph-tab="color"].on').count()) === 1 &&
      !(await page.locator('[data-morph-pane="color"]').first().getAttribute("hidden")),
    "设色 tab active"
  );
  check(
    "HSL sliders enabled after pick",
    !(await page.locator("#morphHslH").isDisabled()),
    "morphHslH"
  );

  // 作用域「选定」+ 普通单击（不点选部）
  await page.evaluate(() => {
    window.__boneMorph.clearSelectedMeshColor();
    window.__boneMorph.setPickMuscleMode(false);
    window.__boneMorph.setHslScope("selected");
  });
  await page.waitForTimeout(150);
  await page.mouse.click(box.x + box.width * earPt.nx, box.y + box.height * earPt.ny);
  await page.waitForTimeout(450);
  const afterDirectClick = await page.evaluate(() => {
    const st = window.__boneMorph.getState();
    const h = document.getElementById("morphHslH");
    return {
      region: st.selectedRegionKey,
      label: st.selectedPartLabel,
      hslDisabled: h?.disabled,
      scope: st.hslScope,
    };
  });
  check(
    "选定 scope + single click picks part",
    !!(
      afterDirectClick.region?.startsWith("cq_") &&
      afterDirectClick.label &&
      !afterDirectClick.hslDisabled
    ),
    JSON.stringify(afterDirectClick)
  );

  const beforePath = path.join(outDir, "01-ear-before.png");
  await canvas.screenshot({ path: beforePath });
  await page.evaluate(() => {
    const set = (id, v) => {
      const el = document.getElementById(id);
      el.value = String(v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    set("morphHslH", 90);
    set("morphHslS", 55);
    set("morphHslL", -5);
  });
  await page.waitForTimeout(500);
  const afterPath = path.join(outDir, "01-ear-part-hsl.png");
  await canvas.screenshot({ path: afterPath });

  const py = `
from PIL import Image
a=Image.open(r'''${beforePath.replace(/\\/g, "/")}''').convert('RGB')
b=Image.open(r'''${afterPath.replace(/\\/g, "/")}''').convert('RGB')
w,h=a.size
n=0; sx=0; sy=0; neck=0
for y in range(h):
  for x in range(w):
    pa=a.getpixel((x,y)); pb=b.getpixel((x,y))
    if abs(pa[0]-pb[0])+abs(pa[1]-pb[1])+abs(pa[2]-pb[2])<45: continue
    if not (pb[1]>pb[0]+12 and pb[1]>pb[2]+8 and pb[1]-pa[1]>18): continue
    n+=1; sx+=x; sy+=y
    if y>0.62*h: neck+=1
print(n, round(sx/n/w,3) if n else 0, round(sy/n/h,3) if n else 0, neck)
`;
  const earPix = spawnSync("python", ["-c", py], { encoding: "utf8" });
  const parts = (earPix.stdout || "").trim().split(/\s+/);
  const greenN = Number(parts[0] || 0);
  const cx = Number(parts[1] || 0);
  const cy = Number(parts[2] || 0);
  const neck = Number(parts[3] || 0);
  check(
    "ear part HSL moves head-side pixels (not neck-dominant)",
    greenN >= 400 && cy > 0.22 && cy < 0.58 && neck / Math.max(greenN, 1) < 0.4,
    JSON.stringify({ greenN, cx, cy, neck, pick: afterPick })
  );

  // green temporalis — whole colour class should be large
  const frontBtn = page.locator("#viewerHostMorph button", { hasText: "前" });
  if (await frontBtn.count()) {
    await frontBtn.first().click().catch(() => {});
    await page.waitForTimeout(400);
  }
  // rotate a bit to side-oblique for temporalis
  const box2 = await canvas.boundingBox();
  await page.mouse.move(box2.x + box2.width * 0.5, box2.y + box2.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(box2.x + box2.width * 0.35, box2.y + box2.height * 0.4, {
    steps: 10,
  });
  await page.mouse.up();
  await page.waitForTimeout(300);

  const greenPick = await page.evaluate(() => {
    const bm = window.__boneMorph;
    let best = null;
    for (let x = 0.45; x <= 0.7; x += 0.04) {
      for (let y = 0.28; y <= 0.48; y += 0.04) {
        const r = bm.debugFloodPickAtNdc(x, y);
        if (!r?.best) continue;
        const h = r.best.hex || "";
        const rr = parseInt(h.slice(1, 3), 16);
        const gg = parseInt(h.slice(3, 5), 16);
        const bb = parseInt(h.slice(5, 7), 16);
        if (!(gg > rr + 20 && gg > bb + 10)) continue;
        if (!best || r.best.px > best.px) best = { ...r.best, nx: x, ny: y };
      }
    }
    return best;
  });
  console.log("greenPick", JSON.stringify(greenPick));
  check(
    "green muscle part is whole colour class (px>=8000)",
    !!(greenPick && greenPick.px >= 8000 && greenPick.regionId?.startsWith("cq_")),
    JSON.stringify(greenPick)
  );

  if (greenPick) {
    await page.click("#morphPickMesh");
    await page.waitForTimeout(60);
    await page.mouse.click(
      box2.x + box2.width * greenPick.nx,
      box2.y + box2.height * greenPick.ny
    );
    await page.waitForTimeout(350);
    await page.evaluate(() => {
      const set = (id, v) => {
        const el = document.getElementById(id);
        el.value = String(v);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      };
      set("morphHslH", -40);
      set("morphHslS", 20);
      set("morphHslL", 0);
    });
    await page.waitForTimeout(400);
    await canvas.screenshot({ path: path.join(outDir, "02-green-part-hsl.png") });
  }

  // Alt+click（不进入选部模式）应同样锁定部件并允许 HSL
  await page.evaluate(() => {
    window.__boneMorph.clearSelectedMeshColor();
    window.__boneMorph.setPickMuscleMode(false);
  });
  await page.waitForTimeout(200);
  await page.keyboard.down("Alt");
  await page.mouse.click(box.x + box.width * earPt.nx, box.y + box.height * earPt.ny);
  await page.keyboard.up("Alt");
  await page.waitForTimeout(450);
  const afterAlt = await page.evaluate(() => {
    const st = window.__boneMorph.getState();
    const h = document.getElementById("morphHslH");
    const r = window.__boneMorph.setScopeHsl(0.25, 0.35, -0.05, { notify: true, immediate: true });
    return {
      region: st.selectedRegionKey,
      label: st.selectedPartLabel,
      hslDisabled: h?.disabled,
      applyOk: r?.ok,
      px: st.selectedRegionPixels,
    };
  });
  check(
    "Alt+click selects part and HSL applies",
    !!(
      afterAlt.region?.startsWith("cq_") &&
      afterAlt.label &&
      !afterAlt.hslDisabled &&
      afterAlt.applyOk
    ),
    JSON.stringify(afterAlt)
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
