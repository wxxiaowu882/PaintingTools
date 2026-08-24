/**
 * Mandatory web visual selftest — MUST match what user sees in browser.
 * Fails if: wrong/cached PNG URL, ours frame blown-out white, or align missing.
 *
 * Run: node scripts/compare-review-web-selftest.js [CAND]
 * Requires: http://127.0.0.1:8765/ (12_亚洲头肌对照页.bat)
 */
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const CAND = process.argv[2] || "SHELL_v8";
const URL = "http://127.0.0.1:8765/";
const RUNS = path.resolve(__dirname, "../runs");
const OUT = path.join(RUNS, `web_selftest_${CAND}_${Date.now()}`);
const DISK_FRONT = path.resolve(
  __dirname,
  "../../../自用工具文件_不部署/篡改猴/亚洲头部肌肉模型/work_v4/compare_review/ours",
  CAND,
  "muscle_front.png"
);
const PRIMARY = ["front", "side", "back"];

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);
}

async function frameStats(page, selector) {
  return page.evaluate((sel) => {
    const img = document.querySelector(sel);
    if (!img || !img.complete || img.naturalWidth < 8) {
      return { ok: false, reason: "img not ready" };
    }
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, w, h).data;
    const bg = [px[0], px[1], px[2]];
    let fg = 0;
    let clip = 0;
    let sum = [0, 0, 0];
    const ch = [[], [], []];
    for (let i = 0; i < px.length; i += 4) {
      const d = Math.abs(px[i] - bg[0]) + Math.abs(px[i + 1] - bg[1]) + Math.abs(px[i + 2] - bg[2]);
      if (d <= 60) continue;
      fg++;
      ch[0].push(px[i]);
      ch[1].push(px[i + 1]);
      ch[2].push(px[i + 2]);
      sum[0] += px[i];
      sum[1] += px[i + 1];
      sum[2] += px[i + 2];
      if (px[i] >= 250 && px[i + 1] >= 250 && px[i + 2] >= 250) clip++;
    }
    if (!fg) return { ok: false, reason: "no foreground" };
    const mean = sum.map((s) => s / fg);
    const std = ch.map((a) => {
      const m = a.reduce((x, y) => x + y, 0) / a.length;
      return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length);
    });
    return {
      ok: true,
      src: img.currentSrc || img.src,
      w,
      h,
      fg,
      clipFrac: clip / fg,
      mean,
      stdMin: Math.min(...std),
      bg,
    };
  }, selector);
}

