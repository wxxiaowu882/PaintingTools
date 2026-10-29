/**
 * 验收：进学习直进沉浸；顶栏 中英/英/中/列 互切；退出回选词库；记住上次模式
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE = process.env.METS_URL || "http://127.0.0.1:8787/";
const outDir = path.join(__dirname, "..", "runs", "mets-immerse-modes-qa");
fs.mkdirSync(outDir, { recursive: true });

async function clickMode(page, label) {
  await page.locator(".immerse-mode-btn", { hasText: new RegExp(`^${label}$`) }).click();
  await page.waitForFunction(
    (want) => document.querySelector(".immerse-mode-btn.on")?.textContent === want,
    label,
    { timeout: 8000 }
  );
}

(async () => {
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || "msedge",
    headless: true,
  });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const logs = [];
  page.on("pageerror", (e) => logs.push("PAGEERROR " + e.message));

  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.evaluate(() => {
    localStorage.clear();
    try {
      indexedDB.deleteDatabase("mets-l2-vocab");
    } catch (_) {}
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".pack-kind-seg", { timeout: 20000 });

  const toggle = page.locator(".pack-list-head .pack-link");
  if ((await toggle.innerText()) === "全选") await toggle.click();
  const first = page.locator(".pack-check-body input").first();
  if (!(await first.isChecked())) await first.check();
  await page.click(".pack-enter-btn");

  await page.waitForSelector(".immerse-root.immerse-list-mode", { timeout: 12000 });
  const modeLabels = await page.locator(".immerse-mode-btn").allTextContents();
  const onLabel = await page.locator(".immerse-mode-btn.on").innerText();
  await page.screenshot({ path: path.join(outDir, "01-list.png") });

  await clickMode(page, "中英");
  await page.waitForSelector(".immerse-stage .flash-en", { timeout: 8000 });
  const afterFlash = await page.evaluate(() => ({
    roots: document.querySelectorAll(".immerse-root").length,
    on: document.querySelector(".immerse-mode-btn.on")?.textContent,
    hasList: !!document.querySelector(".immerse-list-mode"),
  }));
  await page.screenshot({ path: path.join(outDir, "02-flash.png") });

  await clickMode(page, "英");
  await page.screenshot({ path: path.join(outDir, "03-en.png") });

  await clickMode(page, "中");
  await page.screenshot({ path: path.join(outDir, "04-zh.png") });

  await page.click('[aria-label="退出"]');
  await page.waitForSelector(".pack-kind-seg", { timeout: 10000 });
  const noImmerse = await page.evaluate(
    () => document.querySelectorAll(".immerse-root").length
  );

  const back = page.locator(".pack-back");
  if (await back.count()) await back.click();
  else await page.click(".pack-enter-btn");

  await page.waitForSelector(".immerse-root", { timeout: 10000 });
  const restored = await page.locator(".immerse-mode-btn.on").innerText();
  await page.screenshot({ path: path.join(outDir, "05-restored.png") });

  const hasOuterModeBar = await page.evaluate(() => {
    const bar = document.querySelector(".mode-bar.mode-bar-4:not(.pack-kind-seg)");
    return !!bar && !document.body.classList.contains("immersed");
  });

  const result = {
    ok: true,
    modeLabels,
    onLabel,
    afterFlash,
    restored,
    noImmerse,
    hasOuterModeBar,
    logs,
  };
  console.log(JSON.stringify(result, null, 2));
  fs.writeFileSync(path.join(outDir, "result.json"), JSON.stringify(result, null, 2));
  await browser.close();

  if (modeLabels.join(",") !== "中英,英,中,列") throw new Error("bad labels");
  if (onLabel !== "列") throw new Error("default not 列");
  if (afterFlash.roots !== 1 || afterFlash.on !== "中英" || afterFlash.hasList) {
    throw new Error("flash switch failed " + JSON.stringify(afterFlash));
  }
  if (restored !== "中") throw new Error("did not remember 中, got " + restored);
  if (noImmerse !== 0) throw new Error("immerse leaked");
  if (hasOuterModeBar) throw new Error("outer study mode-bar still visible");
  if (logs.some((l) => l.startsWith("PAGEERROR"))) process.exit(2);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
