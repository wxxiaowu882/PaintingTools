/**
 * 成就词库功能复测：进库 / 偷看清零 / 连闪 / 回炉 / 跳词 / 模式 toast
 */
require("./_playwright-browsers-path");
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const BASE =
  process.env.METS_URL ||
  "http://127.0.0.1:18080/%E4%B8%B4%E6%97%B6_METS%E4%BA%8C%E7%BA%A7%E5%A4%87%E8%80%83/05_%E8%83%8C%E8%AF%8D%E7%BD%91%E9%A1%B5/dist/";
const outDir = path.join(__dirname, "..", "runs", "mets-achieve-func-qa");
fs.mkdirSync(outDir, { recursive: true });

const report = { ok: true, checks: [], errors: [] };

function check(name, pass, detail) {
  report.checks.push({ name, pass: !!pass, detail: detail || "" });
  if (!pass) report.ok = false;
}

async function tapNext(page) {
  const card = page.locator(".immerse-stage");
  const box = await card.boundingBox();
  if (!box) throw new Error("no immerse-stage");
  // 点右下空白，避开居中英文（否则桌面走「点词发音」不切词）
  await page.mouse.click(box.x + box.width * 0.85, box.y + box.height * 0.78);
  await page.waitForTimeout(550);
}

async function tapPrev(page) {
  const card = page.locator(".immerse-stage");
  const box = await card.boundingBox();
  if (!box) throw new Error("no immerse-stage");
  await page.mouse.click(box.x + box.width * 0.15, box.y + box.height * 0.78);
  await page.waitForTimeout(550);
}

async function longPressReveal(page) {
  const card = page.locator(".immerse-stage");
  const box = await card.boundingBox();
  if (!box) throw new Error("no immerse-stage");
  // 压在英文上：验收桌面长按偷看（可选中区域）
  const en = page.locator(".immerse-stage .flash-en .immerse-speak");
  const eb = (await en.boundingBox()) || box;
  const x = eb.x + eb.width * 0.5;
  const y = eb.y + eb.height * 0.5;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(700);
  await page.mouse.up();
  await page.waitForTimeout(350);
}

async function dblToggleAuto(page) {
  const card = page.locator(".immerse-stage");
  const box = await card.boundingBox();
  if (!box) throw new Error("no immerse-stage");
  const x = box.x + box.width * 0.5;
  const y = box.y + box.height * 0.78;
  await page.mouse.dblclick(x, y);
  await page.waitForTimeout(200);
}

async function currentEn(page) {
  return page.evaluate(() => {
    const el = document.querySelector(".immerse-stage .flash-en .immerse-speak");
    return el?.textContent?.trim() || "";
  });
}