async function waitSideBySide(page, view) {
  await page.click(`[data-view="${view}"]`);
  await page.waitForTimeout(800);
  await page.waitForFunction(
    () => {
      const imgs = document.querySelectorAll("#frameBase img, #frameOurs img");
      if (imgs.length < 2) return false;
      for (const el of imgs) {
        if (!el.complete || el.naturalWidth < 100 || !el.dataset.headTop) return false;
      }
      return true;
    },
    { timeout: 15000 }
  );
  await page.waitForTimeout(400);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const fails = [];

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    serviceWorkers: "block",
  });
  const page = await context.newPage();

  try {
    await page.goto(`${URL}?_=${Date.now()}`, { waitUntil: "networkidle", timeout: 25000 });
  } catch (e) {
    console.error("[FAIL] 对照页 http://127.0.0.1:8765/ 未启动");
    process.exit(1);
  }

  await page.waitForSelector("#cand");
  await page.selectOption("#cand", CAND);
  await page.click('button[data-mode="side"]');

  const manifest = await page.evaluate(async () => {
    const r = await fetch(`manifest.json?_=${Date.now()}`);
    return r.ok ? r.json() : null;
  });
  const assetRev = manifest?.asset_rev || "";
  console.log("[info] manifest asset_rev =", assetRev || "(empty)");

  if (fs.existsSync(DISK_FRONT)) {
    const diskHash = sha256(fs.readFileSync(DISK_FRONT));
    console.log("[info] disk muscle_front.png sha256[:16] =", diskHash);
  }

  for (const view of PRIMARY) {
    await waitSideBySide(page, view);
    const shot = path.join(OUT, `web_sideby_${view}.png`);
    await page.screenshot({ path: shot, fullPage: false });
    console.log("[shot]", shot);

    const ours = await frameStats(page, "#frameOurs img");
    const base = await frameStats(page, "#frameBase img");

    if (!ours.ok) {
      fails.push(`${view}: ours ${ours.reason}`);
      continue;
    }

    console.log(
      `[${view}] ours src=${ours.src}`,
      `fg=${ours.fg} clip=${(ours.clipFrac * 100).toFixed(1)}%`,
      `stdMin=${ours.stdMin.toFixed(1)} mean=[${ours.mean.map((x) => x.toFixed(0)).join(",")}]`
    );

    if (assetRev && !ours.src.includes(`v=${assetRev}`)) {
      fails.push(`${view}: ours URL missing ?v=${assetRev} (browser cache/old index.html?)`);
    }

    if (ours.bg.every((v) => v < 250)) {
      fails.push(`${view}: PNG corner bg not white (gray slab?) bg=[${ours.bg.join(",")}]`);
    }

    // Blown-out: >8% near-white inside foreground bbox
    if (ours.clipFrac > 0.08) {
      fails.push(`${view}: ours blown-out white clip=${(ours.clipFrac * 100).toFixed(1)}%`);
    }

    if (ours.fg < 50000) {
      fails.push(`${view}: ours too sparse fg=${ours.fg} (broken/holes vs disk?)`);
    }

    if (base.ok && ours.stdMin < base.stdMin * 0.45) {
      fails.push(`${view}: ours too flat std=${ours.stdMin.toFixed(1)} base=${base.stdMin.toFixed(1)}`);
    }

    if (view === "front" && fs.existsSync(DISK_FRONT)) {
      const resp = await page.request.get(ours.src);
      const body = await resp.body();
      const netHash = sha256(body);
      const diskHash = sha256(fs.readFileSync(DISK_FRONT));
      console.log(`[front] network png sha256[:16]=${netHash} disk=${diskHash} match=${netHash === diskHash}`);
      if (netHash !== diskHash) {
        fails.push("front: browser loaded PNG != disk muscle_front.png (stale cache or wrong file)");
      }
    }
    // Bbox white vs Base: oval head on #FFF has ~45–55% bbox white (NOT holes).
    // Fail only if ours is much emptier than Base (true missing Static / eaten flood).
    if (view === "front") {
      const holes = await page.evaluate(() => {
        function bboxWhite(sel) {
          const img = document.querySelector(sel);
          if (!img || !img.complete) return { ok: false, reason: "no img" };
          const w = img.naturalWidth;
          const h = img.naturalHeight;
          const c = document.createElement("canvas");
          c.width = w;
          c.height = h;
          const ctx = c.getContext("2d");
          ctx.drawImage(img, 0, 0);
          const px = ctx.getImageData(0, 0, w, h).data;
          const bg = [px[0], px[1], px[2]];
          const fg = new Uint8Array(w * h);
          for (let i = 0, p = 0; i < px.length; i += 4, p++) {
            const d = Math.abs(px[i] - bg[0]) + Math.abs(px[i + 1] - bg[1]) + Math.abs(px[i + 2] - bg[2]);
            fg[p] = d > 60 ? 1 : 0;
          }
          let minX = w, minY = h, maxX = 0, maxY = 0;
          for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
              if (!fg[y * w + x]) continue;
              minX = Math.min(minX, x);
              minY = Math.min(minY, y);
              maxX = Math.max(maxX, x);
              maxY = Math.max(maxY, y);
            }
          }
          if (maxX <= minX) return { ok: false, reason: "empty fg" };
          let white = 0;
          let total = 0;
          let fgN = 0;
          for (let y = minY; y <= maxY; y++) {
            for (let x = minX; x <= maxX; x++) {
              total++;
              const i = (y * w + x) * 4;
              if (fg[y * w + x]) fgN++;
              if (px[i] >= 250 && px[i + 1] >= 250 && px[i + 2] >= 250) white++;
            }
          }
          return { ok: true, holeFrac: white / total, fill: fgN / total };
        }
        return { ours: bboxWhite("#frameOurs img"), base: bboxWhite("#frameBase img") };
      });
      if (!holes.ours.ok) fails.push(`front: hole-check ${holes.ours.reason}`);
      else {
        const oh = holes.ours.holeFrac;
        const bh = holes.base.ok ? holes.base.holeFrac : 0.5;
        const fill = holes.ours.fill;
        const bfill = holes.base.ok ? holes.base.fill : 0.5;
        console.log(
          `[front] bbox white ours=${(oh * 100).toFixed(1)}% base=${(bh * 100).toFixed(1)}% ` +
            `fill ours=${(fill * 100).toFixed(1)}% base=${(bfill * 100).toFixed(1)}%`
        );
        if (oh > bh + 0.12) fails.push(`front: bbox white ${(oh * 100).toFixed(1)}% vs Base ${(bh * 100).toFixed(1)}%`);
        if (fill < bfill * 0.72) fails.push(`front: bbox fill ${(fill * 100).toFixed(1)}% vs Base ${(bfill * 100).toFixed(1)}%`);
      }
    }
  }

  await browser.close();

  if (fails.length) {
    console.error("\n[WEB SELFTEST FAIL]");
    fails.forEach((f) => console.error(" -", f));
    console.error("screenshots:", OUT);
    process.exit(1);
  }
  console.log("\n[WEB SELFTEST PASS] side-by-side front/side/back OK");
  console.log("screenshots:", OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
