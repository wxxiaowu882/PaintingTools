/**
 * METS 背词：滑动窗口改造后整体功能冒烟
 */
require("./_playwright-browsers-path");
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE =
  process.env.METS_URL ||
  "http://127.0.0.1:18080/%E4%B8%B4%E6%97%B6_METS%E4%BA%8C%E7%BA%A7%E5%A4%87%E8%80%83/05_%E8%83%8C%E8%AF%8D%E7%BD%91%E9%A1%B5/dist/";
const outDir = path.join(__dirname, "..", "runs", "mets-full-smoke");
fs.mkdirSync(outDir, { recursive: true });

const report = { ok: true, checks: [], errors: [], consoleErrors: [] };
function check(name, pass, detail) {
  report.checks.push({ name, pass: !!pass, detail: detail == null ? "" : String(detail) });
  if (!pass) report.ok = false;
}

(async () => {
  const browser = await chromium.launch({
    channel: process.env.PLAYWRIGHT_CHANNEL || "msedge",
    headless: true,
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on("pageerror", (e) => report.errors.push(String(e.message || e)));
  page.on("console", (m) => {
    if (m.type() === "error") report.consoleErrors.push(m.text());
  });

  await page.goto(BASE, { waitUntil: "networkidle", timeout: 60000 });
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.reload({ waitUntil: "networkidle", timeout: 60000 });

  // 1 选词库
  await page.waitForSelector(".pack-enter-btn", { timeout: 15000 });
  await page.waitForSelector(".pack-preview-section", { timeout: 10000 });
  const picker1 = await page.evaluate(() => ({
    checkbox: !!document.querySelector(".pack-check-card input[type=checkbox]"),
    sections: document.querySelectorAll(".pack-preview-section").length,
    rows: document.querySelectorAll(".pack-preview-row").length,
    sub: document.getElementById("top-sub")?.textContent || "",
    kinds: [...document.querySelectorAll("#pack-kind-select option")].map((o) => o.value),
  }));
  check("无分组勾选", !picker1.checkbox);
  check("有预览分组", picker1.sections >= 10, picker1.sections);
  check("进页无词行(懒加载)", picker1.rows === 0, picker1.rows);
  check("副标题含窗口", /窗口\s*100/.test(picker1.sub), picker1.sub);
  check(
    "四类大库",
    picker1.kinds.join(",") === "total,listen,read,scene",
    picker1.kinds.join(",")
  );

  await page.locator(".pack-preview-section summary").first().click();
  await page.waitForTimeout(150);
  const lazyRows = await page.locator(".pack-preview-row").count();
  check("点开分组加载词行", lazyRows > 0 && lazyRows <= 120, lazyRows);

  await page.selectOption("#pack-kind-select", "listen");
  await page.waitForTimeout(400);
  await page.waitForSelector(".pack-preview-section", { timeout: 8000 });
  const listenBtn = await page.locator(".pack-enter-btn").textContent();
  check("切换听频后按钮文案", /听力/.test(listenBtn || ""), listenBtn);

  await page.selectOption("#pack-kind-select", "scene");
  await page.waitForTimeout(500);
  const sceneSec = await page.locator(".pack-preview-section").count();
  check("场景库有多分组", sceneSec >= 5, sceneSec);

  await page.selectOption("#pack-kind-select", "total");
  await page.waitForTimeout(400);
  await page.locator(".pack-enter-btn").click();
  await page.waitForSelector(".immerse-root", { timeout: 15000 });

  const afterEnter = await page.evaluate(() => {
    const win = JSON.parse(localStorage.getItem("mets-l2-study-window-v1") || "{}");
    const pack = JSON.parse(localStorage.getItem("mets-current-pack-v1") || "{}");
    return {
      packKey: pack.key,
      packN: (pack.ids || []).length,
      winN: (win.ids || []).length,
    };
  });
  check("pack 整库 key", afterEnter.packKey === "freq:total:all", afterEnter.packKey);
  check("pack 全量 ids", afterEnter.packN === 1417, afterEnter.packN);
  check("窗口=100", afterEnter.winN === 100, afterEnter.winN);

  async function modeClick(label) {
    await page.locator(".immerse-mode-btn", { hasText: label }).click();
    await page.waitForTimeout(350);
  }

  // 2 列/中/英
  await modeClick("列");
  const listInfo = await page.evaluate(() => {
    const en = document.querySelectorAll(".list-block .en").length;
    const children = document.querySelectorAll(".list-block > *").length;
    return {
      en,
      children,
      planBar: !!document.querySelector(".immerse-plan-bar"),
    };
  });
  check("列模式无进度条", !listInfo.planBar, JSON.stringify(listInfo));
  check(
    "列显示约窗口词数",
    listInfo.en === 100 || listInfo.children === 100 || listInfo.en >= 80,
    JSON.stringify(listInfo)
  );

  await modeClick("中");
  const zhInfo = await page.evaluate(() => ({
    hasPrompt: !!document.querySelector(".immerse-prompt, .flash-zh"),
    planBar: !!document.querySelector(".immerse-plan-bar"),
    progress: (document.querySelector(".flash-progress")?.textContent || "").trim(),
  }));
  check("中模式有卡片", zhInfo.hasPrompt);
  check("中模式无进度条", !zhInfo.planBar);
  // 沉浸模式不挂 flash-progress（词序在 deck；英用底栏分数）

  await modeClick("英");
  const enInfo = await page.evaluate(() => ({
    text: (document.querySelector(".immerse-prompt, .flash-en")?.textContent || "").slice(0, 80),
    planBar: !!document.querySelector(".immerse-plan-bar"),
    foot: (document.querySelector(".immerse-foot")?.textContent || "").trim(),
  }));
  check("英模式有英文", /[a-zA-Z]/.test(enInfo.text), enInfo.text);
  check("英模式有进度条", enInfo.planBar);
  check("英模式有底栏分数", /\d+\s*\/\s*\d+/.test(enInfo.foot), enInfo.foot);

  const box = await page.locator(".immerse-stage").boundingBox();
  for (let i = 0; i < 3; i++) {
    await page.mouse.click(box.x + box.width * 0.85, box.y + box.height * 0.55);
    await page.waitForTimeout(280);
  }
  const afterNext = await page.evaluate(() => {
    const plan = JSON.parse(localStorage.getItem("mets-l2-achieve-plan-v1") || "{}");
    const days = JSON.parse(localStorage.getItem("mets-l2-achieve-days-v1") || "{}");
    const k = Object.keys(days)[0];
    return { ticks: plan.ticks || 0, valid: days[k]?.validSwitches || 0 };
  });
  check("手动下一词计划 ticks>=1", afterNext.ticks >= 1, JSON.stringify(afterNext));
  check("有效次数>=1", afterNext.valid >= 1, JSON.stringify(afterNext));

  // 人为删掉窗内一词，切模式触发 ensureWindow 应补满
  await page.evaluate(() => {
    const win = JSON.parse(localStorage.getItem("mets-l2-study-window-v1") || "{}");
    if (win.ids?.length) win.ids = win.ids.slice(1);
    localStorage.setItem("mets-l2-study-window-v1", JSON.stringify(win));
  });
  await modeClick("列");
  await modeClick("英");
  const refilled = await page.evaluate(() => {
    const win = JSON.parse(localStorage.getItem("mets-l2-study-window-v1") || "{}");
    return win.ids?.length;
  });
  check("ensureWindow 补满至100", refilled === 100, refilled);

  // 3 退出选词
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")];
    const exit = btns.find((b) => (b.getAttribute("aria-label") || "").includes("退出"));
    exit?.click();
  });
  await page.waitForTimeout(500);
  check("退出回选词库", (await page.locator(".pack-enter-btn").count()) >= 1);

  // 成就词库空态
  await page.locator(".pack-achieve-row").click();
  await page.waitForTimeout(500);
  const achieveEmpty = await page.evaluate(() =>
    /成就词库暂无词/.test(document.body.innerText)
  );
  check("空成就库提示", achieveEmpty);
  if (await page.locator(".topbar-back").count()) {
    await page.locator(".topbar-back").click();
  } else if (await page.locator("#achieve-empty-back").count()) {
    await page.locator("#achieve-empty-back").click();
  }
  await page.waitForTimeout(400);

  // 设置
  await page.locator("#btn-settings").click();
  await page.waitForTimeout(400);
  const settings = await page.evaluate(() => {
    const titles = [...document.querySelectorAll("details.settings-block > summary")].map((s) =>
      s.textContent.trim()
    );
    const opens = [...document.querySelectorAll("details.settings-block")].map((d) => d.open);
    return { titles, opens };
  });
  check(
    "设置三块标题",
    settings.titles.join(",") === "数据备份,通用配置,高级配置",
    settings.titles.join(",")
  );
  check(
    "备份通用展开高级收缩",
    !!(settings.opens[0] && settings.opens[1] && !settings.opens[2]),
    JSON.stringify(settings.opens)
  );

  await page.locator("summary", { hasText: "高级配置" }).click();
  await page.waitForTimeout(200);
  const adv = await page.evaluate(() => ({
    win: document.querySelector("#set-window-size")?.value,
    group: !!document.querySelector("#set-group"),
    clear: !!document.querySelector("#btn-clear-today"),
  }));
  check("滑动窗口默认100", adv.win === "100", adv.win);
  check("无每组词数", !adv.group);
  check("有清零今日", adv.clear);

  await page.fill("#set-window-size", "50");
  await page.locator("#set-window-size").dispatchEvent("change");
  await page.waitForTimeout(250);
  const win50 = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("mets-l2-settings-v1") || "{}");
    const w = JSON.parse(localStorage.getItem("mets-l2-study-window-v1") || "{}");
    return { setting: s.studyWindowSize, winN: w.ids?.length };
  });
  check("改N=50写入设置", win50.setting === 50, JSON.stringify(win50));
  check("改N后窗=50", win50.winN === 50, JSON.stringify(win50));

  // 搜词
  await page.locator(".topbar-back").click();
  await page.waitForTimeout(350);
  if (await page.locator("#btn-search").count()) {
    await page.locator("#btn-search").click();
    await page.waitForTimeout(200);
    await page.fill("#search-input", "brain");
    await page.waitForTimeout(450);
    const searchHits = await page.evaluate(
      () => document.querySelector("#search-results")?.innerText?.length || 0
    );
    check("搜词有结果", searchHits > 10, searchHits);
    await page.locator("#search-close").click();
  }

  await page.screenshot({ path: path.join(outDir, "final.png"), fullPage: false });

  const realConsole = report.consoleErrors.filter(
    (t) => !/favicon|Download the React|DevTools/i.test(t)
  );
  check("无 pageerror", report.errors.length === 0, report.errors.join(" | "));
  check("无严重 console error", realConsole.length === 0, realConsole.slice(0, 3).join(" | "));

  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
  process.exit(report.ok ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
