/**
 * Visual QA: side-by-side + slider + GLB for compare review page.
 * Run: node scripts/compare-review-visual-screenshot.js [CAND]
 */
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const CAND = process.argv[2] || "SHELL_v8";
const RUNS = path.resolve(__dirname, "../runs");
const OUT = path.join(RUNS, `compare_visual_${CAND}_${Date.now()}`);
const PRIMARY = ["front", "side", "back"];
const URL = "http://127.0.0.1:8765/";

async function waitImages(page, timeout = 12000) {
  await page.waitForFunction(
    () => {
      const imgs = document.querySelectorAll(".frame img, .slider-wrap img, .viewer-host canvas");
      if (!imgs.length) return false;
      for (const el of imgs) {
        if (el.tagName === "CANVAS") return true;
        if (!el.complete || el.naturalWidth < 8) return false;
      }
      return true;
    },
    { timeout }
  );
}

async function selectCand(page) {
  await page.waitForSelector("#cand");
  await page.selectOption("#cand", CAND);
  await page.waitForTimeout(800);
}

async function shot(page, name) {
  const p = path.join(OUT, name);
  await page.screenshot({ path: p, fullPage: false });
  console.log("[shot]", p);
  return p;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  try {
    await page.goto(URL, { waitUntil: "networkidle", timeout: 20000 });
  } catch (e) {
    console.error("[FAIL] 对照页未启动，请先运行 12_亚洲头肌对照页.bat");
    process.exit(1);
  }
  await selectCand(page);

  // 并排对照 — 主审三视
  await page.click('button[data-mode="side"]');
  for (const view of PRIMARY) {
    await page.click(`[data-view="${view}"]`);
    await page.waitForTimeout(2500);
    try {
      await page.waitForFunction(
        () => {
          const imgs = document.querySelectorAll(".frame img");
          if (imgs.length < 2) return false;
          for (const el of imgs) {
            if (!el.complete || !el.dataset.headTop) return false;
          }
          return true;
        },
        { timeout: 8000 }
      );
    } catch (e) {
      console.warn("[warn] align paint slow", view);
    }
    await shot(page, `sideby_${view}.png`);
  }

  // 拖拽叠图 — 正视
  await page.click('button[data-mode="slider"]');
  await page.click('[data-view="front"]');
  await page.waitForTimeout(1200);
  await waitImages(page).catch(() => {});
  await shot(page, "slider_front_half.png");
  await page.evaluate(() => {
    const wrap = document.getElementById("slider");
    const top = document.getElementById("layerBase");
    const handle = document.getElementById("handle");
    if (wrap && top && handle) {
      top.style.clipPath = "inset(0 50% 0 0)";
      handle.style.left = "50%";
    }
  });
  await page.waitForTimeout(300);
  await shot(page, "slider_front_mid.png");

  // 3D GLB
  await page.click('button[data-mode="viewer3d"]');
  await page.waitForTimeout(2500);
  const hasCanvas = await page.evaluate(() => document.querySelectorAll(".viewer-host canvas").length >= 2);
  if (hasCanvas) {
    await shot(page, "glb_viewer_front.png");
  } else {
    console.warn("[warn] GLB canvas missing");
    await shot(page, "glb_viewer_fail.png");
  }

  await browser.close();
  console.log("[done] screenshots ->", OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