async function achieveProg(page, en) {
  return page.evaluate((wordEn) => {
    const cat = window.__METS_CATALOG__ || null;
    // fallback: scan localStorage progress by matching via foot not available — use catalog from fetch cache
    const raw = localStorage.getItem("mets-l2-achieve-words-v1");
    const map = raw ? JSON.parse(raw) : {};
    // find id via DOM dataset not available; expose via reading all and matching in page using internal if any
    return { map, wordEn };
  }, en);
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
    sessionStorage.clear();
    try {
      indexedDB.deleteDatabase("mets-l2-vocab");
    } catch (_) {}
  });
  await page.reload({ waitUntil: "networkidle", timeout: 60000 });
  await page.waitForSelector(".pack-achieve-row", { timeout: 25000 });

  // 加速：进库需 2 次；日上限 3；小阶段 3；每轮 5
  await page.evaluate(() => {
    localStorage.setItem(
      "mets-l2-settings-v1",
      JSON.stringify({
        groupSize: 100,
        flashIntervalMs: 800,
        voiceChannel: "both",
        playbackRate: 1,
        showIpa: true,
        showFreq: true,
        listCols: "both",
        lastStudyMode: "recallZh",
        immerseTheme: "night",
        immerseAudioOn: false,
        achieveDailyValidCap: 3,
        achieveStreakNeed: 2,
        planDailyRounds: 3,
        planRoundSize: 5,
        planMiniEvery: 3,
      })
    );
  });

  // 勾选第 1 组并开始
  const goBtn = page.locator("button:has-text('进入学习')").first();
  await goBtn.click();
  await page.waitForSelector(".immerse-root", { timeout: 15000 });
  // 切到英
  await page.locator(".immerse-mode-btn", { hasText: "英" }).click();
  await page.waitForTimeout(400);
  await page.waitForSelector(".immerse-stage .flash-en", { timeout: 10000 });

  // —— T1：streakNeed=1，手动 next 进库且不跳词 ——
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("mets-l2-settings-v1") || "{}");
    s.achieveStreakNeed = 1;
    s.immerseAudioOn = false;
    localStorage.setItem("mets-l2-settings-v1", JSON.stringify(s));
    localStorage.removeItem("mets-l2-achieve-words-v1");
    localStorage.removeItem("mets-l2-achieve-days-v1");
    localStorage.removeItem("mets-l2-achieve-plan-v1");
  });
  await page.locator('[aria-label="退出"]').click();
  await page.waitForTimeout(400);
  await page.waitForSelector(".pack-achieve-row", { timeout: 10000 });
  await page.locator("button:has-text('进入学习')").first().click();
  await page.waitForSelector(".immerse-stage .flash-en", { timeout: 15000 });
  await page.locator(".immerse-mode-btn", { hasText: "英" }).click();
  await page.waitForTimeout(300);

  const before = await currentEn(page);
  await tapNext(page);
  const afterFirst = await currentEn(page);
  const prog1 = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("mets-l2-achieve-words-v1") || "{}")
  );
  const achievedIds = Object.keys(prog1).filter((id) => prog1[id]?.achievedAt);
  check(
    "streakNeed=1 时手动 next 进库",
    achievedIds.length >= 1,
    JSON.stringify({ before, afterFirst, achievedIds })
  );
  check(
    "进库后当前词不是刚进库词",
    !!afterFirst && afterFirst !== before,
    `${before} => ${afterFirst}`
  );

  await tapNext(page);
  const afterSecond = await currentEn(page);
  check(
    "进库后继续 next 连贯",
    !!afterSecond && afterSecond !== afterFirst,
    `${afterFirst} => ${afterSecond}`
  );

  await page.screenshot({ path: path.join(outDir, "t1-after-achieve.png") });

  // —— T3：连闪计计划、不计有效 ——
  const planBefore = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("mets-l2-achieve-plan-v1") || "null")
  );
  const wordsBeforeAuto = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("mets-l2-achieve-words-v1") || "{}")
  );
  const cardBox = await page.locator(".immerse-stage").boundingBox();
  await dblToggleAuto(page);
  await page.waitForTimeout(2800);
  await dblToggleAuto(page);
  await page.waitForTimeout(400);
  const planAfter = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("mets-l2-achieve-plan-v1") || "null")
  );
  const wordsAfterAuto = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("mets-l2-achieve-words-v1") || "{}")
  );
  const streakSum = (m) =>
    Object.values(m || {}).reduce(
      (a, w) => a + (w.achievedAt ? 0 : Number(w.streak) || 0),
      0
    );
  check(
    "连闪会增加计划 ticks",
    (planAfter?.ticks || 0) > (planBefore?.ticks || 0),
    JSON.stringify({ before: planBefore?.ticks, after: planAfter?.ticks })
  );
  check(
    "连闪不显著增加未成就 streak",
    streakSum(wordsAfterAuto) <= streakSum(wordsBeforeAuto) + 0,
    JSON.stringify({
      before: streakSum(wordsBeforeAuto),
      after: streakSum(wordsAfterAuto),
    })
  );

  // —— T2：偷看清零（streakNeed=2，先攒 1 再偷看）——
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("mets-l2-settings-v1") || "{}");
    s.achieveStreakNeed = 2;
    localStorage.setItem("mets-l2-settings-v1", JSON.stringify(s));
    localStorage.setItem("mets-l2-achieve-words-v1", "{}");
  });
  await page.locator('[aria-label="退出"]').click();
  await page.waitForTimeout(300);
  await page.locator("button:has-text('进入学习')").first().click();
  await page.waitForSelector(".immerse-stage .flash-en", { timeout: 12000 });
  await page.locator(".immerse-mode-btn", { hasText: "英" }).click();
  await page.waitForTimeout(250);
  const peekWord = await currentEn(page);
  await tapNext(page); // leave → streak 1
  for (let i = 0; i < 12; i++) {
    if ((await currentEn(page)) === peekWord) break;
    await tapPrev(page);
  }
  const onPeekWord = (await currentEn(page)) === peekWord;
  check("回到待偷看词", onPeekWord, `want=${peekWord} now=${await currentEn(page)}`);
  if (onPeekWord) {
    const beforePeek = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("mets-l2-achieve-words-v1") || "{}")
    );
    const hadStreak = Object.values(beforePeek).some((w) => (w.streak || 0) >= 1);
    await longPressReveal(page);
    const afterPeekMap = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("mets-l2-achieve-words-v1") || "{}")
    );
    const maxStreak = Math.max(
      0,
      ...Object.values(afterPeekMap).map((w) =>
        w.achievedAt ? 0 : Number(w.streak) || 0
      )
    );
    check(
      "长按偷看清零 streak",
      hadStreak && maxStreak === 0,
      JSON.stringify({ hadStreak, beforePeek, afterPeekMap })
    );
  }

  // —— T4：英→中 toast ——
  // 若已在中，先回英
  await page.locator(".immerse-mode-btn", { hasText: "英" }).click();
  await page.waitForTimeout(250);
  await page.locator(".immerse-mode-btn", { hasText: "中" }).click();
  await page.waitForTimeout(600);
  const toastText = await page.evaluate(
    () => document.querySelector(".app-toast")?.textContent || ""
  );
  check("英→中出现偷看 toast", /偷看/.test(toastText), toastText);

  // —— T5：成就库回炉 ——
  const ids = await page.evaluate(async () => {
    const r = await fetch("data/catalog.json");
    const j = await r.json();
    const arr = j.words || j.entries || [];
    return arr.slice(0, 3).map((w) => String(w.id));
  });
  await page.evaluate((ids) => {
    const day = (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    })();
    const map = {};
    ids.forEach((id, i) => {
      map[id] = {
        streak: 2,
        dayKey: day,
        dayValid: 1,
        achievedAt: Date.now() - i,
      };
    });
    localStorage.setItem("mets-l2-achieve-words-v1", JSON.stringify(map));
  }, ids);
  if (await page.locator('[aria-label="退出"]').count()) {
    await page.locator('[aria-label="退出"]').click();
    await page.waitForTimeout(300);
  }
  await page.waitForSelector(".pack-achieve-row", { timeout: 10000 });
  await page.locator(".pack-achieve-row").click();
  await page.waitForSelector(".immerse-stage, #achieve-empty-back", {
    timeout: 10000,
  });
  if (await page.locator(".immerse-stage").count()) {
    await page.locator(".immerse-mode-btn", { hasText: "英" }).click();
    await page.waitForTimeout(300);
    const beforeDemote = await page.evaluate(() => {
      const map = JSON.parse(
        localStorage.getItem("mets-l2-achieve-words-v1") || "{}"
      );
      return Object.keys(map).filter((k) => map[k]?.achievedAt).length;
    });
    await longPressReveal(page);
    await page.waitForTimeout(500);
    const afterDemote = await page.evaluate(() => {
      const map = JSON.parse(
        localStorage.getItem("mets-l2-achieve-words-v1") || "{}"
      );
      return Object.keys(map).filter((k) => map[k]?.achievedAt).length;
    });
    check(
      "成就库英长按回炉减少成就数",
      afterDemote < beforeDemote,
      JSON.stringify({ beforeDemote, afterDemote })
    );
    const demoteToast = await page.evaluate(
      () => document.querySelector(".app-toast")?.textContent || ""
    );
    check("回炉 toast", /回炉|偷看/.test(demoteToast), demoteToast);
  } else {
    check("成就库可进入", false, "empty after inject ids=" + ids.join(","));
  }

  await page.screenshot({ path: path.join(outDir, "t5-demote.png") });

  // 清理
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
