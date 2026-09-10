/**
 * 颞肌滑块验收：锁定侧视 + 自动裁剪绿色颞肌 + 两张图
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { chromium } = require("playwright");

const BASE = process.env.BASE_URL || "http://127.0.0.1:8765";
const SEED = 12345;
const BEFORE = { similarity: 57, blockScale: 29 };
const AFTER = { similarity: 42, blockScale: 14 };
const SEED_RGB = [0x81, 0xc4, 0x90];
const MIN_DIFF_PCT = 15;

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outDir = path.join(__dirname, "..", "runs", `${stamp}-slider-qa`);
const deployDir = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "自用工具文件_不部署",
  "篡改猴",
  "亚洲头部肌肉模型",
  "work_v4",
  "compare_review",
  "qa_reports",
  "texture-synth-visual"
);
fs.mkdirSync(outDir, { recursive: true });
fs.mkdirSync(deployDir, { recursive: true });

function cropTemporalis(fullPath, outPath, fixedBox = null) {
  const [sr, sg, sb] = SEED_RGB;
  const boxArg = fixedBox ? JSON.stringify(fixedBox) : "null";
  const py = `
from PIL import Image
import json
img=Image.open(r'''${fullPath.replace(/\\/g, "/")}''').convert('RGB')
w,h=img.size
fixed=${boxArg}
if fixed:
  x0,y0,x1,y1=fixed
else:
  xs=[]; ys=[]
  for y in range(0,h,2):
    for x in range(0,w,2):
      r,g,b=img.getpixel((x,y))
      if r+g+b>720: continue
      if abs(r-${sr})+abs(g-${sg})+abs(b-${sb})<=26:
        xs.append(x); ys.append(y)
  if not xs:
    x0,y0,x1,y1=int(w*0.32),int(h*0.02),int(w*0.72),int(h*0.42)
  else:
    x0,x1=min(xs),max(xs); y0,y1=min(ys),max(ys)
    padx=max(14,int(w*0.02)); pady=max(14,int(h*0.02))
    x0=max(0,x0-padx); y0=max(0,y0-pady)
    x1=min(w-1,x1+padx); y1=min(h-1,y1+pady)
img.crop((x0,y0,x1+1,y1+1)).save(r'''${outPath.replace(/\\/g, "/")}''')
print(json.dumps({'w':w,'h':h,'hits':len(xs) if not fixed else -1,'box':[x0,y0,x1,y1]}))
`;
  const r = spawnSync("python", ["-c", py], { encoding: "utf8" });
  return JSON.parse((r.stdout || "{}").trim() || "{}");
}

function cropDiffPct(beforePath, afterPath, thresh = 8) {
  const py = `
from PIL import Image
a=Image.open(r'''${beforePath.replace(/\\/g, "/")}''').convert('RGB')
b=Image.open(r'''${afterPath.replace(/\\/g, "/")}''').convert('RGB')
if a.size!=b.size:
  print(0)
else:
  chg=sum(1 for pa,pb in zip(a.getdata(),b.getdata()) if sum(abs(pa[i]-pb[i]) for i in range(3))>${thresh})
  print(round(100*chg/(a.size[0]*a.size[1]),1))
`;
  const r = spawnSync("python", ["-c", py], { encoding: "utf8" });
  return parseFloat((r.stdout || "0").trim()) || 0;
}

async function waitSynth(page) {
  await page.waitForFunction(() => !window.__boneMorph.getState().islandTextureSynthBusy, {
    timeout: 120000,
  });
  await page.waitForTimeout(300);
}

async function waitRender(page, frames = 4) {
  await page.evaluate(
    (n) =>
      new Promise((resolve) => {
        let left = n;
        const step = () => {
          window.__forceMorphRender?.(1);
          if (--left <= 0) resolve();
          else requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      }),
    frames
  );
  await page.waitForTimeout(200);
}

async function synthWithParams(page, token, sim, block) {
  await page.evaluate(
    async ({ token, seed, sim, block }) => {
      window.__boneMorph.setIslandTextureSynthParams({
        seed,
        similarity: sim / 100,
        blockScale: block,
      });
      await window.__boneMorph.runIslandTextureSynth();
    },
    { token, seed: SEED, sim, block }
  );
  await waitSynth(page);
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ["--use-gl=angle"] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 960 } });
  await page.goto(`${BASE}/?_=${Date.now()}`, { waitUntil: "commit", timeout: 180000 });
  await page.waitForFunction(() => window.__boneMorph?.getState?.()?.islandScanDone === true, {
    timeout: 180000,
  });
  await page.click('[data-morph-tab="color"]');

  const island = await page.evaluate(() => {
    for (const g of window.__boneMorph.getState().colorIslandGroups || []) {
      if (!/deform|变形/i.test(`${g.meshKey} ${g.meshRawName}`)) continue;
      for (const isl of g.islands || []) {
        if (isl.regionId === "gi_18") return isl.token;
      }
    }
    return null;
  });
  if (!island) throw new Error("颞肌 gi_18 未找到");

  await page.evaluate((token) => {
    window.__boneMorph.clearIslandTextureSynth();
    window.__boneMorph.setIslandChecked([token]);
  }, island);
  await waitSynth(page);

  await page.waitForFunction(() => window.__setMorphSideView?.() === true, { timeout: 30000 });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const dock = document.getElementById("islandPreviewDock");
    if (dock) dock.hidden = true;
  });

  const canvas = page.locator("#viewerHostMorph canvas, #viewerHost canvas").first();
  const box = await canvas.boundingBox();
  const cropBox = await page.evaluate((token) => {
    const r = window.__boneMorph.debugProjectIslandScreenCrop(token);
    return r?.box || null;
  }, island);
  if (!cropBox) throw new Error("无法投影颞肌屏幕裁剪框");

  await synthWithParams(page, island, BEFORE.similarity, BEFORE.blockScale);
  await waitRender(page);
  const hashBefore = await page.evaluate(
    (token) => window.__boneMorph.debugTextureSynthAtlasHash(token),
    island
  );
  const fullBefore = path.join(outDir, "full_before.png");
  await page.screenshot({ path: fullBefore, clip: box });
  const cropBefore = path.join(outDir, "temporalis_before_slider.png");
  const metaBefore = cropTemporalis(fullBefore, cropBefore, cropBox);

  await synthWithParams(page, island, AFTER.similarity, AFTER.blockScale);
  await waitRender(page);
  const hashAfter = await page.evaluate(
    (token) => window.__boneMorph.debugTextureSynthAtlasHash(token),
    island
  );
  const fullAfter = path.join(outDir, "full_after.png");
  await page.screenshot({ path: fullAfter, clip: box });
  const cropAfter = path.join(outDir, "temporalis_after_slider.png");
  const metaAfter = cropTemporalis(fullAfter, cropAfter, cropBox);

  const diffPct = cropDiffPct(cropBefore, cropAfter);
  const build = await page.evaluate(() => window.__boneMorph.getBuildId());
  await browser.close();

  if (!metaBefore.box) throw new Error("颞肌裁剪失败");
  if (diffPct < MIN_DIFF_PCT) {
    throw new Error(
      `验收失败：颞肌裁剪区差异 ${diffPct}%（需要 ≥${MIN_DIFF_PCT}%） atlas ${hashBefore?.hash}→${hashAfter?.hash}`
    );
  }

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>颞肌滑块验收</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 24px; background: #111; color: #eee; }
  h1 { font-size: 18px; font-weight: 600; margin: 0 0 20px; }
  .row { display: flex; gap: 24px; flex-wrap: wrap; align-items: flex-start; }
  figure { margin: 0; flex: 1 1 380px; max-width: 640px; }
  figcaption { margin: 0 0 10px; font-size: 16px; }
  img { width: 100%; height: auto; border: 2px solid #444; background: #fff; display: block; }
</style>
</head>
<body>
  <h1>颞肌 · 拖滑块前 / 拖滑块后</h1>
  <div class="row">
    <figure>
      <figcaption>拖滑块前</figcaption>
      <img alt="拖滑块前" src="temporalis_before_slider.png" />
    </figure>
    <figure>
      <figcaption>拖滑块后</figcaption>
      <img alt="拖滑块后" src="temporalis_after_slider.png" />
    </figure>
  </div>
</body>
</html>`;

  const deployPath = path.join(deployDir, "index.html");
  fs.writeFileSync(deployPath, html, "utf8");
  fs.writeFileSync(path.join(outDir, "index.html"), html, "utf8");
  fs.copyFileSync(cropBefore, path.join(deployDir, "temporalis_before_slider.png"));
  fs.copyFileSync(cropAfter, path.join(deployDir, "temporalis_after_slider.png"));
  console.log(JSON.stringify({ build, diffPct, metaBefore, metaAfter, deployPath }, null, 2));
})();
