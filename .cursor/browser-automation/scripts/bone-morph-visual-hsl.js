/**
 * Visual browser selftest (screenshots + PNG sampling).
 * User scenario: 所有肌肉, H=-85, S=25, L=-30
 * Assert: skull stays pale; front-neck tints; forehead green (Skiedras) shifts.
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { chromium } = require("playwright");

const RUNS = path.resolve(__dirname, "../runs");
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outDir = path.join(RUNS, `${stamp}-morph-visual-hsl`);
fs.mkdirSync(outDir, { recursive: true });
const BASE = process.env.BASE_URL || "http://127.0.0.1:8765";

function satApprox(c) {
  const mx = Math.max(c.r, c.g, c.b) / 255;
  const mn = Math.min(c.r, c.g, c.b) / 255;
  const l = (mx + mn) / 2;
  const d = mx - mn;
  if (d < 1e-6) return 0;
  return l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
}

function samplePng(pngPath) {
  const py = `
from PIL import Image
import json
im=Image.open(r'''${pngPath.replace(/\\/g, "/")}''').convert("RGB")
w,h=im.size
def avg(nx,ny,rad=10):
  cx=int(nx*w); cy=int(ny*h); R=G=B=n=0
  for dy in range(-rad,rad+1):
    for dx in range(-rad,rad+1):
      x=cx+dx; y=cy+dy
      if 0<=x<w and 0<=y<h:
        r,g,b=im.getpixel((x,y)); R+=r; G+=g; B+=b; n+=1
  return {"r":R//n,"g":G//n,"b":B//n,"n":n}
# front-ish euro head ROIs (viewer crop)
out={
  "w":w,"h":h,
  "skullCrown":avg(0.50,0.10),
  "skullCreamCheek":avg(0.68,0.48),
  "foreheadMuscle":avg(0.42,0.22),
  "foreheadMuscleR":avg(0.58,0.22),
  "temple":avg(0.72,0.38),
  "cheek":avg(0.62,0.42),
  "neckL":avg(0.40,0.72),
  "neckR":avg(0.60,0.72),
  "neckC":avg(0.50,0.78),
}
print(json.dumps(out))
`;
  const r = spawnSync("python", ["-c", py], { encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error("png sample failed: " + (r.stderr || r.stdout));
  }
  return JSON.parse(r.stdout.trim().split("\n").pop());
}

function approxHue(c) {
  const r = c.r / 255;
  const g = c.g / 255;
  const b = c.b / 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  if (d < 1e-6) return 0;
  let h;
  if (mx === r) h = ((g - b) / d) % 6;
  else if (mx === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return (((h * 60) % 360) + 360) % 360;
}

function looksGreen(c) {
  const hue = approxHue(c);
  return satApprox(c) > 0.12 && hue > 70 && hue < 160;
}

function looksMustardBone(c) {
  const s = satApprox(c);
  return c.r > 140 && c.g > 110 && c.b < c.g - 20 && s > 0.18;
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--ignore-gpu-blocklist"],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 960 } });
  const report = { ok: true, checks: [], outDir, samples: {} };
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
  await page.waitForTimeout(1000);

  // Prefer frontal for skull / forehead / neck ROIs
  const frontBtn = page.locator("#viewerHostMorph button", { hasText: "前" });
  if (await frontBtn.count()) {
    await frontBtn.first().click().catch(() => {});
    await page.waitForTimeout(400);
  }

  await page.screenshot({
    path: path.join(outDir, "01-before.png"),
    fullPage: true,
  });

  await page.click("#morphHslScopeMuscles");
  await page.waitForTimeout(150);
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

  await page.screenshot({
    path: path.join(outDir, "02-after-muscles-hsl.png"),
    fullPage: true,
  });
  const viewerPng = path.join(outDir, "03-viewer-after.png");
  await page.locator("#viewerHostMorph").screenshot({ path: viewerPng });

  const samples = samplePng(viewerPng);
  report.samples = samples;
  console.log("samples", JSON.stringify(samples, null, 2));

  const skull = samples.skullCreamCheek || samples.skullCrown;
  const fhL = samples.foreheadMuscle;
  const fhR = samples.foreheadMuscleR;
  const cheek = samples.cheek;
  const neck = {
    r: Math.round((samples.neckL.r + samples.neckR.r + samples.neckC.r) / 3),
    g: Math.round((samples.neckL.g + samples.neckR.g + samples.neckC.g) / 3),
    b: Math.round((samples.neckL.b + samples.neckR.b + samples.neckC.b) / 3),
  };

  check(
    "visual: cheek muscle saturated (HSL applied)",
    satApprox(cheek) > 0.12,
    JSON.stringify(cheek) + ` sat=${satApprox(cheek).toFixed(3)}`
  );

  const neckSat = satApprox(neck);
  const neckGray =
    Math.abs(neck.r - neck.g) < 18 &&
    Math.abs(neck.g - neck.b) < 18 &&
    neckSat < 0.08;
  check(
    "visual: front neck NOT flat gray (should tint)",
    !neckGray && neckSat >= 0.06,
    JSON.stringify({ neck, neckSat, L: samples.neckL, R: samples.neckR, C: samples.neckC })
  );

  // 额区 / 帽状腱膜：射线验证；H=-85 会把蓝紫拧成绿，故不禁绿色相
  const picks = await page.evaluate(() => {
    const bm = window.__boneMorph;
    if (!bm.debugPickAtNdc) return { err: "no debugPickAtNdc" };
    return {
      foreheadL: bm.debugPickAtNdc(0.42, 0.22),
      foreheadC: bm.debugPickAtNdc(0.5, 0.2),
      crown: bm.debugPickAtNdc(0.5, 0.12),
      neck: bm.debugPickAtNdc(0.5, 0.75),
    };
  });
  report.picks = picks;
  console.log("picks", JSON.stringify(picks, null, 2));

  const skullSat = satApprox(skull);
  const staticCreamHit = []
    .concat(picks.foreheadL || [], picks.foreheadC || [], picks.crown || [], picks.neck || [])
    .find(
      (h) =>
        h.mesh &&
        /static/i.test(h.mesh) &&
        h.origRgb &&
        h.origRgb[0] > 230 &&
        h.origRgb[1] > 220 &&
        h.origRgb[2] < h.origRgb[1] - 15
    );
  const creamFrozen =
    staticCreamHit &&
    staticCreamHit.atlasRgb[0] === staticCreamHit.origRgb[0] &&
    staticCreamHit.atlasRgb[1] === staticCreamHit.origRgb[1] &&
    staticCreamHit.atlasRgb[2] === staticCreamHit.origRgb[2];
  check(
    "visual: Static cream bone frozen (ray)",
    !!creamFrozen,
    JSON.stringify({
      hit: staticCreamHit,
      screenCheek: skull,
      sat: skullSat,
    })
  );

  const fhPick =
    (picks.foreheadL && picks.foreheadL[0]) ||
    (picks.foreheadC && picks.foreheadC[0]);
  const fhChanged =
    fhPick &&
    fhPick.atlasRgb &&
    fhPick.origRgb &&
    (fhPick.atlasRgb[0] !== fhPick.origRgb[0] ||
      fhPick.atlasRgb[1] !== fhPick.origRgb[1] ||
      fhPick.atlasRgb[2] !== fhPick.origRgb[2]);
  check(
    "visual: forehead/galea atlas pixel changed under HSL",
    !!fhChanged,
    JSON.stringify({
      mesh: fhPick?.mesh,
      orig: fhPick?.origRgb,
      cur: fhPick?.atlasRgb,
      screenL: fhL,
      screenR: fhR,
      hueL: approxHue(fhL),
      hueR: approxHue(fhR),
    })
  );

  const crownPick =
    (picks.foreheadC || []).find(
      (h) =>
        h.origRgb &&
        Math.max(...h.origRgb.slice(0, 3)) - Math.min(...h.origRgb.slice(0, 3)) <
          40 &&
        Math.min(...h.origRgb.slice(0, 3)) >= 150
    ) || (picks.crown || [])[0];
  if (crownPick && crownPick.origRgb && crownPick.atlasRgb) {
    const crownChanged =
      crownPick.atlasRgb[0] !== crownPick.origRgb[0] ||
      crownPick.atlasRgb[1] !== crownPick.origRgb[1] ||
      crownPick.atlasRgb[2] !== crownPick.origRgb[2];
    const wasCoolGray =
      crownPick.origRgb[2] >= crownPick.origRgb[0] + 4 &&
      Math.min(...crownPick.origRgb.slice(0, 3)) >= 150;
    check(
      "visual: deform cool-gray (galea-like) can change",
      !wasCoolGray || crownChanged,
      JSON.stringify(crownPick)
    );
  }

  const atlasAssert = await page.evaluate(() => {
    const bm = window.__boneMorph;
    const root = bm.getRoot();
    let deform = null;
    let stat = null;
    let skiedras = null;
    let acs = null;
    root.traverse((o) => {
      if (!o.isMesh || !o.userData?.bmAtlas) return;
      const n = o.name || "";
      if (/deform/i.test(n)) deform = o;
      if (/static/i.test(n)) stat = o;
      if (/skiedras/i.test(n)) skiedras = o;
      if (/acs/i.test(n) && !/leca/i.test(n)) acs = o;
    });
    function countChange(mesh, pred) {
      if (!mesh) return { total: 0, changed: 0, stillPred: 0 };
      const a = mesh.userData.bmAtlas;
      const o = a.orig.data;
      const img = a.ctx.getImageData(0, 0, a.w, a.h).data;
      let total = 0;
      let changed = 0;
      let stillPred = 0;
      for (let i = 0; i < o.length; i += 4) {
        if (!pred(o[i], o[i + 1], o[i + 2])) continue;
        total++;
        const ch =
          img[i] !== o[i] || img[i + 1] !== o[i + 1] || img[i + 2] !== o[i + 2];
        if (ch) changed++;
        if (pred(img[i], img[i + 1], img[i + 2])) stillPred++;
      }
      return {
        total,
        changed,
        stillPred,
        rate: total ? changed / total : 0,
        name: mesh.name,
      };
    }
    const isGreen = (r, g, b) => g > r + 20 && g > b + 10 && g > 100;
    return {
      scope: bm.getState().hslScope,
      cream: countChange(
        stat,
        (r, g, b) => r > 240 && g > 230 && b < 220 && b < g - 20
      ),
      deformGreen: countChange(deform, isGreen),
      skiedrasGreen: countChange(skiedras, isGreen),
      gray: countChange(deform, (r, g, b) => {
        const mx = Math.max(r, g, b);
        const mn = Math.min(r, g, b);
        return mx - mn < 20 && mx > 140 && mx < 200;
      }),
      deformCoolGray: countChange(deform, (r, g, b) => {
        const mx = Math.max(r, g, b);
        const mn = Math.min(r, g, b);
        return mx - mn < 45 && mn >= 155 && b >= r + 4 && b >= g;
      }),
      acsMidGray: countChange(acs, (r, g, b) => {
        const mx = Math.max(r, g, b);
        const mn = Math.min(r, g, b);
        return mx - mn < 20 && mx > 140 && mx < 200;
      }),
    };
  });
  console.log("atlasAssert", JSON.stringify(atlasAssert));

  check(
    "atlas: Static cream bone mostly frozen",
    atlasAssert.cream.total > 1000 && atlasAssert.cream.rate < 0.05,
    JSON.stringify(atlasAssert.cream)
  );
  check(
    "atlas: Deform green mostly changes",
    atlasAssert.deformGreen.total > 500 && atlasAssert.deformGreen.rate > 0.8,
    JSON.stringify(atlasAssert.deformGreen)
  );
  check(
    "atlas: Skiedras green mostly changes (所有肌肉)",
    atlasAssert.skiedrasGreen.total > 500 &&
      atlasAssert.skiedrasGreen.rate > 0.8 &&
      atlasAssert.skiedrasGreen.stillPred / atlasAssert.skiedrasGreen.total < 0.15,
    JSON.stringify(atlasAssert.skiedrasGreen)
  );
  check(
    "atlas: Deform mid-gray mostly changes",
    atlasAssert.gray.total > 500 && atlasAssert.gray.rate > 0.8,
    JSON.stringify(atlasAssert.gray)
  );
  check(
    "atlas: Deform cool-gray (galea-like) mostly changes",
    atlasAssert.deformCoolGray.total > 200 &&
      atlasAssert.deformCoolGray.rate > 0.8,
    JSON.stringify(atlasAssert.deformCoolGray)
  );

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
