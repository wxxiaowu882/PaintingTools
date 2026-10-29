/**
 * 自测：设置顶栏；连闪不计成就有效；手动计；prev/中不计；计划连闪仍计（§6）
 */
require("./_playwright-browsers-path");
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE =
  process.env.METS_URL ||
  "http://127.0.0.1:18080/%E4%B8%B4%E6%97%B6_METS%E4%BA%8C%E7%BA%A7%E5%A4%87%E8%80%83/05_%E8%83%8C%E8%AF%8D%E7%BD%91%E9%A1%B5/dist/";
const outDir = path.join(__dirname, "..", "runs", "mets-count-settings-qa");
fs.mkdirSync(outDir, { recursive: true });
const report = { ok: true, checks: [], errors: [] };
function check(name, pass, detail) {
  report.checks.push({ name, pass: !!pass, detail: detail || "" });
  if (!pass) report.ok = false;
}

async function tapNext(page) {
  const box = await page.locator(".immerse-stage").boundingBox();
  await page.mouse.click(box.x + box.width * 0.85, box.y + box.height * 0.78);
  await page.waitForTimeout(500);
}
async function tapPrev(page) {
  const box = await page.locator(".immerse-stage").boundingBox();
  await page.mouse.click(box.x + box.width * 0.15, box.y + box.height * 0.78);
  await page.waitForTimeout(500);
}
async function dblAuto(page) {
  const box = await page.locator(".immerse-stage").boundingBox();
  await page.mouse.dblclick(box.x + box.width * 0.5, box.y + box.height * 0.78);
  await page.waitForTimeout(200);
}
function streakSum(map) {
  return Object.values(map || {}).reduce(
    (a, w) => a + (w.achievedAt ? 0 : Number(w.streak) || 0),
    0
  );
}

