const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

/**
 * Sketchboard 受控读取：
 * 1) 打开页面（headful）
 * 2) 等待你在弹出浏览器里完成登录
 * 3) 自动截屏多个区域（用于后续逐段识别）
 *
 * 使用方式：
 *   SKETCHBOARD_URL="https://sketchboard.me/..." WAIT_LOGIN_MS=180000 node scripts/sketchboard-read.js
 */

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function stampNow() {
  // 避免 Windows 文件名非法字符
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function main() {
  const SKETCHBOARD_URL =
    process.env.SKETCHBOARD_URL ||
    "https://sketchboard.me/tDXYTQfNbtUP#/menu";

  const WAIT_LOGIN_MS = parseInt(process.env.WAIT_LOGIN_MS || "180000", 10);

  const scriptsDir = __dirname;
  const runsDir = path.resolve(scriptsDir, "../runs");
  ensureDir(runsDir);

  const outDir = path.join(runsDir, `sketchboard-read-${stampNow()}`);
  ensureDir(outDir);

  // 用固定目录保留 profile，便于下次不必重复登录
  const userDataDir = path.resolve(runsDir, "sketchboard-user-data");
  const executablePath =
    process.env.PLAYWRIGHT_EXECUTABLE_PATH ||
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

  console.log("[sketchboard-read] outDir:", outDir);
  console.log("[sketchboard-read] WAIT_LOGIN_MS:", WAIT_LOGIN_MS);
  console.log("[sketchboard-read] SKETCHBOARD_URL:", SKETCHBOARD_URL);
  console.log("[sketchboard-read] executablePath:", executablePath);

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1600, height: 900 },
    executablePath,
  });

  const page = await context.newPage();

  // 更贴近“你打开的那个页面”的可读性
  page.setDefaultTimeout(30_000);

  await page.goto(SKETCHBOARD_URL, { waitUntil: "domcontentloaded" });

  // 给你足够时间在受控浏览器里手动登录
  console.log("[sketchboard-read] waiting for manual login...");
  await page.waitForTimeout(WAIT_LOGIN_MS);

  // 快速判断是否仍是“无权限”登录页（用于失败提示）
  let denial = 0;
  try {
    denial = await page.locator("text=/not allowed to access/i").count();
  } catch (_) {}
  console.log("[sketchboard-read] denialCount:", denial);

  // 截屏策略：
  // 1) 当前视口
  // 2) fullPage（若页面支持）
  // 3) 尝试按 scrollHeight/scrollWidth 做几个关键位置的截图
  await page.waitForTimeout(800);

  await page.screenshot({ path: path.join(outDir, "viewport.png"), fullPage: false });
  try {
    await page.screenshot({ path: path.join(outDir, "fullpage.png"), fullPage: true });
  } catch (e) {
    console.log("[sketchboard-read] fullPage screenshot failed:", String(e));
  }

  // 多点截屏（有些画布/画板内容会随着页面滚动或容器滚动变化）
  let metrics = { scrollWidth: 0, scrollHeight: 0, clientWidth: 0, clientHeight: 0 };
  try {
    metrics = await page.evaluate(() => {
      const el = document.scrollingElement || document.documentElement;
      return {
        scrollWidth: el.scrollWidth || 0,
        scrollHeight: el.scrollHeight || 0,
        clientWidth: el.clientWidth || 0,
        clientHeight: el.clientHeight || 0,
      };
    });
  } catch (_) {}

  const maxX = Math.max(0, metrics.scrollWidth - metrics.clientWidth);
  const maxY = Math.max(0, metrics.scrollHeight - metrics.clientHeight);

  const xSteps = [0, Math.round(maxX * 0.5), maxX];
  const ySteps = [0, Math.round(maxY * 0.5), maxY];
  const shots = [];
  for (let yi = 0; yi < ySteps.length; yi++) {
    for (let xi = 0; xi < xSteps.length; xi++) {
      shots.push({ x: xSteps[xi], y: ySteps[yi] });
    }
  }

  // 避免生成太多大图：默认最多 5 张滚动截图
  const maxShots = 5;
  const useShots = shots.slice(0, maxShots);

  for (let i = 0; i < useShots.length; i++) {
    const { x, y } = useShots[i];
    try {
      await page.evaluate(({ x, y }) => window.scrollTo(x, y), { x, y });
      await page.waitForTimeout(600);
      await page.screenshot({ path: path.join(outDir, `scroll_${i + 1}.png`), fullPage: false });
    } catch (e) {
      console.log("[sketchboard-read] scroll screenshot failed:", i + 1, String(e));
    }
  }

  // 不关闭浏览器：方便你回头检查截屏效果
  // 如果你希望自动关闭，把这里注释取消即可
  // await context.close();

  console.log("[sketchboard-read] done. Screenshots at:", outDir);
}

main().catch((e) => {
  console.error("[sketchboard-read] fatal:", e);
  process.exit(1);
});

