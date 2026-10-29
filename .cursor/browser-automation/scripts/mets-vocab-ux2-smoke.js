const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const out = path.join(__dirname, "..", "runs", "mets-vocab-ux2");
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const logs = [];
  page.on("pageerror", (e) => logs.push(e.message));
  await page.goto("http://127.0.0.1:8790/", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector("#lib-search");
  await page.fill("#lib-search", "auscultate");
  await page.waitForTimeout(500);
  await page.waitForSelector(".list-item");
  await page.screenshot({ path: path.join(out, "01-search.png") });

  await page.locator(".scene-item", { hasText: "按场景" }).click();
  await page.waitForSelector(".check-item");
  const firstLabel = await page.locator(".check-label").first().textContent();
  await page.screenshot({ path: path.join(out, "02-scenes.png") });
  await page.locator(".check-item").nth(0).locator("input").check();
  await page.locator(".check-item").nth(1).locator("input").check();
  await page.locator("button.primary").filter({ hasText: "进入" }).click();
  await page.waitForSelector(".list-item");
  await page.screenshot({ path: path.join(out, "03-multi-words.png") });

  const name = await page.evaluate(async () => {
    const m = await import("/js/db.js");
    return m.exportFilename(new Date(2026, 8, 23, 6, 20, 0));
  });

  await page.locator(".tab", { hasText: "词库" }).click();
  await page.locator(".scene-item", { hasText: "按场景" }).click();
  await page.waitForSelector(".check-item");
  const checked = await page.locator(".check-item input:checked").count();
  console.log(JSON.stringify({ firstLabel, name, checked, logs }, null, 2));
  await browser.close();
  if (!/^01\s/.test(firstLabel || "")) process.exit(3);
  if (name !== "mets-l2-2026-09-23-0620.json") process.exit(4);
  if (checked < 2) process.exit(5);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
