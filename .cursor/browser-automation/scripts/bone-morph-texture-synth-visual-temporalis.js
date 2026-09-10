/**
 * 视觉验收：颞肌（孤岛 19 / gi_18）纹理变体
 * - 颞区应有可见条纹重排
 * - 胸锁乳突肌/颈前不应被「拍」上颞肌绿色
 * Run: BASE_URL=http://127.0.0.1:8765 node scripts/bone-morph-texture-synth-visual-temporalis.js
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { chromium } = require("playwright");

const BASE = process.env.BASE_URL || "http://127.0.0.1:8765";
const BUILD_ID = "geom-island-texture-synth-20260903f";

const outDir = path.join(
  __dirname,
  "..",
  "runs",
  `${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}-texture-temporalis-visual`
);
fs.mkdirSync(outDir, { recursive: true });

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: !!ok, detail: detail || "" });
  console.log(ok ? "✓" : "✗", name, detail ? `— ${detail}` : "");
}

function regionAround(cx, cy, hw, hh) {
  return {
    x0: Math.max(0.04, cx - hw),
    y0: Math.max(0.04, cy - hh),
    x1: Math.min(0.96, cx + hw),
    y1: Math.min(0.96, cy + hh),
  };
}

function analyzeCropPair(beforePath, afterPath, diffThresh = 16) {
  const py = `
from PIL import Image
import json
a=Image.open(r'''${beforePath.replace(/\\/g, "/")}''').convert('RGB')
b=Image.open(r'''${afterPath.replace(/\\/g, "/")}''').convert('RGB')
w,h=a.size
changed=0; greenSpike=0; samples=[]
for y in range(0,h,2):
  for x in range(0,w,2):
    pa=a.getpixel((x,y)); pb=b.getpixel((x,y))
    if sum(pb)>720 or sum(pa)>720: continue
    d=abs(pa[0]-pb[0])+abs(pa[1]-pb[1])+abs(pa[2]-pb[2])
    if d<${diffThresh}: continue
    changed+=1
    # 颞肌绿：G 主导
    if pb[1]>pa[1]+10 and pb[1]>pb[0]+8 and pb[1]>pb[2]+6:
      greenSpike+=1
    if len(samples)<8:
      samples.append({'d':d,'before':pa,'after':pb})
print(json.dumps({'changed':changed,'greenSpike':greenSpike,'samples':samples}))
`;
  const r = spawnSync("python", ["-c", py], { encoding: "utf8" });
  if (r.status !== 0) return { error: r.stderr || r.stdout };
  try {
    return JSON.parse((r.stdout || "").trim());
  } catch (e) {
    return { error: "parse failed" };
  }
}

async function shotRegion(page, canvas, region, outPath) {
  const box = await canvas.boundingBox();
  if (!box) return false;
  const x = box.x + box.width * region.x0;
  const y = box.y + box.height * region.y0;
  const w = box.width * (region.x1 - region.x0);
  const h = box.height * (region.y1 - region.y0);
  await page.screenshot({
    path: outPath,
    clip: { x, y, width: w, height: h },
  });
  return true;
}

async function rotateSideView(page, canvas) {
  const box = await canvas.boundingBox();
  if (!box) return;
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.42);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.18, box.y + box.height * 0.42, { steps: 18 });
  await page.mouse.up();
  await page.waitForTimeout(500);
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
  }

  await page.waitForFunction(() => !!window.__boneMorph?.getRoot?.(), { timeout: 180000 });
  await page.waitForFunction(
    () => window.__boneMorph?.getState?.()?.islandScanDone === true,
    { timeout: 180000 }
  );

  const buildId = await page.evaluate(() => window.__boneMorph?.getBuildId?.() || "");
  check("build id", buildId === BUILD_ID, buildId);

  await page.click('[data-morph-tab="color"]');
  await page.waitForTimeout(300);

  const pick = await page.evaluate(() => {
    const st = window.__boneMorph.getState();
    let best = null;
    for (const g of st.colorIslandGroups || []) {
      const key = `${g.meshKey || ""} ${g.meshRawName || ""}`.toLowerCase();
      if (!/deform|变形/.test(key)) continue;
      for (const isl of g.islands || []) {
        if (isl.pixelCount < 50000 || isl.pixelCount > 120000) continue;
        if (!best || Math.abs(isl.pixelCount - 94000) < Math.abs(best.pixelCount - 94000)) {
          best = isl;
        }
      }
    }
    return best;
  });
  check("found temporalis-like deform island", !!pick, pick?.label || "none");

  const canvas = page.locator("#viewerHostMorph canvas, #viewerHost canvas").first();
  await rotateSideView(page, canvas);

  // 侧面：颞肌绿色主体（避开与邻肌交界）
  const templeRegion = regionAround(0.46, 0.30, 0.09, 0.10);
  const scmRegion = regionAround(0.52, 0.68, 0.10, 0.12);

  const templeBefore = path.join(outDir, "temple_before.png");
  const scmBefore = path.join(outDir, "scm_before.png");
  const fullBefore = path.join(outDir, "full_before.png");
  await shotRegion(page, canvas, templeRegion, templeBefore);
  await shotRegion(page, canvas, scmRegion, scmBefore);
  await page.screenshot({ path: fullBefore, fullPage: false });

  await page.evaluate(
    (token) => {
      window.__boneMorph.clearIslandTextureSynth?.();
      window.__boneMorph.setIslandChecked([token]);
      window.__boneMorph.setIslandTextureSynthParams({
        seed: 77,
        similarity: 0.72,
        blockScale: 22,
      });
    },
    pick.token
  );

  await page.evaluate(() => window.__boneMorph.runIslandTextureSynth());
  await page.waitForFunction(
    () => !window.__boneMorph.getState().islandTextureSynthBusy,
    { timeout: 120000 }
  );
  await page.waitForTimeout(400);

  const templeAfter = path.join(outDir, "temple_after.png");
  const scmAfter = path.join(outDir, "scm_after.png");
  await shotRegion(page, canvas, templeRegion, templeAfter);
  await shotRegion(page, canvas, scmRegion, scmAfter);
  await page.screenshot({ path: path.join(outDir, "full_after.png") });

  const atlasBleed = await page.evaluate((token) => {
    const parsed = token.split("::");
    const deformKey = parsed[0];
    const regionId = parsed[1];
    const meshes = [];
    window.__boneMorph.getRoot().traverse((o) => {
      if (o.isMesh && o.userData?.bmAtlas) meshes.push(o);
    });
    let deformMesh = null;
    for (const m of meshes) {
      if (m.name === deformKey || m.uuid === deformKey) deformMesh = m;
    }
    if (!deformMesh) return { ok: false, reason: "no deform mesh" };
    const dAtlas = deformMesh.userData.bmAtlas;
    const geomMask = dAtlas.masks?.[regionId];
    const entry = window.__boneMorph.getState().islandTextureSynth?.[token];
    const synthMask = entry?.synthMask;
    if (!geomMask) return { ok: false, reason: "no deform mask" };
    let geomPx = 0;
    let synthPx = 0;
    for (let p = 0; p < geomMask.length; p++) {
      if (geomMask[p]) geomPx++;
      if (synthMask?.[p]) synthPx++;
    }
    const others = [];
    for (const m of meshes) {
      if (m === deformMesh) continue;
      const a = m.userData.bmAtlas;
      if (!a) continue;
      let changed = 0;
      const o = a.orig.data;
      const l = a.live?.data || a.orig.data;
      for (let p = 0; p < o.length; p += 4) {
        if (o[p] !== l[p] || o[p + 1] !== l[p + 1] || o[p + 2] !== l[p + 2]) changed++;
      }
      others.push({ name: m.name, changedPixels: Math.floor(changed / 4) });
    }
    let deformInside = 0;
    let deformOutside = 0;
    const useMask = synthMask || geomMask;
    const od = dAtlas.orig.data;
    const ld = dAtlas.live.data;
    for (let p = 0; p < useMask.length; p++) {
      const di = p * 4;
      const diff =
        od[di] !== ld[di] || od[di + 1] !== ld[di + 1] || od[di + 2] !== ld[di + 2];
      if (!diff) continue;
      if (useMask[p]) deformInside++;
      else deformOutside++;
    }
    return {
      ok: true,
      geomPx,
      synthPx,
      refinedRatio: geomPx ? synthPx / geomPx : 0,
      deformInside,
      deformOutside,
      others,
      synthCount: window.__boneMorph.getState().islandTextureSynthCheckedCount,
    };
  }, pick.token);

  check(
    "refined mask smaller than full geometry island",
    atlasBleed.ok && atlasBleed.geomPx > 0 && atlasBleed.deformInside < atlasBleed.geomPx * 0.85,
    `geom=${atlasBleed.geomPx} insideDiff=${atlasBleed.deformInside}`
  );

  check(
    "synth cache has pixels",
    atlasBleed.ok && atlasBleed.synthCount >= 1,
    JSON.stringify({ synth: atlasBleed.synthCount, inside: atlasBleed.deformInside })
  );
  check(
    "deform atlas: no leak outside island mask",
    atlasBleed.ok && atlasBleed.deformOutside === 0,
    `outside=${atlasBleed.deformOutside}`
  );
  check(
    "other meshes atlas unchanged (no twin stamp)",
    atlasBleed.ok &&
      atlasBleed.others.every((o) => o.changedPixels === 0),
    JSON.stringify(atlasBleed.others || [])
  );

  const templeVisual = analyzeCropPair(templeBefore, templeAfter, 14);
  const scmVisual = analyzeCropPair(scmBefore, scmAfter, 14);

  check(
    "visual: temple region shows texture change",
    !templeVisual.error && templeVisual.changed >= 120,
    templeVisual.error || `changed=${templeVisual.changed}`
  );
  check(
    "visual: SCM/neck region should NOT get temporalis green",
    !scmVisual.error && (scmVisual.greenSpike || 0) < 20,
    scmVisual.error ||
      `changed=${scmVisual.changed} greenSpike=${scmVisual.greenSpike || 0}`
  );

  fs.writeFileSync(
    path.join(outDir, "report.json"),
    JSON.stringify(
      {
        buildId,
        pick,
        atlasBleed,
        templeVisual,
        scmVisual,
        checks,
      },
      null,
      2
    )
  );
  fs.writeFileSync(path.join(outDir, "checks.json"), JSON.stringify(checks, null, 2));

  await browser.close();

  const failed = checks.filter((c) => !c.ok);
  if (failed.length) {
    console.error("FAILED", failed);
    process.exit(1);
  }
  console.log("OK", outDir);
})();
