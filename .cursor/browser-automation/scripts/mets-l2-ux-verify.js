/**
 * METS 二级背词网页 UX 改版验收（Playwright + msedge）
 * 服务根：临时_METS二级备考/05_背词网页/dist @ 18765
 */
require("./_playwright-browsers-path");
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE = process.env.METS_URL || "http://127.0.0.1:18765/";
const OUT = path.join(__dirname, "..", "runs", "mets-l2-verify");
fs.mkdirSync(OUT, { recursive: true });

function shot(name) {
  return path.join(OUT, name);
}

(async () => {
  const results = [];
  const pageErrors = [];
  const consoleErrors = [];

  const browser = await chromium.launch({ channel: "msedge", headless: true });
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    locale: "zh-CN",
  });

  page.on("pageerror", (e) => pageErrors.push(String(e.message || e)));
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.goto(BASE, { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForSelector(".tabbar", { timeout: 15000 });
  await page.waitForTimeout(400);

  // --- 1. 底栏三 Tab，无「词库」 ---
  const tabs = await page.locator(".tabbar .tab").allTextContents();
  const tabTexts = tabs.map((t) => t.trim());
  const c1ok =
    tabTexts.length === 3 &&
    tabTexts.includes("学") &&
    tabTexts.includes("易忘") &&
    tabTexts.includes("我的") &&
    !tabTexts.some((t) => t.includes("词库"));
  results.push({
    id: 1,
    name: "底栏仅三 Tab：学/易忘/我的；无词库",
    pass: c1ok,
    detail: { tabTexts },
  });

  // --- 学首页截图 ---
  await page.screenshot({ path: shot("01-study-home.png"), fullPage: false });

  // --- 2. 顶栏放大镜；搜词；无「用搜索结果学习」 ---
  const hasSearchBtn = await page.locator("#btn-search").count();
  await page.locator("#btn-search").click();
  await page.waitForSelector("#search-overlay:not([hidden])", { timeout: 5000 });
  await page.fill("#search-input", "auscultate");
  await page.waitForTimeout(600);
  const searchItems = await page.locator("#search-results .list-item").count();
  const learnFromSearchBtn = await page
    .locator("button, a")
    .filter({ hasText: /用搜索结果学习/ })
    .count();
  const overlayHtml = await page.locator("#search-overlay").innerText();
  const hasLearnPhrase = /用搜索结果学习/.test(overlayHtml);
  await page.screenshot({ path: shot("02-search-overlay.png"), fullPage: false });

  // 点词（触发发音，不要求真实出声）
  let clickedWord = false;
  if (searchItems > 0) {
    await page.locator("#search-results .list-item").first().click();
    await page.waitForTimeout(300);
    clickedWord = true;
  }
  await page.locator("#search-close").click();
  await page.waitForTimeout(200);

  const c2ok =
    hasSearchBtn === 1 &&
    searchItems > 0 &&
    learnFromSearchBtn === 0 &&
    !hasLearnPhrase &&
    clickedWord;
  results.push({
    id: 2,
    name: "顶栏放大镜；搜词可点发音；无「用搜索结果学习」",
    pass: c2ok,
    detail: { hasSearchBtn, searchItems, learnFromSearchBtn, hasLearnPhrase, clickedWord },
  });

  // --- 3. 选词库 → 场景 → 回学页 展示/闪记/闪忆 ---
  await page.locator("button", { hasText: "选词库" }).click();
  await page.waitForTimeout(300);
  const pickTitle = await page.locator("#top-title").textContent();
  await page.screenshot({ path: shot("03-pick-pack-home.png"), fullPage: false });
  await page.locator(".scene-item", { hasText: "按场景" }).click();
  await page.waitForSelector(".check-item", { timeout: 8000 });
  await page.locator(".check-item").first().locator("input").check();
  await page.locator("button.primary").filter({ hasText: /进入|开始|确定|完成/ }).first().click();
  await page.waitForTimeout(500);
  // 若按钮文案不同，再试常见文案
  if ((await page.locator(".list-item").count()) === 0) {
    const enterBtns = page.locator("button").filter({ hasText: /进入|开始学|确定|完成|选好了/ });
    if ((await enterBtns.count()) > 0) await enterBtns.first().click();
    await page.waitForTimeout(400);
  }
  await page.waitForSelector(".list-item, #study-body", { timeout: 10000 });
  const modeLabels = await page.locator(".mode-bar .btn").allTextContents();
  const modeTrim = modeLabels.map((t) => t.trim());
  const hasModes =
    modeTrim.includes("展示") && modeTrim.includes("闪记") && modeTrim.includes("闪忆");
  const listCount = await page.locator(".list-item").count();
  await page.screenshot({ path: shot("04-study-list-after-pick.png"), fullPage: false });
  const c3ok = (pickTitle || "").includes("选词库") && hasModes && listCount > 0;
  results.push({
    id: 3,
    name: "学页选词库；选场景后回学页有展示/闪记/闪忆",
    pass: c3ok,
    detail: { pickTitle, modeTrim, listCount },
  });

  // --- 4. 仅中文 → cols-zh，隐藏英文与 meta ---
  await page.locator(".mode-bar .btn", { hasText: "展示" }).click();
  await page.waitForTimeout(200);
  await page.locator(".row-actions.seg .btn", { hasText: "仅中文" }).click();
  await page.waitForTimeout(300);
  const listClass = await page.locator("ul.list-block").getAttribute("class");
  const hasColsZh = /\bcols-zh\b/.test(listClass || "");
  const enVisible = await page.locator("ul.list-block.cols-zh .en").first().isVisible().catch(() => false);
  const metaVisible = await page
    .locator("ul.list-block.cols-zh .meta")
    .first()
    .isVisible()
    .catch(() => false);
  // CSS display:none → isVisible false；若无 .meta 节点也算隐藏
  const metaCount = await page.locator("ul.list-block.cols-zh .meta").count();
  const zhVisible = await page.locator("ul.list-block.cols-zh .zh").first().isVisible();
  await page.screenshot({ path: shot("05-list-zh-only.png"), fullPage: false });
  const c4ok = hasColsZh && !enVisible && (!metaVisible || metaCount === 0) && zhVisible;
  results.push({
    id: 4,
    name: "列表「仅中文」时 cols-zh，隐藏英文与 meta",
    pass: c4ok,
    detail: { listClass, enVisible, metaVisible, metaCount, zhVisible },
  });

  // --- 5. 闪记沉浸模式 ---
  await page.locator(".mode-bar .btn", { hasText: "闪记" }).click();
  await page.waitForTimeout(400);
  const immerseBtnVisible = await page.locator("button", { hasText: "沉浸模式" }).isVisible();
  await page.locator("button", { hasText: "沉浸模式" }).click();
  await page.waitForSelector(".immerse-root", { timeout: 5000 });
  await page.waitForTimeout(500);
  const immerseBg = await page.evaluate(() => {
    const el = document.querySelector(".immerse-root");
    if (!el) return null;
    const s = getComputedStyle(el);
    return {
      position: s.position,
      zIndex: s.zIndex,
      bg: s.backgroundImage || s.backgroundColor,
      hint: el.querySelector(".immerse-hint")?.textContent || "",
      exit: el.querySelector(".immerse-exit")?.textContent || "",
      fullScreen: el.getBoundingClientRect().height >= window.innerHeight * 0.9,
    };
  });
  const hintOk =
    immerseBg &&
    /左滑/.test(immerseBg.hint) &&
    /右滑/.test(immerseBg.hint) &&
    /单击/.test(immerseBg.hint) &&
    /双击/.test(immerseBg.hint);
  await page.screenshot({ path: shot("06-immerse-flash.png"), fullPage: false });
  await page.locator(".immerse-exit").click();
  await page.waitForTimeout(400);
  const afterExitImmerse = (await page.locator(".immerse-root").count()) === 0;
  const backOnStudy =
    (await page.locator(".mode-bar .btn", { hasText: "闪记" }).count()) > 0 ||
    (await page.locator("button", { hasText: "选词库" }).count()) > 0;
  await page.screenshot({ path: shot("07-after-exit-immerse.png"), fullPage: false });

  // 闪忆也有沉浸
  await page.locator(".mode-bar .btn", { hasText: "闪忆" }).click();
  await page.waitForTimeout(300);
  const recallImmerse = await page.locator("button", { hasText: "沉浸模式" }).isVisible();
  await page.locator("button", { hasText: "沉浸模式" }).click();
  await page.waitForSelector(".immerse-root", { timeout: 5000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: shot("08-immerse-recall.png"), fullPage: false });
  await page.locator(".immerse-exit").click();
  await page.waitForTimeout(300);

  const c5ok =
    immerseBtnVisible &&
    recallImmerse &&
    immerseBg?.position === "fixed" &&
    immerseBg?.fullScreen &&
    hintOk &&
    afterExitImmerse &&
    backOnStudy;
  results.push({
    id: 5,
    name: "闪记/闪忆沉浸模式；全屏深色；手势提示；退出回学页",
    pass: c5ok,
    detail: { immerseBtnVisible, recallImmerse, immerseBg, afterExitImmerse, backOnStudy, hintOk },
  });

  // --- 6. 无 pageerror / 关键 console error；词表能加载 ---
  // 过滤无关噪音（如 favicon）
  const filteredConsole = consoleErrors.filter(
    (t) => !/favicon|Download the React DevTools|net::ERR_FAILED.*favicon/i.test(t)
  );
  const catalogOk = await page.evaluate(async () => {
    try {
      const r = await fetch("data/catalog.json");
      if (!r.ok) return { ok: false, status: r.status };
      const j = await r.json();
      const n = Array.isArray(j) ? j.length : j.words?.length || j.length || 0;
      return { ok: true, n, keys: Object.keys(j).slice(0, 8) };
    } catch (e) {
      return { ok: false, err: String(e) };
    }
  });
  const wordCountOnPage = await page.locator(".list-item").count().catch(() => 0);
  // 切回展示确认词在
  await page.locator(".mode-bar .btn", { hasText: "展示" }).click().catch(() => {});
  await page.waitForTimeout(200);
  const listAfter = await page.locator(".list-item").count();

  const c6ok =
    pageErrors.length === 0 &&
    filteredConsole.length === 0 &&
    catalogOk.ok &&
    (listAfter > 0 || listCount > 0);
  results.push({
    id: 6,
    name: "无 pageerror / 关键 console error；词表能加载",
    pass: c6ok,
    detail: { pageErrors, consoleErrors: filteredConsole, catalogOk, listAfter, wordCountOnPage },
  });

  await browser.close();

  const allPass = results.every((r) => r.pass);
  const summary = {
    verdict: allPass ? "PASS" : "FAIL",
    base: BASE,
    out: OUT,
    results,
    screenshots: [
      "01-study-home.png",
      "02-search-overlay.png",
      "03-pick-pack-home.png",
      "04-study-list-after-pick.png",
      "05-list-zh-only.png",
      "06-immerse-flash.png",
      "07-after-exit-immerse.png",
      "08-immerse-recall.png",
    ],
  };
  fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  console.log(JSON.stringify(summary, null, 2));
  process.exit(allPass ? 0 : 2);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
