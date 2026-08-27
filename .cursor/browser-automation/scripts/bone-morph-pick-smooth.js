/**
 * Selftest: slider smoothness + ear/neck/back whole-muscle pick.
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const RUNS = path.resolve(__dirname, "../runs");
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outDir = path.join(RUNS, `${stamp}-morph-pick-smooth`);
fs.mkdirSync(outDir, { recursive: true });
const BASE = process.env.BASE_URL || "http://127.0.0.1:8765";

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--ignore-gpu-blocklist"],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 960 } });
  const report = { ok: true, checks: [], outDir };
  const check = (name, pass, detail) => {
    report.checks.push({ name, pass: !!pass, detail: detail || "" });
    if (!pass) report.ok = false;
    console.log(`${pass ? "✓" : "✗"} ${name}${detail ? " — " + detail : ""}`);
  };

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
  await page.waitForTimeout(900);

  // ——— Slider smoothness ———
  // Bench under「选定」+ 已选区（只重绘一块 mask）；并测「所有肌肉」rAF 合并
  await page.click("#morphHslScopeMuscles");
  const sliderBenchGlobal = await page.evaluate(async () => {
    const el = document.getElementById("morphHslH");
    const times = [];
    for (let v = -20; v <= 20; v += 10) {
      const t0 = performance.now();
      el.value = String(v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      times.push(performance.now() - t0);
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    return { avg, max: Math.max(...times), n: times.length };
  });
  check(
    "global slider rAF avg < 850ms",
    sliderBenchGlobal.avg < 850,
    JSON.stringify(sliderBenchGlobal)
  );

  // reset global hsl
  await page.evaluate(() => {
    window.__boneMorph.setHslScope("muscles");
    window.__boneMorph.setScopeHsl(0, 0, 0, { notify: false, immediate: true });
  });

  // ——— Side view: ear + neck ———
  // 拖到更侧的侧面，露出耳朵
  const box0 = await page.locator("#viewerHostMorph canvas").boundingBox();
  await page.mouse.move(box0.x + box0.width * 0.55, box0.y + box0.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(box0.x + box0.width * 0.25, box0.y + box0.height * 0.4, {
    steps: 16,
  });
  await page.mouse.up();
  await page.waitForTimeout(400);

  const sidePicks = await page.evaluate(() => {
    const bm = window.__boneMorph;
    function midGrayScore(hex, px, mesh, forEar) {
      if (!hex || hex.length < 7) return -1;
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      const isGray = mx - mn < 55 && mx > 90 && mx < 210;
      if (!isGray) return -1;
      if (px > 150000) return px * 0.05;
      let s = px;
      if (/static/i.test(mesh)) s *= 1.4;
      if (/plasty/i.test(mesh) && px < 200000) s *= 1.15;
      if (forEar) {
        // 可见耳：偏暗冷灰局部块；忌浅冷灰 galea / 过大片
        const cool = b >= r + 3;
        const dark = mx < 150;
        if (/deform/i.test(mesh) && cool && dark && px >= 4000 && px <= 45000) s *= 4.5;
        if (/deform/i.test(mesh) && cool && !dark && px > 25000) s *= 0.15;
        if (/deform/i.test(mesh) && px > 55000) s *= 0.15;
        if (/static/i.test(mesh) && px >= 8000 && px <= 35000 && mx - mn < 35) s *= 1.6;
      } else if (/deform/i.test(mesh) && px >= 8000 && px <= 90000) {
        s *= 1.35;
      }
      return s;
    }
    const tryPick = (points, forEar) => {
      let best = null;
      let bestS = -1;
      for (const [nx, ny] of points) {
        const r = bm.debugFloodPickAtNdc(nx, ny);
        if (!r?.best) continue;
        const pool = [r.best, ...(r.candidates || [])].filter((c) => c && c.hex && c.px);
        for (const c of pool) {
          const s = midGrayScore(c.hex, c.px, c.mesh, !!forEar);
          if (s > bestS) {
            bestS = s;
            best = { ...c, nx, ny, candidates: r.candidates, grayScore: s };
          }
        }
      }
      return best;
    };
    const earPts = [];
    for (let x = 0.68; x <= 0.82; x += 0.03) {
      for (let y = 0.38; y <= 0.50; y += 0.03) earPts.push([x, y]);
    }
    const neckPts = [
      [0.5, 0.72],
      [0.55, 0.75],
      [0.6, 0.7],
      [0.48, 0.78],
      [0.58, 0.8],
      [0.52, 0.68],
    ];
    return {
      ear: tryPick(earPts, true),
      neckSide: tryPick(neckPts, false),
    };
  });
  console.log("sidePicks", JSON.stringify(sidePicks, null, 2));

  check(
    "ear mid-gray pickable (px 2.5k–120k)",
    !!(
      sidePicks.ear &&
      sidePicks.ear.px >= 2500 &&
      sidePicks.ear.px <= 120000
    ),
    JSON.stringify(sidePicks.ear)
  );
  check(
    "ear pick is mid-gray (not cream skull)",
    !!(
      sidePicks.ear &&
      (() => {
        const h = sidePicks.ear.hex || "";
        if (h.length < 7) return false;
        const r = parseInt(h.slice(1, 3), 16);
        const g = parseInt(h.slice(3, 5), 16);
        const b = parseInt(h.slice(5, 7), 16);
        const mx = Math.max(r, g, b);
        const mn = Math.min(r, g, b);
        return mx - mn < 55 && mx > 100 && mx < 210;
      })()
    ),
    JSON.stringify({
      mesh: sidePicks.ear?.mesh,
      hex: sidePicks.ear?.hex,
      px: sidePicks.ear?.px,
    })
  );
  check(
    "ear prefers local cool-gray block (4k–55k, not galea)",
    !!(
      sidePicks.ear &&
      sidePicks.ear.px >= 4000 &&
      sidePicks.ear.px <= 55000 &&
      (() => {
        const h = sidePicks.ear.hex || "";
        if (h.length < 7) return false;
        const r = parseInt(h.slice(1, 3), 16);
        const g = parseInt(h.slice(3, 5), 16);
        const b = parseInt(h.slice(5, 7), 16);
        const mx = Math.max(r, g, b);
        // 偏暗冷灰 = 耳；浅 #a7b4c4 类 galea 不记通过
        return mx < 155 && b >= r;
      })()
    ),
    JSON.stringify({
      mesh: sidePicks.ear?.mesh,
      hex: sidePicks.ear?.hex,
      px: sidePicks.ear?.px,
    })
  );
  check(
    "neck side whole-ish (px>=12000)",
    !!(sidePicks.neckSide && sidePicks.neckSide.px >= 12000),
    JSON.stringify(sidePicks.neckSide)
  );

  // Real click pick ear
  await page.click("#morphPickMesh");
  await page.waitForTimeout(100);
  const box = await page.locator("#viewerHostMorph canvas").boundingBox();
  const earPt = sidePicks.ear || { nx: 0.78, ny: 0.42 };
  await page.mouse.click(
    box.x + box.width * (earPt.nx || 0.78),
    box.y + box.height * (earPt.ny || 0.42)
  );
  await page.waitForTimeout(450);
  const afterEarPick = await page.evaluate(() => {
    const st = window.__boneMorph.getState();
    return {
      key: st.selectedMeshKey,
      region: st.selectedRegionKey,
      px: st.selectedRegionPixels,
      hex: st.selectedRegionHex,
      scope: st.hslScope,
    };
  });
  check(
    "UI pick ear selects region",
    !!(afterEarPick.region && afterEarPick.px >= 2500 && afterEarPick.px <= 120000),
    JSON.stringify(afterEarPick)
  );

  // Selected-scope slider smoothness
  const sliderBenchSelected = await page.evaluate(async () => {
    const el = document.getElementById("morphHslH");
    const times = [];
    for (let v = -40; v <= 40; v += 8) {
      const t0 = performance.now();
      el.value = String(v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      times.push(performance.now() - t0);
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    return { avg, max: Math.max(...times), n: times.length };
  });
  check(
    "selected slider rAF avg < 350ms",
    sliderBenchSelected.avg < 350,
    JSON.stringify(sliderBenchSelected)
  );

  const beforeEarPath = path.join(outDir, "01-ear-before.png");
  await page.locator("#viewerHostMorph canvas").screenshot({ path: beforeEarPath });

  await page.evaluate(() => {
    const set = (id, v) => {
      const el = document.getElementById(id);
      el.value = String(v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    set("morphHslH", 80);
    set("morphHslS", 45);
    set("morphHslL", -8);
  });
  await page.waitForTimeout(500);
  const afterEarPath = path.join(outDir, "01-ear-adjusted.png");
  await page.locator("#viewerHostMorph canvas").screenshot({ path: afterEarPath });

  // 屏幕耳区像素须有实质变化（证明选中的是可见耳壳，不是背面奶油/头皮）
  const { spawnSync } = require("child_process");
  const py = `
from PIL import Image
a=Image.open(r'''${beforeEarPath.replace(/\\/g, "/")}''').convert('RGB')
b=Image.open(r'''${afterEarPath.replace(/\\/g, "/")}''').convert('RGB')
w,h=a.size
changed=0; total=0; sx=0; sy=0; n=0; neck=0
for y in range(h):
  for x in range(w):
    pa=a.getpixel((x,y)); pb=b.getpixel((x,y))
    if abs(pa[0]-pb[0])+abs(pa[1]-pb[1])+abs(pa[2]-pb[2])<45: continue
    if not (pb[1]>pb[0]+12 and pb[1]>pb[2]+8 and pb[1]-pa[1]>18): continue
    n+=1; sx+=x; sy+=y
    if y>0.60*h: neck+=1
for y in range(int(0.34*h), int(0.52*h), 2):
  for x in range(int(0.66*w), int(0.84*w), 2):
    pa=a.getpixel((x,y)); pb=b.getpixel((x,y))
    total+=1
    if abs(pa[0]-pb[0])+abs(pa[1]-pb[1])+abs(pa[2]-pb[2])>=40:
      changed+=1
cx = (sx/n/w) if n else 0
cy = (sy/n/h) if n else 0
print(changed, total, round(changed/max(total,1),4), n, round(cx,3), round(cy,3), neck)
`;
  const earPix = spawnSync("python", ["-c", py], { encoding: "utf8" });
  const earPixLine = (earPix.stdout || "").trim().split(/\s+/);
  const earChanged = Number(earPixLine[0] || 0);
  const earTotal = Number(earPixLine[1] || 1);
  const earRatio = Number(earPixLine[2] || 0);
  const greenN = Number(earPixLine[3] || 0);
  const greenCx = Number(earPixLine[4] || 0);
  const greenCy = Number(earPixLine[5] || 0);
  const greenNeck = Number(earPixLine[6] || 0);
  check(
    "ear screen pixels shift after HSL (>=3% ear-zone)",
    earRatio >= 0.03 && earChanged >= 80,
    JSON.stringify({ earChanged, earTotal, earRatio, pick: afterEarPick })
  );
  check(
    "ear HSL paint stays on head-side (centroid y<0.58, neck greens <35%)",
    greenN >= 200 && greenCy > 0.25 && greenCy < 0.58 && greenNeck / Math.max(greenN, 1) < 0.35,
    JSON.stringify({ greenN, greenCx, greenCy, greenNeck, pick: afterEarPick })
  );

  // Front neck
  const frontBtn = page.locator("#viewerHostMorph button", { hasText: "前" });
  if (await frontBtn.count()) {
    await frontBtn.first().click().catch(() => {});
    await page.waitForTimeout(400);
  }
  const frontNeck = await page.evaluate(() => {
    const bm = window.__boneMorph;
    const pts = [
      [0.45, 0.72],
      [0.55, 0.72],
      [0.5, 0.78],
      [0.42, 0.7],
      [0.58, 0.7],
    ];
    let best = null;
    for (const [nx, ny] of pts) {
      const r = bm.debugFloodPickAtNdc(nx, ny);
      if (!r?.best) continue;
      if (!best || r.best.px > best.px) best = { ...r.best, nx, ny };
    }
    return best;
  });
  check(
    "front neck whole-ish (px>=6000)",
    !!(frontNeck && frontNeck.px >= 6000),
    JSON.stringify(frontNeck)
  );

  await page.click("#morphPickMesh");
  await page.waitForTimeout(80);
  const box2 = await page.locator("#viewerHostMorph canvas").boundingBox();
  const np = frontNeck || { nx: 0.5, ny: 0.75 };
  await page.mouse.click(box2.x + box2.width * np.nx, box2.y + box2.height * np.ny);
  await page.waitForTimeout(350);
  await page.evaluate(() => {
    const set = (id, v) => {
      const el = document.getElementById(id);
      el.value = String(v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    set("morphHslH", -90);
    set("morphHslS", 35);
    set("morphHslL", -20);
  });
  await page.waitForTimeout(400);
  await page.locator("#viewerHostMorph").screenshot({
    path: path.join(outDir, "02-neck-adjusted.png"),
  });

  // Back view
  const backBtn = page.locator("#viewerHostMorph button", { hasText: "后" });
  if (await backBtn.count()) {
    await backBtn.first().click().catch(() => {});
    await page.waitForTimeout(450);
  }
  const backPick = await page.evaluate(() => {
    const bm = window.__boneMorph;
    const pts = [
      [0.5, 0.45],
      [0.45, 0.5],
      [0.55, 0.5],
      [0.5, 0.55],
      [0.4, 0.48],
      [0.6, 0.48],
    ];
    let best = null;
    for (const [nx, ny] of pts) {
      const r = bm.debugFloodPickAtNdc(nx, ny);
      if (!r?.best) continue;
      // prefer Static mid-gray over Deform galea / green
      const prefer =
        /static/i.test(r.best.mesh) || (r.best.px >= 8000 && r.best.px < 150000);
      if (!best) best = { ...r.best, nx, ny };
      else if (prefer && r.best.px > best.px * 0.5) best = { ...r.best, nx, ny };
      else if (r.best.px > best.px && best.px < 8000) best = { ...r.best, nx, ny };
    }
    return best;
  });
  check(
    "back view whole-ish (px 8k–150k)",
    !!(backPick && backPick.px >= 8000 && backPick.px <= 150000),
    JSON.stringify(backPick)
  );

  await page.click("#morphPickMesh");
  await page.waitForTimeout(80);
  const box3 = await page.locator("#viewerHostMorph canvas").boundingBox();
  const bp = backPick || { nx: 0.5, ny: 0.5 };
  await page.mouse.click(box3.x + box3.width * bp.nx, box3.y + box3.height * bp.ny);
  await page.waitForTimeout(350);
  await page.evaluate(() => {
    const set = (id, v) => {
      const el = document.getElementById(id);
      el.value = String(v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    };
    set("morphHslH", 60);
    set("morphHslS", 40);
    set("morphHslL", -15);
  });
  await page.waitForTimeout(400);
  await page.locator("#viewerHostMorph").screenshot({
    path: path.join(outDir, "03-back-adjusted.png"),
  });

  report.sidePicks = sidePicks;
  report.frontNeck = frontNeck;
  report.backPick = backPick;
  report.sliderBenchGlobal = sliderBenchGlobal;
  report.sliderBenchSelected = sliderBenchSelected;
  report.afterEarPick = afterEarPick;
  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
  await browser.close();
  if (!report.ok) {
    console.error("FAIL", outDir);
    process.exit(1);
  }
  console.log("OK", outDir);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
