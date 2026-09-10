/**
 * 人类模拟：左侧面 Alt+点耳 → HSL(S≈39) → 与 QA user_side_L 同区域截图验收
 * Run: node scripts/bone-morph-ear-human-repro.js
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { chromium } = require("playwright");

const BASE = process.env.BASE_URL || "http://127.0.0.1:8765";
const BUILD_ID = "semantic-pick-20260901p";
const HSL_USER = { dh: -56 / 360, ds: 0.39, dl: 0 };

const outDir = path.join(
  __dirname,
  "..",
  "runs",
  `${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}-ear-human`
);
fs.mkdirSync(outDir, { recursive: true });

function regionAround(cx, cy, hw, hh) {
  return {
    x0: Math.max(0.04, cx - hw),
    y0: Math.max(0.04, cy - hh),
    x1: Math.min(0.96, cx + hw),
    y1: Math.min(0.96, cy + hh),
  };
}

function analyzeCropPair(beforePath, afterPath, diffThresh = 18) {
  const py = `
from PIL import Image
import json
a=Image.open(r'''${beforePath.replace(/\\/g, "/")}''').convert('RGB')
b=Image.open(r'''${afterPath.replace(/\\/g, "/")}''').convert('RGB')
w,h=a.size
changed=0; hueShift=0
for y in range(0,h,2):
  for x in range(0,w,2):
    pa=a.getpixel((x,y)); pb=b.getpixel((x,y))
    # 仅统计模型表面（排除白底与边缘抗锯齿）
    if sum(pb)>715 or sum(pa)>715: continue
    if max(pb)-min(pb)>55: continue
    d=abs(pa[0]-pb[0])+abs(pa[1]-pb[1])+abs(pa[2]-pb[2])
    if d<${diffThresh}: continue
    changed+=1
    if pb[0]>pa[0]+12 and pb[2]>pa[2]+8: hueShift+=1
print(json.dumps({'changed':changed,'hueShift':hueShift}))
`;
  const r = spawnSync("python", ["-c", py], { encoding: "utf8" });
  if (r.status !== 0) return { error: r.stderr || r.stdout };
  try {
    return JSON.parse((r.stdout || "").trim());
  } catch (e) {
    return { error: "parse failed" };
  }
}

function judge(report) {
  const reasons = [];
  const { pick, paint, earVisual, neckVisual } = report;
  if (!pick.label) reasons.push(`标签为空`);
  if (pick.buildId !== BUILD_ID) reasons.push(`buildId=${pick.buildId}`);
  if (!String(pick.region || "").startsWith("cq_")) reasons.push(`region=${pick.region}`);
  if ((pick.px || 0) < 800) reasons.push(`选区过小 px=${pick.px}`);
  if ((paint.static?.inMaskCoverage || 0) < 0.9 && paint.static?.inMaskTotal > 0) {
    reasons.push(`Static 覆盖率 ${((paint.static?.inMaskCoverage || 0) * 100).toFixed(0)}%`);
  }
  if (earVisual?.error || neckVisual?.error) {
    reasons.push(`截图分析失败`);
  } else {
    if ((earVisual.changed || 0) < 200) reasons.push(`耳区可视变色不足 ${earVisual.changed}`);
    const bleed = (paint.static?.outMaskChanged || 0) + (paint.deform?.outMaskChanged || 0);
    if (bleed > 800) reasons.push(`mask 外渗漏 ${bleed}`);
  }
  return { ok: !reasons.length, reasons };
}

async function shotRegion(page, canvas, region, outPath) {
  const box = await canvas.boundingBox();
  if (!box) return;
  const x = box.x + box.width * region.x0;
  const y = box.y + box.height * region.y0;
  const w = box.width * (region.x1 - region.x0);
  const h = box.height * (region.y1 - region.y0);
  await page.screenshot({
    path: outPath,
    clip: { x, y, width: w, height: h },
  });
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--ignore-gpu-blocklist"],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 960 } });
  await page.goto(`${BASE}/?_=${Date.now()}`, { waitUntil: "load", timeout: 120000 });
  await page.waitForFunction(
    () =>
      !!window.__boneMorph &&
      (document.getElementById("viewerStatus")?.textContent || "").includes("拧形"),
    { timeout: 180000 }
  );
  await page.waitForTimeout(800);

  const canvas = page.locator("#viewerHost canvas");
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.22, box.y + box.height * 0.4, { steps: 14 });
  await page.mouse.up();
  await page.waitForTimeout(500);

  const cx = 0.58;
  const cy = 0.46;
  const earRegion = regionAround(cx, cy, 0.14, 0.16);
  const neckRegion = regionAround(cx + 0.06, cy + 0.22, 0.14 * 0.9, 0.16 * 0.85);
  const earBefore = path.join(outDir, "ear_before.png");
  const earAfter = path.join(outDir, "ear_after.png");
  const neckBefore = path.join(outDir, "neck_before.png");
  const neckAfter = path.join(outDir, "neck_after.png");

  await page.evaluate(() => window.__boneMorph.debugClearMeshColors());
  await shotRegion(page, canvas, earRegion, earBefore);
  await shotRegion(page, canvas, neckRegion, neckBefore);

  const pickOk = await page.evaluate(
    ({ nx, ny }) => window.__boneMorph.debugSelectAtCanvas01(nx, ny),
    { nx: cx, ny: cy }
  );
  if (!pickOk) console.warn("[qa] debugSelectAtCanvas01 returned false");
  await page.waitForTimeout(200);

  const pick = await page.evaluate(() => {
    const st = window.__boneMorph.getState();
    return {
      label: st.selectedPartLabel,
      px: st.selectedRegionPixels,
      region: st.selectedRegionKey,
      buildId: st.buildId,
      keys: Object.keys(st.meshColors || {}),
    };
  });

  await page.evaluate(
    (h) => window.__boneMorph.setScopeHsl(h.dh, h.ds, h.dl, { notify: true, immediate: true }),
    HSL_USER
  );
  await page.waitForTimeout(1200);

  const paint = await page.evaluate(() => window.__boneMorph.debugAtlasPaintStats());
  await shotRegion(page, canvas, earRegion, earAfter);
  await shotRegion(page, canvas, neckRegion, neckAfter);
  await canvas.screenshot({ path: path.join(outDir, "full_after.png") });

  const earVisual = analyzeCropPair(earBefore, earAfter, 18);
  const neckVisual = analyzeCropPair(neckBefore, neckAfter, 18);

  const report = { pick, paint, earVisual, neckVisual, outDir };
  const verdict = judge(report);
  report.verdict = verdict;
  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));

  console.log(
    verdict.ok ? "✓ HUMAN_REPRO OK" : "✗ HUMAN_REPRO FAIL",
    verdict.reasons.join("; ") || ""
  );
  console.log(
    `  整耳 ${pick.px}px · Static ${paint.static?.inMaskChanged}/${paint.static?.inMaskTotal} · Deform ${paint.deform?.inMaskChanged}/${paint.deform?.inMaskTotal}`
  );
  console.log(`  耳区截图 ${earVisual?.changed} · 脖子 ${neckVisual?.changed} · build ${pick.buildId}`);
  console.log("  →", outDir);

  await browser.close();
  process.exit(verdict.ok ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
