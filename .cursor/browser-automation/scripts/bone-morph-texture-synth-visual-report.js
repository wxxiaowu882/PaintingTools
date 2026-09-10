/**
 * 视觉验收报告：颞肌 + 咬肌 纹理变体（渲染截图对比 + HTML）
 * Run: BASE_URL=http://127.0.0.1:8765 node scripts/bone-morph-texture-synth-visual-report.js
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { chromium } = require("playwright");

const BASE = process.env.BASE_URL || "http://127.0.0.1:8765";
const BUILD_ID = "geom-island-texture-synth-20260904i";

const ISLAND_VIEW = {
  // 侧视：颞肌扇形区 / 咬肌矩形区（与 debug-stamp-side 对齐，禁用过大色块自动裁剪）
  temporalis: { fromX: 0.55, toX: 0.2, y: 0.42, cx: 0.52, cy: 0.2, hw: 0.15, hh: 0.17 },
  masseter: { fromX: 0.55, toX: 0.22, y: 0.45, cx: 0.58, cy: 0.42, hw: 0.09, hh: 0.12 },
};
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outDir = path.join(__dirname, "..", "runs", `${stamp}-texture-synth-visual-report`);
fs.mkdirSync(outDir, { recursive: true });

function regionAround(cx, cy, hw, hh) {
  return {
    x0: Math.max(0.04, cx - hw),
    y0: Math.max(0.04, cy - hh),
    x1: Math.min(0.96, cx + hw),
    y1: Math.min(0.96, cy + hh),
  };
}

function analyzeCropPair(beforePath, afterPath, diffThresh = 14) {
  const py = `
from PIL import Image
import json
a=Image.open(r'''${beforePath.replace(/\\/g, "/")}''').convert('RGB')
b=Image.open(r'''${afterPath.replace(/\\/g, "/")}''').convert('RGB')
w,h=a.size
changed=0; maxd=0; samples=0
for y in range(0,h,1):
  for x in range(0,w,1):
    pa=a.getpixel((x,y)); pb=b.getpixel((x,y))
    if sum(pb)>720 or sum(pa)>720: continue
    samples+=1
    d=abs(pa[0]-pb[0])+abs(pa[1]-pb[1])+abs(pa[2]-pb[2])
    if d<${diffThresh}: continue
    changed+=1
    if d>maxd: maxd=d
print(json.dumps({'changed':changed,'maxd':maxd,'w':w,'h':h,'samples':samples,'changedPct': round(100*changed/max(1,samples),2)}))
`;
  const r = spawnSync("python", ["-c", py], { encoding: "utf8" });
  if (r.status !== 0) return { error: r.stderr || r.stdout };
  try {
    return JSON.parse((r.stdout || "").trim());
  } catch (e) {
    return { error: "parse failed" };
  }
}

function countBrightDiffPixels(diffPath, thresh = 28) {
  const py = `
from PIL import Image
import json
img=Image.open(r'''${diffPath.replace(/\\/g, "/")}''').convert('RGB')
w,h=img.size
bright=0
for y in range(0,h,1):
  for x in range(0,w,1):
    r,g,b=img.getpixel((x,y))
    if r+g+b>${thresh}: bright+=1
print(json.dumps({'bright':bright,'w':w,'h':h}))
`;
  const r = spawnSync("python", ["-c", py], { encoding: "utf8" });
  if (r.status !== 0) return { bright: 0 };
  try {
    return JSON.parse((r.stdout || "").trim());
  } catch (e) {
    return { bright: 0 };
  }
}

function makeDiffImage(beforePath, afterPath, outPath, gain = 10) {
  const py = `
from PIL import Image, ImageChops
a=Image.open(r'''${beforePath.replace(/\\/g, "/")}''').convert('RGB')
b=Image.open(r'''${afterPath.replace(/\\/g, "/")}''').convert('RGB')
diff=ImageChops.difference(a,b).point(lambda p: min(255, p*${gain}))
diff.save(r'''${outPath.replace(/\\/g, "/")}''')
`;
  const r = spawnSync("python", ["-c", py], { encoding: "utf8" });
  return r.status === 0;
}

function hexToRgb(hex) {
  const h = String(hex || "").replace("#", "");
  if (h.length !== 6) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function detectMuscleCrop(fullPath, seedRgb, pad = 0.02, colorTol = 28) {
  const [sr, sg, sb] = seedRgb;
  const py = `
from PIL import Image
import json
img=Image.open(r'''${fullPath.replace(/\\/g, "/")}''').convert('RGB')
w,h=img.size
sr,sg,sb=${sr},${sg},${sb}
xs=[]; ys=[]
for y in range(0,h,2):
  for x in range(0,w,2):
    r,g,b=img.getpixel((x,y))
    if r+g+b>720: continue
    d=abs(r-sr)+abs(g-sg)+abs(b-sb)
    if d<=${colorTol}: xs.append(x); ys.append(y)
if not xs:
  print(json.dumps({'error':'no_seed_pixels'}))
else:
  x0,x1=min(xs),max(xs); y0,y1=min(ys),max(ys)
  padx=max(8,int(w*${pad})); pady=max(8,int(h*${pad}))
  x0=max(0,x0-padx); y0=max(0,y0-pady)
  x1=min(w-1,x1+padx); y1=min(h-1,y1+pady)
  area=(x1-x0+1)*(y1-y0+1)
  print(json.dumps({'x0':x0,'y0':y0,'x1':x1,'y1':y1,'w':w,'h':h,'hits':len(xs),'areaPct':round(100*area/(w*h),2)}))
`;
  const r = spawnSync("python", ["-c", py], { encoding: "utf8" });
  if (r.status !== 0) return { error: r.stderr || r.stdout };
  try {
    const j = JSON.parse((r.stdout || "").trim());
    if (j.error) return j;
    if (j.areaPct > 14) return { error: "crop_too_large", ...j };
    return {
      x0: j.x0 / j.w,
      y0: j.y0 / j.h,
      x1: (j.x1 + 1) / j.w,
      y1: (j.y1 + 1) / j.h,
      hits: j.hits,
      areaPct: j.areaPct,
    };
  } catch (e) {
    return { error: "parse failed" };
  }
}

async function shotFullCanvas(page, canvas, outPath) {
  const box = await canvas.boundingBox();
  if (!box) return null;
  await page.screenshot({
    path: outPath,
    clip: { x: box.x, y: box.y, width: box.width, height: box.height },
  });
  return box;
}

async function shotRegion(page, canvas, region, outPath) {
  const box = await canvas.boundingBox();
  if (!box) return false;
  await page.screenshot({
    path: outPath,
    clip: {
      x: box.x + box.width * region.x0,
      y: box.y + box.height * region.y0,
      width: box.width * (region.x1 - region.x0),
      height: box.height * (region.y1 - region.y0),
    },
  });
  return true;
}

async function findMuscleRegion(page, canvas, island, view) {
  const seedRgb = hexToRgb(island.previewHex);
  const fallback = regionAround(view.cx, view.cy, view.hw, view.hh);
  if (!seedRgb) return { region: fallback, detect: { error: "no_hex" } };

  await rotateView(page, canvas, view.fromX, view.toX, view.y);
  const full = path.join(outDir, `${island.tag || "probe"}_full.png`);
  await shotFullCanvas(page, canvas, full);
  const detect = detectMuscleCrop(full, seedRgb, 0.02, 18);
  if (detect.error || !detect.hits || detect.hits < 80 || (detect.areaPct && detect.areaPct > 14)) {
    return { region: fallback, detect, full };
  }
  return { region: detect, detect, full };
}

function toB64(p) {
  return fs.readFileSync(p).toString("base64");
}

async function rotateView(page, canvas, fromX, toX, y = 0.42) {
  const box = await canvas.boundingBox();
  if (!box) return;
  await page.mouse.move(box.x + box.width * fromX, box.y + box.height * y);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * toX, box.y + box.height * y, { steps: 16 });
  await page.mouse.up();
  await page.waitForTimeout(500);
}

async function testIsland(page, canvas, island, view) {
  const tag = island.tag;
  const { region, detect } = await findMuscleRegion(page, canvas, island, view);

  async function runWithSeed(seed) {
    await page.evaluate(
      ({ token, s }) => {
        window.__boneMorph.clearIslandTextureSynth?.();
        window.__boneMorph.setIslandChecked([token]);
        window.__boneMorph.setIslandTextureSynthParams({
          seed: s,
          similarity: 0.5,
          blockScale: 24,
        });
      },
      { token: island.token, s: seed }
    );
    await page.evaluate(() => window.__boneMorph.runIslandTextureSynth());
    await page.waitForFunction(
      () => !window.__boneMorph.getState().islandTextureSynthBusy,
      { timeout: 120000 }
    );
    await page.waitForTimeout(500);
  }

  await page.evaluate(
    (token) => {
      window.__boneMorph.clearIslandTextureSynth?.();
      window.__boneMorph.setIslandChecked([token]);
    },
    island.token
  );
  await page.waitForTimeout(200);
  const before = path.join(outDir, `${tag}_before.png`);
  const afterA = path.join(outDir, `${tag}_after_a.png`);
  const afterB = path.join(outDir, `${tag}_after_b.png`);
  const diffAB = path.join(outDir, `${tag}_diff_ab.png`);
  const diffBeforeA = path.join(outDir, `${tag}_diff.png`);
  async function shotMuscle(outPath) {
    await rotateView(page, canvas, view.fromX, view.toX, view.y);
    await shotRegion(page, canvas, region, outPath);
  }
  await shotMuscle(before);

  await runWithSeed(17);
  await shotMuscle(afterA);
  await runWithSeed(99173);
  await shotMuscle(afterB);
  makeDiffImage(afterA, afterB, diffAB, 14);
  makeDiffImage(before, afterA, diffBeforeA, 12);

  const pre = await page.evaluate((token) => {
    const parsed = token.split("::");
    let mesh = null;
    window.__boneMorph.getRoot().traverse((o) => {
      if (o.isMesh && o.name === parsed[0]) mesh = o;
    });
    const na = mesh?.userData?.bmNormalAtlas;
    return {
      hasNormalAtlas: !!na,
      buildId: window.__boneMorph.getBuildId?.(),
    };
  }, island.token);

  const stats = await page.evaluate((token) => {
    const parsed = token.split("::");
    let mesh = null;
    window.__boneMorph.getRoot().traverse((o) => {
      if (o.isMesh && o.name === parsed[0]) mesh = o;
    });
    const na = mesh?.userData?.bmNormalAtlas;
    const entry = [...(window.__boneMorph.getState().islandTextureSynthCount ? [] : [])];
    const cache = window.__boneMorph.getState();
    let normalChanged = 0;
    let albedoChanged = 0;
    const mask =
      mesh?.userData?.bmAtlas?.masks?.[parsed[1]] ||
      mesh?.userData?.bmIslands?.find((x) => x.regionId === parsed[1])?.mask;
    if (mask && na) {
      const no = na.orig.data;
      const nl = na.live.data;
      for (let p = 0; p < mask.length; p++) {
        if (!mask[p]) continue;
        const di = p * 4;
        if (no[di] !== nl[di] || no[di + 1] !== nl[di + 1] || no[di + 2] !== nl[di + 2]) normalChanged++;
      }
    }
    const atlas = mesh?.userData?.bmAtlas;
    if (mask && atlas) {
      const o = atlas.orig.data;
      const l = atlas.live.data;
      for (let p = 0; p < mask.length; p++) {
        if (!mask[p]) continue;
        const di = p * 4;
        if (o[di] !== l[di] || o[di + 1] !== l[di + 1] || o[di + 2] !== l[di + 2]) albedoChanged++;
      }
    }
    return {
      normalChanged,
      albedoChanged,
      synthCount: cache.islandTextureSynthCheckedCount,
      error: cache.islandTextureSynthLastError || "",
    };
  }, island.token);

  const visualBefore = analyzeCropPair(before, afterA, 12);
  const visualVariant = analyzeCropPair(afterA, afterB, 12);
  const brightAB = countBrightDiffPixels(diffAB, 24);
  const minBright = Math.max(400, Math.floor((brightAB.w || 100) * (brightAB.h || 100) * 0.03));
  const passed =
    !visualVariant.error &&
    (visualVariant.changedPct ?? 0) >= 12 &&
    (visualVariant.maxd ?? 0) >= 50 &&
    (brightAB.bright ?? 0) >= minBright &&
    (stats.normalChanged >= 800 || stats.albedoChanged >= 800) &&
    stats.synthCount >= 1 &&
    !stats.error;

  return {
    tag,
    island: island.label,
    before,
    after: afterA,
    afterB,
    diff: diffBeforeA,
    diffAB,
    visual: visualBefore,
    visualVariant,
    brightAB,
    stats,
    pre,
    passed,
    region,
    detect,
  };
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--ignore-gpu-blocklist"],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 960 } });
  await page.goto(`${BASE}/?_=${Date.now()}`, { waitUntil: "commit", timeout: 180000 });

  await page.waitForFunction(
    () => {
      const sel = document.querySelector("#projectSelect");
      return sel && (sel.value || /暂无工程/.test(sel.options[0]?.textContent || ""));
    },
    { timeout: 60000 }
  );
  if (!(await page.evaluate(() => !!document.querySelector("#projectSelect")?.value))) {
    await page.click("#btnNewFromEuro");
    await page.waitForFunction(() => !!document.querySelector("#projectSelect")?.value, {
      timeout: 180000,
    });
  }
  await page.waitForFunction(() => window.__boneMorph?.getState?.()?.islandScanDone === true, {
    timeout: 180000,
  });
  await page.click('[data-morph-tab="color"]');
  await page.waitForTimeout(400);

  const islands = await page.evaluate(() => {
    const st = window.__boneMorph.getState();
    let temporalis = null;
    let masseter = null;
    for (const g of st.colorIslandGroups || []) {
      if (!/deform|变形/i.test(`${g.meshKey} ${g.meshRawName}`)) continue;
      for (const isl of g.islands || []) {
        if (isl.regionId === "gi_18") temporalis = isl;
        if (isl.previewHex === "#bd6870" || isl.regionId === "gi_11") masseter = isl;
      }
    }
    return {
      buildId: window.__boneMorph.getBuildId?.(),
      temporalis,
      masseter,
    };
  });

  const canvas = page.locator("#viewerHostMorph canvas, #viewerHost canvas").first();
  const results = [];

  if (islands.temporalis) {
    results.push(
      await testIsland(
        page,
        canvas,
        { ...islands.temporalis, tag: "temporalis" },
        ISLAND_VIEW.temporalis
      )
    );
  }
  if (islands.masseter) {
    results.push(
      await testIsland(
        page,
        canvas,
        { ...islands.masseter, tag: "masseter" },
        ISLAND_VIEW.masseter
      )
    );
  }

  await browser.close();

  const allPass = results.every((r) => r.passed);
  const report = { buildId: islands.buildId, expectedBuild: BUILD_ID, allPass, results };
  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));

  const htmlPath = path.join(outDir, "index.html");
  const deployPath = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "自用工具文件_不部署/篡改猴/亚洲头部肌肉模型/work_v4/compare_review/qa_reports/texture-synth-visual/index.html"
  );
  fs.mkdirSync(path.dirname(deployPath), { recursive: true });

  const cards = results
    .map((r) => {
      const status = r.passed
        ? '<span class="ok">✓ 观感通过</span>'
        : '<span class="fail">✗ 未通过</span>';
      return `
<section class="card ${r.passed ? "pass" : "fail"}">
  <h2>${r.tag === "temporalis" ? "颞肌" : "咬肌"}（${r.island}） ${status}</h2>
  <p class="meta">原色→变体A：<strong>${r.visual.changedPct ?? "?"}%</strong> · 变体A↔B（换一版）：<strong>${r.visualVariant.changedPct ?? "?"}%</strong> · 颜色贴图改动：<strong>${r.stats.albedoChanged}</strong></p>
  <div class="pair trio">
    <figure><img src="data:image/png;base64,${toB64(r.before)}" alt="before"/><figcaption>变体前（原色）</figcaption></figure>
    <figure><img src="data:image/png;base64,${toB64(r.after)}" alt="afterA"/><figcaption>变体 A（seed=17）</figcaption></figure>
    <figure><img src="data:image/png;base64,${toB64(r.afterB)}" alt="afterB"/><figcaption>变体 B（seed=99173，换一版）</figcaption></figure>
  </div>
  <div class="pair duo">
    <figure><img src="data:image/png;base64,${toB64(r.diff)}" alt="diff"/><figcaption>原色 vs A 差异 ×12</figcaption></figure>
    <figure><img src="data:image/png;base64,${toB64(r.diffAB)}" alt="diffAB"/><figcaption>A vs B 差异 ×14（应肉眼可见）</figcaption></figure>
  </div>
</section>`;
    })
    .join("\n");

  const html = `<!DOCTYPE html>
<html lang="zh-CN"><head>
<meta charset="utf-8"/>
<title>纹理变体视觉验收</title>
<style>
body{font-family:"Microsoft YaHei","PingFang SC",sans-serif;margin:24px;background:#1a1a1a;color:#eee}
h1{font-size:1.35rem} .meta{color:#aaa;font-size:.92rem}
.card{border:1px solid #444;border-radius:8px;padding:16px;margin:20px 0;background:#242424}
.card.pass{border-color:#3a7} .card.fail{border-color:#c55}
.pair{display:flex;gap:16px;flex-wrap:wrap} figure{margin:0;flex:1;min-width:220px}
img{width:100%;border-radius:4px;border:1px solid #555}
figcaption{text-align:center;margin-top:8px;color:#bbb;font-size:.9rem}
.ok{color:#6f6} .fail{color:#f88}
</style></head><body>
<h1>纹理变体 · 渲染观感验收</h1>
<p class="meta">Build: <strong>${islands.buildId}</strong>（期望 ${BUILD_ID}）· 生成时间 ${stamp.replace("T", " ")}</p>
<p class="meta">总评：<strong class="${allPass ? "ok" : "fail"}">${allPass ? "全部通过" : "存在未通过项，需继续修复"}</strong></p>
${cards}
</body></html>`;

  fs.writeFileSync(htmlPath, html);
  fs.writeFileSync(deployPath, html);
  for (const r of results) {
    const dest = path.join(path.dirname(deployPath), `${r.tag}_before.png`);
    fs.copyFileSync(r.before, dest);
    fs.copyFileSync(r.after, path.join(path.dirname(deployPath), `${r.tag}_after.png`));
    if (r.afterB) fs.copyFileSync(r.afterB, path.join(path.dirname(deployPath), `${r.tag}_after_b.png`));
    if (fs.existsSync(r.diff)) {
      fs.copyFileSync(r.diff, path.join(path.dirname(deployPath), `${r.tag}_diff.png`));
    }
    if (r.diffAB && fs.existsSync(r.diffAB)) {
      fs.copyFileSync(r.diffAB, path.join(path.dirname(deployPath), `${r.tag}_diff_ab.png`));
    }
  }

  console.log(JSON.stringify({ allPass, htmlPath, deployPath, results: results.map((r) => ({ tag: r.tag, passed: r.passed, visual: r.visual, visualVariant: r.visualVariant, stats: r.stats })) }, null, 2));
  process.exit(allPass ? 0 : 1);
})();
