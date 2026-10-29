/**
 * 验收：圆形?图标；非首次进站直进沉浸并恢复词位/滚动
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE = process.env.METS_URL || "http://127.0.0.1:8787/";
const outDir = path.join(__dirname, "..", "runs", "mets-resume-qa");
fs.mkdirSync(outDir, { recursive: true });

(async () => {
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || "msedge",
    headless: true,
  });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const logs = [];
  page.on("pageerror", (e) => logs.push("PAGEERROR " + e.message));

  // —— 首次：清数据进选词 ——
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();
    await new Promise((resolve) => {
      const r = indexedDB.deleteDatabase("mets-l2-vocab");
      r.onsuccess = r.onerror = r.onblocked = () => resolve();
    });
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".pack-kind-seg", { timeout: 20000 });

  const toggle = page.locator(".pack-list-head .pack-link");
  if ((await toggle.innerText()) === "全选") await toggle.click();
  const first = page.locator(".pack-check-body input").first();
  if (!(await first.isChecked())) await first.check();
  await page.click(".pack-enter-btn");
  await page.waitForSelector(".immerse-root", { timeout: 12000 });

  // 圆形 ? 图标
  const helpSvg = await page.evaluate(() => {
    const btn = document.querySelector(".immerse-help-btn");
    const svg = btn?.querySelector("svg");
    const circle = svg?.querySelector("circle");
    return {
      hasSvg: !!svg,
      hasCircle: !!circle,
      text: (btn?.textContent || "").trim(),
    };
  });
  await page.screenshot({ path: path.join(outDir, "01-help-icon.png") });

  // 切到中英，翻到第 5 词
  await page.locator(".immerse-mode-btn", { hasText: /^中英$/ }).click();
  await page.waitForSelector(".flash-en", { timeout: 8000 });
  for (let i = 0; i < 4; i++) {
    await page.locator(".immerse-stage").click({ position: { x: 300, y: 200 } });
    await page.waitForTimeout(80);
  }
  await page.waitForTimeout(200);
  const before = await page.evaluate(() => {
    const prog = document.querySelector(".immerse-top .prog")?.textContent || "";
    const en = document.querySelector(".flash-en")?.textContent?.trim() || "";
    let resume = null;
    try {
      resume = JSON.parse(localStorage.getItem("mets-l2-study-resume-v1") || "null");
    } catch (_) {}
    let pack = null;
    try {
      pack = JSON.parse(localStorage.getItem("mets-current-pack-v1") || "null");
    } catch (_) {}
    return { prog, en, resume, packKey: pack?.key || null };
  });
  await page.screenshot({ path: path.join(outDir, "02-before-reload.png") });

  // —— 模拟再次进站：整页重载（不清 localStorage）——
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".immerse-root", { timeout: 15000 });
  // 应直进沉浸，且仍是中英第 5 词左右
  const after = await page.evaluate(() => {
    const on = document.querySelector(".immerse-mode-btn.on")?.textContent || "";
    const prog = document.querySelector(".immerse-top .prog")?.textContent || "";
    const en = document.querySelector(".flash-en")?.textContent?.trim() || "";
    const hasPicker = !!document.querySelector(".pack-kind-seg");
    return { on, prog, en, hasPicker, immersed: document.body.classList.contains("immersed") };
  });
  await page.screenshot({ path: path.join(outDir, "03-after-reload.png") });

  // 列表滚动恢复
  await page.locator(".immerse-mode-btn", { hasText: /^列$/ }).click();
  await page.waitForSelector(".immerse-list-scroll", { timeout: 8000 });
  await page.evaluate(() => {
    const el = document.querySelector(".immerse-list-scroll");
    if (el) el.scrollTop = 1200;
  });
  await page.waitForTimeout(250);
  const scrollBefore = await page.evaluate(
    () => document.querySelector(".immerse-list-scroll")?.scrollTop || 0
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".immerse-list-scroll", { timeout: 15000 });
  await page.waitForTimeout(200);
  const scrollAfter = await page.evaluate(
    () => document.querySelector(".immerse-list-scroll")?.scrollTop || 0
  );
  await page.screenshot({ path: path.join(outDir, "04-list-scroll.png") });

  const result = {
    ok: true,
    helpSvg,
    before,
    after,
    scrollBefore,
    scrollAfter,
    logs,
  };
  console.log(JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(outDir, "result.json"), JSON.stringify(result, null, 2));
  await browser.close();

  if (!helpSvg.hasSvg || !helpSvg.hasCircle || helpSvg.text) throw new Error("help icon not circle svg");
  if (after.hasPicker || after.on !== "中英") throw new Error("did not resume flash immerse: " + JSON.stringify(after));
  if (after.prog !== before.prog && after.en !== before.en) {
    // allow prog match primarily
    throw new Error("word position not restored: " + JSON.stringify({ before, after }));
  }
  if (Math.abs(scrollAfter - scrollBefore) > 80) {
    throw new Error("scroll not restored: " + scrollBefore + " -> " + scrollAfter);
  }
  if (logs.some((l) => l.startsWith("PAGEERROR"))) process.exit(2);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
