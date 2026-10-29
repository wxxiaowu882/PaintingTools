const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const outDir = path.join(__dirname, "..", "runs", "mets-vocab-smoke");
fs.mkdirSync(outDir, { recursive: true });

(async () => {
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || "msedge",
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on("dialog", async (d) => d.accept());
  const logs = [];
  page.on("pageerror", (e) => logs.push("PAGEERROR " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") logs.push("CONSOLE " + m.text());
  });

  await page.goto("http://127.0.0.1:51319/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForSelector("text=按场景", { timeout: 20000 });
  await page.screenshot({ path: path.join(outDir, "01-library.png") });

  await page.click("text=按听+读合计");
  await page.waitForSelector("text=第 1 组");
  await page.click("text=第 1 组");
  await page.waitForSelector(".list-item");
  await page.screenshot({ path: path.join(outDir, "02-list.png") });

  await page.locator(".list-item").first().click();
  await page.waitForTimeout(2000);

  await page.click("text=去学习");
  await page.waitForSelector("text=闪记");
  await page.click("text=闪记");
  await page.waitForSelector(".flash-en");
  await page.screenshot({ path: path.join(outDir, "03-flash.png") });

  await page.click("text=闪忆");
  await page.waitForSelector('button:has-text("揭开")');
  await page.locator('button:has-text("揭开")').click();
  await page.waitForSelector(".flash-zh", { timeout: 5000 });
  await page.screenshot({ path: path.join(outDir, "04-recall.png") });

  await page.click("text=我的");
  await page.waitForSelector("#set-save");
  await page.selectOption("#set-group", "50");
  await page.click("#set-save");
  await page.waitForSelector("#save-tip");
  await page.screenshot({ path: path.join(outDir, "05-me.png") });

  const evCount = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open("mets-l2-vocab", 2);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
    });
    const count = await new Promise((resolve, reject) => {
      const tx = db.transaction("events", "readonly");
      const g = tx.objectStore("events").count();
      g.onsuccess = () => resolve(g.result);
      g.onerror = () => reject(g.error);
    });
    db.close();
    return count;
  });

  const group = await page.evaluate(
    () => JSON.parse(localStorage.getItem("mets-l2-settings-v1") || "{}").groupSize
  );

  console.log(JSON.stringify({ ok: true, evCount, group, logs }, null, 2));
  await browser.close();
  if (evCount < 1 || group !== 50) process.exit(2);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