(async () => {
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || "msedge",
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on("pageerror", (e) => report.errors.push(e.message));

  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem(
      "mets-l2-settings-v1",
      JSON.stringify({
        groupSize: 100,
        flashIntervalMs: 700,
        voiceChannel: "both",
        playbackRate: 1,
        showIpa: true,
        showFreq: true,
        listCols: "both",
        lastStudyMode: "recallZh",
        immerseTheme: "night",
        immerseAudioOn: false,
        achieveDailyValidCap: 3,
        achieveStreakNeed: 10,
        planDailyRounds: 3,
        planRoundSize: 300,
        planMiniEvery: 50,
      })
    );
  });
  await page.reload({ waitUntil: "networkidle", timeout: 60000 });
  await page.waitForSelector("button:has-text('进入学习')", { timeout: 20000 });

  // —— 设置顶栏 ——
  await page.locator("#btn-settings").click();
  await page.waitForSelector("#set-plan-rounds", { timeout: 10000 });
  const settingsUi = await page.evaluate(() => ({
    centered: document.body.classList.contains("topbar-centered"),
    backIcon: !!document.querySelector(".topbar-back"),
    packBackInMain: !!document.querySelector("main .pack-back"),
    title: document.querySelector("#top-title")?.textContent || "",
  }));
  check("设置顶栏居中", settingsUi.centered, JSON.stringify(settingsUi));
  check("设置左上角图标返回", settingsUi.backIcon);
  check("设置页内无文字←返回", !settingsUi.packBackInMain);
  check("设置标题", settingsUi.title === "设置");
  await page.screenshot({ path: path.join(outDir, "01-settings-top.png") });
  await page.locator(".topbar-back").click();
  await page.waitForTimeout(300);

  // —— 进入英沉浸 ——
  await page.waitForSelector("button:has-text('进入学习')", { timeout: 10000 });
  await page.locator("button:has-text('进入学习')").first().click();
  await page.waitForSelector(".immerse-stage", { timeout: 15000 });
  await page.locator(".immerse-mode-btn", { hasText: "英" }).click();
  await page.waitForTimeout(300);

  // 清计数
  await page.evaluate(() => {
    localStorage.removeItem("mets-l2-achieve-words-v1");
    localStorage.removeItem("mets-l2-achieve-plan-v1");
    localStorage.removeItem("mets-l2-achieve-days-v1");
  });

  // —— 手动 next：成就 streak + 计划 ——
  await tapNext(page);
  await tapNext(page);
  const afterManual = await page.evaluate(() => ({
    words: JSON.parse(localStorage.getItem("mets-l2-achieve-words-v1") || "{}"),
    plan: JSON.parse(localStorage.getItem("mets-l2-achieve-plan-v1") || "null"),
  }));
  check(
    "手动下一词计成就有效",
    streakSum(afterManual.words) >= 1,
    JSON.stringify(afterManual.words)
  );
  check(
    "手动下一词计计划",
    (afterManual.plan?.ticks || 0) >= 2,
    JSON.stringify(afterManual.plan)
  );

  // —— prev：不再增加 ——
  const beforePrev = afterManual;
  await tapPrev(page);
  await tapPrev(page);
  const afterPrev = await page.evaluate(() => ({
    words: JSON.parse(localStorage.getItem("mets-l2-achieve-words-v1") || "{}"),
    plan: JSON.parse(localStorage.getItem("mets-l2-achieve-plan-v1") || "null"),
  }));
  check(
    "prev 不计成就",
    streakSum(afterPrev.words) === streakSum(beforePrev.words),
    `before=${streakSum(beforePrev.words)} after=${streakSum(afterPrev.words)}`
  );
  check(
    "prev 不计计划",
    (afterPrev.plan?.ticks || 0) === (beforePrev.plan?.ticks || 0),
    `before=${beforePrev.plan?.ticks} after=${afterPrev.plan?.ticks}`
  );

  // —— 连闪：计划增加、成就 streak 不增加 ——
  await page.evaluate(() => {
    localStorage.setItem("mets-l2-achieve-words-v1", "{}");
  });
  const planBeforeAuto = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("mets-l2-achieve-plan-v1") || "null")
  );
  await dblAuto(page);
  await page.waitForTimeout(2800);
  await dblAuto(page);
  await page.waitForTimeout(400);
  const afterAuto = await page.evaluate(() => ({
    words: JSON.parse(localStorage.getItem("mets-l2-achieve-words-v1") || "{}"),
    plan: JSON.parse(localStorage.getItem("mets-l2-achieve-plan-v1") || "null"),
  }));
  check(
    "连闪不计成就有效(§3)",
    streakSum(afterAuto.words) === 0 &&
      !Object.values(afterAuto.words).some((w) => w.achievedAt),
    JSON.stringify(afterAuto.words)
  );
  check(
    "连闪不计计划(§6)",
    (afterAuto.plan?.ticks || 0) === (planBeforeAuto?.ticks || 0),
    `before=${planBeforeAuto?.ticks} after=${afterAuto.plan?.ticks}`
  );

  // —— 中模式切词：不计 ——
  const snap = await page.evaluate(() => ({
    words: localStorage.getItem("mets-l2-achieve-words-v1"),
    plan: localStorage.getItem("mets-l2-achieve-plan-v1"),
  }));
  await page.locator(".immerse-mode-btn", { hasText: "中" }).click();
  await page.waitForTimeout(500);
  // 清掉偷看 toast 带来的副作用后记快照：peek 可能清零，计划不应因中切词增加
  await page.evaluate(() => {
    // 保留计划 ticks，只看中模式切词后是否再涨
  });
  const planAtZh = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("mets-l2-achieve-plan-v1") || "null")
  );
  const box = await page.locator(".immerse-stage").boundingBox();
  await page.mouse.click(box.x + box.width * 0.85, box.y + box.height * 0.78);
  await page.waitForTimeout(500);
  await page.mouse.click(box.x + box.width * 0.85, box.y + box.height * 0.78);
  await page.waitForTimeout(500);
  const afterZh = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("mets-l2-achieve-plan-v1") || "null")
  );
  check(
    "中模式切词不计计划",
    (afterZh?.ticks || 0) === (planAtZh?.ticks || 0),
    `atZh=${planAtZh?.ticks} after=${afterZh?.ticks}`
  );
  void snap;

  await page.screenshot({ path: path.join(outDir, "02-immerse.png") });
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await browser.close();
  fs.writeFileSync(
    path.join(outDir, "report.json"),
    JSON.stringify(report, null, 2)
  );
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok && report.errors.length === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
