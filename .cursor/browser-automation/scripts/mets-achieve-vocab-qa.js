/**
 * 验收：成就词库本轮交付（选词入口 / 沉浸顶栏 / 勋章 / 成就之路 / 设置 / 记号）
 */
require("./_playwright-browsers-path");
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE =
  process.env.METS_URL ||
  "http://127.0.0.1:18080/%E4%B8%B4%E6%97%B6_METS%E4%BA%8C%E7%BA%A7%E5%A4%87%E8%80%83/05_%E8%83%8C%E8%AF%8D%E7%BD%91%E9%A1%B5/dist/";
const outDir = path.join(__dirname, "..", "runs", "mets-achieve-vocab-qa");
fs.mkdirSync(outDir, { recursive: true });

const report = { ok: true, checks: [], errors: [] };

function check(name, pass, detail) {
  report.checks.push({ name, pass: !!pass, detail: detail || "" });
  if (!pass) report.ok = false;
}

(async () => {
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || "msedge",
    headless: true,
  });
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: "zh-CN",
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => report.errors.push("PAGEERROR " + e.message));

  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.evaluate(() => {
    localStorage.clear();
    try {
      indexedDB.deleteDatabase("mets-l2-vocab");
    } catch (_) {}
  });
  await page.reload({ waitUntil: "networkidle", timeout: 60000 });
  await page.waitForSelector(".pack-achieve-row, .pack-kind-select", {
    timeout: 25000,
  });

  // —— 1. 选词页：成就词库入口，无易忘 ——
  const pickText = await page.locator("main").innerText();
  check("无易忘词文案", !/易忘/.test(pickText), pickText.slice(0, 200));
  const achieveRow = page.locator(".pack-achieve-row");
  check("有成就词库行", (await achieveRow.count()) === 1);
  const achieveHtml = await achieveRow.innerHTML();
  check("标题成就词库", /成就词库/.test(achieveHtml));
  check("副标题英→中已掌握", /英→中已掌握/.test(achieveHtml));
  await page.screenshot({
    path: path.join(outDir, "01-pack-pick.png"),
    fullPage: false,
  });

  // 空成就库点击：不应误跳选词（应进空库提示或学习壳）
  await achieveRow.click();
  await page.waitForTimeout(600);
  const afterEmpty = await page.evaluate(() => ({
    hasPick: !!document.querySelector(".pack-achieve-row"),
    emptyTip: document.body.innerText.includes("成就词库暂无词"),
    title: document.querySelector("#top-title")?.textContent || "",
  }));
  check(
    "空成就库不误跳选词",
    afterEmpty.emptyTip && !afterEmpty.hasPick,
    JSON.stringify(afterEmpty)
  );
  await page.screenshot({
    path: path.join(outDir, "01b-empty-achieve.png"),
    fullPage: false,
  });
  // 回选词
  const backBtn = page.locator("#achieve-empty-back");
  if (await backBtn.count()) await backBtn.click();
  else await page.click(".pack-back").catch(() => {});
  await page.waitForSelector(".pack-achieve-row", { timeout: 10000 });

  // 分组 badge 含 英→中 N%
  const badges = await page.locator(".pack-check-body .badge, .pack-seg .badge, .pack-group-badge, .badge").allTextContents();
  const badgeJoined = badges.join(" | ");
  // 选词页分组可能在 pack-check 或场景列表
  const mainBadges = await page.evaluate(() => {
    const nodes = [...document.querySelectorAll(".badge")];
    return nodes.map((n) => n.textContent.trim()).filter(Boolean);
  });
  const hasPct = mainBadges.some((t) => /英→中\s*\d+%/.test(t));
  check("分组 badge 英→中 N%", hasPct, mainBadges.slice(0, 8).join(" ; "));

  // —— 注入成就词 + 日数据 ——
  await page.evaluate(() => {
    const day = (() => {
      const d = new Date();
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
    })();
    localStorage.setItem(
      "mets-l2-achieve-words-v1",
      JSON.stringify({
        "972": { streak: 10, dayKey: day, dayValid: 3, achievedAt: Date.now() },
        "898": { streak: 10, dayKey: day, dayValid: 2, achievedAt: Date.now() - 1000 },
      })
    );
    localStorage.setItem(
      "mets-l2-achieve-days-v1",
      JSON.stringify({
        [day]: { validSwitches: 12, newAchieve: 2, planTicks: 40 },
      })
    );
    // 避免会话词包把刷新后直接带进学习壳，选词页测入口
    localStorage.removeItem("mets-current-pack-v1");
    sessionStorage.removeItem("mets-current-pack");
  });
  await page.reload({ waitUntil: "networkidle", timeout: 60000 });
  await page.waitForSelector(".pack-achieve-row", { timeout: 20000 });
  const badgeCount = await page.locator("#achieve-count").innerText();
  check("成就计数显示词数", /2\s*词/.test(badgeCount), badgeCount);
  await page.screenshot({
    path: path.join(outDir, "02-pack-pick-with-achieve.png"),
    fullPage: false,
  });

  // 选一组进学习（列模式看记号）
  const toggle = page.locator(".pack-list-head .pack-link");
  if ((await toggle.count()) && (await toggle.innerText()) === "全选") {
    await toggle.click();
  }
  const first = page.locator(".pack-check-body input").first();
  if (await first.count()) {
    if (!(await first.isChecked())) await first.check();
  }
  await page.click(".pack-enter-btn");
  await page.waitForSelector(".immerse-root", { timeout: 15000 });

  // —— 2. 沉浸顶栏仅 英/中/列 ——
  const modeLabels = (
    await page.locator(".immerse-mode-btn").allTextContents()
  ).map((t) => t.trim());
  check(
    "顶栏仅英中列",
    modeLabels.length === 3 &&
      modeLabels.includes("英") &&
      modeLabels.includes("中") &&
      modeLabels.includes("列") &&
      !modeLabels.includes("中英"),
    modeLabels.join(",")
  );

  // 切到列看 ach-mark
  await page.locator(".immerse-mode-btn", { hasText: /^列$/ }).click();
  await page.waitForSelector(".immerse-list-mode", { timeout: 8000 });
  const markCount = await page.locator(".ach-mark").count();
  check("列表有 ach-mark", markCount >= 1, `marks=${markCount}`);
  // 滚到有记号的词再截
  await page.evaluate(() => {
    const m = document.querySelector(".list-item--achieved, .ach-mark");
    m?.closest(".list-item")?.scrollIntoView({ block: "center" });
  });
  await page.screenshot({
    path: path.join(outDir, "02b-list-ach-mark.png"),
    fullPage: false,
  });

  // 切到英
  await page.locator(".immerse-mode-btn", { hasText: /^英$/ }).click();
  await page.waitForSelector(".immerse-stage", { timeout: 8000 });
  const medal = page.locator(".immerse-medal");
  const speaker = page.locator(".immerse-icon-btn").filter({
    has: page.locator("svg"),
  });
  check("左下角勋章存在", (await medal.count()) === 1);
  const medalBox = await medal.boundingBox();
  const speakerBtn = page.locator('[aria-label*="音"], [aria-label*="喇叭"], .immerse-speaker, .immerse-audio-btn').first();
  let speakerBox = null;
  if (await speakerBtn.count()) speakerBox = await speakerBtn.boundingBox();
  // 喇叭常见 aria
  if (!speakerBox) {
    const allIcons = page.locator(".immerse-icon-btn");
    const n = await allIcons.count();
    for (let i = 0; i < n; i++) {
      const el = allIcons.nth(i);
      const cls = (await el.getAttribute("class")) || "";
      const aria = (await el.getAttribute("aria-label")) || "";
      if (!cls.includes("medal") && (aria.includes("音") || aria.includes("读") || aria.includes("喇叭") || cls.includes("audio") || cls.includes("speak"))) {
        speakerBox = await el.boundingBox();
        break;
      }
    }
    // fallback: 非 medal 的右下角按钮
    if (!speakerBox) {
      for (let i = 0; i < n; i++) {
        const el = allIcons.nth(i);
        const cls = (await el.getAttribute("class")) || "";
        if (!cls.includes("medal")) {
          const box = await el.boundingBox();
          if (box && box.y > 600) {
            speakerBox = box;
            break;
          }
        }
      }
    }
  }
  check(
    "勋章偏左、喇叭偏右",
    !!(medalBox && speakerBox && medalBox.x < speakerBox.x),
    JSON.stringify({ medalBox, speakerBox })
  );
  await page.screenshot({
    path: path.join(outDir, "03-immerse-en-medal.png"),
    fullPage: false,
  });

  // —— 3. 成就之路 ——
  await medal.click();
  await page.waitForSelector(".achieve-path", { timeout: 10000 });
  const pathText = await page.locator(".achieve-path").innerText();
  check("成就之路标题", /成就之路/.test(pathText));
  check("有表格", (await page.locator(".achieve-path-table").count()) === 1);
  check("有 SVG 曲线", (await page.locator(".achieve-path-svg").count()) === 1);
  check("缺口用 —", /—/.test(pathText));
  const todayRow = await page.evaluate(() => {
    const day = (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    })();
    const trs = [...document.querySelectorAll(".achieve-path-table tbody tr")];
    const hit = trs.find((tr) => tr.textContent.includes(day));
    return hit ? hit.innerText.replace(/\s+/g, " ") : null;
  });
  check("今日有数据行", !!(todayRow && /12/.test(todayRow)), todayRow);
  await page.screenshot({
    path: path.join(outDir, "04-achieve-path.png"),
    fullPage: false,
  });

  // 返回后应回学习而非选词
  await page.click("#ap-back");
  await page.waitForTimeout(500);
  const afterPathBack = await page.evaluate(() => ({
    immerse: !!document.querySelector(".immerse-root"),
    pick: !!document.querySelector(".pack-achieve-row"),
    path: !!document.querySelector(".achieve-path"),
  }));
  check(
    "成就之路返回回学习",
    afterPathBack.immerse && !afterPathBack.pick && !afterPathBack.path,
    JSON.stringify(afterPathBack)
  );

  // —— 4. 「我的」设置（顶栏齿轮 #btn-settings）——
  if (await page.locator('[aria-label="退出"]').count()) {
    await page.locator('[aria-label="退出"]').click();
    await page.waitForTimeout(400);
  }
  await page.locator("#btn-settings").click();
  await page.waitForSelector("#set-plan-rounds", { timeout: 12000 });
  const settingsVisible = await page.evaluate(() => ({
    rounds: !!document.querySelector("#set-plan-rounds"),
    roundSize: !!document.querySelector("#set-plan-round-size"),
    mini: !!document.querySelector("#set-plan-mini"),
    cap: !!document.querySelector("#set-achieve-cap"),
    need: !!document.querySelector("#set-achieve-need"),
    labels: [...document.querySelectorAll("label")]
      .map((l) => l.textContent.trim())
      .filter((t) => /计划|成就|小阶段|进库|有效/.test(t)),
  }));
  check("设置：计划轮数", settingsVisible.rounds);
  check("设置：每轮次数", settingsVisible.roundSize);
  check("设置：小阶段", settingsVisible.mini);
  check("设置：成就日上限", settingsVisible.cap);
  check("设置：进库次数", settingsVisible.need, settingsVisible.labels.join(";"));

  await page.fill("#set-plan-rounds", "4");
  await page.fill("#set-achieve-need", "8");
  // 新数字项未绑 change→persist；验收「可保存」= 点返回 flush 兜底
  const liveBeforeLeave = await page.evaluate(() => ({
    rounds: document.querySelector("#set-plan-rounds")?.value,
    need: document.querySelector("#set-achieve-need")?.value,
  }));
  check(
    "设置表单显示改值",
    liveBeforeLeave.rounds === "4" && liveBeforeLeave.need === "8",
    JSON.stringify(liveBeforeLeave)
  );
  await page.screenshot({
    path: path.join(outDir, "05-settings.png"),
    fullPage: true,
  });
  await page.locator(".pack-back").click();
  await page.waitForTimeout(300);
  const saved = await page.evaluate(() => {
    const raw = localStorage.getItem("mets-l2-settings-v1");
    return raw ? JSON.parse(raw) : null;
  });
  check(
    "返回后设置已 flush 保存",
    saved && Number(saved.planDailyRounds) === 4 && Number(saved.achieveStreakNeed) === 8,
    JSON.stringify(saved && {
      planDailyRounds: saved.planDailyRounds,
      achieveStreakNeed: saved.achieveStreakNeed,
    })
  );
  // 沉浸会藏顶栏：先退出再测「改完即存」
  if (await page.locator('[aria-label="退出"]').count()) {
    await page.locator('[aria-label="退出"]').click();
    await page.waitForTimeout(400);
  }
  await page.locator("#btn-settings").click({ timeout: 8000 });
  await page.waitForSelector("#set-plan-rounds", { timeout: 8000 });
  await page.fill("#set-plan-rounds", "5");
  await page.locator("#set-plan-rounds").dispatchEvent("change");
  await page.waitForTimeout(150);
  const mid = await page.evaluate(() => {
    const raw = localStorage.getItem("mets-l2-settings-v1");
    return raw ? JSON.parse(raw) : null;
  });
  check(
    "改完即自动保存(数字项change)",
    mid && Number(mid.planDailyRounds) === 5,
    JSON.stringify(mid && { planDailyRounds: mid.planDailyRounds })
  );

  // —— 清理测试数据 ——
  await page.evaluate(() => {
    localStorage.removeItem("mets-l2-achieve-words-v1");
    localStorage.removeItem("mets-l2-achieve-days-v1");
    localStorage.removeItem("mets-l2-achieve-plan-v1");
    localStorage.removeItem("mets-l2-settings-v1");
    try {
      indexedDB.deleteDatabase("mets-l2-vocab");
    } catch (_) {}
  });
  check("验收后已清测试 localStorage", true);

  await browser.close();
  fs.writeFileSync(
    path.join(outDir, "report.json"),
    JSON.stringify(report, null, 2),
    "utf8"
  );
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok && report.errors.length === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
