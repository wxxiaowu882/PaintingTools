/**
 * 头骨修边 UI 自测：加载、色板、骨缝线、刷子点涂、导出按钮可见。
 * 用法（仓库根已起 :8767）：
 *   node .cursor/browser-automation/scripts/skull-refine-ui-selftest.js
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "../../..");
const RUNS = path.join(__dirname, "../runs");
const UI =
  "http://127.0.0.1:8767/" +
  encodeURI("自用工具文件_不部署/头骨分色骨缝/web/");

async function main() {
  fs.mkdirSync(RUNS, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push("console:" + msg.text());
  });

  await page.goto(UI, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForFunction(() => {
    const t = document.getElementById("load-hint")?.textContent || "";
    return t.includes("已加载") || t.includes("失败");
  }, null, { timeout: 30000 });

  const hint = await page.locator("#load-hint").innerText();
  if (!hint.includes("已加载")) {
    throw new Error("load failed: " + hint + " | " + errors.join("; "));
  }

  const swatches = await page.locator("#palette .swatch").count();
  if (swatches < 5) throw new Error("palette too small: " + swatches);

  await page.click("#btn-sutures");
  await page.waitForTimeout(200);
  await page.click("#btn-sutures");
  await page.click("#btn-brush");

  // paint one brush stroke near canvas center
  const canvas = page.locator("#view canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no canvas");
  await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.42);
  await page.waitForTimeout(300);

  const shot = path.join(RUNS, "skull-refine-ui.png");
  await page.screenshot({ path: shot, fullPage: true });

  const exportBtn = await page.locator("#btn-export-json").isVisible();
  const glbBtn = await page.locator("#btn-export-glb").isVisible();
  if (!exportBtn || !glbBtn) throw new Error("export buttons missing");

  await browser.close();
  const report = {
    ok: true,
    hint,
    swatches,
    shot,
    errors,
  };
  fs.writeFileSync(path.join(RUNS, "skull-refine-ui-report.json"), JSON.stringify(report, null, 2));
  console.log("SELFTEST_OK", JSON.stringify(report));
}

main().catch((e) => {
  console.error("SELFTEST_FAIL", e);
  process.exit(1);
});
