/**
 * 贴图修边 UI 自测
 */
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

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

  await page.goto(UI, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForFunction(() => {
    const t = document.getElementById("load-hint")?.textContent || "";
    return t.includes("贴图") || t.includes("失败") || t.includes("已加载");
  }, null, { timeout: 30000 });

  const hint = await page.locator("#load-hint").innerText();
  if (hint.includes("失败") || hint.includes("旧版")) throw new Error(hint);

  const canvas = page.locator("#view canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("no canvas");
  await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.4);
  await page.waitForTimeout(400);

  const shot = path.join(RUNS, "skull-refine-tex-ui.png");
  await page.screenshot({ path: shot, fullPage: true });
  await browser.close();

  const report = { ok: true, hint, shot, errors };
  fs.writeFileSync(path.join(RUNS, "skull-refine-tex-ui-report.json"), JSON.stringify(report, null, 2));
  console.log("SELFTEST_OK", JSON.stringify(report));
}

main().catch((e) => {
  console.error("SELFTEST_FAIL", e);
  process.exit(1);
});
